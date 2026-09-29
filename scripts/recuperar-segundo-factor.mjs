// Recupera el acceso de un empleado que perdio su autenticador.
//
// Lo corre el operador autorizado, en su propia maquina, con la llave de
// servicio en el entorno. Nunca desde el navegador ni desde un ticket.
//
//   HEPSA_SUPABASE_URL=https://<ref>.supabase.co \
//   HEPSA_SUPABASE_SECRET_KEY=<llave de servicio> \
//   node scripts/recuperar-segundo-factor.mjs --email persona@ejemplo.com
//
// Sin --aplicar solo muestra lo que haria. Con --aplicar exige --autorizo y
// --canal, que quedan en el registro de auditoria.
//
// El ORDEN de los pasos no es estetico; cada uno se verifico contra Supabase
// Auth antes de escribir esto:
//
// 1. Se cambia la contrasena ANTES de borrar el factor. Sin factor, cualquiera
//    que tenga la contrasena puede inscribir SU PROPIO autenticador y quedarse
//    con la cuenta. Ademas, el cambio de contrasena revoca todos los tokens de
//    refresco: las sesiones abiertas ya no se pueden renovar.
// 2. Se borran los factores con la API administrativa. Una sesion que sobreviva
//    al refrescar queda en aal1, sin acceso de personal.
// 3. Lo que ninguna de las dos cosas corta es el token de acceso YA EMITIDO:
//    sigue valiendo con aal2 hasta que expira (jwt_expiry, 3600 s por defecto).
//    Si se sospecha que la cuenta esta comprometida, --compromiso baja el rol a
//    cliente primero: el rol se lee de la base en cada peticion, asi que eso
//    corta el acceso de inmediato aunque el token siga siendo valido.
//
// Lo que NO hace, a proposito: suspender con ban_duration. Suspender y luego
// levantar la suspension revive las sesiones anteriores con aal2 intacto; no
// sirve para revocar.
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const ROLES_PERSONAL = ['vendedor', 'admin'];

function leerArgs(argv) {
  const args = { aplicar: false, compromiso: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--aplicar') args.aplicar = true;
    else if (a === '--compromiso') args.compromiso = true;
    else if (['--email', '--autorizo', '--canal', '--restaurar-rol'].includes(a)) args[a.slice(2)] = argv[++i];
    else throw new Error(`Argumento desconocido: ${a}`);
  }
  return args;
}

function fallar(mensaje, codigo = 2) {
  console.error(mensaje);
  process.exit(codigo);
}

const args = (() => { try { return leerArgs(process.argv.slice(2)); } catch (e) { return fallar(e.message); } })();
const URL_SB = process.env.HEPSA_SUPABASE_URL;
const LLAVE = process.env.HEPSA_SUPABASE_SECRET_KEY;

if (!args.email) fallar('Falta --email del empleado.');
if (!URL_SB || !LLAVE) fallar('Faltan HEPSA_SUPABASE_URL y HEPSA_SUPABASE_SECRET_KEY en el entorno.');
const destino = new URL(URL_SB);
const esLoopback = ['127.0.0.1', 'localhost'].includes(destino.hostname);
if (destino.protocol !== 'https:' && !esLoopback) fallar(`Destino inseguro: ${URL_SB}. Se exige https.`);
if (args['restaurar-rol'] && !ROLES_PERSONAL.includes(args['restaurar-rol'])) {
  fallar(`--restaurar-rol solo admite: ${ROLES_PERSONAL.join(', ')}.`);
}
if ((args.aplicar || args['restaurar-rol']) && (!args.autorizo || !args.canal)) {
  fallar('Para modificar la cuenta hacen falta --autorizo "<quien autorizo>" y --canal "<como se verifico la identidad>".');
}

const admin = createClient(destino.origin, LLAVE, { auth: { persistSession: false, autoRefreshToken: false } });

async function buscarUsuario(email) {
  // listUsers pagina; se recorre hasta encontrarlo para no depender del tamano.
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
    if (u) return u;
    if (data.users.length < 200) return null;
  }
}

const usuario = await buscarUsuario(args.email);
if (!usuario) fallar(`No existe un usuario con el correo ${args.email}.`, 1);

