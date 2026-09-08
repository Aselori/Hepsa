// ============================================================================
// TOTP (RFC 6238) para las pruebas.
//
// La suite tiene que iniciar sesión como personal, y desde la Mejora 3 eso
// exige un código de 6 dígitos. Se calcula aquí en vez de depender de un
// paquete: son treinta líneas, y meter una dependencia nueva para las pruebas
// obligaría a un npm install en CI que hoy no hace falta.
//
// El secreto de cada cuenta de prueba vive en tests/.env.local, fuera de git,
// junto a su contraseña. Quien tenga ese archivo ya tenía la cuenta entera.
// ============================================================================

import { createHmac } from 'node:crypto';

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// Base32 de RFC 4648, que es como Supabase entrega el secreto del factor.
function base32ABytes(secreto) {
  const limpio = secreto.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0, valor = 0;
  const bytes = [];
  for (const c of limpio) {
    const i = ALFABETO.indexOf(c);
    if (i < 0) throw new Error(`Carácter no válido en el secreto TOTP: ${c}`);
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// El código que la app autenticadora mostraría en este instante.
export function codigoTOTP(secretoBase32, momentoMs = Date.now()) {
  const paso = Math.floor(momentoMs / 1000 / 30);
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(paso));

  const hmac = createHmac('sha1', base32ABytes(secretoBase32)).update(contador).digest();
  // Truncamiento dinámico: los 4 bits bajos del último byte dicen dónde
  // empieza el número dentro del hash.
  const desde = hmac[hmac.length - 1] & 0x0f;
  const binario =
      ((hmac[desde] & 0x7f) << 24) |
      (hmac[desde + 1] << 16) |
      (hmac[desde + 2] << 8) |
       hmac[desde + 3];

  return String(binario % 1_000_000).padStart(6, '0');
}

// Un código sólo vive 30 segundos y Supabase rechaza el mismo dos veces
// seguidas. Si la ventana está por cerrarse conviene esperar a la siguiente
// en vez de mandar uno que va a vencer entre el challenge y el verify.
export async function codigoTOTPFresco(secretoBase32, margenMs = 3000) {
  const restante = 30_000 - (Date.now() % 30_000);
  if (restante < margenMs) {
    await new Promise((r) => setTimeout(r, restante + 250));
  }
  return codigoTOTP(secretoBase32);
}
