// Regresión aislada de las notas internas (tabla notes): el taller las lee y
// agrega desde Producción (le llegan en workshop_orders), y quien vende las
// lee y agrega en Ventas y en Solicitudes. Red externa bloqueada y Supabase
// simulado; los permisos se prueban contra la base en roles.spec.mjs.
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

  // Supabase de mentiras: tablas en `datos`, RPC registradas en __llamadas.
  const simular = (opciones) => page.evaluate(async ({ guardarFalla }) => {
    document.getElementById('access-error')?.remove();
    for (const hijo of document.body.children) hijo.style.removeProperty('display');
    document.body.style.display = 'flex';
    const xss = '<img src=x onerror="window.__xss=1">';
    window.__xss = 0;
    window.__llamadas = [];
    const nota = (extra) => ({ author_name: 'Tomás Taller', author_role: 'workshop', created_at: '2026-11-16T15:00:00Z', ...extra });
    window.__datos = {
      notes: [nota({ order_id: 7, body: 'Falta lámina' }),
              nota({ request_id: 'r-1', author_name: 'Vero Ventas', author_role: 'seller', body: 'Llamar el lunes' })],
      orders: [{ id: 7, created_at: '2026-11-16T12:00:00Z', client_first_name: 'Ana', client_last_name: 'Prueba', total: 100, payment_status: 'paid', notes: 'Instalar en la tarde' }],
      custom_requests: [{ id: 'r-1', first_name: 'Luis', last_name: 'Prueba', length_mm: 1000, height_mm: 500, material: 'steel', finish: 'bluing',
                          estimated_price: 100, status: 'pending', created_at: new Date().toISOString(), quote_expires_at: new Date(Date.now() + 864e5).toISOString() }],
    };
    const pedidos = [{ id: 7, created_at: new Date().toISOString(), status: 'in_production', client: 'Ana Prueba', phone: '81 1234 5678',
                       notes: 'Instalar en la tarde', items: [{ label: 'Barandal', quantity: 1 }],
                       internal_notes: [nota({ body: `Falta lámina de 14 ${xss}` })] }];
    window.supabaseClient = {
      from(tabla) {
        const filtros = [];
        const consulta = {
          select() { return consulta; },
          not(col) { filtros.push((f) => f[col] != null); return consulta; },
          order() { return Promise.resolve({ data: (window.__datos[tabla] || []).filter((f) => filtros.every((ok) => ok(f))), error: null }); },
        };
        return consulta;
      },
      async rpc(nombre, args) {
        window.__llamadas.push({ rpc: nombre, args });
        if (nombre === 'workshop_orders') return { data: structuredClone(pedidos), error: null };
        if (nombre === 'add_note') {
          if (guardarFalla) return { data: null, error: { message: 'El taller sólo anota pedidos en producción o instalados' } };
          return { data: nota({ order_id: args.p_order_id ?? null, request_id: args.p_request_id ?? null, body: args.p_body, created_at: new Date().toISOString() }), error: null };
        }
        return { data: [], error: null };
      },
    };
    showAdminView('produccion');
    await cargarProduccionBD();
  }, { guardarFalla: false, ...opciones });

  // ── Producción ──────────────────────────────────────────────────────────
  await simular();
  const tarjeta = page.locator('#produccion-lista .pedido-taller', { hasText: 'Pedido 7 ' });
  const notas = tarjeta.locator('.notas-internas li');
  const primera = await notas.first().innerText().catch(() => '');
  check('la tarjeta muestra la nota con rol, autor y fecha', await notas.count() === 1 && /Falta lámina de 14/.test(primera) && /Taller · Tomás Taller/.test(primera), primera.replace(/\n/g, ' | '));
  check('la nota se pinta como texto, no como HTML', await page.evaluate(() => window.__xss) === 0 && primera.includes('<img'));
  check('el taller no consulta la tabla de notas: le llegan con sus pedidos',
    await page.evaluate(() => window.__llamadas.every((l) => l.rpc)));
  check('el campo de la nota está plegado hasta pedirlo', await tarjeta.locator('textarea').isHidden());

  await tarjeta.getByRole('button', { name: 'Agregar nota' }).click();
  const campo = tarjeta.locator('textarea[aria-label="Notas internas del pedido 7"]');
  check('"Agregar nota" abre un campo con nombre accesible', await campo.isVisible());
  await campo.fill('  El cliente cambió la fecha al jueves  ');
  await tarjeta.getByRole('button', { name: 'Guardar nota' }).click();
  await notas.nth(1).waitFor({ timeout: 3000 }).catch(() => {});
  const guardada = await page.evaluate(() => window.__llamadas.find((l) => l.rpc === 'add_note')?.args);
  check('guardar llama a add_note con el pedido y el texto recortado',
    guardada?.p_order_id === 7 && guardada?.p_body === 'El cliente cambió la fecha al jueves' && !('p_request_id' in guardada), JSON.stringify(guardada));
  check('la nota nueva aparece al final sin recargar', await notas.count() === 2 && /jueves/.test(await notas.nth(1).innerText()));
  check('el campo se cierra y queda vacío', await campo.isHidden() && await campo.inputValue() === '');
  const aviso = await page.locator('#toast-container').innerText();
  check('se avisa que se guardó', /Nota guardada/.test(aviso), aviso);
  check('en teléfono nada se sale de la pantalla', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: 'tests/screenshots/notas-taller-telefono.png', fullPage: true }).catch(() => {});

  await simular({ guardarFalla: true });
  await tarjeta.getByRole('button', { name: 'Agregar nota' }).click();
  await campo.fill('No debe perderse');
  await tarjeta.getByRole('button', { name: 'Guardar nota' }).click();
  await page.waitForTimeout(300);
  const error = await page.locator('#toast-container').innerText();
  check('si la base la rechaza, se dice por qué y el texto se conserva',
    /No se pudo guardar la nota: El taller sólo anota/.test(error) && await campo.inputValue() === 'No debe perderse' && await notas.count() === 1, error);

  // ── Ventas ──────────────────────────────────────────────────────────────
  await simular();
  await page.evaluate(async () => { showAdminView('history'); await cargarHistorialBD(); });
  const celda = page.locator('#history-table-body tr').first().locator('td.celda-notas');
  const textoCelda = await celda.innerText().catch(() => '');
  check('en Ventas la nota del ticket va arriba y las internas debajo, con quién las escribió',
    /Instalar en la tarde[\s\S]*Falta lámina[\s\S]*Taller · Tomás Taller/.test(textoCelda), textoCelda.replace(/\n/g, ' | '));
  await celda.getByRole('button', { name: 'Agregar nota' }).click();
  await celda.getByRole('textbox', { name: 'Notas internas del folio #7' }).fill('Pagará el resto en efectivo');
  await celda.getByRole('button', { name: 'Guardar nota' }).click();
  await celda.locator('li', { hasText: 'efectivo' }).waitFor({ timeout: 3000 }).catch(() => {});
  check('quien vende agrega una nota desde Ventas', await celda.locator('li').count() === 2);

  // ── Solicitudes ─────────────────────────────────────────────────────────
  await page.evaluate(async () => { window.__llamadas = []; showAdminView('projects'); await cargarProyectosBD(); });
  const fila = page.locator('#projects-table-body tr', { hasText: 'Luis Prueba' });
  const textoFila = await fila.innerText().catch(() => '');
  check('cada solicitud trae sus notas internas', /Llamar el lunes/.test(textoFila) && /Ventas · Vero Ventas/.test(textoFila), textoFila.replace(/\n/g, ' | '));
  check('el estado de la solicitud se lee en español', /Pendiente de revisión/.test(await fila.locator('select').first().innerText()));
  await fila.getByRole('button', { name: 'Agregar nota' }).click();
  await fila.getByRole('textbox', { name: 'Notas internas de la solicitud de Luis Prueba' }).fill('Quiere verlo en aluminio');
  await fila.getByRole('button', { name: 'Guardar nota' }).click();
  await page.waitForTimeout(300);
  const deSolicitud = await page.evaluate(() => window.__llamadas.find((l) => l.rpc === 'add_note')?.args);
  check('la nota de una solicitud se guarda con la solicitud, no con un pedido',
    deSolicitud?.p_request_id === 'r-1' && !('p_order_id' in deSolicitud), JSON.stringify(deSolicitud));
  check('nada abrió ventanas emergentes', dialogos.length === 0, dialogos.join(' / '));
  await context.close();
} finally {
  await browser.close();
}

const fallidas = checks.filter(ok => !ok).length;
console.log(`${checks.length - fallidas}/${checks.length} comprobaciones de las notas internas.`);
if (fallidas) process.exitCode = 1;
