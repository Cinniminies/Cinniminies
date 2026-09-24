# Cinniminies — Plan de desarrollo de la app de gestión (handoff)

> Documento para una sesión nueva de Claude que va a trabajar desde la PC del negocio,
> dentro del repositorio git de la web. Resume todo lo analizado en una sesión anterior
> (22–23/09/2026) y define qué construir, en qué orden y con qué criterios.
>
> **Antes de hacer cualquier cosa:** leé este documento entero, inspeccioná el repo y
> confirmá con los dueños los puntos marcados como **[CONFIRMAR]**. No crees recursos
> pagos ni borres nada sin preguntar.

> **Estado al 24/09/2026:** Etapa 1 cerrada. **Etapa 2 construida** (rama `feat/etapa-2-admin`):
> `/admin` con todas las pantallas, probado en Chrome contra la base real. Falta: configurar Auth en
> el dashboard (URLs y código en el mail, ver `admin/README.md`), publicar, y la carga en paralelo
> de los dueños (aceptación).

---

## 0. Resumen en 10 líneas

- **Cinniminies** es un emprendimiento de rolls de canela de dos personas (una pareja) en Paysandú, Uruguay.
- Hoy la gestión vive en un **Google Sheet** con 8 hojas y una **web app de Apps Script** para cargar ventas desde el celular.
- **El problema principal:** cada sabor ocupa columnas y bloques propios en la planilla, así que agregar un sabor, formato o precio obliga a tocar unos 10 lugares y varias fórmulas.
- **La decisión:** construir una app propia ("opción B"):
  - una base de datos en **Supabase** (Postgres);
  - un panel **`/admin`** dentro del **mismo repo** de la web pública, que está en Vercel;
  - un **Google Sheet de análisis de solo lectura** que se actualiza solo.
- **Respuestas de los dueños:** solo ellos dos cargan datos; el código está en un repo git; el análisis se hace en **Google Sheets**; los **pedidos desde la web quedan para el final**.
- Se construye por etapas. Cada etapa tiene que quedar usable y verificada antes de pasar a la siguiente.

---

## 1. Contexto del negocio

| Tema | Detalle |
|---|---|
| Producto | Rolls de canela hechos a mano. Sabores: **Canela** (clásico), **Dulce de Leche (DDL)**, **Oreo** ("producto estrella"), **Nutella** (costeado, todavía no en la web) |
| Lugar | Paysandú, Uruguay. Moneda **UYU ($)**. Zona horaria **America/Montevideo** |
| Operación | Sin local, funcionan por pedido. Se coordina por WhatsApp o por Instagram (@cinniminies.pay). Retiro los sábados cerca del mediodía, zona Barrio Obrero. También hacen envíos |
| Producción | Por **tandas** de 12 rolls. Una tanda es de un solo sabor |
| Quién carga | Solo los 2 dueños |
| Volumen | ~108 ventas entre el 06/05/2026 y el 12/09/2026. 23 tandas. ~110 compras. ~64 clientes |
| Web pública | https://cinniminies.vercel.app (código en el repo git donde vas a trabajar) |
| Datos actuales | Google Sheet `cinniminies_gestion`, de la cuenta Google del dueño. Además, un sheet `Cinniminies - Pedidos Web (para importar)`, un intento previo de pedidos web |

### 1.1 Menú y precios vigentes

| Formato | Precio | Notas |
|---|---|---|
| Box de 6 | $250 | Cualquier combinación de sabores |
| Box de 12 | $450 | Cualquier combinación de sabores |
| Personalizado | Suma de precios por unidad | La web dice "de 3 a 12 rolls, según sabor" |
| Unidad Canela | $50 | |
| Unidad DDL | $55 | |
| Unidad Oreo | $60 | |
| Unidad Nutella | $65 | En la planilla. Box 6 / 12 Nutella también a $250 / $450 |
| Envío | $25 | **Confirmado (23/09):** lo paga el cliente aparte. Es ingreso |
| Menú viejo (histórico) | Box de 4 $180, Box de 10 $380 | Solo en ventas viejas, marcadas con la nota "MENU VIEJO" |

- **Descuentos y recargos:** se carga un "precio final" distinto del de lista. Descuento = lista − final, y puede ser negativo (se cobró más).

### 1.2 Costos de packaging (de la planilla)

- Caja Box de 6: **$30** por unidad. Caja Box de 12: **$35** por unidad.
- Papel manteca: $99 por 50 hojas. Stickers: $100 por 15. En la planilla **no** se sumaban al costo por venta. **Decisión (24/09): en la app sí se suman** al costo de caja de las ventas nuevas (función `costo_caja`); las ventas migradas conservan el costo de la planilla.

### 1.3 Recetas por tanda (12 rolls)

| Ingrediente (unidad base) | Canela | DDL | Oreo | Nutella |
|---|---|---|---|---|
| Harina (g) | 450 | 450 | 450 | 450 |
| Levadura seca (g) | 10 | 10 | 10 | 10 |
| Azúcar (g) | 150 | 50 | 130 | 50 |
| Leche (ml) | 270 | 240 | 270 | 240 |
| Huevos (un) | 1 | 1 | 1 | 1 |
| Manteca (g) | 120 | 60 | 120 | 60 |
| Canela (g) | 12 | 0 | 8 | 0 |
| Azúcar impalpable (g) | 120 | 0 | 120 | 0 |
| Dulce de leche (g) | 0 | 240 | 0 | 0 |
| Galletitas Oreo (paq) | 0 | 0 | 1 | 0 |
| Nutella (g) | 0 | 0 | 0 | 200 |

**Costo por tanda al 22/09/2026:** Canela $114,12 · DDL $114,55 · Oreo $180,07 · Nutella $210,51.

### 1.4 Últimos precios de compra (referencia para validar costos)

| Ingrediente | Precio | Presentación |
|---|---|---|
| Harina | $209,90 | 5 kg |
| Levadura | $66 | 120 g |
| Azúcar | $46 | 1 kg |
| Leche | $45,20 | 1 L |
| Huevos | $180 | 30 un |
| Manteca | $367,50 | 1 kg |
| Canela | $76,95 | 100 g |
| Azúcar impalpable | $94,05 | 1 kg |
| Dulce de leche | $204 | 1 kg |
| Oreo | $209,87 | 3 paquetes |
| Nutella | $471 | 650 g |

