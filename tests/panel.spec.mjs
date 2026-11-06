// ============================================================================
// El panel de administración sigue funcionando con el segundo factor puesto.
//
// Por qué hace falta: TODA consulta del panel pasa por is_staff(), y la Mejora
// 3 cambió esa función. rls.spec.mjs comprueba que el panel *deje entrar*, no
// que adentro funcione algo. Un vendedor que entra a un POS que no registra
// ventas está igual de bloqueado que uno al que no dejan pasar, y las pruebas
// anteriores no notarían la diferencia.
//
// Recorre cada vista, registra una venta de verdad y la borra al terminar.
//
//   node --env-file=tests/.env.local tests/panel.spec.mjs
// ============================================================================

import { BASE, URL_SB, LLAVE, navegadorLocal } from './entorno-local.mjs';
import { codigoTOTPFresco } from './totp.mjs';


const env = process.env;
const resultados = [];
function check(nombre, ok, detalle = '') {
  resultados.push({ nombre, ok });
  console.log(`${ok ? 'PASA  ' : 'FALLA '} ${nombre}${detalle ? '  — ' + detalle : ''}`);
}

async function entrarConSegundoFactor(page, prefijo) {
  await page.goto(`${BASE}/index.html`);
  await page.waitForFunction(() => window.supabaseClient !== undefined);
  const err = await page.evaluate(async ([e, p]) => {
    const { error } = await window.supabaseClient.auth.signInWithPassword({ email: e, password: p });
    return error?.message ?? null;
  }, [env[`${prefijo}_EMAIL`], env[`${prefijo}_PASS`]]);
  if (err) throw new Error(`login ${prefijo}: ${err}`);
  const codigo = await codigoTOTPFresco(env[`${prefijo}_TOTP`]);
  const err2 = await page.evaluate(async (c) => {
    const { data } = await window.supabaseClient.auth.mfa.listFactors();
    const r = await window.supabaseClient.auth.mfa.challengeAndVerify({ factorId: data.totp[0].id, code: c });
    return r.error?.message ?? null;
  }, codigo);
  if (err2) throw new Error(`2FA ${prefijo}: ${err2}`);
}

const browser = await navegadorLocal();
let pedidoCreado = null;
let imagenCreada = null;
let fotoEditada = null;
let page = null;

