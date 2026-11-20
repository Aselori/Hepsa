-- ============================================================================
-- DATOS DE DEMOSTRACIÓN EN EL SITIO PUBLICADO · BORRAR ANTES DE USO REAL
--
-- Para grabar el video con contenido en todas las pantallas. Requiere las
-- cuentas de scripts/demo/cuentas-en-vivo.mjs. Se corre con rol postgres
-- (SQL Editor de Supabase o psql). Correrlo dos veces no duplica nada.
--
-- 1. Catálogo: pone precios y existencias inventados a los 13 productos que
--    esperan precio (por nombre), les quita la nota «[PRECIO POR
--    CONFIRMAR] » y los publica. Los precios NO son de HEPSA.
-- 2. Ventas: 7 de mostrador (registradas por vendedor.demo) y un pedido en
--    línea de cliente.demo, con distintos estados de pago y de proyecto.
-- 3. Solicitudes del cotizador: 3, con correos @example.com.
--
-- Todo se identifica por las cuentas y correos @example.com y por los
-- nombres de esos 13 productos. Se deshace con scripts/demo/borrar-datos-en-vivo.sql.
-- ============================================================================

DO $$
DECLARE
  v_vend   uuid := (SELECT id FROM public.profiles WHERE email = 'vendedor.demo@example.com');
  v_cli    uuid := (SELECT id FROM public.profiles WHERE email = 'cliente.demo@example.com');
  v_tax_rate    numeric := COALESCE((SELECT value FROM public.quote_settings WHERE key = 'tax_rate'), 0.16);
  v_order_id bigint;
  v       record;
BEGIN
  IF v_vend IS NULL OR v_cli IS NULL THEN
    RAISE EXCEPTION 'Faltan las cuentas de demostración: corre antes scripts/demo/cuentas-en-vivo.mjs';
  END IF;

  -- 1. Catálogo
  UPDATE public.products p
     SET price = d.price, stock = d.piezas, is_active = true,
         description = regexp_replace(p.description, '^\[PRECIO POR CONFIRMAR\] ', '')
    FROM (VALUES ('Portón corredizo de acero', 28500, 2), ('Portón con acabado madera', 32000, 2),
                 ('Puerta pivotante de acero', 24500, 2), ('Puerta de acero con vidrio', 16800, 3),
                 ('Barandal de corte láser', 8500, 4), ('Escalera de caracol', 45000, 1),
                 ('Escalera de huella volada', 52000, 1), ('Pérgola de acero', 38000, 2),
                 ('Cerca de corte láser', 12500, 5), ('Celosía decorativa', 6200, 6),
                 ('Plafón de corte láser', 4800, 6), ('Techo de policarbonato', 22000, 2),
                 ('Fachada de paneles decorativos', 35000, 2)) AS d(name, price, piezas)
   WHERE p.name = d.name AND p.price = 0;

  -- 2. Ventas (sólo si no se cargaron antes)
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE seller_id = v_vend OR client_id = v_cli) THEN
    FOR v IN SELECT * FROM (VALUES
      -- vendedor, nombre, apellidos, teléfono, producto, concepto libre, precio libre, pago, proyecto, notas, días atrás
      (v_vend, 'Patricia', 'Leal Ortiz', '81 1020 3040', 5,    'Instalación y motor eléctrico', 6500, 'deposit', 'in_production', 'Instalar el sábado por la mañana', 60),
      (v_vend, 'Héctor', 'Villarreal', '81 2030 4050',  6,    NULL, NULL, 'paid', 'installed', NULL, 35),
      (v_vend, 'Gabriela', 'Montemayor', '81 3040 5060', 3,  NULL, NULL, 'pending', 'quoting', 'Color negro mate', 3),
      (v_vend, 'Ricardo', 'Elizondo', '81 4050 6070',  NULL, 'Barandal de escalera, 4 m lineales', 14800, 'deposit', 'in_production', NULL, 1),
      (v_vend, NULL, NULL, NULL,                          8,    NULL, NULL, 'paid', 'quoting', NULL, 0),
      (v_vend, 'Daniela', 'Garza', NULL,                  4,    NULL, NULL, 'paid', 'installed', NULL, 95),
      (v_vend, 'Fernando', 'Salazar', NULL,               7,    NULL, NULL, 'paid', 'installed', NULL, 125)
    ) AS t(vendedor, name, last_name, phone, producto, label, precio_libre, pago, proyecto, notas, dias) LOOP
      INSERT INTO public.orders (seller_id, client_first_name, client_last_name, client_phone,
                                 subtotal, tax, total, payment_status, project_status, notes, created_at)
      SELECT v.vendedor, COALESCE(v.name, 'Público general'), v.last_name, v.phone,
             s.sub, ROUND(s.sub * v_tax_rate, 2), s.sub + ROUND(s.sub * v_tax_rate, 2),
             v.pago::public.payment_status, v.proyecto::public.project_status, v.notas, now() - make_interval(days => v.dias)
        FROM (SELECT COALESCE((SELECT price FROM public.products WHERE id = v.producto), 0) + COALESCE(v.precio_libre, 0) AS sub) s
      RETURNING id INTO v_order_id;
      IF v.producto IS NOT NULL THEN
        INSERT INTO public.order_items (order_id, product_id, custom_label, quantity, unit_price)
        SELECT v_order_id, id, name, 1, price FROM public.products WHERE id = v.producto;
      END IF;
      IF v.label IS NOT NULL THEN
        INSERT INTO public.order_items (order_id, product_id, custom_label, quantity, unit_price)
        VALUES (v_order_id, NULL, v.label, 1, v.precio_libre);
      END IF;
    END LOOP;

    -- Pedido en línea de cliente.demo, como lo deja crear_pedido_desde_carrito.
    INSERT INTO public.orders (client_id, client_first_name, client_last_name, client_phone, client_email,
                               subtotal, tax, total, payment_status, project_status, notes, created_at)
    SELECT v_cli, 'Cliente', 'Demo', '81 7788 9900', 'cliente.demo@example.com',
           price, ROUND(price * v_tax_rate, 2), price + ROUND(price * v_tax_rate, 2),
           'pending', 'quoting', 'Prefiero que me llamen por la tarde', now() - interval '2 days'
      FROM public.products WHERE id = 5
    RETURNING id INTO v_order_id;
    INSERT INTO public.order_items (order_id, product_id, custom_label, quantity, unit_price)
    SELECT v_order_id, id, name, 1, price FROM public.products WHERE id = 5;
  END IF;

  -- 3. Solicitudes del cotizador (el precio estimado lo pone su disparador)
  IF NOT EXISTS (SELECT 1 FROM public.custom_requests WHERE email LIKE '%@example.com') THEN
    INSERT INTO public.custom_requests (first_name, last_name, email, phone, specifications, status,
                                        length_mm, height_mm, material, finish, created_at)
    VALUES
      ('Roberto', 'Cantú', 'roberto.cantu@example.com', '81 8899 0011', 'Protección para ventana de recámara, diseño sencillo.',
       'pending', 1500, 1200, 'steel', 'powder_coat', now() - interval '4 hours'),
      ('Sergio', 'Peña', 'sergio.pena@example.com', '81 1111 0002', 'Portón de 5 × 3 m con motor, para cochera doble.',
       'pending', 5000, 3000, 'steel', 'powder_coat', now() - interval '4 days'),
      ('Lucía', 'Ortega', 'lucia.ortega@example.com', '81 1111 0003', 'Barandal para escalera exterior.',
       'closed', 4000, 1000, 'wrought_iron', 'bluing', now() - interval '12 days');
  END IF;
END $$;
