// Regresion aislada del carrito lateral del portal. Catalogo sintetico y red
// externa bloqueada: no necesita Supabase, cuentas ni credenciales.
//
// Por que existe: las lineas del carrito usaban botones del navegador sin
// estilo de unos 28x22 px, por debajo del minimo de 24 px para tocar, y el
// nombre del producto se partia en tres renglones en el telefono. Ademas no
// habia fondo detras del carrito abierto: la pagina seguia viva debajo y no
// habia forma de cerrarlo tocando fuera.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:8000';
const BASE_ORIGIN = new URL(BASE).origin;

const checks = [];
function check(nombre, ok, detalle = '') {
  checks.push(ok);
  console.log(`${ok ? 'PASA' : 'FALLA'} ${nombre}${detalle ? '  — ' + detalle : ''}`);
}

const productos = [
  { id: 1, name: 'Puerta Principal dos puertas', price: 9000, stock: 5, image_url: null },
  { id: 2, name: 'Barandal', price: 5000, stock: 5, image_url: null },
];

const browser = await chromium.launch();
try {
  for (const [ancho, alto, etiqueta] of [[390, 844, 'telefono 390px'], [1366, 900, 'escritorio 1366px']]) {
    const context = await browser.newContext({ viewport: { width: ancho, height: alto } });
    await context.route('**/*', async route => {
      if (new URL(route.request().url()).origin === BASE_ORIGIN) await route.continue();
      else await route.abort();
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof cargarCatalogoPublico === 'function');
    await page.evaluate(async (datos) => {
      const respuesta = Promise.resolve({ data: datos, error: null });
      const consulta = { select: () => consulta, eq: () => consulta, order: () => respuesta };
      window.supabaseClient = { ...window.supabaseClient, from: () => consulta };
      await cargarCatalogoPublico();
    }, productos);
    await page.locator('[data-add-id="1"]').click();
    await page.locator('[data-add-id="2"]').click();
    await page.locator('#cart-btn').click();
    await page.waitForTimeout(400);

    // Los controles de cada linea se pueden tocar: 24 px es el minimo de WCAG.
    const tamanos = await page.evaluate(() => [...document.querySelectorAll('#cart-items-container button')]
      .map(b => { const c = b.getBoundingClientRect(); return { texto: b.textContent.trim(), alto: Math.round(c.height), ancho: Math.round(c.width) }; }));
    const chicos = tamanos.filter(t => t.alto < 24 || t.ancho < 24);
    check(`${etiqueta}: los botones de las lineas miden al menos 24 px`, tamanos.length === 6 && chicos.length === 0,
      chicos.map(t => `${t.texto} ${t.ancho}x${t.alto}`).join(', ') || `${tamanos.length} botones`);

    // El nombre largo cabe en dos renglones como mucho.
    const renglones = await page.evaluate(() => {
      const el = [...document.querySelectorAll('#cart-items-container *')].find(e => e.childElementCount === 0 && e.textContent.trim() === 'Puerta Principal dos puertas')
        || [...document.querySelectorAll('#cart-items-container .cart-item')][0].firstElementChild;
      const alto = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.2;
      return Math.round(el.getBoundingClientRect().height / alto);
    });
    check(`${etiqueta}: el nombre largo ocupa dos renglones o menos`, renglones <= 2, `${renglones} renglones`);

    const cajon = await page.evaluate(() => {
      const c = document.getElementById('cart-modal');
      return { dentro: c.getBoundingClientRect().right <= window.innerWidth + 0.5, desborda: c.scrollWidth > c.clientWidth };
    });
    check(`${etiqueta}: el carrito cabe en la pantalla sin desbordarse`, cajon.dentro && !cajon.desborda);

    // Las cantidades siguen funcionando con los mismos atributos.
    await page.locator('[data-qty-id="1"][data-delta="1"]').click();
    const qty = await page.evaluate(() => cart.find(l => l.id === 1)?.qty);
    check(`${etiqueta}: + sube la cantidad`, qty === 2, `qty=${qty}`);
    await page.locator('[data-remove-id="2"]').click();
    const quedan = await page.evaluate(() => cart.map(l => l.id).join(','));
    check(`${etiqueta}: Quitar saca la linea`, quedan === '1', `quedan ${quedan}`);

    // Tocar fuera cierra el carrito: el punto tocado es del fondo, no de la pagina.
    const fuera = await page.evaluate(() => {
      const el = document.elementFromPoint(5, window.innerHeight / 2);
      return el?.id || el?.tagName.toLowerCase();
    });
    if (ancho > 500) {
      check(`${etiqueta}: fuera del carrito abierto hay un fondo que cubre la pagina`, fuera === 'cart-fondo', `toque en ${fuera}`);
      await page.mouse.click(5, alto / 2);
      await page.waitForTimeout(400);
      check(`${etiqueta}: tocar el fondo cierra el carrito`, !(await page.evaluate(() => document.getElementById('cart-modal').classList.contains('open'))));
      await page.locator('#cart-btn').click();
      await page.waitForTimeout(400);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const cerrado = await page.evaluate(() => ({
      abierto: document.getElementById('cart-modal').classList.contains('open'),
      fondo: document.getElementById('cart-fondo') ? getComputedStyle(document.getElementById('cart-fondo')).pointerEvents : 'none',
    }));
    check(`${etiqueta}: Escape cierra el carrito y el fondo deja de bloquear`, !cerrado.abierto && cerrado.fondo === 'none');
    await context.close();
  }
} finally {
  await browser.close();
}

const fallidas = checks.filter(ok => !ok).length;
console.log(`${checks.length - fallidas}/${checks.length} comprobaciones del carrito.`);
if (fallidas) process.exitCode = 1;
