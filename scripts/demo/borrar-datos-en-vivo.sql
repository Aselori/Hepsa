-- ============================================================================
-- Deshace scripts/demo/datos-en-vivo.sql y scripts/demo/cuentas-en-vivo.mjs.
--
-- Borra todo lo de las cuentas y correos @example.com (ventas, pedidos,
-- carritos, solicitudes, perfiles y cuentas, con sus segundos factores) y
-- regresa los 13 productos que esperaban precio a como estaban: sin precio, sin
-- existencias, ocultos y con la nota «[PRECIO POR CONFIRMAR] ».
--
-- Se corre con rol postgres. Si HEPSA ya puso precios reales a alguno de
-- esos productos, quitarlo de la lista de abajo antes de correrlo.
-- ============================================================================

BEGIN;

CREATE TEMP TABLE demo_cuentas ON COMMIT DROP AS
  SELECT id FROM public.profiles WHERE email LIKE '%@example.com';

DELETE FROM public.orders
 WHERE seller_id IN (SELECT id FROM demo_cuentas)
    OR client_id IN (SELECT id FROM demo_cuentas);       -- order_items se borran en cascada
DELETE FROM public.cart_items WHERE user_id IN (SELECT id FROM demo_cuentas);
DELETE FROM public.custom_requests WHERE email LIKE '%@example.com';
DELETE FROM public.profiles WHERE id IN (SELECT id FROM demo_cuentas);
DELETE FROM auth.users WHERE id IN (SELECT id FROM demo_cuentas);  -- factores y sesiones en cascada

UPDATE public.products
   SET price = 0, stock = 0, is_active = false,
       description = CASE WHEN description LIKE '[PRECIO POR CONFIRMAR]%' THEN description
                          ELSE '[PRECIO POR CONFIRMAR] ' || description END
 WHERE name IN ('Portón corredizo de acero', 'Portón con acabado madera', 'Puerta pivotante de acero',
                'Puerta de acero con vidrio', 'Barandal de corte láser', 'Escalera de caracol',
                'Escalera de huella volada', 'Pérgola de acero', 'Cerca de corte láser',
                'Celosía decorativa', 'Plafón de corte láser', 'Techo de policarbonato',
                'Fachada de paneles decorativos');

COMMIT;
