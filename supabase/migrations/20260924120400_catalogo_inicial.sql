-- Catálogo inicial (sección 1 del handoff), con precios vigentes desde el 01/05/2026.
-- Desde acá en adelante el catálogo se edita desde /admin, no con migraciones.

insert into parametros (clave, valor) values
  ('precio_envio', '25'),
  ('zona_horaria', 'America/Montevideo');

insert into sabores (nombre, nombre_corto, slug, descripcion, etiqueta_web, activo, visible_web, orden) values
  ('Canela', 'Canela', 'canela',
   'Glaseado simple, relleno de canela, masa esponjosa. El que pide todo el mundo la primera vez.',
   'El clásico', true, true, 1),
  ('Dulce de Leche', 'DDL', 'dulce',
   'El mismo proceso, pero con un relleno de dulce de leche que se derrite adentro al hornear.',
   'Un pequeño reversionado', true, true, 2),
  ('Oreo', 'Oreo', 'oreo',
   'Trozos de oreo dentro de la masa y en el glaseado. ¿Qué esperás para probarlo?',
   'Nuestro producto estrella', true, true, 3),
  ('Nutella', 'Nutella', 'nutella', null, null, true, false, 4),
  -- Cajas viejas mezcladas sin detalle de sabores. Solo para el histórico.
  ('Sin detalle', 'Sin detalle', null, 'Ventas viejas de cajas mezcladas sin detalle (costeadas como Canela).',
   null, false, false, 99);

-- Costo de referencia = última compra al 22/09/2026 (solo se usa si no hay compras cargadas).
insert into insumos (nombre, tipo, unidad_base, stock_minimo, costo_referencia) values
  ('Harina',             'ingrediente', 'g',   450, 209.90 / 5000),
  ('Levadura seca',      'ingrediente', 'g',    10,  66.00 / 120),
  ('Azúcar',             'ingrediente', 'g',   200,  46.00 / 1000),
  ('Leche',              'ingrediente', 'ml',  270,  45.20 / 1000),
  ('Huevos',             'ingrediente', 'un',    2, 180.00 / 30),
  ('Manteca',            'ingrediente', 'g',   120, 367.50 / 1000),
  ('Canela',             'ingrediente', 'g',    12,  76.95 / 100),
  ('Azúcar impalpable',  'ingrediente', 'g',   120,  94.05 / 1000),
  ('Dulce de leche',     'ingrediente', 'g',   240, 204.00 / 1000),
  ('Galletitas Oreo',    'ingrediente', 'paq',   1, 209.87 / 3),
  ('Nutella',            'ingrediente', 'g',   200, 471.00 / 650),
  ('Caja Box de 6',      'packaging',   'un',    1,  30),
  ('Caja Box de 12',     'packaging',   'un',    1,  35),
  ('Papel manteca',      'packaging',   'un',   10,  99.00 / 50),
  ('Stickers',           'packaging',   'un',    5, 100.00 / 15);

-- Recetas por tanda de 12 rolls (sección 1.3).
insert into recetas (sabor_id, insumo_id, cantidad)
select s.id, i.id, r.cantidad
  from (values
    ('Canela', 'Harina', 450), ('Canela', 'Levadura seca', 10), ('Canela', 'Azúcar', 150),
    ('Canela', 'Leche', 270), ('Canela', 'Huevos', 1), ('Canela', 'Manteca', 120),
    ('Canela', 'Canela', 12), ('Canela', 'Azúcar impalpable', 120),

    ('Dulce de Leche', 'Harina', 450), ('Dulce de Leche', 'Levadura seca', 10),
    ('Dulce de Leche', 'Azúcar', 50), ('Dulce de Leche', 'Leche', 240),
    ('Dulce de Leche', 'Huevos', 1), ('Dulce de Leche', 'Manteca', 60),
    ('Dulce de Leche', 'Dulce de leche', 240),

    ('Oreo', 'Harina', 450), ('Oreo', 'Levadura seca', 10), ('Oreo', 'Azúcar', 130),
    ('Oreo', 'Leche', 270), ('Oreo', 'Huevos', 1), ('Oreo', 'Manteca', 120),
    ('Oreo', 'Canela', 8), ('Oreo', 'Azúcar impalpable', 120), ('Oreo', 'Galletitas Oreo', 1),

    ('Nutella', 'Harina', 450), ('Nutella', 'Levadura seca', 10), ('Nutella', 'Azúcar', 50),
    ('Nutella', 'Leche', 240), ('Nutella', 'Huevos', 1), ('Nutella', 'Manteca', 60),
    ('Nutella', 'Nutella', 200)
  ) as r(sabor, insumo, cantidad)
  join sabores s on s.nombre = r.sabor
  join insumos i on i.nombre = r.insumo;

-- Packaging extra por caja (confirmado 24/09).
insert into caja_insumos (caja_insumo_id, insumo_id, cantidad)
select c.id, i.id, x.cantidad
  from (values
    ('Caja Box de 6', 'Papel manteca', 1), ('Caja Box de 6', 'Stickers', 1),
    ('Caja Box de 12', 'Papel manteca', 2), ('Caja Box de 12', 'Stickers', 1)
  ) as x(caja, insumo, cantidad)
  join insumos c on c.nombre = x.caja
  join insumos i on i.nombre = x.insumo;

insert into formatos (nombre, tipo, rolls, min_rolls, max_rolls, caja_insumo_id, activo, visible_web, orden)
select x.nombre, x.tipo, x.rolls, x.min_rolls, x.max_rolls, c.id, x.activo, x.visible_web, x.orden
  from (values
    ('Box de 6',      'caja_fija',     6,    null, null, 'Caja Box de 6',  true,  true,  1),
    ('Box de 12',     'caja_fija',     12,   null, null, 'Caja Box de 12', true,  true,  2),
    ('Personalizado', 'personalizado', null, 3,    12,   null,             true,  true,  3),
    ('Unidad',        'unidad',        null, null, null, null,             true,  false, 4),
    -- Menú viejo, solo para el histórico
    ('Box de 4',      'caja_fija',     4,    null, null, 'Caja Box de 6',  false, false, 90),
    ('Box de 10',     'caja_fija',     10,   null, null, 'Caja Box de 12', false, false, 91)
  ) as x(nombre, tipo, rolls, min_rolls, max_rolls, caja, activo, visible_web, orden)
  left join insumos c on c.nombre = x.caja;

insert into precios (formato_id, sabor_id, precio, vigente_desde)
select f.id, null, x.precio, date '2026-05-01'
  from (values ('Box de 6', 250), ('Box de 12', 450), ('Box de 4', 180), ('Box de 10', 380))
       as x(formato, precio)
  join formatos f on f.nombre = x.formato;

insert into precios (formato_id, sabor_id, precio, vigente_desde)
select null, s.id, x.precio, date '2026-05-01'
  from (values ('Canela', 50), ('Dulce de Leche', 55), ('Oreo', 60), ('Nutella', 65)) as x(sabor, precio)
  join sabores s on s.nombre = x.sabor;
