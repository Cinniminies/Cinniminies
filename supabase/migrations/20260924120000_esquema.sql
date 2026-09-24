-- Esquema base de Cinniminies (Etapa 1).
-- Montos en UYU con numeric(12,2). Fechas de negocio como date (hora de Montevideo).
-- Las filas que vienen de la planilla guardan `fila_planilla` (la fila de origen):
-- sirve para rastrear la migración y para que el import sea idempotente.

-- CATÁLOGO -----------------------------------------------------------------

create table sabores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,            -- 'Canela', 'Dulce de Leche', 'Oreo', 'Nutella'
  nombre_corto text,                      -- 'DDL'
  slug text unique,                       -- id que usa la web pública: 'canela', 'dulce', 'oreo'
  descripcion text,                       -- texto para la web
  etiqueta_web text,                      -- 'El clásico', 'Nuestro producto estrella'
  rolls_por_tanda int not null default 12 check (rolls_por_tanda > 0),
  activo boolean not null default true,   -- se puede vender
  visible_web boolean not null default false,
  orden int not null default 0
);

create table insumos (                    -- ingredientes y packaging
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,            -- 'Harina', 'Caja Box de 6', 'Stickers'
  tipo text not null check (tipo in ('ingrediente', 'packaging')),
  unidad_base text not null check (unidad_base in ('g', 'ml', 'un', 'paq')),
  stock_minimo numeric not null default 0,
  -- Costo por unidad base si todavía no hay ninguna compra con cantidad (regla 5.1).
  costo_referencia numeric(14, 6),
  activo boolean not null default true
);

create table recetas (                    -- una fila por insumo por sabor, cantidades por tanda
  sabor_id uuid not null references sabores on delete cascade,
  insumo_id uuid not null references insumos,
  cantidad numeric not null check (cantidad >= 0),
  primary key (sabor_id, insumo_id)
);
create index on recetas (insumo_id);

create table formatos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,            -- 'Box de 6', 'Box de 12', 'Personalizado', 'Unidad'
  tipo text not null check (tipo in ('caja_fija', 'personalizado', 'unidad')),
  rolls int check (rolls > 0),            -- 6 / 12 para caja_fija
  min_rolls int, max_rolls int,           -- personalizado: 3..12
  caja_insumo_id uuid references insumos, -- caja que consume por defecto
  activo boolean not null default true,
  visible_web boolean not null default true,
  orden int not null default 0,
  check (tipo <> 'caja_fija' or rolls is not null),
  check (min_rolls is null or max_rolls is null or min_rolls <= max_rolls)
);
create index on formatos (caja_insumo_id);

create table caja_insumos (               -- packaging extra que lleva cada caja
  caja_insumo_id uuid not null references insumos on delete cascade,
  insumo_id uuid not null references insumos,
  cantidad numeric not null check (cantidad > 0),
  primary key (caja_insumo_id, insumo_id)
);
create index on caja_insumos (insumo_id);

create table precios (                    -- historial: nunca se pisa, se agrega una fila nueva
  id uuid primary key default gen_random_uuid(),
  formato_id uuid references formatos,    -- solo formato: precio de la caja
  sabor_id uuid references sabores,       -- solo sabor: precio por roll de ese sabor
                                          -- ambos: precio especial (caja de un sabor, o roll en ese formato)
  precio numeric(12, 2) not null check (precio >= 0),
  vigente_desde date not null,
  creado_en timestamptz not null default now(),
  check (formato_id is not null or sabor_id is not null),
  unique nulls not distinct (formato_id, sabor_id, vigente_desde)
);
create index on precios (formato_id);
create index on precios (sabor_id);

create table parametros (
  clave text primary key,
  valor text not null
);

-- PERSONAS -----------------------------------------------------------------

create table clientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  contacto text,                          -- teléfono o @instagram
  origen text,                            -- Familiar, IG, ITSP, Amiga de Mamá, Web, Whatsapp...
  notas text,
  fila_planilla int,
  creado_en timestamptz not null default now()
);
create index on clientes (lower(nombre));

