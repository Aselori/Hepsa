-- ============================================================================
-- SEED: datos mínimos para levantar un proyecto de desarrollo.
--
-- Se corre UNA VEZ, después de las migraciones 0001 y 0002.
--
-- Qué SÍ trae: el catálogo de productos real del negocio. Son datos del
-- cliente pero no son datos personales, y sin ellos el catálogo se ve vacío.
--
-- Qué NO trae, a propósito:
--   · auth.users     — hashes bcrypt de contraseñas reales.
--   · profiles       — nombres, correos y teléfonos de clientes reales.
--   · orders         — pedidos reales con datos de contacto del comprador.
--   · custom_requests reales — se sustituyen por ejemplos inventados.
--
-- Para tener cuenta en el proyecto nuevo, cada quien se registra desde
-- index.html y luego un admin lo asciende (ver docs/setup.md).
-- ============================================================================

-- ─── Catálogo ───────────────────────────────────────────────────────────────

-- is_active = true a propósito. En producción los 6 productos están en false,
-- por eso el catálogo público se ve vacío y parece que la página está rota.
-- En desarrollo queremos verlos.
--
-- image_url va en NULL: las imágenes viven en el Storage del proyecto viejo y
-- desde uno nuevo darían 404. Se vuelven a subir desde el panel de admin.

INSERT INTO public.products (id, name, description, price, image_url, is_active, stock) VALUES
  (3, 'Puerta Principal dos puertas',
      E'Altura: 2.1 m\nAncho: 1.3 m\nTipo de apertura: Derecha\nMaterial: Acero\nEspesor: 4 cm\nAcabado: Barnizado\nEs apta para interiores.\nEs apta para exteriores.',
      9000.00, NULL, true, 5),
  (4, 'Puerta Principal',
      'color: gris medidas: 5 * 2',
      5000.00, NULL, true, 10),
  (5, 'Porton Residencial para cochera',
      'Porton residencial con doble puerta para mejor ingreso de vehiculos, ideal para su cochera, el precio base incluye una medida estandar para cochera de un solo vehiculo 3.00 M * 2.40 M',
      15000.00, NULL, true, 3),
  (6, 'Puerta principal',
      'Puerta reforzada para entrada principal, color negro/chocolate 5*2 M',
      7500.00, NULL, true, 1),
  (7, 'Puerta de madera de abeto',
      'Puerta de 2.5x1.7',
      14000.00, NULL, true, 10),
  (8, 'Puerta de madera de abeto',
      '2.4m x 1.5m',
      20000.00, NULL, true, 10);

-- Los ids se insertaron explícitos; sin esto la secuencia sigue en 1 y el
-- siguiente alta de producto choca con una llave duplicada.
SELECT setval(
  pg_get_serial_sequence('public.products', 'id'),
  (SELECT MAX(id) FROM public.products)
);

-- ─── Solicitudes de ejemplo ─────────────────────────────────────────────────

-- Inventadas. Redactadas en texto libre a propósito: así se ve hoy la captura,
-- y sirven para probar el cotizador estructurado cuando exista.

INSERT INTO public.custom_requests (first_name, last_name_p, email, phone, specifications, status) VALUES
  ('Ana',   'Ramírez', 'ana.ejemplo@correo.test',   '8110000001',
   'Necesito un protector de ventana de 1.67 m de largo por 1.24 m de alto, grosor aproximado 15 cm.',
   'Pendiente de Revisión'),
  ('Luis',  'Herrera', 'luis.ejemplo@correo.test',  '8110000002',
   'Requiero un portón de 5 x 3 m, acero, acabado en pintura electrostática negra.',
   'Pendiente de Revisión'),
  ('Marta', 'Solís',   'marta.ejemplo@correo.test', '8110000003',
   'Barandal para escalera curva, aproximadamente 4 m de desarrollo, hierro forjado.',
   'Finalizado');
