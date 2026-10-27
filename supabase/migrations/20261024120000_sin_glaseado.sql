-- Rolls sin glaseado (pedido del 24/10/2026).
-- En la base se aplicó en dos partes por el tamaño (sin_glaseado y sin_glaseado_2, desde guardar_lineas): es este archivo entero.
--
-- * insumos.es_glaseado: los ingredientes que van solo en el glaseado (hoy, el azúcar impalpable). Se marca
--   en /admin → Insumos.
-- * venta_linea_sabores.sin_glaseado: de las unidades de ese sabor, cuántas van sin glaseado (se puede
--   marcar solo una parte de la caja). El precio no cambia.
-- * Costo: esos rolls no cuentan el glaseado (costo_glaseado_roll); costo_unitario guarda el promedio de la
--   línea, así v_ventas y los reportes no cambian.
-- * Stock: registrar_tanda acepta sin_glaseado (rolls) y no descuenta el glaseado de esos rolls.
--   registrar_horneado lo pasa con lo que suman los pedidos del plan (sin_glaseado_plan) y lo anota en la tanda.
--
-- Va después de 20261024110000_rolls_sobrantes.sql: registrar_horneado conserva ventas.horneado.

alter table insumos add column es_glaseado boolean not null default false;
update insumos set es_glaseado = true where nombre = 'Azúcar impalpable';

alter table venta_linea_sabores add column sin_glaseado int not null default 0;
alter table venta_linea_sabores add constraint sin_glaseado_valido check (sin_glaseado between 0 and unidades);

-- Costo del glaseado de un roll de ese sabor a esa fecha (0 si la receta no lleva).
create function costo_glaseado_roll(p_sabor uuid, p_fecha date default null) returns numeric
language sql stable set search_path = public
as $$
  select coalesce(sum(r.cantidad * costo_insumo(r.insumo_id, p_fecha)), 0) / max(s.rolls_por_tanda)
    from sabores s
    left join recetas r on r.sabor_id = s.id
                       and r.insumo_id in (select id from insumos where es_glaseado)
   where s.id = p_sabor;
$$;

-- Rolls sin glaseado por sabor en los pedidos por hacer elegidos (mismo criterio que plan_horneado).
create function sin_glaseado_plan(p jsonb default '{}') returns jsonb
language sql stable set search_path = public
as $$
  select coalesce(jsonb_object_agg(sabor_id, n), '{}')
    from (select vs.sabor_id, sum(vs.sin_glaseado)::int as n
            from ventas v
            join venta_lineas l on l.venta_id = v.id
            join venta_linea_sabores vs on vs.linea_id = l.id
           where v.por_hacer
             and (not p ? 'ventas' or v.id in (select x::uuid from jsonb_array_elements_text(p->'ventas') x))
           group by vs.sabor_id
          having sum(vs.sin_glaseado) > 0) t;
$$;

create or replace function calcular_venta(p jsonb) returns jsonb
language plpgsql stable set search_path = public
as $$
declare
  v_fecha date := coalesce(nullif(p->>'fecha', '')::date, hoy());
  v_entrega text := coalesce(nullif(p->>'entrega', ''), 'sin_envio');
  v_linea jsonb;
  v_item jsonb;
  f formatos%rowtype;
  s sabores%rowtype;
  v_cant int;
  v_unidades int;
  v_sin_glaseado int;
  v_rolls int;
  v_n_sabores int;
  v_sabor_unico uuid;
  v_precio numeric;
  v_costo numeric;
  v_precio_linea numeric;
  v_costo_prod_linea numeric;
  v_caja uuid;
  v_costo_caja numeric;
  v_sabores jsonb;
  v_lineas jsonb := '[]';
  v_lista numeric := 0;
  v_costo_prod numeric := 0;
  v_costo_cajas numeric := 0;
  v_rolls_total int := 0;
  v_cobrado numeric;
  v_envio numeric;
