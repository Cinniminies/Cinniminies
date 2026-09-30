-- Plan de horneado: cajas y packaging de los pedidos (pedido de Lucio, 30/09).
--
-- Las cajas se descuentan del stock teórico al cargar la venta, aunque el pedido todavía esté por hacer.
-- Para saber si alcanzan, el stock que se compara es el "disponible": el teórico más lo que ya descontaron
-- los pedidos por hacer (esas cajas siguen en el estante). Solo se cuentan las cajas de los pedidos:
-- por ahora no hacen rolls extra, venden el sobrante.
--
-- * stock_disponible(): por insumo, teórico + lo reservado por ventas por hacer (posteriores al último conteo,
--   como v_stock). Para los ingredientes es igual al teórico.
-- * cajas_plan(p): por insumo de packaging, lo que llevan los pedidos elegidos (mismo p que plan_horneado),
--   lo disponible y lo que falta.
-- * que_comprar(p, p_cajas): suma a lo de las recetas el packaging de p_cajas ({ "<insumo_id>": cantidad })
--   y compara contra el stock disponible.

create function stock_disponible()
returns table (insumo_id uuid, stock numeric)
language sql stable set search_path = public
as $$
  with ult as (
    select distinct on (insumo_id) insumo_id, fecha, creado_en
      from conteos
     order by insumo_id, fecha desc, creado_en desc
  ), consumo as (
    select l.caja_insumo_id as insumo_id, v.fecha, v.creado_en, l.cantidad::numeric as cantidad
      from venta_lineas l
      join ventas v on v.id = l.venta_id
     where v.por_hacer and l.caja_insumo_id is not null
    union all
    select ci.insumo_id, v.fecha, v.creado_en, l.cantidad * ci.cantidad
      from venta_lineas l
      join ventas v on v.id = l.venta_id
      join caja_insumos ci on ci.caja_insumo_id = l.caja_insumo_id
     where v.por_hacer
  ), reservado as (
    select c.insumo_id, sum(c.cantidad) as cantidad
      from consumo c
      left join ult u on u.insumo_id = c.insumo_id
     where u.insumo_id is null or (c.fecha, c.creado_en) > (u.fecha, u.creado_en)
     group by c.insumo_id
  )
  select i.id, coalesce(s.teorico, 0) + coalesce(r.cantidad, 0)
    from insumos i
    left join v_stock s on s.insumo_id = i.id
    left join reservado r on r.insumo_id = i.id;
$$;

create function cajas_plan(p jsonb default '{}')
returns table (insumo_id uuid, insumo text, unidad text, necesario numeric, stock numeric, faltante numeric)
language sql stable set search_path = public
as $$
  with elegidas as (
    select v.id from ventas v
     where v.por_hacer
       and (not p ? 'ventas' or v.id in (select x::uuid from jsonb_array_elements_text(p->'ventas') x))
  ), uso as (
    select l.caja_insumo_id as insumo_id, l.cantidad::numeric as cantidad
      from elegidas e
      join venta_lineas l on l.venta_id = e.id
     where l.caja_insumo_id is not null
    union all
    select ci.insumo_id, l.cantidad * ci.cantidad
      from elegidas e
      join venta_lineas l on l.venta_id = e.id
      join caja_insumos ci on ci.caja_insumo_id = l.caja_insumo_id
  ), necesidad as (
    select u.insumo_id, sum(u.cantidad) as necesario from uso u group by u.insumo_id
  )
  select i.id, i.nombre, i.unidad_base, n.necesario, t.stock, greatest(n.necesario - t.stock, 0)
    from necesidad n
    join insumos i on i.id = n.insumo_id
    join stock_disponible() sd on sd.insumo_id = i.id
    cross join lateral (select greatest(sd.stock, 0) as stock) t
   order by (select exists (select 1 from caja_insumos ci where ci.insumo_id = i.id)), i.nombre;
$$;

drop function que_comprar(jsonb);
create function que_comprar(p jsonb, p_cajas jsonb default '{}')
returns table (insumo_id uuid, insumo text, unidad text, necesario numeric, stock numeric,
               faltante numeric, presentacion numeric, precio_presentacion numeric,
               paquetes int, costo_estimado numeric)
language sql stable set search_path = public
as $$
  with plan as (
    select key::uuid as sabor_id, value::numeric as tandas
      from jsonb_each_text(p)
     where value::numeric > 0
  ), pedido as (
    select r.insumo_id, r.cantidad * plan.tandas as cantidad
      from plan
      join recetas r on r.sabor_id = plan.sabor_id
    union all
    select key::uuid, value::numeric
      from jsonb_each_text(coalesce(p_cajas, '{}'))
     where value::numeric > 0
  ), necesidad as (
    select pe.insumo_id, sum(pe.cantidad) as necesario from pedido pe group by pe.insumo_id
  ), presentacion as (
    select distinct on (c.insumo_id) c.insumo_id, c.cantidad_base, c.total
      from compras c
     where c.cantidad_base > 0
     order by c.insumo_id, c.fecha desc, c.creado_en desc
  )
  select i.id, i.nombre, i.unidad_base, n.necesario, t.stock, f.faltante,
         pr.cantidad_base, pr.total,
         case when pr.cantidad_base > 0 then ceil(f.faltante / pr.cantidad_base)::int end,
         round(case when pr.cantidad_base > 0 then ceil(f.faltante / pr.cantidad_base) * pr.total
                    else f.faltante * coalesce(costo_insumo(i.id), 0) end, 2)
    from necesidad n
    join insumos i on i.id = n.insumo_id
    join stock_disponible() sd on sd.insumo_id = i.id
    left join presentacion pr on pr.insumo_id = i.id
    cross join lateral (select greatest(sd.stock, 0) as stock) t
    cross join lateral (select greatest(n.necesario - t.stock, 0) as faltante) f
   order by f.faltante = 0, i.nombre;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array['stock_disponible()', 'cajas_plan(jsonb)', 'que_comprar(jsonb, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
