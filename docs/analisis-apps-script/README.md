# Google Sheet "Cinniminies · Análisis"

Planilla **de solo lectura** con los datos de la app, para armar análisis con fórmulas o tablas
dinámicas. Se actualiza sola cada hora (y a mano con el menú). Es independiente de la planilla
de gestión vieja, que no se toca.

```
Supabase ──(service key, en Vercel)──► /api/export/<vista> ──(x-export-key)──► Apps Script ──► datos_<vista>
```

## Qué trae

Una pestaña protegida por vista. **No se editan a mano:** se borran y reescriben en cada
actualización.

| Pestaña | Qué tiene |
|---|---|
| `datos_ventas` | Una fila por venta: cliente, formatos, sabores, precios, envío, costos, ganancia. |
| `datos_ventas_sabores` | Una fila por sabor de cada venta, con el ingreso prorrateado por unidades. |
| `datos_costos` | Costo por tanda y por roll de cada sabor, precio y margen por unidad (precios de hoy). |
| `datos_margenes` | Margen por formato y sabor (precios de hoy). |
| `datos_stock` | Stock teórico por insumo, con el último conteo, alertas y valor. |
| `datos_resumen_mensual` | Vendido, cobrado, costos, compras, gastos, retiros y resultado por mes. |
| `datos_gastos` | Gastos y retiros (`es_gasto` = falso para retiros de socios y ajustes de caja). |
| `datos_compras` | Compras con el insumo y el costo por unidad base. |
| `datos_tandas` | Tandas con el costo estimado a los precios de su fecha. |
| `datos_estado` | Cuándo se actualizó cada pestaña y si hubo algún error. |

Cada columna tiene un **rango con nombre** `<vista>_<columna>`: `ventas_total`,
`ventas_sabores_ingreso`, `resumen_mensual_vendido`, etc. Usalos en las fórmulas en lugar de
`datos_ventas!Q2:Q`, así no se rompen si mañana se agrega una columna:

```
=SUM(ventas_total)
=SUMIFS(ventas_total; ventas_estado_pago; "pendiente")
```

La pestaña **Resumen** (menú → "Crear pestaña Resumen") es un ejemplo con totales, ganancia por
mes, por sabor y top 10 de clientes. Se puede editar libremente; las actualizaciones no la tocan.
Las pestañas de análisis nuevas van aparte, nunca dentro de `datos_*`.

## Instalación (una sola vez)

1. **Clave de export en Vercel.** En el proyecto de Vercel → Settings → Environment Variables,
   para *Production* (y *Preview* si se quiere probar en ramas):
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase → Project Settings → API Keys → `service_role`.
   - `EXPORT_KEY`: una clave larga al azar, por ejemplo la que da
     `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`.

   Después, **Redeploy** del último deploy de `main` para que las tome.
2. **Spreadsheet.** En Drive: Nuevo → Hojas de cálculo → nombre **Cinniminies · Análisis**.
   Archivo → Configuración → Zona horaria: *(GMT-03:00) Montevideo*.
3. **Script.** Extensiones → Apps Script. Reemplazar el contenido de `Código.gs` por
   [`Codigo.gs`](Codigo.gs). En Configuración del proyecto (⚙️) tildar "Mostrar el archivo de
   manifiesto appsscript.json" y pegar [`appsscript.json`](appsscript.json). Guardar.
4. Volver a la planilla y recargarla: aparece el menú **📊 Análisis**.
5. **📊 Análisis → Configurar clave…** y pegar la `EXPORT_KEY`. La primera vez Google pide
   permisos (conectarse a un servicio externo, editar la planilla y crear activadores):
   aceptarlos. La clave queda en las propiedades del script, no en la planilla ni en el código.
6. **📊 Actualizar ahora** → aparecen las pestañas `datos_*`.
7. **Activar actualización cada hora** y **Crear pestaña Resumen**.
8. Compartir la planilla con el otro dueño (como lector o editor: las pestañas `datos_*` las puede
   editar solo quien instaló el script).

## Cómo rotar la clave

Si la clave se filtró o cambia quién tiene acceso:

1. Generar una clave nueva y ponerla en `EXPORT_KEY` en Vercel (reemplaza a la anterior).
2. Redeploy de `main` en Vercel. Desde ese momento la clave vieja ya no sirve.
3. En la planilla: **📊 Análisis → Configurar clave…** y pegar la nueva. El mensaje confirma si
   funciona.

Hasta el paso 3 la actualización automática falla (queda anotado en `datos_estado`) y las
pestañas conservan los datos anteriores.

Si lo que se filtró es la `service_role` de Supabase: rotarla en Supabase (API Keys), actualizar
`SUPABASE_SERVICE_ROLE_KEY` en Vercel y en el `.env.local` de los scripts, y hacer Redeploy.

## El endpoint

`GET https://cinniminies.vercel.app/api/export` → lista de vistas.
`GET https://cinniminies.vercel.app/api/export/<vista>` → JSON
`{ vista, titulo, generado, columnas: [{ nombre, tipo }], filas: [[…]] }`; con `?formato=csv`,
CSV. Siempre con el header `x-export-key`. Código en `api/export/` y `api/_lib/export.js`;
pruebas con `node --test api/_tests/*.test.js`.

Para agregar una vista: crearla en una migración (`security_invoker`, sin permisos para `anon`) y
sumarla a `VISTAS` en `api/_lib/export.js` con sus columnas y tipos. El script la toma solo en la
próxima actualización.

Probar a mano:

```sh
curl -H "x-export-key: $EXPORT_KEY" https://cinniminies.vercel.app/api/export/resumen_mensual?formato=csv
```
