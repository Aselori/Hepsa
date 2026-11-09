-- ============================================================================
-- Fotos reales del catálogo (página de Facebook de HEPSA, 2026-11-08).
--
-- Las imágenes viven en assets/productos/ y se publican con el sitio; el
-- catálogo acepta rutas del mismo origen (urlImagenSegura en index.html).
--
--   1. Pone foto a los 6 productos reales, buscándolos por nombre.
--   2. Agrega 13 productos que se ven en las fotos y no estaban en el
--      catálogo. Entran OCULTOS y con precio 0: el precio lo fija HEPSA. El
--      admin pone el precio, quita la marca [PRECIO POR CONFIRMAR] de la
--      descripción y los activa desde Catálogo.
--
-- Se puede correr dos veces: los productos nuevos no se duplican.
-- Los productos de demostración se borran aparte con
-- scripts/demo/borrar-datos-demo.sql.
-- ============================================================================
BEGIN;

UPDATE public.products p SET image_url = 'assets/productos/' || f.archivo
  FROM (VALUES
    ('Puerta principal de dos hojas', 'puerta-dos-hojas.jpg'),
    ('Puerta principal gris', 'puerta-principal-gris.jpg'),
    ('Portón residencial para cochera', 'porton-cochera.jpg'),
    ('Puerta principal reforzada', 'puerta-reforzada.jpg'),
    ('Puerta de madera de abeto de 2.50 × 1.70 m', 'puerta-madera-250x170.jpg'),
    ('Puerta de madera de abeto de 2.40 × 1.50 m', 'puerta-madera-240x150.jpg')
  ) AS f(nombre, archivo)
 WHERE p.name = f.nombre;

INSERT INTO public.products (name, description, price, image_url, is_active, stock)
SELECT n.nombre, '[PRECIO POR CONFIRMAR] ' || n.descripcion, 0, 'assets/productos/' || n.archivo, false, 0
  FROM (VALUES
    ('Portón corredizo de acero', 'Portón corredizo de lámina de acero con franjas horizontales, para cochera o acceso.', 'porton-corredizo.jpg'),
    ('Portón con acabado madera', 'Portón de acero con recubrimiento de apariencia madera.', 'porton-acabado-madera.jpg'),
    ('Puerta pivotante de acero', 'Puerta principal pivotante de acero con jaladera vertical de piso a techo.', 'puerta-pivotante.jpg'),
    ('Puerta de acero con vidrio', 'Puerta de perfil de acero con vidrio y divisiones horizontales.', 'puerta-acero-vidrio.jpg'),
    ('Barandal de corte láser', 'Barandal para escalera o mezzanine con panel de acero de corte láser.', 'barandal-corte-laser.jpg'),
    ('Escalera de caracol', 'Escalera de caracol de acero con huellas de madera.', 'escalera-caracol.jpg'),
    ('Escalera de huella volada', 'Escalera de zanca de acero con huellas de madera y barandal de tubo.', 'escalera-huella-volada.jpg'),
    ('Pérgola de acero', 'Pérgola de estructura de acero para terraza o patio.', 'pergola-acero.jpg'),
    ('Cerca de corte láser', 'Cerca perimetral con paneles de acero de corte láser.', 'cerca-corte-laser.jpg'),
    ('Celosía decorativa', 'Panel decorativo de acero de corte láser para muro o división.', 'celosia-decorativa.jpg'),
    ('Plafón de corte láser', 'Plafón decorativo de acero de corte láser con iluminación.', 'plafon-corte-laser.jpg'),
    ('Techo de policarbonato', 'Techo con estructura de acero y cubierta de policarbonato.', 'techo-policarbonato.jpg'),
    ('Fachada de paneles decorativos', 'Recubrimiento de fachada con paneles metálicos.', 'fachada-paneles.jpg')
  ) AS n(nombre, descripcion, archivo)
-- Un producto de demostración con el mismo nombre no cuenta: se va a borrar.
 WHERE NOT EXISTS (SELECT 1 FROM public.products p
                    WHERE p.name = n.nombre AND p.description NOT LIKE '[DEMO-BORRAR]%');

COMMIT;
