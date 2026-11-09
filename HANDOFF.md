# HEPSA recovery checkpoint

- Objective: next 2FA deliverable. Cloudflare explicitly deferred. User taking over after original developers left.
- Scope: local staff-session injection fixes, reliable MFA screens, isolated tests and real local Auth/RLS verification. No production changes or broad rewrite.
- Rama actual: main limpio (lo de esta sesión está fusionado). Mejoras 1, 2 (modo de prueba, sin activar) y 3 fusionadas.
- Repository moved from `/home/aselori/Projects/hepsa` to `/home/aselori/Work/projects/hepsa`. Primary prior Codex thread is `01a08d52-5047-79e2-84de-603b4220c1d7`; resume it from the new checkout with `codex resume 01a08d52-5047-79e2-84de-603b4220c1d7 -C /home/aselori/Work/projects/hepsa`, or discover moved-path sessions with `codex resume --all`.
- CONTRIBUTING.md remains project convention source. User supplied updated global AGENTS instructions (Arch/Omarchy, mise, explicit restart timing).
- User preference saved globally: enable best free approach when unavailable or explain exact enabling steps; no purchases. Filesystem inspection authorized, secrets excluded.

## Base técnica (septiembre, resumido)

- Docker: el usuario está en el grupo docker; si la sesión del agente no lo
  hereda, usar `newgrp docker -c '...'`. Supabase CLI fijada en devDependencies.
- Pruebas: `npm test` (aisladas, simuladas) y `npm run test:local` (stack
  local en 55321 con cuentas desechables, Stripe simulado en contenedor,
  limpia al final). CI corre ambas. Ninguna toca el proyecto hospedado.
- El stack local guarda llaves desechables en /tmp/hepsa-supabase-start.log:
  no copiarlas a documentos. Entrega del 2FA: docs/entrega-2fa.md.
- Capturas de presentaciones: output/ (ignorado); evidencia en la carpeta
  del curso.

## Conexiones MCP (resumido)

- 2026-09-11: se reparó el acceso de Codex a Supabase, Vercel y Resend y se
  verificó con llamadas de solo lectura. No se envió correo ni se cambió nada.
- El MCP de Supabase de Claude Code apunta al proyecto hospedado (estuvo
  pausado del 2026-10-05 al 2026-10-07; ya responde).

## Septiembre y octubre de 2026 (todo fusionado; detalle en cada PR)

- #8/#9: revisión con escalada por role NULL y fuga de personal sin 2FA,
  arregladas en 20260928211428 (aplicada al hospedado el 2026-11-06).
- #10 recuperación del 2FA (falta decidir quién verifica identidad, quién
  autoriza y dónde va la auditoría: F09). Pendientes de negocio: F02/F03,
  F07, F08, F12.
- #11 rediseño (tema claro y oscuro, tinta y acero; dorado sólo en el logo,
  a pedido: "demasiado IA"). #12 .vercelignore como lista de lo publicado.
  #13/#14 pautas de interfaz y diseño por tareas (maquetas aprobadas:
  https://claude.ai/artifact/7MWvstUSjYHGPzKy27x94s). Catálogo hospedado
  corregido: docs/catalogo-correccion-2026-10-09.md.
- Faltan datos del negocio: dirección y fotos reales (sin fotos de muestra,
  decisión del 2026-10-21). En Facebook: tel. 81 2679 6586 y
  admonhepsa@outlook.com; mostrarlos en config.js espera el visto bueno.

## Sesión 2026-11-06 (todo fusionado; detalle en cada PR)

- #16 menú: píldora del carrito, "Cotizar", dos filas en teléfono.
- #17 Mejora 2: Stripe en modo de prueba (decisión del usuario; para el
  curso basta el diseño). Migración 20261106120000_pagos_en_linea.sql, Edge
  Functions crear-pago y webhook-stripe, botón oculto con pagosEnLinea:
  false. Probado SÓLO en local (Stripe simulado en contenedor: ufw bloquea
  Docker → anfitrión). Activación: docs/pagos-en-linea.md.
- #18 carrito dice "Subtotal" (el IVA se suma al confirmar); acento del
  estimado. #21 acentos en la bandeja y limpieza de solicitudes @test.local.
- #19 panel: selectores de pago y proyecto en Historial, foto al editar,
  folio = id del pedido (antes al azar) y el ticket queda para exportar PDF.
- #20 issuer 'HEPSA' en el alta TOTP; #23 selector de autenticador con fecha.
- #22 scripts/demo/datos-demo.sql y borrar-datos-demo.sql (marca
  [DEMO-BORRAR]). CARGADOS en la base hospedada el 2026-11-06 (8 productos,
  12 ventas, 4 solicitudes; datos reales intactos: 6 productos, 1 pedido).
- #25 contraseñas: 10+ caracteres con minúscula, mayúscula y número en Auth
  local; en el hospedado se configura a mano en el panel (PENDIENTE de
  confirmar por el usuario). #26 (guía para proyecto propio) ABIERTO: el
  usuario decide si se fusiona.
- 2026-11-06: proyecto hospedado movido a una organización nueva (sólo el
  usuario como miembro). Integración de GitHub conectada por primera vez
  (antes nunca existió: nada se aplicaba solo) con "Deploy to production"
  ENCENDIDO: cada fusión a main aplica migraciones nuevas y despliega las
  Edge Functions de config.toml (sin secretos de Stripe responden 503). Consulta de sólo lectura en 0/0 y `db push` hecho por
  el usuario: el hospedado tiene las 11 migraciones del repo. Advisor de
  seguridad: sólo avisos intencionales (ver manual técnico) y rls_auto_enable,
  que es de Supabase.
