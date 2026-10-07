// Regresion aislada de pautas de interfaz (Web Interface Guidelines de
// Vercel). Red externa bloqueada y catalogo sintetico: no necesita Supabase.
//
// Por que existe: 48 de 50 etiquetas de formulario no estaban ligadas a su
// campo, asi que un lector de pantalla anunciaba campos sin nombre; los
// precios salian con el formato del navegador (en uno configurado en aleman,
// "9.000" en vez de "9,000"); los avisos no se anunciaban, y la barra del
// navegador del telefono no seguia el tema.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:8000';
const BASE_ORIGIN = new URL(BASE).origin;

const checks = [];
function check(nombre, ok, detalle = '') {
  checks.push(ok);
  console.log(`${ok ? 'PASA' : 'FALLA'} ${nombre}${detalle ? '  — ' + detalle : ''}`);
}

const browser = await chromium.launch();
try {
  // Aleman a proposito: separa los miles con punto, asi que un precio
  // formateado con la configuracion del navegador se nota.
  const context = await browser.newContext({ locale: 'de-DE' });
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin === BASE_ORIGIN) await route.continue();
    else await route.abort();
  });
  const page = await context.newPage();

  for (const pagina of ['index.html', 'admin.html']) {
    await page.goto(`${BASE}/${pagina}`, { waitUntil: 'domcontentloaded' });
    // Cada campo tiene nombre accesible: una etiqueta ligada o aria-label.
    const sinNombre = await page.evaluate(() => [...document.querySelectorAll('input, select, textarea')]
      .filter(c => c.type !== 'hidden' && !c.labels?.length && !c.getAttribute('aria-label'))
      .map(c => c.id || c.outerHTML.slice(0, 40)));
    check(`${pagina}: todos los campos tienen etiqueta`, sinNombre.length === 0, sinNombre.join(', '));

    const vivo = await page.evaluate(() => document.getElementById('toast-container')?.getAttribute('aria-live'));
    check(`${pagina}: los avisos se anuncian (aria-live)`, vivo === 'polite', `aria-live=${vivo}`);

    // La barra del navegador sigue al tema, tambien al cambiarlo a mano.
    const colores = await page.evaluate(() => {
      const meta = () => document.querySelector('meta[name="theme-color"]')?.content;
      const antes = [document.documentElement.dataset.tema, meta()];
      toggleTheme();
      const despues = [document.documentElement.dataset.tema, meta()];
      toggleTheme();
      return { antes, despues };
    });
    const esperado = { claro: '#FFFFFF', oscuro: '#0E1012' };
    check(`${pagina}: theme-color sigue al tema`,
      colores.antes[1] === esperado[colores.antes[0]] && colores.despues[1] === esperado[colores.despues[0]],
      `${colores.antes.join('=')} -> ${colores.despues.join('=')}`);
  }

  // Precios en formato de Mexico aunque el navegador este en aleman.
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof cargarCatalogoPublico === 'function');
  await page.evaluate(async () => {
    const respuesta = Promise.resolve({ data: [{ id: 1, name: 'Porton', price: 9000, stock: 5, image_url: null }], error: null });
    const consulta = { select: () => consulta, eq: () => consulta, order: () => respuesta };
    window.supabaseClient = { ...window.supabaseClient, from: () => consulta };
    await cargarCatalogoPublico();
  });
  const precio = await page.locator('.product-card .price').first().innerText();
  check('el precio usa el formato de Mexico en un navegador en aleman', precio.includes('9,000'), precio);
  await context.close();
} finally {
  await browser.close();
}

const fallidas = checks.filter(ok => !ok).length;
console.log(`${checks.length - fallidas}/${checks.length} comprobaciones de pautas de interfaz.`);
if (fallidas) process.exitCode = 1;
