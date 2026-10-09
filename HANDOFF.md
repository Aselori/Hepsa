# HEPSA recovery checkpoint

- Objective: next 2FA deliverable. Cloudflare explicitly deferred. User taking over after original developers left.
- Scope: local staff-session injection fixes, reliable MFA screens, isolated tests and real local Auth/RLS verification. No production changes or broad rewrite.
- Rama actual: feature/rediseno-sutil (rediseño, sin push). La Mejora 3 (2FA) ya está fusionada en main.
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

## Sesiones 2026-09-27 y 2026-09-28 (fusionadas; detalle en PR #8 y #9)

- Checkpoint en git del trabajo previo, encabezado móvil arreglado
  (tests/responsivo.spec.mjs) y package.json con devDependencies fijadas.
- Revisión con Opus 5.5: escalada a admin con role NULL y fuga de la lista
  de personal sin segundo factor, arregladas en la migración
  20260928211428_blindar_guardias_ante_perfil_ausente.sql; inyección de CSS
  del catálogo arreglada. Cada arreglo tiene prueba que falla sin él.

### Verificación

- PASS: 77/77 RLS, 15/15 MFA UI, 16/16 panel, 7/7 sin perfil, 4/4 role NULL,
  11/11 responsivo, 7/7 imagen del catálogo, 8 escenarios MFA aislados.
- Stack local nunca reiniciado con db reset: cuentas del demo intactas.
- NO verificado: proyecto hospedado, sitio publicado, Auth/RLS remoto. La
  migración solo se aplicó al stack local.

### Siguientes pasos exactos

1. #8 fusionado el 2026-09-29 (main 743af3a, contenido idéntico a la rama).
   #9 rebasado sobre main con árbol idéntico al verificado; espera a que el
   usuario lo fusione.
2. En el proyecto hospedado, antes de aplicar la migración, contar filas con
   role NULL y usuarios sin fila en profiles (consulta de solo lectura).
3. Pendiente con decisión de negocio: F02/F03, F07, F08. F12 (restricciones
   del esquema) sin decisión, pero exige inventariar antes los datos hospedados.
4. F09 fusionado (PR #10, main bf81880): script probado 14/14 y documento
   corregido. Faltan decisiones de negocio: quién verifica identidad y cómo,
   quién autoriza, dónde se guarda el registro de auditoría.
- Rediseño sutil FUSIONADO y publicado (PR #11, main c0661c3, 2026-10-07):
  tema claro y oscuro en assets/tema.css, paleta tinta y acero (dorado solo en
  el logo, a pedido del usuario: "demasiado IA"), Archivo servida desde el
  sitio, panel para teléfono, carrito rediseñado y arreglo de la reescritura
  del carrito al cargar. Verificado en hepsa.vercel.app con Playwright.
- 2026-10-07: el proyecto Supabase hospedado volvió (el usuario lo reanudó);
  la API responde 200.
- 2026-10-07: el sitio publicaba scripts/, .github/, .mcp.json, .vscode/ y
  skills-lock.json. .vercelignore pasa a lista de lo que SÍ se publica (rama
  chore/publicar-solo-el-sitio). FUSIONADO (PR #12, main c644490); en vivo
  esas rutas dan 404 y el sitio carga completo.
- 2026-10-07: las instrucciones globales del usuario ahora tienen una sección
  "Design thinking" (~/.codex/AGENTS.md): evaluar antes de implementar, lo
  urgente primero, mostrar excepciones. Con ella se evaluó el sitio y se
  hicieron maquetas: https://claude.ai/artifact/7MWvstUSjYHGPzKy27x94s
  (privadas). El usuario aprobó TODAS.
- PR #13 (fix/pautas-de-interfaz): pautas de Vercel (etiquetas ligadas,
  autocompletado, precios es-MX). Abierto, espera fusión.
- Rama feature/diseno-por-tareas (apilada sobre #13): portal y panel según
  las maquetas, mayúscula inicial. Pruebas: tests/tareas.spec.mjs (0/18 en
  main, 19/19 en la rama) y todas las suites locales en verde.
- Faltan datos del negocio (el usuario aún no los tiene): teléfono,
  WhatsApp y dirección van en config.js (contacto); vacíos no se muestran.
- 2026-10-09: PR #13 y #14 FUSIONADOS (main b7e79c5) y verificados en vivo.
  Catálogo hospedado corregido con permiso del usuario (nombres repetidos,
  ortografía, medidas): docs/catalogo-correccion-2026-10-09.md tiene el antes
  y después y 4 dudas de datos para el negocio. Demo local detenida.
