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
su `aal` en cada solicitud. Para invalidar sesiones activas durante una
recuperación, el propietario debe usar la operación administrativa documentada
que elimina el factor verificado, pues Supabase indica que esa operación cierra
las sesiones activas asociadas. Esto no garantiza que un JWT ya emitido deje
inmediatamente de ser aceptado por RLS: la implementacion actual comprueba rol
y AAL, no la existencia de auth.sessions. Si hay sospecha de compromiso,
el propietario debe retirar temporalmente el rol operativo antes de recuperar
el factor y comprobar el rechazo del token anterior. Restituirlo solo cuando
hayan expirado los tokens previos o exista una revocacion adicional verificada.

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

1. Suspender temporalmente el acceso operativo si el riesgo lo requiere y
   completar la verificación de identidad por un canal independiente.
2. Obtener autorización del propietario del proyecto. La cuenta de servicio
   y la clave `service_role` sólo pueden vivir en un entorno de servidor
   controlado, nunca en `index.html`, el navegador, un ticket o un comando
   compartido.
3. El operador autorizado debe listar el factor de ese usuario con
   `supabase.auth.admin.mfa.listFactors({ userId })` y eliminar exactamente el factor
   identificado con `supabase.auth.admin.mfa.deleteFactor({ id, userId })`.
   Estas APIs administrativas están documentadas en
   [listFactors](https://supabase.com/docs/reference/javascript/auth-admin-listfactors)
   y [deleteFactor](https://supabase.com/docs/reference/javascript/auth-admin-deletefactor).
4. No hacer `DELETE` directo sobre `auth.mfa_factors` ni sobre otra tabla
   interna de Auth. No crear un botón de recuperación en el frontend. Las APIs
   administrativas son la ruta soportada y permiten auditar la operación.
5. Como la eliminación de un factor verificado puede cerrar sesiones activas,
   pedir al empleado que vuelva a iniciar sesión, complete el alta del nuevo
   factor y confirme un código. Verificar después el acceso al panel y el
   `aal2` de la sesión nueva.

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
