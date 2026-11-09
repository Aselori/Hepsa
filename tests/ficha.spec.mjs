// Ficha de producto del catálogo público, con un catálogo simulado.
//
// La ficha es lo único que muestra la descripción al cliente. Se prueba que
// se abre y se cierra como el cliente espera (fondo, Esc, Atrás, deslizar en
// el teléfono), que la descripción entra como texto y se ordena en
// especificaciones, que la compra respeta el tope de existencias, que se
// recorre el catálogo sin salir y que un enlace compartido la abre.
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
  { id: 3, name: 'Puerta principal de dos hojas', price: 9000, stock: 5, image_url: null,
    description: 'Altura: 2.10 m\nMaterial: acero\nApta para interiores y exteriores.' },
];

async function preparar(context, ruta = '/index.html') {
  const page = await context.newPage();
  await page.goto(`${BASE}${ruta}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof cargarCatalogoPublico === 'function');
  await page.evaluate(async (datos) => {
    window.__xss = 0;
    const respuesta = Promise.resolve({ data: datos, error: null });
    const consulta = { select: () => consulta, eq: () => consulta, order: () => respuesta };
    window.supabaseClient = { ...window.supabaseClient, from: () => consulta };
    await cargarCatalogoPublico();
  }, productos);
  return page;
}
const abierta = (page) => page.evaluate(() => document.getElementById('ficha-producto').open);
const esperar = (page, ms = 250) => page.waitForTimeout(ms);

const browser = await chromium.launch();
try {
  for (const [ancho, alto, etiqueta] of [[390, 844, 'telefono 390px'], [1366, 900, 'escritorio 1366px']]) {
    const context = await browser.newContext({ viewport: { width: ancho, height: alto }, hasTouch: ancho < 600 });
    await context.route('**/*', async (route) => {
      if (new URL(route.request().url()).origin === BASE_ORIGIN) await route.continue();
      else await route.abort();
    });
    const page = await preparar(context);
    const ficha = page.locator('#ficha-producto');

    // ── Abrir, contenido y seguridad ───────────────────────────────────────
    await page.locator('.product-title button[data-detalle-id="1"]').click();
    check(`${etiqueta}: el título abre la ficha`, await ficha.isVisible());
    await esperar(page, 400); // la animación de entrada termina
    check(`${etiqueta}: la ficha tiene su dirección`, page.url().endsWith('#producto-1'), page.url());
    const contenido = await page.evaluate(() => ({
      nombre: document.getElementById('ficha-nombre').textContent,
      descripcion: document.getElementById('ficha-descripcion').textContent,
      inyectadas: document.querySelectorAll('#ficha-producto .ficha-cuerpo img').length,
      foto: document.getElementById('ficha-foto').getAttribute('src'),
      xss: window.__xss,
    }));
    check(`${etiqueta}: la ficha muestra la descripción`, contenido.nombre === 'Portón residencial' && contenido.descripcion.includes('3.00 × 2.10 m'), contenido.descripcion);
    check(`${etiqueta}: la descripción entra como texto, no como HTML`, contenido.inyectadas === 0 && contenido.xss === 0 && contenido.descripcion.includes('<img'));
    check(`${etiqueta}: la ficha usa la foto del producto`, contenido.foto?.endsWith('assets/productos/porton-cochera.jpg'), contenido.foto);
    const caja = await ficha.boundingBox();
    check(`${etiqueta}: la ficha cabe en la pantalla`, caja && caja.x >= 0 && caja.x + caja.width <= ancho + 0.5 && caja.y >= 0 && caja.y + caja.height <= alto + 0.5, JSON.stringify(caja));
    if (ancho < 600) check(`${etiqueta}: en el teléfono la ficha es una hoja pegada abajo`, Math.abs(caja.y + caja.height - alto) < 1.5 && caja.width >= ancho - 1, JSON.stringify(caja));
    await page.screenshot({ path: `tests/screenshots/ficha-${ancho}.png` });

    // ── Compra con tope ────────────────────────────────────────────────────
    const agregar = page.locator('#ficha-agregar');
    await agregar.click();
    const tras1 = await page.evaluate(() => ({ qty: cart.find((l) => l.id === 1)?.qty, nota: document.getElementById('ficha-existencias').textContent, lleva: document.getElementById('ficha-en-carrito').textContent }));
    check(`${etiqueta}: agregar actualiza existencias y dice cuánto llevas`, tras1.qty === 1 && tras1.nota === 'Queda 1 disponible' && tras1.lleva.startsWith('En tu carrito: 1 pieza'), JSON.stringify(tras1));
    await agregar.click();
    const tope = await page.evaluate(() => ({ qty: cart.find((l) => l.id === 1)?.qty, boton: document.getElementById('ficha-agregar').textContent, apagado: document.getElementById('ficha-agregar').disabled }));
    check(`${etiqueta}: la ficha respeta el tope de existencias`, tope.qty === 2 && tope.apagado && tope.boton === 'Sin más existencias', JSON.stringify(tope));

    // ── Foto ampliada: Esc la regresa sin cerrar la ficha ──────────────────
    await page.locator('#ficha-foto').click();
    const zoom = await page.evaluate(() => document.getElementById('ficha-producto').classList.contains('zoom'));
    await page.keyboard.press('Escape');
    check(`${etiqueta}: la foto se amplía y Esc sólo la regresa`, zoom && await abierta(page) && !(await page.evaluate(() => document.getElementById('ficha-producto').classList.contains('zoom'))));

    // ── Recorrer el catálogo ───────────────────────────────────────────────
    check(`${etiqueta}: en el primer producto no hay anterior`, await page.locator('#ficha-anterior').isDisabled());
    await page.locator('#ficha-siguiente').click();
    check(`${etiqueta}: la flecha lleva al siguiente producto`, (await page.locator('#ficha-nombre').textContent()) === 'Barandal' && page.url().endsWith('#producto-2'), page.url());
    const sinFoto = await page.evaluate(() => ({ foto: document.getElementById('ficha-foto').hidden, aviso: !document.getElementById('ficha-sin-foto').hidden, desc: document.getElementById('ficha-descripcion').hidden }));
    check(`${etiqueta}: un producto sin foto ni descripción se ve limpio`, sinFoto.foto && sinFoto.aviso && sinFoto.desc, JSON.stringify(sinFoto));
    await page.locator('#ficha-mas').click();
    await page.locator('#ficha-mas').click();
    await agregar.click();
    check(`${etiqueta}: la cantidad elegida se agrega de una vez`, (await page.evaluate(() => cart.find((l) => l.id === 2)?.qty)) === 3);
    await page.locator('#ficha-nombre').click();
    await page.keyboard.press('ArrowRight');
    await esperar(page);
    const specs = await page.evaluate(() => ({
      nombre: document.getElementById('ficha-nombre').textContent,
      claves: [...document.querySelectorAll('#ficha-specs dt')].map((d) => d.textContent),
      valores: [...document.querySelectorAll('#ficha-specs dd')].map((d) => d.textContent),
      resto: document.getElementById('ficha-descripcion').textContent,
    }));
    check(`${etiqueta}: la flecha del teclado avanza y la descripción se ordena en especificaciones`,
      specs.nombre === 'Puerta principal de dos hojas' && specs.claves.join() === 'Altura,Material' && specs.valores.join() === '2.10 m,acero' && specs.resto === 'Apta para interiores y exteriores.',
      JSON.stringify(specs));
    check(`${etiqueta}: en el último producto no hay siguiente`, await page.locator('#ficha-siguiente').isDisabled());

    // ── Cerrar: Atrás, fondo y Esc ─────────────────────────────────────────
    await page.goBack();
    await esperar(page);
    check(`${etiqueta}: el botón Atrás cierra la ficha (no recorre los productos vistos)`, !(await abierta(page)) && !page.url().includes('#producto'), page.url());
    await page.locator('.product-title button[data-detalle-id="3"]').click();
    if (ancho < 600) await page.mouse.click(ancho / 2, 20);
    else await page.mouse.click(15, alto / 2);
    await esperar(page);
    check(`${etiqueta}: tocar el fondo cierra la ficha`, !(await abierta(page)) && !page.url().includes('#producto'), page.url());
    await page.locator('.product-title button[data-detalle-id="3"]').click();
    await page.keyboard.press('Escape');
    await esperar(page);
    check(`${etiqueta}: Esc cierra la ficha y limpia la dirección`, !(await abierta(page)) && !page.url().includes('#producto'), page.url());

    // ── Cotizar a otra medida y logo ───────────────────────────────────────
    await page.locator('.product-title button[data-detalle-id="3"]').click();
    await page.locator('#ficha-cotizar').click();
    await esperar(page);
    const cotizar = await page.evaluate(() => ({
      vista: document.getElementById('view-quote').classList.contains('active'),
      material: document.getElementById('quote-material').value,
      notas: document.getElementById('quote-specs').value,
      abierta: document.getElementById('ficha-producto').open,
    }));
    check(`${etiqueta}: "Cotízalo" abre el cotizador con el material y una nota del producto`,
      cotizar.vista && !cotizar.abierta && cotizar.material === 'acero' && cotizar.notas.includes('Puerta principal de dos hojas'), JSON.stringify(cotizar));
    await page.locator('.logo-container').click();
    check(`${etiqueta}: el logo lleva al catálogo`, await page.locator('#view-catalog').isVisible() && !(await page.locator('#view-quote').isVisible()));
    await context.close();

    // ── Enlace compartido ──────────────────────────────────────────────────
    const otro = await browser.newContext({ viewport: { width: ancho, height: alto } });
    await otro.route('**/*', async (route) => (new URL(route.request().url()).origin === BASE_ORIGIN ? route.continue() : route.abort()));
    const compartida = await preparar(otro, '/index.html#producto-3');
    check(`${etiqueta}: un enlace a #producto-3 abre esa ficha`, await abierta(compartida) && (await compartida.locator('#ficha-nombre').textContent()) === 'Puerta principal de dos hojas');
    await compartida.goBack();
    await esperar(compartida);
    check(`${etiqueta}: y Atrás la cierra sin salir del sitio`, !(await abierta(compartida)) && compartida.url().startsWith(`${BASE}/index.html`), compartida.url());
    await otro.close();
  }
} finally {
  await browser.close();
}

const fallidas = checks.filter((ok) => !ok).length;
console.log(`${checks.length - fallidas}/${checks.length} comprobaciones de la ficha de producto.`);
if (fallidas) process.exitCode = 1;
