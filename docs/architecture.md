# Arquitectura de HEPSA

## Vista general

La implementación actual está formada por dos interfaces web estáticas que consumen servicios de Supabase directamente desde el navegador.

```text
Cliente
  │
  ├── index.html
  │      ├── Catálogo
  │      ├── Carrito
  │      ├── Solicitudes a medida
  │      └── Autenticación
  │
  └── admin.html
         ├── POS
         ├── Inventario
         ├── Historial
         ├── Proyectos
         ├── Usuarios
         └── Configuración
             │
             ▼
       Supabase JavaScript SDK
             │
       ┌─────┴──────────────┐
       ▼                    ▼
   PostgreSQL             Storage
   (datos)           (product-images)
```

## Componentes

### `index.html`

Contiene la interfaz orientada al cliente. Entre sus operaciones se encuentran la carga del catálogo, carrito, envío de solicitudes personalizadas, registro, inicio y cierre de sesión y restauración de sesión.

### `admin.html`

Contiene el panel de administración. Incluye POS, registro de ventas, tickets PDF, inventario, historial, solicitudes de proyectos, usuarios y configuración.

### Supabase

El código utiliza el SDK de Supabase para autenticación, consultas a PostgreSQL y almacenamiento de imágenes.

## Librerías externas

- Supabase JavaScript SDK 2.
- jsPDF 2.5.1 para generación de documentos PDF.

## Consideraciones de seguridad

El navegador nunca debe utilizar una `service_role key` ni otros secretos administrativos. El control de acceso a datos debe estar implementado mediante autenticación, roles y políticas RLS en Supabase.
