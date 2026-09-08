# Pruebas de control de acceso

`rls.spec.mjs` comprueba, con un navegador real, que cada rol vea exactamente
lo que le toca. Cubre las políticas de
`supabase/migrations/20260826000002_fix_role_escalation.sql`, que es la
migración que corrigió la escalada de privilegios, y el segundo factor
obligatorio de `20260907210943_segundo_factor_para_staff.sql`.

## Correrlas

Con el sitio servido en el puerto 8000:

```bash
cd Hepsa
python3 -m http.server 8000 &
npx playwright install chromium   # solo la primera vez
npm install playwright            # solo la primera vez
node --env-file=tests/.env.local tests/rls.spec.mjs
```

Sale con código 1 si algo falla, así que sirve tal cual en CI.

Hay una segunda suite, `mfa-ui.spec.mjs`, que maneja las pantallas del segundo
factor como las maneja una persona: escribe en el formulario de login, lee el
QR del alta y teclea el código. `rls.spec.mjs` llega a `aal2` llamando al SDK
por debajo, así que sin esta segunda suite el formulario en sí quedaría sin
probar.

```bash
node --env-file=tests/.env.local tests/mfa-ui.spec.mjs
```

Para probar el **alta** hace falta un empleado sin autenticador, y los dos que
existen ya tienen uno. La suite asciende temporalmente al `cliente` y le
devuelve su rol en un `finally`, de modo que una falla a media prueba no deja
la cuenta ascendida. Deja dos capturas en `tests/screenshots/`.

Y una tercera, `panel.spec.mjs`, que comprueba que el panel siga **sirviendo**
con el segundo factor puesto. Toda consulta del panel pasa por `is_staff()`, y
la Mejora 3 cambió esa función: un vendedor que entra a un POS que no registra
ventas está igual de bloqueado que uno al que no dejan pasar, y las otras dos
suites no notarían la diferencia. Recorre cada vista, registra una venta real
por la interfaz y la borra al terminar.

```bash
node --env-file=tests/.env.local tests/panel.spec.mjs
```

La limpieza usa una sesión de **admin**, no la del vendedor que registró la
venta: `orders_delete_admin` sólo deja borrar a admin, y RLS no devuelve error
al vendedor sino cero filas, así que borrar con la cuenta equivocada deja el
pedido de prueba en la base sin avisar.

## Qué verifica

| Prueba | Qué protege |
|---|---|
| `cliente` es expulsado de `admin.html` | Que el panel lea `profiles.role` y no `user_metadata` |
| anónimo no entra a `admin.html` | Que no haya panel sin sesión |
| `vendedor` y `admin` entran y ven las solicitudes | Que `is_staff()` funcione |
| `vendedor` no puede borrar productos | Que borrar sea solo de `admin` |
| `cliente` solo se ve a sí mismo en `profiles` | Que no haya fuga del directorio de clientes |
| `cliente` no ve solicitudes ni órdenes ajenas | Que no haya fuga de datos de otros |
| `vendedor` **sin** segundo factor no ve nada | Que `is_staff()` exija `aal2` y no sólo el rol |
| `vendedor` **con** segundo factor sí ve todo | Que exigir `aal2` no rompa al personal legítimo |
| al `cliente` no se le exige segundo factor | Que la fricción caiga sólo donde hay algo que proteger |
| sólo un admin audita quién no tiene 2FA | Que el guardia de `empleados_sin_segundo_factor()` sirva |
| el catálogo se pinta con un producto desactivado | Que el escaparate no se caiga para visitantes sin sesión |
| el POS registra una venta con 2FA puesto | Que exigir `aal2` no rompa la operación diaria |
| un vendedor con 2FA no puede ascenderse a admin | Que la corrección de escalada siga en pie |

## Cuentas

Las credenciales **no están en el repo**. Cada quien crea su
`tests/.env.local` (ignorado por git) con este contenido:

```
ADMIN_EMAIL=…
ADMIN_PASS=…
ADMIN_TOTP=…
VENDEDOR_EMAIL=…
VENDEDOR_PASS=…
VENDEDOR_TOTP=…
CLIENTE_EMAIL=…
CLIENTE_PASS=…
```

Sin ese archivo la suite sale con código 2 y te dice qué falta.

## Segundo factor de las cuentas de personal

Desde la Mejora 3, `vendedor` y `admin` no llegan a ningún dato sin un código
TOTP, así que la suite necesita poder calcularlo. `ADMIN_TOTP` y
`VENDEDOR_TOTP` son el secreto en base32 del autenticador de cada cuenta; el
código de 6 dígitos lo genera `totp.mjs` sin dependencias externas.

Al `cliente` no se le pide nada, por eso no lleva `CLIENTE_TOTP`.

Para inscribir el autenticador de una cuenta de prueba, una sola vez:

```bash
node --env-file=tests/.env.local tests/inscribir-2fa.mjs VENDEDOR
```

Imprime la línea `VENDEDOR_TOTP=…` que hay que pegar en `tests/.env.local`.

Para entrar al sitio a mano sin tener el autenticador en el teléfono,
`codigo.mjs` imprime el código vigente y cuántos segundos le quedan:

```bash
node --env-file=tests/.env.local tests/codigo.mjs VENDEDOR
```

Para una demostración conviene igual meter la clave en Google Authenticator,
Authy o 1Password (agregar cuenta con *clave de configuración*, no escaneando),
porque es como lo va a usar el personal.
**Guárdala en ese momento:** el secreto se entrega sólo durante el alta y
después no hay forma de recuperarlo.

Si se pierde, la cuenta queda encerrada — Supabase exige `aal2` tanto para
borrar el factor viejo como para inscribir uno nuevo. La única salida es
borrar la fila con la llave `service_role`, desde el editor SQL de Supabase:

```sql
DELETE FROM auth.mfa_factors
 WHERE user_id = (SELECT id FROM auth.users WHERE email = 'la-cuenta@ejemplo.com');
```

y volver a correr `inscribir-2fa.mjs`.

Para crear cuentas nuevas conviene insertarlas por SQL en vez de registrarlas:
el envío de correos de Supabase tiene un límite bajo y devuelve
`over_email_send_rate_limit`. Si se insertan a mano en `auth.users`, hay que
poner **cadena vacía y no NULL** en `confirmation_token`, `recovery_token`,
`email_change`, `email_change_token_new`, `email_change_token_current`,
`phone_change`, `phone_change_token` y `reauthentication_token`, o el login
falla con `Database error querying schema`.
