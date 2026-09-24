-- Reglas de negocio (sección 5 del handoff). Viven en la base para que la app,
-- los exportes y los futuros pedidos web usen exactamente la misma regla.
-- Todas son `security invoker`: corren con los permisos (y la RLS) de quien llama.

-- Fecha de hoy en Montevideo (o la zona que diga `parametros`).
create function hoy() returns date
language sql stable set search_path = public
as $$
  select (now() at time zone coalesce(
    (select valor from parametros where clave = 'zona_horaria'), 'America/Montevideo'))::date;
$$;

-- 5.1 Costo por unidad base de un insumo en una fecha: total / cantidad_base de la
-- última compra con cantidad a esa fecha. Si no hay, el costo de referencia del insumo.
create function costo_insumo(p_insumo uuid, p_fecha date default null) returns numeric
language sql stable set search_path = public
as $$
  select coalesce(
    (select c.total / c.cantidad_base
       from compras c
      where c.insumo_id = p_insumo
        and c.cantidad_base > 0
        and c.fecha <= coalesce(p_fecha, hoy())
      order by c.fecha desc, c.creado_en desc
      limit 1),
    (select i.costo_referencia from insumos i where i.id = p_insumo));
$$;

-- 5.2 Costo de una tanda de un sabor. Null si falta la receta o el costo de algún insumo.
create function costo_tanda(p_sabor uuid, p_fecha date default null) returns numeric
language sql stable set search_path = public
as $$
  select case when count(*) > 0 and bool_and(x.costo is not null)
              then sum(x.cantidad * x.costo) end
    from (select r.cantidad, costo_insumo(r.insumo_id, p_fecha) as costo
            from recetas r
           where r.sabor_id = p_sabor and r.cantidad > 0) x;
$$;

create function costo_roll(p_sabor uuid, p_fecha date default null) returns numeric
language sql stable set search_path = public
as $$
  select costo_tanda(s.id, p_fecha) / s.rolls_por_tanda from sabores s where s.id = p_sabor;
$$;

-- Precio vigente para una combinación exacta de formato y sabor (cualquiera puede ser null).
create function precio_vigente(p_formato uuid, p_sabor uuid, p_fecha date default null) returns numeric
language sql stable set search_path = public
as $$
  select p.precio
    from precios p
   where p.formato_id is not distinct from p_formato
     and p.sabor_id is not distinct from p_sabor
     and p.vigente_desde <= coalesce(p_fecha, hoy())
   order by p.vigente_desde desc, p.creado_en desc
   limit 1;
$$;

-- 5.4 Caja sugerida para un personalizado: la caja fija activa más chica donde entran los rolls.
create function caja_sugerida(p_rolls int) returns uuid
language sql stable set search_path = public
as $$
  select f.caja_insumo_id
    from formatos f
   where f.tipo = 'caja_fija' and f.activo and f.caja_insumo_id is not null and f.rolls >= p_rolls
   order by f.rolls
   limit 1;
$$;

-- Calcula y valida una venta sin guardarla (sirve para el resumen en vivo de la app).
-- payload: {
--   fecha?, entrega ('envio'|'retiro'|'sin_envio'), cobro_envio?, precio_especial?,
--   lineas: [{ formato_id, cantidad?, caja_insumo_id? (null = sin caja; si falta, la de
--              siempre), sabores: [{ sabor_id, unidades }] }]
-- }
create function calcular_venta(p jsonb) returns jsonb
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

      v_costo := costo_roll(s.id, v_fecha);
      if v_costo is null then
        raise exception 'No puedo calcular el costo de "%": falta la receta o el costo de algún insumo', s.nombre;
      end if;

      if f.tipo <> 'caja_fija' then
        v_precio := coalesce(precio_vigente(f.id, s.id, v_fecha), precio_vigente(null, s.id, v_fecha));
        if v_precio is null then
          raise exception 'No hay precio por unidad para "%" al %', s.nombre, v_fecha;
        end if;
        v_precio_linea := v_precio_linea + v_unidades * v_precio;
      end if;

      v_sabores := v_sabores || jsonb_build_object(
        'sabor_id', s.id, 'sabor', s.nombre, 'unidades', v_unidades, 'costo_unitario', v_costo);
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
      v_costo := costo_insumo(v_caja, v_fecha);
      if v_costo is null then
        raise exception 'No hay costo para la caja: cargá una compra o un costo de referencia';
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

