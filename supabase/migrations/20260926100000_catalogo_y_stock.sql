-- Etapa 3: catálogo editable, stock y "¿Qué compro?".
-- Sabores, insumos y formatos se editan directo en sus tablas (RLS: solo admins). Lo que tiene
-- reglas o toca varias filas a la vez va por funciones.

-- Receta de un sabor: reemplaza todas sus filas. items: [{ insumo_id, cantidad }] (por tanda).
create function guardar_receta(p_sabor uuid, p_items jsonb) returns void
language plpgsql set search_path = public
as $$
begin
  if not exists (select 1 from sabores where id = p_sabor) then
    raise exception 'Sabor inexistente';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as y(insumo_id uuid, cantidad numeric)
               left join insumos i on i.id = y.insumo_id
              where i.id is null or i.tipo <> 'ingrediente') then
    raise exception 'La receta solo puede llevar ingredientes';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as y(insumo_id uuid, cantidad numeric) where y.cantidad < 0) then
    raise exception 'Las cantidades no pueden ser negativas';
  end if;

  delete from recetas where sabor_id = p_sabor;
  insert into recetas (sabor_id, insumo_id, cantidad)
  select p_sabor, y.insumo_id, sum(y.cantidad)
    from jsonb_to_recordset(p_items) as y(insumo_id uuid, cantidad numeric)
   where y.cantidad > 0
   group by y.insumo_id;
end;
$$;

-- Packaging extra que lleva una caja (papel manteca, stickers…). Mismo formato que la receta.
create function guardar_packaging_caja(p_caja uuid, p_items jsonb) returns void
language plpgsql set search_path = public
as $$
begin
  if not exists (select 1 from insumos where id = p_caja and tipo = 'packaging') then
    raise exception 'La caja tiene que ser un insumo de packaging';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as y(insumo_id uuid, cantidad numeric)
               left join insumos i on i.id = y.insumo_id
              where i.id is null or i.tipo <> 'packaging' or i.id = p_caja) then
    raise exception 'Una caja solo puede llevar otros insumos de packaging';
  end if;

  delete from caja_insumos where caja_insumo_id = p_caja;
  insert into caja_insumos (caja_insumo_id, insumo_id, cantidad)
  select p_caja, y.insumo_id, sum(y.cantidad)
    from jsonb_to_recordset(p_items) as y(insumo_id uuid, cantidad numeric)
   where y.cantidad > 0
   group by y.insumo_id;
end;
$$;

-- Precio nuevo (se agrega al historial; nunca se pisa uno anterior). Si ya hay uno para la misma
-- combinación y la misma fecha, se corrige ese.
-- payload: { formato_id?, sabor_id?, precio, vigente_desde? (default hoy) }
create function fijar_precio(p jsonb) returns uuid
language plpgsql set search_path = public
as $$
declare
  v_formato uuid := nullif(p->>'formato_id', '')::uuid;
  v_sabor uuid := nullif(p->>'sabor_id', '')::uuid;
  v_precio numeric := nullif(p->>'precio', '')::numeric;
  v_id uuid;
begin
  if v_formato is null and v_sabor is null then
    raise exception 'Elegí un formato, un sabor o los dos';
  end if;
  if v_precio is null or v_precio < 0 then
    raise exception 'Poné un precio válido';
  end if;
  insert into precios (formato_id, sabor_id, precio, vigente_desde)
  values (v_formato, v_sabor, v_precio, coalesce(nullif(p->>'vigente_desde', '')::date, hoy()))
  on conflict on constraint precios_formato_id_sabor_id_vigente_desde_key
  do update set precio = excluded.precio, creado_en = now()
  returning id into v_id;
  return v_id;
end;
$$;

-- Conteo físico de stock. Devuelve, por insumo, el teórico que había y el desvío (teórico − contado).
-- payload: { fecha? (default hoy), items: [{ insumo_id, cantidad }] }
create function registrar_conteo(p jsonb) returns jsonb
language plpgsql set search_path = public
as $$
declare
  v_fecha date := coalesce(nullif(p->>'fecha', '')::date, hoy());
  x record;
  v_teorico numeric;
  v_resultado jsonb := '[]';
begin
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'No cargaste ninguna cantidad';
  end if;
  for x in select * from jsonb_to_recordset(p->'items') as y(insumo_id uuid, cantidad numeric) loop
    if x.cantidad is null or x.cantidad < 0 then
      raise exception 'Las cantidades contadas no pueden ser negativas';
    end if;
    select teorico into v_teorico from v_stock where insumo_id = x.insumo_id;
    insert into conteos (fecha, insumo_id, cantidad) values (v_fecha, x.insumo_id, x.cantidad);
    v_resultado := v_resultado || jsonb_build_object(
      'insumo_id', x.insumo_id,
      'insumo', (select nombre from insumos where id = x.insumo_id),
      'teorico', v_teorico,
      'contado', x.cantidad,
      'desvio', v_teorico - x.cantidad);
  end loop;
  return v_resultado;
end;
$$;

-- 5.8 "¿Qué compro?": para las tandas planeadas, lo que hace falta de cada insumo contra el stock
-- teórico, redondeado a la presentación de la última compra. p: { "<sabor_id>": tandas, ... }
create function que_comprar(p jsonb)
returns table (insumo_id uuid, insumo text, unidad text, necesario numeric, stock numeric,
               faltante numeric, presentacion numeric, precio_presentacion numeric,
               paquetes int, costo_estimado numeric)
language sql stable set search_path = public
as $$
  with plan as (
    select key::uuid as sabor_id, value::numeric as tandas
      from jsonb_each_text(p)
     where value::numeric > 0
  ), necesidad as (
    select r.insumo_id, sum(r.cantidad * plan.tandas) as necesario
      from plan
      join recetas r on r.sabor_id = plan.sabor_id
     group by r.insumo_id
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
    left join v_stock s on s.insumo_id = i.id
    left join presentacion pr on pr.insumo_id = i.id
    cross join lateral (select greatest(coalesce(s.teorico, 0), 0) as stock) t
    cross join lateral (select greatest(n.necesario - t.stock, 0) as faltante) f
   order by f.faltante = 0, i.nombre;
$$;

-- No se puede cambiar la unidad de un insumo que ya se usó: rompería costos, stock y recetas.
create function privado.proteger_unidad_insumo() returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.unidad_base is distinct from old.unidad_base and (
       exists (select 1 from compras where insumo_id = old.id)
    or exists (select 1 from recetas where insumo_id = old.id)
    or exists (select 1 from tanda_consumos where insumo_id = old.id)
    or exists (select 1 from conteos where insumo_id = old.id)
    or exists (select 1 from caja_insumos where insumo_id = old.id or caja_insumo_id = old.id)) then
    raise exception 'No se puede cambiar la unidad de "%": ya tiene compras, recetas o conteos. Creá un insumo nuevo.', old.nombre;
  end if;
  return new;
end;
$$;
revoke all on function privado.proteger_unidad_insumo() from public, anon;

create trigger proteger_unidad before update of unidad_base on insumos
  for each row execute function privado.proteger_unidad_insumo();

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'guardar_receta(uuid, jsonb)', 'guardar_packaging_caja(uuid, jsonb)', 'fijar_precio(jsonb)',
    'registrar_conteo(jsonb)', 'que_comprar(jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