- **Proveedores frecuentes:** Super "El Dorado", Tres Flores, Nicole's Plastic (cajas), @miluk.impresiones (stickers), Verdulería Esq. Av. (huevos), Despensa "Lo de Fede", Supermercado Tata.

---

## 2. Estado actual del sistema (lo que vas a reemplazar)

### 2.1 Google Sheet `cinniminies_gestion`

**Ojo:** varias pestañas tienen un espacio adelante (" INICIO", " VENTAS", " COMPRAS", " STOCK", " CLIENTES", " CALCULADORA"). Buscá las hojas y columnas **por nombre normalizado**, nunca por posición.

| Hoja | Qué tiene |
|---|---|
| INICIO | Panel (vendido, gastado, ganancia, pendiente, tandas, stock $, caja, capital). Lista de precios. Un bloque de costos por sabor, que toma el último precio de COMPRAS. Tabla RECETAS (una columna por sabor). Tabla FORMATOS. Rangos con nombre `PU_CANELA/DDL/OREO` y `CU_CANELA/DDL/OREO` |
| TANDAS | Fecha, Sabor, Rolls, una columna por ingrediente (consumo calculado con RECETAS), Notas |
| VENTAS | Encabezado en la fila 4, datos desde la fila 5. Columnas: Fecha, Cliente, Origen, Box, Cant. Box, Tipo (**es el medio de pago**: Efectivo/Transferencia), Estado Pago (Pagado/Pendiente), ENVIO (Envio / - / Pick up / Retiro), [columna sin título con 25], Precio Cobrado, Costo Prod., Costo Caja, Ganancia, Notas, Canela (u), DDL (u), Oreo (u), Caja usada, Precio Final, Descuento |
| COMPRAS | Fecha, Proveedor, Producto, Ingrediente, Cantidad, Unidad, Cant. base, Notas, Total, Ingrediente (final) (adivinado por palabras clave del producto) |
| STOCK | Ingredientes: stock real, mínimo, stock teórico (inicial + comprado − usado desde la fecha de control J3 = 24/07/2026). Cajas y packaging: compradas, usadas (manual) |
| MERMAS | Fecha, Descripción, Tipo, Cant. Rolls, Costo, Motivo. **Mezcla mermas reales con gastos personales** (cine, hamburguesas): esos son retiros de los socios |
| CLIENTES | Nombre, Cómo llegó, Teléfono/IG, Formato favorito, Total comprado, Última compra |
| CALCULADORA | "¿Cuántas tandas vas a hacer?" → qué comprar. Un bloque por sabor más uno combinado |

**Cómo se interpreta cada fila de VENTAS:**
- **"Box de 6" / "Box de 12" genéricas, sin detalle de sabores:** la planilla las costeó como **Canela** (usa el costo de la caja de Canela). Ojo: ya se vendían Oreo y DDL desde el 17/07, aunque TANDAS recién empieza el 25/07. **Confirmado (23/09): eran mezcladas y no se sabe el detalle.** Se migran con un sabor especial **"Sin detalle"** (inactivo, no visible en la web) que se costea como Canela, así queda claro que el costo es una estimación.
- **"Box de 6 Oreo", "Box de 12 Canela", etc.:** un solo sabor.
- **Box con unidades en Canela/DDL/Oreo (u):** caja mixta.
- **"Personalizado":** unidades sueltas, con "Caja usada" opcional.
- **Clientes "Pia Piovano" con origen "Dueña 1":** **confirmado (24/09): consumo propio pagado a menor precio.** Se migran con `tipo = 'consumo_propio'` y el precio que se pagó. Las filas 88 y 89 no tienen formato: se migran como línea "Personalizado" sin caja.

### 2.2 Errores detectados en la planilla (la migración debe corregirlos)

1. **Costos y precios históricos que cambian solos:** las fórmulas usan el costo y precio *actual*. → En la base, **cada venta guarda precio y costo del momento** (snapshot).
2. K2/L2 de VENTAS siempre daban 0.
3. **Envío:** la ganancia sumaba los $25, pero el total vendido no. Además había un 25 escrito en todas las filas, hubiera envío o no.
4. **MERMAS:** cine, comida y hamburguesas (~$2.795) son **retiros de socios**, no gastos. "Acomodo de plata / Balance $614,21" fue un **ajuste para que la caja coincidiera con la billetera** (tipo `ajuste_caja`).
5. **STOCK:** "Usado" no filtraba por la fecha de control.
6. **Costo de ingrediente:** precio de la última compra dividido por una "unidad de compra" escrita a mano, que se rompe si cambia la presentación.
7. **Cajas mixtas inconsistentes.** La fila 110 es una "Box de 12 Canela" con 2/2/2 unidades. **Confirmado: se entregó una Box de 12 de Canela** (12 Canela; se ignoran los 2/2/2).
8. **Rangos con tope fijo:** la fila de totales estaba en la 212 y la app la iba a pisar.
9. **Clientes duplicados o de prueba:** "Hola"; "Romina Müller / Salinas" es en realidad **Romina Salinas (ITSP)**. El uso de cajas se cargaba a mano, y **no cuadra**: VENTAS implica ~80 cajas de 6 usadas y se compraron 71.

**Arreglos en la planilla:** en la sesión anterior se prepararon dos archivos, `docs/planilla-apps-script/Codigo.gs` y `Arreglos.gs`, que corrigen todo esto dentro del Sheet. Las instrucciones para aplicarlos están al principio de `Arreglos.gs`. Importante: después hay que publicar una versión nueva de la web app. **Verificado en el `.xlsx` del 24/09: están aplicados** (VENTAS tiene "Cobro envío ($)" y "Control", y los totales están en las filas 1–3). Cómo detectarlo en otro export:
- Si en VENTAS hay columnas "Cobro envío ($)" y "Control", y los totales están en las filas 1–3, **se aplicaron**.
- Si no, no se aplicaron.

La migración tiene que funcionar **en los dos casos**, leyendo columnas por nombre.

### 2.3 Web app actual (Apps Script, dentro del Sheet)

