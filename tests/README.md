# Pruebas de HEPSA

Node 22 o posterior. Dependencias de desarrollo fijadas en package-lock.json.
No usar cuentas ni secretos del proyecto compartido para estas suites.

## Regresiones aisladas del navegador

```bash
npm ci
npx playwright install chromium
npm test
```

El runner publica solo archivos de la aplicacion en un puerto local temporal.
No expone tests/.env.local ni respaldos. El navegador bloquea conexiones externas.
Cubre renderizado seguro y acciones del panel, y ocho escenarios de MFA con SDK
simulado: errores de rol/AAL/lista, alta interrumpida, factor alternativo,
doble envio, codigo incorrecto, red, cancelacion y exito. Tambien mide el portal
y el panel en telefono y tablet, el carrito lateral y pautas de accesibilidad
(etiquetas, avisos, formato de precios): nada se sale de la pantalla y cada boton clave
recibe el toque. Esto no prueba RLS.

## Integracion real con Supabase local

Requiere Docker operativo. Comprueba `docker info` antes de iniciar.
El stack HEPSA usa puertos 55321/55322, separados del puerto 54321 habitual.

```bash
npm ci
npx playwright install chromium
npx supabase start
npm run test:local
npx supabase stop
```

En la sesion de agente donde los grupos heredados aun no incluyen docker, la
membresia existente se activa por comando: `newgrp docker -c 'npm run test:local'`.
Esto no instala Docker ni modifica permisos; no hace falta si `docker info` ya funciona.

El runner consulta solo el estado local del CLI, crea tres cuentas temporales,
inscribe TOTP de admin/vendedor y conserva sus credenciales solo en memoria.
Sirve una configuracion local y un SDK compilado desde la dependencia fijada.
El config.js del sitio permanece intacto. Ejecuta, en este orden:

| Suite | Qué sostiene |
|---|---|
| `rls.spec.mjs` | Control de acceso por rol y por nivel de garantía |
| `mfa-ui.spec.mjs` | Las pantallas del segundo factor, manejadas con navegador |
| `panel.spec.mjs` | Que el panel siga sirviendo, con una venta real |
| `perfil-ausente.spec.mjs` | Un usuario sin fila en `profiles` no obtiene datos del personal |
| `rol-nulo.spec.mjs` | La base rechaza `role` NULL y nadie se asciende a admin |
| `recuperacion.spec.mjs` | El procedimiento de `scripts/recuperar-segundo-factor.mjs` |

El runner se detiene en la primera suite que falla, así que una falla tapa las
siguientes: al investigar una, córrela sola. Elimina las cuentas al terminar.
El stack conserva la semilla hasta detenerlo; no se toca otro proyecto ni otro
contenedor.

Las suites existentes ahora rechazan destinos no locales y bloquean conexiones
externas del navegador. La captura de alta en tests/screenshots enmascara QR y
secreto. Si se mata el proceso abruptamente, la limpieza finally no esta
garantizada: restablecer solo el stack desechable de HEPSA antes de repetir.

## CI

El check `Sintaxis y suites` ejecuta sintaxis, regresiones aisladas y las tres
suites reales contra Supabase local. No depende de secretos de GitHub y no omite
las suites por falta de credenciales. El stack se detiene incluso si una prueba falla.

## Alcance

Una suite local verde no acredita que produccion tenga las mismas migraciones,
configuracion Auth o permisos. Antes de entregar, usar docs/entrega-2fa.md para
el recorrido controlado y la recuperacion de cuentas. Las utilidades antiguas
codigo.mjs e inscribir-2fa.mjs no son necesarias para el runner automatico;
no ejecutarlas contra cuentas reales para obtener secretos de autenticadores.
