-- "Hay" también resta las pérdidas (23/10). Igual que una compra, lo perdido se carga medido (la bolsa rota de 1 kg),
-- así que el stock real baja lo mismo que el teórico. Hay = último conteo + compras − pérdidas posteriores.
-- Lo que usan las tandas y las cajas sigue viéndose recién al contar.

create or replace view v_stock with (security_invoker = true) as
with ult as (
  select distinct on (conteos.insumo_id) conteos.insumo_id, conteos.fecha, conteos.creado_en, conteos.cantidad
    from conteos
   order by conteos.insumo_id, conteos.creado_en desc
), movimientos as (
  select c.insumo_id, c.creado_en, c.cantidad_base as entrada, 0::numeric as salida_tandas, 0::numeric as salida_ventas,
         0::numeric as salida_perdidas
    from compras c
   where c.insumo_id is not null and c.cantidad_base is not null
  union all
  select tc.insumo_id, t.creado_en, 0, tc.cantidad, 0, 0
    from tanda_consumos tc
    join tandas t on t.id = tc.tanda_id
  union all
  select l.caja_insumo_id, v.hecho_en, 0, 0, l.cantidad, 0
    from venta_lineas l
    join ventas v on v.id = l.venta_id
   where l.caja_insumo_id is not null and v.hecho_en is not null and v.es_prueba = (select privado.es_prueba())
  union all
  select ci.insumo_id, v.hecho_en, 0, 0, l.cantidad::numeric * ci.cantidad, 0
    from venta_lineas l
    join ventas v on v.id = l.venta_id
    join caja_insumos ci on ci.caja_insumo_id = l.caja_insumo_id
    join insumos pi on pi.id = ci.insumo_id
   where v.hecho_en is not null and v.es_prueba = (select privado.es_prueba()) and v.hecho_en >= pi.creado_en
  union all
  select p.insumo_id, p.creado_en, 0, 0, 0, p.cantidad
    from perdidas p
), desde as (
  select i.id as insumo_id,
         coalesce(sum(m.entrada), 0) as comprado,
         coalesce(sum(m.salida_tandas), 0) as usado_tandas,
         coalesce(sum(m.salida_ventas), 0) as usado_ventas,
         coalesce(sum(m.salida_perdidas), 0) as perdido
    from insumos i
    left join ult u on u.insumo_id = i.id
    left join movimientos m on m.insumo_id = i.id and (u.insumo_id is null or m.creado_en > u.creado_en)
   group by i.id
), calc as (
  select i.id as insumo_id, i.nombre, i.tipo, i.unidad_base,
         u.fecha as fecha_conteo,
         coalesce(u.cantidad, 0) as conteo,
         d.comprado, d.usado_tandas, d.usado_ventas,
         coalesce(u.cantidad, 0) + d.comprado - d.usado_tandas - d.usado_ventas - d.perdido as teorico,
         i.stock_minimo,
         costo_insumo(i.id) as costo_unitario,
         d.perdido,
         coalesce(u.cantidad, 0) + d.comprado - d.perdido as hay
    from insumos i
    join desde d on d.insumo_id = i.id
    left join ult u on u.insumo_id = i.id
   where i.activo
)
select insumo_id, nombre, tipo, unidad_base, fecha_conteo, conteo, comprado, usado_tandas, usado_ventas, teorico,
       stock_minimo, costo_unitario,
       teorico < stock_minimo as reponer,
       round(greatest(teorico, 0) * coalesce(costo_unitario, 0), 2) as valor,
       perdido,
       hay
  from calc;
