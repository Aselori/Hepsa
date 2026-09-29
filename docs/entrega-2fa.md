# Entrega 2FA para personal

## Alcance y estado

Esta entrega protege las cuentas con rol `vendedor` o `admin` mediante un
autenticador TOTP. La contraseña deja la sesión en `aal1`; el panel exige un
JWT en `aal2` y las políticas RLS siguen siendo la autoridad. La interfaz vive
en `auth-mfa.js` y se integra desde `index.html`.

El alcance cubre alta del autenticador, reto al iniciar sesión, selección de
un factor alternativo, reintentos, cancelación y recuperación operativa. La
validación reportada hasta ahora es local: 77/77 pruebas RLS, 15/15 de la
interfaz MFA y 16/16 del panel. No se ha verificado un despliegue de
producción, ni se debe interpretar este documento como autorización para
cambiar cuentas reales.

Supabase distingue `aal1` para la autenticación convencional y `aal2` cuando
la sesión también comprobó un factor MFA. La aplicación consulta ese nivel y
las políticas de datos lo vuelven obligatorio para el personal. Referencias:
[guía de MFA de Supabase](https://supabase.com/docs/guides/auth/auth-mfa) y
[getAuthenticatorAssuranceLevel](https://supabase.com/docs/reference/javascript/auth-mfa-getauthenticatorassurancelevel).

## Flujo normal de alta

1. El empleado inicia sesión con correo y contraseña. La aplicación consulta
   su perfil y no concede acceso al panel por datos controlados por el usuario.
2. Si la sesión requiere MFA y no tiene un factor verificado, la aplicación
   llama al alta TOTP y muestra el QR y, como alternativa, la clave manual.
   El empleado registra el autenticador en su aplicación móvil.
3. El empleado escribe el código de seis dígitos. La interfaz valida el
   formato localmente y usa el flujo de reto y verificación de Supabase. Al
   verificarse, Supabase promueve la sesión a `aal2`.
4. Despues de completar el alta, el empleado debe cerrar sesion y confirmar
   un nuevo ingreso con el autenticador.

El QR, la URI `otpauth` y la clave manual son secretos equivalentes a una
contraseña. No se deben copiar en tickets, chats, capturas, documentos,
grabaciones ni sistemas de soporte. El secreto sólo se muestra durante el
alta. La documentación oficial describe el flujo TOTP de
[enroll, challenge y verify](https://supabase.com/docs/guides/auth/auth-mfa/totp).

## Reto, reintento y cancelación

En un inicio de sesión posterior, el sistema lista los factores verificados y
presenta el reto. Si hay más de uno, el empleado puede elegirlo. Un código con
formato incorrecto no llama a Auth. Un código vencido o incorrecto deja la
sesión en el reto y permite escribir el siguiente código. Una caída de red
muestra un error recuperable y conserva el botón de reintento.

Cancelar abandona el flujo y cierra la sesión local antes de recargar la
página. El cierre local elimina la sesión que el navegador conserva, pero un
JWT de acceso que ya fue emitido puede seguir siendo criptográficamente válido
hasta su expiración. Por eso las APIs, RLS y el panel deben comprobar el JWT y
su `aal` en cada solicitud.

Qué corta cada operación administrativa, comprobado contra el stack local
(`tests/recuperacion.spec.mjs` lo sostiene):

| Operación | Sesiones abiertas | Token de acceso ya emitido |
|---|---|---|
| Borrar el factor (`deleteFactor`) | Se pueden renovar, pero bajan a `aal1` y pierden el acceso de personal | Sigue con `aal2` hasta expirar |
| Cambiar la contraseña (`updateUserById`) | Revocadas: el refresco se rechaza | Sigue valiendo hasta expirar |
| Bajar el rol a `cliente` | Sin acceso de personal de inmediato | Sin acceso de personal de inmediato |
| Suspender y luego levantar la suspensión (`ban_duration`) | **Reviven con `aal2` intacto** | Sigue valiendo |

Dos consecuencias. La documentación del SDK dice que borrar un factor cierra
las sesiones activas; en la práctica solo las degrada al renovarse. Y
suspender la cuenta **no sirve para revocar**: al levantar la suspensión, las
sesiones anteriores vuelven a funcionar como si nada. Lo único que corta al
momento un token ya emitido es bajar el rol, porque RLS lo lee de la base en
cada petición.

La interfaz usa `challengeAndVerify` para el reto de TOTP y `unenroll`
únicamente para limpiar un alta incompleta que ella misma dejó. Un factor
verificado no debe eliminarse desde el navegador durante la recuperación.
Referencias: [challengeAndVerify](https://supabase.com/docs/reference/javascript/auth-mfa-challengeandverify)
y [unenroll](https://supabase.com/docs/reference/javascript/auth-mfa-unenroll).

## Sustitución de un autenticador perdido

La sustitución es una operación de soporte con identidad verificada. El
operador debe registrar quién solicitó el cambio, qué canal independiente se
usó para verificarlo y quién autorizó la operación. Nunca se acepta como
prueba suficiente el correo enviado desde la sesión bloqueada, una captura del
QR, un código aislado o una petición de alguien que no pueda demostrar que es
el titular.

### El empleado todavía tiene acceso a su factor

1. Verificar al titular por el procedimiento interno.
2. Pedirle que entre normalmente y complete `aal2`.
3. Desde una sesión autenticada en `aal2`, inscribir y verificar el nuevo
   factor con las APIs de usuario, usando un nombre distinto. Todavia no hay
   una pantalla de gestion de dispositivos en HEPSA; requiere soporte tecnico.
4. Comprobar un nuevo ingreso con el factor nuevo antes de eliminar el viejo
   mediante `unenroll` en AAL2. Nunca borrar primero el unico factor util.
5. Confirmar que el factor antiguo ya no aparece como verificado y guardar
   únicamente el registro operativo, nunca el secreto.

### El empleado perdió el factor y no puede alcanzar `aal2`

Se usa `scripts/recuperar-segundo-factor.mjs`, que ejecuta los pasos en el
único orden seguro. El orden importa: si se borra el factor sin cambiar antes
la contraseña, cualquiera que la conozca puede iniciar sesión e inscribir **su
propio** autenticador antes que el empleado, y quedarse con la cuenta.

1. Verificar la identidad del titular por un canal independiente y obtener la
   autorización del propietario del proyecto (ver "Decisiones pendientes").
2. Simular primero, sin modificar nada:

   ```bash
   HEPSA_SUPABASE_URL=https://<ref>.supabase.co \
   HEPSA_SUPABASE_SECRET_KEY=<llave de servicio> \
   node scripts/recuperar-segundo-factor.mjs --email persona@ejemplo.com
   ```

   La llave de servicio vive solo en el entorno del operador, nunca en el
   repositorio, el navegador, un ticket o un chat.
3. Aplicar, dejando constancia de quién autorizó y cómo se verificó:

   ```bash
   ... node scripts/recuperar-segundo-factor.mjs --email persona@ejemplo.com \
         --aplicar --autorizo "<nombre>" --canal "<cómo se verificó>"
   ```

   El script cambia la contraseña (revoca las sesiones y cierra la ventana de
   inscripción ajena) y después borra los factores con la API administrativa.
   Imprime en la salida estándar un registro de auditoría en JSON, sin
   secretos, y aparte, en la salida de errores, una contraseña temporal.
4. Entregar la contraseña temporal por el canal verificado, una sola vez, y no
   guardarla. El empleado inicia sesión con ella; el portal lo lleva al alta
   del autenticador porque ya no tiene ninguno. Conviene que la inscripción sea
   supervisada, en persona.
5. Comprobar que el empleado vuelve a `aal2` y opera el panel. Pedirle que
   cambie la contraseña temporal por una propia.

**Si se sospecha que la cuenta está comprometida**, agregar `--compromiso`.
Además de lo anterior, baja el rol a `cliente` antes que nada, lo que corta de
inmediato incluso el token ya emitido. Después de la reinscripción se
devuelve el rol:

```bash
... node scripts/recuperar-segundo-factor.mjs --email persona@ejemplo.com \
      --restaurar-rol vendedor --autorizo "<nombre>" --canal "<cómo se verificó>"
```

El script se niega a devolver el rol a una cuenta que todavía no tiene un
factor verificado, para no reabrir la puerta que se acaba de cerrar.

No usar nunca `DELETE` directo sobre `auth.mfa_factors` ni sobre otras tablas
internas de Auth, ni un botón de recuperación en el frontend. Tampoco
suspender la cuenta como forma de revocar: al levantar la suspensión las
sesiones anteriores reviven.

### Ventana residual

Sin `--compromiso`, un token de acceso emitido antes de la recuperación sigue
siendo válido con `aal2` hasta que expira: `jwt_expiry`, 3600 segundos en la
configuración local. Hay que comprobar el valor del proyecto hospedado antes
de dar por buena la estimación. Si esa ventana no es aceptable, usar
`--compromiso`.

### Decisiones pendientes de HEPSA

El procedimiento técnico está probado. Lo que no se puede decidir desde el
código, y queda pendiente de definir con el negocio:

- **Verificación de identidad.** Qué canal independiente cuenta como prueba
  (llamada al teléfono registrado, presencia física, otro) y quién la hace.
- **Autorización.** Quién puede autorizar una recuperación y quién puede
  ejecutarla con la llave de servicio. Hoy la única candidata es la persona
  propietaria del proyecto.
- **Registro.** Dónde se guarda el JSON de auditoría que imprime el script y
  durante cuánto tiempo.

La recuperación del último administrador queda bajo control del propietario
del proyecto. Si el propietario es la cuenta bloqueada, otra persona no debe
autoconcederse el rol ni improvisar una modificación de Auth o de perfiles. Se
debe escalar al propietario del proyecto o al procedimiento formal de
recuperación de la organización antes de eliminar el factor.

## Pruebas y aceptación

`npm test` ejecuta las pruebas aisladas con navegador, HTML de la aplicacion, datos sinteticos y SDK
simulado y red externa bloqueada. Comprueba la interfaz y los estados de error,
pero no demuestra RLS, JWT reales, expiración de tokens ni el comportamiento
del servicio Auth.

`npm run test:local` ejecuta la validación local contra el stack Docker local de HEPSA
con cuentas desechables. Esa suite sí puede comprobar RLS, sesiones, MFA y
limpieza de datos de prueba, pero sigue siendo un entorno local. Las pruebas
locales reportadas para esta entrega fueron 77/77 RLS, 15/15 MFA UI y 16/16
panel. No hay una afirmación de despliegue o de producción en esos números.

Lista de aceptación antes de cerrar la entrega:

- [ ] El empleado puede inscribir un TOTP y completar un código correcto.
- [ ] Un código inválido, vencido o una caída de red permite reintentar sin
      desbloquear el panel.
- [ ] Un vendedor y un administrador con `aal2` pueden operar el panel.
- [ ] Un empleado en `aal1` no obtiene datos protegidos aunque fuerce la UI.
- [ ] La cancelación limpia la sesión local y la pantalla de alta.
- [ ] El soporte puede verificar identidad, sustituir un factor y registrar la
      autorización sin copiar secretos.
- [ ] La sustitución administrativa usa sólo `auth.admin.mfa` en servidor y
      nunca SQL directo contra las tablas internas de Auth.
- [ ] Se comprueba el acceso después de la sustitución y se considera la
      expiración de JWT ya emitidos.
- [ ] Se ejecutan las suites locales y se conserva evidencia de su entorno.
- [ ] Producción se prueba y despliega por un procedimiento separado; esta
      entrega no declara ese paso como verificado.
