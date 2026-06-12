# Plantilla de cotización

Coloca tu archivo `cotizacion.docx` en esta carpeta.

## Variables disponibles en la plantilla

Usa estas etiquetas exactas dentro de tu documento Word:

| Etiqueta            | Contenido                          |
|---------------------|------------------------------------|
| `{folio}`           | ID corto del pedido (ej: A1B2C3D4) |
| `{fecha}`           | Fecha de creación (ej: 08 de junio de 2026) |
| `{fecha_entrega}`   | Fecha de entrega                   |
| `{cliente_empresa}` | Nombre de la empresa               |
| `{cliente_dir}`     | Dirección del cliente              |
| `{cliente_tel}`     | Teléfono                           |
| `{cliente_email}`   | Email                              |
| `{notas}`           | Notas adicionales                  |
| `{total}`           | Total ($X,XXX.00)                  |
| `{anticipo}`        | Anticipo acordado                  |
| `{saldo}`           | Saldo restante (total - anticipo)  |

## Tabla de items (filas repetidas)

Para la tabla de uniformes, usa estas etiquetas en la fila que se repite:

```
{#items}   ← esta línea va ANTES de la fila de datos
{tipo_uniforme}  {cantidad}  {precio_unitario}  {subtotal}
{/items}   ← esta línea va DESPUÉS de la fila de datos
```

En Word, `{#items}` y `{/items}` van en celdas separadas o en párrafos
fuera de la tabla, y la fila con los campos va en medio.
