-- Fase 2 · 3.1 + 3.2: plan de horneado según los pedidos por hacer.
--
-- * ventas.por_hacer: el pedido todavía no se hizo. Es independiente del cobro: un pedido pagado por
--   adelantado sigue por hacer, y uno entregado sin cobrar ya no lo está. Los pedidos web confirmados
--   entran como por hacer; las ventas cargadas a mano, como ya entregadas (salvo que se marque).
-- * sabores.masa_propia: el sabor necesita su propia masa (Oreo lleva las galletitas en la masa).
--   Los demás comparten masa: lo que no llena una tanda entera se junta en tandas mezcladas.
-- * plan_horneado(p): cuántas tandas hacer y de qué. registrar_horneado(p): las registra y marca los
--   pedidos como hechos.

alter table sabores add column masa_propia boolean not null default false;
update sabores set masa_propia = true where nombre = 'Oreo';

alter table ventas add column por_hacer boolean not null default false;
create index on ventas (por_hacer) where por_hacer;

-- v_ventas suma por_hacer al final (create or replace solo permite agregar columnas al final).
create or replace view v_ventas with (security_invoker = true) as
with lineas as (
  select l.venta_id,
         string_agg(case when l.cantidad > 1 then l.cantidad || ' × ' else '' end || f.nombre,
                    ' + ' order by f.orden, f.nombre) as formatos,
         sum(l.costo_caja) as costo_caja
    from venta_lineas l
    join formatos f on f.id = l.formato_id
   group by l.venta_id
), sab as (
  select l.venta_id,
         sum(s.unidades) as rolls,
         sum(s.unidades * s.costo_unitario) as costo_produccion,
         string_agg(coalesce(sa.nombre_corto, sa.nombre) || ' ' || s.unidades, ', '
                    order by sa.orden, sa.nombre) as sabores
    from venta_lineas l
    join venta_linea_sabores s on s.linea_id = l.id
    join sabores sa on sa.id = s.sabor_id
   group by l.venta_id
)
select v.id,
       v.fecha,
       date_trunc('month', v.fecha)::date as mes,
       v.cliente_id,
       c.nombre as cliente,
       v.origen,
       v.tipo,
       v.entrega,
       v.medio_pago,
       v.estado_pago,
       l.formatos,
       sab.sabores,
       coalesce(sab.rolls, 0)::int as rolls,
       v.precio_lista,
       v.precio_cobrado,
       v.precio_lista - v.precio_cobrado as descuento,
       v.cobro_envio,
       v.precio_cobrado + v.cobro_envio as total,
       round(coalesce(sab.costo_produccion, 0), 2) as costo_produccion,
       coalesce(l.costo_caja, 0) as costo_caja,
       round(v.precio_cobrado + v.cobro_envio - coalesce(sab.costo_produccion, 0)
             - coalesce(l.costo_caja, 0), 2) as ganancia,
       v.notas,
       v.creado_en,
       v.por_hacer
  from ventas v
  left join clientes c on c.id = v.cliente_id
  left join lineas l on l.venta_id = v.id
  left join sab on sab.venta_id = v.id;

-- registrar_venta: acepta por_hacer (default false).
create or replace function registrar_venta(p jsonb) returns jsonb
language plpgsql set search_path = public
as $$
declare
  v jsonb := calcular_venta(p);
  v_cliente uuid := nullif(p->>'cliente_id', '')::uuid;
  v_origen text := nullif(trim(p->>'origen'), '');
  v_venta uuid;
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
                      tipo, precio_lista, precio_cobrado, notas, por_hacer, creado_por)
  values ((v->>'fecha')::date, v_cliente, v_origen, v->>'entrega', (v->>'cobro_envio')::numeric,
          nullif(lower(p->>'medio_pago'), ''), coalesce(nullif(lower(p->>'estado_pago'), ''), 'pagado'),
          coalesce(nullif(p->>'tipo', ''), 'venta'), (v->>'precio_lista')::numeric,
          (v->>'precio_cobrado')::numeric, nullif(trim(p->>'notas'), ''),
          coalesce(nullif(p->>'por_hacer', '')::boolean, false), auth.uid())
  returning id into v_venta;

  perform guardar_lineas(v_venta, v->'lineas');

  return v || jsonb_build_object('venta_id', v_venta, 'cliente_id', v_cliente);
