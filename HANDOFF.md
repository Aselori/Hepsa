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

## Publicado el 2026-11-20 (PR #52, commit e1542ea)

- Migraciones 20261120110000 y 20261120120000 aplicadas en el hospedado;
  Edge Functions `create-payment` y `stripe-webhook` activas; sitio en Vercel.
- Antes de fusionar se comparó el esquema del hospedado con el local en
  20261117160000: idénticos salvo `rls_auto_enable()` (de Supabase). Los datos
  cumplían las reglas nuevas (totales, estados, nulos, precios).
- Después: prueba de humo del sitio (catálogo, cotizador con
  calculate_price, sin errores), datos convertidos (solicitudes pending/closed,
  2 notas, roles en inglés) y asesor de seguridad sin hallazgos nuevos.
- Sigue pendiente: borrar a mano `crear-pago` y `webhook-stripe` (el permiso
  automático no dejó borrarlas desde aquí) y las llaves de Stripe.
- `scripts/demo/*-en-vivo*` traducidos a los nombres nuevos y probados en
  local (cargar y borrar).

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
  para la exposición; se quitan con `scripts/demo/borrar-datos-en-vivo.sql`
  (ya con los nombres en inglés) en el SQL Editor de Supabase.
- Datos reales: una venta y cuatro solicitudes que no son @example.com.

## Pendiente del usuario

1. (Hecho: fusionado y publicado.)
2. Cuenta de Stripe en modo de prueba y sus dos secretos en Supabase
   (`docs/pagos-en-linea.md`); después se pone `pagosEnLinea: true`.
3. Borrar en Supabase las funciones viejas `crear-pago` y `webhook-stripe`.
4. Visto bueno para reescribir el historial (quitar rastros de IA de los
   commits) y borrar las ramas viejas ya fusionadas.
5. Perfiles de Chrome de la exposición; regla de contraseñas del hospedado.

## Siguientes pasos

1. Con las llaves de Stripe: poner `pagosEnLinea: true` en config.js y hacer
   un pago de prueba de punta a punta en el sitio publicado.
2. Historial sin rastros de IA y descripciones de PR; borrar ramas viejas.
3. Manuales: HECHOS (usuario v7, técnico v5) en `~/Downloads/manuales_hepsa/`,
   generador en `~/Work/uni/proyint/expediente/manuales` (rama `manuales-v5`,
   sin push). Describen la rama sin publicar: si cambia antes de fusionar,
   volver a correr preparar.mjs, capturas.mjs y los dos construir.
