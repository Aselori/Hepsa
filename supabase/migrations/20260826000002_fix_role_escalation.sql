-- ============================================================================
-- SEGURIDAD: corrige la escalada de privilegios.
--
-- PROBLEMA
-- Todas las políticas de 0001 leen el rol desde el JWT:
--     auth.jwt() -> 'user_metadata' ->> 'role'
-- user_metadata es escribible por el propio usuario. Cualquier cliente
-- registrado puede ejecutar en la consola del navegador:
--     await supabase.auth.updateUser({ data: { role: 'admin' } })
-- y con el JWT renovado la base de datos le CONCEDE acceso a todas las
-- órdenes, todo el directorio de clientes y todas las solicitudes.
--
-- Segunda vía: handle_new_user() copiaba el rol desde raw_user_meta_data,
-- que el cliente controla en signUp(). Es decir, incluso profiles.role
-- estaba envenenado desde su creación.
--
-- SOLUCIÓN
-- El rol vive únicamente en public.profiles.role, lo asigna el servidor y
-- ningún usuario puede modificarlo. Las políticas lo consultan mediante una
-- función SECURITY DEFINER (necesaria para no recursar sobre profiles).
--
-- Vocabulario de roles: se conserva el enum real ('cliente','vendedor',
-- 'admin'). El código usaba 'empleado', que no existe en el enum; se corrige
-- en el cliente, no aquí.
-- ============================================================================

-- ─── 1. El rol ya no se toma del cliente ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = public
    AS $$
BEGIN
  INSERT INTO public.profiles (
    id, first_name, middle_name, last_name_p, last_name_m, email, phone, role
  ) VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'first_name', 'Sin Nombre'),
    new.raw_user_meta_data->>'middle_name',
    COALESCE(new.raw_user_meta_data->>'last_name_p', 'Sin Apellido'),
    new.raw_user_meta_data->>'last_name_m',
    new.email,
    new.raw_user_meta_data->>'phone',
    -- Siempre 'cliente'. Ascender a vendedor/admin es una acción
    -- deliberada de un admin, nunca algo que el registro decida.
    'cliente'::public.user_role
  );
  RETURN new;
END;
$$;

-- ─── 2. Lector de rol confiable ─────────────────────────────────────────────

-- SECURITY DEFINER a propósito: las políticas sobre profiles necesitan leer
-- profiles, y sin esto Postgres entra en recursión infinita.
CREATE OR REPLACE FUNCTION public.current_user_role()
    RETURNS public.user_role
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT public.current_user_role() IN ('vendedor', 'admin');
$$;

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT public.current_user_role() = 'admin';
$$;

REVOKE EXECUTE ON FUNCTION public.current_user_role() FROM public;
GRANT  EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_staff()          TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_admin()          TO authenticated;

-- ─── 3. Nadie puede ascenderse a sí mismo ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.prevent_role_self_escalation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = public
    AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    -- auth.uid() es NULL cuando corre service_role o el SQL editor,
    -- que son justamente los caminos legítimos para cambiar un rol.
    IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'No tienes permiso para cambiar el rol de un usuario';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tr_prevent_role_self_escalation
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.prevent_role_self_escalation();

-- ─── 4. Reemplazo de todas las políticas ────────────────────────────────────

DROP POLICY IF EXISTS "Lectura publica del catalogo"      ON public.products;
DROP POLICY IF EXISTS "Admins pueden insertar productos"  ON public.products;
DROP POLICY IF EXISTS "Admins pueden editar productos"    ON public.products;
DROP POLICY IF EXISTS "Admins gestionan ordenes"          ON public.orders;
DROP POLICY IF EXISTS "Clientes ven sus ordenes"          ON public.orders;
DROP POLICY IF EXISTS "Admins gestionan detalles de orden" ON public.order_items;
DROP POLICY IF EXISTS "Lectura permitida para staff"      ON public.profiles;
DROP POLICY IF EXISTS "Public insert requests"            ON public.custom_requests;
DROP POLICY IF EXISTS "Staff select requests"             ON public.custom_requests;
DROP POLICY IF EXISTS "Staff update requests"             ON public.custom_requests;

-- products ------------------------------------------------------------------
-- El catálogo público solo debe exponer lo activo; el staff ve todo.
CREATE POLICY "products_select_publico" ON public.products
    FOR SELECT USING (is_active = true OR public.is_staff());