begin
  if v_entrega not in ('envio', 'retiro', 'sin_envio') then
    raise exception 'Entrega inválida: %', v_entrega;
  end if;
  if jsonb_typeof(p->'lineas') is distinct from 'array' or jsonb_array_length(p->'lineas') = 0 then
    raise exception 'La venta no tiene nada cargado';
  end if;

  for v_linea in select * from jsonb_array_elements(p->'lineas') loop
    select * into f from formatos where id = nullif(v_linea->>'formato_id', '')::uuid;
    if not found then
      raise exception 'Formato inexistente';
    end if;
    if not f.activo then
      raise exception 'El formato "%" no está activo', f.nombre;
    end if;

    v_cant := coalesce(nullif(v_linea->>'cantidad', '')::int, 1);
    if v_cant < 1 then
      raise exception 'La cantidad de "%" tiene que ser al menos 1', f.nombre;
    end if;
    if f.tipo <> 'caja_fija' and v_cant <> 1 then
      raise exception 'En "%" la cantidad se indica con las unidades de cada sabor', f.nombre;
    end if;

    -- Sabores de la línea
    v_sabores := '[]';
    v_rolls := 0;
    v_n_sabores := 0;
    v_precio_linea := 0;
    v_costo_prod_linea := 0;
    for v_item in select * from jsonb_array_elements(coalesce(v_linea->'sabores', '[]')) loop
      v_unidades := coalesce(nullif(v_item->>'unidades', '')::int, 0);
      continue when v_unidades = 0;
      if v_unidades < 0 then
        raise exception 'Las unidades no pueden ser negativas';
      end if;
      select * into s from sabores where id = nullif(v_item->>'sabor_id', '')::uuid;
      if not found then
        raise exception 'Sabor inexistente';
      end if;
      if not s.activo then
        raise exception 'El sabor "%" no está activo', s.nombre;
      end if;
      if v_sabores @> jsonb_build_array(jsonb_build_object('sabor_id', s.id)) then
        raise exception 'El sabor "%" está repetido en "%"', s.nombre, f.nombre;
      end if;
      v_sin_glaseado := coalesce(nullif(v_item->>'sin_glaseado', '')::int, 0);
      if v_sin_glaseado < 0 or v_sin_glaseado > v_unidades then
        raise exception 'De % rolls de "%" no pueden ir % sin glaseado', v_unidades, s.nombre, v_sin_glaseado;
      end if;

      v_costo := costo_roll(s.id, v_fecha);
      if v_costo is null then
        raise exception 'No puedo calcular el costo de "%": falta la receta o el costo de algún insumo', s.nombre;
      end if;
      -- Los sin glaseado no llevan el glaseado: costo promedio de los rolls de este sabor
      if v_sin_glaseado > 0 then
        v_costo := v_costo - costo_glaseado_roll(s.id, v_fecha) * v_sin_glaseado / v_unidades;
      end if;

      if f.tipo <> 'caja_fija' then
        v_precio := coalesce(precio_vigente(f.id, s.id, v_fecha), precio_vigente(null, s.id, v_fecha));
        if v_precio is null then
          raise exception 'No hay precio por unidad para "%" al %', s.nombre, v_fecha;
        end if;
        v_precio_linea := v_precio_linea + v_unidades * v_precio;
      end if;

      v_sabores := v_sabores || jsonb_build_object(
        'sabor_id', s.id, 'sabor', s.nombre, 'unidades', v_unidades, 'costo_unitario', v_costo,
        'sin_glaseado', v_sin_glaseado);
      v_rolls := v_rolls + v_unidades;
      v_n_sabores := v_n_sabores + 1;
      v_sabor_unico := s.id;
      v_costo_prod_linea := v_costo_prod_linea + v_unidades * v_costo;
    end loop;

    if v_n_sabores = 0 then
      raise exception 'Elegí los sabores de "%"', f.nombre;
    end if;

    -- 5.4 Validaciones de cantidad de rolls
    if f.tipo = 'caja_fija' and v_rolls <> f.rolls * v_cant then
      raise exception '% × "%" lleva % rolls y cargaste %', v_cant, f.nombre, f.rolls * v_cant, v_rolls;
    end if;
    if f.tipo = 'personalizado'
       and (v_rolls < coalesce(f.min_rolls, 1) or v_rolls > coalesce(f.max_rolls, v_rolls)) then
      raise exception '"%" va de % a % rolls y cargaste %',
        f.nombre, coalesce(f.min_rolls, 1), coalesce(f.max_rolls, v_rolls), v_rolls;
    end if;

    -- 5.3 Precio de una caja fija: el especial de ese sabor si es de un solo sabor, si no el general
    if f.tipo = 'caja_fija' then
      v_precio := case when v_n_sabores = 1 then precio_vigente(f.id, v_sabor_unico, v_fecha) end;
      v_precio := coalesce(v_precio, precio_vigente(f.id, null, v_fecha));
      if v_precio is null then
        raise exception 'No hay precio para "%" al %', f.nombre, v_fecha;
      end if;
      v_precio_linea := v_precio * v_cant;
    end if;

    -- Caja: la indicada (null = sin caja) o la de siempre
    if v_linea ? 'caja_insumo_id' then
      v_caja := nullif(v_linea->>'caja_insumo_id', '')::uuid;
    elsif f.tipo = 'caja_fija' then
      v_caja := f.caja_insumo_id;
    elsif f.tipo = 'personalizado' then
      v_caja := caja_sugerida(v_rolls);
    else
      v_caja := null;
    end if;
    v_costo_caja := 0;
    if v_caja is not null then
      if not exists (select 1 from insumos where id = v_caja and tipo = 'packaging') then
        raise exception 'La caja elegida no es un insumo de packaging';
      end if;
      v_costo := costo_caja(v_caja, v_fecha);
      if v_costo is null then
        raise exception 'No hay costo para la caja o su packaging: cargá una compra o un costo de referencia';
      end if;
      v_costo_caja := round(v_costo * v_cant, 2);
    end if;

    v_lineas := v_lineas || jsonb_build_object(
      'formato_id', f.id, 'formato', f.nombre, 'tipo', f.tipo, 'cantidad', v_cant,
      'rolls', v_rolls, 'caja_insumo_id', v_caja, 'precio_lista', v_precio_linea,
      'costo_produccion', round(v_costo_prod_linea, 2), 'costo_caja', v_costo_caja,
      'sabores', v_sabores);
    v_lista := v_lista + v_precio_linea;
    v_costo_prod := v_costo_prod + v_costo_prod_linea;
    v_costo_cajas := v_costo_cajas + v_costo_caja;
    v_rolls_total := v_rolls_total + v_rolls;
  end loop;

  v_cobrado := coalesce(nullif(p->>'precio_especial', '')::numeric, v_lista);
  if v_cobrado < 0 then
    raise exception 'El precio especial no puede ser negativo';
  end if;
  v_envio := case
    when v_entrega <> 'envio' then 0
    else coalesce(nullif(p->>'cobro_envio', '')::numeric,
                  (select valor::numeric from parametros where clave = 'precio_envio'), 0)
  end;

  return jsonb_build_object(
    'fecha', v_fecha,
    'entrega', v_entrega,
    'rolls', v_rolls_total,
    'precio_lista', v_lista,
    'precio_cobrado', v_cobrado,
    'descuento', v_lista - v_cobrado,
    'cobro_envio', v_envio,
    'costo_produccion', round(v_costo_prod, 2),
    'costo_caja', v_costo_cajas,
    'ganancia', round(v_cobrado + v_envio - v_costo_prod - v_costo_cajas, 2),
    'lineas', v_lineas);
