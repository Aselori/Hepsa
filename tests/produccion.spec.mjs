// Producción: la vista del taller en el panel, contra el stack local.
//
// El taller entra al panel, ve sólo Producción, ve el pedido con sus
// conceptos y el teléfono pero sin precios, y lo marca como instalado.
// El pedido lo crea un vendedor por registrar_venta() y lo pasa a producción.
import { createClient } from '@supabase/supabase-js';
import { BASE, URL_SB, LLAVE, navegadorLocal } from './entorno-local.mjs';
import { codigoTOTPFresco } from './totp.mjs';

const env = process.env;
if (!URL_SB?.startsWith('http://127.0.0.1:') || !env.TALLER_EMAIL) {
  console.error('Esta suite sólo corre contra el stack local: npm run test:local');
  process.exit(2);
}

const checks = [];
function check(nombre, ok, detalle = '') {
  checks.push(ok);
  console.log(`${ok ? 'PASA  ' : 'FALLA '} ${nombre}${detalle ? '  — ' + detalle : ''}`);
}

const vendedor = createClient(URL_SB, LLAVE, { auth: { persistSession: false, autoRefreshToken: false } });
{
  const { error } = await vendedor.auth.signInWithPassword({ email: env.VENDEDOR_EMAIL, password: env.VENDEDOR_PASS });
  if (error) throw new Error(`VENDEDOR: ${error.message}`);
  const factor = (await vendedor.auth.mfa.listFactors()).data.totp.find((f) => f.status === 'verified');
  const v = await vendedor.auth.mfa.challengeAndVerify({ factorId: factor.id, code: await codigoTOTPFresco(env.VENDEDOR_TOTP) });
  if (v.error) throw new Error(`VENDEDOR 2FA: ${v.error.message}`);
}

const venta = await vendedor.rpc('registrar_venta', {
  p_cliente: { nombre: 'Prueba', apellidos: 'Taller', telefono: '81 1234 5678' },
  p_conceptos: [{ concepto: 'Barandal de escalera', precio: 7919.37, cantidad: 2 }],
  p_pago: 'anticipo', p_notas: 'Instalar en Calle Prueba 123',
});
if (venta.error) throw new Error(`registrar_venta: ${venta.error.message}`);
const pedido = venta.data;
const avance = await vendedor.rpc('avanzar_proyecto', { p_pedido: pedido, p_estado: 'en_produccion' });
if (avance.error) throw new Error(`avanzar_proyecto: ${avance.error.message}`);

const browser = await navegadorLocal();
try {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/index.html`);
  await page.waitForFunction(() => window.supabaseClient !== undefined);
  const codigo = await codigoTOTPFresco(env.TALLER_TOTP);
  const err = await page.evaluate(async ([e, p, c]) => {
    const a = await window.supabaseClient.auth.signInWithPassword({ email: e, password: p });
    if (a.error) return a.error.message;
    const { data } = await window.supabaseClient.auth.mfa.listFactors();
    return (await window.supabaseClient.auth.mfa.challengeAndVerify({ factorId: data.totp[0].id, code: c })).error?.message ?? null;
  }, [env.TALLER_EMAIL, env.TALLER_PASS, codigo]);
  if (err) throw new Error(`TALLER: ${err}`);

  let alerta = null;
  page.on('dialog', async (d) => { alerta = d.message(); await d.dismiss(); });
  await page.goto(`${BASE}/admin.html`);
  const tarjeta = page.locator('#produccion-lista .pedido-taller', { hasText: `Pedido ${pedido} ` });
  await tarjeta.waitFor({ timeout: 8000 }).catch(() => {});
  check('el taller entra al panel', alerta === null && page.url().endsWith('/admin.html'), `alerta=${JSON.stringify(alerta)}`);

  const menu = await page.locator('.sidebar-nav button:visible').allInnerTexts();
  check('el taller sólo ve Producción en el menú', JSON.stringify(menu) === '["Producción"]', JSON.stringify(menu));

  const texto = await tarjeta.innerText().catch(() => '');
  check('la tarjeta trae conceptos, notas y teléfono', /2 × Barandal de escalera/.test(texto) && /Calle Prueba 123/.test(texto) && /81 1234 5678/.test(texto), texto.replace(/\n/g, ' | '));
  const visible = await page.locator('main').innerText();
  const precio = /\$|7,?919\.37|15,?838\.74/;
  check('el panel del taller no muestra precios', !precio.test(visible), visible.match(new RegExp(`.{0,40}(${precio.source}).{0,40}`))?.[0] ?? '');
  check('el teléfono se marca desde la tarjeta', await tarjeta.locator('a[href="tel:8112345678"]').count() === 1);
  await page.screenshot({ path: 'tests/screenshots/produccion-taller.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'tests/screenshots/produccion-taller-telefono.png' });
  await page.setViewportSize({ width: 1280, height: 800 });

  await tarjeta.getByRole('button', { name: 'Marcar instalado' }).click();
  const instalado = page.locator('#instalados-lista .pedido-taller', { hasText: `Pedido ${pedido} ` });
  await instalado.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
  const estado = (await vendedor.from('orders').select('project_status').eq('id', pedido).single()).data?.project_status;
  check('"Marcar instalado" lo pasa a instalado en la base', estado === 'instalado', estado);
  check('y deja de estar en la lista de producción', await tarjeta.count() === 0);

  await page.locator('.instalados summary').click();
  await instalado.getByRole('button', { name: 'Regresar a producción' }).click();
  await tarjeta.waitFor({ timeout: 5000 }).catch(() => {});
  check('un error se corrige regresándolo a producción', await tarjeta.count() === 1);
} finally {
  await browser.close();
  await vendedor.auth.signOut();
}

const fallidas = checks.filter((ok) => !ok).length;
console.log(`${checks.length - fallidas}/${checks.length} comprobaciones de la vista de producción.`);
if (fallidas) process.exitCode = 1;
