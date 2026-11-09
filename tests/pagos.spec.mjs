// Mejora 2: pagos en línea con Stripe, contra el stack local.
//
// tests/local.mjs levanta las Edge Functions con un Stripe simulado y un
// secreto de webhook desechable. Aquí se firma cada aviso igual que lo firma
// Stripe, así que la verificación que se prueba es la real, no un atajo.
//
// Lo que importa demostrar:
//   - el monto que se le pide a Stripe sale de la base, no del navegador;
//   - nadie paga (ni ve) el pedido de otro;
//   - sólo un aviso con firma válida marca un pedido como pagado;
//   - el mismo aviso dos veces no cobra ni descuenta dos veces;
//   - el portal muestra el botón y lleva a Stripe.
import { createHmac, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { codigoTOTPFresco } from './totp.mjs';

const URL_SB = process.env.HEPSA_TEST_SUPABASE_URL;
const LLAVE = process.env.HEPSA_TEST_SUPABASE_KEY;
const {
  CLIENTE_EMAIL, CLIENTE_PASS, CLIENTE2_EMAIL, CLIENTE2_PASS,
  PAGOS_PRODUCTO_ID, STRIPE_WEBHOOK_SECRET, STRIPE_SIMULADO_URL, BASE_URL,
} = process.env;

if (!URL_SB || !LLAVE || !CLIENTE_EMAIL || !CLIENTE2_EMAIL || !PAGOS_PRODUCTO_ID || !STRIPE_WEBHOOK_SECRET || !STRIPE_SIMULADO_URL || !BASE_URL) {
  console.error('Faltan los fixtures de pagos. Ejecuta esta suite con: npm run test:local');
  process.exit(2);
}
if (!URL_SB.startsWith('http://127.0.0.1:')) {
  console.error(`Destino no permitido: ${URL_SB}. Esta suite solo corre contra el stack local.`);
  process.exit(2);
}

const checks = [];
function check(nombre, ok, detalle = '') {
  checks.push(ok);
  console.log(`${ok ? 'PASA  ' : 'FALLA '} ${nombre}${detalle ? '  — ' + detalle : ''}`);
}

const FUNCIONES = `${URL_SB}/functions/v1`;
const productoId = Number(PAGOS_PRODUCTO_ID);
const nuevoCliente = () => createClient(URL_SB, LLAVE, { auth: { persistSession: false, autoRefreshToken: false } });

async function entrar(email, pass) {
  const c = nuevoCliente();
  const { data, error } = await c.auth.signInWithPassword({ email, password: pass });
  if (error) throw error;
  return { c, token: data.session.access_token };
}

async function pedirPago(pedido, token) {
  const headers = { 'Content-Type': 'application/json', apikey: LLAVE };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${FUNCIONES}/crear-pago`, { method: 'POST', headers, body: JSON.stringify({ pedido }) });
  return { status: r.status, cuerpo: await r.json().catch(() => null) };
}

// La misma firma que calcula Stripe: HMAC-SHA256 de "t.cuerpo" con el secreto.
async function avisar(evento, { secreto = STRIPE_WEBHOOK_SECRET, firmar = true } = {}) {
  const cuerpo = JSON.stringify(evento);
  const t = Math.floor(Date.now() / 1000);
  const headers = { 'Content-Type': 'application/json' };
  if (firmar) headers['Stripe-Signature'] = `t=${t},v1=${createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex')}`;
  const r = await fetch(`${FUNCIONES}/webhook-stripe`, { method: 'POST', headers, body: cuerpo });
  return { status: r.status, cuerpo: await r.json().catch(() => null) };
}

const eventoDeSesion = ({ sesion, pedido, centavos, estado = 'paid', tipo = 'checkout.session.completed' }) => ({
  id: `evt_${randomBytes(8).toString('hex')}`, object: 'event', type: tipo,
  data: { object: { id: sesion, object: 'checkout.session', payment_status: estado, amount_total: centavos, currency: 'mxn', metadata: { pedido: String(pedido) } } },
});

async function crearPedido(c, uid, qty) {
  const carrito = await c.from('carrito_items').upsert({ user_id: uid, product_id: productoId, qty });
  if (carrito.error) throw carrito.error;
  const { data, error } = await c.rpc('crear_pedido_desde_carrito', { p_notas: null });
  if (error) throw error;
  return data;
}

const leerPedido = async (c, id) => (await c.from('orders').select('total, payment_status').eq('id', id).single()).data;
const leerStock = async (c) => (await c.from('products').select('stock').eq('id', productoId).single()).data?.stock;

const uno = await entrar(CLIENTE_EMAIL, CLIENTE_PASS);
const otro = await entrar(CLIENTE2_EMAIL, CLIENTE2_PASS);
const uid = (await uno.c.auth.getUser()).data.user.id;

try {
  const stockInicial = await leerStock(uno.c);
  const pedido = await crearPedido(uno.c, uid, 2);
  const { total } = await leerPedido(uno.c, pedido);
  const centavos = Math.round(Number(total) * 100);
  check('el pedido nace pendiente de pago', (await leerPedido(uno.c, pedido)).payment_status === 'faltante');

  // ─── crear-pago ─────────────────────────────────────────────────────────
  const sinSesion = await pedirPago(pedido, null);
  check('sin sesión no se crea un pago', sinSesion.status === 401, `status=${sinSesion.status}`);

  const invalido = await pedirPago('abc', uno.token);
  check('un número de pedido inválido se rechaza', invalido.status === 400, `status=${invalido.status}`);

  const ajeno = await pedirPago(pedido, otro.token);
  check('otro cliente no puede pagar este pedido', ajeno.status === 404, `status=${ajeno.status}`);

  const propio = await pedirPago(pedido, uno.token);
  check('el dueño recibe la URL de Stripe', propio.status === 200 && propio.cuerpo?.url?.startsWith('https://checkout.stripe.com/'),
    `status=${propio.status} ${JSON.stringify(propio.cuerpo)}`);

  const sesiones = await (await fetch(`${STRIPE_SIMULADO_URL}/__sesiones`)).json();
  const pedida = sesiones.at(-1)?.campos ?? {};
  check('a Stripe se le pide el total de la base, en centavos MXN',
    pedida['line_items[0][price_data][unit_amount]'] === String(centavos) && pedida['line_items[0][price_data][currency]'] === 'mxn',
    `pedido=${pedida['line_items[0][price_data][unit_amount]']} esperado=${centavos}`);
  check('la sesión lleva el número de pedido', pedida['metadata[pedido]'] === String(pedido));
  check('la sesión usa la llave secreta del servidor', sesiones.at(-1)?.autorizacion === 'Bearer sk_test_local_hepsa');
  check('ajeno e inválido no llegaron a Stripe', sesiones.length === 1, `sesiones=${sesiones.length}`);

  // ─── webhook-stripe ─────────────────────────────────────────────────────
  const sesion = `cs_test_${randomBytes(8).toString('hex')}`;
  const pagado = eventoDeSesion({ sesion, pedido, centavos });

  const sinFirma = await avisar(pagado, { firmar: false });
  check('un aviso sin firma se rechaza', sinFirma.status === 400, `status=${sinFirma.status}`);
  const firmaFalsa = await avisar(pagado, { secreto: 'whsec_otro' });
  check('un aviso con firma de otro secreto se rechaza', firmaFalsa.status === 400, `status=${firmaFalsa.status}`);
  check('tras avisos falsos el pedido sigue pendiente', (await leerPedido(uno.c, pedido)).payment_status === 'faltante');

  const sinCobrar = await avisar(eventoDeSesion({ sesion: `${sesion}_x`, pedido, centavos, estado: 'unpaid' }));
  check('una sesión completada sin cobrar no marca pagado', sinCobrar.status === 200 && (await leerPedido(uno.c, pedido)).payment_status === 'faltante',
    `status=${sinCobrar.status}`);

  const montoDistinto = await avisar(eventoDeSesion({ sesion: `${sesion}_m`, pedido, centavos: centavos - 100 }));
  check('un monto distinto al total falla para que Stripe reintente', montoDistinto.status === 500, `status=${montoDistinto.status}`);
  check('con monto distinto el pedido sigue pendiente', (await leerPedido(uno.c, pedido)).payment_status === 'faltante');

  const bueno = await avisar(pagado);
  check('el aviso firmado registra el pago', bueno.status === 200 && bueno.cuerpo?.resultado === 'pagado', `status=${bueno.status} ${JSON.stringify(bueno.cuerpo)}`);
  check('el pedido queda pagado', (await leerPedido(uno.c, pedido)).payment_status === 'completo');
  const stockPagado = await leerStock(uno.c);
  check('el pago descuenta las existencias', stockPagado === stockInicial - 2, `antes=${stockInicial} despues=${stockPagado}`);

  const repetido = await avisar(pagado);
  check('el mismo aviso otra vez no se cuenta dos veces', repetido.status === 200 && repetido.cuerpo?.resultado === 'repetido', JSON.stringify(repetido.cuerpo));
  check('ni descuenta dos veces', (await leerStock(uno.c)) === stockPagado);

  const yaPagado = await pedirPago(pedido, uno.token);
  check('un pedido pagado no abre otro pago', yaPagado.status === 409, `status=${yaPagado.status}`);

  const doble = await avisar(eventoDeSesion({ sesion: `${sesion}_2`, pedido, centavos }));
  check('un segundo cobro del mismo pedido queda marcado como duplicado', doble.cuerpo?.resultado === 'duplicado', JSON.stringify(doble.cuerpo));
  check('el duplicado no descuenta existencias', (await leerStock(uno.c)) === stockPagado);

  // ─── Permisos sobre pagos ───────────────────────────────────────────────
  const propios = await uno.c.from('pagos').select('monto, duplicado').eq('order_id', pedido).order('id');
  check('el cliente ve sus pagos', propios.data?.length === 2 && Number(propios.data[0].monto) === Number(total) && propios.data[1].duplicado === true,
    JSON.stringify(propios.data));
  const ajenos = await otro.c.from('pagos').select('id').eq('order_id', pedido);
  check('otro cliente no ve esos pagos', (ajenos.data?.length ?? 0) === 0, `filas=${ajenos.data?.length}`);
  const escribe = await uno.c.from('pagos').insert({ order_id: pedido, sesion_id: 'cs_intruso', monto: 1 });
  check('el cliente no puede escribir pagos', escribe.error !== null);
  const registra = await uno.c.rpc('registrar_pago_en_linea', { p_pedido: pedido, p_sesion: 'cs_intruso', p_monto: total, p_moneda: 'mxn' });
  check('el cliente no puede llamar a registrar_pago_en_linea', registra.error !== null);

  // ─── Portal ─────────────────────────────────────────────────────────────
  const pendiente = await crearPedido(uno.c, uid, 1);
  const navegador = await chromium.launch();
  try {
    const contexto = await navegador.newContext();
    await contexto.route('**/*', async (ruta) => {
      const destino = new URL(ruta.request().url());
      if (destino.hostname === 'checkout.stripe.com') return ruta.fulfill({ status: 200, contentType: 'text/html', body: '<title>Stripe simulado</title>' });
      if (destino.hostname === '127.0.0.1') return ruta.continue();
      return ruta.abort();
    });
    const page = await contexto.newPage();
    await page.goto(`${BASE_URL}/index.html`);
    await page.waitForFunction(() => window.supabaseClient);
    await page.evaluate(async ([e, p]) => { await window.supabaseClient.auth.signInWithPassword({ email: e, password: p }); }, [CLIENTE_EMAIL, CLIENTE_PASS]);
    await page.goto(`${BASE_URL}/index.html?pago=cancelado&pedido=${pendiente}`);
    await page.waitForSelector(`[data-pagar-id="${pendiente}"]`, { timeout: 15000 });

    const regreso = await page.evaluate(() => ({
      perfil: document.getElementById('view-profile').classList.contains('active'),
      aviso: document.getElementById('toast-container').textContent,
      url: location.search,
    }));
    check('al cancelar en Stripe el portal lo dice y abre el perfil',
      regreso.perfil && regreso.aviso.includes('No se hizo ningún cargo') && regreso.url === '', JSON.stringify(regreso));

    const nota = await page.evaluate(() => document.getElementById('cart-nota-pago').textContent);
    check('con pagos en linea la nota del carrito ya no dice que no se cobra en linea',
      nota.includes('pagarlo en línea') && !nota.includes('Todavía no se cobra'), nota.trim());

    const filaPagada = await page.locator('#client-history-body tr', { hasText: `#${pedido}` }).textContent();
    check('el pedido pagado se lee "Pagado" y sin botón', filaPagada.includes('Pagado') && !(await page.locator(`[data-pagar-id="${pedido}"]`).count()));

    // En telefono la tabla de pedidos ensanchaba toda la pagina (467 px en
    // una pantalla de 390 antes de la columna de pago) y el boton quedaba
    // fuera de la vista.
    await page.setViewportSize({ width: 390, height: 844 });
    const telefono = await page.evaluate((id) => {
      const b = document.querySelector(`[data-pagar-id="${id}"]`).getBoundingClientRect();
      return { desborda: document.documentElement.scrollWidth > innerWidth, botonDentro: b.left >= 0 && b.right <= innerWidth };
    }, pendiente);
    check('en telefono la pagina no se desborda y el boton de pago se ve completo',
      !telefono.desborda && telefono.botonDentro, JSON.stringify(telefono));

    await page.locator(`[data-pagar-id="${pendiente}"]`).click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 15000 });
    check('el botón lleva a la sesión de Stripe', page.url().startsWith('https://checkout.stripe.com/c/pay/cs_test_'), page.url());

    // ─── Panel: el admin ve los pagos y el duplicado por reembolsar ─────────
    if (process.env.ADMIN_TOTP) {
      // Contexto propio: la sesión del cliente vive en el otro.
      const contextoAdmin = await navegador.newContext();
      await contextoAdmin.route('**/*', (ruta) => new URL(ruta.request().url()).hostname === '127.0.0.1' ? ruta.continue() : ruta.abort());
      const admin = await contextoAdmin.newPage();
      await admin.goto(`${BASE_URL}/index.html`);
      await admin.waitForFunction(() => window.supabaseClient);
      const codigo = await codigoTOTPFresco(process.env.ADMIN_TOTP);
      await admin.evaluate(async ([e, p, c]) => {
        await window.supabaseClient.auth.signInWithPassword({ email: e, password: p });
        const { data } = await window.supabaseClient.auth.mfa.listFactors();
        await window.supabaseClient.auth.mfa.challengeAndVerify({ factorId: data.totp[0].id, code: c });
      }, [process.env.ADMIN_EMAIL, process.env.ADMIN_PASS, codigo]);
      await admin.goto(`${BASE_URL}/admin.html`);
      await admin.locator('#nav-pagos').click({ timeout: 15000 });
      const filas = admin.locator('#pagos-table-body tr', { hasText: String(pedido) });
      await filas.first().waitFor({ timeout: 10000 }).catch(() => {});
      const textos = await filas.allInnerTexts();
      check('el panel del admin lista los dos cobros del pedido', textos.length === 2, textos.join(' | '));
      check('el duplicado va primero y marcado para reembolsar', /Duplicado: reembolsar/.test(textos[0] ?? ''), textos[0] ?? '');
      check('el resumen avisa del cobro duplicado', /cobros? duplicados?/.test(await admin.locator('#pagos-duplicados').innerText()));
      await admin.screenshot({ path: 'tests/screenshots/pagos-admin.png', fullPage: true });
    }
  } finally {
    await navegador.close();
  }
} finally {
  await uno.c.auth.signOut();
  await otro.c.auth.signOut();
}

const fallidas = checks.filter((ok) => !ok).length;
console.log(`${checks.length - fallidas}/${checks.length} comprobaciones de pagos en línea.`);
if (fallidas) process.exitCode = 1;
