// Regresion aislada del encabezado en pantallas angostas. Bloquea toda red
// externa, asi que no necesita Supabase, cuentas ni credenciales: solo mide
// la caja del encabezado y si el boton de acceso es alcanzable.
//
// Por que existe: el encabezado era una sola fila que no se partia, con un
// ancho intrinseco de unos 875px pasara lo que pasara. Por debajo de eso la
// pagina se desbordaba en horizontal y el boton de Iniciar Sesion quedaba
// fuera de la ventana, imposible de pulsar. Se habia detectado una vez al
// sacar capturas y se perdio sin arreglar, asi que conviene que una prueba lo
// sostenga.
//
// Importa mas de lo que sugiere el tamano del arreglo: el codigo del segundo
// factor se lee en el telefono, asi que para el personal entrar desde el movil
// es el caso normal.
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
  // Un telefono estrecho, uno comun y una tablet. La tablet tambien se
  // desbordaba, asi que no basta con mirar el caso mas angosto.
  for (const [ancho, alto, etiqueta] of [[390, 844, 'telefono 390px'],
                                         [430, 932, 'telefono 430px'],
                                         [768, 1024, 'tablet 768px']]) {
    const context = await browser.newContext({ viewport: { width: ancho, height: alto } });
    await context.route('**/*', async route => {
      if (new URL(route.request().url()).origin === BASE_ORIGIN) await route.continue();
      else await route.abort();
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('nav button', { timeout: 15000 });

    const medida = await page.evaluate(() => {
      const login = document.getElementById('btn-login');
      const caja = login.getBoundingClientRect();
      // elementFromPoint dice quien recibiria el toque en ese punto: es la
      // comprobacion que de verdad importa, porque un boton puede estar
      // dibujado y aun asi quedar tapado o fuera de la ventana.
      const encima = document.elementFromPoint(caja.x + caja.width / 2, caja.y + caja.height / 2);
      return {
        desborda: document.documentElement.scrollWidth > window.innerWidth,
        dentro: caja.x >= 0 && caja.x + caja.width <= window.innerWidth,
        alcanzable: encima === login || login.contains(encima),
      };
    });

    check(`${etiqueta}: la pagina no se desborda en horizontal`, !medida.desborda);
    check(`${etiqueta}: Iniciar Sesion cabe en la ventana`, medida.dentro);
    check(`${etiqueta}: Iniciar Sesion recibe el toque`, medida.alcanzable);
    await context.close();
  }

  // Y que el arreglo no se haya llevado por delante el escritorio.
  const escritorio = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await escritorio.route('**/*', async route => {
    if (new URL(route.request().url()).origin === BASE_ORIGIN) await route.continue();
    else await route.abort();
  });
  const pagina = await escritorio.newPage();
  await pagina.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('nav button', { timeout: 15000 });
  const enEscritorio = await pagina.evaluate(() => {
    const nav = [...document.querySelector('nav').children];
    const centros = nav.map(e => { const c = e.getBoundingClientRect(); return c.y + c.height / 2; });
    // Si todos los centros caben en una franja de 20px, siguen en una sola fila.
    return { desborda: document.documentElement.scrollWidth > window.innerWidth,
             unaFila: Math.max(...centros) - Math.min(...centros) < 20 };
  });
  check('escritorio 1366px: sigue sin desbordarse', !enEscritorio.desborda);
  check('escritorio 1366px: el menu sigue en una sola fila', enEscritorio.unaFila);
  await escritorio.close();
} finally {
  await browser.close();
}

const fallidas = checks.filter(ok => !ok).length;
console.log(`${checks.length - fallidas}/${checks.length} comprobaciones de encabezado responsivo.`);
if (fallidas) process.exitCode = 1;
