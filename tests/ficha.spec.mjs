// Ficha de producto del catálogo público, con un catálogo simulado.
//
// La ficha es lo único que muestra la descripción al cliente: se prueba que
// se abre desde la tarjeta, que la descripción entra como texto (no como
// HTML), que el tope de existencias también vale dentro de la ficha y que
// cabe en un teléfono.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:8000';
const BASE_ORIGIN = new URL(BASE).origin;

const checks = [];
function check(nombre, ok, detalle = '') {
  checks.push(ok);
  console.log(`${ok ? 'PASA' : 'FALLA'} ${nombre}${detalle ? '  — ' + detalle : ''}`);
}

const productos = [
  { id: 1, name: 'Portón residencial', price: 15000, stock: 2, image_url: 'assets/productos/porton-cochera.jpg',
    description: 'Doble hoja, 3.00 × 2.10 m.\nAcero con pintura electrostática. <img src=x onerror="window.__xss=1">' },
  { id: 2, name: 'Barandal', price: 5000, stock: 9, image_url: null, description: null },
];

const browser = await chromium.launch();
try {
  for (const [ancho, alto, etiqueta] of [[390, 844, 'telefono 390px'], [1366, 900, 'escritorio 1366px']]) {
    const context = await browser.newContext({ viewport: { width: ancho, height: alto } });
    await context.route('**/*', async (route) => {
      if (new URL(route.request().url()).origin === BASE_ORIGIN) await route.continue();
      else await route.abort();
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof cargarCatalogoPublico === 'function');
    await page.evaluate(async (datos) => {
      window.__xss = 0;
      const respuesta = Promise.resolve({ data: datos, error: null });
      const consulta = { select: () => consulta, eq: () => consulta, order: () => respuesta };
      window.supabaseClient = { ...window.supabaseClient, from: () => consulta };
      await cargarCatalogoPublico();
    }, productos);

    const ficha = page.locator('#ficha-producto');
    await page.locator('.product-title button[data-detalle-id="1"]').click();
    check(`${etiqueta}: el título abre la ficha`, await ficha.isVisible());
    const contenido = await page.evaluate(() => ({
      nombre: document.getElementById('ficha-nombre').textContent,
      descripcion: document.getElementById('ficha-descripcion').textContent,
      imagenesInyectadas: document.querySelectorAll('#ficha-descripcion img').length,
      foto: document.getElementById('ficha-foto').getAttribute('src'),
      xss: window.__xss,
    }));
    check(`${etiqueta}: la ficha muestra la descripción completa`, contenido.nombre === 'Portón residencial' && contenido.descripcion.includes('3.00 × 2.10 m'),
      JSON.stringify(contenido.descripcion));
    check(`${etiqueta}: la descripción entra como texto, no como HTML`, contenido.imagenesInyectadas === 0 && contenido.xss === 0
      && contenido.descripcion.includes('<img'));
    check(`${etiqueta}: la ficha usa la foto del producto`, contenido.foto?.endsWith('assets/productos/porton-cochera.jpg'), contenido.foto);

    const caja = await ficha.boundingBox();
    check(`${etiqueta}: la ficha cabe en la pantalla`, caja && caja.x >= 0 && caja.x + caja.width <= ancho + 0.5 && caja.y >= 0 && caja.y + caja.height <= alto + 0.5,
      JSON.stringify(caja));
    await page.screenshot({ path: `tests/screenshots/ficha-${ancho}.png` });

    const agregar = page.locator('#ficha-agregar');
    await agregar.click();
    const tras1 = await page.evaluate(() => ({ qty: cart.find((l) => l.id === 1)?.qty, nota: document.getElementById('ficha-existencias').textContent }));
    check(`${etiqueta}: "Añadir al carrito" en la ficha agrega y actualiza la nota`, tras1.qty === 1 && tras1.nota === 'Queda 1 disponible', JSON.stringify(tras1));
    await agregar.click();
    await agregar.click();
    const tope = await page.evaluate(() => ({ qty: cart.find((l) => l.id === 1)?.qty, boton: document.getElementById('ficha-agregar').textContent }));
    check(`${etiqueta}: la ficha respeta el tope de existencias`, tope.qty === 2 && tope.boton === 'Sin más existencias', JSON.stringify(tope));

    await page.keyboard.press('Escape');
    check(`${etiqueta}: Esc cierra la ficha`, !(await ficha.isVisible()));

    // Sin foto, la tarjeta no tiene imagen, pero el título sí abre la ficha.
    await page.locator('.product-title button[data-detalle-id="2"]').click();
    const sinFoto = await page.evaluate(() => ({ oculta: document.getElementById('ficha-foto').hidden, descripcion: document.getElementById('ficha-descripcion').textContent }));
    check(`${etiqueta}: un producto sin foto ni descripción abre una ficha limpia`, sinFoto.oculta && sinFoto.descripcion === '', JSON.stringify(sinFoto));
    await page.locator('#ficha-producto [data-ir-cotizador]').click();
    check(`${etiqueta}: "Cotízalo" cierra la ficha y abre el cotizador`,
      !(await ficha.isVisible()) && await page.locator('#view-quote').isVisible());
    await context.close();
  }
} finally {
  await browser.close();
}

const fallidas = checks.filter((ok) => !ok).length;
console.log(`${checks.length - fallidas}/${checks.length} comprobaciones de la ficha de producto.`);
if (fallidas) process.exitCode = 1;
