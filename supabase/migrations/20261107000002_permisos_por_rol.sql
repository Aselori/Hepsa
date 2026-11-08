-- ============================================================================
-- PERMISOS POR ROL: que cliente, taller, vendedor y admin sean de verdad
-- distintos, y que la base lo imponga (el panel sólo decide qué se dibuja).
--
--   cliente   sólo lo suyo (sin cambios).
--   taller    ve qué fabricar o instalar y avanza el estatus del proyecto;
--             no ve precios, pagos ni el catálogo del personal.
--   vendedor  vende, cobra, atiende solicitudes, ajusta existencias y fotos;
--             no cambia precios ni nombres, no da de alta ni borra productos,
--             no toca importes de una venta ya registrada.
--   admin     todo lo anterior, más precios, equipo y configuración; no puede
--             dejar el sistema sin administrador ni quitarse el rol a sí mismo.
--
-- Todo exige segundo factor (aal2), como el resto del personal.
-- ============================================================================

-- ─── Taller ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.es_taller() RETURNS boolean
    LANGUAGE sql STABLE SET search_path = public
    AS $$
  SELECT COALESCE(
           public.segundo_factor_verificado()
             AND public.current_user_role() = 'taller',
           false);
$$;

REVOKE ALL ON FUNCTION public.es_taller() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.es_taller() TO authenticated;

-- El taller no lee orders ni order_items directamente: RLS no puede esconder
-- columnas, y esas tablas tienen precios y pagos. Lee por esta función, que
-- devuelve sólo lo necesario para fabricar e instalar.
CREATE OR REPLACE FUNCTION public.pedidos_de_taller()
    RETURNS TABLE (id bigint, creado timestamptz, estado public.project_status,
                   cliente text, telefono text, notas text, conceptos jsonb)
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
    AS $$
BEGIN
  IF public.es_taller() IS NOT TRUE AND public.is_staff() IS NOT TRUE THEN
    RAISE EXCEPTION 'Sólo el personal puede ver los pedidos de producción';
  END IF;

  RETURN QUERY
    SELECT o.id, o.created_at, o.project_status,
           trim(concat_ws(' ', o.client_first_name, o.client_last_name)),
           o.client_phone, o.notes,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('concepto', i.custom_label, 'cantidad', i.quantity) ORDER BY i.id)
                       FROM public.order_items i WHERE i.order_id = o.id), '[]'::jsonb)
      FROM public.orders o
     WHERE o.project_status = 'en_produccion'
        OR o.id IN (SELECT x.id FROM public.orders x WHERE x.project_status = 'instalado'
                     ORDER BY x.id DESC LIMIT 15)
     ORDER BY (o.project_status = 'instalado'), o.id;
END;
$$;

REVOKE ALL ON FUNCTION public.pedidos_de_taller() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pedidos_de_taller() TO authenticated;

-- El taller sólo mueve el proyecto entre "en producción" e "instalado": decidir
-- que algo pasa a producción (o regresa a cotización) es de quien vende.
CREATE OR REPLACE FUNCTION public.avanzar_proyecto(p_pedido bigint, p_estado public.project_status)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
    AS $$
DECLARE
  v_actual public.project_status;
BEGIN
  SELECT project_status INTO v_actual FROM public.orders WHERE id = p_pedido FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido % no existe', p_pedido;
  END IF;

  IF public.is_staff() IS NOT TRUE THEN
    IF public.es_taller() IS NOT TRUE THEN
      RAISE EXCEPTION 'No tienes permiso para cambiar el estatus del proyecto';
    END IF;
    IF v_actual NOT IN ('en_produccion', 'instalado') OR p_estado NOT IN ('en_produccion', 'instalado') THEN
      RAISE EXCEPTION 'El taller sólo mueve pedidos entre "En producción" e "Instalado"';
    END IF;
  END IF;

  UPDATE public.orders SET project_status = p_estado WHERE id = p_pedido;
END;
$$;

