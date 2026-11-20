-- ============================================================================
-- ESQUEMA EN INGLÉS, NOTAS INTERNAS, VIGENCIA DE COTIZACIONES Y PAQUETES
--
-- El esquema original (orders, products, profiles, custom_requests) estaba en
-- inglés; las tablas y funciones agregadas después quedaron en español y la
-- base terminó mezclando ambos idiomas. Aquí todo identificador de la base
-- (tablas, columnas, tipos, valores de enum, funciones, parámetros, políticas,
-- disparadores, índices y restricciones) pasa a inglés. Los mensajes que ve
-- quien usa el sistema siguen en español.
--
-- Además:
--   * custom_requests.status deja de ser texto libre y usa el enum
--     request_status, como los demás estados del sistema.
--   * orders exige total = subtotal + tax: el total es un dato derivado y la
--     base garantiza que no se contradiga con sus partes.
--   * notes reemplaza a notas_pedido: una sola bitácora interna para ventas y
--     solicitudes. El taller sólo lee las notas de los pedidos que ve.
--   * Vigencia de 14 días para las cotizaciones y paquetes con descuento
--     (bundles), calculados siempre en el servidor.
--
-- Los datos se conservan: se renombra en sitio, no se copia.
-- ============================================================================

-- ─── 1. Lo que depende de funciones que se reemplazan ───────────────────────

DROP TRIGGER IF EXISTS tr_set_precio_estimado ON public.custom_requests;
DROP TRIGGER IF EXISTS tr_fijar_vigencia_cotizacion ON public.custom_requests;
DROP TRIGGER IF EXISTS tr_proteger_producto ON public.products;
DROP TRIGGER IF EXISTS tr_proteger_pedido ON public.orders;
DROP POLICY IF EXISTS notas_pedido_select_personal ON public.notas_pedido;

DROP FUNCTION IF EXISTS public.agregar_nota_pedido(bigint, text);
DROP FUNCTION IF EXISTS public.avanzar_proyecto(bigint, public.project_status);
DROP FUNCTION IF EXISTS public.set_precio_estimado();
DROP FUNCTION IF EXISTS public.calcular_precio(integer, integer, public.material_tipo, public.acabado_tipo);
DROP FUNCTION IF EXISTS public.crear_pedido_desde_carrito(text);
DROP FUNCTION IF EXISTS public.empleados_sin_segundo_factor();
DROP FUNCTION IF EXISTS public.pedidos_de_taller();
DROP FUNCTION IF EXISTS public.permite_sobre_pedido();
DROP FUNCTION IF EXISTS public.proteger_pedido();
DROP FUNCTION IF EXISTS public.proteger_producto();
DROP FUNCTION IF EXISTS public.registrar_pago_en_linea(bigint, text, numeric, text);
DROP FUNCTION IF EXISTS public.registrar_venta(jsonb, jsonb, public.payment_status, text);
-- Mismo OID, nombre nuevo: lo que ya las usa sigue funcionando.
ALTER FUNCTION public.es_taller() RENAME TO is_workshop;
ALTER FUNCTION public.segundo_factor_verificado() RENAME TO is_mfa_verified;

-- ─── 2. Tipos ────────────────────────────────────────────────────────────────

ALTER TYPE public.acabado_tipo RENAME TO finish_type;
ALTER TYPE public.finish_type RENAME VALUE 'pintura_electrostatica' TO 'powder_coat';
ALTER TYPE public.finish_type RENAME VALUE 'pavonado' TO 'bluing';
ALTER TYPE public.finish_type RENAME VALUE 'cromado' TO 'chrome';

ALTER TYPE public.material_tipo RENAME TO material_type;
ALTER TYPE public.material_type RENAME VALUE 'acero' TO 'steel';
ALTER TYPE public.material_type RENAME VALUE 'hierro_forjado' TO 'wrought_iron';
ALTER TYPE public.material_type RENAME VALUE 'aluminio' TO 'aluminum';

ALTER TYPE public.payment_status RENAME VALUE 'completo' TO 'paid';
ALTER TYPE public.payment_status RENAME VALUE 'anticipo' TO 'deposit';
ALTER TYPE public.payment_status RENAME VALUE 'faltante' TO 'pending';

ALTER TYPE public.project_status RENAME VALUE 'cotizando' TO 'quoting';
ALTER TYPE public.project_status RENAME VALUE 'en_produccion' TO 'in_production';
ALTER TYPE public.project_status RENAME VALUE 'instalado' TO 'installed';

ALTER TYPE public.user_role RENAME VALUE 'cliente' TO 'customer';
ALTER TYPE public.user_role RENAME VALUE 'vendedor' TO 'seller';
ALTER TYPE public.user_role RENAME VALUE 'taller' TO 'workshop';

CREATE TYPE public.request_status AS ENUM ('pending', 'contacted', 'in_progress', 'closed');

-- ─── 3. Tablas, columnas y objetos que las acompañan ────────────────────────

ALTER TABLE public.carrito_items RENAME TO cart_items;
ALTER INDEX public.carrito_items_pkey RENAME TO cart_items_pkey;
ALTER INDEX public.carrito_items_user_idx RENAME TO cart_items_user_idx;
ALTER TABLE public.cart_items RENAME CONSTRAINT carrito_items_product_id_fkey TO cart_items_product_id_fkey;
ALTER TABLE public.cart_items RENAME CONSTRAINT carrito_items_qty_check TO cart_items_qty_check;
ALTER POLICY carrito_propio_select ON public.cart_items RENAME TO cart_items_select_own;
ALTER POLICY carrito_propio_insert ON public.cart_items RENAME TO cart_items_insert_own;
ALTER POLICY carrito_propio_update ON public.cart_items RENAME TO cart_items_update_own;
ALTER POLICY carrito_propio_delete ON public.cart_items RENAME TO cart_items_delete_own;

