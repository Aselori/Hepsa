// Regresion de seguridad: escalada a administrador con role NULL.
//
// Reproducido antes del arreglo, dentro de una transaccion deshecha: un usuario
// cuya fila en profiles tenia role NULL hacia UPDATE de su propia fila y quedaba
// como admin. La cadena: current_user_role() devolvia NULL, is_admin() valia
// true AND NULL = NULL a AAL2, y el guardia del disparador era
// "AND NOT is_admin()", que con NULL no entra en la rama.
//
// Una revision anterior no vio este caso porque buscaba el patron
// "IF NOT is_admin" y el disparador lo escribe "AND NOT is_admin".
//
// tests/local.mjs, que tiene la llave de servicio, intenta dejar la cuenta con
// role NULL y anota si la base se nego. Esta suite comprueba esa negativa y,
// ademas, intenta la escalada por la API real con la sesion del propio usuario,
// que es lo que haria un atacante.
import { createClient } from '@supabase/supabase-js';
import { codigoTOTPFresco } from './totp.mjs';

const URL_SB = process.env.HEPSA_TEST_SUPABASE_URL;
const LLAVE = process.env.HEPSA_TEST_SUPABASE_KEY;
const { ROL_NULO_RECHAZADO, ROL_NULO_DETALLE, ROLNULO_EMAIL, ROLNULO_PASS, ROLNULO_TOTP } = process.env;

if (!URL_SB || !LLAVE || !ROL_NULO_RECHAZADO || !ROLNULO_EMAIL || !ROLNULO_PASS || !ROLNULO_TOTP) {
  console.error('Falta el fixture de role NULL. Ejecuta esta suite con: npm run test:local');
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

check('la base se niega a guardar un role NULL', ROL_NULO_RECHAZADO === 'si', ROL_NULO_DETALLE);

const cliente = createClient(URL_SB, LLAVE, { auth: { persistSession: false, autoRefreshToken: false } });
try {
  const login = await cliente.auth.signInWithPassword({ email: ROLNULO_EMAIL, password: ROLNULO_PASS });
  if (login.error) throw login.error;
  const id = login.data.user.id;
  const { data: factores } = await cliente.auth.mfa.listFactors();
  const verif = await cliente.auth.mfa.challengeAndVerify({
    factorId: factores.totp[0].id, code: await codigoTOTPFresco(ROLNULO_TOTP),
  });
  if (verif.error) throw verif.error;
  const aal = JSON.parse(Buffer.from(verif.data.access_token.split('.')[1], 'base64url')).aal;
  check('llega a aal2, donde se abria la escalada', aal === 'aal2', `aal=${aal}`);

  const antes = (await cliente.from('profiles').select('role').eq('id', id).single()).data?.role ?? null;

  // El ataque: ascenderse a si mismo.
  const intento = await cliente.from('profiles').update({ role: 'admin' }).eq('id', id).select('role');
  const despues = (await cliente.from('profiles').select('role').eq('id', id).single()).data?.role ?? null;
  check('no puede ascenderse a admin', despues !== 'admin',
    `role antes=${antes} despues=${despues} error=${JSON.stringify(intento.error?.message ?? null)}`);

  const auditoria = await cliente.rpc('empleados_sin_segundo_factor');
  check('tampoco obtiene la lista del personal', auditoria.error !== null,
    auditoria.error ? `rechazo: ${auditoria.error.message}` : `DEVOLVIO ${auditoria.data?.length} filas`);
} finally {
  await cliente.auth.signOut();
}

const fallidas = checks.filter(ok => !ok).length;
console.log(`${checks.length - fallidas}/${checks.length} comprobaciones de role NULL.`);
if (fallidas) process.exitCode = 1;
