# Guía rápida para el equipo

## 1. Clonar el repositorio

```bash
git clone <URL_DEL_REPOSITORIO>
cd HEPSA
```

## 2. Trabajar en una rama

Cada integrante debe crear una rama para su tarea:

```bash
git checkout -b feature/nombre-de-la-tarea
```

Ejemplos: `feature/catalogo`, `feature/pos`, `feature/inventario`, `fix/login`, `fix/ticket-pdf`.

## 3. Guardar cambios

```bash
git add .
git commit -m "feat: descripcion breve del cambio"
```

## 4. Subir la rama

```bash
git push -u origin feature/nombre-de-la-tarea
```

## 5. Integrar cambios

Cuando una tarea esté terminada, abrir un Pull Request hacia la rama principal y pedir revisión a otro integrante.

## Convención sugerida de commits

- `feat:` nueva funcionalidad
- `fix:` corrección de error
- `docs:` documentación
- `refactor:` reorganización sin cambiar comportamiento
- `style:` cambios visuales/formato
- `chore:` mantenimiento

## Reglas importantes

- No subir contraseñas ni secretos.
- No trabajar directamente sobre la rama principal para cambios experimentales.
- Probar el sistema antes de hacer push.
- Describir claramente cada Pull Request.
