-- Plan de horneado: cada sabor va entero en una sola tanda mezclada (pedido de Lucio, 30/09).
--
-- Antes, los sobrantes se volcaban en orden y un sabor podía quedar partido entre dos tandas
-- (por ejemplo Nutella 7 en una y 2 en otra). Ahora:
--   1. Los sobrantes de masa compartida (menos el sabor para completar) se acomodan enteros, de mayor
--      a menor, en la primera tanda mezclada donde entren; si no entran en ninguna, abren otra.
--   2. El sabor para completar (Canela por defecto) llena los lugares libres de todas las tandas
--      mezcladas: es el que rellena igual, así que sus pedidos pueden ir en cualquiera. Si no alcanza el
--      lugar, lo que falta va en tandas enteras de ese sabor.
-- Con los sabores de hoy (Nutella y DDL además de Canela) nunca hace falta una tanda más que antes.
-- Si se suman sabores, no partirlos puede costar una tanda más (por ejemplo 7 + 7 + 7 de tres sabores sin Canela).
-- La salida no cambia de forma.

create or replace function plan_horneado(p jsonb default '{}') returns jsonb
language plpgsql stable set search_path = public
as $$
declare
  v_completar uuid := nullif(p->>'completar', '')::uuid;
  v_nombre_completar text;
  v_tam int;
  s record;
  r jsonb;
  v_n int;
  v_k int;
  v_resto int;
  v_resto_completar int := 0;
  v_sola_completar int := 0;          -- tandas enteras del sabor para completar
  v_restos jsonb := '[]';             -- sobrantes a acomodar: [{ sabor_id, nombre, rolls }]
  v_mezclas jsonb := '[]';            -- tandas mezcladas en armado: [{ lleno, sabores }]
  v_tandas jsonb := '[]';
  v_i int;
  v_libre int;
  v_sabores jsonb;