- **Qué es:** un formulario "Nueva venta" (Código.gs + Formulario.html) publicado como web app con login de Google.
- **Qué hace:** escribe en la primera fila libre de VENTAS y hereda las fórmulas de la fila de arriba. Mapea las columnas por el nombre del encabezado.
- **Qué tiene bueno:** un lock para que dos personas no carguen a la vez, deshacer, autocompletado de clientes y origen, y alta de cliente nuevo en la libreta. Además arregló un bug de zona horaria: guarda las fechas como número de serie.
- **Límites:**
  - Los sabores están fijos en el HTML (steppers de Canela/DDL/Oreo) y en el código.
  - Solo carga ventas.
  - Es lenta (1–2 s por acción).
- **Paleta y estilo a reutilizar en `/admin`** para mantener la identidad:
  - Claro: `--bg #fbf6f0`, `--card #ffffff`, `--texto #2b1c12`, `--suave #8a7364`, `--borde #e8ddd2`, `--marca #a8531d`, `--marca-suave #fdf0e4`, `--ok #1f7a4d`, `--alerta #b3401a`.
  - Oscuro: `--bg #17110d`, `--card #211814`, `--texto #f4e9e0`, `--marca #e39152`.
  - Estilo: botones grandes, chips para opciones, steppers +/−, barra "Guardar" fija abajo, pensado para el celular.

### 2.4 Web pública (este repo: github.com/Cinniminies/Cinniminies)

**Stack:** sitio **estático sin framework ni build**: `index.html`, `cinniminies.css`, `cinniminies.js` e `img/`. Se despliega en Vercel desde `main`. No hay `package.json`. Para probar en local se usó `python -m http.server 8777` (queda en `.claude/settings.local.json`, que está commiteado).

**Contenido:**
- Secciones: hero, "El menú" (elegir caja → sumar sabores), "Dónde encontrarnos" y contacto.
- Los sabores están escritos a mano en `index.html`: tarjetas con `data-id` = `canela`, `dulce`, `oreo`.

**Ya tiene carrito y checkout completos** (`cinniminies.js`):
- **El carrito** arma "cajas": 6, 12 o `custom`.
  - Las cajas de 6 y 12 tienen que quedar completas.
  - La personalizada va de 3 a 12 rolls, cobrados por unidad.
  - Constantes fijas en el código: `BOX_PRICES = {6:250, 12:450}`, `CUSTOM_FLAVOR_PRICES = {canela:50, dulce:55, oreo:60}`, `CUSTOM_MIN = 3`, `CUSTOM_MAX = 12`.
- **El formulario** pide:
  - nombre;
  - WhatsApp (se valida como celular uruguayo `^09[1-9]\d{6}$`);
  - modalidad: `Retiro en Paysandú` o `Coordinar entrega`, con dirección si es entrega;
  - pago: `Efectivo` o `Transferencia`;
  - notas.
  - Genera un ID de pedido `CM-AAAA-XXXX`.
- **Al confirmar se hacen 3 cosas en paralelo, y si una falla no frena a las otras:**
  1. **Email por Web3Forms.** La access key está en el código y es pública por diseño.
  2. **POST a un Apps Script** (`GOOGLE_SHEETS_URL`, otro deployment distinto al de la web app de ventas) con `{filas:[{cliente, box, cantBox, envio, notas}]}`, una fila por caja. Probablemente escribe en el sheet "Cinniminies - Pedidos Web (para importar)". **[CONFIRMAR]**
  3. **Link a WhatsApp** (`wa.me/59895226739`) con el pedido prearmado.
- **Problema de fondo:** los precios y sabores están **duplicados**, en la web y en la planilla, sin conexión entre sí. Tampoco se ofrece Nutella ni se cobra el envío en la web.

---

## 3. Decisión de arquitectura (opción B)

```
                 ┌────────────────────────────────────────┐
                 │ SUPABASE (Postgres + Auth)             │
                 │ catálogo · ventas · tandas · compras · │
                 │ gastos · conteos · clientes            │
                 │ vistas de reporte (v_*)                │
                 └──────┬──────────────────────┬──────────┘
      lee / escribe     │                      │  solo lectura
      (con login)       │                      │  (endpoint con clave)
┌───────────────────────▼──────────┐   ┌───────▼─────────────────────────────┐
│ REPO WEB (Vercel)                │   │ GOOGLE SHEET "Cinniminies · Análisis"│
│  /        web pública            │   │ Apps Script con activador cada 1 h  │
│           (etapa 5: lee catálogo)│   │ + menú "Actualizar ahora".          │
│  /admin   app de gestión (PWA)   │   │ Hojas de datos protegidas;          │
│  /api/export/<vista>  → JSON/CSV │──►│ el análisis va en otras pestañas    │
└──────────────────────────────────┘   └─────────────────────────────────────┘
```

- **Supabase:** base de datos, login de los 2 usuarios, RLS y backups. Región sugerida: **São Paulo (sa-east-1)**, la más cercana a Uruguay.
- **`/admin` en el mismo repo:** una sola app para desplegar y mantener. Instalable en el celular (PWA: manifest + ícono). Sin soporte offline en la primera versión.
- **Cómo encajarlo en un sitio sin build.** Recomendación, a confirmar en la Etapa 0:
  - **`admin/`** como app estática (HTML + JS con módulos ES), usando `@supabase/supabase-js` desde CDN (`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm`). Así se respeta el estilo actual del repo: nada que compilar y Vercel lo sirve tal cual.
  - **`api/`** con **Vercel Functions** en Node (archivos `api/*.js`, que funcionan sin framework) para lo que necesita secretos: exportes a Sheets y, en la Etapa 6, recibir pedidos.
  - La URL de Supabase y la **anon key** pueden ir en el front, porque la seguridad la da RLS. La **service_role** key va solo en las variables de entorno de Vercel.
  - Alternativa: si `/admin` crece mucho, se puede pasar a Vite en una carpeta `admin/` con build propio. No lo hagas sin consultarlo.
  - **Poner la web pública detrás de un build está fuera de alcance.**
