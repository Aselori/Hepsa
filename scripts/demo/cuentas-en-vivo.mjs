// ============================================================================
// CUENTAS DE DEMOSTRACIÓN EN EL SITIO PUBLICADO · BORRAR ANTES DE USO REAL
//
// Crea una cuenta genérica por rol para la exposición (correos @example.com,
// que no pertenecen a nadie), ya confirmadas y con su rol.
// NO inscribe segundo factor: cada cuenta del personal lo activa en su
// primer ingreso, escaneando el QR con el teléfono de quien graba.
//
// Necesita la llave de servicio del proyecto. Se corre así, con la llave en
// el ambiente (nunca en el repositorio):
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/demo/cuentas-en-vivo.mjs
// o con un archivo de ambiente:
//   node --env-file=<archivo> scripts/demo/cuentas-en-vivo.mjs
//
// La contraseña (una sola, aleatoria, para todas) se escribe en
// ~/hepsa-cuentas-demo.txt con permisos 600. Correrlo de nuevo no duplica
// cuentas. Después: scripts/demo/datos-en-vivo.sql. Se borra todo con
// scripts/demo/borrar-datos-en-vivo.sql.
// ============================================================================
import { randomBytes } from 'node:crypto';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createClient } from '@supabase/supabase-js';

const URL_SB = process.env.SUPABASE_URL || 'https://qmyrosmuqfabaedzydsa.supabase.co';
const LLAVE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!LLAVE) {
  console.error('Falta SUPABASE_SERVICE_ROLE_KEY en el ambiente.');
  process.exit(1);
}
const sb = createClient(URL_SB, LLAVE, { auth: { persistSession: false, autoRefreshToken: false } });

const ARCHIVO = `${homedir()}/hepsa-cuentas-demo.txt`;
// Una contraseña nueva sólo si no hay archivo: así, al repetir, las cuentas
// ya creadas y el archivo siguen coincidiendo.
const contrasena = existsSync(ARCHIVO)
  ? readFileSync(ARCHIVO, 'utf8').match(/^Contraseña: (.+)$/m)[1]
  : `Demo-${randomBytes(9).toString('base64url')}-26`;

// Una cuenta genérica por rol, para la exposición.
const personas = [
  ['admin', 'Administrador', 'Demo', 'admin.demo@example.com', '81 2233 4455'],
  ['seller', 'Vendedor', 'Demo', 'vendedor.demo@example.com', '81 3344 5566'],
  ['workshop', 'Taller', 'Demo', 'taller.demo@example.com', '81 5566 7788'],
  ['customer', 'Cliente', 'Demo', 'cliente.demo@example.com', '81 7788 9900'],
];

const { data: lista, error: errorLista } = await sb.auth.admin.listUsers({ perPage: 1000 });
if (errorLista) throw errorLista;
for (const [rol, nombre, apellido, email, telefono] of personas) {
  let usuario = lista.users.find((u) => u.email === email);
  if (!usuario) {
    const { data, error } = await sb.auth.admin.createUser({
      email, password: contrasena, email_confirm: true,
      user_metadata: { first_name: nombre, last_name: apellido, phone: telefono },
    });
    if (error) throw new Error(`${email}: ${error.message}`);
    usuario = data.user;
  }
  const { error } = await sb.from('profiles').update({ role: rol, phone: telefono }).eq('id', usuario.id);
  if (error) throw new Error(`${email} (rol): ${error.message}`);
  console.log(`${rol.padEnd(9)} ${email}`);
}

writeFileSync(ARCHIVO, [
  'Cuentas de demostración de HEPSA (sitio publicado). Borrar antes de uso real.',
  `Contraseña: ${contrasena}`,
  ...personas.map(([rol, , , email]) => `${rol.padEnd(9)} ${email}`),
  '',
].join('\n'), { mode: 0o600 });
console.log(`\nListo. Contraseña y cuentas en ${ARCHIVO}`);
