// Crea la sesión de pago de Stripe para un pedido del cliente.
//
// El navegador sólo manda el número de pedido. El monto sale de orders.total,
// leído con el token del propio cliente: si el pedido no es suyo, RLS no lo
// devuelve y aquí se responde 404, sin distinguir "no existe" de "no es tuyo".
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { stripe } from '../_compartido/stripe.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const responder = (status: number, cuerpo: Record<string, unknown>) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return responder(405, { error: 'Método no permitido' });

  // A dónde vuelve el cliente al terminar. Sale de un secreto y no del
  // encabezado Origin, para que nadie arme una sesión que regrese a otro sitio.
  const sitio = Deno.env.get('HEPSA_SITIO_URL');
  if (!Deno.env.get('STRIPE_SECRET_KEY') || !sitio) {
    return responder(503, { error: 'Los pagos en línea no están configurados' });
  }

  const autorizacion = req.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: autorizacion } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user } } = await supabase.auth.getUser(autorizacion.replace(/^Bearer /, ''));
  if (!user) return responder(401, { error: 'Inicia sesión para pagar' });

  let pedidoId: number;
  try {
    pedidoId = Number((await req.json()).pedido);
  } catch {
    return responder(400, { error: 'Falta el número de pedido' });
  }
  if (!Number.isSafeInteger(pedidoId) || pedidoId <= 0) return responder(400, { error: 'Número de pedido inválido' });

  const { data: pedido, error } = await supabase
    .from('orders').select('id, total, payment_status')
    .eq('id', pedidoId).maybeSingle();
  if (error) return responder(500, { error: 'No se pudo leer el pedido' });
  if (!pedido) return responder(404, { error: 'No encontramos ese pedido' });
  if (pedido.payment_status === 'completo') return responder(409, { error: 'Ese pedido ya está pagado' });

  const centavos = Math.round(Number(pedido.total) * 100);
  if (!(centavos > 0)) return responder(409, { error: 'El pedido no tiene un total que cobrar' });

  try {
    const sesion = await stripe.checkout.sessions.create({
      mode: 'payment',
      // Sólo tarjeta en esta primera versión. SPEI necesita una cuenta de
      // Stripe México activada; queda documentado en docs/pagos-en-linea.md.
      payment_method_types: ['card'],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'mxn',
          unit_amount: centavos,
          product_data: { name: `Pedido HEPSA #${pedido.id}` },
        },
      }],
      client_reference_id: String(pedido.id),
      metadata: { pedido: String(pedido.id) },
      customer_email: user.email ?? undefined,
      success_url: `${sitio}/?pago=exito&pedido=${pedido.id}`,
      cancel_url: `${sitio}/?pago=cancelado&pedido=${pedido.id}`,
    });
    return responder(200, { url: sesion.url });
  } catch (e) {
    console.error('Stripe rechazó la sesión:', e instanceof Error ? e.message : e);
    return responder(502, { error: 'No se pudo iniciar el pago. Intenta de nuevo.' });
  }
});
