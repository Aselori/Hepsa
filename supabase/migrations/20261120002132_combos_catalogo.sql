CREATE TABLE public.combos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre text NOT NULL CHECK (char_length(btrim(nombre)) BETWEEN 1 AND 80),
  porcentaje numeric(5,2) NOT NULL CHECK (porcentaje > 0 AND porcentaje < 100),
  activo boolean NOT NULL DEFAULT false
);

CREATE TABLE public.combo_items (
  combo_id bigint NOT NULL REFERENCES public.combos(id) ON DELETE CASCADE,
  producto_id bigint NOT NULL REFERENCES public.products(id),
  cantidad integer NOT NULL CHECK (cantidad BETWEEN 1 AND 999),
  PRIMARY KEY (combo_id, producto_id)
);

CREATE INDEX combo_items_producto_idx ON public.combo_items (producto_id);
ALTER TABLE public.combos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.combo_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.combos, public.combo_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.combos, public.combo_items TO authenticated;
CREATE POLICY combos_admin_select ON public.combos
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY combo_items_admin_select ON public.combo_items
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

ALTER TABLE public.orders
  ADD COLUMN combo_name text,
  ADD COLUMN combo_count integer NOT NULL DEFAULT 0,
  ADD COLUMN combo_discount numeric(12,2) NOT NULL DEFAULT 0,
  ADD CONSTRAINT orders_combo_snapshot CHECK (
    (combo_name IS NULL AND combo_count = 0 AND combo_discount = 0) OR
    (combo_name IS NOT NULL AND combo_count > 0 AND combo_discount > 0)
  );

CREATE FUNCTION public.guardar_combo(
  p_id bigint, p_nombre text, p_porcentaje numeric, p_activo boolean, p_items jsonb
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF public.is_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'Sólo un administrador puede gestionar combos';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Elige los productos del combo';
  END IF;
  IF jsonb_array_length(p_items) < 2 THEN
    RAISE EXCEPTION 'El combo necesita por lo menos dos productos distintos';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.combos (nombre, porcentaje, activo)
    VALUES (btrim(p_nombre), p_porcentaje, p_activo) RETURNING id INTO v_id;
  ELSE
    UPDATE public.combos
    SET nombre = btrim(p_nombre), porcentaje = p_porcentaje, activo = p_activo
    WHERE id = p_id RETURNING id INTO v_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El combo ya no existe';
    END IF;
    DELETE FROM public.combo_items WHERE combo_id = v_id;
  END IF;

  INSERT INTO public.combo_items (combo_id, producto_id, cantidad)
    SELECT v_id, i.producto_id, i.cantidad
    FROM jsonb_to_recordset(p_items) AS i(producto_id bigint, cantidad integer);
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.guardar_combo(bigint, text, numeric, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_combo(bigint, text, numeric, boolean, jsonb) TO authenticated;

CREATE FUNCTION public.combos_disponibles()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id, 'nombre', c.nombre, 'porcentaje', c.porcentaje, 'items', items.articulos
  ) ORDER BY c.id), '[]'::jsonb)
  FROM public.combos c
  CROSS JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('producto_id', i.producto_id, 'cantidad', i.cantidad)
      ORDER BY i.producto_id) AS articulos
    FROM public.combo_items i
    JOIN public.products p ON p.id = i.producto_id
    WHERE i.combo_id = c.id
    HAVING count(*) >= 2 AND bool_and(p.is_active IS TRUE AND p.price > 0)
  ) items
  WHERE c.activo;
$$;

REVOKE ALL ON FUNCTION public.combos_disponibles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.combos_disponibles() TO anon, authenticated;

