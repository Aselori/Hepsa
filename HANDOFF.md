# HEPSA recovery checkpoint

- Objective: next 2FA deliverable. Cloudflare explicitly deferred. User taking over after original developers left.
- Scope: local staff-session injection fixes, reliable MFA screens, isolated tests and real local Auth/RLS verification. No production changes or broad rewrite.
- Branch: fix/segundo-factor-entregable; base dccb140. Preserve all existing review and implementation changes. No commit/push/deploy.
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

- PASS: all nine migrations and corrected seed on new local stack under /tmp/hepsa-mfa-local.
- PASS: npm test (admin rendering/action assertions and eight MFA mocked scenarios). Full-load navigation timeout fixed by waiting for DOMContentLoaded with blocked image requests.
- PASS final real local integration: 77/77 RLS, 15/15 MFA UI, 16/16 panel. Exec session 42118 finished with exit 0. Log /tmp/hepsa-local-tests-final.log; no test runner remains active.
- PASS: missing-local-config and remote-target guards reject before launching tests; final JS syntax, local doc links and git diff --check.
- Final cleanup verified: supabase stop --project-id hepsa-mfa-local succeeded with backup=true; docker ps filtered to HEPSA is empty. Local volumes preserved; unrelated containers not targeted. No task test process remains.
- Stack startup log /tmp/hepsa-supabase-start.log contains disposable local keys; do not print/copy into docs.
- Prior latest GitHub check skipped functional tests. New workflow not pushed or run remotely. No current production Auth/RLS/hosting verification.

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

## Preflight de integracion, 2026-09-11 (resumido)

- Preferencia global: verificar conexiones MCP y permisos antes de desarrollar,
  reportar lo que falte pronto, habilitar lo gratuito cuando haya autorizacion.
- Entradas anteriores sobre MCP no disponible describen el estado previo a la
  reparacion de la seccion siguiente. Se condensaron por tamano.

## MCP authentication repaired, 2026-09-11
- User called out unresolved Supabase/Vercel/Resend connections. Ran codex mcp login for all three; all completed successfully and credentials persisted through Codex OAuth storage. URLs were already configured; no config rewrite needed.
- Verified in fresh read-only Codex Luna processes: Resend list_domains, Vercel list_teams, Supabase get_project for HEPSA all returned without MCP errors. Primary inspected tool invocation/result evidence. No email sent, deployment made, SQL run or project mutation.
- Verification sessions: 01a090c4-9169-7f23-afa0-71624655f685 (Resend), 01a090c5-045a-7ed0-be9b-e9982431e1d2 (Vercel), 01a090c5-52d7-7281-a56b-2e6679a24373 (Supabase). CLI reported delegated tokens 22670, 22417, 51196 respectively; not context occupancy or billing.
- Supabase emitted HTTP 404 on DELETE transport session during process shutdown after successful project lookup; this was not an authentication or project-access failure.
- Earlier MCP-unavailable entries describe pre-repair state. Main session tools refreshed dynamically. Primary directly repeated all three read-only MCP calls successfully here. No Codex restart, desktop logout or reboot needed. Local demo independent service remains running.
- Hosted project access is now verified, but hosted schema/Auth parity and production readiness are still pending.

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
3. Pendiente con decisión de negocio: F02/F03, F07, F08. Sin decisión: F09
   (runbook de recuperación) y F12 (restricciones del esquema).