ALTER TABLE public.pagos RENAME TO payments;
ALTER TABLE public.payments RENAME COLUMN proveedor TO provider;
ALTER TABLE public.payments RENAME COLUMN sesion_id TO session_id;
ALTER TABLE public.payments RENAME COLUMN monto TO amount;
ALTER TABLE public.payments RENAME COLUMN moneda TO currency;
ALTER TABLE public.payments RENAME COLUMN duplicado TO is_duplicate;
ALTER TABLE public.payments RENAME COLUMN creado TO created_at;
ALTER SEQUENCE public.pagos_id_seq RENAME TO payments_id_seq;
ALTER INDEX public.pagos_pkey RENAME TO payments_pkey;
ALTER INDEX public.pagos_sesion_id_key RENAME TO payments_session_id_key;
ALTER INDEX public.pagos_order_id_idx RENAME TO payments_order_id_idx;
ALTER TABLE public.payments RENAME CONSTRAINT pagos_monto_check TO payments_amount_check;
ALTER TABLE public.payments RENAME CONSTRAINT pagos_order_id_fkey TO payments_order_id_fkey;
ALTER POLICY pagos_select_propios ON public.payments RENAME TO payments_select_own;
ALTER POLICY pagos_select_staff ON public.payments RENAME TO payments_select_staff;

ALTER TABLE public.parametros_cotizacion RENAME TO quote_settings;
ALTER TABLE public.quote_settings RENAME COLUMN clave TO key;
ALTER TABLE public.quote_settings RENAME COLUMN valor TO value;
ALTER TABLE public.quote_settings RENAME COLUMN texto TO text_value;
ALTER TABLE public.quote_settings RENAME COLUMN nota TO description;
ALTER INDEX public.parametros_cotizacion_pkey RENAME TO quote_settings_pkey;
ALTER POLICY parametros_select_staff ON public.quote_settings RENAME TO quote_settings_select_staff;
ALTER POLICY parametros_write_admin ON public.quote_settings RENAME TO quote_settings_write_admin;
UPDATE public.quote_settings SET key = CASE key
    WHEN 'iva' THEN 'tax_rate'
    WHEN 'mensaje_ticket' THEN 'ticket_message'
    WHEN 'permitir_sobre_pedido' THEN 'allow_backorder'
    WHEN 'precio_minimo' THEN 'minimum_price'
    ELSE key END;

ALTER TABLE public.tarifas_material RENAME TO material_rates;
ALTER TABLE public.material_rates RENAME COLUMN precio_m2 TO price_per_m2;
ALTER TABLE public.material_rates RENAME COLUMN actualizado TO updated_at;
ALTER INDEX public.tarifas_material_pkey RENAME TO material_rates_pkey;
ALTER TABLE public.material_rates RENAME CONSTRAINT tarifas_material_precio_m2_check TO material_rates_price_per_m2_check;
ALTER POLICY tarifas_material_select_staff ON public.material_rates RENAME TO material_rates_select_staff;
ALTER POLICY tarifas_material_write_admin ON public.material_rates RENAME TO material_rates_write_admin;

ALTER TABLE public.tarifas_acabado RENAME TO finish_rates;
ALTER TABLE public.finish_rates RENAME COLUMN acabado TO finish;
ALTER TABLE public.finish_rates RENAME COLUMN actualizado TO updated_at;
ALTER INDEX public.tarifas_acabado_pkey RENAME TO finish_rates_pkey;
ALTER TABLE public.finish_rates RENAME CONSTRAINT tarifas_acabado_factor_check TO finish_rates_factor_check;
ALTER POLICY tarifas_acabado_select_staff ON public.finish_rates RENAME TO finish_rates_select_staff;
ALTER POLICY tarifas_acabado_write_admin ON public.finish_rates RENAME TO finish_rates_write_admin;

-- Apellidos: "_p" y "_m" eran paterno y materno.
ALTER TABLE public.profiles RENAME COLUMN last_name_p TO last_name;
ALTER TABLE public.profiles RENAME COLUMN last_name_m TO second_last_name;
ALTER POLICY profiles_select_propio ON public.profiles RENAME TO profiles_select_own;
ALTER POLICY profiles_update_propio ON public.profiles RENAME TO profiles_update_own;

ALTER POLICY products_select_publico ON public.products RENAME TO products_select_public;

ALTER POLICY orders_select_propias ON public.orders RENAME TO orders_select_own;
ALTER POLICY order_items_select_propias ON public.order_items RENAME TO order_items_select_own;

ALTER TABLE public.custom_requests RENAME COLUMN last_name_p TO last_name;
ALTER TABLE public.custom_requests RENAME COLUMN last_name_m TO second_last_name;
ALTER TABLE public.custom_requests RENAME COLUMN largo_mm TO length_mm;
ALTER TABLE public.custom_requests RENAME COLUMN alto_mm TO height_mm;
ALTER TABLE public.custom_requests RENAME COLUMN profundidad_mm TO depth_mm;
ALTER TABLE public.custom_requests RENAME COLUMN acabado TO finish;
ALTER TABLE public.custom_requests RENAME COLUMN precio_estimado TO estimated_price;
ALTER TABLE public.custom_requests RENAME CONSTRAINT custom_requests_largo_valido TO custom_requests_length_valid;
ALTER TABLE public.custom_requests RENAME CONSTRAINT custom_requests_alto_valido TO custom_requests_height_valid;
ALTER TABLE public.custom_requests RENAME CONSTRAINT custom_requests_profundidad_valida TO custom_requests_depth_valid;
ALTER POLICY custom_requests_insert_publico ON public.custom_requests RENAME TO custom_requests_insert_public;

