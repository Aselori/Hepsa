# Revision integral y plan de recuperacion de HEPSA

Fecha: 2026-09-10. Codigo revisado: `dccb140`. Rama del informe: `docs/revision-integral`.

## Dictamen

La base es recuperable. Conviene conservar Supabase y corregir primero seguridad, integridad de ventas y reproducibilidad. Dos paginas estaticas pueden servir a este negocio; el problema principal es mezclar presentacion, permisos visuales, persistencia y reglas comerciales dentro de esas paginas. Una reescritura completa o cambiar de hosting ahora agregaria riesgo sin resolver los fallos principales.

La primera correccion debe ser la inyeccion de HTML en el panel: una solicitud publica puede ejecutar JavaScript cuando la abre el personal. Se reprodujo localmente con Chromium, el renderizador original y datos sinteticos, bloqueando toda conexion de la pagina. No se enviaron cargas de prueba al servicio real. El segundo factor no neutraliza codigo que ya se ejecuta dentro de una sesion autorizada.

Este documento es un plan de reparacion, no una declaracion de que el sistema esta listo para produccion. No se cambiaron funciones de la aplicacion ni se desplego nada durante esta revision.

## Alcance y evidencia

Se revisaron `index.html`, `admin.html`, `config.js`, las nueve migraciones, semilla, configuracion Supabase, tres suites principales, utilidades TOTP, workflow y documentacion. Una revision independiente con Luna confirmo los problemas principales del frontend; el agente principal verifico el codigo y reprodujo la inyeccion.

Verificado en esta sesion:

