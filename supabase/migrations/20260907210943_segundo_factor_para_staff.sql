-- ============================================================================
-- MEJORA 3: SEGUNDO FACTOR OBLIGATORIO PARA EL PERSONAL
--
-- El riesgo que plantea la presentación: un vendedor con la contraseña robada
-- ve el directorio completo de clientes, el historial de ventas y el panel de
-- administración. La contraseña sola no puede seguir siendo suficiente para
-- llegar a eso.
--
-- La regla se escribe AQUÍ y no en el navegador. admin.html ya comprueba el
-- rol en JavaScript, pero eso sólo decide qué se dibuja; quien edite el JS o
-- llame a la API directamente se salta el dibujo por completo. Lo que de
-- verdad separa a un vendedor de un cliente son las políticas RLS, y todas
-- pasan por is_staff() e is_admin(). Añadiendo el segundo factor a esas dos
-- funciones, la exigencia queda en el único lugar que el atacante no controla.
--
-- Cómo lo sabe la base: Supabase firma en el JWT el claim 'aal' (authenticator
-- assurance level). Vale 'aal1' cuando sólo se presentó contraseña y 'aal2'
-- cuando además se verificó un código TOTP. No hace falta consultar ninguna
-- tabla: viene en el token de la petición.
--
-- Qué NO se toca a propósito:
--
--   - Los clientes. Siguen entrando con contraseña sola. No ven datos de
--     nadie más que de sí mismos, así que exigirles TOTP sería fricción sin
--     nada que proteger, y la presentación pide 2FA "para empleados".
--   - La inscripción del factor. Vive en el esquema auth, fuera de RLS, así
--     que un empleado a aal1 todavía puede darse de alta un autenticador.
--     Sin eso, exigir aal2 dejaría a todo el personal encerrado sin salida.
--   - profiles_select_propio. Un empleado a aal1 sigue pudiendo leer su
--     propio perfil, que es como el portal descubre que le toca inscribirse.
-- ============================================================================

-- ─── 1. ¿Presentó el segundo factor? ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.segundo_factor_verificado()
    RETURNS boolean
    LANGUAGE sql STABLE SET search_path = public
    AS $$
  -- COALESCE: una petición anónima no trae JWT y auth.jwt() devuelve NULL.
  -- Sin esto is_staff() devolvería NULL en vez de false, y NULL en un USING
  -- de RLS no concede acceso pero sí ensucia el razonamiento.
  SELECT COALESCE(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

-- Se concede también a anon, no por descuido: is_staff() aparece en
-- products_select_publico, que se evalúa para visitantes sin sesión. Si anon
-- no pudiera ejecutarla, consultar el catálogo reventaría con "permission
-- denied". No revela nada: sólo describe el token de quien pregunta.
GRANT EXECUTE ON FUNCTION public.segundo_factor_verificado() TO anon, authenticated;

-- ─── 2. Las dos funciones que sostienen todas las políticas ─────────────────

-- El orden de las condiciones ahorra un SELECT sobre profiles cuando el token
-- no trae aal2, y nada más.
--
-- CORRECCIÓN: aquí se afirmaba además que poner el aal primero evitaba que un
-- visitante anónimo chocara contra current_user_role(), que tiene prohibida
-- desde la 0004. Eso era FALSO y rompía el catálogo público en cuanto existía
-- un producto desactivado: is_staff() es LANGUAGE sql, Postgres la inlinea, y
-- el permiso EXECUTE se comprueba al planificar la consulta, no al evaluar cada
-- fila, así que el AND nunca llega a cortocircuitar nada. Lo arregla la
-- migración 20260907214137, que las pasa a SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean
    LANGUAGE sql STABLE SET search_path = public
    AS $$
  SELECT public.segundo_factor_verificado()
     AND public.current_user_role() IN ('vendedor', 'admin');
$$;

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SET search_path = public
    AS $$
  SELECT public.segundo_factor_verificado()
     AND public.current_user_role() = 'admin';
$$;

-- ─── 3. Quién falta por inscribirse ─────────────────────────────────────────

-- Una obligación que nadie puede medir no se cumple. El panel de usuarios
-- necesita poder responder "¿qué empleados siguen sin segundo factor?", y esa
-- respuesta vive en auth.mfa_factors, que RLS no expone a nadie.
--
-- SECURITY DEFINER para poder leer ese esquema, con el filtro de admin DENTRO
-- de la función: si el guardia estuviera fuera, cualquiera podría llamarla.
CREATE OR REPLACE FUNCTION public.empleados_sin_segundo_factor()
    RETURNS TABLE (id uuid, email text, first_name text, last_name_p text, role public.user_role)
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
    AS $$
BEGIN
  IF NOT public.is_admin() THEN
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

REVOKE EXECUTE ON FUNCTION public.empleados_sin_segundo_factor() FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.empleados_sin_segundo_factor() TO authenticated;