begin
  if v_completar is not null and not exists (
       select 1 from sabores where id = v_completar and not masa_propia and activo) then
    raise exception 'El sabor para completar tiene que ser de masa compartida y estar activo';
  end if;
  if v_completar is null then
    select id into v_completar from sabores
     where activo and not masa_propia and exists (select 1 from recetas r where r.sabor_id = sabores.id)
     order by orden, nombre limit 1;
  end if;
  select nombre, rolls_por_tanda into v_nombre_completar, v_tam from sabores where id = v_completar;
  v_tam := coalesce(v_tam, 12);

  for s in
    with elegidas as (
      select v.id from ventas v
       where v.por_hacer
         and (not p ? 'ventas' or v.id in (select x::uuid from jsonb_array_elements_text(p->'ventas') x))
    ), pedidos as (
      select vs.sabor_id, sum(vs.unidades)::int as rolls
        from elegidas e
        join venta_lineas l on l.venta_id = e.id
        join venta_linea_sabores vs on vs.linea_id = l.id
       group by vs.sabor_id
    ), extra as (
      select key::uuid as sabor_id, greatest(coalesce(nullif(value, '')::numeric, 0), 0)::int as rolls
        from jsonb_each_text(coalesce(p->'extra', '{}'))
    )
    select sa.id, sa.nombre, sa.masa_propia, sa.rolls_por_tanda,
           coalesce(pe.rolls, 0) as pedidos, coalesce(ex.rolls, 0) as extra
      from sabores sa
      left join pedidos pe on pe.sabor_id = sa.id
      left join extra ex on ex.sabor_id = sa.id
     where coalesce(pe.rolls, 0) + coalesce(ex.rolls, 0) > 0
     order by sa.masa_propia desc, sa.orden, sa.nombre
  loop
    v_n := s.pedidos + s.extra;
    if s.masa_propia then
      v_k := ceil(v_n::numeric / s.rolls_por_tanda);
      v_resto := 0;
    else
      v_k := v_n / s.rolls_por_tanda;
      v_resto := v_n - v_k * s.rolls_por_tanda;
    end if;
    if s.id = v_completar then
      -- Sus tandas enteras se suman al final, junto con las que hagan falta para lo que no entre.
      v_sola_completar := v_k;
      v_resto_completar := v_resto;
    else
      if v_k > 0 then
        v_tandas := v_tandas || jsonb_build_object('tipo', 'sola', 'cantidad', v_k, 'rolls', v_k * s.rolls_por_tanda,
          'sabores', jsonb_build_array(jsonb_build_object('sabor_id', s.id, 'nombre', s.nombre, 'rolls', v_k * s.rolls_por_tanda)));
      end if;
      if v_resto > 0 then
        v_restos := v_restos || jsonb_build_object('sabor_id', s.id, 'nombre', s.nombre, 'rolls', v_resto);
      end if;
    end if;
  end loop;

  -- 1. Cada sobrante entero, de mayor a menor, en la primera tanda mezclada donde entre.
  for r in select x from jsonb_array_elements(v_restos) x order by (x->>'rolls')::int desc loop
    select min(o - 1) into v_i
      from jsonb_array_elements(v_mezclas) with ordinality m(x, o)
     where (x->>'lleno')::int + (r->>'rolls')::int <= v_tam;
    if v_i is null then
      v_mezclas := v_mezclas || jsonb_build_object('lleno', r->'rolls', 'sabores', jsonb_build_array(r));
    else
      v_mezclas := jsonb_set(v_mezclas, array[v_i::text], jsonb_build_object(
        'lleno', (v_mezclas->v_i->>'lleno')::int + (r->>'rolls')::int,
        'sabores', (v_mezclas->v_i->'sabores') || r));
    end if;
  end loop;

  -- 2. El sabor para completar va a los lugares libres; lo que no entra, en tandas enteras suyas.
  select coalesce(sum(v_tam - (x->>'lleno')::int), 0) into v_libre from jsonb_array_elements(v_mezclas) x;
  if v_completar is not null and v_resto_completar > v_libre then
    v_sola_completar := v_sola_completar + ceil((v_resto_completar - v_libre)::numeric / v_tam)::int;
  end if;
  if v_sola_completar > 0 then
    v_tandas := v_tandas || jsonb_build_object('tipo', 'sola', 'cantidad', v_sola_completar, 'rolls', v_sola_completar * v_tam,
      'sabores', jsonb_build_array(jsonb_build_object('sabor_id', v_completar, 'nombre', v_nombre_completar,
                                                      'rolls', v_sola_completar * v_tam)));
  end if;
  for r in select x from jsonb_array_elements(v_mezclas) x loop
    v_libre := v_tam - (r->>'lleno')::int;
    v_tandas := v_tandas || jsonb_build_object('tipo', 'mezcla', 'cantidad', 1,
      'rolls', case when v_completar is null then (r->>'lleno')::int else v_tam end,
      'sabores', (r->'sabores') || case when v_completar is not null and v_libre > 0
        then jsonb_build_array(jsonb_build_object('sabor_id', v_completar, 'nombre', v_nombre_completar, 'rolls', v_libre))
        else '[]'::jsonb end);
  end loop;

  -- Resumen por sabor: lo que se hace sale de las tandas armadas.
  with elegidas as (
    select v.id from ventas v
     where v.por_hacer
       and (not p ? 'ventas' or v.id in (select x::uuid from jsonb_array_elements_text(p->'ventas') x))
  ), pedidos as (
    select vs.sabor_id, sum(vs.unidades)::int as rolls
      from elegidas e
      join venta_lineas l on l.venta_id = e.id
      join venta_linea_sabores vs on vs.linea_id = l.id
     group by vs.sabor_id
  ), hace as (
    select (x->>'sabor_id')::uuid as sabor_id, sum((x->>'rolls')::int)::int as rolls
      from jsonb_array_elements(v_tandas) t, jsonb_array_elements(t->'sabores') x
     group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'sabor_id', sa.id, 'nombre', sa.nombre, 'masa_propia', sa.masa_propia,
           'pedidos', coalesce(pe.rolls, 0),
           'extra', greatest(coalesce(nullif(p->'extra'->>sa.id::text, '')::numeric, 0), 0)::int,
           'rolls', ha.rolls,
           'para_vender', ha.rolls - coalesce(pe.rolls, 0),
           'tandas', round(ha.rolls::numeric / sa.rolls_por_tanda, 4))
         order by sa.masa_propia desc, sa.orden, sa.nombre), '[]')
    into v_sabores
    from hace ha
    join sabores sa on sa.id = ha.sabor_id
    left join pedidos pe on pe.sabor_id = sa.id
   where ha.rolls > 0;

  return jsonb_build_object(
    'completar', v_completar,
    'total_tandas', coalesce((select sum((t->>'cantidad')::int) from jsonb_array_elements(v_tandas) t), 0),
    'sabores', v_sabores,
    'tandas', v_tandas);
end;
$$;