REVOKE ALL ON FUNCTION public.avanzar_proyecto(bigint, public.project_status) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.avanzar_proyecto(bigint, public.project_status) TO authenticated;

-- ─── Catálogo: el vendedor ajusta, el admin decide ──────────────────────────

DROP POLICY IF EXISTS "products_insert_staff" ON public.products;
CREATE POLICY "products_insert_admin" ON public.products
    FOR INSERT TO authenticated WITH CHECK (public.is_admin());

-- products_update_staff sigue: el vendedor cambia existencias, foto,
-- descripción y visibilidad. Nombre y precio quedan para el admin. auth.uid()
-- nulo = servidor (registrar_pago_en_linea descuenta stock, scripts de datos).
CREATE OR REPLACE FUNCTION public.proteger_producto() RETURNS trigger
    LANGUAGE plpgsql SET search_path = public
    AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.is_admin() IS NOT TRUE
     AND (NEW.price IS DISTINCT FROM OLD.price OR NEW.name IS DISTINCT FROM OLD.name) THEN
    RAISE EXCEPTION 'Sólo un administrador puede cambiar el nombre o el precio de un producto';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.proteger_producto() FROM public, anon, authenticated;

CREATE TRIGGER tr_proteger_producto
    BEFORE UPDATE ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.proteger_producto();

-- ─── Ventas: se registran en el servidor ────────────────────────────────────
-- Antes el punto de venta insertaba la orden con subtotal, IVA y total
-- calculados en el navegador (hallazgo F03) y sin vendedor. Ahora sólo se
-- puede vender por registrar_venta(): el precio de un producto sale de la
-- tabla, el IVA de parametros_cotizacion y seller_id de la sesión.

DROP POLICY IF EXISTS "orders_insert_staff" ON public.orders;
DROP POLICY IF EXISTS "order_items_insert_staff" ON public.order_items;
DROP POLICY IF EXISTS "order_items_update_staff" ON public.order_items;
CREATE POLICY "order_items_update_admin" ON public.order_items
    FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.registrar_venta(
    p_cliente jsonb, p_conceptos jsonb, p_pago public.payment_status, p_notas text DEFAULT NULL)
    RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
    AS $$
DECLARE
  v_iva      numeric;
  v_subtotal numeric := 0;
  v_lineas   jsonb := '[]'::jsonb;
  v_pedido   bigint;
  c          jsonb;
  v_producto bigint;
  v_nombre   text;
  v_precio   numeric;
  v_cantidad integer;
