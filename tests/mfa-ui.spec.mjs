// ============================================================================
// Las pantallas del segundo factor, manejadas como las maneja una persona.
//
// rls.spec.mjs comprueba que la BASE exija aal2, pero llega a aal2 llamando a
// challengeAndVerify() por debajo. Eso deja sin probar justo lo que el
// empleado toca: el formulario de login, el QR del alta y la casilla del
// código. Aquí no se llama a ninguna función del SDK a mano: se escribe en los
// campos y se hace clic, como en admin.html.
//
// Para probar el ALTA hace falta un empleado sin autenticador, y los dos que
// existen ya tienen uno. En vez de inventar una cuenta, se asciende
// temporalmente al cliente y se le devuelve su rol al terminar; la limpieza
// corre en finally para que una falla a media prueba no deje la cuenta
// ascendida.
//
//   node --env-file=tests/.env.local tests/mfa-ui.spec.mjs
// ============================================================================

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { codigoTOTPFresco } from './totp.mjs';

const BASE = 'http://localhost:8000';
const env = process.env;

const cfg = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const URL_SB = cfg.match(/supabaseUrl:\s*'([^']+)'/)[1];
const LLAVE  = cfg.match(/supabaseKey:\s*'([^']+)'/)[1];

const resultados = [];
function check(nombre, ok, detalle = '') {
  resultados.push({ nombre, ok });
  console.log(`${ok ? 'PASA  ' : 'FALLA '} ${nombre}${detalle ? '  — ' + detalle : ''}`);
}

