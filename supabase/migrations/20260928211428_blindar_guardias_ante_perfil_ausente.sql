-- ============================================================================
-- DOS GUARDIAS SE ABRIAN CUANDO EL ROL VALIA NULL
--
-- Ambos casos se reprodujeron contra el stack local antes de corregirlos.
--
-- 1. ESCALADA A ADMINISTRADOR (el mas grave)
--    Un usuario cuya fila en profiles tiene role NULL podia ascenderse a admin
--    con un UPDATE sobre su propia fila. Ensayado dentro de una transaccion que
--    se deshizo: el role quedo en 'admin'.
--
-- 2. FUGA DE LA LISTA DEL PERSONAL
--    Un usuario sin fila en profiles llamaba a empleados_sin_segundo_factor()
--    y recibia la lista de empleados sin segundo factor, es decir, que cuentas
--    del personal se pueden tomar sabiendo solo la contrasena.
--
-- La causa comun, en tres pasos:
--
--   a. current_user_role() devuelve NULL tanto si falta la fila como si su
--      role es NULL.
--   b. is_admin() era  segundo_factor_verificado() AND current_user_role() = 'admin'.
--      A AAL2 eso es  true AND NULL = NULL. (A AAL1, false AND NULL = false; por
--      eso los dos casos exigian AAL2, que cualquiera alcanza inscribiendo su
--      propio factor.)
--   c. Los guardias eran  IF NOT is_admin()  y  IF ... AND NOT is_admin().
--      NOT NULL es NULL, y en PL/pgSQL una condicion NULL no entra en la rama:
--      el RAISE nunca se ejecutaba.
--
-- Una revision anterior de esta migracion solo vio el caso 2, porque buscaba
-- el patron "IF NOT is_admin" y el disparador lo escribe "AND NOT is_admin".
-- La capa 1 ya cerraba el caso 1 sin haberlo buscado; se deja constancia para
-- no confundir ese acierto con un analisis completo.
--
-- Alcance: role tiene DEFAULT 'cliente' y handle_new_user() crea la fila al
-- registrarse, asi que por el camino normal no hay NULL. Queda alcanzable si
-- alguien escribio NULL a mano, si el trigger fallo o si la cuenta nacio por la
-- API administrativa. NO se ha comprobado si existe alguna cuenta asi en el
-- proyecto hospedado; esta migracion cierra los agujeros, no afirma que se
-- hayan explotado.
--
-- RLS no cambia de comportamiento: ya trataba NULL como no concedido. Los dos
-- agujeros estaban solo en condiciones PL/pgSQL.
-- ============================================================================

-- ─── Capa 0: que el rol no pueda ser NULL ───────────────────────────────────

-- Un role NULL nunca concedio acceso de personal (NULL no es 'vendedor' ni
-- 'admin'), asi que pasarlo a 'cliente' no le quita a nadie un permiso que
-- tuviera: solo cierra la puerta. Es el valor de menor privilegio y el mismo
-- que asigna la columna por defecto.
UPDATE public.profiles SET role = 'cliente' WHERE role IS NULL;

ALTER TABLE public.profiles ALTER COLUMN role SET NOT NULL;

-- ─── Capa 1: que las funciones de rol nunca devuelvan NULL ──────────────────

-- La capa 0 no cubre la fila que falta por completo: ahi current_user_role()
-- sigue devolviendo NULL. Por eso las funciones se protegen igual.

CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean
    LANGUAGE sql STABLE SET search_path = public
    AS $$
  SELECT COALESCE(
           public.segundo_factor_verificado()
             AND public.current_user_role() IN ('vendedor', 'admin'),
           false);
$$;

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SET search_path = public
    AS $$
  SELECT COALESCE(
           public.segundo_factor_verificado()
             AND public.current_user_role() = 'admin',
           false);
$$;

-- ─── Capa 2: los guardias tratan NULL como no autorizado ────────────────────

-- IS NOT TRUE y no NOT (...): si la expresion llegara a valer NULL, NOT NULL es
-- NULL y PL/pgSQL no entraria en la rama, que es justo el fallo que se corrige.
-- Se aplica aunque la capa 1 ya impida el NULL, para que un guardia no dependa
-- de que otra funcion siga siendo como es hoy.

CREATE OR REPLACE FUNCTION public.prevent_role_self_escalation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = public
    AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    -- auth.uid() es NULL cuando corre service_role o el SQL editor,
    -- que son justamente los caminos legitimos para cambiar un rol.
    IF auth.uid() IS NOT NULL AND public.is_admin() IS NOT TRUE THEN
      RAISE EXCEPTION 'No tienes permiso para cambiar el rol de un usuario';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.empleados_sin_segundo_factor()
    RETURNS TABLE (id uuid, email text, first_name text, last_name_p text, role public.user_role)
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
    AS $$
BEGIN
  IF public.is_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'Sólo un administrador con segundo factor puede consultar esto';
  END IF;

  RETURN QUERY
    SELECT p.id, p.email, p.first_name, p.last_name_p, p.role
      FROM public.profiles p
     WHERE p.role IN ('vendedor', 'admin')
       AND NOT EXISTS (
             SELECT 1 FROM auth.mfa_factors f
              WHERE f.user_id = p.id AND f.status = 'verified')
     ORDER BY p.role DESC, p.last_name_p;
END;
$$;
