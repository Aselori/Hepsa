# Corrección del catálogo, 2026-10-09

Se corrigieron en el proyecto hospedado los nombres y descripciones de los
seis productos: había nombres repetidos, faltas de ortografía y medidas
escritas de cinco maneras distintas. Precios, existencias y visibilidad no
cambiaron. Las ventas pasadas guardan su propia copia del nombre, así que su
historial quedó igual.

La actualización solo tocaba una fila si seguía teniendo exactamente el valor
anterior (comparando su md5), para no pisar un cambio hecho desde el panel.

## Convenciones

- **Nombre**: mayúscula inicial y el rasgo que lo distingue de los parecidos.
  Una puerta de dos paneles es "de dos hojas".
- **Medidas**: `2.50 × 1.70 m` (signo ×, `m` minúscula, dos decimales), en el
  mismo orden en que venían, porque no se sabe cuál es el ancho y cuál el alto.
- **Descripción**: oraciones completas con acentos; las fichas por renglones
  se conservan.

## Antes y después

| ID | Nombre anterior | Nombre nuevo |
|---|---|---|
| 3 | Puerta Principal dos puertas | Puerta principal de dos hojas |
| 4 | Puerta Principal | Puerta principal gris |
| 5 | Porton Residencial para cochera | Portón residencial para cochera |
| 6 | Puerta principal | Puerta principal reforzada |
| 7 | Puerta de madera de abeto | Puerta de madera de abeto de 2.50 × 1.70 m |
| 8 | Puerta de madera de abeto | Puerta de madera de abeto de 2.40 × 1.50 m |

Descripciones anteriores, para revertir si hiciera falta:

| ID | Descripción anterior |
|---|---|
| 3 | `Altura: 2.1 m` / `Ancho: 1.3 m` / `Tipo de apertura: Derecha` / `Material: Acero` / `Espesor: 4 cm` / `Acabado: Barnizado` / `Es apta para interiores.` / `Es apta para exteriores.` (un renglón cada una) |
| 4 | `color: gris medidas: 5 * 2` |
| 5 | `Porton residencial con doble puerta para mejor ingreso de vehiculos, ideal para su cochera, el precio base incluye una medida estandar para cochera de un solo vehiculo 3.00 M * 2.40 M` |
| 6 | `Puerta reforzada para entrada principal, color negro/chocolate 5*2 M` |
| 7 | `Puerta de 2.5x1.7` |
| 8 | `2.4m x 1.5m` |

## Pendiente de confirmar con el negocio

No se cambiaron porque son datos, no ortografía:

1. **Precios de las puertas de abeto**: la más chica (2.40 × 1.50 m) cuesta
   $20,000 y la más grande (2.50 × 1.70 m) $14,000. ¿Es otro acabado o un
   error de captura?
2. **Medida 5 × 2 m** en las puertas 4 y 6: es muy grande para una puerta
   principal. ¿Es correcta, o es otra unidad u otro orden?
3. **"Negro/chocolate"** en la puerta 6: ¿dos colores a elegir o un acabado de
   dos tonos?
4. **Acero barnizado** en la puerta 3: poco común; confirmar el acabado.
