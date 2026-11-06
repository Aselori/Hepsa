# Pagos en línea (Mejora 2)

El cliente paga con tarjeta un pedido ya confirmado, desde "Mi perfil y
pedidos". El cobro lo hace Stripe; el sistema sólo registra lo que Stripe
confirma. Esta primera versión funciona en **modo de prueba** de Stripe: el
flujo es el real, pero con tarjetas de prueba y sin dinero.

Estado: implementado y probado contra el stack local (`npm run test:local`,
suite `tests/pagos.spec.mjs`, 31 comprobaciones). **No está activado en
`hepsa.vercel.app`**: faltan los pasos de [Activarlo](#activarlo), que
necesitan la cuenta de Stripe y el acceso al proyecto de Supabase.

## Cómo funciona

```
Portal (index.html)          Edge Functions (Supabase)          Stripe
───────────────────          ─────────────────────────          ──────
"Pagar en línea"  ──pedido──▶ crear-pago
                              · comprueba la sesión del cliente
                              · lee orders.total con SU token
                                (RLS: sólo ve sus pedidos)
                              · crea la sesión de Checkout ───▶ página de pago
                                                                  │
◀──────────── redirige a ?pago=exito / ?pago=cancelado ───────────┘
                                                                  │
                              webhook-stripe ◀── aviso firmado ───┘
                              · verifica Stripe-Signature
                              · registrar_pago_en_linea()
                                (pagos + orders + products,
                                 todo o nada)
```

Archivos:

| Archivo | Qué hace |
|---|---|
| `supabase/functions/crear-pago/index.ts` | Crea la sesión de pago a partir del total guardado en la base. |
| `supabase/functions/webhook-stripe/index.ts` | Recibe el aviso de Stripe, verifica la firma y registra el pago. |
| `supabase/functions/_compartido/stripe.ts` | Cliente de Stripe compartido. |
| `supabase/migrations/20261106120000_pagos_en_linea.sql` | Tabla `pagos` y función `registrar_pago_en_linea()`. |
| `index.html` | Columna "Pago", botón "Pagar en línea" y avisos al volver de Stripe. |
| `config.js` | `pagosEnLinea`: con `false` no se muestra el botón. |

## Decisiones que importan

- **El monto nunca sale del navegador.** El portal manda sólo el número de
  pedido. `crear-pago` lee `orders.total`, que a su vez calculó
  `crear_pedido_desde_carrito()` con los precios de `products`.
- **La llave secreta no llega al cliente.** Vive como secreto de la Edge
  Function. Por eso el cobro no podía hacerse desde el sitio estático.
- **Volver a la página de éxito no prueba nada.** Cualquiera puede abrir
  `?pago=exito`. El pedido sólo cambia a pagado con el aviso firmado de Stripe;
  el portal dice "en unos segundos aparece como pagado" y vuelve a leer la
  tabla.
- **El mismo aviso no cuenta dos veces.** Stripe reintenta los avisos hasta
  recibir un 2xx. `pagos.sesion_id` es único y la función devuelve
  `repetido` sin volver a descontar existencias.
- **Un monto distinto falla a propósito.** Si lo cobrado no coincide con el
  total del pedido, la función responde 500: Stripe reintenta y el error
  queda visible en su panel, en vez de marcar pagado algo que no lo está.
- **Un segundo cobro del mismo pedido se guarda, marcado.** Si alguien paga
  dos veces (dos pestañas), el dinero ya se cobró: el renglón queda en
  `pagos` con `duplicado = true` para que el personal lo reembolse.
- **Existencias.** El checkout no descuenta stock (el pedido todavía no es
  venta firme); el pago confirmado sí, sin bajar de cero.

## Activarlo

Lo hace quien tenga acceso a la cuenta de Stripe y al proyecto de Supabase.
Ningún paso pone llaves en el repositorio.

1. **Cuenta de Stripe en modo de prueba.** Crear la cuenta en
   [dashboard.stripe.com](https://dashboard.stripe.com) y, con el interruptor
   en *Test mode*, copiar la llave secreta (`sk_test_…`) de
   *Developers → API keys*.

2. **Revisar la base hospedada antes de migrar.** Hay una migración anterior
   pendiente (`20260928211428_blindar_guardias_ante_perfil_ausente.sql`, PR
   #9) que se aplica en el mismo paso. Antes, en el editor SQL de Supabase,
   esta consulta de sólo lectura debe dar `0` y `0`:

   ```sql
   SELECT
     (SELECT count(*) FROM public.profiles WHERE role IS NULL)       AS perfiles_sin_rol,
     (SELECT count(*) FROM auth.users u
        LEFT JOIN public.profiles p ON p.id = u.id WHERE p.id IS NULL) AS usuarios_sin_perfil;
   ```

   Si alguna da más de cero, no seguir: esas cuentas necesitan revisión.

3. **Aplicar las migraciones y desplegar las funciones:**

   ```bash
   npx supabase login
   npx supabase link --project-ref qmyrosmuqfabaedzydsa
   npx supabase db push
   npx supabase secrets set STRIPE_SECRET_KEY=sk_test_... HEPSA_SITIO_URL=https://hepsa.vercel.app
   npx supabase functions deploy crear-pago --no-verify-jwt
   npx supabase functions deploy webhook-stripe --no-verify-jwt
   ```

   `--no-verify-jwt` es correcto en las dos: Stripe no manda un token de
   Supabase, y `crear-pago` comprueba la sesión del cliente por su cuenta.

4. **Registrar el webhook en Stripe.** En *Developers → Webhooks → Add
   endpoint*:
   - URL: `https://qmyrosmuqfabaedzydsa.supabase.co/functions/v1/webhook-stripe`
   - Eventos: `checkout.session.completed` y
     `checkout.session.async_payment_succeeded`

   Copiar el *Signing secret* (`whsec_…`) y guardarlo:

   ```bash
   npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
   ```

5. **Encender el botón.** En `config.js`, `pagosEnLinea: true`, por PR como
   cualquier cambio.

6. **Probarlo.** Confirmar un pedido en el portal, pagarlo con la tarjeta
   `4242 4242 4242 4242` (cualquier fecha futura y cualquier CVC) y comprobar
   que en "Mi perfil" aparece como **Pagado** y que el stock bajó en el panel.
   Con `4000 0000 0000 0002` la tarjeta se rechaza y el pedido debe seguir
   pendiente.

Para cobrar de verdad, además: activar la cuenta de Stripe con los datos
fiscales del negocio, cambiar a las llaves `sk_live_…` y registrar el webhook
en modo real. **Antes**, separar producción de desarrollo
([seguridad-pendiente.md](seguridad-pendiente.md), punto 4): cobrar dinero
real sobre la base que usan las pruebas sigue siendo el orden equivocado.

## Qué no cubre esta versión

- **SPEI y OXXO.** La presentación propone referencias SPEI en el ticket.
  Stripe los ofrece en México, pero con una cuenta mexicana activada; por eso
  esta versión es sólo tarjeta. Agregarlos es sumar el método en
  `payment_method_types` y atender `checkout.session.async_payment_succeeded`,
  que el webhook ya escucha.
- **Reembolsos** desde el panel. Hoy se hacen en el panel de Stripe.
- **Ver los pagos en el panel administrativo.** El pedido cambia a
  "completo", que el panel ya muestra; la tabla `pagos` con el detalle
  (sesión de Stripe, duplicados) todavía no tiene pantalla.
- **Anticipos.** Se cobra el total del pedido; el estado `anticipo` sigue
  siendo manual.

## Pruebas

`tests/pagos.spec.mjs` corre dentro de `npm run test:local`. El runner levanta
las Edge Functions con un Stripe simulado (`tests/stripe-simulado.mjs`, en un
contenedor en la red de Supabase local) y un secreto de webhook desechable.
La suite firma cada aviso como lo firma Stripe, así que prueba la verificación
real. Cubre: el monto enviado a Stripe sale de la base; nadie paga ni ve el
pedido de otro; avisos sin firma o con firma ajena se rechazan; una sesión sin
cobrar no marca pagado; monto distinto, repetición y doble cobro; permisos
sobre `pagos`; y el portal (botón, regreso cancelado, teléfono sin
desbordarse).