-- ─── 4. Estado de las solicitudes: de texto libre a enum ───────────────────

ALTER TABLE public.custom_requests ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.custom_requests ALTER COLUMN status TYPE public.request_status USING (
    CASE status
        WHEN 'Contactado' THEN 'contacted'
        WHEN 'En Progreso' THEN 'in_progress'
        WHEN 'Finalizado' THEN 'closed'
        ELSE 'pending'
    END)::public.request_status;
ALTER TABLE public.custom_requests ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE public.custom_requests ALTER COLUMN status SET NOT NULL;

-- ─── 5. Vigencia de las cotizaciones ────────────────────────────────────────
-- Una cotización vale 14 días. Vencida, quien vende la renueva (se recalcula
-- con las tarifas vigentes) antes de convertirla en venta. Cada solicitud se
-- convierte una sola vez: converted_order_id guarda la venta que generó.

ALTER TABLE public.custom_requests
    ADD COLUMN quote_expires_at timestamptz,
    ADD COLUMN converted_order_id bigint UNIQUE REFERENCES public.orders(id) ON DELETE SET NULL;

UPDATE public.custom_requests
   SET quote_expires_at = now() + interval '14 days'
 WHERE status IN ('pending', 'contacted');

-- Quien vende sólo cambia el estado a mano; la vigencia, el precio y la venta
-- vinculada los fijan las funciones del servidor.
REVOKE UPDATE ON public.custom_requests FROM public, anon, authenticated;
GRANT UPDATE (status) ON public.custom_requests TO authenticated;

-- ─── 6. Total derivado ──────────────────────────────────────────────────────

ALTER TABLE public.orders
    ADD CONSTRAINT orders_total_matches CHECK (total = subtotal + tax);

-- Columnas que siempre se llenan (por omisión o por las funciones) y que no
-- tienen sentido vacías: un renglón sin pedido, un pedido sin estado de pago
-- o de proyecto, o una venta o solicitud sin fecha.
ALTER TABLE public.order_items ALTER COLUMN order_id SET NOT NULL;
ALTER TABLE public.orders
    ALTER COLUMN payment_status SET NOT NULL,
    ALTER COLUMN project_status SET NOT NULL,
    ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE public.custom_requests ALTER COLUMN created_at SET NOT NULL;

-- ─── 7. Notas internas de ventas y solicitudes ──────────────────────────────

ALTER TABLE public.notas_pedido RENAME TO notes;
ALTER TABLE public.notes RENAME COLUMN pedido_id TO order_id;
ALTER TABLE public.notes RENAME COLUMN autor_id TO author_id;
ALTER TABLE public.notes RENAME COLUMN autor_nombre TO author_name;
ALTER TABLE public.notes RENAME COLUMN autor_rol TO author_role;
ALTER TABLE public.notes RENAME COLUMN texto TO body;
ALTER TABLE public.notes RENAME COLUMN creado TO created_at;
ALTER SEQUENCE public.notas_pedido_id_seq RENAME TO notes_id_seq;
ALTER INDEX public.notas_pedido_pkey RENAME TO notes_pkey;
DROP INDEX public.notas_pedido_pedido_idx;
ALTER TABLE public.notes RENAME CONSTRAINT notas_pedido_pedido_id_fkey TO notes_order_id_fkey;
ALTER TABLE public.notes RENAME CONSTRAINT notas_pedido_autor_id_fkey TO notes_author_id_fkey;
ALTER TABLE public.notes RENAME CONSTRAINT notas_pedido_texto_check TO notes_body_check;

ALTER TABLE public.notes
    ALTER COLUMN order_id DROP NOT NULL,
    ADD COLUMN request_id uuid REFERENCES public.custom_requests(id) ON DELETE CASCADE,
    ADD CONSTRAINT notes_single_target CHECK (num_nonnulls(order_id, request_id) = 1);

CREATE INDEX notes_order_idx ON public.notes (order_id, created_at) WHERE order_id IS NOT NULL;
CREATE INDEX notes_request_idx ON public.notes (request_id, created_at) WHERE request_id IS NOT NULL;
CREATE INDEX notes_author_idx ON public.notes (author_id);

-- ─── 8. Paquetes (bundles) ──────────────────────────────────────────────────
-- Un paquete es un conjunto de productos con un porcentaje de descuento. La
-- venta guarda el paquete que se aplicó tal como estaba ese día.

CREATE TABLE public.bundles (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name             text NOT NULL UNIQUE CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
    discount_percent numeric(5,2) NOT NULL CHECK (discount_percent > 0 AND discount_percent < 100),
    is_active        boolean NOT NULL DEFAULT false
);

CREATE TABLE public.bundle_items (
    bundle_id  bigint NOT NULL REFERENCES public.bundles(id) ON DELETE CASCADE,
    product_id bigint NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    quantity   integer NOT NULL CHECK (quantity BETWEEN 1 AND 999),
    PRIMARY KEY (bundle_id, product_id)
);

CREATE INDEX bundle_items_product_idx ON public.bundle_items (product_id);

ALTER TABLE public.bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bundle_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bundles, public.bundle_items FROM public, anon, authenticated;
GRANT SELECT ON public.bundles, public.bundle_items TO authenticated;

CREATE POLICY bundles_select_admin ON public.bundles
    FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY bundle_items_select_admin ON public.bundle_items
    FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

