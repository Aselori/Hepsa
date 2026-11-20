# HEPSA: punto de recuperación

## Objetivo actual (2026-11-20)

Base de datos en inglés, notas internas en ventas y solicitudes, vigencia de
cotizaciones y paquetes (pedidos por la profesora), pagos en línea en modo de
prueba funcionando en el sitio publicado, y manuales al día y sin rastro de
herramientas de IA.

## Reglas que no cambian

- Identificadores (tablas, columnas, funciones, ramas, archivos) en inglés;
  textos para usuarios, comentarios, documentación, commits y PR en español.
- Ningún rastro de herramientas de IA en commits, PR, archivos ni manuales.
- Fusionar a `main` ES publicar: la integración de GitHub con Supabase aplica
  las migraciones nuevas y despliega las Edge Functions de `config.toml`, y
  Vercel publica el sitio. Toda fusión espera el visto bueno del usuario.
- Una migración nueva debe llevar fecha posterior a la última aplicada en el
  hospedado (hoy 20261117160000), o la integración la rechaza.
- No correr `tests/inscribir-2fa.mjs` contra el hospedado: reemplaza el factor
  del administrador.
- Nunca guardar aquí contraseñas, llaves ni datos de clientes.

## Rama `feat/english-schema` (sin publicar)

Parte de `origin/main` (5be7c99, notas del taller ya aplicadas en vivo). Trae:

- Vigencia de 14 días y paquetes (antes `feature/cotizaciones-y-combos`) e
  interfaz de pagos (antes `ui/pagos-en-linea`), integradas.
- Producto sin precio no se publica (antes PR #50), con migración
  renombrada a `20261120110000_product_active_requires_price.sql`.
- `20261120120000_english_schema.sql`: renombra en sitio todo el esquema;
  `notes` reemplaza a `notas_pedido` (ventas y solicitudes; el taller sólo
  anota y lee lo que ve, por `workshop_orders()`); `custom_requests.status`
  pasa a enum; `orders` exige `total = subtotal + tax`; paquetes y vigencia
  escritos en inglés. Las migraciones españolas de paquetes y vigencia, que
  nunca llegaron al hospedado, se quitaron.
- Edge Functions: `create-payment` y `stripe-webhook` (antes `crear-pago` y
  `webhook-stripe`; las viejas siguen desplegadas hasta borrarlas a mano).
- Documentos y scripts con los nombres nuevos; se quitaron la revisión de
  septiembre, la corrección del catálogo de octubre y su script.
- Después de abrir el PR #52: el panel muestraba el rol en inglés (Seller);
  ahora dice Vendedor, Taller o Administrador y la prueba de RLS lo exige.
  `cart_items.qty` pasa a `quantity`, y renglones, estados y fechas que
  nunca deben quedar vacíos pasan a NOT NULL (el hospedado no tiene vacíos).

Verificado: `npm test` (aisladas, incluida `notas-internas.spec.mjs` 17/17) y
`npm run test:local` completos en verde sobre una base local reconstruida
desde cero. Recorrido visual local de paquetes (catálogo, detalle, carrito en
1366 y 390 px), Solicitudes con vigencia y editor de paquetes.

No verificado: la migración contra los datos del hospedado (sí se revisó que
sus datos cumplen las reglas nuevas: totales, estados, precios).

## Hallazgos de la revisión del trabajo del 19

- Notas del taller (en vivo): el taller podía leer todas las notas, también
  las de ventas que no ve; no había notas en solicitudes ni forma de anotar
  desde Ventas; código de respaldo para "tabla inexistente" que ya no hacía
  nada. Corregido en la rama.
- Paquetes: un producto repetido en un paquete daba un error de llave
  primaria; ahora se rechaza con mensaje claro. Borrar un producto lo quita
  de sus paquetes (antes lo impedía).
- Totales: `total` se calculaba aparte y podía diferir un centavo de
  `subtotal + tax`; ahora es la suma y la base lo exige.
- Fuentes de los manuales del 19 vivían sólo en `/tmp` (se borra al
  reiniciar): copiadas a `~/Downloads/manuales_hepsa/fuentes-sol-2026-11-19/`,
  junto con un cambio sin confirmar de la demo pública de pagos.

## Datos en el hospedado

- 4 cuentas de demostración (@example.com) y datos de demostración cargados
  para la exposición; se quitan con `borrar-datos-en-vivo.sql` de la rama
  `demo/datos-en-vivo`, que debe actualizarse a los nombres en inglés antes
  de usarse después de publicar esta rama.
- Datos reales: una venta y cuatro solicitudes que no son @example.com.

## Pendiente del usuario

1. Visto bueno para fusionar `feat/english-schema` (publica todo de una vez).
   Antes conviene saber la fecha de la exposición.
2. Cuenta de Stripe en modo de prueba y sus dos secretos en Supabase
   (`docs/pagos-en-linea.md`); después se pone `pagosEnLinea: true`.
3. Borrar en Supabase las funciones viejas `crear-pago` y `webhook-stripe`.
4. Visto bueno para reescribir el historial (quitar rastros de IA de los
   commits) y borrar las ramas viejas ya fusionadas.
5. Perfiles de Chrome de la exposición; regla de contraseñas del hospedado.

## Siguientes pasos

1. Tras la fusión: comprobar en vivo la migración, las funciones y un pago de
   prueba de punta a punta; actualizar y probar los scripts de demostración.
2. Historial sin rastros de IA y descripciones de PR; borrar ramas viejas.
3. Manuales: HECHOS (usuario v7, técnico v5) en `~/Downloads/manuales_hepsa/`,
   generador en `~/Work/uni/proyint/expediente/manuales` (rama `manuales-v5`,
   sin push). Describen la rama sin publicar: si cambia antes de fusionar,
   volver a correr preparar.mjs, capturas.mjs y los dos construir.
