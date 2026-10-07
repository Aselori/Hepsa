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

## Sesion 2026-09-27: checkpoint en git (resumido)

El detalle vive en los mensajes de los ocho commits y en el PR #8.

- El trabajo de sesiones previas estaba entero SIN CONFIRMAR. Quedo en git en
  la rama fix/segundo-factor-entregable.
- hepsa-demo.service estaba inactivo aunque este documento lo daba por vivo.
  El stack de Supabase si seguia arriba.
- output/ pasa a estar ignorado: la evidencia del curso va en la carpeta del
  curso, no en el repositorio de codigo.
- package.json entro con cuatro devDependencies fijadas (playwright, supabase,
  @supabase/supabase-js, esbuild). Ninguna en dependencies: nada llega al
  navegador. Reportado al usuario, que no puso objecion.
- Corregida una assercion fragil en mfa-ui.spec.mjs: la auditoria exigia
  exactamente una fila y fallaba con las cuentas del demo, que existen a
  proposito sin factor.
- Corregido el encabezado en pantallas angostas. El sintoma anotado antes
  ("botones que se encimaban") era incorrecto: medido, cero solapes; era
  desbordamiento horizontal con el boton de acceso fuera de la ventana, y
  afectaba tambien a 768 px. Cubierto por tests/responsivo.spec.mjs, que falla
  sin el arreglo.

## Sesión 2026-09-28: revisión con Opus 5.5 y fallos de seguridad

El usuario cambió de modelo y pidió analizar y rehacer lo hecho. Se hizo una
revisión independiente en vez de regenerar a ciegas; el detalle está en los
mensajes de commit y en el PR #9.

- PR #8 abierto, CI en verde (incluida la integración real de Supabase dentro
  de Actions). El nombre del job "Sintaxis y suites" coincide con el control
  obligatorio de main.
- La revisión encontró que el primer análisis de seguridad estaba INCOMPLETO:
  afirmaba una sola aparición del guardia sensible a NULL y había dos. La que
  faltaba era peor.
  - Escalada: con role NULL un usuario se ascendía a admin (disparador
    prevent_role_self_escalation, escrito "AND NOT is_admin()").
    Reproducido por la API real: role antes=null, después=admin.
  - Fuga: sin fila en profiles, empleados_sin_segundo_factor() devolvía la
    lista del personal sin segundo factor.
- Arreglo en una migración coherente
  (20260928211428_blindar_guardias_ante_perfil_ausente.sql): role NOT NULL
  con relleno a 'cliente', is_admin/is_staff con COALESCE, y los dos guardias
  con IS NOT TRUE. RLS no cambia de comportamiento.
- Inyección de CSS en el catálogo público (index.html): image_url iba dentro
  de style="url('...')" y el escapado HTML no protege ahí. Ahora se valida
  (https, mismo origen u origen de Supabase) y se asigna por CSSOM.
- Cada arreglo tiene su prueba y se verificó que falla sin él:
  rol-nulo 1/4, perfil-ausente 6/7, catalogo-imagen 2/7 (con el código viejo
  el navegador sí descargaba el píxel de rastreo).
- Historial de #8 y #9 reescrito para corregir mensajes sin acentos y el
  análisis equivocado. Árbol de #8 verificado idéntico byte a byte al original.

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
  chore/publicar-solo-el-sitio). Siguiente: revisar el diseño contra
  ~/.claude/skills/web-design-guidelines (pedido del usuario).
