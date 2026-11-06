// Recibe los avisos de Stripe y registra los pagos confirmados.
//
// No lleva JWT de Supabase (Stripe no tiene uno): la prueba de que el aviso
// es auténtico es la firma Stripe-Signature, calculada sobre el cuerpo crudo
// con el secreto del endpoint. Por eso se lee con text() y no con json().
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { stripe, cryptoProvider } from '../_compartido/stripe.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Método no permitido', { status: 405 });

  const secreto = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secreto) return new Response('Webhook sin configurar', { status: 503 });

  const firma = req.headers.get('Stripe-Signature');
  if (!firma) return new Response('Falta la firma', { status: 400 });

  const cuerpo = await req.text();
  let evento;
  try {
    evento = await stripe.webhooks.constructEventAsync(cuerpo, firma, secreto, undefined, cryptoProvider);
  } catch {
    return new Response('Firma inválida', { status: 400 });
  }

  // completed llega también con pagos diferidos aún sin cobrar; esos se
  // confirman después con async_payment_succeeded. Sólo 'paid' cuenta.
  if (evento.type !== 'checkout.session.completed' && evento.type !== 'checkout.session.async_payment_succeeded') {
    return Response.json({ ignorado: evento.type });
  }
  const sesion = evento.data.object;
  if (sesion.payment_status !== 'paid') return Response.json({ pendiente: sesion.id });

  const pedido = Number(sesion.metadata?.pedido);
  if (!Number.isSafeInteger(pedido) || pedido <= 0 || sesion.amount_total == null) {
    // Un aviso firmado pero sin pedido no es de esta integración: reintentar
    // no lo arreglaría.
    return Response.json({ ignorado: 'sin pedido' });
  }

  const { data, error } = await admin.rpc('registrar_pago_en_linea', {
    p_pedido: pedido,
    p_sesion: sesion.id,
    p_monto: sesion.amount_total / 100,
    p_moneda: sesion.currency ?? '',
  });
  if (error) {
    // 500 hace que Stripe reintente y que el fallo se vea en su panel.
    console.error(`Pago de la sesión ${sesion.id} sin registrar:`, error.message);
    return new Response('No se pudo registrar el pago', { status: 500 });
  }
  return Response.json({ resultado: data });
});
