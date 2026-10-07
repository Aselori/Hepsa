// Regresion aislada: inyeccion de CSS por image_url en el catalogo publico.
//
// La URL de la imagen iba dentro de style="background-image: url('...')",
// escapada como HTML. Eso no protege ahi: el navegador decodifica &#39; de
// vuelta a ' antes de que CSS lea el valor, asi que una comilla simple cerraba
// url('...') y el resto se interpretaba como CSS del catalogo publico.
// image_url solo lo escribe el personal, pero bastaba una cuenta de personal
// comprometida para rastrear a cada visitante o desarmar la tienda.
//
// La senal mas fiable es de comportamiento, no de texto: si la inyeccion
// funciona, el navegador intenta descargar la URL del atacante y aplica el
// color inyectado. Se registran los intentos de red en vez de solo mirar cadenas.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:8000';
const BASE_ORIGIN = new URL(BASE).origin;

const checks = [];
function check(nombre, ok, detalle = '') {
  checks.push(ok);
  console.log(`${ok ? 'PASA' : 'FALLA'} ${nombre}${detalle ? '  — ' + detalle : ''}`);
}

const MALICIOSA = "https://imagenes.test/a.png'); background: url(https://rastreo.test/pixel.gif); color: rgb(255, 0, 0); x: ('";
const productos = [
  { id: 1, name: 'Inyeccion', price: 100, stock: 5, image_url: MALICIOSA },
  { id: 2, name: 'Legitima', price: 200, stock: 5, image_url: 'https://imagenes.test/porton.jpg' },
  { id: 3, name: 'Protocolo javascript', price: 300, stock: 5, image_url: 'javascript:alert(1)' },
  { id: 4, name: 'Http ajeno', price: 400, stock: 5, image_url: 'http://ajeno.test/foto.jpg' },
  { id: 5, name: 'Sin imagen', price: 500, stock: 5, image_url: null },
];

const browser = await chromium.launch();
const context = await browser.newContext();
const intentos = [];
await context.route('**/*', async route => {
  const url = route.request().url();
  if (new URL(url).origin === BASE_ORIGIN) return route.continue();
  intentos.push(url);
  return route.abort();
});
const page = await context.newPage();
try {
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof cargarCatalogoPublico === 'function');
  await page.evaluate(async (datos) => {
    const respuesta = Promise.resolve({ data: datos, error: null });
    const consulta = { select: () => consulta, eq: () => consulta, order: () => respuesta };
    window.supabaseClient = { ...window.supabaseClient, from: () => consulta };
    await cargarCatalogoPublico();
  }, productos);
  await page.waitForTimeout(800);

  // Se localiza la tarjeta por posicion y no por un atributo del arreglo, para
  // que la prueba funcione igual contra el codigo viejo y demuestre la
  // inyeccion, en vez de fallar por no encontrar un selector nuevo.
  const caja = (id) => page.evaluate((i) => {
    // La caja de imagen se busca dentro de su tarjeta: un producto sin foto
    // ya no tiene caja, y contarlas en toda la pagina desfasaria las demas.
    const el = document.querySelectorAll('.product-card')[i - 1].querySelector('.card-img');
    if (!el) return { bg: '', color: getComputedStyle(document.body).color, ajenas: [], tieneUrl: false, sinFoto: true };
    const cs = getComputedStyle(el);
    // Propiedades realmente declaradas en el elemento. Una inyeccion que
    // funcione agrega propiedades nuevas (color, etc.); el texto dentro de la
    // URL no cuenta, porque es parte de un solo valor.
    const ajenas = [...el.style].filter(prop => !prop.startsWith('background'));
    return { bg: el.style.backgroundImage, color: cs.color, ajenas,
             tieneUrl: el.style.backgroundImage.includes('url('),
             sinFoto: /sin foto/i.test(el.textContent) };
  }, id);

  const mala = await caja(1);
  check('la URL con comilla no inyecta un color', mala.color !== 'rgb(255, 0, 0)', `color=${mala.color}`);
  // Por HOST, no por texto: con el arreglo, rastreo.test solo aparece como
  // texto codificado dentro de la ruta de una unica URL a imagenes.test.
  const hosts = intentos.map(u => new URL(u).hostname);
  check('el navegador no intenta descargar nada de rastreo.test',
    !hosts.includes('rastreo.test'), `hosts=${JSON.stringify([...new Set(hosts)])}`);
  check('no se declara ninguna propiedad CSS inyectada', mala.ajenas.length === 0,
    `ajenas=${JSON.stringify(mala.ajenas)}`);

  const buena = await caja(2);
  check('una URL https legitima si se pinta', buena.bg.includes('imagenes.test/porton.jpg') && !buena.sinFoto, buena.bg);

  const js = await caja(3);
  check('javascript: se trata como producto sin foto', !js.tieneUrl && js.sinFoto, js.bg);

  const http = await caja(4);
  check('http ajeno se trata como producto sin foto', !http.tieneUrl && http.sinFoto, http.bg);

  const nada = await caja(5);
  check('sin image_url sigue mostrando SIN FOTO', !nada.tieneUrl && nada.sinFoto, nada.bg);
} finally {
  await context.close();
  await browser.close();
}

const fallidas = checks.filter(ok => !ok).length;
console.log(`${checks.length - fallidas}/${checks.length} comprobaciones de imagen del catalogo.`);
if (fallidas) process.exitCode = 1;