-- Guarda una venta con todos sus snapshots. Además del payload de calcular_venta acepta:
--   cliente_id | cliente: { nombre, contacto?, origen? } (crea el cliente),
--   origen?, medio_pago?, estado_pago (default 'pagado'), tipo (default 'venta'), notas?
create function registrar_venta(p jsonb) returns jsonb
language plpgsql set search_path = public
as $$
declare
  v jsonb := calcular_venta(p);
  v_cliente uuid := nullif(p->>'cliente_id', '')::uuid;
  v_origen text := nullif(trim(p->>'origen'), '');
  v_venta uuid;
  v_linea_id uuid;
  l jsonb;
begin
  if v_cliente is null and jsonb_typeof(p->'cliente') = 'object' then
    if coalesce(trim(p->'cliente'->>'nombre'), '') = '' then
      raise exception 'Falta el nombre del cliente';
    end if;
    insert into clientes (nombre, contacto, origen)
    values (trim(p->'cliente'->>'nombre'),
            nullif(trim(p->'cliente'->>'contacto'), ''),
            coalesce(nullif(trim(p->'cliente'->>'origen'), ''), v_origen))
    returning id into v_cliente;
  end if;
  if v_origen is null and v_cliente is not null then
    select origen into v_origen from clientes where id = v_cliente;
  end if;

  insert into ventas (fecha, cliente_id, origen, entrega, cobro_envio, medio_pago, estado_pago,
                      tipo, precio_lista, precio_cobrado, notas, creado_por)
  values ((v->>'fecha')::date, v_cliente, v_origen, v->>'entrega', (v->>'cobro_envio')::numeric,
          nullif(lower(p->>'medio_pago'), ''), coalesce(nullif(lower(p->>'estado_pago'), ''), 'pagado'),
          coalesce(nullif(p->>'tipo', ''), 'venta'), (v->>'precio_lista')::numeric,
          (v->>'precio_cobrado')::numeric, nullif(trim(p->>'notas'), ''), auth.uid())
  returning id into v_venta;

  for l in select * from jsonb_array_elements(v->'lineas') loop
    insert into venta_lineas (venta_id, formato_id, cantidad, caja_insumo_id, precio_lista, costo_caja)
    values (v_venta, (l->>'formato_id')::uuid, (l->>'cantidad')::int,
            nullif(l->>'caja_insumo_id', '')::uuid, (l->>'precio_lista')::numeric,
            (l->>'costo_caja')::numeric)
    returning id into v_linea_id;

    insert into venta_linea_sabores (linea_id, sabor_id, unidades, costo_unitario)
    select v_linea_id, x.sabor_id, x.unidades, x.costo_unitario
      from jsonb_to_recordset(l->'sabores') as x(sabor_id uuid, unidades int, costo_unitario numeric);
  end loop;

  return v || jsonb_build_object('venta_id', v_venta, 'cliente_id', v_cliente);
end;
$$;

-- Guarda una tanda y el snapshot de lo que consumió según la receta de hoy.
-- payload: { fecha?, sabor_id, cantidad? (tandas, default 1), rolls?, notas? }
create function registrar_tanda(p jsonb) returns jsonb
language plpgsql set search_path = public
as $$
declare
  s sabores%rowtype;
  v_fecha date := coalesce(nullif(p->>'fecha', '')::date, hoy());
  v_cant numeric := coalesce(nullif(p->>'cantidad', '')::numeric, 1);
  v_rolls int;
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

  insert into tandas (fecha, sabor_id, cantidad, rolls, notas)
  values (v_fecha, s.id, v_cant, v_rolls, nullif(trim(p->>'notas'), ''))
  returning id into v_tanda;

  insert into tanda_consumos (tanda_id, insumo_id, cantidad)
  select v_tanda, r.insumo_id, r.cantidad * v_cant
    from recetas r
   where r.sabor_id = s.id and r.cantidad > 0;

  return jsonb_build_object('tanda_id', v_tanda, 'fecha', v_fecha, 'sabor', s.nombre,
                            'cantidad', v_cant, 'rolls', v_rolls);
end;
$$;

-- Solo usuarios logueados (y la RLS decide si son admins).
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'hoy()', 'costo_insumo(uuid, date)', 'costo_tanda(uuid, date)', 'costo_roll(uuid, date)',
    'precio_vigente(uuid, uuid, date)', 'caja_sugerida(int)', 'calcular_venta(jsonb)',
    'registrar_venta(jsonb)', 'registrar_tanda(jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
