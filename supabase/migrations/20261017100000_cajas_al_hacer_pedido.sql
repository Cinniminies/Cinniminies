-- Stock: las cajas de un pedido por hacer se descuentan cuando el pedido se hace, no cuando se carga
-- (pedido de Lucio, 17/10).
--
-- Antes v_stock descontaba las cajas al cargar la venta. Si había un conteo entre la carga y el horneado,
-- las cajas del pedido seguían en el estante y se contaban: el teórico las volvía a sumar y, al hacer el
-- pedido, ya no las descontaba nadie. Pasó con 3 Box de 12 (Weber, Piovano, Long): cargadas el 13 y 16/10,
-- contadas el 16/10, hechas el 17/10 con el Plan de horneado; el conteo del 17/10 dio 0 contra 3 de teórico.
--
-- * ventas.hecho_en: cuándo dejó de estar por hacer (null mientras está por hacer). Lo pone un trigger:
--   al cargarla ya entregada es creado_en; al marcarla hecha (a mano o con registrar_horneado), ese momento.
-- * v_stock y v_movimientos_stock descuentan las cajas en hecho_en. Las de pedidos por hacer no se descuentan.
-- * stock_disponible(): como el teórico ya no descuenta los pedidos por hacer, es igual al teórico.

alter table ventas add column hecho_en timestamptz;
comment on column ventas.hecho_en is 'Cuándo se hizo el pedido (null si está por hacer); las cajas salen del stock acá';

update ventas set hecho_en = creado_en where not por_hacer;

-- Las 4 ventas que se hicieron con el horneado del 17/10 (los rolls del plan: 12 + 12 + 8 + 6).
update ventas set hecho_en = '2026-10-17 17:56:11.351662+00'
 where id in ('326f16dc-0b97-43a3-a84a-468f9a7c88f8', '8cf459d1-0514-4f17-8cf5-9d2f528fd23c',
              'a0d9d02b-34cf-49a9-a274-986d1630ae34', '1abdb33f-f35b-4bca-bae5-07b08b25c555');

create function ventas_hecho_en() returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.por_hacer then
    new.hecho_en := null;
  elsif tg_op = 'INSERT' then
    new.hecho_en := coalesce(new.hecho_en, new.creado_en, now());
  elsif old.por_hacer then
    new.hecho_en := now();
  end if;
  return new;
end;
$$;
revoke all on function public.ventas_hecho_en() from public, anon;

create trigger hecho_en before insert or update of por_hacer on ventas
  for each row execute function ventas_hecho_en();

create or replace view v_movimientos_stock with (security_invoker = true) as
select c.insumo_id, c.fecha, c.creado_en, c.cantidad_base as entrada, 0::numeric as salida
  from compras c
 where c.insumo_id is not null and c.cantidad_base is not null
union all
select tc.insumo_id, t.fecha, t.creado_en, 0, tc.cantidad
  from tanda_consumos tc
  join tandas t on t.id = tc.tanda_id
union all
select l.caja_insumo_id, v.fecha, v.hecho_en, 0, l.cantidad
  from venta_lineas l
  join ventas v on v.id = l.venta_id
 where l.caja_insumo_id is not null and v.hecho_en is not null
union all
select ci.insumo_id, v.fecha, v.hecho_en, 0, l.cantidad * ci.cantidad
  from venta_lineas l
  join ventas v on v.id = l.venta_id
  join caja_insumos ci on ci.caja_insumo_id = l.caja_insumo_id
 where v.hecho_en is not null;

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
  select l.caja_insumo_id, v.hecho_en, 0, 0, l.cantidad
    from venta_lineas l
    join ventas v on v.id = l.venta_id
   where l.caja_insumo_id is not null and v.hecho_en is not null
  union all
  select ci.insumo_id, v.hecho_en, 0, 0, l.cantidad * ci.cantidad
    from venta_lineas l
    join ventas v on v.id = l.venta_id
    join caja_insumos ci on ci.caja_insumo_id = l.caja_insumo_id
   where v.hecho_en is not null
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

-- Lo que hay en el estante: el teórico (las cajas de los pedidos por hacer todavía no salieron).
create or replace function stock_disponible()
returns table (insumo_id uuid, stock numeric)
language sql stable set search_path = public
as $$
  select i.id, coalesce(s.teorico, 0)
    from insumos i
    left join v_stock s on s.insumo_id = i.id;
$$;

-- Teórico y usado de los conteos desde el 13/10 (los que tocan esas 4 ventas), con la regla nueva.
with par as (
  select c.id, c.creado_en, c.insumo_id,
         lag(c.cantidad) over w as ant_cantidad,
         lag(c.creado_en) over w as ant_creado
    from conteos c
  window w as (partition by c.insumo_id order by c.creado_en)
), calc as (
  select p.id,
         p.ant_cantidad + coalesce(sum(m.entrada - m.salida), 0) as teorico,
         coalesce(sum(m.salida), 0) as usado
    from par p
    left join v_movimientos_stock m
      on m.insumo_id = p.insumo_id
     and m.creado_en > p.ant_creado
     and m.creado_en <= p.creado_en
   where p.ant_creado is not null and p.creado_en >= '2026-10-13'
   group by p.id, p.ant_cantidad
)
update conteos c set teorico = calc.teorico, usado = calc.usado
  from calc where calc.id = c.id;
