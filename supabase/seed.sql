-- ============================================================================
-- SEED: datos mínimos para levantar un proyecto de desarrollo.
--
-- Se corre UNA VEZ, después de aplicar todas las migraciones.
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

-- El catálogo real, igual al del proyecto hospedado (corrección del
-- 2026-10-09 y fotos del 2026-11-08). Las fotos viven en assets/productos/ y
-- se publican con el sitio, así que también cargan en desarrollo. Los 13
-- productos ocultos "por confirmar precio" se agregan aparte con
-- scripts/catalogo/fotos-y-productos-2026-11-08.sql.

INSERT INTO public.products (id, name, description, price, image_url, is_active, stock) VALUES
  (3, 'Puerta principal de dos hojas',
      E'Altura: 2.10 m\nAncho: 1.30 m\nTipo de apertura: derecha\nMaterial: acero\nEspesor: 4 cm\nAcabado: barnizado\nApta para interiores y exteriores.',
      9000.00, 'assets/productos/puerta-dos-hojas.jpg', true, 5),
  (4, 'Puerta principal gris',
      'Color gris. Medidas: 5.00 × 2.00 m.',
      5000.00, 'assets/productos/puerta-principal-gris.jpg', true, 10),
  (5, 'Portón residencial para cochera',
      'Portón residencial de doble hoja para facilitar la entrada de vehículos; ideal para la cochera. El precio base incluye la medida estándar para una cochera de un solo vehículo: 3.00 × 2.40 m.',
      15000.00, 'assets/productos/porton-cochera.jpg', true, 3),
  (6, 'Puerta principal reforzada',
      'Puerta reforzada para entrada principal, color negro/chocolate. Medidas: 5.00 × 2.00 m.',
      7500.00, 'assets/productos/puerta-reforzada.jpg', true, 1),
  (7, 'Puerta de madera de abeto de 2.50 × 1.70 m',
      'Puerta de madera de abeto. Medidas: 2.50 × 1.70 m.',
      14000.00, 'assets/productos/puerta-madera-250x170.jpg', true, 10),
  (8, 'Puerta de madera de abeto de 2.40 × 1.50 m',
      'Puerta de madera de abeto. Medidas: 2.40 × 1.50 m.',
      20000.00, 'assets/productos/puerta-madera-240x150.jpg', true, 10);

-- Los ids se insertaron explícitos; sin esto la secuencia sigue en 1 y el
-- siguiente alta de producto choca con una llave duplicada.
SELECT setval(
  pg_get_serial_sequence('public.products', 'id'),
  (SELECT MAX(id) FROM public.products)
);

-- ─── Solicitudes de ejemplo ─────────────────────────────────────────────────

-- Solicitudes sinteticas compatibles con el cotizador estructurado actual.

INSERT INTO public.custom_requests (first_name, last_name_p, email, phone, specifications, status, largo_mm, alto_mm, profundidad_mm, material, acabado) VALUES
  ('Ana',   'Ramírez', 'ana.ejemplo@correo.test',   '8110000001',
   'Necesito un protector de ventana de 1.67 m de largo por 1.24 m de alto, grosor aproximado 15 cm.',
   'Pendiente de Revisión', 1670, 1240, 150, 'acero', 'pintura_electrostatica'),
  ('Luis',  'Herrera', 'luis.ejemplo@correo.test',  '8110000002',
   'Requiero un portón de 5 x 3 m, acero, acabado en pintura electrostática negra.',
   'Pendiente de Revisión', 5000, 3000, NULL, 'acero', 'pintura_electrostatica'),
  ('Marta', 'Solís',   'marta.ejemplo@correo.test', '8110000003',
   'Barandal para escalera curva, aproximadamente 4 m de desarrollo, hierro forjado.',
   'Finalizado', 4000, 1000, NULL, 'hierro_forjado', 'pavonado');
