// Regresion de seguridad: un usuario autenticado SIN fila en public.profiles.
//
// Reproducido contra el stack local antes del arreglo: con AAL2, ese usuario
// llamaba a empleados_sin_segundo_factor() y recibia la lista del personal en
// lugar de un error. Lo que se filtraba es precisamente que cuentas del
// personal no tienen segundo factor, o sea cuales se pueden tomar sabiendo
// solo la contrasena.
//
// La cadena era: current_user_role() devuelve NULL sin fila -> is_admin() era
// true AND NULL = NULL -> el guardia IF NOT is_admin() no entraba, porque en
// PL/pgSQL una condicion NULL no ejecuta la rama.
//
// Solo se abria a AAL2: a AAL1 la expresion valia false AND NULL = false y el
// guardia si saltaba. Por eso el fixture llega hasta AAL2.
//
// Las credenciales las prepara tests/local.mjs, que es quien tiene la llave de
// servicio; aqui solo se usa la sesion del propio usuario.
import { createClient } from '@supabase/supabase-js';
import { codigoTOTPFresco } from './totp.mjs';

const URL_SB = process.env.HEPSA_TEST_SUPABASE_URL;
const LLAVE = process.env.HEPSA_TEST_SUPABASE_KEY;
const EMAIL = process.env.HUERFANO_EMAIL;
const PASS = process.env.HUERFANO_PASS;
const TOTP = process.env.HUERFANO_TOTP;

if (!URL_SB || !LLAVE || !EMAIL || !PASS || !TOTP) {
  console.error('Falta el fixture sin perfil. Ejecuta esta suite con: npm run test:local');
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

const cliente = createClient(URL_SB, LLAVE, { auth: { persistSession: false, autoRefreshToken: false } });
try {
  const login = await cliente.auth.signInWithPassword({ email: EMAIL, password: PASS });
  if (login.error) throw login.error;

  const { data: factores } = await cliente.auth.mfa.listFactors();
  const totp = factores?.totp?.[0];
  check('el usuario sin perfil puede iniciar sesion y tiene su factor', Boolean(totp));
  const verif = await cliente.auth.mfa.challengeAndVerify({
    factorId: totp.id, code: await codigoTOTPFresco(TOTP),
  });
  if (verif.error) throw verif.error;

  const aal = JSON.parse(Buffer.from(verif.data.access_token.split('.')[1], 'base64url')).aal;
  check('llega a aal2, que es donde se abria el agujero', aal === 'aal2', `aal=${aal}`);

  const sinPerfil = await cliente.from('profiles').select('id').eq('id', login.data.user.id);
  check('efectivamente no tiene fila en profiles', (sinPerfil.data?.length ?? 0) === 0,
    `filas=${sinPerfil.data?.length}`);

  // El nucleo de la regresion.
  const auditoria = await cliente.rpc('empleados_sin_segundo_factor');
  check('la auditoria RECHAZA a un usuario sin perfil',
    auditoria.error !== null && (auditoria.data === null || auditoria.data.length === 0),
    auditoria.error ? `rechazo: ${auditoria.error.message}` : `DEVOLVIO ${auditoria.data?.length} filas`);

  // Y que tampoco haya heredado permisos de personal por la misma via.
  const perfiles = await cliente.from('profiles').select('id');
  check('no ve el directorio de perfiles', (perfiles.data?.length ?? 0) === 0,
    `filas=${perfiles.data?.length ?? 0}`);
  const solicitudes = await cliente.from('custom_requests').select('id');
  check('no ve las solicitudes', (solicitudes.data?.length ?? 0) === 0,
    `filas=${solicitudes.data?.length ?? 0}`);
  const escritura = await cliente.from('products').insert([{ name: 'INTRUSO SIN PERFIL', price: 1 }]);
  check('no puede escribir en el catalogo', escritura.error !== null,
    `error=${JSON.stringify(escritura.error?.message ?? null)}`);
} finally {
  await cliente.auth.signOut();
}

const fallidas = checks.filter(ok => !ok).length;
console.log(`${checks.length - fallidas}/${checks.length} comprobaciones del usuario sin perfil.`);
if (fallidas) process.exitCode = 1;
