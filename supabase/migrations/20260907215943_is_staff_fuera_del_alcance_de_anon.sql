-- ============================================================================
-- QUITAR is_staff() E is_admin() DEL ALCANCE DE anon
--
-- La migración anterior arregló el catálogo público pasando is_staff() e
-- is_admin() a SECURITY DEFINER. Funcionó, pero dejó dos avisos del linter de
-- Supabase: son funciones SECURITY DEFINER llamables sin iniciar sesión, por
-- /rest/v1/rpc/is_staff. No es explotable (no reciben argumentos, sólo
-- describen a quien pregunta y tienen search_path fijo), pero es una cara
-- expuesta que no necesitamos, y el patrón es el que conviene no normalizar.
--
-- La causa real era la forma de la política, no la función:
--
--     USING (is_active = true OR public.is_staff())
--
-- Una sola política obligaba a que anon pudiera ejecutar is_staff(), porque
-- sin cláusula TO se evalúa para todos los roles. Partiéndola en dos, el
-- visitante anónimo nunca llega a nombrar la función:
--
--     products_select_publico  →  USING (is_active = true)          (todos)
--     products_select_staff    →  TO authenticated USING (is_staff())
--
-- Las políticas permisivas se combinan con OR, así que el staff sigue viendo
-- el catálogo completo y el visitante sigue viendo sólo lo activo. Con anon
-- fuera de la ecuación, is_staff() vuelve a SECURITY INVOKER (authenticated sí
-- puede ejecutar current_user_role()) y se le revoca el EXECUTE a anon.
--
-- Comprobado en tests/rls.spec.mjs, bloque 10: un producto desactivado y un
-- visitante sin sesión, que es el caso que rompía el escaparate.
-- ============================================================================

-- ─── 1. La política, partida en dos ─────────────────────────────────────────

DROP POLICY IF EXISTS "products_select_publico" ON public.products;

-- El escaparate: sin llamadas a función, así que nada que un anónimo tenga
-- prohibido ejecutar.
CREATE POLICY "products_select_publico" ON public.products
    FOR SELECT USING (is_active = true);

-- El staff ve además lo desactivado, para poder reactivarlo.
CREATE POLICY "products_select_staff" ON public.products
    FOR SELECT TO authenticated USING (public.is_staff());

-- ─── 2. Las funciones vuelven a SECURITY INVOKER ────────────────────────────

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

-- ─── 3. Fuera de la API pública ─────────────────────────────────────────────

-- Ya no las necesita nadie sin sesión. Las políticas que las nombran son todas
-- TO authenticated, y los dos llamadores restantes (prevent_role_self_escalation
-- y empleados_sin_segundo_factor) son SECURITY DEFINER, así que las ejecutan
-- como su dueño y no dependen de estos permisos.
REVOKE ALL ON FUNCTION public.is_staff() FROM public, anon;
REVOKE ALL ON FUNCTION public.is_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- segundo_factor_verificado() sí se queda accesible a anon: no toca tablas ni
-- funciones restringidas, y dejarla disponible evita repetir este enredo si
-- alguna política pública la necesitara.
