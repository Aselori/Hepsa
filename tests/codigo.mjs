// ============================================================================
// Imprime el codigo de 6 digitos de una cuenta de prueba, ahora mismo.
//
// Para que: desde la Mejora 3 el personal necesita un segundo factor para
// entrar. Si el autenticador no esta en un telefono, esto lo suple desde la
// terminal y sirve para probar el sitio sin instalar nada.
//
//   node --env-file=tests/.env.local tests/codigo.mjs VENDEDOR
//
// Para una demostracion de verdad conviene tener el codigo en el telefono, que
// es como lo va a usar el personal. Ver la guia para meter la clave a mano en
// Google Authenticator, Authy o 1Password.
// ============================================================================

import { codigoTOTP } from './totp.mjs';

const prefijo = (process.argv[2] || 'VENDEDOR').toUpperCase();
const secreto = process.env[`${prefijo}_TOTP`];

if (!secreto) {
  console.error(`Falta ${prefijo}_TOTP en tests/.env.local.`);
  console.error('Cuentas disponibles: ADMIN, VENDEDOR (al cliente no se le pide segundo factor).');
  process.exit(2);
}

const segundosRestantes = 30 - Math.floor((Date.now() / 1000) % 30);

console.log('');
console.log(`  Cuenta:  ${process.env[`${prefijo}_EMAIL`] ?? prefijo}`);
console.log(`  Codigo:  ${codigoTOTP(secreto)}`);
console.log(`  Vence en ${segundosRestantes} s`);
if (segundosRestantes <= 5) {
  console.log('  (queda poco: espera a que salga el siguiente antes de escribirlo)');
}
console.log('');