end;
$$;

-- actualizar_venta: acepta por_hacer.
create or replace function actualizar_venta(p_id uuid, p jsonb) returns jsonb
language plpgsql set search_path = public
as $$
declare
  v ventas%rowtype;
  c jsonb;
  v_tenia_especial boolean;
begin
  select * into v from ventas where id = p_id for update;
  if not found then
    raise exception 'La venta no existe';
  end if;
  v_tenia_especial := v.precio_cobrado is distinct from v.precio_lista;

  if p ? 'fecha' then v.fecha := (p->>'fecha')::date; end if;

  if jsonb_typeof(p->'cliente') = 'object' then
    if coalesce(trim(p->'cliente'->>'nombre'), '') = '' then
      raise exception 'Falta el nombre del cliente';
    end if;
    insert into clientes (nombre, contacto, origen)
    values (trim(p->'cliente'->>'nombre'), nullif(trim(p->'cliente'->>'contacto'), ''),
            nullif(trim(p->'cliente'->>'origen'), ''))
    returning id into v.cliente_id;
    if not p ? 'origen' then
      v.origen := nullif(trim(p->'cliente'->>'origen'), '');
    end if;
  elsif p ? 'cliente_id' then
    v.cliente_id := nullif(p->>'cliente_id', '')::uuid;
    if not p ? 'origen' and v.cliente_id is not null then
      select origen into v.origen from clientes where id = v.cliente_id;
    end if;
  end if;

  if p ? 'origen' then v.origen := nullif(trim(p->>'origen'), ''); end if;
  if p ? 'medio_pago' then v.medio_pago := nullif(lower(p->>'medio_pago'), ''); end if;
  if p ? 'estado_pago' then v.estado_pago := lower(p->>'estado_pago'); end if;
  if p ? 'tipo' then v.tipo := p->>'tipo'; end if;
  if p ? 'notas' then v.notas := nullif(trim(p->>'notas'), ''); end if;
  if p ? 'por_hacer' then v.por_hacer := coalesce((p->>'por_hacer')::boolean, false); end if;

  if p ? 'entrega' and p->>'entrega' is distinct from v.entrega then
    v.entrega := p->>'entrega';
    v.cobro_envio := case when v.entrega = 'envio'
      then coalesce((select valor::numeric from parametros where clave = 'precio_envio'), 0) else 0 end;
  end if;
  if p ? 'cobro_envio' then
    v.cobro_envio := case when v.entrega = 'envio' then coalesce(nullif(p->>'cobro_envio', '')::numeric, 0) else 0 end;
  end if;

  if p ? 'lineas' then
    c := calcular_venta(jsonb_build_object('fecha', v.fecha, 'entrega', v.entrega, 'lineas', p->'lineas'));
    delete from venta_lineas where venta_id = p_id;
    perform guardar_lineas(p_id, c->'lineas');
    v.precio_lista := (c->>'precio_lista')::numeric;
    if not v_tenia_especial then
      v.precio_cobrado := v.precio_lista;
    end if;
  end if;
  if p ? 'precio_especial' then
    v.precio_cobrado := coalesce(nullif(p->>'precio_especial', '')::numeric, v.precio_lista);
  end if;
  if v.precio_cobrado < 0 then
    raise exception 'El precio no puede ser negativo';
  end if;

  update ventas
     set fecha = v.fecha, cliente_id = v.cliente_id, origen = v.origen, medio_pago = v.medio_pago,
         estado_pago = v.estado_pago, tipo = v.tipo, notas = v.notas, entrega = v.entrega,
         cobro_envio = v.cobro_envio, precio_lista = v.precio_lista, precio_cobrado = v.precio_cobrado,
         por_hacer = v.por_hacer
   where id = p_id;

  return (select to_jsonb(x) from v_ventas x where x.id = p_id);
end;
$$;

-- confirmar_pedido: la venta de un pedido web queda por hacer.
create or replace function confirmar_pedido(p_pedido uuid, p jsonb default '{}') returns jsonb
language plpgsql set search_path = public
as $$
declare
  ped pedidos%rowtype;
  v_cliente uuid;
  v_venta jsonb;