- Sintaxis correcta en los seis modulos de pruebas, `config.js` y los scripts incrustados de ambas paginas. Esto no demuestra correccion funcional.
- GitHub informa que `Aselori/Hepsa` tiene `fork=false`, sin repositorio padre; las credenciales actuales tienen permiso de administrador. La historia local explica su origen, pero hoy es independiente en GitHub.
- `main` exige PR, historial lineal, proteccion para administradores y el check estricto `Sintaxis y suites`. Exige **cero** aprobaciones humanas.
- El [ultimo workflow del commit revisado](https://github.com/Aselori/Hepsa/actions/runs/34315787896) termino verde, pero Playwright, servidor y suites estaban **omitidos**. Solo paso la verificacion de sintaxis.
- El renderizador `cargarProyectosBD` ejecuto un marcador JavaScript introducido en un nombre sintetico de solicitud.

No verificado: estado real de RLS/migraciones/Auth/Storage en Supabase, facturacion y propietarios de Vercel/Supabase, restauracion de respaldos, entregabilidad SMTP, configuracion DNS, cabeceras desplegadas, rendimiento bajo carga y recorrido visual completo en dispositivos. No hay CLI Supabase instalado en PATH. No se ejecutaron suites que modifican la base compartida. Los documentos sobre el estado de produccion son antecedentes, no comprobacion actual. No se abrieron respaldos de clientes ni archivos de credenciales.

## Hallazgos y correcciones

Prioridades: P0 atender inmediatamente; P1 antes de operar con datos/ventas reales; P2 siguiente ciclo de estabilizacion; P3 evolucion. Las ubicaciones corresponden al commit revisado. Los riesgos de concurrencia se deducen del codigo y requieren reproduccion contra una base aislada.

| ID | Prioridad | Evidencia y efecto | Correccion y criterio de aceptacion |
|---|---|---|---|
| F01 | P0 | `index.html:778` acepta solicitudes; `admin.html:725-754` inserta nombre, contacto y notas en `innerHTML`, tambien dentro de atributos. Reproduccion local positiva. Historial (`699-721`), usuarios (`763-768`), inventario (`597-616`) y toasts (`370`) repiten el patron. Una solicitud anonima puede ejecutar acciones como el empleado que la abre. | Construir nodos y usar `textContent` para texto no confiable, propiedades para atributos y `addEventListener` para acciones. Validar protocolos de imagen. Probar nombres, notas, productos y errores con etiquetas, comillas y barras; deben verse como texto y no ejecutar eventos. Revisar datos existentes mediante lectura segura antes de abrirlos en el panel vulnerable. |
| F02 | P1 | `admin.html:498-521` crea cabecera y renglones en dos solicitudes. Si falla la segunda, queda una venta incompleta; reintentar puede duplicarla. | RPC transaccional con identificador idempotente, comprobacion de rol y AAL2, creacion de cabecera/renglones y respuesta unica. Un fallo de renglones debe dejar cero registros; repetir la misma clave debe devolver la misma venta. |
| F03 | P1 | `admin.html:481-517` confia en precios, IVA, total y estado de pago del navegador; no asigna `seller_id`. `saveConfig` (`772`) solo cambia memoria. No existe descuento de existencias al registrar una venta. | Definir con HEPSA cuando una cotizacion pasa a venta y cuando se reserva/consume stock. Calcular importes en servidor, registrar vendedor desde identidad autenticada, persistir configuracion y auditar descuentos/precios manuales autorizados. Probar dos ventas simultaneas de la ultima unidad, manipulacion de totales y recarga de configuracion. |
| F04 | P1 | `config.js:16` fija un unico proyecto remoto. Las suites leen esa configuracion; `tests/mfa-ui.spec.mjs:139` asciende temporalmente una cuenta y `tests/panel.spec.mjs:128` sube archivos. La documentacion describe sitio y pruebas compartiendo base. | Separar desarrollo/pruebas/produccion; bloquear por defecto las suites contra referencias no autorizadas. Fixtures por ejecucion, limpieza verificable y ninguna cuenta de produccion en CI. Demostrar que el test se niega a ejecutar con la referencia productiva. |
| F05 | P1 | `.github/workflows/pruebas.yml:50-98` omite las suites si falta ADMIN_EMAIL y aun asi pasa el check requerido. Ocurrio en la ultima ejecucion consultada. Playwright se instala sin version ni lockfile. | Separar checks de sintaxis y funcionales. Base local efimera y datos sinteticos para PR; integracion aislada obligatoria antes de release. Fijar dependencias y `npm ci`. Una prueba funcional rota debe bloquear integracion; no entregar secretos de produccion a codigo de PR. |
| F06 | P1 | `supabase/seed.sql:62` inserta solicitudes sin medidas/material/acabado, obligatorios desde `20260827000003_cotizador_estructurado.sql:58`. `docs/setup.md` solo aplica las primeras dos migraciones. El relleno de la migracion reconoce tres textos de ejemplo y falla ante otras solicitudes previas con columnas nulas. | Actualizar semilla al esquema final; replay de todas las migraciones en base vacia y prueba de upgrade con solicitudes historicas sinteticas. Backfill deliberado, sin inventar medidas reales. Documentar una sola ruta de instalacion y no marcarla completa hasta reproducirla. |
| F07 | P1 | `20260827000006_checkout.sql:48-151` hace multiples lecturas del carrito sin bloqueo ni clave idempotente. Vaciarlo dentro de la transaccion es bueno, pero dos checkouts pueden leer el mismo carrito antes del borrado; las lecturas tambien pueden ver ediciones intermedias. | Serializar checkout por usuario, establecer snapshot coherente de lineas y precios y usar idempotencia. Coordinar tambien las escrituras del carrito. Prueba concurrente: una operacion logica produce un pedido y renglones/importes coherentes. No descontar stock de una cotizacion sin decidir antes el flujo comercial. |
| F08 | P1 | `custom_requests_insert_publico`, migracion `20260826000002`, permite insertar sin limite y con columnas de estado/contacto poco restringidas. `docs/seguridad-pendiente.md` propone contar por correo/global, pero el correo lo controla el atacante y un limite global puede bloquear clientes legitimos. | Endpoint limitado para solicitudes con validacion de cuerpo, campos permitidos, proteccion contra automatizacion y limites por origen/identidad con politica comercial. Cerrar INSERT publico directo al introducirlo, o la API se salta el control. Probar que la ruta directa no permite eludirlo. |
| F09 | P1 | `docs/seguridad-pendiente.md` llama al 2FA HECHO pero recuperacion depende de borrar directamente `auth.mfa_factors`; no hay gestion de dispositivos. `index.html:874` elige siempre el primer factor. | Runbook de perdida/cambio de telefono usando API administrativa soportada, verificacion humana de identidad, operador autorizado, auditoria y revocacion de sesiones. Inscripcion supervisada inicial antes de dar acceso de personal. Probar perdida de dispositivo, factor alternativo, bloqueo del ultimo administrador y sesiones anteriores tras recuperacion. |
| F10 | P2 | `index.html:839-845` interpreta un error al consultar rol como cliente; `883-890` ignora errores al limpiar factores; `admin.html:353` no distingue fallo de API de AAL insuficiente. No hay suscripcion a cambios de Auth en el panel. | Estado compartido de autenticacion con error/reintento explicitos, limpieza del QR/secreto al salir, eleccion de factor y revalidacion al cambiar sesion. Mantener RLS como defensa. Probar perdida de red, cancelacion, dos pestanas, rol revocado y codigo vencido. No confundir este fallo visual con bypass de RLS. |
| F11 | P2 | `index.html:392-407` ignora errores de upsert y continua borrando otras lineas del carrito. La funcion no implementa una escritura atomica del conjunto. | RPC para reemplazo/versionado de carrito o cambios por linea con conflictos explicitos. No borrar tras un upsert fallido; mostrar estado sin sincronizar y permitir reintento. Probar error de red y ediciones simultaneas en dos dispositivos. |
| F12 | P2 | Esquema inicial: productos sin restricciones de precio/stock; renglones admiten cantidad nula/no positiva y `order_id` nulo; sin referencias para carrito.user_id y orders.client_id/seller_id. Las politicas de escritura staff son amplias. | Inventariar y limpiar datos antes de restricciones, definir precios no negativos/cantidades positivas, referencias y politica de borrado. Reducir escritura directa de ventas al introducir RPC. Indexar segun consultas reales, incluyendo referencias de renglones. Medir con EXPLAIN antes de optimizar indiscriminadamente; el indice carrito(user_id) duplica el prefijo de su PK. |
| F13 | P2 | Inventario/historial/solicitudes/perfiles usan consultas sin paginacion (`admin.html:597,699,725,763`); errores de solicitudes se dibujan como ausencia de datos. No hay busqueda ni detalle persistente de venta para reimpresion. | Paginacion estable y filtros servidor, columnas minimas, estados vacio/error distintos, detalle de venta y ticket desde registro persistido. Probar mas filas que el limite de respuesta de la API y una caida de conexion. |
| F14 | P2 | Dos HTML grandes con scripts globales, manejadores inline y estilos mezclados. Supabase usa CDN `@2` y no hay manifiesto de dependencias. `.vercelignore` es una lista de exclusion, no un artefacto publicable cerrado. | Extraer modulos por dominio, dependencias exactas y build que solo publique `dist/`. Incorporar CSP tras eliminar scripts/manejadores inline, politica de framing y cabeceras verificadas. Probar build desde clon limpio y ausencia de tests, docs, herramientas y respaldos en el artefacto. |
| F15 | P1 operativo | No hay evidencia actual de recuperacion completa ni propiedad empresarial de cuentas. La documentacion dice que Free tiene una ventana corta de backups y que Pro es necesario para separar entornos; ambas afirmaciones necesitan correccion. | Inventario de responsables y accesos, copia de DB y objetos Storage por separado, restauracion ensayada y objetivos de perdida/tiempo acordados. Separar entornos no exige por si solo Pro. Verificar el plan y disponibilidad real de backups, no asumirlos por tener Supabase. |

### Otros puntos que deben entrar en la estabilizacion

- No hay flujo de recuperacion de contrasena en las paginas. Agregar envio, redirect permitido, nueva contrasena y manejo de sesion/MFA; verificar SMTP real con cuentas de prueba aisladas.
- Cotizador usa tarifas declaradas provisionales en la migracion. HEPSA debe aprobar formulas, dimensiones, mano de obra, desperdicio, transporte, vigencia e impuestos antes de presentar estimaciones como compromisos comerciales.
- `README.md` usa el bucket antiguo `product-images` y marca tareas completadas o pendientes de manera inconsistente. `docs/setup.md`, arquitectura y guia deben describir lo que existe y enlazar pruebas.
- La regla de CONTRIBUTING de desplegar siempre frontend antes de migraciones es demasiado absoluta. Usar expandir, desplegar compatible, migrar datos, retirar esquema viejo. El orden depende del cambio; un frontend que llama una RPC inexistente tambien falla.
- La funcion `empleados_sin_segundo_factor` usa `IF NOT is_admin()`. `current_user_role()` puede devolver NULL si falta perfil. Endurecer condiciones privilegiadas con `IS NOT TRUE` y probar usuario autenticado sin perfil; no se reprodujo ese estado remoto ni se afirma que exista hoy.
- Revisar bajas del personal y minimo acceso: hoy un vendedor con AAL2 puede leer todos los perfiles por RLS aunque Usuarios este oculto. Acordar si necesita el directorio completo o un buscador de clientes con campos limitados.
- Accesibilidad y responsive requieren recorrido real: teclado, foco de modales, mensajes anunciados, etiquetas, contraste y tablas a 360 px. No se emitio dictamen visual a partir del codigo solamente.

## Cierre concreto del 2FA

La decision de exigir AAL2 en `is_staff` e `is_admin` es correcta. Roles vienen de `profiles`, no de metadatos editables; hay controles propios separados para perfil/carrito/pedidos y una politica publica independiente de catalogo. No es correcto decir que el personal sin 2FA no ve absolutamente ningun dato: puede ver lo publico y lo propio por diseno.

Para cerrar el trabajo, cubrir matriz anonimo/cliente/vendedor/admin por AAL1/AAL2 y por tablas, RPC y Storage; inscripcion inicial, reanudacion, codigo incorrecto/vencido, cancelacion, cambio y perdida de telefono, revocacion de rol y de sesiones. Las pruebas deben demostrar tanto denegacion como operaciones legitimas completas. [Supabase documenta inscripcion, desafio, baja y enforcement del lado servidor](https://supabase.com/docs/guides/auth/auth-mfa).

No construir de inmediato un boton que borre factores con una llave privilegiada. Primero resolver identidad del solicitante, permiso del operador, auditoria, sesiones existentes y recuperacion del ultimo admin. Una cuenta de personal aun sin factor requiere especial cuidado: quien obtenga su contrasena antes de la primera inscripcion puede registrar su propio autenticador.

## Plan de ejecucion por hitos

Estimaciones orientativas para una persona con revisiones, no compromisos de calendario. Accesos, calidad de datos y decisiones comerciales pueden ampliarlas. Cada fila debe convertirse en PR acotados.

| Hito | Orden y esfuerzo orientativo | Entrega y salida verificable |
|---|---|---|
| 0. Contener y reproducir | Primero, 1-2 dias | F01: renderizado seguro en todo el panel y prueba local de regresion. Identificar entorno real y evitar pruebas mutantes en el compartido. Mantener correccion pequena y desplegable, sin esperar al refactor. |
| 1. Base reproducible | 2-4 dias | F04-F06: entorno aislado, migraciones+seed desde cero, dependencias fijadas, CI funcional que realmente corre; version de Node comun. Recuperacion de una copia sintetica y comprobacion de limpieza de fixtures. |
| 2. Terminar 2FA | 2-4 dias, tras hito 1 | F09-F10: estados de error, factores y runbook de recuperacion; matriz de permisos automatizada. Corregir almacenamiento de prueba: `tests/panel.spec.mjs:135` intenta borrar imagen como vendedor aunque la politica solo permite admin; verificar limpieza con admin. |
| 3. Integridad comercial | 4-8 dias, tras decisiones de negocio | F02-F03/F07/F11-F12: RPC de venta y checkout coherente, idempotencia, carrito robusto, limites de datos, vendedor e inventario auditables. Pruebas de rollback, concurrencia y reintentos. |
| 4. Operacion y publicacion | 3-5 dias | F08/F15: abuso controlado, cuentas empresariales, backup DB+Storage restaurado, SMTP, alertas, seleccion de hosting y prueba de rollback. Cerrar puerta de INSERT publico que eluda el endpoint. |
| 5. Mantenibilidad y experiencia | 4-8 dias por incrementos | F13-F14: modulos, build, paginacion, errores, accesibilidad y movil. Mantener los mismos recorridos y pruebas durante la extraccion. |

Orden recomendado: 0 → 1 → 2 → 3 → 4 → 5. Las verificaciones de propiedad y backups empiezan en el hito 0. No interpretar el orden como permiso para seguir operando con riesgos P1 conocidos. Aprobacion comercial de reglas en paralelo a la parte tecnica.

## Arquitectura propuesta

Mantener una aplicacion modular y una base Postgres. Introducir un build pequeno con Vite y modulos JS, con migracion gradual a TypeScript si el equipo lo puede mantener. No hace falta React, Next.js, microservicios, Kubernetes ni reescribir Auth para resolver los hallazgos.

```text
src/
  public/        catalogo, cotizador, perfil, carrito
  admin/         POS, inventario, ventas, solicitudes
  auth/          sesion, roles visuales, MFA, recuperacion
  shared/        cliente Supabase, DOM seguro, validacion, estilos
supabase/
  migrations/    esquema, politicas, funciones transaccionales
  functions/     cotizaciones limitadas, futuros webhooks/operaciones privilegiadas
  seed.sql       solo datos sinteticos compatibles
tests/          unitarias, DB/RLS, navegador y fixtures aislados
docs/           arquitectura, operacion, decisiones
dist/           unica salida publica generada
```

Lecturas y CRUD simples pueden seguir en Supabase con RLS. Ventas y cambios de inventario pertenecen a transacciones de Postgres. Secretos, webhooks y controles de abuso necesitan codigo servidor. Preferir Supabase Edge Functions inicialmente para mantener una sola frontera de backend; si se elige Workers para esos endpoints, evitar duplicar logica comercial entre dos servidores.

Vite/TypeScript son propuestas de estructura, no paquetes instalados ni versiones seleccionadas en esta revision. Elegir versiones exactas y revisar documentacion vigente al implementar.

## Hosting: decision sugerida

Supabase aloja datos/Auth/Storage; Vercel aloja el frontend. Mover HTML no obliga a migrar la base. No hay evidencia de carga que justifique sustituir Postgres o autohospedar Supabase. Precios consultados el 2026-09-10, en USD, antes de impuestos, dominio, correo, extras y sobreconsumo. No se verifico el plan contratado de HEPSA.

| Opcion | Encaje | Coste base orientativo y limites | Decision |
|---|---|---|---|
| Vercel Pro + Supabase | Menor cambio operativo; previews y despliegue Git ya conocidos | Pro: $20/mes incluye un asiento de despliegue; cada asiento adicional $20/mes. Supabase Pro desde $25/mes. Base combinada de un asiento/proyecto: ~$45/mes, mas extras. | Valida si ahorrar trabajo de migracion pesa mas que la diferencia mensual. |
| Cloudflare Workers Static Assets + Supabase | Buen candidato para frontend estatico con posible endpoint ligero futuro | Peticiones a archivos estaticos gratis y sin limite segun documentacion; ejecucion de Worker tiene cuota/facturacion aparte. Con Supabase Pro, base orientativa ~$25/mes, mas extras. | Preferencia para una nueva publicacion de bajo coste, despues de probar previews, dominio y recuperacion. |
| Cloudflare Pages + Supabase | Alternativa sencilla con despliegue Git y previews | Free: 500 builds/mes, un build simultaneo; funciones consumen cuotas Workers. | Tambien sirve. Elegir frente a Workers segun flujo Git/preview y necesidades reales, sin migrar dos veces. |
| VPS/autohospedado | Control total pero obliga a operar DB, Auth, almacenamiento, correo, parches y backups | No se cotizo proveedor; la mano de obra y guardias deben incluirse en cualquier comparacion | No recomendado durante la toma de control de un equipo que acaba de perder desarrolladores. |

Fuentes de precios y restricciones: [Vercel Pro](https://vercel.com/docs/plans/pro-plan), [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [Pages limites](https://developers.cloudflare.com/pages/platform/limits/), [Supabase precios](https://supabase.com/pricing).

Vercel Hobby limita uso a proyectos personales no comerciales. No debe ser el supuesto de produccion para una empresa. Supabase Pro incluye un primer proyecto con el credito de computo correspondiente; otros proyectos pueden agregar coste. Entornos separados pueden ser locales o usar proyectos distintos, y no requieren automaticamente contratar Pro. Para produccion, presupuesto y restauracion deben evaluarse juntos.

[Los backups de Supabase no incluyen los archivos de Storage](https://supabase.com/docs/guides/platform/backups). Conservar metadata de productos sin recuperar imagenes no es recuperacion completa. Definir con HEPSA objetivos de recuperacion, por ejemplo propuesta inicial de perdida maxima de 24 h y recuperacion en 4 h, y ajustar segun volumen de ventas. No son capacidades verificadas ni SLA prometidos.

Antes de cambiar hosting: publicar el mismo artefacto corregido en un entorno aislado, comprobar login/confirmacion/recuperacion y redirects de Supabase, MFA, uploads, rutas /admin.html, cabeceras, cache y movil. Comparar latencia desde usuarios reales de Mexico. Registrar dominio y rollback; conservar el despliegue anterior hasta validar. No reutilizar `.vercelignore` como supuesto de exclusiones en Cloudflare: publicar solo `dist/`.

## Futuro del producto y del equipo

1. **Propiedad empresarial y continuidad.** Inventario sin secretos de GitHub, Supabase, hosting, dominio, DNS, correo, facturacion y administradores. Dos responsables reales con MFA y recuperacion custodiada. La cuenta personal actual tiene admin, pero no debe convertirse en el unico punto de recuperacion de la empresa. Transferir a una organizacion solo con responsables e integraciones preparados.
2. **Ventas trazables.** Identidad del vendedor, folio, historial de cambios, descuentos autorizados, anticipo/saldo con importes reales, cancelaciones y devoluciones. Guardar ticket emitido/reimprimible desde datos inmutables. No confundir ticket PDF con factura fiscal.
3. **Inventario operativo.** Movimientos y motivos, reservas con vencimiento si el negocio las necesita, ajustes con auditoria, alertas de stock y compras. Validar necesidad de produccion sobre pedido frente a venta de existencias.
4. **Cotizacion a proyecto.** Solicitud, visita/medicion, version de cotizacion aprobada, anticipo, fabricacion, entrega y cierre con responsables. No convertir automaticamente una formula provisional por area en precio definitivo.
5. **Pagos en linea.** Solo tras integridad comercial: proveedor aprobado, webhook verificado, idempotencia, conciliacion, reembolsos y pruebas sandbox. El navegador nunca decide que un pago esta liquidado.
6. **Operacion observable.** Errores frontend sin datos personales, fallos de RPC, monitoreo de disponibilidad, alertas de correo/backup, eventos de acciones administrativas y politica de retencion. Registrar evidencia de restauraciones y releases.
7. **Calidad sostenible.** Una persona adicional que pueda clonar, ejecutar y recuperar el sistema. Pedir una revision humana cuando exista ese segundo revisor; exigirla ahora sin alguien disponible puede bloquear al unico mantenedor. Usar PR pequenos y automatizacion real en cualquier caso.

## Decisiones que faltan del negocio

Se puede iniciar correccion de inyeccion y pruebas aisladas sin estas respuestas. Antes de alterar operaciones o contratar servicios, confirmar: si ya hay usuarios/datos reales activos; quien controla cuentas/dominio; presupuesto mensual y numero de desarrolladores; cuando se considera venta firme; reglas de stock/precios/descuentos/IVA; necesidad de facturacion/pagos; perdida de datos y tiempo de caida tolerables. No se asumio autorizacion para comprar, transferir cuentas o desplegar cambios productivos.