- **La lógica de negocio va en la base, no en el navegador.** El cálculo de precio, costo y snapshots se hace con funciones de Postgres (RPC), por ejemplo `registrar_venta(payload jsonb)`, para que la web, los exportes y un futuro pedido web usen **la misma regla**.
- **Análisis en Google Sheets** (lo eligieron los dueños): un **spreadsheet nuevo**, separado del de gestión.
  - Un Apps Script propio llama a `/api/export/<vista>` con un header secreto y vuelca cada vista en su pestaña.
  - Las pestañas de datos quedan protegidas; los dueños arman su análisis en pestañas aparte con fórmulas o tablas dinámicas que las referencian.
- **El Sheet viejo** queda como archivo histórico. No se borra.

### 3.1 Costos y cuentas a tener en cuenta
- **Supabase:** plan gratis suficiente. El proyecto se pausa tras 7 días sin actividad.
- **Vercel:** el plan Hobby es para uso **no comercial**. Siendo un negocio, corresponde Pro (USD 20 al mes) o mover el hosting a Netlify o Cloudflare Pages. **Decisión (23/09): se define más adelante**, antes de usar la app en serio. Mientras tanto se construye en Vercel Hobby; mantené las funciones de `api/` simples para que sean fáciles de portar.
- **No crees proyectos ni actives nada pago sin confirmación explícita.**

---

## 4. Modelo de datos (borrador — ajustalo, pero respetá las reglas de la sección 5)

Todos los montos son `numeric(12,2)` en UYU. Las fechas de negocio son `date`, y además `creado_en timestamptz default now()`. Nombres en español, snake_case.

```sql
-- CATÁLOGO -----------------------------------------------------------
create table sabores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,            -- 'Canela', 'Dulce de Leche', 'Oreo', 'Nutella'
  nombre_corto text,                      -- 'DDL'
  descripcion text,                       -- texto para la web
  etiqueta_web text,                      -- 'EL CLÁSICO', 'NUESTRO PRODUCTO ESTRELLA'
  rolls_por_tanda int not null default 12,
  activo boolean not null default true,   -- se puede vender
  visible_web boolean not null default false,
  orden int not null default 0
);

create table insumos (                    -- ingredientes Y packaging
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,            -- 'Harina', 'Caja Box de 6', 'Stickers'
  tipo text not null check (tipo in ('ingrediente','packaging')),
  unidad_base text not null check (unidad_base in ('g','ml','un','paq')),
  stock_minimo numeric default 0,
  activo boolean not null default true
);

create table recetas (                    -- una fila por ingrediente por sabor
  sabor_id uuid references sabores on delete cascade,
  insumo_id uuid references insumos,
  cantidad numeric not null,              -- por tanda, en unidad_base
  primary key (sabor_id, insumo_id)
);

create table formatos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,            -- 'Box de 6', 'Box de 12', 'Personalizado', 'Unidad'
  tipo text not null check (tipo in ('caja_fija','personalizado','unidad')),
  rolls int,                              -- 6 / 12 para caja_fija
  min_rolls int, max_rolls int,           -- personalizado: 3..12
  caja_insumo_id uuid references insumos, -- caja que consume por defecto
  activo boolean not null default true,
  visible_web boolean not null default true,
  orden int not null default 0
);

create table caja_insumos (               -- packaging extra que lleva cada caja
  caja_insumo_id uuid references insumos on delete cascade,
  insumo_id uuid references insumos,
  cantidad numeric not null,
  primary key (caja_insumo_id, insumo_id)
);
-- Confirmado 24/09: Caja Box de 12 → 2 papel manteca + 1 sticker; Caja Box de 6 → 1 papel manteca + 1 sticker.

create table precios (                    -- historial: nunca se pisa, se agrega
  id uuid primary key default gen_random_uuid(),
  formato_id uuid references formatos,    -- caja_fija: precio de la caja
  sabor_id uuid references sabores,       -- unidad/personalizado: precio por roll de ese sabor
                                          -- (ambos: precio especial de una caja de ese sabor)
  precio numeric(12,2) not null,
  vigente_desde date not null,
  check (formato_id is not null or sabor_id is not null)
);

create table parametros (clave text primary key, valor text not null);
-- ('precio_envio','25'), ('zona_horaria','America/Montevideo')

-- PERSONAS -----------------------------------------------------------
create table clientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  contacto text,                          -- teléfono o @instagram
  origen text,                            -- Familiar, IG, ITSP, Amiga de Mamá, Web, Whatsapp...
  notas text,
  creado_en timestamptz default now()
);

-- MOVIMIENTOS --------------------------------------------------------
create table ventas (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  cliente_id uuid references clientes,
  origen text,                            -- snapshot del origen de esa venta
  entrega text not null check (entrega in ('envio','retiro','sin_envio')),
  cobro_envio numeric(12,2) not null default 0,
  medio_pago text check (medio_pago in ('efectivo','transferencia')),
  estado_pago text not null check (estado_pago in ('pagado','pendiente')),
  tipo text not null default 'venta' check (tipo in ('venta','consumo_propio','regalo')),
  precio_lista numeric(12,2) not null,    -- snapshot
  precio_cobrado numeric(12,2) not null,  -- snapshot (= lista salvo precio especial)
  notas text,
  creado_por uuid references auth.users,
  creado_en timestamptz default now()
);

create table venta_lineas (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references ventas on delete cascade,
  formato_id uuid not null references formatos,
  cantidad int not null default 1,        -- cajas (1 para personalizado/unidad)
  caja_insumo_id uuid references insumos, -- null = sin caja
  precio_lista numeric(12,2) not null,    -- snapshot
  costo_caja numeric(12,2) not null       -- snapshot
);

create table venta_linea_sabores (
  linea_id uuid references venta_lineas on delete cascade,
  sabor_id uuid references sabores,
  unidades int not null check (unidades > 0),
  costo_unitario numeric(12,4) not null,  -- snapshot del costo por roll ese día
  primary key (linea_id, sabor_id)
);

create table compras (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  proveedor text,
  descripcion text,                       -- 'Harina Uruguay 0000'
  insumo_id uuid references insumos,      -- null = equipamiento u otro
  categoria text not null check (categoria in ('ingrediente','packaging','equipamiento','otro')),
  cantidad numeric,                       -- 5
  unidad text,                            -- 'kg'
  cantidad_base numeric,                  -- 5000 (en unidad_base del insumo)
  total numeric(12,2) not null,
  notas text
);

create table tandas (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  sabor_id uuid not null references sabores,
  cantidad numeric not null default 1,    -- tandas
  rolls int,                              -- default cantidad * rolls_por_tanda
  notas text
);

create table tanda_consumos (             -- snapshot de la receta usada
  tanda_id uuid references tandas on delete cascade,
  insumo_id uuid references insumos,
  cantidad numeric not null,
  primary key (tanda_id, insumo_id)
);

create table gastos (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  descripcion text not null,
  tipo text not null check (tipo in
    ('merma','tanda_descartada','gasto_operativo','comision','retiro_socios','ajuste_caja','otro')),
  monto numeric(12,2) not null,
  rolls int,
  notas text
);

create table conteos (                    -- conteo físico de stock
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  insumo_id uuid not null references insumos,
  cantidad numeric not null
);
```

