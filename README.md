# HEPSA — Sistema de Gestión

Sistema web para **HEPSA (Herrería Fina, Ingeniería y Prefabricados)**, orientado a centralizar la operación de catálogo, solicitudes de proyectos a medida, ventas e inventario.

## 📌 Descripción

HEPSA integra un portal público para clientes y un panel administrativo para empleados. El sistema permite consultar productos, agregarlos al carrito, enviar solicitudes de proyectos personalizados y gestionar operaciones desde un punto de venta (POS).

La información se gestiona mediante **Supabase**, utilizando PostgreSQL, autenticación, almacenamiento de imágenes y consultas desde el cliente web.

## ✨ Funcionalidades

### Portal público

- Catálogo de productos activos.
- Carrito de compra.
- Solicitudes de proyectos a medida.
- Registro e inicio de sesión de usuarios.
- Consulta del perfil del cliente.
- Historial asociado al usuario.
- Cambio entre tema claro y oscuro.

### Panel administrativo / ERP

- Autenticación y validación de acceso.
- Punto de Venta (POS).
- Registro de ventas.
- Cálculo de subtotal, IVA y total.
- Selección de forma de pago.
- Generación e impresión de tickets PDF.
- Historial de ventas.
- Alta y edición de productos.
- Control de stock.
- Activación/desactivación de productos.
- Eliminación de productos.
- Gestión de solicitudes de proyectos.
- Gestión de usuarios y perfiles.
- Configuración de IVA y mensaje del ticket.

## 🏗️ Arquitectura actual

```text
┌───────────────────────────────┐
│       Portal público          │
│          index.html           │
│                               │
│ Catálogo · Carrito · Cotizador│
│ Registro · Inicio de sesión   │
└───────────────┬───────────────┘
                │
                │ Supabase JS SDK
                ▼
┌───────────────────────────────┐
│           Supabase            │
│                               │
│ PostgreSQL · Auth · Storage   │
└───────────────────────────────┘
                ▲
                │ Supabase JS SDK
┌───────────────┴───────────────┐
│       Panel administrativo    │
│           admin.html          │
│                               │
│ POS · Inventario · Ventas     │
│ Proyectos · Usuarios · Config.│
└───────────────────────────────┘
```

## 🗄️ Entidades utilizadas

El código actual interactúa con las siguientes tablas/recursos de Supabase:

- `products`
- `custom_requests`
- `orders`
- `order_items`
- `profiles`
- Storage bucket: `product-images`

## 🛠️ Tecnologías

- HTML5
- CSS3
- JavaScript
- Supabase
- PostgreSQL (a través de Supabase)
- Supabase Auth
- Supabase Storage
- jsPDF 2.5.1

Las dependencias del frontend se cargan mediante CDN, por lo que el proyecto no requiere `npm install` para ejecutarse en su estado actual.

## ▶️ Ejecución local

Como el proyecto utiliza archivos HTML estáticos, puede abrirse directamente en un navegador. Para una experiencia más consistente, se recomienda utilizar un servidor local.

### VS Code + Live Server

1. Abrir la carpeta del proyecto en VS Code.
2. Instalar la extensión **Live Server** si no está disponible.
3. Abrir `index.html` con Live Server.
4. Para el panel administrativo, abrir `admin.html`.

### Python

```bash
python -m http.server 8000
```

Después abrir `http://localhost:8000/`.

## 🔐 Configuración de Supabase

El proyecto actual utiliza Supabase desde el navegador. Antes de desplegar una versión pública, el equipo debe revisar las políticas **RLS (Row Level Security)**, permisos de Storage y reglas de autenticación del proyecto de Supabase.

> **Importante:** nunca deben agregarse al repositorio claves privadas, `service_role keys`, contraseñas, tokens administrativos ni secretos de servidor.

La clave utilizada actualmente por el frontend es una clave publicable (`publishable`). Aun así, la seguridad real debe depender de las políticas RLS y de los permisos configurados en Supabase.

## 📁 Estructura

```text
HEPSA/
├── index.html
├── admin.html
├── imagen.jpg
├── docs/
├── .vscode/
├── .gitignore
├── LICENSE
└── README.md
```

## 📚 Documentación

- [Arquitectura del sistema](docs/architecture.md)
- [Requerimientos y módulos](docs/requirements.md)
- [Guía rápida para el equipo](docs/team-guide.md)

## 🚀 Roadmap

- [ ] Separar HTML, CSS y JavaScript en módulos independientes.
- [ ] Centralizar la configuración de Supabase.
- [ ] Mejorar la validación de roles y permisos.
- [ ] Revisar y optimizar consultas a Supabase.
- [ ] Fortalecer las políticas RLS.
- [ ] Integrar una pasarela de pagos.
- [ ] Implementar 2FA para cuentas de empleados.
- [ ] Añadir pruebas automatizadas.
- [ ] Preparar despliegue de producción.

## 👥 Equipo

Proyecto desarrollado por el equipo de **HEPSA**.

## 📄 Licencia

Este proyecto se distribuye bajo la licencia MIT. Consulta [LICENSE](LICENSE) para más información.
