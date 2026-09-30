-- Reparte las últimas 11 cajas históricas "Sin detalle" (72 rolls, 05/06 al 16/07) entre sabores
-- reales, por estadística, y borra el sabor "Sin detalle".
--
-- Criterio (29/09/2026):
-- 1. Clientes que siempre compraron lo mismo: todo ese sabor.
--    · Liliana Perg (5 cajas): todas sus compras conocidas, antes y después, son 100 % Canela.
--    · Andreina Guarino (2 cajas): Canela en todas sus compras hasta agosto (y 2 Canela al día siguiente).
-- 2. Giovanna Firpo (02/07): siempre mezcla mitad Canela y mitad del sabor nuevo; la otra mitad se
--    reparte como la mezcla DDL/Oreo de esa semana (13 a 10) → Canela 3, DDL 2, Oreo 1.
-- 3. Clientes con una sola compra: mezcla de sabores del período (sin las "Sin detalle"),
--    redondeada a la caja por mayor resto.
--    · 05/06 a 01/07 (Canela 57 %, DDL 43 %): Rosana Nuñez → Canela 3, DDL 3.
--    · 02/07 a 03/07 (Canela 45 %, DDL 31 %, Oreo 24 %): Martin Diaz → Canela 3, DDL 2, Oreo 1.
--    · 09/07 a 16/07 (Canela 61 %, Oreo 22 %, DDL 17 %): Alejandra Gutierrez → Canela 4, DDL 1, Oreo 1.
-- Resultado: Canela 61, DDL 8, Oreo 3.
--
-- Costo por roll: el mismo snapshot que tienen las otras ventas de ese sabor en esa fecha
-- (15 y 16/07 usan el del 09/07, la última venta anterior con costos del período).
-- Las líneas se identifican por la fila de la planilla (ventas.fila_planilla).

create temp table reparto (fila int, sabor text, unidades int, costo numeric) on commit drop;
insert into reparto values
  (35, 'Canela', 3, 10.223765), (35, 'Dulce de Leche', 3, 9.800961),    -- Rosana Nuñez 05/06
  (39, 'Canela', 12, 10.223765),                                         -- Andreina Guarino 05/06
  (45, 'Canela', 6, 10.184278),                                          -- Liliana Perg 12/06
  (49, 'Canela', 6, 10.094278),                                          -- Liliana Perg 18/06
  (52, 'Canela', 3, 9.617694), (52, 'Dulce de Leche', 2, 9.408528),
  (52, 'Oreo', 1, 15.112417),                                            -- Giovanna Firpo 02/07
  (53, 'Canela', 6, 9.617694),                                           -- Liliana Perg 02/07
  (56, 'Canela', 3, 9.617694), (56, 'Dulce de Leche', 2, 9.408528),
  (56, 'Oreo', 1, 15.112417),                                            -- Martin Diaz 02/07
  (57, 'Canela', 6, 9.617694),                                           -- Liliana Perg 03/07
  (65, 'Canela', 4, 9.680694), (65, 'Dulce de Leche', 1, 9.464528),
  (65, 'Oreo', 1, 15.175417),                                            -- Alejandra Gutierrez 09/07
  (69, 'Canela', 6, 9.680694),                                           -- Liliana Perg 15/07
  (70, 'Canela', 6, 9.680694);                                           -- Andreina Guarino 16/07

do $$
declare
  sd uuid := (select id from sabores where nombre = 'Sin detalle');
  lineas int;
begin
  if sd is null then
    raise exception 'No existe el sabor "Sin detalle"';
  end if;

  -- Cada línea a repartir tiene que ser la única "Sin detalle" de su venta y sumar lo mismo.
  select count(*) into lineas
    from venta_linea_sabores vls
    join venta_lineas l on l.id = vls.linea_id
    join ventas v on v.id = l.venta_id
   where vls.sabor_id = sd
     and vls.unidades = (select sum(r.unidades) from reparto r where r.fila = v.fila_planilla);
  if lineas <> 11 or (select count(*) from venta_linea_sabores where sabor_id = sd) <> 11 then
    raise exception 'Las líneas "Sin detalle" no son las esperadas (%); no se toca nada', lineas;
  end if;

  insert into venta_linea_sabores (linea_id, sabor_id, unidades, costo_unitario)
  select vls.linea_id, s.id, r.unidades, r.costo
    from venta_linea_sabores vls
    join venta_lineas l on l.id = vls.linea_id
    join ventas v on v.id = l.venta_id
    join reparto r on r.fila = v.fila_planilla
    join sabores s on s.nombre = r.sabor
   where vls.sabor_id = sd;

  delete from venta_linea_sabores where sabor_id = sd;

  if eliminar_sabor(sd) <> 'borrado' then
    raise exception 'El sabor "Sin detalle" sigue en uso';
  end if;
end;
$$;
