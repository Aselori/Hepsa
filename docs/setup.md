# Cómo levantar HEPSA en tu máquina

Guía para alguien que acaba de clonar el repo y no sabe por dónde empezar.
Toma unos 10 minutos. No necesitas instalar Node, ni Docker, ni una VM.

## 1. Correr la página

El proyecto son dos archivos HTML estáticos. No hay build, no hay `npm install`.

```bash
git clone https://github.com/saraicarrizales-beep/Hepsa.git
cd Hepsa
python -m http.server 8000
```

Abre <http://localhost:8000/> para el portal público y
<http://localhost:8000/admin.html> para el panel.

> **Sobre Live Server:** funciona igual, pero no hace falta y no todos usan
> VS Code. El comando de arriba viene con Python y es idéntico para todos.
> Lo importante es servir por HTTP y no abrir el archivo con doble clic
> (`file://` rompe la sesión de Supabase).

## 2. Apuntar a la base de datos

Toda la configuración vive en `config.js`, en la raíz. Es el único archivo que
cambias para moverte entre proyectos de Supabase:

```js
window.HEPSA_CONFIG = {
    supabaseUrl: 'https://TU-PROYECTO.supabase.co',
    supabaseKey: 'sb_publishable_...',
    storageBucket: 'productos'
};
```

**No trabajes contra el proyecto del cliente.** Ahí viven pedidos y datos de
contacto reales del negocio. Usa el proyecto de desarrollo del equipo.

La `supabaseKey` (publishable / anon) sí puede estar en el repo: está diseñada
para viajar al navegador, y lo que protege los datos son las políticas RLS. La
que **nunca** va en un archivo es la `service_role`, que se salta RLS entera.

## 3. Crear el proyecto de desarrollo

Esto lo hace **una sola persona**; el resto solo copia la URL y la llave.

1. Crear un proyecto gratis en <https://supabase.com>.
2. Abrir el **SQL Editor** y correr, en este orden:
   - `supabase/migrations/20260826000001_baseline_schema.sql`
   - `supabase/migrations/20260826000002_fix_role_escalation.sql`
   - `supabase/seed.sql`
3. En **Storage**, crear un bucket público llamado `productos`.
4. Pasarle al equipo la URL y la publishable key (**Settings → API**).

Las imágenes de los productos no se migran: viven en el Storage del proyecto
viejo. Se vuelven a subir desde el panel de admin cuando alguien las necesite.

## 4. Conseguir acceso de admin

El rol **no** se pide al registrarse: lo asigna el servidor. Todos nacen como
`cliente`, que es lo correcto — así un cliente no puede darse permisos solo.

1. Regístrate normal desde `index.html`.
2. Confirma tu correo.
3. Alguien con acceso al dashboard corre esto en el SQL Editor:

```sql
UPDATE public.profiles
SET role = 'admin'          -- o 'vendedor'
WHERE email = 'tu@correo.com';
```

Los roles válidos son `cliente`, `vendedor` y `admin`. Un `vendedor` entra al
panel pero no ve Configuración ni Usuarios.

> Si en el código viejo ves el rol `empleado`, es un error: nunca existió en la
> base. El equivalente real es `vendedor`.

## 5. Flujo de trabajo

Está en [team-guide.md](team-guide.md). En corto: rama por tarea, Pull Request
hacia `main`, que otro integrante lo revise.

## Problemas comunes

**"No hay productos disponibles" en el catálogo.**
El catálogo solo muestra productos con `is_active = true`. En la base de
producción los 6 están en `false`, así que se ve vacío aunque todo funcione.
El `seed.sql` los inserta activos justo por esto.

**Falla subir la imagen de un producto.**
Debe existir un bucket público llamado `productos`. El nombre importa: durante
mucho tiempo el código subía a `product-images`, que no existía, y por eso
varios productos quedaron sin imagen.

**"ACCESO DENEGADO" al abrir `admin.html`.**
Tu perfil sigue en `cliente`. Ver el paso 4.

**Cambios que no aparecen.**
El navegador cachea `config.js`. Recarga con `Ctrl+Shift+R`.

## Desplegar

Cuando haya algo que enseñar, [Vercel](https://vercel.com) conecta el repo de
GitHub y publica en un par de minutos. Como no hay build, no hay que configurar
nada: detecta los HTML estáticos y los sirve.