ALTER TABLE public.orders
    ADD COLUMN bundle_name text,
    ADD COLUMN bundle_count integer NOT NULL DEFAULT 0,
    ADD COLUMN bundle_discount numeric(12,2) NOT NULL DEFAULT 0,
    ADD CONSTRAINT orders_bundle_snapshot CHECK (
        (bundle_name IS NULL AND bundle_count = 0 AND bundle_discount = 0) OR
        (bundle_name IS NOT NULL AND bundle_count > 0 AND bundle_discount > 0));

-- ─── 9. Funciones ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_project_status(p_order_id bigint, p_status public.project_status) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_current public.project_status;
BEGIN
  SELECT project_status INTO v_current FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido % no existe', p_order_id;
  END IF;

  IF public.is_staff() IS NOT TRUE THEN
    IF public.is_workshop() IS NOT TRUE THEN
      RAISE EXCEPTION 'No tienes permiso para cambiar el estatus del proyecto';
    END IF;
    IF v_current NOT IN ('in_production', 'installed') OR p_status NOT IN ('in_production', 'installed') THEN
      RAISE EXCEPTION 'El taller sólo mueve pedidos entre "En producción" e "Instalado"';
    END IF;
  END IF;

  UPDATE public.orders SET project_status = p_status WHERE id = p_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_price(p_length_mm integer, p_height_mm integer, p_material public.material_type, p_finish public.finish_type) RETURNS numeric
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_area_m2 numeric;
  v_price  numeric;
  v_minimum  numeric;
BEGIN
  IF p_length_mm IS NULL OR p_height_mm IS NULL
     OR p_length_mm <= 0 OR p_height_mm <= 0 THEN
    RETURN NULL;
  END IF;

  v_area_m2 := (p_length_mm::numeric * p_height_mm::numeric) / 1000000.0;

  SELECT tm.price_per_m2 * ta.factor * v_area_m2
    INTO v_price
    FROM public.material_rates tm, public.finish_rates ta
   WHERE tm.material = p_material AND ta.finish = p_finish;

  IF v_price IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT value INTO v_minimum
    FROM public.quote_settings WHERE key = 'minimum_price';

  RETURN ROUND(GREATEST(v_price, COALESCE(v_minimum, 0)), 2);
END;
$$;

CREATE OR REPLACE FUNCTION public.available_bundles() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'discount_percent', c.discount_percent, 'items', items.bundle_lines
  ) ORDER BY c.id), '[]'::jsonb)
  FROM public.bundles c
  CROSS JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('product_id', i.product_id, 'quantity', i.quantity)
      ORDER BY i.product_id) AS bundle_lines
    FROM public.bundle_items i
    JOIN public.products p ON p.id = i.product_id
    WHERE i.bundle_id = c.id
    HAVING count(*) >= 2 AND bool_and(p.is_active IS TRUE AND p.price > 0)
  ) items
  WHERE c.is_active;
$$;

