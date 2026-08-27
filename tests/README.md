# Pruebas de control de acceso

`rls.spec.mjs` comprueba, con un navegador real, que cada rol vea exactamente
lo que le toca. Cubre las políticas de
`supabase/migrations/20260826000002_fix_role_escalation.sql`, que es la
migración que corrigió la escalada de privilegios.

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

## Qué verifica

| Prueba | Qué protege |
|---|---|
| `cliente` es expulsado de `admin.html` | Que el panel lea `profiles.role` y no `user_metadata` |
| anónimo no entra a `admin.html` | Que no haya panel sin sesión |
| `vendedor` y `admin` entran y ven las solicitudes | Que `is_staff()` funcione |
| `vendedor` no puede borrar productos | Que borrar sea solo de `admin` |
| `cliente` solo se ve a sí mismo en `profiles` | Que no haya fuga del directorio de clientes |
| `cliente` no ve solicitudes ni órdenes ajenas | Que no haya fuga de datos de otros |

## Cuentas

Las credenciales **no están en el repo**. Cada quien crea su
`tests/.env.local` (ignorado por git) con este contenido:

```
ADMIN_EMAIL=…
ADMIN_PASS=…
VENDEDOR_EMAIL=…
VENDEDOR_PASS=…
CLIENTE_EMAIL=…
CLIENTE_PASS=…
```

Sin ese archivo la suite sale con código 2 y te dice qué falta.

Para crear cuentas nuevas conviene insertarlas por SQL en vez de registrarlas:
el envío de correos de Supabase tiene un límite bajo y devuelve
`over_email_send_rate_limit`. Si se insertan a mano en `auth.users`, hay que
poner **cadena vacía y no NULL** en `confirmation_token`, `recovery_token`,
`email_change`, `email_change_token_new`, `email_change_token_current`,
`phone_change`, `phone_change_token` y `reauthentication_token`, o el login
falla con `Database error querying schema`.
