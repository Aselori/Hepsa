-- ============================================================================
-- EL CATÁLOGO PÚBLICO SE CAÍA EN CUANTO HABÍA UN PRODUCTO DESACTIVADO
--
-- Síntoma: un visitante sin sesión pedía /rest/v1/products y recibía
-- 401 "permission denied for function current_user_role". No en algunos casos:
-- la consulta entera fallaba, así que el escaparate quedaba vacío para
-- cualquiera que no hubiera iniciado sesión.
--
-- Por qué estaba dormido: la política es
--
--     USING (is_active = true OR public.is_staff())
--
-- y hasta hoy TODOS los productos estaban activos. El panel ofrece desactivar
-- productos, así que el fallo esperaba a que alguien usara esa función.
--
-- Por qué no bastó ordenar las condiciones: la migración anterior puso la
-- comprobación del token primero creyendo que el AND cortocircuitaría antes de
-- llegar a current_user_role(), que anon tiene prohibida desde la 0004. Es
-- falso. is_staff() es LANGUAGE sql, así que Postgres la INLINEA en la
-- consulta, y el privilegio EXECUTE se comprueba al planificar, no al evaluar
-- cada fila. Ninguna reordenación de la expresión evita el error.
--
-- El arreglo: is_staff() e is_admin() pasan a SECURITY DEFINER. Dos efectos,
-- ambos necesarios:
--
--   1. Postgres NO inlinea funciones SECURITY DEFINER, así que
--      current_user_role() se llama en tiempo de ejecución.
--   2. Esa llamada corre como el dueño de la función, que sí tiene permiso.
--
-- Lo que NO se hace, a propósito: conceder current_user_role() a anon. La
-- migración 0004 se la quitó para que un visitante no pudiera consultar roles
-- por /rest/v1/rpc/. Eso sigue igual; lo único que cambia es quién la ejecuta
-- por dentro. is_staff() sí sigue siendo llamable por anon, y para un visitante
-- devuelve false, que es la respuesta correcta y no revela nada.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
    AS $$
  SELECT public.segundo_factor_verificado()
     AND public.current_user_role() IN ('vendedor', 'admin');
$$;

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
    AS $$
  SELECT public.segundo_factor_verificado()
     AND public.current_user_role() = 'admin';
$$;

-- segundo_factor_verificado() sólo lee el JWT de la petición, no toca tablas
-- ni funciones restringidas, así que no necesita SECURITY DEFINER.