CREATE OR REPLACE FUNCTION public.convert_request_to_sale(p_request_id uuid, p_client jsonb, p_items jsonb, p_payment public.payment_status, p_notes text DEFAULT NULL::text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_request public.custom_requests%ROWTYPE;
  v_order_id bigint;
BEGIN
  IF public.is_staff() IS NOT TRUE THEN
    RAISE EXCEPTION 'Sólo el personal de ventas puede convertir cotizaciones';
  END IF;

  SELECT * INTO v_request FROM public.custom_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status = 'closed' THEN
    RAISE EXCEPTION 'Esta solicitud no se puede convertir';
  END IF;
  IF v_request.converted_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esta solicitud ya se convirtió en la venta #%', v_request.converted_order_id;
  END IF;
  IF v_request.quote_expires_at IS NULL OR v_request.quote_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Actualiza la cotización antes de convertirla en venta';
  END IF;

  v_order_id := public.register_sale(p_client, p_items, p_payment, p_notes);
  UPDATE public.custom_requests
  SET converted_order_id = v_order_id, status = 'in_progress'
  WHERE id = p_request_id;
  RETURN v_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_order_from_cart(p_notes text DEFAULT NULL::text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_profile   public.profiles%ROWTYPE;
  v_tax_rate      numeric;
  v_subtotal numeric;
  v_order_id   bigint;
  v_inactive text;
  v_out_of_stock text;
  v_lines   jsonb;
  v_bundle    record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesión para confirmar tu pedido';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No encontramos tu perfil';
  END IF;

  -- Bloquear los renglones confirmados y tomar una sola lectura del catálogo.
  -- Una segunda confirmación espera el primer pedido y vuelve a leer el carrito.
  WITH cart AS MATERIALIZED (
    SELECT c.product_id, c.qty
    FROM public.cart_items c
    WHERE c.user_id = v_uid
    ORDER BY c.product_id
    FOR UPDATE
  )
  SELECT SUM(p.price * c.qty),
         jsonb_agg(jsonb_build_object('product_id', p.id, 'label', p.name,
                                     'quantity', c.qty, 'price', p.price)),
         string_agg(p.name, ', ') FILTER (WHERE p.is_active IS NOT TRUE),
         string_agg(format('%s (hay %s, pediste %s)', p.name, p.stock, c.qty), '; ')
           FILTER (WHERE c.qty > COALESCE(p.stock, 0))
    INTO v_subtotal, v_lines, v_inactive, v_out_of_stock
    FROM cart c
    JOIN public.products p ON p.id = c.product_id;
  IF v_lines IS NULL THEN
    RAISE EXCEPTION 'Tu carrito está vacío';
  END IF;
  IF v_inactive IS NOT NULL THEN
    RAISE EXCEPTION 'Ya no está disponible: %', v_inactive;
  END IF;
  IF v_out_of_stock IS NOT NULL AND NOT public.allows_backorder() THEN
    RAISE EXCEPTION 'No hay existencias suficientes: %', v_out_of_stock;
  END IF;

  SELECT COALESCE((SELECT value FROM public.quote_settings WHERE key = 'tax_rate'), 0.16)
    INTO v_tax_rate;

  SELECT * INTO v_bundle FROM public.best_bundle(v_lines);
  v_subtotal := v_subtotal - COALESCE(v_bundle.discount, 0);

  INSERT INTO public.orders (
    client_id, subtotal, tax, total,
    payment_status, project_status, notes,
    client_first_name, client_last_name, client_phone, client_email,
    bundle_name, bundle_count, bundle_discount
  ) VALUES (
    v_uid,
    ROUND(v_subtotal, 2),
    ROUND(v_subtotal * v_tax_rate, 2),
    ROUND(v_subtotal, 2) + ROUND(v_subtotal * v_tax_rate, 2),
    -- Nada se ha cobrado todavía: el pago en línea llega después (record_online_payment).
    'pending',
    'quoting',
    p_notes,
    v_profile.first_name, v_profile.last_name, v_profile.phone, v_profile.email,
    v_bundle.name, COALESCE(v_bundle.sets, 0), COALESCE(v_bundle.discount, 0)
  ) RETURNING id INTO v_order_id;

  -- custom_label guarda el nombre tal como estaba al comprar: si el producto
  -- se renombra después, el pedido histórico no cambia.
  INSERT INTO public.order_items (order_id, product_id, custom_label, quantity, unit_price)
  SELECT v_order_id, l.product_id, l.label, l.quantity, l.price
  FROM jsonb_to_recordset(v_lines) AS l(product_id bigint, label text, quantity integer, price numeric);

  DELETE FROM public.cart_items c
  USING jsonb_to_recordset(v_lines) AS l(product_id bigint)
  WHERE c.user_id = v_uid AND c.product_id = l.product_id;

  -- NOTA: no se descuenta products.stock. El pedido nace en 'quoting' y sin
  -- pago, así que todavía no es una venta firme; descontar aquí bloquearía
  -- inventario por pedidos que pueden no concretarse. El descuento pertenece
  -- al momento en que se confirma el pago (Mejora 2).
  RETURN v_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS public.user_role
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.staff_without_mfa() RETURNS TABLE(id uuid, email text, first_name text, last_name text, role public.user_role)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF public.is_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'Sólo un administrador con segundo factor puede consultar esto';
  END IF;

  RETURN QUERY
    SELECT p.id, p.email, p.first_name, p.last_name, p.role
      FROM public.profiles p
     WHERE p.role IN ('workshop', 'seller', 'admin')
       AND NOT EXISTS (
             SELECT 1 FROM auth.mfa_factors f
              WHERE f.user_id = p.id AND f.status = 'verified')
     ORDER BY p.role DESC, p.last_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_workshop() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(
           public.is_mfa_verified()
             AND public.current_user_role() = 'workshop',
           false);
$$;

CREATE OR REPLACE FUNCTION public.set_quote_expiry() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  NEW.quote_expires_at := now() + interval '14 days';
  NEW.converted_order_id := NULL;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_employee_username() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.role IN ('seller', 'admin') THEN
    NEW.username := LOWER(NEW.first_name) || '.' || LOWER(NEW.last_name);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_bundle(p_id bigint, p_name text, p_discount_percent numeric, p_is_active boolean, p_items jsonb) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_id bigint;
BEGIN
  IF public.is_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'Sólo un administrador puede gestionar paquetes';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Elige los productos del paquete';
  END IF;
  IF jsonb_array_length(p_items) < 2 THEN
    RAISE EXCEPTION 'El paquete necesita por lo menos dos productos distintos';
  END IF;
  IF (SELECT count(DISTINCT i.product_id) FROM jsonb_to_recordset(p_items) AS i(product_id bigint)) <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'Cada producto va una sola vez en el paquete';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.bundles (name, discount_percent, is_active)
    VALUES (btrim(p_name), p_discount_percent, p_is_active) RETURNING id INTO v_id;
  ELSE
    UPDATE public.bundles
    SET name = btrim(p_name), discount_percent = p_discount_percent, is_active = p_is_active
    WHERE id = p_id RETURNING id INTO v_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El paquete ya no existe';
    END IF;
    DELETE FROM public.bundle_items WHERE bundle_id = v_id;
  END IF;

  INSERT INTO public.bundle_items (bundle_id, product_id, quantity)
    SELECT v_id, i.product_id, i.quantity
    FROM jsonb_to_recordset(p_items) AS i(product_id bigint, quantity integer);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (
    id, first_name, middle_name, last_name, second_last_name, email, phone, role
  ) VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'first_name', 'Sin Nombre'),
    new.raw_user_meta_data->>'middle_name',
    COALESCE(new.raw_user_meta_data->>'last_name', 'Sin Apellido'),
    new.raw_user_meta_data->>'second_last_name',
    new.email,
    new.raw_user_meta_data->>'phone',
    -- Siempre 'customer'. Ascender a seller/admin es una acción
    -- deliberada de un admin, nunca algo que el registro decida.
    'customer'::public.user_role
  );
  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(
           public.is_mfa_verified()
             AND public.current_user_role() = 'admin',
           false);
$$;

CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(
           public.is_mfa_verified()
             AND public.current_user_role() IN ('seller', 'admin'),
           false);
$$;