BEGIN
  IF public.is_staff() IS NOT TRUE THEN
    RAISE EXCEPTION 'Sólo el personal de ventas puede registrar ventas';
  END IF;
  IF jsonb_typeof(p_conceptos) IS DISTINCT FROM 'array' OR jsonb_array_length(p_conceptos) = 0 THEN
    RAISE EXCEPTION 'La venta no tiene conceptos';
  END IF;

  FOR c IN SELECT * FROM jsonb_array_elements(p_conceptos) LOOP
    v_cantidad := COALESCE(NULLIF(c->>'cantidad', '')::integer, 1);
    IF v_cantidad < 1 OR v_cantidad > 999 THEN
      RAISE EXCEPTION 'Cantidad inválida: %', v_cantidad;
    END IF;
    v_producto := NULLIF(c->>'producto_id', '')::bigint;
    IF v_producto IS NOT NULL THEN
      -- Del catálogo: nombre y precio de la tabla, diga lo que diga el navegador.
      SELECT name, price INTO v_nombre, v_precio FROM public.products WHERE id = v_producto;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'El producto % no existe', v_producto;
      END IF;
    ELSE
      -- Concepto libre (trabajo a la medida): lo fija quien vende.
      v_nombre := NULLIF(trim(c->>'concepto'), '');
      v_precio := NULLIF(c->>'precio', '')::numeric;
      IF v_nombre IS NULL OR v_precio IS NULL OR v_precio <= 0 THEN
        RAISE EXCEPTION 'Un concepto libre necesita descripción y un precio mayor que cero';
      END IF;
    END IF;
    v_subtotal := v_subtotal + v_precio * v_cantidad;
    v_lineas := v_lineas || jsonb_build_object('producto_id', v_producto, 'concepto', v_nombre,
                                               'cantidad', v_cantidad, 'precio', v_precio);
  END LOOP;

  SELECT COALESCE((SELECT valor FROM public.parametros_cotizacion WHERE clave = 'iva'), 0.16) INTO v_iva;

  INSERT INTO public.orders (seller_id, client_first_name, client_last_name, client_phone, client_email,
                             subtotal, tax, total, payment_status, project_status, notes)
  -- Sin nombre es venta de mostrador: "Público general", como el ticket.
  VALUES (auth.uid(), COALESCE(NULLIF(trim(p_cliente->>'nombre'), ''), 'Público general'), NULLIF(trim(p_cliente->>'apellidos'), ''),
          NULLIF(trim(p_cliente->>'telefono'), ''), NULLIF(trim(p_cliente->>'correo'), ''),
          ROUND(v_subtotal, 2), ROUND(v_subtotal * v_iva, 2), ROUND(v_subtotal * (1 + v_iva), 2),
          p_pago, 'cotizando', NULLIF(trim(p_notas), ''))
  RETURNING id INTO v_pedido;

  INSERT INTO public.order_items (order_id, product_id, custom_label, quantity, unit_price)
  SELECT v_pedido, (l->>'producto_id')::bigint, l->>'concepto', (l->>'cantidad')::integer, (l->>'precio')::numeric
    FROM jsonb_array_elements(v_lineas) l;

  RETURN v_pedido;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_venta(jsonb, jsonb, public.payment_status, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.registrar_venta(jsonb, jsonb, public.payment_status, text) TO authenticated;

-- Una venta registrada conserva sus importes, su vendedor y su cliente: el
-- vendedor cambia pago y estatus, pero no lo que se cobró ni a quién.
CREATE OR REPLACE FUNCTION public.proteger_pedido() RETURNS trigger
    LANGUAGE plpgsql SET search_path = public
    AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.is_admin() IS NOT TRUE
     AND (NEW.subtotal IS DISTINCT FROM OLD.subtotal OR NEW.tax IS DISTINCT FROM OLD.tax
          OR NEW.total IS DISTINCT FROM OLD.total OR NEW.seller_id IS DISTINCT FROM OLD.seller_id
          OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
    RAISE EXCEPTION 'Sólo un administrador puede cambiar los importes, el vendedor o el cliente de una venta';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.proteger_pedido() FROM public, anon, authenticated;

CREATE TRIGGER tr_proteger_pedido
    BEFORE UPDATE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.proteger_pedido();

-- ─── Equipo: siempre queda un administrador ─────────────────────────────────
-- Sólo cuando lo pide una sesión (auth.uid() no nulo): el script de
-- recuperación del segundo factor, con la llave de servicio, debe poder bajar
-- el rol de un admin comprometido aunque sea el único.

CREATE OR REPLACE FUNCTION public.prevent_role_self_escalation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = public
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

-- empleados_sin_segundo_factor también cuenta al taller.
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
     WHERE p.role IN ('taller', 'vendedor', 'admin')
       AND NOT EXISTS (
             SELECT 1 FROM auth.mfa_factors f
              WHERE f.user_id = p.id AND f.status = 'verified')
     ORDER BY p.role DESC, p.last_name_p;
END;
$$;

-- ─── Mensaje del ticket, guardado en la base ────────────────────────────────
-- parametros_cotizacion sólo guardaba números; el pie del ticket es texto.

ALTER TABLE public.parametros_cotizacion ADD COLUMN IF NOT EXISTS texto text;

INSERT INTO public.parametros_cotizacion (clave, valor, nota, texto) VALUES
  ('mensaje_ticket', 0, 'Pie del ticket del punto de venta (en texto; valor sin uso).',
   'Este documento ampara su pedido. Garantía HEPSA.')
ON CONFLICT (clave) DO NOTHING;
