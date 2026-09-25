# Cinniminies · Contexto para una sesión nueva

> Resumen de lo hecho hasta el **25/09/2026** y cómo seguir. Leelo entero antes de tocar nada.
> El plan completo (modelo de datos, reglas de negocio, etapas) está en
> [`HANDOFF-cinniminies-app.md`](HANDOFF-cinniminies-app.md): este archivo no lo reemplaza, lo pone al día.

---

## 1. Dónde estamos

| Etapa | Estado |
|---|---|
| 0. Reconocimiento | ✅ Cerrada |
| 1. Base de datos y migración del histórico | ✅ Cerrada. Conciliación aprobada por los dueños ([`conciliacion-etapa-1.md`](conciliacion-etapa-1.md)) |
| 2. App de carga `/admin` | ✅ Publicada. **Falta la aceptación:** una semana de carga en paralelo con la planilla y que los números coincidan |
| 3. Catálogo editable, stock y "¿Qué compro?" | ✅ Publicada. Aceptación ("Pistacho") probada en Chrome; **falta que la repitan los dueños** |
| Correcciones visuales y rediseño de `/admin` | ✅ Publicados (PR #6, #7, #8, #9) |
| 4. Google Sheet de análisis (solo lectura) | 🔧 Código listo (endpoints `/api/export` + Apps Script). **Falta que los dueños** carguen las variables en Vercel y armen el Sheet ([`analisis-apps-script/README.md`](analisis-apps-script/README.md)) |
| 5. Web pública lee el catálogo | Pendiente |
| 6. Pedidos de la web a la base | Pendiente (la dejaron para el final) |

Todo lo anterior está en `main` y publicado en https://cinniminies.vercel.app/admin/.

---

## 2. Qué hay construido

### Base de datos (Supabase)
- **Proyecto:** `cinniminies`, ref `skysdjfxuykrufawhzvn`, región São Paulo, plan gratis, en la organización *cinniminies*.
  Se pausa tras 7 días sin actividad.
- **Migraciones:** `supabase/migrations/` (12 archivos, todas aplicadas). Cada cambio nuevo = un archivo nuevo
  con timestamp + aplicarlo con el MCP de Supabase (`apply_migration`). No editar migraciones ya aplicadas.
- **Reglas de negocio en Postgres** (la app no calcula nada que se guarde):
  - Costos: `costo_insumo`, `costo_tanda`, `costo_roll`, `costo_caja` (incluye papel manteca y stickers).
  - Precios: `precio_vigente`, `fijar_precio` (historial, nunca pisa).
  - Ventas: `calcular_venta` (resumen en vivo, sin guardar), `registrar_venta`, `actualizar_venta`
    (recalcula solo si cambian los productos; conserva el precio especial), `guardar_lineas`.
  - Resto: `registrar_tanda`, `registrar_compra` (kg/L → unidad base), `fusionar_clientes`,
    `guardar_receta`, `guardar_packaging_caja`, `registrar_conteo` (devuelve el desvío), `que_comprar`.
  - Trigger que impide cambiar la unidad de un insumo ya usado.
  - `importar_planilla` (solo service_role; se usó una vez para el histórico).
- **Vistas de reporte:** `v_ventas`, `v_ventas_sabores`, `v_costo_insumo`, `v_costo_sabor`, `v_margen_formato`,
  `v_stock`, `v_produccion_sabor`, `v_clientes`, `v_resumen_mensual`, `v_panel`, y para el export
  `v_gastos`, `v_compras`, `v_tandas` (todas `security_invoker`).
- **Seguridad:** RLS en todas las tablas; solo los usuarios de `usuarios_admin` (Pia y Lucio) leen y escriben.
  `anon` no tiene permisos. Registro público desactivado.
- **Pruebas:** `supabase/tests/reglas.sql`, varios bloques `do $$ … $$` que terminan con `raise exception 'TODO OK'`
  (se deshacen solos). Correr **un bloque por vez** con `execute_sql`.

### App `/admin` (en este mismo repo, carpeta `admin/`)
- Estática, sin build: HTML + módulos ES + `supabase-js` desde jsDelivr. Vercel la sirve tal cual.
  Detalle en [`admin/README.md`](../admin/README.md).
- Navegación: pestañas **Inicio · Ventas · + Venta · Producción · Más** (menú lateral en ≥ 900 px).
  Producción = Tandas / Stock / Compras / ¿Qué compro?. Más = Clientes, Gastos, Catálogo, Cuenta.
  Botón ← en subpantallas.
- Inicio con gráficos propios (`admin/js/graficos.js`, sin librerías; colores validados con la guía de dataviz).
- Login: link por mail (sin SMTP propio la plantilla no se puede editar y no trae código) o contraseña.
  En iPhone: la primera vez link en Safari → poner contraseña en Más → Contraseña → entrar con ella en la app instalada.
  Flujo de auth `implicit` a propósito (PKCE falla si el link se abre en otro navegador).
- Clave `sb_publishable_…` en `admin/js/config.js`: es pública por diseño.

### Export para el Sheet de análisis (`api/`, Etapa 4)
- Vercel Functions en Node, CommonJS, sin `package.json`: `api/export/index.js` (lista) y `api/export/[vista].js`.
  Lógica y lista de vistas con sus columnas/tipos en `api/_lib/export.js` (las carpetas con `_` no se publican).
  Pruebas: `node --test api/_tests/*.test.js`.
- Variables en Vercel: `EXPORT_KEY` y `SUPABASE_SERVICE_ROLE_KEY` (la URL tiene default).
- Apps Script del Sheet e instrucciones (instalación, rotar clave) en `docs/analisis-apps-script/`.

### Migración del histórico (`migracion/`)
- `importar.py` (Python sin dependencias) + `xlsx.py`. Ya se usó; no hace falta volver a correrlo.
  `importar_planilla` se niega a correr si hay datos cargados desde la app.
- `crear_admins.py`: crea usuarios de `/admin` confirmados, sin mandar mail.

---

## 3. Cómo trabajar (lo que aprendimos)

1. **Ramas y PR:** rama nueva desde `main` actualizado → commit → push → **PR directo contra `main`**.
   Nunca encadenar PR (uno con base en la rama de otro): así fue como el rediseño quedó afuera de `main` (#8 → #9).
   Vercel publica `main`. No commitear directo en `main`.
2. **Commits:** mensajes en castellano, terminan con la línea `Co-Authored-By` que indique el sistema.
3. **Idioma:** todo en español rioplatense (vos): código, comentarios, UI y documentación.
4. **Antes de cambiar la base:** mirar las tablas y migraciones existentes; después, `get_advisors` (security).
   El único aviso esperado es "Leaked password protection" (es de un plan pago).
5. **Nada de datos reales al repo:** `migracion/datos/` (el `.xlsx`), `migracion/emails.txt` y `.env.local`
   están en `.gitignore`. Los emails de los dueños **no** van en archivos commiteados.
6. **Secretos:** la `service_role` key está en `.env.local` (la cargó el usuario). Leerla con los scripts
   (`cargar_env()` de `migracion/importar.py`), nunca imprimirla.

### Probar la app en local (receta que funcionó)
1. En esta compu **no hay Node ni pip**. Para revisar JS: bajar Node portátil al scratchpad
   (`curl https://nodejs.org/dist/v22.20.0/node-v22.20.0-linux-x64.tar.xz` + `tar -xf`) y usar
   `node --check --input-type=module < archivo.js` y `node --test admin/tests/*.test.mjs`.
2. Servidor: `python3 -m http.server 8777 --bind 127.0.0.1` en segundo plano (desde la raíz del repo).
   Para apagarlo **no** usar `pkill -f "http.server 8777"` en el mismo comando que otra cosa (mata esa misma shell):
   `ps aux | grep "[h]ttp.server 8777" | awk '{print $2}' | xargs -r kill`.
3. **Usuario temporal:** crear `prueba-admin@cinniminies.test` con contraseña aleatoria vía Auth Admin API
   (con la service key) + fila en `usuarios_admin`; **borrarlo al terminar**. No usar las cuentas de Pia y Lucio.
4. **Ancho de celular:** la ventana de Chrome no se achica; usar una página temporal `admin/_prueba.html` con un
   `<iframe>` de 390 px (y un `<style>` inyectado para forzar el modo claro). Borrarla al terminar.
5. **Caché:** Chrome guarda los módulos viejos. Antes de probar, `fetch(archivo, { cache: 'reload' })` de todos
   los `.js` y el `.css`, y recargar. (En Vercel no pasa: revalida.)
6. **No disparar `confirm()`** desde la automatización (bloquea el navegador): reemplazar `window.confirm = () => true`.
7. **Datos de prueba en la base real:** marcarlos (notas "PRUEBA…") y borrarlos al final; verificar que
   queden **108 ventas importadas y $31.880 vendidos** (más lo que hayan cargado los dueños desde la app).
   El cliente "prueba" (sin ventas) lo crearon los dueños; no borrarlo sin preguntar.

---

## 4. Pendientes y decisiones abiertas

- **Etapa 2, aceptación:** semana de carga en paralelo. Diferencia esperada: en la app el costo de caja incluye
  papel y sticker (Box de 6 $38,65; Box de 12 $45,63) y en la planilla no.
- **Etapa 3, aceptación:** que los dueños repitan lo de "Pistacho" y después lo desactiven o borren.
- **Hosting:** Vercel Hobby es para uso no comercial; decidir Pro o mover a Netlify/Cloudflare antes del uso
  "en serio" (handoff 3.1). Mantener `api/` simple para poder portarlo.
- **Mails:** el SMTP por defecto de Supabase solo manda a miembros de la organización; si a Pia no le llega el
  link, sumarla a la organización o configurar SMTP propio (Gmail con contraseña de aplicación).
- **Sin respuesta de los dueños:** "Cobramos menos de una box de 6" quedó como `comision` (así estaba en la planilla).

---

## 5. Instrucciones para la sesión nueva

1. Leé este archivo y el handoff completo. Revisá `git log` y `gh pr list` para ver si hubo cambios después del 25/09.
2. Conectá el MCP de Supabase y confirmá acceso a `skysdjfxuykrufawhzvn` (`list_tables`, `list_migrations`).
3. Corregi el UI del panel, poniendo mas opciones laterales y sacando algunas de la pagina "MAS"
4. **Arrancá la Etapa 4** (handoff, sección 7):
   - Endpoints `GET /api/export/<vista>` como Vercel Functions en Node (`api/export/[vista].js`), autenticados con
     el header `x-export-key` contra una variable de entorno, leyendo con la service key del lado del servidor.
     Vistas: `ventas`, `ventas_sabores`, `costos`, `stock`, `resumen_mensual`, `gastos`, `compras`, `tandas`.
   - Spreadsheet nuevo "Cinniminies · Análisis" con Apps Script propio: `actualizarTodo()` con `UrlFetchApp`
     (clave en `PropertiesService`, nunca en el código), una pestaña `datos_<vista>` protegida por vista,
     activador cada hora, menú "📊 Actualizar ahora" y una pestaña "Resumen" de ejemplo.
   - Las variables de entorno de Vercel (`SUPABASE_SERVICE_ROLE_KEY`, `EXPORT_KEY`) las cargan los dueños en el
     dashboard de Vercel; no pedirlas por chat.
   - Aceptación: los totales del Sheet coinciden con el panel de la app.
5. Seguí el flujo de la sección 3: una rama por tarea, PR directo a `main`, probar en Chrome con usuario temporal,
   dejar la base como estaba.