-- Recibe renglones ya valorados por PostgreSQL desde las dos rutas de venta.
CREATE FUNCTION public.mejor_combo(p_lineas jsonb)
RETURNS TABLE (nombre text, juegos integer, descuento numeric)
LANGUAGE sql STABLE SET search_path = ''
AS $$
  WITH cantidades AS (
    SELECT l.producto_id, sum(l.cantidad) AS cantidad, max(l.precio) AS precio
    FROM jsonb_to_recordset(p_lineas) AS l(producto_id bigint, cantidad integer, precio numeric)
    WHERE l.producto_id IS NOT NULL AND l.precio > 0
    GROUP BY l.producto_id
  ),
  candidatos AS (
    SELECT c.id, c.nombre,
           min(q.cantidad / i.cantidad)::integer AS juegos,
           round(sum(q.precio * i.cantidad) * min(q.cantidad / i.cantidad) * c.porcentaje / 100, 2) AS descuento
    FROM public.combos c
    JOIN public.combo_items i ON i.combo_id = c.id
    JOIN public.products p ON p.id = i.producto_id
    LEFT JOIN cantidades q ON q.producto_id = i.producto_id
    WHERE c.activo
    GROUP BY c.id
    HAVING count(*) >= 2
      AND bool_and(p.is_active IS TRUE AND q.cantidad IS NOT NULL AND q.cantidad >= i.cantidad)
  )
  SELECT c.nombre, c.juegos, c.descuento
  FROM candidatos c
  WHERE c.descuento > 0
  ORDER BY c.descuento DESC, c.id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.mejor_combo(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crear_pedido_desde_carrito(p_notas text DEFAULT NULL)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_perfil   public.profiles%ROWTYPE;
  v_iva      numeric;
  v_subtotal numeric;
  v_pedido   bigint;
  v_inactivos text;
  v_sin_stock text;
  v_lineas   jsonb;
  v_combo    record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesión para confirmar tu pedido';
  END IF;

  SELECT * INTO v_perfil FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No encontramos tu perfil';
  END IF;

  -- Bloquear los renglones confirmados y tomar una sola lectura del catálogo.
  -- Una segunda confirmación espera el primer pedido y vuelve a leer el carrito.
  WITH carrito AS MATERIALIZED (
    SELECT c.product_id, c.qty
    FROM public.carrito_items c
    WHERE c.user_id = v_uid
    ORDER BY c.product_id
    FOR UPDATE
  )
  SELECT SUM(p.price * c.qty),
         jsonb_agg(jsonb_build_object('producto_id', p.id, 'concepto', p.name,
                                     'cantidad', c.qty, 'precio', p.price)),
         string_agg(p.name, ', ') FILTER (WHERE p.is_active IS NOT TRUE),
         string_agg(format('%s (hay %s, pediste %s)', p.name, p.stock, c.qty), '; ')
           FILTER (WHERE c.qty > COALESCE(p.stock, 0))
    INTO v_subtotal, v_lineas, v_inactivos, v_sin_stock
    FROM carrito c
    JOIN public.products p ON p.id = c.product_id;
  IF v_lineas IS NULL THEN
    RAISE EXCEPTION 'Tu carrito está vacío';
  END IF;
  IF v_inactivos IS NOT NULL THEN
    RAISE EXCEPTION 'Ya no está disponible: %', v_inactivos;
  END IF;
  IF v_sin_stock IS NOT NULL AND NOT public.permite_sobre_pedido() THEN
    RAISE EXCEPTION 'No hay existencias suficientes: %', v_sin_stock;
  END IF;

  SELECT COALESCE((SELECT valor FROM public.parametros_cotizacion WHERE clave = 'iva'), 0.16)
    INTO v_iva;

  SELECT * INTO v_combo FROM public.mejor_combo(v_lineas);
  v_subtotal := v_subtotal - COALESCE(v_combo.descuento, 0);

  INSERT INTO public.orders (
    client_id, subtotal, tax, total,
    payment_status, project_status, notes,
    client_first_name, client_last_name, client_phone, client_email,
    combo_name, combo_count, combo_discount
  ) VALUES (
    v_uid,
    ROUND(v_subtotal, 2),
    ROUND(v_subtotal * v_iva, 2),
    ROUND(v_subtotal * (1 + v_iva), 2),
    -- Nada se ha cobrado todavía: la pasarela de pagos es la Mejora 2.
    'faltante',
    'cotizando',
    p_notas,
    v_perfil.first_name, v_perfil.last_name_p, v_perfil.phone, v_perfil.email,
    v_combo.nombre, COALESCE(v_combo.juegos, 0), COALESCE(v_combo.descuento, 0)
  ) RETURNING id INTO v_pedido;

  -- custom_label guarda el nombre tal como estaba al comprar: si el producto
  -- se renombra después, el pedido histórico no cambia.
  INSERT INTO public.order_items (order_id, product_id, custom_label, quantity, unit_price)
  SELECT v_pedido, l.producto_id, l.concepto, l.cantidad, l.precio
  FROM jsonb_to_recordset(v_lineas) AS l(producto_id bigint, concepto text, cantidad integer, precio numeric);

  DELETE FROM public.carrito_items c
  USING jsonb_to_recordset(v_lineas) AS l(producto_id bigint)
  WHERE c.user_id = v_uid AND c.product_id = l.producto_id;

  -- NOTA: no se descuenta products.stock. El pedido nace en 'cotizando' y sin
  -- pago, así que todavía no es una venta firme; descontar aquí bloquearía
  -- inventario por pedidos que pueden no concretarse. El descuento pertenece
  -- al momento en que se confirma el pago (Mejora 2).
  RETURN v_pedido;
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_venta(
    p_cliente jsonb, p_conceptos jsonb, p_pago public.payment_status, p_notas text DEFAULT NULL)
    RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
    AS $$
DECLARE
  v_iva      numeric;
  v_subtotal numeric := 0;
  v_lineas   jsonb := '[]'::jsonb;
  v_catalogo jsonb;
  v_pedido   bigint;
  v_combo    record;
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

  SELECT jsonb_object_agg(p.id, jsonb_build_object('nombre', p.name, 'precio', p.price))
    INTO v_catalogo
    FROM public.products p
    WHERE p.id IN (SELECT NULLIF(i->>'producto_id', '')::bigint FROM jsonb_array_elements(p_conceptos) i);

  FOR c IN SELECT * FROM jsonb_array_elements(p_conceptos) LOOP
    v_cantidad := COALESCE(NULLIF(c->>'cantidad', '')::integer, 1);
    IF v_cantidad < 1 OR v_cantidad > 999 THEN
      RAISE EXCEPTION 'Cantidad inválida: %', v_cantidad;
    END IF;
    v_producto := NULLIF(c->>'producto_id', '')::bigint;
    IF v_producto IS NOT NULL THEN
      -- Del catálogo: nombre y precio de la tabla, diga lo que diga el navegador.
      v_nombre := v_catalogo -> v_producto::text ->> 'nombre';
      v_precio := (v_catalogo -> v_producto::text ->> 'precio')::numeric;
      IF v_nombre IS NULL THEN
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

  SELECT * INTO v_combo FROM public.mejor_combo(v_lineas);
  v_subtotal := v_subtotal - COALESCE(v_combo.descuento, 0);

  INSERT INTO public.orders (seller_id, client_first_name, client_last_name, client_phone, client_email,
                             subtotal, tax, total, payment_status, project_status, notes,
                             combo_name, combo_count, combo_discount)
  -- Sin nombre es venta de mostrador: "Público general", como el ticket.
  VALUES (auth.uid(), COALESCE(NULLIF(trim(p_cliente->>'nombre'), ''), 'Público general'), NULLIF(trim(p_cliente->>'apellidos'), ''),
          NULLIF(trim(p_cliente->>'telefono'), ''), NULLIF(trim(p_cliente->>'correo'), ''),
          ROUND(v_subtotal, 2), ROUND(v_subtotal * v_iva, 2), ROUND(v_subtotal * (1 + v_iva), 2),
          p_pago, 'cotizando', NULLIF(trim(p_notas), ''),
          v_combo.nombre, COALESCE(v_combo.juegos, 0), COALESCE(v_combo.descuento, 0))
  RETURNING id INTO v_pedido;

  INSERT INTO public.order_items (order_id, product_id, custom_label, quantity, unit_price)
  SELECT v_pedido, (l->>'producto_id')::bigint, l->>'concepto', (l->>'cantidad')::integer, (l->>'precio')::numeric
    FROM jsonb_array_elements(v_lineas) l;

  RETURN v_pedido;
END;
$$;

CREATE OR REPLACE FUNCTION public.proteger_pedido() RETURNS trigger
    LANGUAGE plpgsql SET search_path = public
    AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.is_admin() IS NOT TRUE
     AND (NEW.subtotal IS DISTINCT FROM OLD.subtotal OR NEW.tax IS DISTINCT FROM OLD.tax
          OR NEW.total IS DISTINCT FROM OLD.total
          OR NEW.combo_name IS DISTINCT FROM OLD.combo_name
          OR NEW.combo_count IS DISTINCT FROM OLD.combo_count
          OR NEW.combo_discount IS DISTINCT FROM OLD.combo_discount
          OR NEW.seller_id IS DISTINCT FROM OLD.seller_id
          OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
    RAISE EXCEPTION 'Sólo un administrador puede cambiar los importes, el vendedor o el cliente de una venta';
  END IF;
  RETURN NEW;
END;
$$;