CREATE OR REPLACE FUNCTION public.best_bundle(p_lines jsonb) RETURNS TABLE(name text, sets integer, discount numeric)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  WITH quantities AS (
    SELECT l.product_id, sum(l.quantity) AS quantity, max(l.price) AS price
    FROM jsonb_to_recordset(p_lines) AS l(product_id bigint, quantity integer, price numeric)
    WHERE l.product_id IS NOT NULL AND l.price > 0
    GROUP BY l.product_id
  ),
  candidates AS (
    SELECT c.id, c.name,
           min(q.quantity / i.quantity)::integer AS sets,
           round(sum(q.price * i.quantity) * min(q.quantity / i.quantity) * c.discount_percent / 100, 2) AS discount
    FROM public.bundles c
    JOIN public.bundle_items i ON i.bundle_id = c.id
    JOIN public.products p ON p.id = i.product_id
    LEFT JOIN quantities q ON q.product_id = i.product_id
    WHERE c.is_active
    GROUP BY c.id
    HAVING count(*) >= 2
      AND bool_and(p.is_active IS TRUE AND q.quantity IS NOT NULL AND q.quantity >= i.quantity)
  )
  SELECT c.name, c.sets, c.discount
  FROM candidates c
  WHERE c.discount > 0
  ORDER BY c.discount DESC, c.id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.allows_backorder() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE((SELECT value FROM public.quote_settings
                    WHERE key = 'allow_backorder'), 0) = 1;
$$;