begin
  select * into ped from pedidos where id = p_pedido for update;
  if not found then raise exception 'Pedido inexistente'; end if;
  if ped.estado <> 'nuevo' then raise exception 'El pedido % ya está %', ped.codigo, ped.estado; end if;

  if nullif(p->>'cliente_id', '') is not null then
    select id into v_cliente from clientes where id = (p->>'cliente_id')::uuid;
    if not found then raise exception 'El cliente elegido ya no existe'; end if;
    if (p->>'guardar_telefono')::boolean and cliente_por_telefono(ped.telefono) is distinct from v_cliente then
      update clientes set contacto = concat_ws(' · ', nullif(trim(contacto), ''), ped.telefono) where id = v_cliente;
    end if;
  elsif nullif(trim(p->'cliente'->>'nombre'), '') is null then
    v_cliente := cliente_por_telefono(ped.telefono);
  end if;

  v_venta := registrar_venta(jsonb_build_object(
    'fecha', coalesce(nullif(p->>'fecha', ''), hoy()::text),
    'cliente_id', v_cliente,
    'cliente', case when v_cliente is null then
      jsonb_build_object('nombre', ped.nombre, 'contacto', ped.telefono, 'origen', 'Web')
      || jsonb_strip_nulls(jsonb_build_object(
           'nombre', nullif(trim(p->'cliente'->>'nombre'), ''),
           'contacto', nullif(trim(p->'cliente'->>'contacto'), ''),
           'origen', nullif(trim(p->'cliente'->>'origen'), ''))) end,
    'origen', 'Web',
    'entrega', case ped.modalidad when 'entrega' then 'envio' else 'retiro' end,
    'medio_pago', ped.medio_pago,
    'estado_pago', coalesce(nullif(p->>'estado_pago', ''), 'pendiente'),
    'por_hacer', true,
    'precio_especial', ped.total,
    'notas', concat_ws(' · ', 'Pedido web ' || ped.codigo, ped.direccion, ped.notas),
    'lineas', (select jsonb_agg(jsonb_build_object('formato_id', c.formato_id, 'cantidad', 1, 'sabores', c.sabores)
                                order by c.orden)
                 from pedido_cajas c where c.pedido_id = ped.id)));

  update pedidos set estado = 'confirmado', venta_id = (v_venta->>'venta_id')::uuid,
                     gestionado_en = now(), gestionado_por = auth.uid()
   where id = ped.id;
  return v_venta || jsonb_build_object('codigo', ped.codigo);
end;
$$;

