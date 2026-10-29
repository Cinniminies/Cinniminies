-- Insumos que se descuentan solos (29/10): los que no se pueden medir después de usarlos, como el papel manteca
-- (queda enrollado y no se sabe cuántos cm quedan). Para ellos "Hay" es lo que debería haber: el último conteo
-- (o nada) más las compras, menos lo que gastaron las cajas hechas, las tandas y las pérdidas. No se cuentan.
-- Los demás insumos siguen igual: Hay = último conteo + compras − pérdidas posteriores.

alter table insumos add column se_descuenta_solo boolean not null default false;
comment on column insumos.se_descuenta_solo is
  'No se cuenta: su stock real es el teórico (lo comprado menos lo que usan las cajas, las tandas y las pérdidas).';

update insumos set se_descuenta_solo = true where nombre = 'Papel manteca';

-- Igual a la vista aplicada hasta hoy (con las ventas de prueba separadas y el packaging desde su alta); cambia
-- "hay" y se agrega se_descuenta_solo al final.
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
         i.se_descuenta_solo
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
       case when se_descuenta_solo then teorico else conteo + comprado - perdido end as hay,
       se_descuenta_solo
  from calc;

-- Textos nuevos del panel (editables en /admin → Web, sección "Panel de gestión").
insert into contenido_web (clave, seccion, orden, etiqueta, ayuda, tipo, valor, original)
select clave, 'Panel de gestión', orden, etiqueta, ayuda, 'texto', valor, valor from (values
  ('panel.stock_solo', 9, 'Insumo que se descuenta solo',
    'En Producción → Stock, en la columna Registro de los insumos que no se cuentan (como el papel manteca).',
    'se descuenta solo'),
  ('panel.stock_solo_ayuda', 10, 'Ayuda del interruptor "Se descuenta solo"',
    'En la ficha de cada insumo, debajo del interruptor.',
    'Para lo que no se puede medir después de usarlo, como el papel manteca. No se cuenta: su stock baja solo con cada caja hecha y cada tanda.')
) as t(clave, orden, etiqueta, ayuda, valor)
on conflict (clave) do nothing;
