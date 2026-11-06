-- ============================================================================
-- DATOS DE DEMOSTRACIÓN · BORRAR ANTES DE USO REAL
--
-- Llena el sistema para enseñarlo: 8 productos, 12 ventas de las últimas
-- seis semanas con distintos estados de pago y de proyecto, y 4 solicitudes
-- del cotizador. Nada de esto es del negocio.
--
-- Todo lleva la marca [DEMO-BORRAR]:
--   products.description   empieza con [DEMO-BORRAR]  (el cliente no ve la
--                          descripción en el catálogo; el personal sí, en
--                          Inventario)
--   orders.notes           empieza con [DEMO-BORRAR]
--   custom_requests.email  termina en @demo.invalid
--
-- Se borra con scripts/demo/borrar-datos-demo.sql. Correrlo dos veces no
-- duplica nada: si ya hay datos demo, no hace nada.
--
-- Se corre en el SQL Editor de Supabase (rol postgres) o con psql.
-- ============================================================================

DO $$
DECLARE
  v_pedido bigint;
  v_venta  record;
  v_sub    numeric;
BEGIN
  IF EXISTS (SELECT 1 FROM public.products WHERE description LIKE '[DEMO-BORRAR]%') THEN
    RAISE NOTICE 'Ya hay datos de demostración; no se agregó nada.';
    RETURN;
  END IF;

  -- ─── Productos ────────────────────────────────────────────────────────────
  INSERT INTO public.products (name, price, stock, is_active, description) VALUES
    ('Barandal de escalera en hierro forjado', 18500, 4, true,  '[DEMO-BORRAR] Por metro lineal, con pasamanos y volutas.'),
    ('Portón corredizo de acero',              32000, 2, true,  '[DEMO-BORRAR] 4.0 × 2.2 m, riel inferior y motor opcional.'),
    ('Protección para ventana',                 3200, 12, true, '[DEMO-BORRAR] 1.2 × 1.0 m, solera de 1/2", pintura electrostática.'),
    ('Puerta de acero con vidrio',             12800, 5, true,  '[DEMO-BORRAR] 0.9 × 2.1 m, vidrio templado esmerilado.'),
    ('Pérgola de aluminio',                    26000, 3, true,  '[DEMO-BORRAR] 3 × 4 m, lamas fijas.'),
    ('Reja perimetral por tramo',               4500, 20, true, '[DEMO-BORRAR] Tramo de 2.0 × 1.5 m.'),
    ('Escalera de caracol',                    54000, 1, true,  '[DEMO-BORRAR] Diámetro 1.6 m, 14 escalones.'),
    ('Celosía decorativa de acero',             7900, 0, false, '[DEMO-BORRAR] Corte láser. Oculta del catálogo para mostrar la función.');

  -- ─── Ventas ───────────────────────────────────────────────────────────────
  -- Una fila por venta: cliente, días atrás, pago, proyecto, producto, piezas.
  FOR v_venta IN
    SELECT * FROM (VALUES
      ('Roberto',  'Salinas',   '81 2233 4455', 41, 'completo', 'instalado',     'Barandal de escalera en hierro forjado', 2, 'Instalación en San Pedro'),
      ('Mariana',  'Cantú',     '81 9876 5432', 37, 'completo', 'instalado',     'Protección para ventana',                4, ''),
      ('Jorge',    'Elizondo',  '81 5555 0101', 33, 'completo', 'instalado',     'Puerta de acero con vidrio',             1, 'Entrega por la tarde'),
      ('Daniela',  'Garza',     '81 4321 8765', 28, 'completo', 'en_produccion', 'Pérgola de aluminio',                    1, ''),
      ('Luis',     'Treviño',   '81 1212 3434', 24, 'anticipo', 'en_produccion', 'Portón corredizo de acero',              1, 'Anticipo del 50% en transferencia'),
      ('Fernanda', 'Villarreal','81 7788 9900', 20, 'completo', 'en_produccion', 'Reja perimetral por tramo',              6, 'Fraccionamiento Cumbres'),
      ('Héctor',   'Martínez',  '81 3344 5566', 15, 'anticipo', 'cotizando',     'Escalera de caracol',                    1, 'Anticipo en efectivo'),
      ('Sofía',    'Leal',      '81 6677 8899', 11, 'faltante', 'cotizando',     'Protección para ventana',                3, ''),
      ('Ricardo',  'Montemayor','81 9090 1010',  8, 'completo', 'cotizando',     'Puerta de acero con vidrio',             2, ''),
      ('Paola',    'Zambrano',  '81 2020 3030',  5, 'faltante', 'cotizando',     'Barandal de escalera en hierro forjado', 1, 'Pendiente de medir en sitio'),
      ('Andrés',   'Guerra',    '81 4040 5050',  2, 'anticipo', 'cotizando',     'Pérgola de aluminio',                    1, ''),
      ('Valeria',  'Rodríguez', '81 6060 7070',  0, 'completo', 'cotizando',     'Reja perimetral por tramo',              2, '')
    ) AS t(nombre, apellido, tel, dias, pago, proyecto, producto, piezas, nota)
  LOOP
    SELECT price * v_venta.piezas INTO v_sub FROM public.products
     WHERE name = v_venta.producto AND description LIKE '[DEMO-BORRAR]%';

    INSERT INTO public.orders (client_first_name, client_last_name, client_phone,
                               subtotal, tax, total, payment_status, project_status, notes, created_at)
    VALUES (v_venta.nombre, v_venta.apellido, v_venta.tel,
            v_sub, ROUND(v_sub * 0.16, 2), ROUND(v_sub * 1.16, 2),
            v_venta.pago::public.payment_status, v_venta.proyecto::public.project_status,
            trim('[DEMO-BORRAR] ' || v_venta.nota),
            now() - make_interval(days => v_venta.dias))
    RETURNING id INTO v_pedido;

    INSERT INTO public.order_items (order_id, product_id, custom_label, quantity, unit_price)
    SELECT v_pedido, p.id, p.name, v_venta.piezas, p.price
      FROM public.products p
     WHERE p.name = v_venta.producto AND p.description LIKE '[DEMO-BORRAR]%';
  END LOOP;

  -- ─── Solicitudes del cotizador ────────────────────────────────────────────
  -- precio_estimado lo calcula el disparador, como con una solicitud real.
  INSERT INTO public.custom_requests (first_name, last_name_p, email, phone, specifications, status,
                                      largo_mm, alto_mm, profundidad_mm, material, acabado, created_at) VALUES
    ('Gabriela', 'Salazar', 'gabriela.salazar@demo.invalid', '81 1111 2222',
     'Barandal para terraza, mismo diseño que la escalera.', 'Pendiente de Revisión', 6000, 1000, NULL, 'hierro_forjado', 'pavonado', now() - interval '4 days'),
    ('Miguel', 'Cavazos', 'miguel.cavazos@demo.invalid', '81 3333 4444',
     'Puerta principal de doble hoja con mirilla.', 'Pendiente de Revisión', 1800, 2400, 60, 'acero', 'pintura_electrostatica', now() - interval '1 day'),
    ('Laura', 'Ochoa', 'laura.ochoa@demo.invalid', '81 5555 6666',
     'Cubierta para cochera de dos autos.', 'Contactado', 6000, 5500, NULL, 'aluminio', 'pintura_electrostatica', now() - interval '9 days'),
    ('Tomás', 'Benavides', 'tomas.benavides@demo.invalid', '81 7777 8888',
     'Protecciones para 6 ventanas iguales.', 'Finalizado', 1200, 1000, NULL, 'acero', 'cromado', now() - interval '20 days');

  RAISE NOTICE 'Datos de demostración agregados: 8 productos, 12 ventas, 4 solicitudes.';
END $$;