- 2FA del admin (aslopezrivas@gmail.com): su factor del teléfono había sido
  reemplazado por uno de tests/inscribir-2fa.mjs (secreto en tests/.env.local).
  El usuario borró todos los factores y se dio de alta de nuevo: funciona.
  ADMIN_TOTP de tests/.env.local ya NO sirve. No correr inscribir-2fa.mjs
  contra el proyecto hospedado.
- Manuales (Claude Docs, privados, en español):
  usuario https://claude.ai/artifact/RNiqwCpAMmMbgSm8CmXwqo ·
  personal https://claude.ai/artifact/Ha76D6Wh2UKiX6XFbdD3iM ·
  técnico https://claude.ai/artifact/23dGe3gaws1t5xZiu1v7nh.
  Pregunta abierta en el de usuario: recuperación de contraseña.
- MCP de Supabase falló al conectar al iniciar la sesión (red lenta); el
  endpoint sí responde. Se reconecta con /mcp.

- #28 registro e inicio de sesión como formularios reales (Bitwarden los
  reconoce). #30: un solo campo de contraseña con Mostrar (sin Confirmar).
  #32: Mostrar pasa a ser un ícono de ojo dentro del campo, más passwordrules.
  Bitwarden no sugiere contraseña generada en el registro; causa no hallada y
  el usuario decidió que no importa.
- #33: registro y Cotizar piden "Nombre(s)" y "Apellidos" (dos campos, no
  cuatro), guardados en first_name y last_name_p; sin migración.
- #29: crear-pago y webhook-stripe se caían con 500 al desplegarse sin
  secretos (Stripe 23 lanza sin llave); ahora contestan 503, verificado en
  vivo. test:local también las prueba sin secretos.
- Regla de contraseñas en el hospedado: longitud 10 puesta por el usuario;
  los requisitos deben ser "minúsculas, mayúsculas y dígitos" (sin
  símbolos) para coincidir con el formulario: CONFIRMAR.
- SMTP con Brevo (remitente aslopezrivas@gmail.com, "HEPSA"): sin él
  Supabase sólo envía a miembros de la organización. La llave vence el
  2027-11-06 o tras 90 días sin envíos. Dirección en Brevo provisional
  (FIME). Probado: un registro con un correo ajeno a la organización recibió
  la confirmación.

## Sesión 2026-11-07/08: rediseño del panel por rol (todo fusionado)

- Plan aprobado ("yes, go"): roles cliente, taller (nuevo), vendedor, admin;
  cada "no puede" lo niega la base. Pasos 1 a 5 hechos:
  - #34 migraciones 20261107000001 (rol taller) y 20261107000002 (permisos):
    precio y nombre sólo admin, alta de productos sólo admin, ventas sólo por
    registrar_venta() con precios del catálogo (cierra F03), pedidos_de_taller()
    sin precios, avanzar_proyecto(), no quitarse el rol ni dejar 0 admins,
    mensaje del ticket en parametros_cotizacion. APLICADAS al hospedado
    (13 migraciones), advisor sin avisos nuevos inesperados.
  - #35 menú por rol (data-roles) e Inicio (sólo pendientes).
  - #36 Equipo: cambiar roles y ver segundo factor desde el panel.
  - #37 Precios: tarifas del cotizador, mínimo, IVA, ticket, sobre pedido.
  - #38 Producción: vista del taller (tarjetas, tel:, marcar instalado).
- Decisión 2026-11-08: NO cuenta de admin compartida. Cada integrante del
  equipo se registra y el admin lo promueve en Equipo (cada quien su 2FA).
- No verificado en vivo: venta como vendedor ni la vista del taller (no hay
  cuentas de vendedor/taller con 2FA en el hospedado; no inscribir desde
  scripts). Todo probado en el stack local y en CI.
- #39 fotos reales (Facebook, 410 revisadas por hojas de contacto): 19 en
  assets/productos/ sin metadatos. En el hospedado, 2026-11-08: corrido
  borrar-datos-demo.sql (decisión: productos y ventas demo) y
  scripts/catalogo/fotos-y-productos-2026-11-08.sql. Quedan 19 productos:
  6 reales activos con foto y 13 nuevos OCULTOS con precio 0 y marca
  [PRECIO POR CONFIRMAR] (decisión: ocultos hasta tener precio). Quedan 1
  venta real y 3 solicitudes. Verificado en vivo con Playwright.
- Riesgo a confirmar con HEPSA: varias fotos de la página parecen de
  inspiración y no obra propia; las de la casa 514 sí son suyas.
- Manuales al final: rehacerlos con el formato y estructura de las
  referencias en ~/Downloads/manual_reference (KarinPOS y Fundamental2,
  usuario y técnico), con capturas hechas con Playwright.

### Siguientes pasos

1. Usuario: regla de contraseñas en el panel de Supabase (CONFIRMAR).
2. HEPSA: precios de los 13 productos nuevos (el admin los pone y los
   activa en Catálogo) y confirmar que las fotos son obra propia.
3. Pasos restantes del plan: 6 Negocio (ventas del mes, por cobrar, por
   vendedor), 7 Pagos en línea (sólo si se activan), 8 cotización a venta.
4. Manuales de usuario, personal y técnico con el formato de referencia.