-- Plan de horneado. p (todo opcional):
--   ventas:   [venta_id] que entran (solo cuentan las que siguen por hacer). Sin la clave: todas las por hacer.
--   extra:    { "<sabor_id>": rolls } para vender sueltos.
--   completar: sabor (de masa compartida) con el que se llenan los lugares libres de la última tanda
--              mezclada. Por defecto, el primero de masa compartida activo (Canela).
-- Reglas:
--   * Masa propia: ceil(rolls / rolls_por_tanda) tandas solo de ese sabor.
--   * Masa compartida: floor(rolls / rolls_por_tanda) tandas enteras de cada sabor; lo que sobra de todos
--     se junta en tandas mezcladas del tamaño de la tanda del sabor para completar.
--   * "tandas" por sabor es la fracción de su receta que se usa (rolls / rolls_por_tanda): es lo que
--     reciben que_comprar y registrar_tanda.
-- Devuelve { completar, total_tandas,
--            sabores: [{ sabor_id, nombre, masa_propia, pedidos, extra, rolls, para_vender, tandas }],
--            tandas:  [{ tipo: 'sola'|'mezcla', cantidad, rolls, sabores: [{ sabor_id, nombre, rolls }] }] }
create function plan_horneado(p jsonb default '{}') returns jsonb
language plpgsql stable set search_path = public
as $$
declare
  v_completar uuid := nullif(p->>'completar', '')::uuid;
  v_tam int;
  s record;
  v_n int;
  v_k int;
  v_resto int;
  v_toma int;
  v_tandas jsonb := '[]';
  v_hace jsonb := '{}';                 -- { sabor_id: rolls que se hacen }
  v_mezcla jsonb := '[]';               -- tanda mezclada en armado: [{ sabor_id, nombre, rolls }]
  v_lleno int := 0;
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
  select rolls_por_tanda into v_tam from sabores where id = v_completar;
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
    if v_k > 0 then
      v_tandas := v_tandas || jsonb_build_object('tipo', 'sola', 'cantidad', v_k, 'rolls', v_k * s.rolls_por_tanda,
        'sabores', jsonb_build_array(jsonb_build_object('sabor_id', s.id, 'nombre', s.nombre, 'rolls', v_k * s.rolls_por_tanda)));
    end if;
    v_hace := jsonb_set(v_hace, array[s.id::text], to_jsonb(v_k * s.rolls_por_tanda));

    -- Lo que sobra va a las tandas mezcladas; si no entra en la que se está armando, abre otra.
    while v_resto > 0 loop
      v_toma := least(v_resto, v_tam - v_lleno);
      v_mezcla := v_mezcla || jsonb_build_object('sabor_id', s.id, 'nombre', s.nombre, 'rolls', v_toma);
      v_hace := jsonb_set(v_hace, array[s.id::text], to_jsonb((v_hace->>s.id::text)::int + v_toma));
      v_lleno := v_lleno + v_toma;
      v_resto := v_resto - v_toma;
      if v_lleno = v_tam then
        v_tandas := v_tandas || jsonb_build_object('tipo', 'mezcla', 'cantidad', 1, 'rolls', v_tam, 'sabores', v_mezcla);
        v_mezcla := '[]';
        v_lleno := 0;
      end if;
    end loop;
  end loop;

  -- La última tanda mezclada se completa con el sabor elegido (la masa rinde la tanda entera).
  if v_lleno > 0 and v_completar is null then
    v_tandas := v_tandas || jsonb_build_object('tipo', 'mezcla', 'cantidad', 1, 'rolls', v_lleno, 'sabores', v_mezcla);
  elsif v_lleno > 0 then
    v_toma := v_tam - v_lleno;
    if exists (select 1 from jsonb_array_elements(v_mezcla) m where (m->>'sabor_id')::uuid = v_completar) then
      select jsonb_agg(case when (m->>'sabor_id')::uuid = v_completar
                            then jsonb_set(m, '{rolls}', to_jsonb((m->>'rolls')::int + v_toma)) else m end)
        into v_mezcla from jsonb_array_elements(v_mezcla) m;
    else
      v_mezcla := v_mezcla || jsonb_build_object('sabor_id', v_completar,
        'nombre', (select nombre from sabores where id = v_completar), 'rolls', v_toma);
    end if;
    v_hace := jsonb_set(v_hace, array[v_completar::text],
                        to_jsonb(coalesce((v_hace->>v_completar::text)::int, 0) + v_toma));
    v_tandas := v_tandas || jsonb_build_object('tipo', 'mezcla', 'cantidad', 1, 'rolls', v_tam, 'sabores', v_mezcla);
  end if;

  -- Resumen por sabor (incluye el de completar aunque no tuviera pedidos).
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
    select key::uuid as sabor_id, value::int as rolls from jsonb_each_text(v_hace)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'sabor_id', sa.id, 'nombre', sa.nombre, 'masa_propia', sa.masa_propia,
           'pedidos', coalesce(pe.rolls, 0),
           'extra', coalesce((select greatest(coalesce(nullif(p->'extra'->>sa.id::text, '')::numeric, 0), 0)::int), 0),
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

-- Registra el plan: una tanda por sabor (con la fracción de receta que usa, así el stock descuenta bien)
-- y marca como hechos los pedidos que entraron. p = lo mismo que plan_horneado + fecha (default hoy).
create function registrar_horneado(p jsonb default '{}') returns jsonb
language plpgsql set search_path = public
as $$
declare
  v_plan jsonb := plan_horneado(p);
  v_fecha date := coalesce(nullif(p->>'fecha', '')::date, hoy());
  s jsonb;
  v_tandas int := 0;
  v_ventas int;
begin
  if jsonb_array_length(v_plan->'sabores') = 0 then
    raise exception 'No hay nada para hornear';
  end if;
  for s in select * from jsonb_array_elements(v_plan->'sabores') loop
    perform registrar_tanda(jsonb_build_object(
      'fecha', v_fecha, 'sabor_id', s->>'sabor_id', 'cantidad', s->'tandas', 'rolls', s->'rolls',
      'notas', 'Plan de horneado'));
    v_tandas := v_tandas + 1;
  end loop;

  update ventas v set por_hacer = false
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
  foreach fn in array array['plan_horneado(jsonb)', 'registrar_horneado(jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
