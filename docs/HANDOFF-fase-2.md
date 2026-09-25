# Cinniminies · Handoff fase 2 (mejoras elegidas por los dueños)

> Escrito el 25/09/2026. Son las ideas que eligieron los dueños de `IDEAS-FUTURAS.md` (en `QUIERO-APLICAR.md`),
> ordenadas por prioridad y con el contexto para implementarlas sin tener que redescubrir el proyecto.
> Las etapas 0 a 7 del plan original están terminadas y en `main`.

---

## 0. Antes de empezar (leer sí o sí)

1. **Contexto general:** [`CONTEXTO-NUEVA-SESION.md`](CONTEXTO-NUEVA-SESION.md) (qué hay construido, cómo se trabaja, cómo
   se prueba) y, para el modelo de datos y las reglas de negocio, [`HANDOFF-cinniminies-app.md`](HANDOFF-cinniminies-app.md)
   (secciones 4 y 5). Revisar `git log` y `gh pr list` por si hubo cambios después del 25/09.
2. **Arquitectura en una línea:** Supabase (Postgres + Auth + Storage, ref `skysdjfxuykrufawhzvn`) con toda la lógica de
   negocio en funciones SQL · `/admin` (HTML + módulos ES, sin build) · web pública (`index.html` + `cinniminies.js`) ·
   funciones de Vercel en `api/` (Node, CommonJS, **sin `package.json` todavía**) · Sheet de análisis con Apps Script.
3. **Reglas de trabajo** (sección 3 del contexto):
   - Una rama por tarea desde `main` actualizado y **PR directo contra `main`** (nunca encadenar PRs). Vercel publica `main`.
   - Todo en español rioplatense: código, comentarios, UI, commits y docs.
   - Cambios de base: migración nueva en `supabase/migrations/` con timestamp, aplicada con `apply_migration` del MCP de
     Supabase; después `get_advisors` (security y performance). El único aviso esperado es "Leaked password protection".
   - Reglas nuevas → bloque de prueba en `supabase/tests/reglas.sql` (`do $$ … raise exception 'TODO OK'; end $$;`, se
     deshace solo). Correr cada bloque con `execute_sql`.
   - API → pruebas en `api/_tests/*.test.js` (`node --test api/_tests/*.test.js`). Front de /admin → `admin/tests/`.
   - Nada de datos reales ni secretos al repo. La service key está en `.env.local` (no imprimirla).
4. **Probar en local:** en esta compu no hay Node ni pip instalados. Bajar Node portátil al scratchpad
   (`curl -O https://nodejs.org/dist/v22.20.0/node-v22.20.0-linux-x64.tar.xz && tar -xf …`) y correr
   **`node scripts/servidor-dev.js`**: sirve la web, /admin y las funciones de `api/` con `.env.local`, como Vercel.
   Usa la **base real**: marcar datos de prueba ("PRUEBA…") y borrarlos al final. En el navegador, interceptar
   `fetch` a Web3Forms para no mandar mails reales a los dueños.
5. **Usuario de prueba (8.2, hecho):** con el servidor local andando, abrir `http://127.0.0.1:8777/dev/entrar-prueba`
   entra a /admin como "Prueba" (aviso "Modo prueba"). Detalle en `CONTEXTO-NUEVA-SESION.md`, sección 3.

---

## 1. Triage

