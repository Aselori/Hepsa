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

**Cómo:** en la base, no en el navegador — un cliente puede saltarse cualquier
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
viven en `tests/.env.local`, fuera de git, así que el riesgo hoy es bajo — pero
no tienen por qué seguir ahí cuando el negocio opere de verdad.

**Cómo:** depende de si para entonces ya se separó producción de desarrollo
(punto 4). Si sí, las cuentas se quedan en desarrollo y producción nace limpia.
Si no, se borran de `auth.users` y se crea el admin real del negocio.

**Cómo se comprueba:** `SELECT email FROM auth.users` en producción no debe
devolver ninguna dirección de prueba.

---

## 3. Contraseñas filtradas y segundo factor

**Qué:** dos ajustes de Supabase Auth, hoy apagados.

- **Protección de contraseñas filtradas:** compara contra HaveIBeenPwned e
  impide usar contraseñas ya comprometidas. Es un interruptor, gratis, y lo
  marca el linter de Supabase.
- **2FA obligatorio para `vendedor` y `admin`:** es la Mejora 3 de la
  presentación al cliente. Un vendedor con contraseña robada ve el directorio
  completo de clientes.

**Por qué juntos:** ambos protegen las cuentas del personal, que son las que
tienen algo que perder. Los clientes no ven datos de nadie más.

**Costo:** el primero es un clic. El 2FA es trabajo real — Supabase lo soporta
con MFA, pero hay que rehacer el flujo de login y el de alta de empleados.

**Cómo se comprueba:** una cuenta `vendedor` sin MFA inscrito no debe poder
completar el login.

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

La pasarela de pagos (Mejora 2 de la presentación) va **después** de los
puntos 3 y 4, nunca antes. Cobrar dinero con el personal sin segundo factor y
sobre la misma base que se usa para probar es el orden equivocado.

---

## Decisión abierta: acceso al sitio

Hoy `hepsa.vercel.app` es público a propósito, para poder enseñárselo al
cliente y al profesor sin que necesiten cuenta. La protección SSO de Vercel
está activa pero solo cubre los despliegues de preview.

Si en algún momento conviene cerrarlo, cambiar el SSO a `all` es gratis en
Hobby — pero entonces nadie sin cuenta de Vercel podría verlo. La protección
por contraseña, que sería el punto medio, requiere plan Pro.
