// Contraseñas para cuentas de prueba que cumplen la regla de Auth
// (supabase/config.toml: 10 caracteres o más, con minúscula, mayúscula y
// número). Un base64url al azar casi siempre las cumple, pero no siempre:
// sin el sufijo, cerca de una corrida de cada 200 fallaba al crear cuentas.
import { randomBytes } from 'node:crypto';

export const contrasenaDePrueba = () => `${randomBytes(18).toString('base64url')}aA1`;