CREATE OR REPLACE FUNCTION public.prevent_role_self_escalation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF auth.uid() IS NOT NULL AND public.is_admin() IS NOT TRUE THEN
      RAISE EXCEPTION 'No tienes permiso para cambiar el rol de un usuario';
    END IF;
    IF auth.uid() IS NOT NULL AND OLD.role = 'admin' THEN
      IF OLD.id = auth.uid() THEN
        RAISE EXCEPTION 'No puedes quitarte a ti mismo el rol de administrador';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin' AND id <> OLD.id) THEN
        RAISE EXCEPTION 'Debe quedar al menos un administrador';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_order() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.is_admin() IS NOT TRUE
     AND (NEW.subtotal IS DISTINCT FROM OLD.subtotal OR NEW.tax IS DISTINCT FROM OLD.tax
          OR NEW.total IS DISTINCT FROM OLD.total
          OR NEW.bundle_name IS DISTINCT FROM OLD.bundle_name
          OR NEW.bundle_count IS DISTINCT FROM OLD.bundle_count
          OR NEW.bundle_discount IS DISTINCT FROM OLD.bundle_discount
          OR NEW.seller_id IS DISTINCT FROM OLD.seller_id
          OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
    RAISE EXCEPTION 'Sólo un administrador puede cambiar los importes, el vendedor o el cliente de una venta';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_product() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.is_admin() IS NOT TRUE
     AND (NEW.price IS DISTINCT FROM OLD.price OR NEW.name IS DISTINCT FROM OLD.name) THEN
    RAISE EXCEPTION 'Sólo un administrador puede cambiar el nombre o el precio de un producto';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_online_payment(p_order_id bigint, p_session_id text, p_amount numeric, p_currency text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  -- FOR UPDATE: dos avisos simultáneos del mismo pedido esperan su turno, así
  -- que el segundo ve el estado que dejó el primero.
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido % no existe', p_order_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.payments WHERE session_id = p_session_id) THEN
    RETURN 'repeated';
  END IF;

  -- El monto lo fijó create-payment a partir de orders.total. Si no coincide, algo
  -- cambió el pedido entre el cobro y el aviso, o el aviso no es de este
  -- pedido. Fallar hace que Stripe reintente y que el error se vea en su
  -- panel, en vez de marcar pagado un pedido que no lo está.
  IF lower(p_currency) <> 'mxn' OR p_amount <> v_order.total THEN
    RAISE EXCEPTION 'El pago (% %) no coincide con el total del pedido % (% mxn)',
      p_amount, p_currency, p_order_id, v_order.total;
  END IF;

  IF v_order.payment_status = 'paid' THEN
    INSERT INTO public.payments (order_id, session_id, amount, currency, is_duplicate)
    VALUES (p_order_id, p_session_id, p_amount, lower(p_currency), true);
    RETURN 'duplicate';
  END IF;

  INSERT INTO public.payments (order_id, session_id, amount, currency)
  VALUES (p_order_id, p_session_id, p_amount, lower(p_currency));

  UPDATE public.orders SET payment_status = 'paid' WHERE id = p_order_id;

  -- Sin bajar de cero: si el inventario cambió desde el checkout, el cobro ya
  -- ocurrió y el pedido se atiende igual; el personal ve el stock en 0.
  UPDATE public.products p
     SET stock = GREATEST(COALESCE(p.stock, 0) - oi.quantity, 0)
    FROM public.order_items oi
   WHERE oi.order_id = p_order_id AND oi.product_id = p.id;

  RETURN 'paid';
END;
$$;

CREATE OR REPLACE FUNCTION public.register_sale(p_client jsonb, p_items jsonb, p_payment public.payment_status, p_notes text DEFAULT NULL::text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_tax_rate      numeric;
  v_subtotal numeric := 0;
  v_lines   jsonb := '[]'::jsonb;
  v_catalog jsonb;
  v_order_id   bigint;
  v_bundle    record;
  c          jsonb;
  v_product_id bigint;
  v_name   text;
  v_price   numeric;
  v_quantity integer;
BEGIN
  IF public.is_staff() IS NOT TRUE THEN
    RAISE EXCEPTION 'Sólo el personal de ventas puede registrar ventas';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta no tiene conceptos';
  END IF;

  SELECT jsonb_object_agg(p.id, jsonb_build_object('name', p.name, 'price', p.price))
    INTO v_catalog
    FROM public.products p
    WHERE p.id IN (SELECT NULLIF(i->>'product_id', '')::bigint FROM jsonb_array_elements(p_items) i);

  FOR c IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_quantity := COALESCE(NULLIF(c->>'quantity', '')::integer, 1);
    IF v_quantity < 1 OR v_quantity > 999 THEN
      RAISE EXCEPTION 'Cantidad inválida: %', v_quantity;
    END IF;
    v_product_id := NULLIF(c->>'product_id', '')::bigint;
    IF v_product_id IS NOT NULL THEN
      -- Del catálogo: nombre y precio de la tabla, diga lo que diga el navegador.
      v_name := v_catalog -> v_product_id::text ->> 'name';
      v_price := (v_catalog -> v_product_id::text ->> 'price')::numeric;
      IF v_name IS NULL THEN
        RAISE EXCEPTION 'El producto % no existe', v_product_id;
      END IF;
    ELSE
      -- Concepto libre (trabajo a la medida): lo fija quien vende.
      v_name := NULLIF(trim(c->>'label'), '');
      v_price := NULLIF(c->>'price', '')::numeric;
      IF v_name IS NULL OR v_price IS NULL OR v_price <= 0 THEN
        RAISE EXCEPTION 'Un concepto libre necesita descripción y un precio mayor que cero';
      END IF;
    END IF;
    v_subtotal := v_subtotal + v_price * v_quantity;
    v_lines := v_lines || jsonb_build_object('product_id', v_product_id, 'label', v_name,
                                               'quantity', v_quantity, 'price', v_price);
  END LOOP;

  SELECT COALESCE((SELECT value FROM public.quote_settings WHERE key = 'tax_rate'), 0.16) INTO v_tax_rate;

  SELECT * INTO v_bundle FROM public.best_bundle(v_lines);
  v_subtotal := v_subtotal - COALESCE(v_bundle.discount, 0);

  INSERT INTO public.orders (seller_id, client_first_name, client_last_name, client_phone, client_email,
                             subtotal, tax, total, payment_status, project_status, notes,
                             bundle_name, bundle_count, bundle_discount)
  -- Sin nombre es venta de mostrador: "Público general", como el ticket.
  VALUES (auth.uid(), COALESCE(NULLIF(trim(p_client->>'name'), ''), 'Público general'), NULLIF(trim(p_client->>'last_name'), ''),
          NULLIF(trim(p_client->>'phone'), ''), NULLIF(trim(p_client->>'email'), ''),
          ROUND(v_subtotal, 2), ROUND(v_subtotal * v_tax_rate, 2), ROUND(v_subtotal, 2) + ROUND(v_subtotal * v_tax_rate, 2),
          p_payment, 'quoting', NULLIF(trim(p_notes), ''),
          v_bundle.name, COALESCE(v_bundle.sets, 0), COALESCE(v_bundle.discount, 0))
  RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (order_id, product_id, custom_label, quantity, unit_price)
  SELECT v_order_id, (l->>'product_id')::bigint, l->>'label', (l->>'quantity')::integer, (l->>'price')::numeric
    FROM jsonb_array_elements(v_lines) l;

  RETURN v_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_quote(p_request_id uuid) RETURNS TABLE(quote_expires_at timestamp with time zone, estimated_price numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_request public.custom_requests%ROWTYPE;
BEGIN
  IF public.is_staff() IS NOT TRUE THEN
    RAISE EXCEPTION 'Sólo el personal de ventas puede renovar cotizaciones';
  END IF;

  SELECT * INTO v_request FROM public.custom_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.converted_order_id IS NOT NULL OR v_request.status = 'closed' THEN
    RAISE EXCEPTION 'Esta solicitud no se puede renovar';
  END IF;

  RETURN QUERY
    UPDATE public.custom_requests AS s
    SET quote_expires_at = clock_timestamp() + interval '14 days',
        estimated_price = public.calculate_price(s.length_mm, s.height_mm, s.material, s.finish)
    WHERE s.id = p_request_id
    RETURNING s.quote_expires_at, s.estimated_price;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_mfa_verified() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  -- COALESCE: una petición anónima no trae JWT y auth.jwt() devuelve NULL.
  -- Sin esto is_staff() devolvería NULL en vez de false, y NULL en un USING
  -- de RLS no concede acceso pero sí ensucia el razonamiento.
  SELECT COALESCE(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

CREATE OR REPLACE FUNCTION public.set_estimated_price() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.estimated_price := public.calculate_price(
    NEW.length_mm, NEW.height_mm, NEW.material, NEW.finish);
  RETURN NEW;
END;
$$;

-- Notas internas: se escriben sólo por aquí, que fija autor y fecha. El
-- taller anota únicamente los pedidos que ve (en producción o instalados);
-- quien vende anota cualquier venta o solicitud.
CREATE FUNCTION public.add_note(p_body text, p_order_id bigint DEFAULT NULL, p_request_id uuid DEFAULT NULL)
    RETURNS public.notes
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
    AS $$
DECLARE
  v_body   text := btrim(COALESCE(p_body, ''));
  v_status public.project_status;
  v_note   public.notes;
BEGIN
  IF public.is_staff() IS NOT TRUE AND public.is_workshop() IS NOT TRUE THEN
    RAISE EXCEPTION 'Sólo el personal puede dejar notas';
  END IF;
  IF num_nonnulls(p_order_id, p_request_id) <> 1 THEN
    RAISE EXCEPTION 'La nota va en una venta o en una solicitud, no en ambas';
  END IF;
  IF v_body = '' THEN
    RAISE EXCEPTION 'La nota está vacía';
  END IF;
  IF char_length(v_body) > 1000 THEN
    RAISE EXCEPTION 'La nota es demasiado larga (máximo 1000 caracteres)';
  END IF;

  IF p_order_id IS NOT NULL THEN
    SELECT project_status INTO v_status FROM public.orders WHERE id = p_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El pedido % no existe', p_order_id;
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.custom_requests WHERE id = p_request_id) THEN
    RAISE EXCEPTION 'La solicitud no existe';
  END IF;

  IF public.is_staff() IS NOT TRUE
     AND (p_order_id IS NULL OR v_status NOT IN ('in_production', 'installed')) THEN
    RAISE EXCEPTION 'El taller sólo anota pedidos en producción o instalados';
  END IF;

  INSERT INTO public.notes (order_id, request_id, author_id, author_name, author_role, body)
  SELECT p_order_id, p_request_id, p.id,
         COALESCE(NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email),
         p.role, v_body
    FROM public.profiles p
   WHERE p.id = auth.uid()
  RETURNING * INTO v_note;

  IF v_note.id IS NULL THEN
    RAISE EXCEPTION 'No encontramos tu perfil';
  END IF;
  RETURN v_note;
END;
$$;

-- El taller no lee orders (tiene importes y pagos): recibe aquí sólo lo que
-- necesita para fabricar e instalar, con la bitácora de cada pedido.
CREATE FUNCTION public.workshop_orders()
    RETURNS TABLE (id bigint, created_at timestamptz, status public.project_status,
                   client text, phone text, notes text, items jsonb, internal_notes jsonb)
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
    AS $$
BEGIN
  IF public.is_workshop() IS NOT TRUE AND public.is_staff() IS NOT TRUE THEN
    RAISE EXCEPTION 'Sólo el personal puede ver los pedidos de producción';
  END IF;

  RETURN QUERY
    SELECT o.id, o.created_at, o.project_status,
           trim(concat_ws(' ', o.client_first_name, o.client_last_name)),
           o.client_phone, o.notes,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('label', i.custom_label, 'quantity', i.quantity) ORDER BY i.id)
                       FROM public.order_items i WHERE i.order_id = o.id), '[]'::jsonb),
           COALESCE((SELECT jsonb_agg(jsonb_build_object('author_name', n.author_name, 'author_role', n.author_role,
                                                         'body', n.body, 'created_at', n.created_at) ORDER BY n.id)
                       FROM public.notes n WHERE n.order_id = o.id), '[]'::jsonb)
      FROM public.orders o
     WHERE o.project_status = 'in_production'
        OR o.id IN (SELECT x.id FROM public.orders x WHERE x.project_status = 'installed'
                     ORDER BY x.id DESC LIMIT 15)
     ORDER BY (o.project_status = 'installed'), o.id;
END;
$$;

-- ─── 10. Permisos de las funciones ──────────────────────────────────────────

REVOKE ALL ON FUNCTION
    public.add_note(text, bigint, uuid),
    public.set_project_status(bigint, public.project_status),
    public.calculate_price(integer, integer, public.material_type, public.finish_type),
    public.available_bundles(),
    public.convert_request_to_sale(uuid, jsonb, jsonb, public.payment_status, text),
    public.create_order_from_cart(text),
    public.staff_without_mfa(),
    public.is_workshop(),
    public.set_quote_expiry(),
    public.save_bundle(bigint, text, numeric, boolean, jsonb),
    public.best_bundle(jsonb),
    public.workshop_orders(),
    public.allows_backorder(),
    public.protect_order(),
    public.protect_product(),
    public.record_online_payment(bigint, text, numeric, text),
    public.register_sale(jsonb, jsonb, public.payment_status, text),
    public.renew_quote(uuid),
    public.set_estimated_price()
  FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.add_note(text, bigint, uuid),
    public.set_project_status(bigint, public.project_status),
    public.convert_request_to_sale(uuid, jsonb, jsonb, public.payment_status, text),
    public.create_order_from_cart(text),
    public.staff_without_mfa(),
    public.is_workshop(),
    public.save_bundle(bigint, text, numeric, boolean, jsonb),
    public.workshop_orders(),
    public.register_sale(jsonb, jsonb, public.payment_status, text),
    public.renew_quote(uuid)
  TO authenticated;

-- El cotizador y el catálogo públicos los usan sin sesión.
GRANT EXECUTE ON FUNCTION
    public.calculate_price(integer, integer, public.material_type, public.finish_type),
    public.available_bundles(),
    public.allows_backorder()
  TO anon, authenticated;

-- record_online_payment sólo lo llama el servidor (el webhook de Stripe).
GRANT EXECUTE ON FUNCTION public.record_online_payment(bigint, text, numeric, text) TO service_role;

-- ─── 11. Disparadores ───────────────────────────────────────────────────────

CREATE TRIGGER tr_set_estimated_price
    BEFORE INSERT OR UPDATE OF length_mm, height_mm, material, finish ON public.custom_requests
    FOR EACH ROW EXECUTE FUNCTION public.set_estimated_price();

CREATE TRIGGER tr_set_quote_expiry
    BEFORE INSERT ON public.custom_requests
    FOR EACH ROW EXECUTE FUNCTION public.set_quote_expiry();

CREATE TRIGGER tr_protect_product
    BEFORE UPDATE ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.protect_product();

CREATE TRIGGER tr_protect_order
    BEFORE UPDATE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.protect_order();

-- ─── 12. Quién lee las notas ────────────────────────────────────────────────
-- Sólo quien vende las lee directo. El taller las recibe por workshop_orders(),
-- y únicamente las de los pedidos que ve: antes podía leer la tabla completa,
-- incluidas las notas de ventas que todavía no llegan a producción.

CREATE POLICY notes_select_staff ON public.notes
    FOR SELECT TO authenticated USING ((SELECT public.is_staff()));
