# Migración de la planilla a Supabase

Scripts para pasar el histórico de `cinniminies_gestion` a la base. Solo usan Python 3 (biblioteca
estándar): no hace falta instalar nada.

| Archivo | Qué hace |
|---|---|
| `xlsx.py` | Lector mínimo de `.xlsx`. Busca hojas y columnas por nombre normalizado. |
| `importar.py` | Lee el `.xlsx`, aplica las reglas de la Etapa 1, muestra la conciliación y (con `--aplicar`) carga todo. |
| `crear_admins.py` | Invita por mail a los usuarios de `/admin` y los agrega a `usuarios_admin`. |
| `datos/` | El `.xlsx` exportado. **No se commitea** (tiene teléfonos e Instagram de clientes). |

## Pasos

1. Descargar la planilla: en Google Sheets, *Archivo → Descargar → Microsoft Excel (.xlsx)*, y
   guardarla en `migracion/datos/`.
2. Crear `.env.local` en la raíz del repo a partir de `.env.example`, con la `service_role` key
   (Supabase → Project Settings → API Keys). **No se commitea.**
3. Probar sin cargar nada y revisar los avisos y la tabla de conciliación:

   ```sh
   python3 migracion/importar.py migracion/datos/cinniminies_gestion_AAAA-MM-DD.xlsx
   ```

4. Cargar:

   ```sh
   python3 migracion/importar.py migracion/datos/cinniminies_gestion_AAAA-MM-DD.xlsx --aplicar
   ```

   Se puede repetir las veces que haga falta: borra lo importado antes y lo vuelve a cargar, en
   una sola transacción. Si ya hay ventas, compras, etc. cargadas desde la app, se niega a correr.

5. Admins (una vez):

   ```sh
   python3 migracion/crear_admins.py "Pia=<email de Pia>" "Lucio=<email de Lucio>"
   ```

## Conteo de stock inicial

La hoja STOCK se carga como un conteo con fecha y hora del **momento del export** (la fecha de
modificación del `.xlsx`, o `--fecha-conteo AAAA-MM-DDTHH:MM`). El stock teórico cuenta solo los
movimientos posteriores a ese momento, así que exportá la planilla justo antes de importar.

La conciliación y las decisiones de la migración están en `docs/conciliacion-etapa-1.md`.
