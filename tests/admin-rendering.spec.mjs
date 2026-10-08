// Regresión aislada para las vistas del panel. Usa datos sintéticos y bloquea
// toda red externa, por lo que no necesita Supabase, cuentas ni credenciales.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:8000';
const BASE_ORIGIN = new URL(BASE).origin;
const browser = await chromium.launch();
const context = await browser.newContext();
await context.route('**/*', async route => {
  if (new URL(route.request().url()).origin === BASE_ORIGIN) await route.continue();
  else await route.abort();
});

const page = await context.newPage();
const checks = [];
function check(name, ok, detail = '') {
  checks.push(ok);
  console.log(`${ok ? 'PASA  ' : 'FALLA '} ${name}${detail ? `  — ${detail}` : ''}`);
}

try {
  await page.goto(`${BASE}/admin.html`);
  await page.evaluate(() => {
    window.__adminQueryData = {};
    window.__adminCalls = [];
    window.supabaseClient = {
      from(table) {
        const query = {
          select() { return query; },
          order() { return Promise.resolve({ data: window.__adminQueryData[table] || [], error: null }); },
          then(resolve, reject) { return Promise.resolve({ data: window.__adminQueryData[table] || [], error: null }).then(resolve, reject); },
          update(payload) { query.operation = 'update'; query.payload = payload; return query; },
          delete() { query.operation = 'delete'; query.payload = null; return query; },
          eq(column, value) {
            window.__adminCalls.push({ table, operation: query.operation, payload: query.payload, column, value });
            return Promise.resolve({ data: null, error: null, count: 1 });
          },
        };
        return query;
      },
    };
  });

  const payload = '<img src=x onerror="window.__xss=1">';
  const productName = `O'Reilly \\ ${payload}`;
  await page.evaluate((payload) => {
    window.__xss = 0;
    window.__adminQueryData.products = [{ id: 'p-1', name: window.__productNameForTest, description: payload, price: 1250, stock: 2, is_active: true }];
    window.__adminQueryData.orders = [{ id: 'o-1', created_at: '2026-09-10T12:00:00Z', client_first_name: payload, client_last_name: payload, client_phone: payload, subtotal: 10, tax: 1.6, total: 11.6, payment_status: 'completo', notes: payload }];
    window.__adminQueryData.custom_requests = [{ id: 'r-1', first_name: payload, last_name_p: payload, phone: payload, email: payload, largo_mm: 1000, alto_mm: 500, profundidad_mm: 200, material: payload, acabado: payload, specifications: payload, precio_estimado: 100, status: 'Contactado', created_at: '2026-09-10T12:00:00Z' }];
    window.__adminQueryData.profiles = [{ first_name: payload, last_name_p: payload, phone: payload, role: payload, created_at: '2026-09-10T12:00:00Z' }];
  }, payload);
  await page.evaluate((productName) => { window.__productNameForTest = productName; window.__adminQueryData.products[0].name = productName; }, productName);

  const scriptsBefore = await page.locator('script').count();

  await page.evaluate(async () => {
    await cargarInventarioBD();
    await cargarHistorialBD();
    await cargarProyectosBD();
    await cargarUsuariosBD();
    showToast(window.__payloadForTest || '<img src=x onerror="window.__xss=1">');
    document.getElementById('ticket-item').value = '<svg onload="window.__xss=1">';
    document.getElementById('ticket-price').value = '10';
    addToTicket();
  });
  await page.waitForTimeout(100);

  const result = await page.evaluate(() => ({
    xssValue: window.__xss,
    scripts: document.querySelectorAll('script[src], script:not([src])').length,
    inlineHandlers: document.querySelectorAll('#inventory-table-body [onclick], #history-table-body [onclick], #projects-table-body [onchange], #users-table-body [onclick], #ticket-list [onclick]').length,
    productText: document.querySelector('#inventory-table-body strong')?.textContent,
    historyText: document.querySelector('#history-table-body td:nth-child(2)')?.textContent,
    projectText: document.querySelector('#projects-table-body td strong')?.textContent,
    userText: document.querySelector('#users-table-body td')?.textContent,
    toastText: document.querySelector('#toast-container .toast')?.textContent,
    ticketText: document.querySelector('#ticket-list span')?.textContent,
  }));

  check('los datos no ejecutan HTML en ninguna vista', result.xssValue === 0, `marcador=${result.xssValue}`);
  check('los renderizadores no crean scripts', result.scripts === scriptsBefore, `scripts=${result.scripts}, antes=${scriptsBefore}`);
  check('las filas dinámicas no tienen handlers inline', result.inlineHandlers === 0, `handlers=${result.inlineHandlers}`);
  check('inventario conserva el texto literal', result.productText === productName);
  check('historial conserva el texto literal', result.historyText === `${payload} ${payload}`, JSON.stringify(result.historyText));
  check('proyectos conserva el texto literal', result.projectText === `${payload} ${payload}`, JSON.stringify(result.projectText));
  check('usuarios conserva el texto literal', result.userText === `${payload} ${payload}`, JSON.stringify(result.userText));
  check('toast conserva el texto literal', result.toastText === '<img src=x onerror="window.__xss=1">');
  check('POS conserva el concepto literal', result.ticketText === '<svg onload="window.__xss=1">');

  await page.evaluate(() => document.querySelector('#inventory-table-body .btn-edit').click());
  check('editar producto conserva el nombre con comillas y barra',
    await page.locator('#edit-prod-name').inputValue() === productName);

  await page.evaluate(() => document.querySelector('#inventory-table-body .btn-toggle').click());
  await page.waitForTimeout(20);
  await page.evaluate(() => { window.confirm = () => true; });
  await page.evaluate(() => document.querySelector('#inventory-table-body .btn-delete').click());
  await page.waitForTimeout(20);
  const productCalls = await page.evaluate(() => window.__adminCalls.filter(call => call.table === 'products'));
  check('visibilidad usa el id del producto', productCalls.some(call => call.operation === 'update' && call.column === 'id' && call.value === 'p-1' && call.payload?.is_active === false));
  check('borrar producto con comillas usa el callback seguro', productCalls.some(call => call.operation === 'delete' && call.column === 'id' && call.value === 'p-1'));

  await page.evaluate(() => {
    const select = document.querySelector('#projects-table-body select');
    select.value = 'En Progreso';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(20);
  const projectCall = await page.evaluate(() => window.__adminCalls.find(call => call.table === 'custom_requests' && call.operation === 'update'));
  check('estatus de proyecto conserva el id de la solicitud', projectCall?.column === 'id' && projectCall.value === 'r-1' && projectCall.payload?.status === 'En Progreso');
} finally {
  await context.close();
  await browser.close();
}

if (checks.some(ok => !ok)) process.exitCode = 1;
