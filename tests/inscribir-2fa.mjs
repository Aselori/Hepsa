// ============================================================================
// Da de alta un autenticador TOTP para una cuenta e imprime su secreto.
//
// Para qué: desde la Mejora 3 el personal no entra sin segundo factor, así que
// las cuentas de prueba necesitan uno. Una persona lo inscribe escaneando el
// QR del portal; la suite no tiene ojos, así que necesita el secreto en claro
// para poder calcular el código. Esto lo obtiene una sola vez.
//
//   node --env-file=tests/.env.local tests/inscribir-2fa.mjs ADMIN
//
// Imprime la línea ADMIN_TOTP=... que hay que pegar en tests/.env.local.
//
// Habla con la API de auth y no con la base: los factores viven en el esquema
// auth, fuera del alcance de RLS y de las migraciones. Por eso mismo un
// empleado a aal1 todavía puede inscribirse, que es lo que evita que exigir
// aal2 encierre a todo el personal.
// ============================================================================

import { readFileSync } from 'node:fs';
import { codigoTOTP } from './totp.mjs';

const prefijo = process.argv[2];
if (!prefijo) {
  console.error('Uso: node --env-file=tests/.env.local tests/inscribir-2fa.mjs ADMIN|VENDEDOR');
  process.exit(2);
}

const email = process.env[`${prefijo}_EMAIL`];
const pass  = process.env[`${prefijo}_PASS`];
if (!email || !pass) {
  console.error(`Falta ${prefijo}_EMAIL o ${prefijo}_PASS en tests/.env.local`);
  process.exit(2);
}

// La URL y la llave salen de config.js para no tener el proyecto escrito en
// dos lados: si alguien apunta el sitio a otra base, esto lo sigue.
const config = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const URL_BASE = config.match(/supabaseUrl:\s*'([^']+)'/)?.[1];
const LLAVE    = config.match(/supabaseKey:\s*'([^']+)'/)?.[1];
if (!URL_BASE || !LLAVE) {
  console.error('No pude leer supabaseUrl/supabaseKey de config.js');
  process.exit(2);
}

async function auth(ruta, { token, ...opciones } = {}) {
  const r = await fetch(`${URL_BASE}/auth/v1${ruta}`, {
    ...opciones,
    headers: {
      apikey: LLAVE,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const cuerpo = await r.json();
  if (!r.ok) throw new Error(`${ruta} → ${r.status} ${JSON.stringify(cuerpo)}`);
  return cuerpo;
}

const { access_token } = await auth('/token?grant_type=password', {
  method: 'POST',
  body: JSON.stringify({ email, password: pass }),
});

// Un factor sin verificar de un intento anterior bloquea el alta por nombre
// repetido, así que se limpia lo que haya quedado a medias.
const { factors = [] } = await auth('/user', { token: access_token });
for (const f of factors) {
  if (f.status !== 'verified') {
    await auth(`/factors/${f.id}`, { method: 'DELETE', token: access_token });
    console.error(`(se descartó un factor sin confirmar: ${f.id})`);
  }
}
if (factors.some((f) => f.status === 'verified')) {
  console.error(`${email} ya tiene un autenticador confirmado.`);
  console.error('Bórralo desde el portal o con DELETE /factors/{id} antes de inscribir otro:');
  console.error('el secreto sólo se entrega en el momento del alta y no se puede recuperar.');
  process.exit(1);
}

const factor = await auth('/factors', {
  method: 'POST',
  token: access_token,
  body: JSON.stringify({ friendly_name: 'HEPSA', factor_type: 'totp', issuer: 'HEPSA' }),
});
const secreto = factor.totp.secret;

// Inscribir no basta: un factor que nunca se confirma deja la cuenta a medias.
const reto = await auth(`/factors/${factor.id}/challenge`, { method: 'POST', token: access_token });
await auth(`/factors/${factor.id}/verify`, {
  method: 'POST',
  token: access_token,
  body: JSON.stringify({ challenge_id: reto.id, code: codigoTOTP(secreto) }),
});

console.error(`Autenticador confirmado para ${email}. Pega esta línea en tests/.env.local:`);
console.log(`${prefijo}_TOTP=${secreto}`);
