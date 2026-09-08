# Endurecimiento pendiente

Este documento es una **lista de tareas para el cierre**, no un informe de
fallas. Mientras el proyecto esté en desarrollo se prioriza que sea cómodo
probar; nada de esto se aplica todavía.

Cada punto dice **qué**, **por qué**, **cuánto cuesta** y **cómo se comprueba**
que quedó hecho. El orden importa: están puestos por lo que se rompe si se
hacen al revés.

---

## Lo que NO hace falta arreglar

Para no gastar esfuerzo donde no lo hay:

- **Que el panel se controle desde JavaScript.** `admin.html` verifica el rol
  en el navegador, pero RLS lo respalda del lado del servidor. Quien edite el
  JS choca igual contra la base. Verificado en `tests/rls.spec.mjs`.
- **Que la publishable key esté en `config.js`.** Está diseñada para ser
  pública. Lo que protege los datos es RLS.
- **Que el catálogo y los precios sean visibles.** Es el escaparate.

---

## 1. Límite al formulario de cotización

**Qué:** el formulario público acepta solicitudes ilimitadas, sin captcha ni
límite por hora. Un script puede llenar `custom_requests` de basura.

**Por qué primero:** es lo único explotable hoy sin credenciales, y ensuciar la
bandeja rompe la herramienta que el negocio va a usar todos los días.

**Cómo:** en la base, no en el navegador; un cliente puede saltarse cualquier
validación de JS. Un trigger `BEFORE INSERT` que cuente solicitudes recientes
por correo y por hora, y rechace pasado un umbral (p. ej. 3 por correo por
hora, 20 por hora en total). Sin captcha ni servicios externos.

**Cómo se comprueba:** prueba en `rls.spec.mjs` que manda 5 solicitudes
seguidas con el mismo correo y espera que la cuarta falle.

**Costo:** una migración y una prueba. Media hora.

---

## 2. Cuentas de prueba fuera de producción

**Qué:** existen tres cuentas (`aslopezrivas+cliente@`, `+vendedor@`, y la
cuenta admin) creadas para poder probar los tres roles. Una es administrador.

**Por qué:** son puertas reales alcanzables desde internet que existen solo por
comodidad de desarrollo. Sus contraseñas son aleatorias de 24 caracteres y
viven en `tests/.env.local`, fuera de git, así que el riesgo hoy es bajo, pero
no tienen por qué seguir ahí cuando el negocio opere de verdad.

**Cómo:** depende de si para entonces ya se separó producción de desarrollo
(punto 4). Si sí, las cuentas se quedan en desarrollo y producción nace limpia.
Si no, se borran de `auth.users` y se crea el admin real del negocio.

**Cómo se comprueba:** `SELECT email FROM auth.users` en producción no debe
devolver ninguna dirección de prueba.

---

## 3. Contraseñas filtradas: NO disponible en el plan actual

**Qué:** la **protección de contraseñas filtradas** compara contra
HaveIBeenPwned e impide usar contraseñas ya comprometidas.

