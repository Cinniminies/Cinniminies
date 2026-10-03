-- Desvíos de stock (pedido de Lucio, 03/10): en Stock se carga "Hay" al lado del "Teórico" y cada
-- conteo guarda cuánto debería haber y cuánto se usó desde el conteo anterior. Con eso:
--   desvío = teórico − contado (positivo: se usó más de lo que dicen las recetas, o algo no se cargó)
--   % sobre lo usado = desvío / usado, el promedio por insumo sirve para recalcular las recetas.
-- El primer conteo de cada insumo no tiene contra qué compararse: queda sin teórico.

alter table conteos add column teorico numeric, add column usado numeric;
alter table insumos add column receta_ajustada_en timestamptz;
comment on column conteos.teorico is 'Stock teórico al momento de contar (null en el primer conteo del insumo)';
comment on column conteos.usado is 'Lo que usaron las tandas y las cajas vendidas desde el conteo anterior';
comment on column insumos.receta_ajustada_en is 'Última vez que se ajustaron las recetas con el desvío; el promedio cuenta desde ahí';

-- Movimientos de stock: la misma regla que v_stock, para reusar en el cálculo de conteos viejos.
create view v_movimientos_stock with (security_invoker = true) as
select c.insumo_id, c.fecha, c.creado_en, c.cantidad_base as entrada, 0::numeric as salida
  from compras c
 where c.insumo_id is not null and c.cantidad_base is not null
union all
select tc.insumo_id, t.fecha, t.creado_en, 0, tc.cantidad
  from tanda_consumos tc
  join tandas t on t.id = tc.tanda_id
union all
select l.caja_insumo_id, v.fecha, v.creado_en, 0, l.cantidad
  from venta_lineas l
  join ventas v on v.id = l.venta_id
 where l.caja_insumo_id is not null
union all
select ci.insumo_id, v.fecha, v.creado_en, 0, l.cantidad * ci.cantidad
  from venta_lineas l
  join ventas v on v.id = l.venta_id
  join caja_insumos ci on ci.caja_insumo_id = l.caja_insumo_id;
revoke all on public.v_movimientos_stock from anon;
revoke insert, update, delete, truncate on public.v_movimientos_stock from authenticated;

-- Conteos ya cargados: teórico = conteo anterior + movimientos entre los dos conteos.
with par as (
  select c.id, c.fecha, c.creado_en, c.insumo_id,
         lag(c.cantidad) over w as ant_cantidad,
         lag(c.fecha) over w as ant_fecha,
         lag(c.creado_en) over w as ant_creado
    from conteos c
  window w as (partition by c.insumo_id order by c.fecha, c.creado_en)
), calc as (
  select p.id,
         p.ant_cantidad + coalesce(sum(m.entrada - m.salida), 0) as teorico,
         coalesce(sum(m.salida), 0) as usado
    from par p
    left join v_movimientos_stock m
      on m.insumo_id = p.insumo_id
     and (m.fecha, m.creado_en) > (p.ant_fecha, p.ant_creado)
     and (m.fecha, m.creado_en) <= (p.fecha, p.creado_en)
   where p.ant_fecha is not null
   group by p.id, p.ant_cantidad
)
update conteos c set teorico = calc.teorico, usado = calc.usado
  from calc where calc.id = c.id;

-- registrar_conteo guarda el teórico y lo usado (solo si el insumo ya tenía un conteo).
create or replace function registrar_conteo(p jsonb) returns jsonb
language plpgsql set search_path = public
as $$
declare
  v_fecha date := coalesce(nullif(p->>'fecha', '')::date, hoy());
  x record;
  s record;
  v_resultado jsonb := '[]';
begin
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'No cargaste ninguna cantidad';
  end if;
  for x in select * from jsonb_to_recordset(p->'items') as y(insumo_id uuid, cantidad numeric) loop
    if x.cantidad is null or x.cantidad < 0 then
      raise exception 'Las cantidades contadas no pueden ser negativas';
    end if;
    select st.teorico, st.usado_tandas + st.usado_ventas as usado, st.fecha_conteo is not null as tenia
      into s from v_stock st where st.insumo_id = x.insumo_id;
    insert into conteos (fecha, insumo_id, cantidad, teorico, usado)
    values (v_fecha, x.insumo_id, x.cantidad,
            case when s.tenia then s.teorico end, case when s.tenia then s.usado end);
    v_resultado := v_resultado || jsonb_build_object(
      'insumo_id', x.insumo_id,
      'insumo', (select nombre from insumos where id = x.insumo_id),
      'teorico', s.teorico,
      'contado', x.cantidad,
      'desvio', s.teorico - x.cantidad);
  end loop;
  return v_resultado;
end;
$$;

-- Un conteo por fila, con su desvío.
create view v_desvios with (security_invoker = true) as
select c.id,
       c.fecha,
       c.creado_en,
       c.insumo_id,
       i.nombre,
       i.tipo,
       i.unidad_base,
       c.teorico,
       c.cantidad as contado,
       c.teorico - c.cantidad as desvio,
       c.usado,
       case when c.usado > 0 then round((c.teorico - c.cantidad) / c.usado, 4) end as desvio_relativo,
       round((c.teorico - c.cantidad) * coalesce(costo_insumo(i.id), 0), 2) as valor
  from conteos c
  join insumos i on i.id = c.insumo_id
 where c.teorico is not null;
revoke all on public.v_desvios from anon;
revoke insert, update, delete, truncate on public.v_desvios from authenticated;

-- Promedio por insumo desde el último ajuste de recetas: cuánto se usa de más (o de menos) por
-- cada unidad que dicen las recetas y las cajas.
create view v_desvio_insumo with (security_invoker = true) as
select i.id as insumo_id,
       i.nombre,
       i.tipo,
       i.unidad_base,
       i.receta_ajustada_en,
       count(d.id) as conteos,
       coalesce(sum(d.desvio), 0) as desvio,
       coalesce(sum(d.usado), 0) as usado,
       case when sum(d.usado) > 0 then round(sum(d.desvio) / sum(d.usado), 4) end as desvio_relativo,
       coalesce(sum(d.valor), 0) as valor
  from insumos i
  join v_desvios d on d.insumo_id = i.id
                  and (i.receta_ajustada_en is null or d.creado_en > i.receta_ajustada_en)
 where i.activo
 group by i.id;
revoke all on public.v_desvio_insumo from anon;
revoke insert, update, delete, truncate on public.v_desvio_insumo from authenticated;

-- Ajustar las recetas de un ingrediente con un factor (1.08 = 8 % más en todas las recetas).
-- Desde ahí el promedio de desvíos de ese insumo empieza de nuevo.
create function ajustar_recetas_insumo(p_insumo uuid, p_factor numeric) returns int
language plpgsql set search_path = public
as $$
declare
  n int;
begin
  if not exists (select 1 from insumos where id = p_insumo and tipo = 'ingrediente') then
    raise exception 'Solo se pueden ajustar ingredientes';
  end if;
  if p_factor is null or p_factor <= 0 or p_factor > 3 then
    raise exception 'Factor de ajuste inválido';
  end if;
  update recetas set cantidad = round(cantidad * p_factor, 2) where insumo_id = p_insumo;
  get diagnostics n = row_count;
  update insumos set receta_ajustada_en = now() where id = p_insumo;
  return n;
end;
$$;
revoke all on function public.ajustar_recetas_insumo(uuid, numeric) from public, anon;
grant execute on function public.ajustar_recetas_insumo(uuid, numeric) to authenticated;
