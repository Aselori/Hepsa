-- ============================================================================
-- CHECKOUT: convertir el carrito en un pedido
--
-- El carrito no estaba conectado a nada. "Proceder al Pago" mostraba un alert
-- y "Proyectos Activos" en el perfil se quedaba en "Cargando..." para siempre,
-- porque nadie consultaba orders.
--
-- Por qué una función y no un INSERT desde el navegador:
--
--   1. La política orders_insert_staff sólo deja crear órdenes al personal.
--      El esquema asumía ventas en mostrador. Abrir INSERT a los clientes les
--      daría también la posibilidad de escribir subtotal, tax y total.
--   2. El total tiene que salir de products.price en el momento de confirmar,
--      no de lo que el navegador diga que costaba. Es la misma lección del
--      cotizador.
--   3. Crear la orden, sus renglones y vaciar el carrito tiene que pasar todo
--      o nada. En una función es una sola transacción.
-- ============================================================================

-- ─── Parámetros del negocio ─────────────────────────────────────────────────

INSERT INTO public.parametros_cotizacion (clave, valor, nota) VALUES
  ('iva', 0.16, 'IVA aplicado a los pedidos en línea.'),
  ('permitir_sobre_pedido', 0, '0 = el pedido no puede exceder products.stock. 1 = se acepta como encargo.')
ON CONFLICT (clave) DO NOTHING;

-- El navegador necesita saber si puede pasarse del inventario para pintar bien
-- los botones, pero no debe ver el tarifario. Esta función expone únicamente
-- esa bandera, para que cliente y servidor no acaben con reglas distintas.
CREATE OR REPLACE FUNCTION public.permite_sobre_pedido()
    RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
    AS $$
  SELECT COALESCE((SELECT valor FROM public.parametros_cotizacion
                    WHERE clave = 'permitir_sobre_pedido'), 0) = 1;
$$;

REVOKE EXECUTE ON FUNCTION public.permite_sobre_pedido() FROM public;
GRANT  EXECUTE ON FUNCTION public.permite_sobre_pedido() TO anon, authenticated;

-- ─── El checkout ────────────────────────────────────────────────────────────

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
  v_problema text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesión para confirmar tu pedido';
  END IF;

  SELECT * INTO v_perfil FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No encontramos tu perfil';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.carrito_items WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'Tu carrito está vacío';
  END IF;

  -- Un producto pudo desactivarse mientras estaba en el carrito.
  SELECT string_agg(p.name, ', ')
    INTO v_problema
    FROM public.carrito_items c
    JOIN public.products p ON p.id = c.product_id
   WHERE c.user_id = v_uid AND p.is_active IS NOT TRUE;
  IF v_problema IS NOT NULL THEN
    RAISE EXCEPTION 'Ya no está disponible: %', v_problema;
  END IF;

  -- Existencias. Se revisa aquí y no sólo en el navegador porque entre que
  -- alguien arma su carrito y confirma, el inventario pudo cambiar.
  IF NOT public.permite_sobre_pedido() THEN
    SELECT string_agg(format('%s (hay %s, pediste %s)', p.name, p.stock, c.qty), '; ')
      INTO v_problema
      FROM public.carrito_items c
      JOIN public.products p ON p.id = c.product_id
     WHERE c.user_id = v_uid AND c.qty > COALESCE(p.stock, 0);
    IF v_problema IS NOT NULL THEN
      RAISE EXCEPTION 'No hay existencias suficientes: %', v_problema;
    END IF;
  END IF;

  SELECT COALESCE((SELECT valor FROM public.parametros_cotizacion WHERE clave = 'iva'), 0.16)
    INTO v_iva;

  -- El precio sale de la tabla, no del carrito.
  SELECT SUM(p.price * c.qty)
    INTO v_subtotal
    FROM public.carrito_items c
    JOIN public.products p ON p.id = c.product_id
   WHERE c.user_id = v_uid;

  INSERT INTO public.orders (
    client_id, subtotal, tax, total,
    payment_status, project_status, notes,
    client_first_name, client_last_name, client_phone, client_email
  ) VALUES (
    v_uid,
    ROUND(v_subtotal, 2),
    ROUND(v_subtotal * v_iva, 2),
    ROUND(v_subtotal * (1 + v_iva), 2),
    -- Nada se ha cobrado todavía: la pasarela de pagos es la Mejora 2.
    'faltante',
    'cotizando',
    p_notas,
    v_perfil.first_name, v_perfil.last_name_p, v_perfil.phone, v_perfil.email
  ) RETURNING id INTO v_pedido;

  -- custom_label guarda el nombre tal como estaba al comprar: si el producto
  -- se renombra después, el pedido histórico no cambia.
  INSERT INTO public.order_items (order_id, product_id, custom_label, quantity, unit_price)
  SELECT v_pedido, p.id, p.name, c.qty, p.price
    FROM public.carrito_items c
    JOIN public.products p ON p.id = c.product_id
   WHERE c.user_id = v_uid;

  DELETE FROM public.carrito_items WHERE user_id = v_uid;

  -- NOTA: no se descuenta products.stock. El pedido nace en 'cotizando' y sin
  -- pago, así que todavía no es una venta firme; descontar aquí bloquearía
  -- inventario por pedidos que pueden no concretarse. El descuento pertenece
  -- al momento en que se confirma el pago (Mejora 2).
  RETURN v_pedido;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.crear_pedido_desde_carrito(text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.crear_pedido_desde_carrito(text) TO authenticated;