end;
$$;

create or replace function guardar_lineas(p_venta uuid, p_lineas jsonb) returns void
language plpgsql set search_path = public
as $$
declare
  l jsonb;
  v_linea uuid;
begin
  for l in select * from jsonb_array_elements(p_lineas) loop
    insert into venta_lineas (venta_id, formato_id, cantidad, caja_insumo_id, precio_lista, costo_caja)
    values (p_venta, (l->>'formato_id')::uuid, (l->>'cantidad')::int,
            nullif(l->>'caja_insumo_id', '')::uuid, (l->>'precio_lista')::numeric,
            (l->>'costo_caja')::numeric)
    returning id into v_linea;

    insert into venta_linea_sabores (linea_id, sabor_id, unidades, costo_unitario, sin_glaseado)
    select v_linea, x.sabor_id, x.unidades, x.costo_unitario, coalesce(x.sin_glaseado, 0)
      from jsonb_to_recordset(l->'sabores') as x(sabor_id uuid, unidades int, costo_unitario numeric, sin_glaseado int);
  end loop;
end;
$$;

create or replace function registrar_tanda(p jsonb) returns jsonb
language plpgsql set search_path = public
as $$
declare
  s sabores%rowtype;
  v_fecha date := coalesce(nullif(p->>'fecha', '')::date, hoy());
  v_cant numeric := coalesce(nullif(p->>'cantidad', '')::numeric, 1);
  v_rolls int;
  v_sin_glaseado int := coalesce(nullif(p->>'sin_glaseado', '')::int, 0);
  v_tanda uuid;
