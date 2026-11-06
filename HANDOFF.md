# HEPSA recovery checkpoint

- Objective: next 2FA deliverable. Cloudflare explicitly deferred. User taking over after original developers left.
- Scope: local staff-session injection fixes, reliable MFA screens, isolated tests and real local Auth/RLS verification. No production changes or broad rewrite.
- Rama actual: main limpio (lo de esta sesión está fusionado). Mejoras 1, 2 (modo de prueba, sin activar) y 3 fusionadas.
- Repository moved from `/home/aselori/Projects/hepsa` to `/home/aselori/Work/projects/hepsa`. Primary prior Codex thread is `01a08d52-5047-79e2-84de-603b4220c1d7`; resume it from the new checkout with `codex resume 01a08d52-5047-79e2-84de-603b4220c1d7 -C /home/aselori/Work/projects/hepsa`, or discover moved-path sessions with `codex resume --all`.
- CONTRIBUTING.md remains project convention source. User supplied updated global AGENTS instructions (Arch/Omarchy, mise, explicit restart timing).
- User preference saved globally: enable best free approach when unavailable or explain exact enabling steps; no purchases. Filesystem inspection authorized, secrets excluded.

## Verified platform and restart status

- Host account is in docker group, inherited agent groups remain stale. Docker service and socket active.
- `newgrp docker -c 'docker info ...'` succeeds. No relogin or restart required for this work. This supersedes all earlier restart instructions.
- Use host escalation plus newgrp for Docker commands. Existing unrelated e-commerce containers were left alone.
- Supabase CLI 2.117.0 installed as pinned devDependency. Ambient Node 25.8.0; repository requires >=22 and CI uses 22. Global defaults unchanged.

## Implemented

- admin.html: safe DOM/text rendering of public request data, products, orders, profiles, POS and toasts; generated action listeners; startup access errors visible; signout redirects.
- auth-mfa.js extracted from index.html: explicit error/retry, fail-closed role lookup, selected TOTP factor, incomplete enrollment cleanup, duplicate-submit guard, cancellation/error handling and secret clearing. index.html has accessible error/selector controls.
- package.json/lockfile: pinned Playwright, Supabase CLI, SDK and esbuild for reproducible local tests.
- Tests: isolated admin rendering and 8 mocked-MFA browser scenarios; runner serves only app files. Legacy RLS/MFA/panel suites now require loopback test target and block external browser requests.
- tests/local.mjs creates temporary accounts/factors on local stack, serves locally bundled SDK/config, runs original suites and cleans accounts. No credentials written to repo.
- supabase/config.toml now configures dedicated local stack on ports 55321/55322, TOTP enabled; project_id is local identifier, not remote link. Seed compatible with final schema.
- CI now runs isolated and real local suites without shared secrets; prior conditional skip removed.
- Review retained in docs/revision-integral.md and linked in README. Luna contributed safe rendering, regressions and harness repair; primary verified isolated tests.

## Verification / processes

- 2FA work (merged): all migrations, npm test and the real local suites passed; CI runs both. No production Auth/RLS verification by the agent.
- Stack startup log /tmp/hepsa-supabase-start.log contains disposable local keys; do not print/copy into docs.

## Deliverable and exact next steps

- docs/entrega-2fa.md documents normal flows, manual recovery/replacement, JWT caveats and pending production acceptance. Setup/tests docs updated; obsolete direct SQL MFA deletion advice removed.
- Completed local implementation milestone. No production deployment, live project configuration audit or GitHub Actions execution of new workflow performed. No purchases. No restart required.
- Next release work: review current patch, confirm shared project migration/Auth parity and account ownership, then controlled deployment and smoke test with real staff. Do not claim production-ready solely from local tests.
- Device-management UI and audited recovery automation remain future work. Current recovery procedure requires an authorized operator and supported admin MFA APIs.
- New files to checkpoint: HANDOFF.md, auth-mfa.js, package.json, package-lock.json, docs/revision-integral.md, docs/entrega-2fa.md, tests/admin-rendering.spec.mjs, tests/aisladas.mjs, tests/mfa-aislado.spec.mjs, tests/entorno-local.mjs, tests/local.mjs.

## Demo local (resumido)

- tests/demo-local.mjs sirve la app en http://127.0.0.1:8000 con SDK y config
  locales, y reutiliza las cuentas del archivo privado /tmp/hepsa-demo-access.json
  (modo 600, nunca servido por HTTP, no copiar su contenido aqui). Solo crea
  cuentas nuevas si el archivo falta, asi preserva los factores inscritos.
- Corria como servicio transitorio de usuario hepsa-demo.service. Al 2026-09-28
  estaba INACTIVO; el stack de Supabase si seguia arriba.
- Levantar: newgrp docker -c 'npx supabase start' y luego
  newgrp docker -c 'npm run demo:local'.
- Probado en su momento con Chromium real: alta con QR, cancelar, cerrar sesion
  y login de cliente sin MFA. No se inscribio ningun autenticador del usuario.

## Capturas de presentaciones (resumido)

- PNG y ZIP de Avance 1 y 2 y del carrito persistente viven en output/, que
  desde 2026-09-27 esta ignorado por git: la evidencia del curso va en la
  carpeta del curso.
- El catalogo de hepsa.vercel.app se quedo cargando en el navegador de captura
  y no se investigo: no se afirma que el despliegue este sano.
- El intento a 430 px expuso el fallo del encabezado, corregido el 2026-09-27.

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
- #29: crear-pago y webhook-stripe se caían con 500 al desplegarse sin
  secretos (Stripe 23 lanza sin llave); ahora contestan 503, verificado en
  vivo. test:local también las prueba sin secretos.
- Regla de contraseñas en el hospedado: longitud 10 puesta por el usuario;
  los requisitos deben ser "minúsculas, mayúsculas y dígitos" (sin
  símbolos) para coincidir con el formulario: CONFIRMAR.
- SMTP con Brevo (remitente aslopezrivas@gmail.com, "HEPSA"): sin él
  Supabase sólo envía a miembros de la organización. La llave vence el
  2027-11-06 o tras 90 días sin envíos. Dirección en Brevo provisional
  (FIME). Prueba con un correo externo: PENDIENTE de resultado.

### Siguientes pasos

1. Usuario: regla de contraseñas en el panel de Supabase.
   Tras la próxima fusión a main: comprobar que se desplegaron crear-pago y
   webhook-stripe y que responden 503 sin secretos.
2. Siguiente tema pedido por el usuario: panel de administración y permisos
   (hoy los roles se asignan por SQL; Configuración sólo en memoria, F03).
