-- Stock: lo que entra en un conteo se decide por cuándo se cargó, no por la fecha (pedido de Lucio, 04/10).
--
-- Lucio cuenta después de registrar cada producción. El 04/10 registró un horneado desde el Plan con la
-- fecha del día planificado (10/10); como la fecha era posterior al conteo, v_stock lo volvió a restar
-- después de contar. Ahora todo lo que se cargó antes del conteo ya está incluido en lo contado, tenga la
-- fecha que tenga, y el último conteo es el último que se cargó.

create or replace view v_stock with (security_invoker = true) as
with ult as (
  select distinct on (insumo_id) insumo_id, fecha, creado_en, cantidad
    from conteos
   order by insumo_id, creado_en desc
), movimientos as (
  select c.insumo_id, c.creado_en, c.cantidad_base as entrada, 0::numeric as salida_tandas,
         0::numeric as salida_ventas
    from compras c
   where c.insumo_id is not null and c.cantidad_base is not null
  union all
  select tc.insumo_id, t.creado_en, 0, tc.cantidad, 0
    from tanda_consumos tc
    join tandas t on t.id = tc.tanda_id
  union all
  select l.caja_insumo_id, v.creado_en, 0, 0, l.cantidad
    from venta_lineas l
    join ventas v on v.id = l.venta_id
   where l.caja_insumo_id is not null
  union all
  select ci.insumo_id, v.creado_en, 0, 0, l.cantidad * ci.cantidad
    from venta_lineas l
    join ventas v on v.id = l.venta_id
    join caja_insumos ci on ci.caja_insumo_id = l.caja_insumo_id
), desde as (
  select i.id as insumo_id,
         coalesce(sum(m.entrada), 0) as comprado,
         coalesce(sum(m.salida_tandas), 0) as usado_tandas,
         coalesce(sum(m.salida_ventas), 0) as usado_ventas
    from insumos i
    left join ult u on u.insumo_id = i.id
    left join movimientos m
      on m.insumo_id = i.id
     and (u.insumo_id is null or m.creado_en > u.creado_en)
   group by i.id
), calc as (
  select i.id as insumo_id,
         i.nombre,
         i.tipo,
         i.unidad_base,
         u.fecha as fecha_conteo,
         coalesce(u.cantidad, 0) as conteo,
         d.comprado,
         d.usado_tandas,
         d.usado_ventas,
         coalesce(u.cantidad, 0) + d.comprado - d.usado_tandas - d.usado_ventas as teorico,
         i.stock_minimo,
         costo_insumo(i.id) as costo_unitario
    from insumos i
    join desde d on d.insumo_id = i.id
    left join ult u on u.insumo_id = i.id
   where i.activo
)
select calc.*,
       teorico < stock_minimo as reponer,
       round(greatest(teorico, 0) * coalesce(costo_unitario, 0), 2) as valor
  from calc;

-- Lo reservado por pedidos por hacer: la misma regla que v_stock.
create or replace function stock_disponible()
returns table (insumo_id uuid, stock numeric)
language sql stable set search_path = public
as $$
  with ult as (
    select distinct on (insumo_id) insumo_id, creado_en
      from conteos
     order by insumo_id, creado_en desc
  ), consumo as (
    select l.caja_insumo_id as insumo_id, v.creado_en, l.cantidad::numeric as cantidad
      from venta_lineas l
      join ventas v on v.id = l.venta_id
     where v.por_hacer and l.caja_insumo_id is not null
    union all
    select ci.insumo_id, v.creado_en, l.cantidad * ci.cantidad
      from venta_lineas l
      join ventas v on v.id = l.venta_id
      join caja_insumos ci on ci.caja_insumo_id = l.caja_insumo_id
     where v.por_hacer
  ), reservado as (
    select c.insumo_id, sum(c.cantidad) as cantidad
      from consumo c
      left join ult u on u.insumo_id = c.insumo_id
     where u.insumo_id is null or c.creado_en > u.creado_en
     group by c.insumo_id
  )
  select i.id, coalesce(s.teorico, 0) + coalesce(r.cantidad, 0)
    from insumos i
    left join v_stock s on s.insumo_id = i.id
    left join reservado r on r.insumo_id = i.id;
$$;