async function api(ruta, { token, ...o } = {}) {
  const r = await fetch(`${URL_SB}/auth/v1${ruta}`, {
    ...o,
    headers: { apikey: LLAVE, 'Content-Type': 'application/json',
               ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${ruta} → ${r.status} ${JSON.stringify(b)}`);
  return b;
}

// Escribe en el formulario y pulsa el botón, sin tocar el SDK.
async function entrarPorElFormulario(page, email, pass) {
  await page.goto(`${BASE}/index.html`);
  await page.waitForFunction(() => window.supabaseClient !== undefined);
  await page.click('#btn-login');
  await page.fill('#log-email', email);
  await page.fill('#log-pass', pass);
  await page.click('button[onclick="iniciarSesionBD()"]');
}

const aalDe = (page) => page.evaluate(async () => {
  const { data: { session } } = await window.supabaseClient.auth.getSession();
  if (!session) return null;
  return JSON.parse(atob(session.access_token.split('.')[1]
    .replace(/-/g, '+').replace(/_/g, '/'))).aal;
});

const browser = await chromium.launch();
let ascendido = false;

try {
  // ── 1. El RETO: una cuenta que ya tiene autenticador ─────────────────────
  {
    const page = await (await browser.newContext()).newPage();
    await entrarPorElFormulario(page, env.VENDEDOR_EMAIL, env.VENDEDOR_PASS);

    await page.waitForSelector('#view-mfa.active', { timeout: 8000 });
    check('la contraseña sola lleva a la pantalla del segundo factor', true);
    check('en el reto no se enseña el QR del alta',
      !(await page.locator('#mfa-alta').isVisible()));
    check('el botón invita a verificar',
      /verificar/i.test(await page.locator('#mfa-btn').innerText()),
      `"${await page.locator('#mfa-btn').innerText()}"`);

    // Un código equivocado no debe dejar pasar, y debe decirlo.
    await page.fill('#mfa-codigo', '000000');
    await page.click('#mfa-btn');
    await page.waitForTimeout(3000);
    const aviso = await page.locator('#toast-container').innerText().catch(() => '');
    check('un código incorrecto es rechazado con aviso',
      /incorrecto|vencido/i.test(aviso) && (await aalDe(page)) === 'aal1',
      `aviso=${JSON.stringify(aviso.slice(0, 60))}`);

    // La captura va ANTES de verificar: después de verificar hay un reload y
    // lo que se retrataría es el catálogo, no la pantalla que interesa.
    await page.screenshot({ path: 'tests/screenshots/mfa-reto.png' });

    // Y el bueno sí.
    await page.fill('#mfa-codigo', await codigoTOTPFresco(env.VENDEDOR_TOTP));
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load', timeout: 20000 }),
      page.click('#mfa-btn'),
    ]);
    await page.waitForFunction(() => window.supabaseClient !== undefined);
    check('el código correcto sube la sesión a aal2', (await aalDe(page)) === 'aal2');

    await page.goto(`${BASE}/admin.html`);
    await page.waitForTimeout(2500);
    check('y con eso el panel deja entrar', page.url().endsWith('/admin.html'),
      page.url().replace(BASE, ''));
  }

  // ── 2. El ALTA: un empleado que todavía no tiene autenticador ────────────
  {
    // Ascenso temporal del cliente para tener un empleado sin factor.
    const admin = await api('/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASS }),
    });
    const { factors } = await api('/user', { token: admin.access_token });
    const fa = factors.find((f) => f.status === 'verified');
    const reto = await api(`/factors/${fa.id}/challenge`, { method: 'POST', token: admin.access_token });
    const sesionAdmin = await api(`/factors/${fa.id}/verify`, {
      method: 'POST', token: admin.access_token,
      body: JSON.stringify({ challenge_id: reto.id, code: await codigoTOTPFresco(env.ADMIN_TOTP) }),
    });

    const cli = await api('/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email: env.CLIENTE_EMAIL, password: env.CLIENTE_PASS }),
    });
    const idCliente = cli.user.id;

    // El ascenso pasa por PostgREST con el token del admin a aal2: si la
    // Mejora 3 estuviera rota, esto mismo fallaria.
    const r = await fetch(`${URL_SB}/rest/v1/profiles?id=eq.${idCliente}`, {
      method: 'PATCH',
      headers: { apikey: LLAVE, Authorization: `Bearer ${sesionAdmin.access_token}`,
                 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ role: 'vendedor' }),
    });
    const filas = await r.json();
    if (!r.ok || filas.length !== 1) throw new Error(`ascenso fallido: ${r.status} ${JSON.stringify(filas)}`);
    ascendido = true;
    check('un admin con 2FA sí puede cambiar un rol', filas[0].role === 'vendedor');

    // Momento util: acaba de existir un empleado sin autenticador, que es lo
    // unico que la auditoria deberia senalar. Sin esta comprobacion la funcion
    // solo se ha visto devolver [] y no sabriamos si detecta algo.
    const aud = await fetch(`${URL_SB}/rest/v1/rpc/empleados_sin_segundo_factor`, {
      method: 'POST',
      headers: { apikey: LLAVE, Authorization: `Bearer ${sesionAdmin.access_token}`,
                 'Content-Type': 'application/json' },
      body: '{}',
    });
    const pendientes = await aud.json();
    check('la auditoria detecta al empleado sin segundo factor',
      Array.isArray(pendientes) && pendientes.length === 1 &&
        pendientes[0].email === env.CLIENTE_EMAIL,
      `filas=${Array.isArray(pendientes) ? pendientes.length : JSON.stringify(pendientes)}`);

    const page = await (await browser.newContext()).newPage();
    await entrarPorElFormulario(page, env.CLIENTE_EMAIL, env.CLIENTE_PASS);

    await page.waitForSelector('#view-mfa.active', { timeout: 8000 });
    await page.waitForSelector('#mfa-alta', { state: 'visible', timeout: 8000 });
    check('a un empleado sin autenticador se le ofrece el alta', true);

    const src = await page.locator('#mfa-qr').getAttribute('src');
    check('el QR se pinta de verdad', /^data:image\/svg\+xml/.test(src ?? ''),
      `src="${(src ?? '').slice(0, 30)}…"`);

    const secreto = (await page.locator('#mfa-secreto').innerText()).trim();
    check('se ofrece la clave escrita para quien no puede escanear',
      /^[A-Z2-7]{16,}$/.test(secreto), `${secreto.length} caracteres`);

    await page.screenshot({ path: 'tests/screenshots/mfa-alta.png' });

    // El código sale del secreto que la propia pantalla acaba de mostrar:
    // si el QR y la clave no correspondieran al factor, esto fallaría.
    await page.fill('#mfa-codigo', await codigoTOTPFresco(secreto));
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load', timeout: 20000 }),
      page.click('#mfa-btn'),
    ]);
    await page.waitForFunction(() => window.supabaseClient !== undefined);
    check('el alta deja la sesión a aal2 en un solo paso', (await aalDe(page)) === 'aal2');

    // Limpieza del factor: a aal2 la cuenta ya puede quitarse el suyo.
    const quitado = await page.evaluate(async () => {
      const { data } = await window.supabaseClient.auth.mfa.listFactors();
      const errores = [];
      for (const f of data.all ?? []) {
        const { error } = await window.supabaseClient.auth.mfa.unenroll({ factorId: f.id });
        if (error) errores.push(error.message);
      }
      const { data: quedan } = await window.supabaseClient.auth.mfa.listFactors();
      return { errores, restantes: quedan?.all?.length ?? -1 };
    });
    check('la cuenta puede quitarse su propio autenticador a aal2',
      quitado.restantes === 0, JSON.stringify(quitado));
  }
} finally {
  if (ascendido) {
    // Devolver el rol pase lo que pase, para no dejar un cliente ascendido.
    const admin = await api('/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASS }),
    });
    const { factors } = await api('/user', { token: admin.access_token });
    const fa = factors.find((f) => f.status === 'verified');
    const reto = await api(`/factors/${fa.id}/challenge`, { method: 'POST', token: admin.access_token });
    const s = await api(`/factors/${fa.id}/verify`, {
      method: 'POST', token: admin.access_token,
      body: JSON.stringify({ challenge_id: reto.id, code: await codigoTOTPFresco(env.ADMIN_TOTP) }),
    });
    const cli = await api('/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email: env.CLIENTE_EMAIL, password: env.CLIENTE_PASS }),
    });
    const r = await fetch(`${URL_SB}/rest/v1/profiles?id=eq.${cli.user.id}`, {
      method: 'PATCH',
      headers: { apikey: LLAVE, Authorization: `Bearer ${s.access_token}`,
                 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ role: 'cliente' }),
    });
    const filas = await r.json();
    const rol = filas?.[0]?.role;
    console.log(`\n(limpieza) rol del cliente restaurado a: ${rol ?? 'ERROR ' + JSON.stringify(filas)}`);
    // Fallar ruidosamente si el rol no volvió a su sitio. Un cliente que se
    // queda ascendido no rompe esta suite, rompe la siguiente: en rls.spec
    // las dos pruebas que comprueban que el cliente sólo se ve a sí mismo
    // empezarían a fallar sin que nada apunte a la causa.
    if (rol !== 'cliente') {
      console.error('LIMPIEZA FALLIDA: el cliente quedó como ' + rol + '.');
      console.error('Corrígelo antes de correr rls.spec.mjs:');
      console.error(`  update public.profiles set role = 'cliente' where email = '${env.CLIENTE_EMAIL}';`);
      resultados.push({ nombre: 'limpieza del rol temporal', ok: false });
    }
  }
  await browser.close();
}

const fallidas = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - fallidas.length}/${resultados.length} pruebas de interfaz pasaron`);
process.exit(fallidas.length ? 1 : 0);
