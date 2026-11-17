// Regresión aislada de las notas de los pedidos (notas_pedido): el taller las
// lee y agrega desde Producción, y quien vende las ve en Ventas. Red externa
// bloqueada y Supabase simulado; los permisos se prueban en roles.spec.mjs.
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
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin === BASE_ORIGIN) await route.continue();
    else await route.abort();
  });
  const page = await context.newPage();
  const dialogos = [];
  page.on('dialog', async d => { dialogos.push(d.message()); await d.dismiss(); });

  await page.goto(`${BASE}/admin.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#access-error', { timeout: 15000 });

  // simular({ notasFallan, guardarFalla }): Supabase de mentiras para el taller.
  const simular = (opciones) => page.evaluate(async ({ notasFallan, guardarFalla }) => {
    document.getElementById('access-error')?.remove();
    for (const hijo of document.body.children) hijo.style.removeProperty('display');
    document.body.style.display = 'flex';
    const xss = '<img src=x onerror="window.__xss=1">';
    window.__xss = 0;
    window.__llamadas = [];
    const notas = [{ pedido_id: 7, autor_nombre: 'Tomás Taller', texto: `Falta lámina de 14 ${xss}`, creado: '2026-11-16T15:00:00Z' }];
    const pedidos = [{ id: 7, creado: new Date().toISOString(), estado: 'en_produccion', cliente: 'Ana Prueba', telefono: '81 1234 5678',
                       notas: 'Instalar en la tarde', conceptos: [{ concepto: 'Barandal', cantidad: 1 }] }];
    window.supabaseClient = {
      from(tabla) {
        const respuesta = () => notasFallan && tabla === 'notas_pedido'
          ? { data: null, error: { message: 'relation "public.notas_pedido" does not exist' } }
          : { data: tabla === 'notas_pedido' ? notas : [], error: null };
        const consulta = {
          select() { return consulta; },
          in(col, ids) { window.__llamadas.push({ tabla, col, ids }); return consulta; },
          order() { return Promise.resolve(respuesta()); },
        };
        return consulta;
      },
      async rpc(nombre, args) {
        window.__llamadas.push({ rpc: nombre, args });
        if (nombre === 'pedidos_de_taller') return { data: structuredClone(pedidos), error: null };
        if (nombre === 'agregar_nota_pedido') {
          if (guardarFalla) return { data: null, error: { message: 'El taller sólo anota pedidos en producción o instalados' } };
          return { data: { pedido_id: args.p_pedido, autor_nombre: 'Tomás Taller', texto: args.p_texto, creado: new Date().toISOString() }, error: null };
        }
        return { data: null, error: null };
      },
    };
    showAdminView('produccion');
    await cargarProduccionBD();
  }, { notasFallan: false, guardarFalla: false, ...opciones });

  await simular();
  const tarjeta = page.locator('#produccion-lista .pedido-taller', { hasText: 'Pedido 7 ' });
  const notas = tarjeta.locator('.notas-taller li');
  const primera = await notas.first().innerText().catch(() => '');
  check('la tarjeta muestra la nota del taller con su autor', await notas.count() === 1 && /Falta lámina de 14/.test(primera) && /Tomás Taller/.test(primera), primera.replace(/\n/g, ' | '));
  check('la nota se pinta como texto, no como HTML', await page.evaluate(() => window.__xss) === 0 && primera.includes('<img'));
  const consulta = await page.evaluate(() => window.__llamadas.find((l) => l.tabla === 'notas_pedido'));
  check('pide sólo las notas de los pedidos de la lista', JSON.stringify(consulta?.ids) === '[7]', JSON.stringify(consulta));
  check('el campo de la nota está plegado hasta pedirlo', await tarjeta.locator('textarea').isHidden());

  await tarjeta.getByRole('button', { name: 'Agregar nota' }).click();
  const campo = tarjeta.locator('textarea[aria-label="Nota para el pedido 7"]');
  check('"Agregar nota" abre un campo con nombre accesible', await campo.isVisible());
  await campo.fill('  El cliente cambió la fecha al jueves  ');
  await tarjeta.getByRole('button', { name: 'Guardar nota' }).click();
  await notas.nth(1).waitFor({ timeout: 3000 }).catch(() => {});
  const guardada = await page.evaluate(() => window.__llamadas.find((l) => l.rpc === 'agregar_nota_pedido')?.args);
  check('guardar llama a agregar_nota_pedido con el pedido y el texto recortado',
    guardada?.p_pedido === 7 && guardada?.p_texto === 'El cliente cambió la fecha al jueves', JSON.stringify(guardada));
  check('la nota nueva aparece al final sin recargar', await notas.count() === 2 && /jueves/.test(await notas.nth(1).innerText()));
  check('el campo se cierra y queda vacío', await campo.isHidden() && await campo.inputValue() === '');
  const aviso = await page.locator('#toast-container').innerText();
  check('se avisa que se guardó', /Nota agregada al pedido 7/.test(aviso), aviso);
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check('en teléfono nada se sale de la pantalla', ancho);
  await page.screenshot({ path: 'tests/screenshots/notas-taller-telefono.png', fullPage: true }).catch(() => {});

  await simular({ guardarFalla: true });
  await tarjeta.getByRole('button', { name: 'Agregar nota' }).click();
  await campo.fill('No debe perderse');
  await tarjeta.getByRole('button', { name: 'Guardar nota' }).click();
  await page.waitForTimeout(300);
  const error = await page.locator('#toast-container').innerText();
  check('si la base la rechaza, se dice por qué y el texto se conserva',
    /No se pudo guardar la nota: El taller sólo anota/.test(error) && await campo.inputValue() === 'No debe perderse' && await notas.count() === 1, error);

  await simular({ notasFallan: true });
  check('sin la tabla de notas (migración pendiente) la tarjeta sale igual',
    await tarjeta.count() === 1 && /Barandal/.test(await tarjeta.innerText()));
  check('y no ofrece agregar notas que no se podrían guardar', await tarjeta.getByRole('button', { name: 'Agregar nota' }).count() === 0);

  // ── Ventas: quien vende lee lo que anotó el taller ────────────────────────
  await page.evaluate(async () => {
    const datos = {
      orders: [{ id: 7, created_at: '2026-11-16T12:00:00Z', client_first_name: 'Ana', client_last_name: 'Prueba', total: 100, payment_status: 'completo', notes: 'Instalar en la tarde' },
               { id: 8, created_at: '2026-11-16T12:00:00Z', client_first_name: 'Sin', client_last_name: 'Ticket', total: 100, payment_status: 'completo', notes: null }],
      notas_pedido: [{ pedido_id: 7, autor_nombre: 'Tomás Taller', texto: 'Falta lámina', creado: '2026-11-16T15:00:00Z' },
                     { pedido_id: 8, autor_nombre: 'Tomás Taller', texto: 'Listo para instalar', creado: '2026-11-16T16:00:00Z' }],
    };
    window.supabaseClient = {
      from(tabla) {
        const consulta = { select() { return consulta; }, order() { return Promise.resolve({ data: datos[tabla] || [], error: null }); } };
        return consulta;
      },
    };
    await cargarHistorialBD();
  });
  const celdas = await page.evaluate(() => [...document.querySelectorAll('#history-table-body tr')].map((tr) => tr.lastElementChild.innerText));
  check('en Ventas la nota del taller va debajo de la del ticket',
    celdas.some((t) => /Instalar en la tarde/.test(t) && /Tomás Taller: Falta lámina/.test(t)), JSON.stringify(celdas));
  check('sin nota del ticket no queda el guion de vacío junto a la del taller',
    celdas.some((t) => t.trim() === 'Tomás Taller: Listo para instalar'), JSON.stringify(celdas));
  check('nada abrió ventanas emergentes', dialogos.length === 0, dialogos.join(' / '));
  await context.close();
} finally {
  await browser.close();
}

const fallidas = checks.filter(ok => !ok).length;
console.log(`${checks.length - fallidas}/${checks.length} comprobaciones de las notas del taller.`);
if (fallidas) process.exitCode = 1;
