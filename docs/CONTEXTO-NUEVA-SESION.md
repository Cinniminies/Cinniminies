# Cinniminies · Contexto para una sesión nueva

> Resumen de lo hecho hasta el **25/09/2026** (fase 2 en curso) y cómo seguir. Leelo entero antes de tocar nada.
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
| 4. Google Sheet de análisis (solo lectura) | ✅ Cerrada (25/09). Sheet "Cinniminies · Análisis" en el Drive de Lucio, actualización cada hora ([`analisis-apps-script/README.md`](analisis-apps-script/README.md)) |
| 5. Web pública lee el catálogo | ✅ Publicada y aceptada. Fotos de sabores subidas desde /admin (bucket `sabores`) |
| 6. Pedidos de la web a la base | ✅ Publicada y aceptada |
| 7. Panel para editar la web pública | 🔧 Código listo (/admin → Web → Textos e imágenes). **Falta la aceptación:** cambiar un texto y una imagen y verlos en la web |

Todo lo anterior está en `main` y publicado en https://cinniminies.vercel.app/admin/.

---

## 2. Qué hay construido

### Base de datos (Supabase)
- **Proyecto:** `cinniminies`, ref `skysdjfxuykrufawhzvn`, región São Paulo, plan gratis, en la organización *cinniminies*.
  Se pausa tras 7 días sin actividad.
- **Migraciones:** `supabase/migrations/` (16 archivos, todas aplicadas). Cada cambio nuevo = un archivo nuevo
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
- Vercel Functions en Node, CommonJS. `package.json` mínimo (sin build) con `web-push` y `@vercel/functions`, que Vercel
  instala solo; en local, `npm install` con el Node portátil. `api/export/index.js` (lista) y `api/export/[vista].js`.
  Lógica y lista de vistas con sus columnas/tipos en `api/_lib/export.js` (las carpetas con `_` no se publican).
  Pruebas: `node --test api/_tests/*.test.js`.
- Variables en Vercel: `EXPORT_KEY` y `SUPABASE_SERVICE_ROLE_KEY` (la URL tiene default).
- Apps Script del Sheet e instrucciones (instalación, rotar clave) en `docs/analisis-apps-script/`.
- Etapa 5: `GET /api/catalogo` (público, cache de CDN 5 min) llama a `catalogo_web()`; la web (`cinniminies.js`)
  lo usa y, si falla, se queda con lo escrito en `index.html`. Foto de cada sabor en `sabores.foto`.
- Etapa 6: `POST /api/pedidos` → `crear_pedido_web()` (precio con `calcular_venta`, límite por IP, campo trampa).
  /admin → Pedidos web confirma (`confirmar_pedido` → venta) o rechaza. Si la API falla, la web sigue como antes.
  Fase 2 · 2.2: `v_pedidos` trae el cliente sugerido (`cliente_por_telefono`); `confirmar_pedido` acepta
  `cliente_id` (+ `guardar_telefono`) o `cliente: {nombre, …}` para forzar uno nuevo.
- Fase 2 · 2.1, avisos push: `push_suscripciones` + `api/_lib/push.js` (lo llama `api/pedidos.js` después de responder).
  Variables en Vercel: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (en local, `.env.local`). Claves nuevas:
  `node scripts/generar-vapid.js --nuevas` (corta los avisos ya activados). Brave no sirve para probarlo (push de Google apagado).
- Probar funciones de `api/` en local: `node scripts/servidor-dev.js` sirve el sitio y llama a los handlers con
  `.env.local` (no hay `vercel dev`). Interceptar Web3Forms/Sheets en el navegador para no mandar mails reales.
- SEO (fase 2 · 6.1): etiquetas fijas en el `<head>` de `index.html` (no las cambian los textos editables), `img/og.jpg`,
  `robots.txt` y `sitemap.xml`. Las URLs absolutas apuntan a `cinniminies.vercel.app`.
- Etapa 7: `contenido_web` (textos e imágenes de la web) → viaja en `/api/catalogo` → `data-contenido*` en `index.html`.
  Para sumar un lugar editable: fila nueva en `contenido_web` + atributo en `index.html`.

### Migración del histórico (`migracion/`)
- `importar.py` (Python sin dependencias) + `xlsx.py`. Ya se usó; no hace falta volver a correrlo.
  `importar_planilla` se niega a correr si hay datos cargados desde la app.
- `crear_admins.py`: crea usuarios de `/admin` confirmados, sin mandar mail.
- `usuario_prueba.py crear|borrar`: el usuario de prueba fijo para probar /admin en local (ver sección 3).

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
2. Servidor: `node scripts/servidor-dev.js` en segundo plano (desde la raíz del repo, con el Node portátil):
   sirve la web, /admin y `api/` en `http://127.0.0.1:8777/`, como Vercel. No sirve archivos ocultos (`.env.local`, `.git`).
3. **Usuario de prueba (fijo, tarea 8.2):** `prueba-admin@cinniminies.test`, nombre "Prueba", con
   `usuarios_admin.es_prueba = true` (en /admin se ve el aviso "Modo prueba"). Lo creó Lucio con
   `python3 migracion/usuario_prueba.py crear`, que dejó `PRUEBA_ADMIN_EMAIL` y `PRUEBA_ADMIN_PASSWORD` en `.env.local`.
   **Para entrar:** abrir `http://127.0.0.1:8777/dev/entrar-prueba` (solo existe en el servidor local): inicia sesión
   con esos datos y va a /admin, sin que la contraseña pase por el chat. **No borrarlo al terminar.** No usar las
   cuentas de Pia y Lucio. Si la ruta dice que falta, pedirle al usuario que corra
   `! cd <repo> && python3 migracion/usuario_prueba.py crear` (también sirve para cambiarle la contraseña).
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
3. **Lo que sigue está en [`HANDOFF-fase-2.md`](HANDOFF-fase-2.md):** las mejoras elegidas por los dueños, con triage
   y el contexto de cada una. **Hecho:** 8.2 (usuario de prueba), 2.2 (cliente del pedido web) 2.1 (avisos push, aceptada en el iPhone) y 6.1 (SEO y vista previa del link). **Pospuestas por los dueños:** 2.4 (cupos) y 6.6 (reseñas);
   3.1 + 3.2 (plan de horneado) espera un plan con ellos. Las ideas que quedaron para más adelante
   están en [`IDEAS-FUTURAS.md`](IDEAS-FUTURAS.md).
4. Pendientes sueltos que no entraron en la fase 2 (están en `IDEAS-FUTURAS.md`, sección 1): **evitar que Supabase se
   pause** tras 7 días sin actividad (la web usa el catálogo desde la cache de Vercel, así que las visitas no siempre llegan a la base),
   decidir hosting, backups propios, SMTP propio, y la aceptación de la Etapa 2 (carga en paralelo).
5. Seguí el flujo de la sección 3: una rama por tarea, PR directo a `main`, probar con `node scripts/servidor-dev.js`,
   dejar la base como estaba.