begin
  select * into s from sabores where id = nullif(p->>'sabor_id', '')::uuid;
  if not found then
    raise exception 'Sabor inexistente';
  end if;
  if v_cant <= 0 then
    raise exception 'La cantidad de tandas tiene que ser mayor a 0';
  end if;
  if not exists (select 1 from recetas where sabor_id = s.id and cantidad > 0) then
    raise exception 'El sabor "%" no tiene receta cargada', s.nombre;
  end if;
  v_rolls := coalesce(nullif(p->>'rolls', '')::int, round(v_cant * s.rolls_por_tanda)::int);
  if v_sin_glaseado < 0 or v_sin_glaseado > v_rolls then
    raise exception 'Los rolls sin glaseado tienen que ir de 0 a %', v_rolls;
  end if;

  insert into tandas (fecha, sabor_id, cantidad, rolls, notas)
  values (v_fecha, s.id, v_cant, v_rolls, nullif(trim(p->>'notas'), ''))
  returning id into v_tanda;

  -- El glaseado se descuenta solo por los rolls que lo llevan
  insert into tanda_consumos (tanda_id, insumo_id, cantidad)
  select v_tanda, r.insumo_id,
         case when i.es_glaseado
              then r.cantidad * greatest(v_cant - v_sin_glaseado::numeric / s.rolls_por_tanda, 0)
              else r.cantidad * v_cant end
    from recetas r
    join insumos i on i.id = r.insumo_id
   where r.sabor_id = s.id and r.cantidad > 0;

  return jsonb_build_object('tanda_id', v_tanda, 'fecha', v_fecha, 'sabor', s.nombre,
                            'cantidad', v_cant, 'rolls', v_rolls, 'sin_glaseado', v_sin_glaseado);
end;
$$;

create or replace function registrar_horneado(p jsonb default '{}') returns jsonb
language plpgsql set search_path = public
as $$
declare
  v_plan jsonb := plan_horneado(p);
  v_sin jsonb := sin_glaseado_plan(p);
  v_fecha date := coalesce(nullif(p->>'fecha', '')::date, hoy());
  s jsonb;
  v_n int;
  v_tandas int := 0;
  v_ventas int;
begin
  if jsonb_array_length(v_plan->'sabores') = 0 then
    raise exception 'No hay nada para hornear';
  end if;
  for s in select * from jsonb_array_elements(v_plan->'sabores') loop
    v_n := least(coalesce((v_sin->>(s->>'sabor_id'))::int, 0), (s->>'rolls')::int);
    perform registrar_tanda(jsonb_build_object(
      'fecha', v_fecha, 'sabor_id', s->>'sabor_id', 'cantidad', s->'tandas', 'rolls', s->'rolls',
      'sin_glaseado', v_n,
      'notas', 'Plan de horneado' || case when v_n > 0 then ' · ' || v_n || ' sin glaseado' else '' end));
    v_tandas := v_tandas + 1;
  end loop;

  update ventas v set por_hacer = false, horneado = v_fecha
   where v.por_hacer
     and (not p ? 'ventas' or v.id in (select x::uuid from jsonb_array_elements_text(p->'ventas') x));
  get diagnostics v_ventas = row_count;

  return v_plan || jsonb_build_object('fecha', v_fecha, 'tandas_registradas', v_tandas, 'ventas_hechas', v_ventas);
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array['costo_glaseado_roll(uuid, date)', 'sin_glaseado_plan(jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
