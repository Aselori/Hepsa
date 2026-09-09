## Que cambia y por que

<!-- El que se ve en el diff. Explica el por que: que estaba mal, que se
     rompia, o que hacia falta. -->

## Como se comprobo

<!-- Marca lo que aplique y pega el marcador de las suites. -->

- [ ] `tests/rls.spec.mjs`
- [ ] `tests/mfa-ui.spec.mjs`
- [ ] `tests/panel.spec.mjs`
- [ ] Probado a mano en el navegador

## Si corrige un fallo

- [ ] Hay una prueba nueva que lo habria detectado
- [ ] Se reprodujo antes de arreglarlo

## Si toca la base de datos

- [ ] La migracion esta en `supabase/migrations/`
- [ ] El nombre del archivo coincide con la version que Supabase registro
- [ ] El frontend que la necesita se despliega antes de aplicarla
