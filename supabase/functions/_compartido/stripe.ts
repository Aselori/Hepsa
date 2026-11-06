// Cliente de Stripe compartido por las dos funciones.
//
// La llave secreta sólo existe aquí, como secreto de la Edge Function. El
// navegador nunca la ve: por eso el cobro no puede hacerse desde index.html.
import Stripe from 'npm:stripe@23.0.1';

// STRIPE_API_URL sólo se define en las pruebas locales, para apuntar a un
// Stripe simulado. En producción no existe y se usa api.stripe.com.
function destino() {
  const url = Deno.env.get('STRIPE_API_URL');
  if (!url) return {};
  const u = new URL(url);
  return { host: u.hostname, port: Number(u.port), protocol: u.protocol.replace(':', '') as 'http' | 'https' };
}

// Se crea al usarse y no al cargar el módulo: Stripe 23 lanza un error si no
// recibe llave, y creado al cargar tiraba la función entera (500) antes de
// que pudiera contestar "pagos no configurados" (503). Sin llave, null.
let cliente: Stripe | null = null;
export function clienteStripe(): Stripe | null {
  const llave = Deno.env.get('STRIPE_SECRET_KEY');
  if (!llave) return null;
  cliente ??= new Stripe(llave, {
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
    ...destino(),
  });
  return cliente;
}

// Deno no tiene el crypto de Node: la firma del webhook se verifica con
// Web Crypto.
export const cryptoProvider = Stripe.createSubtleCryptoProvider();
