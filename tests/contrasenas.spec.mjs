// Contraseñas fuertes: la regla la impone Supabase Auth, no el formulario.
//
// Antes se podía crear una cuenta con "123456". Ahora Auth exige 10
// caracteres o más con minúscula, mayúscula y número (supabase/config.toml;
// en el proyecto hospedado, Authentication > Providers > Email). Aquí se
// prueba primero la regla en el servidor, que es la que no se salta editando
// el JavaScript, y luego que el portal la explique antes de enviar.
//
// Las cuentas que se crean usan @contrasena.test; tests/local.mjs las borra.
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { contrasenaDePrueba } from './contrasena.mjs';

const URL_SB = process.env.HEPSA_TEST_SUPABASE_URL;
const LLAVE = process.env.HEPSA_TEST_SUPABASE_KEY;
const BASE = process.env.BASE_URL;
if (!URL_SB?.startsWith('http://127.0.0.1:') || !LLAVE || !BASE) {
  console.error('Esta suite sólo corre contra el stack local: npm run test:local');
  process.exit(2);
}

const checks = [];
function check(nombre, ok, detalle = '') {
  checks.push(ok);
  console.log(`${ok ? 'PASA  ' : 'FALLA '} ${nombre}${detalle ? '  — ' + detalle : ''}`);
}
const correo = () => `c-${randomUUID().slice(0, 8)}@contrasena.test`;
const cliente = () => createClient(URL_SB, LLAVE, { auth: { persistSession: false, autoRefreshToken: false } });

for (const [debil, por] of [['123456', 'corta y sólo números'], ['contrasena1', 'sin mayúscula'], ['Corta1', 'menos de 10']]) {
  const { error } = await cliente().auth.signUp({ email: correo(), password: debil });
  check(`Auth rechaza "${debil}" (${por})`, error?.code === 'weak_password', `code=${error?.code ?? 'sin error'}`);
}
const fuerte = await cliente().auth.signUp({ email: correo(), password: contrasenaDePrueba() });
check('Auth acepta una contraseña que cumple la regla', !fuerte.error, fuerte.error?.message ?? '');

const navegador = await chromium.launch();
try {
  const contexto = await navegador.newContext();
  await contexto.route('**/*', (r) => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
  const page = await contexto.newPage();
  const avisos = [];
  page.on('dialog', async (d) => { avisos.push(d.message()); await d.dismiss(); });
  await page.goto(`${BASE}/index.html`);
  await page.waitForFunction(() => window.supabaseClient);
  await page.evaluate(() => showView('register'));
  const regla = await page.locator('#reg-pass-regla').textContent();
  check('el formulario dice la regla antes de escribir', /10 caracteres/.test(regla), regla);

  const llenar = async (pass) => {
    await page.fill('#reg-n1', 'Prueba'); await page.fill('#reg-p', 'Contraseña'); await page.fill('#reg-m', 'Fuerte');
    await page.fill('#reg-email', correo()); await page.fill('#reg-pass', pass); await page.fill('#reg-pass2', pass);
    await page.evaluate(() => registrarUsuarioBD());
    await page.waitForTimeout(800);
  };
  await llenar('123456');
  check('con "123456" el portal dice qué falta y no envía nada',
    avisos.at(-1)?.includes('al menos 10 caracteres') && avisos.at(-1)?.includes('una mayúscula'), avisos.at(-1));
  await llenar(contrasenaDePrueba());
  check('con una contraseña fuerte la cuenta se crea', avisos.at(-1)?.startsWith('Cuenta creada'), avisos.at(-1));
} finally {
  await navegador.close();
}

const fallidas = checks.filter((ok) => !ok).length;
console.log(`${checks.length - fallidas}/${checks.length} comprobaciones de contraseñas.`);
if (fallidas) process.exitCode = 1;
