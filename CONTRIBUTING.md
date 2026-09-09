# Como trabajar en este repositorio

Convenciones que ya sigue el historial. No son burocracia: cada una existe
porque algo se rompio o se perdio por no tenerla.

## Ramas

**Nunca se trabaja sobre `main`.** La rama esta protegida y rechaza cualquier
push directo, incluso de quien administra el repositorio. Todo entra por pull
request.

Antes de tocar el primer archivo, crea tu rama:

```bash
git switch main
git pull --ff-only
git switch -c tipo/descripcion-corta
```

Prefijos en uso:

| Prefijo | Para que |
|---|---|
| `feature/` | Funcionalidad nueva |
| `fix/` | Correccion de un fallo |
| `chore/` | Herramientas, configuracion, mantenimiento |
| `docs/` | Solo documentacion |

El historial es **lineal**: se fusiona con rebase, no con merge commits. La
proteccion de `main` lo exige, asi que un PR desactualizado se rebasa antes de
fusionar.

## Mensajes de commit

En espanol, primera linea descriptiva y en mayuscula inicial, sin prefijo tipo
`feat:`. El cuerpo explica **por que**, no que: el que ya se ve en el diff.

```
Hacer que la cuenta mande sobre el dispositivo en el carrito

Reportado: hacer un pedido desde un dispositivo no vaciaba el carrito en el
otro. Al reproducirlo resulto ser peor que eso: el dispositivo rezagado volvia
a escribir su carrito viejo en la base...
```

Si el commit corrige algo que estaba mal explicado antes, dilo. Un comentario
equivocado que sobrevive es peor que no tener comentario.

Sin coautorias automaticas ni enlaces de sesiones de herramientas.

## Antes de abrir el PR

Corre las tres suites. Necesitan el sitio servido en el puerto 8000:

```bash
python3 -m http.server 8000 &
node --env-file=tests/.env.local tests/rls.spec.mjs
node --env-file=tests/.env.local tests/mfa-ui.spec.mjs
node --env-file=tests/.env.local tests/panel.spec.mjs
```

Salen con codigo 1 si algo falla. Ver `tests/README.md` para las credenciales y
el segundo factor de las cuentas de personal.

Si corriges un fallo, **agrega la prueba que lo habria detectado**. Varias
pruebas de este repositorio existen porque un fallo llego hasta el sitio en
vivo antes de que nadie lo notara.

## Migraciones

Viven en `supabase/migrations/`. El nombre del archivo tiene que coincidir con
la version que Supabase registro al aplicarla, o un `supabase db push`
posterior intentara aplicarla otra vez:

```bash
# despues de aplicar, mira la version registrada y renombra el archivo
supabase migration list
```

Las migraciones se aplican **despues** de desplegar el frontend que las
necesita, no antes. Al reves deja el sitio en vivo pidiendo algo que la
interfaz desplegada todavia no sabe ofrecer.

## Lo que nunca se sube

- `tests/.env.local`: contrasenas y claves de los autenticadores.
- `attachments/`: respaldos con datos reales de clientes y hashes.
- La llave `service_role` de Supabase. La publishable si puede estar en
  `config.js`, esta disenada para viajar al navegador.

## Escritura

Sin rayas largas (`—`) en texto, documentacion ni comentarios. Coma, punto y
coma, parentesis o dos oraciones.

Sin emojis nuevos en la interfaz ni en el codigo.
