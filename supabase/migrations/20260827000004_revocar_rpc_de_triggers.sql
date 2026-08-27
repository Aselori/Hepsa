-- ============================================================================
-- Quitar de la API las funciones que no son para llamarse.
--
-- Supabase expone TODA función de public en /rest/v1/rpc/. Las funciones de
-- trigger quedaban ahí: llamarlas directo falla ("can only be called as
-- trigger"), pero no hay razón para publicarlas, y el linter las marca.
--
-- current_user_role() ya se había revocado de PUBLIC en 0002, pero anon y
-- authenticated la tenían igual por los privilegios por defecto de Supabase.
-- El staff no la necesita: is_staff() e is_admin() la llaman internamente.
-- ============================================================================

REVOKE ALL ON FUNCTION public.handle_new_user()              FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_role_self_escalation() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_precio_estimado()          FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_employee_username()   FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_user_role()            FROM anon;

-- calcular_precio() SÍ se queda accesible: que un visitante anónimo obtenga
-- un estimado sin registrarse es justo el objetivo del cotizador.