try {
  const ctx = await browser.newContext();
  page = await ctx.newPage();
  await entrarConSegundoFactor(page, 'VENDEDOR');
  await page.goto(`${BASE}/admin.html`);
  await page.waitForTimeout(2500);
  check('el vendedor con 2FA entra al panel', page.url().endsWith('/admin.html'), page.url().replace(BASE, ''));

  // ── Inventario: si is_staff() se hubiera roto, el desplegable del POS
  //    llegaria vacio y no se podria cobrar nada.
  await page.waitForTimeout(1500);
  const opciones = await page.locator('#pos-product-select option').count();
  check('el desplegable del POS carga el inventario', opciones > 1,
    `opciones=${opciones} (1 es solo el "Selecciona...")`);

  // ── Cada vista del panel se pinta con datos ──────────────────────────────
  for (const [vista, selector] of [['catalog', '#view-catalog'], ['history', '#view-history'], ['projects', '#view-projects']]) {
    await page.click(`#nav-${vista}`);
    await page.waitForTimeout(1800);
    const txt = await page.locator(selector).innerText();
    check(`la vista ${vista} se pinta con datos`,
      txt.length > 40 && !/error|denied|permission/i.test(txt),
      `${txt.length} caracteres`);
  }

  // ── El POS de verdad: registrar una venta ────────────────────────────────
  await page.click('#nav-pos');
  await page.waitForTimeout(1500);

  // Se arma como lo armaria el vendedor: elegir del desplegable (que rellena
  // precio y concepto solo) y pulsar "Anadir".
  const valorProducto = await page.locator('#pos-product-select option').nth(1).getAttribute('value');
  await page.selectOption('#pos-product-select', valorProducto);
  await page.waitForTimeout(400);
  const armado = {
    nombre: await page.inputValue('#ticket-item'),
    precio: Number(await page.inputValue('#ticket-price')),
  };
  check('elegir del inventario rellena concepto y precio',
    armado.nombre.length > 0 && armado.precio > 0, `${armado.nombre} $${armado.precio}`);

  await page.click('button[onclick="addToTicket()"]');
  await page.waitForTimeout(600);
  const renglonesEnPantalla = await page.locator('#ticket-list > *').count();
  const totalEnPantalla = await page.locator('#tkt-total').innerText();
  check('el concepto entra al ticket y el total se actualiza',
    renglonesEnPantalla === 1 && Number(totalEnPantalla.replace(/,/g, '')) > 0,
    `renglones=${renglonesEnPantalla} total=${totalEnPantalla}`);

  const antes = await page.evaluate(async () => {
    const { count } = await window.supabaseClient.from('orders').select('id', { count: 'exact', head: true });
    return count;
  });

  await page.click('#btn-registrar-venta');
  await page.waitForTimeout(3500);
  const aviso = await page.locator('#toast-container').innerText().catch(() => '');
  check('registrar la venta no da error de permisos',
    !/error|denied|permission|policy/i.test(aviso), `aviso="${aviso.slice(0, 70)}"`);

  const despues = await page.evaluate(async () => {
    const { data, count } = await window.supabaseClient
      .from('orders').select('id, subtotal, tax, total', { count: 'exact' }).order('id', { ascending: false }).limit(1);
    return { count, ultima: data?.[0] ?? null };
  });
  check('la venta queda registrada en la base', despues.count === antes + 1,
    `${antes} -> ${despues.count}`);
  pedidoCreado = despues.ultima?.id ?? null;
  // El folio del ticket (y del PDF) es el id del pedido, no un número al azar.
  const folioTicket = await page.locator('#ticket-folio').textContent();
  check('el ticket muestra el folio real del pedido registrado', folioTicket === `#${pedidoCreado}`, `ticket=${folioTicket} pedido=${pedidoCreado}`);

  const cuadra = despues.ultima &&
    Math.abs(Number(despues.ultima.total) - (armado.precio * 1.16)) < 0.02;
  check('el ticket calcula IVA y total correctamente', !!cuadra,
    `subtotal=${despues.ultima?.subtotal} iva=${despues.ultima?.tax} total=${despues.ultima?.total}`);

  const renglones = await page.evaluate(async (id) => {
    const { data } = await window.supabaseClient.from('order_items').select('id').eq('order_id', id);
    return data?.length ?? 0;
  }, pedidoCreado);
  check('la venta guarda sus renglones', renglones === 1, `renglones=${renglones}`);

  // ── Historial: el personal cambia el pago y el estatus del proyecto ──────
  // El cliente ve ambos en su perfil; antes el panel no tenia donde cambiarlos.
  await page.evaluate(() => showAdminView('history'));
  const selProyecto = `select[aria-label="Proyecto del folio #${pedidoCreado}"]`;
  await page.waitForSelector(selProyecto, { timeout: 10000 });
  await page.selectOption(selProyecto, 'en_produccion');
  await page.waitForTimeout(1500);
  await page.selectOption(`select[aria-label="Pago del folio #${pedidoCreado}"]`, 'completo');
  await page.waitForTimeout(1500);
  const estatus = await page.evaluate(async (id) =>
    (await window.supabaseClient.from('orders').select('project_status, payment_status').eq('id', id).single()).data, pedidoCreado);
  check('desde el historial se cambian el estatus del proyecto y el pago',
    estatus?.project_status === 'en_produccion' && estatus?.payment_status === 'completo', JSON.stringify(estatus));

  // ── Inventario: la edicion acepta una foto nueva ──────────────────────────
  // Antes solo el alta tenia campo de foto: un producto existente no podia
  // recibir una.
  await page.evaluate(() => showAdminView('catalog'));
  await page.waitForSelector('#inventory-table-body .btn-edit', { timeout: 10000 });
  const original = await page.evaluate(() => productosInventario[0] && { id: productosInventario[0].id, image_url: productosInventario[0].image_url });
  await page.evaluate((id) => abrirModalEdicion(id), original.id);
  await page.setInputFiles('#edit-prod-img', { name: 'foto-prueba.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
  await page.click('#modal-edit-product .action-btn');
  await page.waitForTimeout(2500);
  const editada = await page.evaluate(async (id) =>
    (await window.supabaseClient.from('products').select('image_url').eq('id', id).single()).data?.image_url, original.id);
  const cambio = typeof editada === 'string' && editada !== original.image_url && editada.includes('/productos/products/');
  if (cambio) fotoEditada = { id: original.id, previa: original.image_url, objeto: decodeURIComponent(editada.split('/productos/')[1]) };
  check('editar un producto le cambia la foto', cambio, `antes=${original.image_url} despues=${editada}`);

  // ── Subir imagen a Storage: tambien pasa por is_staff() ──────────────────
  const subida = await page.evaluate(async (bucket) => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
    const nombre = `prueba-2fa-${Date.now()}.png`;
    const { error } = await window.supabaseClient.storage.from(bucket)
      .upload(nombre, new Blob([png], { type: 'image/png' }));
    return { nombre: error ? null : nombre, error: error?.message ?? null };
  }, 'productos');
  imagenCreada = subida.nombre;
  check('el staff con 2FA puede subir imagenes a Storage',
    subida.error === null, `error=${JSON.stringify(subida.error)}`);

  // ── Y el vendedor sigue SIN poder lo que es de admin ─────────────────────
  const soloVendedor = await page.evaluate(async () => {
    const nav = document.getElementById('nav-users');
    return { usuariosOculto: nav ? getComputedStyle(nav).display === 'none' : null };
  });
  check('al vendedor se le siguen ocultando las vistas de admin',
    soloVendedor.usuariosOculto === true, JSON.stringify(soloVendedor));

  const escalada = await page.evaluate(async () => {
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    const { error } = await window.supabaseClient
      .from('profiles').update({ role: 'admin' }).eq('id', session.user.id);
    const { data } = await window.supabaseClient
      .from('profiles').select('role').eq('id', session.user.id).single();
    return { error: error?.message ?? null, rol: data?.role };
  });
  check('un vendedor con 2FA no puede ascenderse a admin',
    escalada.rol === 'vendedor', `rol=${escalada.rol} error=${JSON.stringify(escalada.error)}`);

  // ── Un admin SIN 2FA tampoco puede cambiar roles ─────────────────────────
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(`${BASE}/index.html`);
  await p2.waitForFunction(() => window.supabaseClient !== undefined);
  await p2.evaluate(async ([e, p]) => {
    await window.supabaseClient.auth.signInWithPassword({ email: e, password: p });
  }, [env.ADMIN_EMAIL, env.ADMIN_PASS]);
  const sinFactor = await p2.evaluate(async (correoCliente) => {
    const { data: antes } = await window.supabaseClient.from('profiles').select('id, role').eq('email', correoCliente);
    if (!antes?.length) return { alcance: 0 };  // ni siquiera lo ve, mejor aun
    const { error } = await window.supabaseClient
      .from('profiles').update({ role: 'vendedor' }).eq('id', antes[0].id);
    return { alcance: antes.length, error: error?.message ?? null };
  }, env.CLIENTE_EMAIL);
  check('un admin sin 2FA no alcanza a otros perfiles para ascenderlos',
    sinFactor.alcance === 0, JSON.stringify(sinFactor));
  await ctx2.close();

} finally {
  if (pedidoCreado || imagenCreada) {
    // La limpieza va con una sesion de ADMIN, no con la del vendedor que
    // registro la venta: orders_delete_admin y order_items_delete_admin solo
    // dejan borrar a admin. Hacerlo con el vendedor deja el pedido de prueba
    // en la base sin avisar, porque RLS no devuelve error: devuelve 0 filas.
    const ctxL = await browser.newContext();
    const pL = await ctxL.newPage();
    await entrarConSegundoFactor(pL, 'ADMIN');
    const borrado = await pL.evaluate(async (id) => {
      await window.supabaseClient.from('order_items').delete().eq('order_id', id);
      await window.supabaseClient.from('orders').delete().eq('id', id);
      const { data } = await window.supabaseClient.from('orders').select('id').eq('id', id);
      return data?.length ?? -1;
    }, pedidoCreado).catch((e) => `fallo: ${e.message}`);
    if (fotoEditada) {
      const restaurada = await pL.evaluate(async ({ id, previa, objeto }) => {
        const r = await window.supabaseClient.from('products').update({ image_url: previa }).eq('id', id);
        const b = await window.supabaseClient.storage.from('productos').remove([objeto]);
        return !r.error && !b.error;
      }, fotoEditada);
      check('la foto de prueba se retira y el producto vuelve a su imagen', restaurada === true);
    }
    if (imagenCreada) {
      const limpia = await pL.evaluate(async nombre => {
        const { data, error } = await window.supabaseClient.storage.from('productos').remove([nombre]);
        return !error && data?.some(objeto => objeto.name === nombre);
      }, imagenCreada);
      check('la imagen de prueba se elimina con permisos de admin', limpia === true);
    }
    await ctxL.close();
    console.log(`\n(limpieza) pedido de prueba #${pedidoCreado} borrado: ${borrado === 0 ? 'si' : 'NO — ' + borrado}`);
    if (borrado !== 0) resultados.push({ nombre: 'limpieza del pedido de prueba', ok: false });
  }
  await browser.close();
}

const fallidas = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - fallidas.length}/${resultados.length} pruebas del panel pasaron`);
process.exit(fallidas.length ? 1 : 0);
