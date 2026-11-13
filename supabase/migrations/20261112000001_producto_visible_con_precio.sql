-- ============================================================================
-- UN PRODUCTO SIN PRECIO NO SE PUBLICA.
--
-- Precio 0 es "producto sin precio": se conocen todos los datos menos el
-- precio y el aviso de Inicio lo cuenta. El catálogo público sólo filtra por
-- is_active, así que sin esta regla un producto visible con precio 0 se
-- vendería en $0. Cubre las tres vías del panel (alta, edición y «Mostrar»)
-- y cualquier escritura directa; el panel avisa antes con un mensaje claro.
-- ============================================================================

ALTER TABLE public.products
  ADD CONSTRAINT products_visible_con_precio
  CHECK (NOT COALESCE(is_active, false) OR price > 0);
