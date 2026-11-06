-- ============================================================================
-- Borra los DATOS DE DEMOSTRACIÓN de scripts/demo/datos-demo.sql.
--
-- Sólo toca filas con la marca [DEMO-BORRAR] (o correo @demo.invalid). Si un
-- producto demo quedó en un pedido real, no se puede borrar sin romper ese
-- pedido: se oculta del catálogo y se avisa, para revisarlo a mano.
-- ============================================================================

DO $$
DECLARE
  v_pedidos   bigint[];
  v_ocultos   int;
  v_productos int;
BEGIN
  SELECT array_agg(id) INTO v_pedidos FROM public.orders WHERE notes LIKE '[DEMO-BORRAR]%';

  DELETE FROM public.pagos       WHERE order_id = ANY (v_pedidos);
  DELETE FROM public.order_items WHERE order_id = ANY (v_pedidos);
  DELETE FROM public.orders      WHERE id = ANY (v_pedidos);
  DELETE FROM public.custom_requests WHERE email LIKE '%@demo.invalid';

  -- Productos demo que algún pedido real todavía usa: se ocultan.
  UPDATE public.products p SET is_active = false
   WHERE p.description LIKE '[DEMO-BORRAR]%'
     AND EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.product_id = p.id);
  GET DIAGNOSTICS v_ocultos = ROW_COUNT;

  DELETE FROM public.carrito_items c USING public.products p
   WHERE c.product_id = p.id AND p.description LIKE '[DEMO-BORRAR]%';
  DELETE FROM public.products p
   WHERE p.description LIKE '[DEMO-BORRAR]%'
     AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.product_id = p.id);
  GET DIAGNOSTICS v_productos = ROW_COUNT;

  RAISE NOTICE 'Borrados: % ventas, % productos. Ocultos por estar en pedidos reales: %.',
    COALESCE(array_length(v_pedidos, 1), 0), v_productos, v_ocultos;
END $$;