**Corrección:** este documento decía antes que era "un interruptor, gratis".
Es falso. La documentación de Supabase lo dice explícitamente: *"Leaked
password protection is available on the Pro Plan and above"*
(https://supabase.com/docs/guides/auth/password-security). El proyecto está en
plan gratuito, así que **no se puede activar hoy**, y el aviso del linter de
Supabase seguirá apareciendo hasta que haya plan de pago.

**Qué sí se puede hacer gratis mientras tanto**, en Auth → Providers → Email:

- Subir la longitud mínima de contraseña (menos de 8 no es defendible).
- Exigir dígitos, minúsculas, mayúsculas y símbolos.

Eso no detecta contraseñas ya filtradas, pero encarece el adivinarlas. Para el
personal, el segundo factor ya cubre el caso de la contraseña robada, que era
el riesgo grande.

**Cuándo revisarlo:** al contratar Pro, que de todas formas hace falta para el
punto 4 (separar producción) y para respaldos serios.

**Cómo se comprueba:** con plan Pro, registrar una cuenta con `password` como
contraseña debe fallar.

> El **2FA obligatorio para `vendedor` y `admin`** estaba en este punto y ya
> **quedó hecho**: migración `20260907210943_segundo_factor_para_staff.sql`.
> Ver "Segundo factor" más abajo.

---

## 4. Separar producción de desarrollo

**Qué:** hoy `hepsa.vercel.app` y las pruebas locales escriben en la misma base
(`qmyrosmuqfabaedzydsa`).

**Por qué:** en cuanto entren datos reales de clientes, un error probando
afecta información del negocio. Además obliga a mezclar datos de ejemplo con
datos reales en la misma tabla.

**Cómo:** un proyecto de Supabase nuevo para producción, con las migraciones
aplicadas en orden y **sin** `seed.sql`. `config.js` apunta al que corresponda.
Las tres URLs de redirección se registran en el proyecto nuevo.

**Cuándo:** antes de que exista la primera solicitud de un cliente real. Es más
barato hacerlo con la base vacía que migrar datos después.

**Cómo se comprueba:** la suite completa corriendo contra el proyecto nuevo, y
`custom_requests` sin las 3 solicitudes de ejemplo.

---

## 5. Respaldos

**Qué:** confirmar que los respaldos automáticos de Supabase están activos en
el proyecto de producción y saber cuánto hacia atrás llegan.

**Por qué:** el plan gratuito tiene una ventana corta. Para un negocio real con
pedidos de clientes eso puede no alcanzar.

**Cómo se comprueba:** una restauración de prueba a un proyecto desechable.
Un respaldo que nunca se restauró no es un respaldo.

---

## 6. Antes de cobrar en línea

La pasarela de pagos (Mejora 2 de la presentación) va **después** del punto 4,
nunca antes. El personal ya tiene segundo factor, así que de las dos
condiciones que faltaban queda una: cobrar dinero real sobre la misma base que
se usa para probar sigue siendo el orden equivocado.

Además, la pasarela no se puede terminar sólo desde este repositorio. El sitio
es HTML estático hablándole a Supabase desde el navegador, y un cargo real
necesita una llave secreta que **no puede** viajar al cliente: hace falta una
Edge Function, y antes que eso una cuenta de comercio en Stripe o MercadoPago.

---

## Segundo factor: HECHO

**Qué quedó:** `vendedor` y `admin` no llegan a ningún dato sin presentar un
código TOTP. La regla vive en `is_staff()` e `is_admin()`, que ahora exigen
`aal2` en el token además del rol. Como todas las políticas RLS pasan por esas
dos funciones, la exigencia cubre catálogo, ventas, solicitudes, perfiles y
Storage sin repetirse en cada política.

**Por qué en la base y no en `admin.html`:** el panel también comprueba el
segundo factor, pero eso sólo decide qué se dibuja. Quien edite el JavaScript
se salta el dibujo; lo que no se salta es que la base no le conteste.

**Lo que sigue abierto:**

- **Reponer el autenticador de un empleado que pierde el teléfono.** Supabase
  exige `aal2` tanto para inscribir un factor nuevo como para borrar el viejo,
  así que la cuenta queda encerrada y no puede salir sola. Hoy la salida es
  borrar la fila con la llave `service_role`:

  ```sql
  DELETE FROM auth.mfa_factors
   WHERE user_id = (SELECT id FROM auth.users WHERE email = '…');
  ```

  Funciona, pero es una operación manual con la llave más peligrosa del
  proyecto. Cuando haya más de dos empleados conviene un botón en el panel de
  usuarios respaldado por una Edge Function, para que reponer un autenticador
  no obligue a sacar la `service_role` del cajón.
- **A los clientes no se les exige** y es a propósito: no ven datos de nadie
  más que de sí mismos. Si algún día el portal les muestra facturas o
  direcciones de entrega, esa decisión hay que revisarla.

---

## Hallazgo al probar el segundo factor: el catálogo público se caía

No lo causó la Mejora 3, pero salió al probarla y conviene dejarlo escrito
porque estuvo latente mucho tiempo.

La política del catálogo era `USING (is_active = true OR is_staff())`. Como
`is_staff()` llama a `current_user_role()`, que `anon` tiene prohibida desde la
migración 0004, cualquier consulta al catálogo **fallaba entera** con
`401 permission denied` para un visitante sin sesión... pero sólo si existía al
menos un producto desactivado. Como todos estaban activos, nunca se disparó.

Desactivar un producto es un botón del panel. La primera vez que alguien lo
usara, la tienda se quedaba en blanco para todo el que no hubiera iniciado
sesión.

Dos lecciones que valen más que el arreglo:

- **Reordenar la expresión no servía.** `is_staff()` es `LANGUAGE sql`, así que
  Postgres la inlinea y comprueba el permiso `EXECUTE` al planificar la
  consulta, no al evaluar cada fila. El `AND` nunca llega a cortocircuitar.
- **La forma correcta es partir la política**, no dar más permisos: una para el
  escaparate sin llamadas a función y otra `TO authenticated` para el staff.
  Así `anon` jamás nombra `is_staff()`.

Arreglado en `20260907214137` y afinado en `20260907215943`. Cubierto por el
bloque 10 de `tests/rls.spec.mjs` para que no vuelva a quedarse dormido.

---

## Decisión abierta: acceso al sitio

Hoy `hepsa.vercel.app` es público a propósito, para poder enseñárselo al
cliente y al profesor sin que necesiten cuenta. La protección SSO de Vercel
está activa pero solo cubre los despliegues de preview.

Si en algún momento conviene cerrarlo, cambiar el SSO a `all` es gratis en
Hobby, pero entonces nadie sin cuenta de Vercel podría verlo. La protección
por contraseña, que sería el punto medio, requiere plan Pro.