**Vistas de reporte** (las usan el panel y el export a Sheets):
- `v_ventas`: una fila por venta, con cliente, rolls, precio, costo de producción, costo de caja, envío, ganancia y estado.
- `v_ventas_sabores`: una fila por sabor de cada venta (fecha, sabor, unidades, ingreso prorrateado, costo).
- `v_costo_insumo`: costo unitario vigente de cada insumo.
- `v_costo_sabor`: costo por tanda y por roll de cada sabor, más el margen de cada formato.
- `v_stock`: teórico, último conteo, mínimo, `reponer` y valor en $.
- `v_resumen_mensual`: vendido, cobrado, gastos, retiros y ganancia por mes.
- `v_panel`: los números del panel (sección 5.6).

**Seguridad:**
- RLS activado en **todas** las tablas. Política: solo usuarios autenticados que estén en una tabla `usuarios_admin` (los 2 dueños) pueden leer y escribir.
- Registro público **desactivado**. Login por email (magic link o contraseña).
- La `service_role` key **solo** en variables de entorno del servidor (Vercel) y en `.env.local` para scripts locales. Nunca en el navegador ni en git.

---

## 5. Reglas de negocio (la parte importante)

### 5.1 Costo de insumos
- **Costo unitario de un insumo en la fecha F** = `total / cantidad_base` de la **última compra de ese insumo con fecha ≤ F que tenga `cantidad_base`**.
- Precio y cantidad salen **de la misma compra**.
- Si no hay ninguna compra, se usa un costo de referencia cargado a mano en el insumo, para el caso de Nutella u otros insumos nuevos.

### 5.2 Costo de un sabor
- **Costo por tanda** = Σ (cantidad de la receta × costo unitario del insumo).
- **Costo por roll** = costo por tanda ÷ `rolls_por_tanda`.
- Para validar: con los datos al 22/09 tiene que dar Canela $9,51, DDL $9,55, Oreo $15,01 y Nutella $17,54 por roll.

### 5.3 Precio de una línea de venta
- **caja_fija:** precio vigente del formato × cantidad. Si existe un precio especial para esa caja y ese sabor (una sola variedad), se usa ese.
- **personalizado / unidad:** Σ (unidades × precio unitario vigente del sabor).
- **Precio especial ("precio final"):** si se carga, `precio_cobrado` = ese valor. El descuento es `precio_lista − precio_cobrado`, y puede ser negativo.
- **Envío:** `cobro_envio` = `parametros.precio_envio` si `entrega = 'envio'`, si no 0. Va **aparte** del precio cobrado, pero suma al total vendido y a la ganancia (confirmado: lo paga el cliente).

### 5.4 Validaciones al guardar una venta
- **caja_fija:** Σ unidades de los sabores = `rolls × cantidad`. Si no se detallan sabores y la caja no tiene sabor único, exigirlos: hoy se carga el sabor siempre.
- **personalizado:** entre `min_rolls` y `max_rolls` (3–12).
- **Caja por defecto:** la del formato. En personalizado, sugerir caja de 6 si son ≤ 6 rolls y de 12 si son más, y permitir "Sin caja" u otra.

### 5.5 Snapshots (no negociable)
- Al guardar se copian a la venta: precio de lista, precio cobrado, costo unitario de cada sabor, costo de caja y cobro de envío.
- **Nunca** se recalculan ventas pasadas cuando cambian precios o costos.
- Lo mismo vale para las tandas: `tanda_consumos` guarda lo que se consumió con la receta de ese día.

### 5.6 Panel (mismas definiciones que la planilla, corregidas)
- **Total vendido** = Σ `precio_cobrado` + Σ `cobro_envio` (ventas tipo 'venta' y 'consumo_propio': el consumo propio se paga, a menor precio).
- **Cobrado** = lo anterior, solo de ventas con estado 'pagado'. **Pendiente** = vendido − cobrado.
- **Total gastado** = Σ compras + Σ gastos **excepto** `retiro_socios`.
- **Retiros socios** = Σ gastos con tipo `retiro_socios`. Se muestra aparte.
- **Ajustes de caja** = Σ gastos con tipo `ajuste_caja`. Se muestran aparte; no cuentan como gasto pero sí restan de la caja teórica.
- **Ganancia bruta de ventas** = Σ (precio cobrado + envío − costo de producción − costo de caja).
- **Ganancia neta** = vendido − gastado + valor del stock de ingredientes + valor del stock de packaging.
- **Caja teórica** = vendido − gastado − pendiente − retiros − ajustes de caja.
- **Capital** = caja teórica + valor del stock.
- **Tandas hechas**, **rolls producidos** y **rolls vendidos** por sabor.

### 5.7 Stock
- **Stock teórico de un insumo** = último conteo + compras posteriores − consumos de tandas posteriores − (si es caja) cajas usadas en ventas posteriores.
- Alertas cuando el teórico queda por debajo del mínimo.
- El **desvío** (teórico − contado) se ve al cargar un conteo.
- Papel manteca y stickers: cada caja usada descuenta lo que indica `caja_insumos` (Box de 12: 2 papel + 1 sticker; Box de 6: 1 papel + 1 sticker).

