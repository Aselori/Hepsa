// Prueba del procedimiento de recuperacion del segundo factor.
//
// Ejecuta scripts/recuperar-segundo-factor.mjs como proceso aparte, igual que
// lo haria el operador, contra el stack local. Cada comprobacion corresponde a
// un hecho que se verifico antes de escribir el procedimiento, para que si
// Supabase cambia de comportamiento la prueba lo diga en vez de dejar el
// documento mintiendo.
//
// Lee la llave de servicio de `supabase status`, igual que tests/local.mjs, y
// se niega a correr fuera del stack local.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { codigoTOTPFresco } from './totp.mjs';

const est = JSON.parse(execFileSync('node_modules/.bin/supabase', ['status', '-o', 'json'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const URL_SB = new URL(est.API_URL).origin;
if (URL_SB !== 'http://127.0.0.1:55321') {
  console.error(`Destino no permitido: ${URL_SB}. Esta suite solo corre contra el stack local.`);
  process.exit(2);
}
const KEY = est.PUBLISHABLE_KEY || est.ANON_KEY;
const SECRETA = est.SECRET_KEY || est.SERVICE_ROLE_KEY;
const admin = createClient(URL_SB, SECRETA, { auth: { persistSession: false, autoRefreshToken: false } });
const nuevo = () => createClient(URL_SB, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const aal = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url')).aal;

const checks = [];
function check(nombre, ok, detalle = '') {
  checks.push(ok);
  console.log(`${ok ? 'PASA  ' : 'FALLA '} ${nombre}${detalle ? '  — ' + detalle : ''}`);
}

function script(...args) {
  const r = spawnSync(process.execPath, ['scripts/recuperar-segundo-factor.mjs', ...args], {
    encoding: 'utf8',
    env: { ...process.env, HEPSA_SUPABASE_URL: URL_SB, HEPSA_SUPABASE_SECRET_KEY: SECRETA },
  });
  return { codigo: r.status, salida: r.stdout, errores: r.stderr };
}

const ids = [];
async function empleadoConFactor(rol = 'vendedor') {
  const email = `recuperacion-${randomUUID()}@example.test`;
  const pass = randomBytes(24).toString('base64url');
  const { data, error } = await admin.auth.admin.createUser({ email, password: pass, email_confirm: true });
  if (error) throw error;
  ids.push(data.user.id);
  await admin.from('profiles').update({ role: rol }).eq('id', data.user.id);
  const c = nuevo();
  await c.auth.signInWithPassword({ email, password: pass });
  const f = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'HEPSA' });
  const v = await c.auth.mfa.challengeAndVerify({ factorId: f.data.id, code: await codigoTOTPFresco(f.data.totp.secret) });
  if (v.error) throw v.error;
  return { id: data.user.id, email, pass, sesion: v.data };
}
async function solicitudesCon(token) {
  const c = createClient(URL_SB, KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const r = await c.from('custom_requests').select('id');
  return r.error ? -1 : r.data.length;
}
async function factoresVerificados(id) {
  const { data } = await admin.auth.admin.mfa.listFactors({ userId: id });
  return data.factors.filter((f) => f.status === 'verified').length;
}
async function reinscribir(email, pass) {
  const c = nuevo();
  const login = await c.auth.signInWithPassword({ email, password: pass });
  if (login.error) return { error: login.error.message };
  const nivel = (await c.auth.mfa.getAuthenticatorAssuranceLevel()).data;
  const f = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'HEPSA' });
  const v = await c.auth.mfa.challengeAndVerify({ factorId: f.data.id, code: await codigoTOTPFresco(f.data.totp.secret) });
  return { nivel, token: v.data?.access_token, error: v.error?.message };
}

try {
  // ── Recuperacion normal ──────────────────────────────────────────────────
  const e = await empleadoConFactor();

  const sinPermiso = script('--email', e.email, '--aplicar');
  check('se niega a modificar sin --autorizo y --canal', sinPermiso.codigo === 2 && await factoresVerificados(e.id) === 1,
    `codigo=${sinPermiso.codigo}`);

  const sim = script('--email', e.email);
  const pw = await nuevo().auth.signInWithPassword({ email: e.email, password: e.pass });
  check('la simulacion no cambia nada', sim.codigo === 0 && await factoresVerificados(e.id) === 1 && !pw.error);

  const tokenViejo = e.sesion.access_token;
  const hecho = script('--email', e.email, '--aplicar', '--autorizo', 'Propietario (prueba)', '--canal', 'Llamada al telefono registrado (prueba)');
  const temporal = hecho.errores.trim().split('\n').pop();
  const registro = JSON.parse(hecho.salida);
  check('la recuperacion termina bien', hecho.codigo === 0, hecho.codigo === 0 ? '' : hecho.errores);
  check('el registro de auditoria no contiene la contrasena temporal', !hecho.salida.includes(temporal));
  check('el registro guarda quien autorizo y como se verifico',
    registro.autorizo?.includes('Propietario') && registro.canal_verificacion?.includes('telefono'));
  check('ya no quedan factores', await factoresVerificados(e.id) === 0);

  const vieja = await nuevo().auth.signInWithPassword({ email: e.email, password: e.pass });
  check('la contrasena vieja ya no entra', Boolean(vieja.error),
    'cierra la ventana en que cualquiera con la contrasena inscribiria su propio autenticador');
  const refresco = await nuevo().auth.refreshSession({ refresh_token: e.sesion.refresh_token });
  check('la sesion abierta ya no se puede renovar', Boolean(refresco.error));

  // Limitacion conocida: el token de acceso ya emitido sigue valiendo hasta
  // expirar. Se deja como comprobacion para que, si Supabase lo cambia, el
  // documento se actualice en vez de quedarse describiendo algo falso.
  const residual = await solicitudesCon(tokenViejo);
  check('documentado: el token ya emitido sigue valiendo hasta expirar (sin --compromiso)', residual > 0,
    `solicitudes con el token viejo=${residual}`);

  const re = await reinscribir(e.email, temporal);
  check('con la contrasena temporal la sesion arranca en aal1 y exige alta',
    re.nivel?.currentLevel === 'aal1' && re.nivel?.nextLevel === 'aal1', JSON.stringify(re.nivel));
  check('tras reinscribirse recupera el acceso de personal',
    !re.error && aal(re.token) === 'aal2' && await solicitudesCon(re.token) > 0);

  // ── Compromiso sospechado ────────────────────────────────────────────────
  const c = await empleadoConFactor();
  const tokenC = c.sesion.access_token;
  const comp = script('--email', c.email, '--aplicar', '--compromiso', '--autorizo', 'Propietario (prueba)', '--canal', 'En persona (prueba)');
  const tempC = comp.errores.trim().split('\n').pop();
  check('con --compromiso el token ya emitido pierde el acceso de inmediato', await solicitudesCon(tokenC) === 0,
    'el rol se lee de la base en cada peticion');

  const prematuro = script('--email', c.email, '--restaurar-rol', 'vendedor', '--autorizo', 'Propietario (prueba)', '--canal', 'En persona (prueba)');
  check('no devuelve el rol a una cuenta sin factor verificado', prematuro.codigo === 1);

  const reC = await reinscribir(c.email, tempC);
  const restaurado = script('--email', c.email, '--restaurar-rol', 'vendedor', '--autorizo', 'Propietario (prueba)', '--canal', 'En persona (prueba)');
  check('tras la reinscripcion restaura el rol y el acceso', restaurado.codigo === 0 && await solicitudesCon(reC.token) > 0);
} finally {
  for (const id of ids) {
    await admin.from('profiles').delete().eq('id', id);
    await admin.auth.admin.deleteUser(id);
  }
}

const fallidas = checks.filter((ok) => !ok).length;
console.log(`${checks.length - fallidas}/${checks.length} comprobaciones de recuperacion.`);
if (fallidas) process.exitCode = 1;