-- MOVIMIENTOS --------------------------------------------------------------

create table ventas (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  cliente_id uuid references clientes,
  origen text,                            -- snapshot del origen de esa venta
  entrega text not null check (entrega in ('envio', 'retiro', 'sin_envio')),
  cobro_envio numeric(12, 2) not null default 0 check (cobro_envio >= 0),
  medio_pago text check (medio_pago in ('efectivo', 'transferencia')),
  estado_pago text not null check (estado_pago in ('pagado', 'pendiente')),
  tipo text not null default 'venta' check (tipo in ('venta', 'consumo_propio', 'regalo')),
  precio_lista numeric(12, 2) not null,   -- snapshot: suma de las líneas
  precio_cobrado numeric(12, 2) not null, -- snapshot (= lista salvo precio especial)
  notas text,
  fila_planilla int,
  creado_por uuid references auth.users on delete set null,
  creado_en timestamptz not null default now()
);
create index on ventas (fecha);
create index on ventas (cliente_id);
create index on ventas (creado_por);

create table venta_lineas (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references ventas on delete cascade,
  formato_id uuid not null references formatos,
  cantidad int not null default 1 check (cantidad > 0), -- cajas (1 para personalizado/unidad)
  caja_insumo_id uuid references insumos, -- null = sin caja. Se usan `cantidad` cajas
  precio_lista numeric(12, 2) not null,   -- snapshot, total de la línea
  costo_caja numeric(12, 2) not null      -- snapshot, total de la línea
);
create index on venta_lineas (venta_id);
create index on venta_lineas (formato_id);
create index on venta_lineas (caja_insumo_id);

create table venta_linea_sabores (
  linea_id uuid not null references venta_lineas on delete cascade,
  sabor_id uuid not null references sabores,
  unidades int not null check (unidades > 0),
  costo_unitario numeric(14, 6) not null, -- snapshot del costo por roll ese día
  primary key (linea_id, sabor_id)
);
create index on venta_linea_sabores (sabor_id);

create table compras (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  proveedor text,
  descripcion text,                       -- 'Harina Uruguay 0000'
  insumo_id uuid references insumos,      -- null = equipamiento u otro
  categoria text not null check (categoria in ('ingrediente', 'packaging', 'equipamiento', 'otro')),
  cantidad numeric,                       -- 5
  unidad text,                            -- 'kg'
  cantidad_base numeric check (cantidad_base > 0), -- 5000 (en unidad_base del insumo)
  total numeric(12, 2) not null,
  notas text,
  fila_planilla int,
  creado_en timestamptz not null default now()
);
create index on compras (fecha);
create index on compras (insumo_id, fecha);

create table tandas (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  sabor_id uuid not null references sabores,
  cantidad numeric not null default 1 check (cantidad > 0), -- tandas
  rolls int not null check (rolls >= 0),
  notas text,
  fila_planilla int,
  creado_en timestamptz not null default now()
);
create index on tandas (fecha);
create index on tandas (sabor_id);

create table tanda_consumos (             -- snapshot de lo que se consumió
  tanda_id uuid not null references tandas on delete cascade,
  insumo_id uuid not null references insumos,
  cantidad numeric not null,
  primary key (tanda_id, insumo_id)
);
create index on tanda_consumos (insumo_id);

create table gastos (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  descripcion text not null,
  tipo text not null check (tipo in
    ('merma', 'tanda_descartada', 'gasto_operativo', 'comision', 'retiro_socios', 'ajuste_caja', 'otro')),
  monto numeric(12, 2) not null,
  rolls int,
  notas text,
  fila_planilla int,
  creado_en timestamptz not null default now()
);
create index on gastos (fecha);

create table conteos (                    -- conteo físico de stock (vale al cierre de `fecha`)
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  insumo_id uuid not null references insumos,
  cantidad numeric not null,
  fila_planilla int,
  creado_en timestamptz not null default now()
);
create index on conteos (insumo_id, fecha);