### 5.8 "¿Qué compro?" (reemplaza la hoja CALCULADORA)
- Entrada: tandas planeadas por sabor.
- Salida: por insumo, necesario vs. stock teórico, faltante y costo estimado, redondeando a presentaciones de compra (la última presentación comprada).

---

## 6. Pantallas de `/admin` (mobile-first)

1. **Login.**
2. **Inicio / Panel:** tarjetas del panel (5.6), ventas pendientes de cobro, alertas de stock y últimas 6 ventas.
3. **Nueva venta:**
   - fecha (hoy por defecto);
   - cliente (autocompletar, o crear uno nuevo con contacto; al elegirlo se completa el origen habitual);
   - formato (chips generados desde `formatos` activos) y cantidad;
   - **sabores generados desde `sabores` activos** (stepper por sabor, con el contador "4/6");
   - entrega, medio de pago y estado;
   - sección plegable "precio especial / caja / notas";
   - resumen en vivo (lista, descuento, cobro, costo, ganancia).
   - Al guardar: pantalla de confirmación con **Deshacer** y **Cargar otra**.
   - Una venta puede tener **más de una línea** (ej.: 1 Box de 12 + 2 unidades).
4. **Ventas:** lista con filtros (mes, estado, cliente). Tocar una venta permite editarla o marcarla como pagada. Si una edición cambia precios, **recalcula el snapshot solo si el usuario lo pide**.
5. **Tandas:** alta rápida ("2 × Canela") e historial.
6. **Compras:** alta (insumo desde la lista, cantidad y unidad → `cantidad_base` automática con las conversiones g/kg, ml/L, un, paq), proveedor con autocompletar e historial.
7. **Gastos y retiros:** alta con tipo (merma / tanda descartada / gasto / comisión / **retiro socios**).
8. **Stock:** tabla del teórico, botón "Cargar conteo" y "¿Qué compro?".
9. **Catálogo:**
   - **Sabores:** alta, edición y activar/ocultar en la web. La receta se edita con "copiar receta de…".
   - **Insumos:** nombre, tipo, unidad, mínimo.
   - **Formatos** y **Precios:** cargar un precio nuevo con "vigente desde" y ver el historial.
   - Costo por roll y margen de cada formato, en vivo.
10. **Clientes:** lista con total comprado, última compra y fusionar duplicados.

Idioma: **español rioplatense** (vos), montos con el formato `$1.234,50`.

---

## 7. Plan por etapas

Cada etapa termina con una demo a los dueños y con los criterios de aceptación cumplidos. No avances de etapa sin su OK.

### Etapa 0 — Reconocimiento (sin cambios)
- [x] Releer el repo (resumen en 2.4). Verificado el 23/09: sigue sin `package.json` ni `vercel.json`. Ojo: `settings.local.json` está en la raíz del repo, no en `.claude/`. Falta confirmar el enfoque `admin/` + `api/` de la sección 3.
- [x] Vercel publica desde `main` (confirmado 24/09). Falta ver si hay previews por rama.
- [x] Confirmar con los dueños los puntos **[CONFIRMAR]** (sección 9: todas respondidas el 24/09).
- [x] Arreglos del Sheet aplicados: verificado en el `.xlsx` del 24/09.
- [x] Guardar el `.xlsx` del Sheet en `migracion/datos/` (bajado del Drive el 24/09; está en el `.gitignore`).
- [x] Plan concreto: `admin/` + `api/` como en la sección 3; la Etapa 1 agrega `supabase/` y `migracion/`. OK de los dueños para arrancar (24/09).

### Etapa 1 — Base de datos y migración del histórico
- [x] Proyecto de Supabase creado el 24/09: nombre `cinniminies`, ref `skysdjfxuykrufawhzvn`, región São Paulo (sa-east-1), plan gratis, URL `https://skysdjfxuykrufawhzvn.supabase.co`. La clave pública (publishable/anon) se saca del dashboard (Project Settings → API Keys); la service_role **nunca** va al repo. Todavía está vacío: sin tablas, sin usuarios. Se creó en otra organización y los dueños lo movieron a la organización **cinniminies** (24/09): conectá el MCP de Supabase con la cuenta que tenga acceso a esa organización. Un proyecto gratis se pausa tras 7 días sin actividad.
- [x] Guardar las migraciones SQL en el repo (`supabase/migrations/`): tablas, RLS, funciones (`costo_insumo(insumo, fecha)`, `costo_roll(sabor, fecha)`, `precio_vigente(...)`, `registrar_venta(jsonb)`, `registrar_tanda(jsonb)`) y vistas `v_*`. Aplicadas en Supabase el 24/09. Además: `calcular_venta(jsonb)` (el cálculo sin guardar, para el resumen en vivo), `importar_planilla(jsonb)` (solo service_role) y pruebas en `supabase/tests/reglas.sql`.
- [x] Sembrar el catálogo (sección 1): sabores (más "Sin detalle", inactivo, para las cajas viejas sin sabores), insumos (incluir cajas de 6 y de 12, papel manteca y stickers), recetas, formatos (incluidos los históricos "Box de 4" y "Box de 10", inactivos), precios con `vigente_desde` 2026-05-01 y el parámetro `precio_envio` = 25.
- [x] Script de migración `migracion/importar.py` (Python sin dependencias; en la compu no hay Node). Ver `migracion/README.md`. Tiene que ser **idempotente**: vaciar y recargar. Lee el `.xlsx` **buscando hojas y columnas por nombre normalizado** (sin espacios, sin acentos, en minúsculas).
- [x] Mapeo (implementado en `importar.py`; decisiones y dudas en `docs/conciliacion-etapa-1.md`):
  - **VENTAS → ventas + líneas + sabores.**
    - Congelar los valores **tal como están en la planilla**: Precio Cobrado, Costo Prod. y Costo Caja son los snapshots. No recalcular.
    - Cajas genéricas sin detalle = sabor "Sin detalle", con el costo por roll de Canela de la planilla.
    - Nombres "Box de 6 X" = formato Box de 6 más un solo sabor X.
    - Detalle Canela/DDL/Oreo (u) = sabores de la línea.
    - ENVIO: "Envio" → envio; "Pick up" o "Retiro" → retiro; "-" → sin_envio. `cobro_envio` = 25 si hubo envío.
    - Tipo → medio_pago. Precio Final → precio especial.
    - Filas 88, 89 y ventas de "Dueña 1" → `consumo_propio` con el precio pagado. Fila 110 → Box de 12 con 12 Canela.
  - **CLIENTES:** deduplicar por nombre normalizado. Corregir "Romina Salinas" y descartar "Hola".
  - **COMPRAS:**
    - Mapear el insumo desde "Ingrediente (final)" o "Ingrediente".
    - Cajas, stickers y papel manteca → packaging. Las compras de "Cajas" sin tamaño se asignan por precio unitario: **$30 → Caja Box de 6, $35 → Caja Box de 12** (confirmado). Si alguna no encaja, listarla para que la revisen.
    - Balanza → equipamiento.
    - Parsear cantidades viejas en texto ("5kg", "500gr", "2L", "100g") a `cantidad_base`.
  - **TANDAS:** una tanda por fila. `tanda_consumos` con los valores de las columnas de ingredientes: la fila del 30/08 (Canela) tiene consumos atípicos y hay que respetarlos tal cual.
  - **MERMAS → gastos:**
    - Gustito, Cine y Comida → `retiro_socios`.
    - Tanda descartada → `tanda_descartada`.
    - Comisión y Transferencia → `comision`.
    - EXTRA y Bolsa → `gasto_operativo`.
    - "Cobramos menos…" → `otro` (en realidad es un descuento).
    - Balance / "Acomodo de plata" → `ajuste_caja`.
  - **STOCK → conteos:** conteo inicial con la fecha del export y el "Stock real" de cada ingrediente. Cajas: compradas − usadas de la hoja STOCK.