const perfil = await admin.from('profiles').select('role').eq('id', usuario.id).maybeSingle();
if (perfil.error) fallar(`No se pudo leer el perfil: ${perfil.error.message}`, 1);
const rol = perfil.data?.role ?? null;

const lista = await admin.auth.admin.mfa.listFactors({ userId: usuario.id });
if (lista.error) fallar(`No se pudieron listar los factores: ${lista.error.message}`, 1);
const factores = lista.data.factors;

const registro = {
  fecha: new Date().toISOString(),
  proyecto: destino.origin,
  usuario_id: usuario.id,
  email: usuario.email,
  rol_encontrado: rol,
  factores_encontrados: factores.map((f) => ({ id: f.id, tipo: f.factor_type, estado: f.status, nombre: f.friendly_name })),
  autorizo: args.autorizo ?? null,
  canal_verificacion: args.canal ?? null,
};

// ─── Restaurar el rol tras la reinscripcion ─────────────────────────────────
if (args['restaurar-rol']) {
  // Devolver acceso de personal a una cuenta SIN factor verificado reabriria
  // justo la puerta que se cerro. Se exige la reinscripcion primero.
  if (!factores.some((f) => f.status === 'verified')) {
    fallar('La cuenta no tiene un factor verificado. Primero debe reinscribir su autenticador.', 1);
  }
  const cambio = await admin.from('profiles').update({ role: args['restaurar-rol'] }).eq('id', usuario.id).select('role').single();
  if (cambio.error) fallar(`No se pudo restaurar el rol: ${cambio.error.message}`, 1);
  console.log(JSON.stringify({ ...registro, accion: 'restaurar-rol', rol_nuevo: cambio.data.role }, null, 2));
  process.exit(0);
}

if (!ROLES_PERSONAL.includes(rol)) {
  console.error(`Aviso: el rol es ${rol}. Este procedimiento es para personal; a un cliente no se le exige segundo factor.`);
}
if (rol === 'admin') {
  console.error('Aviso: la cuenta es de administrador. Si es la unica, nadie mas podra gestionar roles hasta que se reinscriba.');
}

if (!args.aplicar) {
  console.log(JSON.stringify({ ...registro, accion: 'simulacion', se_haria: [
    ...(args.compromiso ? ['bajar el rol a cliente'] : []),
    'cambiar la contrasena (revoca los tokens de refresco)',
    `borrar ${factores.length} factor(es)`,
  ] }, null, 2));
  console.error('\nSimulacion: no se modifico nada. Repite con --aplicar para ejecutarlo.');
  process.exit(0);
}

// ─── Aplicar, en el orden verificado ────────────────────────────────────────
const hechos = [];

if (args.compromiso && ROLES_PERSONAL.includes(rol)) {
  const baja = await admin.from('profiles').update({ role: 'cliente' }).eq('id', usuario.id);
  if (baja.error) fallar(`No se pudo bajar el rol: ${baja.error.message}`, 1);
  hechos.push(`rol bajado de ${rol} a cliente`);
}

const temporal = randomBytes(18).toString('base64url');
const cambio = await admin.auth.admin.updateUserById(usuario.id, { password: temporal });
if (cambio.error) fallar(`No se pudo cambiar la contrasena: ${cambio.error.message}. No se borro ningun factor.`, 1);
hechos.push('contrasena cambiada; tokens de refresco revocados');

const borrados = [];
for (const f of factores) {
  const del = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: usuario.id });
  if (del.error) fallar(`Fallo al borrar el factor ${f.id}: ${del.error.message}. La contrasena YA se cambio.`, 1);
  borrados.push(f.id);
}
hechos.push(`${borrados.length} factor(es) borrados`);

// El registro va a stdout y se puede guardar. La contrasena temporal va a
// stderr, aparte, para que nadie la pegue en un ticket junto con el registro.
console.log(JSON.stringify({ ...registro, accion: 'recuperacion', hechos, factores_borrados: borrados,
  pendiente: args.compromiso && ROLES_PERSONAL.includes(rol)
    ? `reinscripcion supervisada y luego --restaurar-rol ${rol}`
    : 'reinscripcion supervisada del autenticador' }, null, 2));
console.error('\nContrasena temporal (entregala por el canal verificado, una sola vez, y no la guardes):');
console.error(temporal);