CREATE POLICY "products_insert_staff" ON public.products
    FOR INSERT TO authenticated WITH CHECK (public.is_staff());

CREATE POLICY "products_update_staff" ON public.products
    FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

-- Faltaba por completo: el botón "Eliminar" fallaba en silencio y la UI
-- decía que sí había borrado. Solo admin.
CREATE POLICY "products_delete_admin" ON public.products
    FOR DELETE TO authenticated USING (public.is_admin());

-- orders --------------------------------------------------------------------
-- Antes solo 'admin' podía registrar ventas, lo que dejaba al vendedor
-- sin poder usar el punto de venta.
CREATE POLICY "orders_select_staff" ON public.orders
    FOR SELECT TO authenticated USING (public.is_staff());

CREATE POLICY "orders_select_propias" ON public.orders
    FOR SELECT TO authenticated USING (auth.uid() = client_id);

CREATE POLICY "orders_insert_staff" ON public.orders
    FOR INSERT TO authenticated WITH CHECK (public.is_staff());

CREATE POLICY "orders_update_staff" ON public.orders
    FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY "orders_delete_admin" ON public.orders
    FOR DELETE TO authenticated USING (public.is_admin());

-- order_items ---------------------------------------------------------------
CREATE POLICY "order_items_select_staff" ON public.order_items
    FOR SELECT TO authenticated USING (public.is_staff());

CREATE POLICY "order_items_select_propias" ON public.order_items
    FOR SELECT TO authenticated USING (
        EXISTS (SELECT 1 FROM public.orders o
                 WHERE o.id = order_items.order_id AND o.client_id = auth.uid())
    );

CREATE POLICY "order_items_insert_staff" ON public.order_items
    FOR INSERT TO authenticated WITH CHECK (public.is_staff());

CREATE POLICY "order_items_update_staff" ON public.order_items
    FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY "order_items_delete_admin" ON public.order_items
    FOR DELETE TO authenticated USING (public.is_admin());

-- profiles ------------------------------------------------------------------
-- Faltaba: un usuario no podía leer su propio perfil. Por eso el portal
-- público leía los datos desde user_metadata en lugar de la tabla.
CREATE POLICY "profiles_select_propio" ON public.profiles
    FOR SELECT TO authenticated USING (id = auth.uid());

CREATE POLICY "profiles_select_staff" ON public.profiles
    FOR SELECT TO authenticated USING (public.is_staff());

-- Puede editar sus datos, pero el trigger de arriba bloquea el cambio de rol.
CREATE POLICY "profiles_update_propio" ON public.profiles
    FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update_admin" ON public.profiles
    FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- custom_requests -----------------------------------------------------------
-- El formulario público es anónimo a propósito: cualquiera puede pedir
-- cotización. Pero nadie anónimo debe poder LEER lo que otros enviaron.
CREATE POLICY "custom_requests_insert_publico" ON public.custom_requests
    FOR INSERT WITH CHECK (true);

CREATE POLICY "custom_requests_select_staff" ON public.custom_requests
    FOR SELECT TO authenticated USING (public.is_staff());

CREATE POLICY "custom_requests_update_staff" ON public.custom_requests
    FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

CREATE POLICY "custom_requests_delete_admin" ON public.custom_requests
    FOR DELETE TO authenticated USING (public.is_admin());

-- storage -------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins pueden subir imagenes" ON storage.objects;

CREATE POLICY "storage_insert_staff" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'productos' AND public.is_staff());

CREATE POLICY "storage_update_staff" ON storage.objects
    FOR UPDATE TO authenticated USING (bucket_id = 'productos' AND public.is_staff());

CREATE POLICY "storage_delete_admin" ON storage.objects
    FOR DELETE TO authenticated USING (bucket_id = 'productos' AND public.is_admin());

-- ─── 5. Limpieza de los roles ya envenenados ────────────────────────────────

-- Cualquier cuenta que se haya autoasignado un rol vía signUp queda revocada.
-- Hay que volver a ascender al personal real a mano, deliberadamente:
--     UPDATE public.profiles SET role = 'admin' WHERE email = '...';
--
-- Descomentar al aplicar en un entorno real, después de anotar quién es
-- staff legítimo hoy.

-- UPDATE public.profiles SET role = 'cliente'
--  WHERE role <> 'cliente'
--    AND email NOT IN ('correo.del.admin.real@hepsa.mx');