- [x] **Conciliación.** Cargada y verificada sobre la base el 24/09 (`docs/conciliacion-etapa-1.md`): cierra todo, con dos correcciones confirmadas por los dueños (fila 110: +$45,99 de costo; fila 89: −$35 de caja). Referencia: export del 22/09/2026, antes de los arreglos. Si la planilla ya tiene más ventas, conciliá contra ella en ese momento.

  | Control | Valor esperado |
  |---|---|
  | Ventas | 108 |
  | Σ Precio cobrado | $31.130 |
  | Σ Costo producción | $8.145,16 |
  | Σ Costo caja | $3.265 |
  | Pendiente de cobro | $900 (2 ventas de Giovanna Firpo, 11/09) |
  | Ventas con envío | 30 → $750 de envíos (dato del export del 24/09, con los arreglos aplicados) |
  | Compras | $14.578,87 |
  | Gastos (MERMAS) | $3.771,60, de los cuales retiros = $2.795 |
  | Tandas | 23 (Canela 12, Oreo 8, DDL 3) |
  | Costo por tanda con precios al 22/09 | Canela $114,12 · DDL $114,55 · Oreo $180,07 · Nutella $210,51 |

  Cada diferencia se explica por escrito, o se corrige.

- **Aceptación:** la conciliación cierra, las RLS están probadas (sin login no se lee nada) y los dueños revisaron los números.
  - [x] Conciliación cerrada. [x] RLS probadas: `anon` no tiene permisos; un usuario logueado que no es admin ve 0 filas; los 2 admins ven todo. [x] Admins creados con `migracion/crear_admins.py` (usuarios confirmados, sin mail; entran con link por mail cuando exista `/admin`).
  - [x] Registro público desactivado en Auth (dashboard: Authentication → Sign In / Providers → "Allow new users to sign up").
  - [x] OK final de los dueños a los números (24/09).

### Etapa 2 — App de carga (reemplaza la web app de Apps Script)
- [x] Auth, layout mobile-first con la paleta de 2.3 y PWA instalable. Login con código por mail (funciona dentro de la PWA en iPhone) o contraseña. Detalle en `admin/README.md`.
- [x] Pantallas: Panel, Nueva venta (sabores dinámicos), Ventas, Tandas, Compras, Gastos y retiros, Clientes.
- [x] Guardado vía RPC (snapshots en la base) y deshacer la última carga. Funciones nuevas: `actualizar_venta` (editar; recalcula solo si se cambian los productos), `registrar_compra` (convierte kg/L a la unidad base), `fusionar_clientes`.
- [x] Tests de las reglas de la sección 5: precio, costo, validación de sabores, envío, snapshots que no cambian al subir un precio (`supabase/tests/reglas.sql`), más los formatos del front (`admin/tests/`).
- **Aceptación:**
  - los dueños cargan una semana real **en paralelo** en la app y en la planilla, y los números coinciden;
  - la carga de una venta toma menos de 20 segundos en el celular.
- Recién después de 2–3 semanas en paralelo, y con su OK, dejan de usar el Apps Script. **No lo borres:** que lo desactiven ellos.

### Etapa 3 — Catálogo editable
- [ ] Pantallas de Sabores (con receta), Insumos, Formatos y Precios (con historial).
- [ ] Stock (teórico, conteos, alertas) y "¿Qué compro?".
- **Aceptación:** crear un sabor de prueba ("Pistacho"), cargarle receta y precio, venderlo, verlo en el panel y en el stock, y después desactivarlo. Todo **sin tocar código**.

### Etapa 4 — Google Sheet de análisis (solo lectura)
- [ ] Endpoints `GET /api/export/<vista>` (`ventas`, `ventas_sabores`, `costos`, `stock`, `resumen_mensual`, `gastos`, `compras`, `tandas`).
  - Autenticados con un header `x-export-key` contra una variable de entorno.
  - Leen con la service key **del lado del servidor**.
  - Devuelven JSON (o CSV).
- [ ] Spreadsheet nuevo "Cinniminies · Análisis" con un Apps Script propio:
  - `actualizarTodo()` llama cada endpoint con `UrlFetchApp` (clave en `PropertiesService`, nunca en el código) y reescribe la pestaña `datos_<vista>` con encabezados, formatos de fecha y $, y protección de solo lectura;
  - activador cada 1 hora y menú "📊 Actualizar ahora".