| Prioridad | Tarea | Esfuerzo | Depende de |
|---|---|---|---|
| ✅ Hecho (PR #24) | **8.2** Usuario de prueba para /admin | S | Que los dueños corran un comando |
| 🟠 **Alta** | **2.2** Cliente existente o nuevo al confirmar un pedido web | S | 8.2 (para probar) |
| 🟠 **Alta** | **2.1** Aviso push de pedido nuevo en el celular | M | 8.2 · decisión sobre `package.json` |
| ⏸️ Pospuesta por los dueños (25/09) | **2.4** Cupos por día de horneado | L | 8.2 · decisiones de los dueños (ver tarea) |
| 🟡 **Media** | **3.1 + 3.2** Plan de horneado y "¿Qué compro?" según los pedidos | M | **2.4** (usa la fecha de entrega de cada pedido) |
| 🟡 **Media** | **6.1** SEO y vista previa al compartir el link | S | Una imagen 1200×630 |
| 🟢 **Baja** | **6.5** Más lugares editables de la web | S | — |
| ⏸️ Pospuesta por los dueños (25/09) | **6.6** Reseñas de clientes | M | Decisión: solo cargadas por los dueños o también formulario público |

Orden sugerido: 8.2 → 2.2 → 2.1 → 2.4 → 3.1+3.2 → 6.1 → 6.5 → 6.6. Cada tarea es un PR aparte.

**Decisiones de los dueños (25/09):** 8.2 con `es_prueba` y aviso "Modo prueba" · 2.1 con `package.json` y `web-push`,
`VAPID_SUBJECT` = el mailto: de Lucio (va solo en Vercel, no en el repo) · 2.4 y 6.6 quedan para otra sesión · 6.1: la imagen la arma la sesión
desde la foto de portada; en los datos del negocio, solo "Paysandú, Uruguay" y el teléfono que ya está en la web ·
6.5: solo los textos de `index.html`, no los que arma `cinniminies.js`.

---

## 2. Tareas

### ✅ 8.2 · Usuario de prueba para /admin (PR #24)

**Hecho así:** `migracion/usuario_prueba.py crear|borrar` (lo corrió Lucio), columna `usuarios_admin.es_prueba`
(migración `20261003100000_usuario_prueba.sql`), aviso "Modo prueba" en la barra de /admin, y en `scripts/servidor-dev.js`
la ruta local `/dev/entrar-prueba`, que inicia sesión con los datos de `.env.local` sin mostrarlos. De paso, el
servidor local ya no sirve archivos ocultos (antes `/.env.local` se podía pedir desde el navegador).

**Problema.** Para probar /admin hace falta una sesión de administrador. Las sesiones anteriores intentaron crear un
usuario temporal con la Admin API (service key) y el modo automático lo bloqueó. Entonces no se probaron las
pantallas logueado (Pedidos web, Web → Textos e imágenes, fotos de sabores, eliminar sabor…).

**Solución propuesta.** Un usuario de prueba **fijo**, creado **por los dueños** una sola vez, con sus datos en `.env.local`:
- Script nuevo `migracion/usuario_prueba.py` (Python sin dependencias, mismo estilo que `crear_admins.py`, usa `cargar_env()`
  de `migracion/importar.py`):
  - `crear`: crea `prueba-admin@cinniminies.test` (confirmado, contraseña aleatoria), lo agrega a `usuarios_admin` con
    nombre "Prueba" y **escribe** `PRUEBA_ADMIN_EMAIL` y `PRUEBA_ADMIN_PASSWORD` en `.env.local` (sin imprimirlos).
  - `borrar`: saca la fila de `usuarios_admin` y borra el usuario.
- Los dueños lo corren con `! python3 migracion/usuario_prueba.py crear` (el `!` lo ejecuta en la sesión, con su permiso).
- Las sesiones entran a /admin **en local** (`http://127.0.0.1:8777/admin/`) con esos datos leídos de `.env.local`. Las
  reglas del asistente permiten usar credenciales de prueba en la app propia en `localhost` si salen de archivos de
  configuración del proyecto.
- Opcional, recomendado: columna `usuarios_admin.es_prueba boolean default false` para distinguirlo (y, si se quiere, un
  aviso "Modo prueba" en la barra de /admin cuando entra ese usuario).
- Documentar la receta en `CONTEXTO-NUEVA-SESION.md` (sección 3, "Probar la app en local").

**Aceptación.** Una sesión nueva entra a /admin en local con el usuario de prueba sin pedir nada por chat, y puede
recorrer Pedidos web y Web → Textos e imágenes.

**Ojo.** El usuario es admin de la base **real**: todo lo que cargue queda en los números. Mantener la regla de marcar
"PRUEBA…" y borrar al final, y verificar que queden los totales esperados.

---

### 🟠 2.2 · Cliente existente o nuevo al confirmar un pedido web

**Hoy.** `confirmar_pedido(p_pedido, p)` (migración `20260930100000_pedidos_web.sql`) busca el cliente por los **últimos 8
dígitos** del contacto (`right(regexp_replace(contacto, '\D', '', 'g'), 8) = right(ped.telefono, 8)`) y, si no lo encuentra,
crea uno con origen "Web". La pantalla `admin/js/vistas/pedidos.js` no muestra cuál va a usar. Hoy hay 65 clientes y solo
41 tienen celular cargado, así que puede duplicar.

**Qué hacer.**
- Base: sacar la búsqueda a una función reutilizable, `cliente_por_telefono(p_tel text) returns uuid`, y usarla en
  `confirmar_pedido`. Agregar a `confirmar_pedido` un parámetro opcional `p->>'cliente_id'`, que si viene manda sobre la
  búsqueda. Una vista `v_pedidos` (security_invoker) con `cliente_sugerido_id`, `cliente_sugerido` y `compras_cliente` para
  que /admin lo lea en una consulta.
- /admin → Pedidos web, en cada pedido nuevo:
  - Si hay coincidencia: "Cliente: **Ana Tello** · 8 compras" (link a la ficha) y un botón "Es otro cliente".
  - Si no: "**Cliente nuevo**: se va a crear «nombre del pedido»" y un botón "Elegir de la libreta".
  - Para elegir usar el componente `elegirCliente` de `admin/js/componentes.js` (el mismo de Nueva venta).
  - Al confirmar, mandar `cliente_id` si se eligió a mano.
- Si se elige un cliente sin celular, ofrecer guardarle el teléfono del pedido. Así la próxima vez se asocia solo.

**Aceptación.** Un pedido de un teléfono conocido muestra el cliente antes de confirmar. Uno desconocido permite elegir
un cliente existente y la venta queda a su nombre, sin crear otro.

**Pruebas.** Bloque SQL: confirmar con `cliente_id` explícito usa ese cliente y no crea uno nuevo.

---

### 🟠 2.1 · Aviso push de pedido nuevo en el celular

**Hoy.** Un pedido nuevo llega por mail (Web3Forms, desde el navegador del cliente) y aparece en /admin → Pedidos web y en
Inicio → "Para hacer". No hay aviso en el celular.

**Qué hacer (Web Push estándar).**
- **Claves VAPID:** generarlas una vez. La pública va en el front (`admin/js/config.js`); la privada en Vercel como
  `VAPID_PRIVATE_KEY` (la cargan los dueños, no pedirla por chat), junto con `VAPID_PUBLIC_KEY` y `VAPID_SUBJECT`
  (`mailto:` de contacto).
- **Base:** tabla `push_suscripciones` (id, user_id → auth.users, endpoint unique, p256dh, auth, creado_en, ultimo_error)
  con RLS: cada admin ve y borra las suyas. Insert desde /admin.
- **/admin:**
  - En Más → Cuenta, un interruptor "Avisarme de pedidos nuevos". Pide permiso con `Notification.requestPermission()`
    desde un toque (iOS lo exige) y hace `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`.
    Guarda la suscripción.
  - `admin/sw.js` hoy es mínimo (install/activate). Sumar `push`, que muestra la notificación "Pedido nuevo · Ana · $450",
    y `notificationclick`, que abre `/admin/#/pedidos`.
  - **iPhone:** funciona solo con la app **agregada a la pantalla de inicio** (iOS 16.4+). `admin/manifest.webmanifest` ya
    tiene `display: standalone`. En Safari común mostrar la ayuda "Instalá la app para recibir avisos".
- **Envío:** en `api/pedidos.js`, después de guardar el pedido, mandar el push a todas las suscripciones sin bloquear la
  respuesta al cliente. Si un endpoint responde 404/410, borrarlo.
  - Cifrar Web Push a mano es delicado. **Recomendado:** sumar un `package.json` mínimo con la dependencia `web-push` (sin
    `"type": "module"`, para no romper los `require`). Vercel la instala sola. Confirmarlo con los dueños antes: hasta
    ahora el repo es "sin build", y esto agrega instalación de dependencias en el deploy (no un build).
  - Alternativa sin dependencias: una Edge Function de Supabase disparada por un webhook de la tabla `pedidos`. Es más
    piezas; no la recomiendo.

**Aceptación.** Con la app instalada en el iPhone y los avisos activados, un pedido hecho desde la web muestra una
notificación en segundos, y al tocarla abre Pedidos web.

**Pruebas.** Unitarias del envío con `fetch`/`web-push` simulado (incluido el borrado ante 410). Manual: un pedido de
prueba desde la web en producción, que después se rechaza o borra.

---

### 🟠 2.4 · Cupos por día de horneado

**Objetivo.** La web muestra "Próximo horneado: sábado 4/10 · quedan N" y el cliente elige para qué día es su pedido. Si
un día se llena o cerró la toma de pedidos, no se puede elegir. Hoy la web dice "coordinamos el retiro el sábado" y no
hay ningún límite.

**Decisiones a confirmar con los dueños antes de construir:**
1. ¿El cupo se cuenta en **rolls** o en **cajas**? (Recomendado: rolls, porque las cajas personalizadas varían de 3 a 12.
   La web lo puede mostrar como "quedan ~N cajas de 6".)
2. ¿Hasta cuándo se toman pedidos para un día? (Por ejemplo, el viernes a las 20:00.)
3. ¿Días fijos? (Por ejemplo, todos los sábados con un cupo por defecto, y la opción de cerrar o cambiar uno puntual.)

**Qué hacer.**
- **Base:**
  - Tabla `horneadas` (fecha date pk, cupo_rolls int, cierre timestamptz, abierta boolean default true, notas).
  - Parámetros en `parametros`: `cupo_rolls_defecto`, `dia_horneado` (6 = sábado), `cierre_dia_anterior_hora` ("20:00").
  - Función `asegurar_horneadas(p_semanas int default 4)` que crea las próximas fechas con los valores por defecto, si no
    existen. Se llama desde /admin y desde `catalogo_web()`, o lo hace un cron.
  - `pedidos.fecha_entrega date references horneadas`.
  - `crear_pedido_web`: exigir `fecha_entrega` si hay horneadas abiertas. Validar que la fecha esté abierta y antes del
    cierre, y que `rolls ya pedidos (nuevo + confirmado) + rolls de este pedido ≤ cupo_rolls`, con **`select … for update`
    sobre la fila de `horneadas`** para que dos pedidos simultáneos no se pasen del cupo.
  - Mensajes claros: "Ese sábado se llenó, elegí otro día".
  - `catalogo_web()`: agregar `horneadas: [{ fecha, quedan_rolls, cierre }]` con las próximas abiertas y con lugar.
    Ojo: `/api/catalogo` tiene cache de 5 minutos, así que "quedan N" puede estar un poco atrasado. La validación real la
    hace `crear_pedido_web`.
  - `confirmar_pedido`: la venta con `fecha = fecha_entrega` (o hoy si no tiene). Confirmarlo con los dueños.
  - **Compatibilidad:** si no hay horneadas cargadas, todo funciona como hoy (sin elegir fecha).
- **Web** (`cinniminies.js` + `index.html`):
  - Aviso arriba del menú con el próximo horneado y lugar disponible.
  - En "Tus datos", un selector de día (chips con las fechas y "quedan N").
  - Mandar `fecha_entrega` en `/api/pedidos`.
  - Si la API rechaza por cupo, mostrar el mensaje y dejar elegir otro día. Hoy el checkout ignora los errores de la API
    y sigue con un código local: **para este error puntual (HTTP 409) hay que frenar y avisar**, no seguir.
  - Respaldo si falla el catálogo: sin selector, como hoy.
- **/admin:** pantalla "Horneadas" (en Producción o en Negocio): próximas fechas con ocupación (barra rolls pedidos/cupo),
  cambiar cupo o cierre, cerrar un día, agregar uno fuera de lo común. En Pedidos web, mostrar y filtrar por fecha de
  entrega.
- **API:** `api/pedidos.js` mapea el error de cupo a **409**. Actualizar `api/_tests/pedidos.test.js`.

**Aceptación.** Con un cupo de 12 rolls, dos pedidos de 6 llenan el sábado. El tercero, aunque sea simultáneo, se
rechaza con el mensaje y la web ofrece el sábado siguiente. /admin muestra 12/12.

**Pruebas.** Bloque SQL con cupo, cierre, fecha cerrada, compatibilidad sin horneadas y confirmar con fecha de entrega.

---

### 🟡 3.1 + 3.2 · Plan de horneado y "¿Qué compro?" según los pedidos

**Hoy.** Producción → "¿Qué compro?" (`admin/js/vistas/comprar.js`) le pide al usuario cuántas tandas de cada sabor va
a hacer y llama a `que_comprar(p jsonb)` (migración `20260926100000_catalogo_y_stock.sql`). `p` es
`{ "<sabor_id>": tandas }`, y devuelve por insumo lo necesario, el stock teórico (`v_stock`), el faltante y cuántos
paquetes comprar (redondeando a la presentación de la última compra). No mira los pedidos.

**Qué hacer.**
- **Base:** función `plan_horneado(p_fecha date, p_extra jsonb default '{}')` que devuelve por sabor:
  - rolls pedidos para esa fecha (pedidos `nuevo` + `confirmado` con `fecha_entrega = p_fecha`, sumando
    `pedido_cajas.sabores`);
  - rolls extra que quieren tener para venta directa (`p_extra = { "<sabor_id>": rolls }`);
  - total y **tandas = ceil(total / rolls_por_tanda)**, y los rolls que sobran.
  - Sin la tarea 2.4, usar como respaldo los pedidos `nuevo` + `confirmado` de los últimos 7 días sin venta entregada. Es
    mejor hacer 2.4 antes.
- 3.2: que "¿Qué compro?" pueda **precargar las tandas desde el plan** (`que_comprar` ya recibe tandas por sabor, así que
  no hace falta cambiarla: el front le pasa lo que devuelve `plan_horneado`).
- **/admin:** Producción → pestaña nueva **"Plan"** (sumarla a `PRODUCCION` en `admin/js/app.js`, al menú lateral `MENU` y a
  la subnav):
  - elegir la fecha (próxima horneada por defecto);
  - tabla por sabor: pedidos · extra (editable) · tandas · sobrante;
  - botón "Ver qué comprar", que lleva a ¿Qué compro? con las tandas cargadas (por ejemplo `#/comprar?plan=<fecha>` o
    guardándolas en `sessionStorage`);
  - botón "Registrar estas tandas", que llama a `registrar_tanda` por sabor con confirmación.

**Aceptación.** Con 3 pedidos para el sábado (18 rolls de Canela, 6 de Oreo) y 6 de Canela extra, el plan dice 2 tandas
de Canela y 1 de Oreo, y "¿Qué compro?" muestra los faltantes de esas tandas.

**Pruebas.** Bloque SQL de `plan_horneado` (redondeo de tandas, extra, pedidos rechazados que no cuentan).

---

### 🟡 6.1 · SEO y vista previa al compartir el link

**Hoy.** `index.html` solo tiene `<title>`. Al pasar el link por WhatsApp o Instagram no sale foto ni descripción. No hay
`robots.txt` ni `sitemap.xml` (/admin ya tiene `noindex`).

**Qué hacer.**
- En `<head>` de `index.html`:
  - `meta description`, `link rel="canonical"` (`https://cinniminies.vercel.app/`, o el dominio propio si lo compran);
  - Open Graph: `og:title`, `og:description`, `og:image` (URL **absoluta**), `og:image:width/height`, `og:type`
    (`website`), `og:locale` (`es_UY`), `og:url`;
  - `twitter:card` = `summary_large_image`.
- **Imagen:** `img/og.jpg`, 1200×630, menos de 300 KB, en JPG (WhatsApp no siempre muestra WebP). No hay herramientas de
  imágenes instaladas: armarla en el navegador con un `<canvas>` desde `img/hero-bg.webp` más el nombre, y descargarla, o
  pedirla a los dueños.
- **Datos estructurados** JSON-LD tipo `Bakery`: nombre, url, logo o imagen, `address` (Paysandú, Uruguay; la dirección
  exacta solo si los dueños quieren), `telephone`, `sameAs` (Instagram), `priceRange`.
- `robots.txt` (permitir todo menos `/admin/` y `/api/`, con la línea del sitemap) y `sitemap.xml` con la home.
- **Limitación:** los buscadores y WhatsApp leen el HTML sin ejecutar JS, así que los textos editables de la Etapa 7 no
  cambian estas etiquetas. Si se quiere que sean editables: una función de Vercel que sirva `index.html` con las
  etiquetas reemplazadas, con cache. Es opcional y no parte de esta tarea.

**Aceptación.** El link pegado en WhatsApp muestra foto, título y descripción. El Rich Results Test de Google reconoce
el negocio.

---

### 🟢 6.5 · Más lugares editables de la web

**Hoy (Etapa 7).** `contenido_web` (clave, sección, orden, etiqueta, ayuda, tipo, valor, original; checks por tipo; los
admins solo pueden actualizar `valor`) → viaja en `/api/catalogo` → `cinniminies.js` (`aplicarContenido`) lo aplica sobre
los atributos `data-contenido`, `data-contenido-img`, `data-contenido-mapa`, `data-contenido-whatsapp` y
`data-contenido-instagram` de `index.html`. La pantalla es `admin/js/vistas/web.js`, con las secciones en la constante
`SECCIONES`.

**Qué sumar** (cada lugar: una fila en una migración + el atributo en `index.html` + la sección en `SECCIONES` si es nueva):
- Barra de arriba: botón "Hacer pedido" (`.topbar-cta`) y los links del menú (Menú, Local, Contactanos; están
  **dos veces**: `.topnav` y `#mobileNav`, así que usar la misma clave en ambos).
- Menú: frase "El menú", el "Ninguno apurado." del título (el principio lo arma el catálogo: "Tres rolls.") y la ayuda
  del selector de caja.
- "Scrolleá para hornear ↓" (`.bake-meter-label`).
- Textos del carrito y del formulario: título "Tu pedido", "Tus datos", aclaraciones. Los que hoy arma `cinniminies.js`
  en strings (toasts, "Completá la caja…") necesitan un helper `texto('clave', 'respaldo')` que lea del contenido
  cargado; sumarlos solo si los dueños lo piden.
- Foto de cada tarjeta de sabor: ya se edita en Catálogo → Sabores, no duplicarla.

**Aceptación.** Los textos nuevos aparecen en /admin → Web con "Volver al original" y se ven en la web en ≤ 5 minutos.

---

### 🟢 6.6 · Reseñas de clientes

**Decisión previa con los dueños:** ¿las reseñas las cargan ellos (copiando de WhatsApp o Instagram) o también hay un
formulario público? Recomendado: **fase 1 solo cargadas por los dueños**, porque no requiere moderación ni anti-spam.
Fase 2 opcional: formulario público que entra como "pendiente de aprobar".

**Qué hacer (fase 1).**
- **Base:** tabla `resenas` (id, nombre, texto ≤ 400, estrellas 1–5 opcional, fecha, visible boolean, orden, creado_en)
  con RLS solo admins. `catalogo_web()` agrega `resenas` (visibles, hasta 12, por orden).
- **/admin:** Web → "Reseñas": lista con alta, edición, mostrar u ocultar y orden (mismo estilo que las otras listas).
- **Web:** sección nueva entre "El menú" y "Dónde encontrarnos": tarjetas con el texto, el nombre y las estrellas, con el
  diseño actual (tipografías Fraunces y Plus Jakarta Sans, paleta crema, canela y café de `cinniminies.css`). Se arma con
  JS desde el catálogo, escapando el texto con `esc()`. Si no hay reseñas o falla la API, la sección no aparece (en
  `index.html` va vacía y oculta).
- **Fase 2** (si la piden): `POST /api/resenas` con el mismo patrón que `/api/pedidos` (campo trampa, límite por IP con
  hash, tamaños máximos), guardando `visible = false`, y aviso en Inicio → "Para hacer".

**Aceptación.** Los dueños cargan 3 reseñas, ocultan una, y la web muestra las 2 visibles en ≤ 5 minutos.

---

## 3. Al terminar cada tarea

- Actualizar `CONTEXTO-NUEVA-SESION.md` (tabla de estado y lo construido), la tarea acá (✅ y número de PR) y, si cambian
  pantallas, `admin/README.md`.
- `get_advisors` security y performance sin avisos nuevos.
- Dejar la base como estaba: sin datos "PRUEBA…". Si se usó el usuario de prueba, no borrarlo: es fijo.