- [ ] Una pestaña "Resumen" de ejemplo con fórmulas sobre `datos_*`: ganancia por mes, por sabor y top clientes, para que ellos la extiendan.
- [ ] Documentar en el README cómo rotar la clave.
- **Aceptación:** los totales del Sheet coinciden con el panel de la app; los dueños lo abren desde el celular (Drive) y ven datos de la última hora.

### Etapa 5 — Web pública conectada al catálogo
- [ ] Crear `GET /api/catalogo` (Vercel Function, con cache de CDN de algunos minutos) o una vista pública de solo lectura con RLS. Tiene que devolver sabores visibles (id, nombre, descripción, etiqueta, foto, precio por unidad), formatos visibles y precios vigentes.
- [ ] En `cinniminies.js`:
  - reemplazar `BOX_PRICES` y `CUSTOM_FLAVOR_PRICES` por los datos del catálogo;
  - generar las tarjetas de sabores desde el catálogo en lugar de las fijas de `index.html`;
  - **si la API falla, usar como respaldo los valores actuales**, para que la web nunca quede sin menú.
- [ ] Fotos: agregar un campo `foto` en `sabores` (ruta en `img/` o Supabase Storage).
- [ ] Mantener el diseño actual. Solo cambia la fuente de los datos.
- **Aceptación:** marcar Nutella como visible hace que aparezca en la web con su precio, sin deploy.

### Etapa 6 (última, cuando lo pidan) — Pedidos desde la web a la base
El checkout **ya existe** (ver 2.4). Esta etapa lo conecta a la base:
- [ ] Crear `POST /api/pedidos` (Vercel Function):
  - valida el carrito **en el servidor**, recalculando precios con el catálogo (el total del cliente no se usa tal cual);
  - guarda el pedido en una tabla `pedidos` + `pedido_cajas` con estado `nuevo`, junto con el ID `CM-AAAA-XXXX`, el contacto, la modalidad, la dirección y el pago.
  - Anti-spam: honeypot y rate limit por IP.
- [ ] En `cinniminies.js`, sumar esa llamada a las notificaciones existentes (`Promise.allSettled`). Mantener Web3Forms y WhatsApp.
- [ ] En `/admin`, una pantalla "Pedidos nuevos": ver, contactar (link `wa.me`), **confirmar**, que lo convierte en venta con snapshots, o rechazar. El cliente se crea o reutiliza por teléfono.
- [ ] Cuando funcione, sacar el POST a `GOOGLE_SHEETS_URL` y desactivar ese Apps Script, con OK de los dueños.
- [ ] Revisar primero el sheet "Cinniminies - Pedidos Web (para importar)" y el Apps Script de pedidos, para no perder nada que ya estén usando.

---

## 8. Qué NO hacer

- No borrar ni modificar el Google Sheet `cinniminies_gestion` ni su Apps Script. Es el respaldo y el sistema en uso hasta que termine el período en paralelo.
- No commitear datos de clientes, `.env*`, keys ni el `.xlsx` exportado.
- No exponer la `service_role` key en el cliente ni en el Apps Script de análisis. El Sheet usa solo el endpoint con la clave de export.
- No recalcular precios ni costos de ventas pasadas.
- No hardcodear sabores, formatos ni precios en el frontend. Todo sale del catálogo (ese es el objetivo del proyecto).
- No crear recursos pagos, dominios ni planes sin confirmación.
- No rediseñar la web pública sin que lo pidan.
- No trabajar directo sobre `main`: Vercel publica `main`. Usá ramas y abrí PRs para que los dueños revisen.

---

## 9. Preguntas abiertas para los dueños (Etapa 0)

**Ya respondidas:**
1. ¿Quiénes cargan datos? → **Solo los 2 dueños.**
2. ¿Dónde está el código? → **En un repo git** (este).
3. ¿Dónde analizan los números? → **Google Sheets.**
4. ¿Pedidos desde la web? → **Sí, pero al final** (Etapa 6). La web ya tiene checkout; falta conectarlo a la base.
5. **Envío $25** → **Lo paga el cliente aparte.** Es ingreso.
6. **Cajas genéricas** sin detalle → **Eran mezcladas, no se sabe.** Sabor "Sin detalle", costeado como Canela.
12. **Hosting** → **Se decide más adelante.** Por ahora, Vercel Hobby.
14. **¿Se aplicaron los arreglos del Sheet?** → **Sí, y se publicó la web app nueva.** Verificar en el `.xlsx`.

7. **Filas de "Pia Piovano / Dueña 1"** → **Consumo propio, pagado a menor precio.**
8. **Giovanna Firpo 11/09** → **Se entregó una Box de 12 de Canela.**
9. **"Acomodo de plata / Balance" $614,21** → **Ajuste para que coincidiera con la billetera** (`ajuste_caja`).
10. **Cajas sin tamaño** → **Cuestan distinto: las de 6, $30; las de 12, $35.** Se separan por precio unitario.
11. **Papel y stickers por caja** → **Box de 12: 2 papel manteca + 1 sticker. Box de 6: 1 papel manteca + 1 sticker.**
13. **Emails del login** → los dieron en el chat del 24/09. **No se guardan en el repo**: pedíselos a los dueños al configurar Auth.
15. **Vercel** → publica desde `main`.

**Pendientes:** ninguna para arrancar la Etapa 1.

---

## 10. Referencias rápidas

- **Web pública:** https://cinniminies.vercel.app
- **Sheet de gestión:** `cinniminies_gestion` en el Drive del dueño. Pestañas con espacio adelante.
- **Rangos con nombre del Sheet:** `FORMATOS` (INICIO!O21:R31), `RECETAS` (INICIO!H35:K44), `UNIDADES` (INICIO!H10:I15), `PU_*` / `CU_*` (precio y costo por unidad de cada sabor) y, si se aplicaron los arreglos, `PRECIO_ENVIO` (INICIO!B19).
- **Fechas en el Sheet:** números de serie (días desde el 30/12/1899). Algunas tienen hora porque vienen de `now()`.
- **Conversión de unidades:** g=1, kg=1000, ml=1, L=1000, un=1, paq=1.
- **Orígenes de clientes en uso:** Familiar, IG, ITSP, ITSP (Amigo), Amigo, Amiga de Mamá, Conocida, Amigo/a de Pia, Web, Whatsapp, Dueña 1.
