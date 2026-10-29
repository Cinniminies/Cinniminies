-- Cierre de pedidos de la semana (idea 2.9) y "Pedidos para el sábado DD/MM" en la web (6.8). Decidido el 29/10:
-- * Se hornea y se entrega solo el sábado: la fecha de una venta es SIEMPRE el sábado de entrega. El día en que
--   entró el pedido queda aparte, en ventas.pedido_el (con él se toman precios, costos y promos).
-- * Los pedidos de un sábado cierran el jueves a las 23:59 (editable en /admin → Pedidos web). Pasado el cierre,
--   el pedido es para el sábado siguiente, tanto en la web como en lo que se carga a mano (WhatsApp, Instagram).
-- * Hay sábados en los que no se hornea (sabados_sin_horneado): los pedidos pasan al sábado siguiente.
-- * Lo ya entregado fuera del sábado (rolls que sobraron y se venden el domingo) va al sábado del horneado.
-- * Las ventas ya cargadas pasan al sábado de su horneado o, si no lo tienen, al de su semana (domingo a sábado).

-- 4 = jueves (el día de la semana de Postgres: 0 = domingo). La hora es la de Uruguay.
insert into parametros (clave, valor) values ('cierre_dia', '4'), ('cierre_hora', '23:59')
on conflict (clave) do nothing;

create table sabados_sin_horneado (
  sabado date primary key check (extract(dow from sabado) = 6),
  motivo text check (length(motivo) <= 80),
  creado_en timestamptz not null default now()
);
alter table sabados_sin_horneado enable row level security;
revoke all on sabados_sin_horneado from anon;
create policy "solo admins" on sabados_sin_horneado for all to authenticated
  using ((select privado.es_admin())) with check ((select privado.es_admin()));

-- La hora de Uruguay (o la de parametros.zona_horaria) de un momento, sin zona.
create function privado.hora_local(p_momento timestamptz) returns timestamp
language sql stable set search_path = public
as $$
  select p_momento at time zone coalesce((select valor from parametros where clave = 'zona_horaria'), 'America/Montevideo');
$$;

-- Hasta cuándo se puede pedir para el sábado p_sabado (hora de Uruguay): cierre_dia de esa semana a la cierre_hora.
create function privado.cierre_de(p_sabado date) returns timestamp
language sql stable set search_path = public
as $$
  select (p_sabado - (6 - coalesce((select valor::int from parametros where clave = 'cierre_dia'), 4)))
         + coalesce((select valor::time from parametros where clave = 'cierre_hora'), time '23:59');
$$;

-- El sábado de la semana de pedidos (domingo a sábado) de un día.
create function privado.sabado_de_semana(p_dia date) returns date
language sql immutable set search_path = public
as $$
  select p_dia + (6 - extract(dow from p_dia)::int);
$$;

-- El sábado del horneado de algo entregado en p_dia: ese día si es sábado, si no el sábado anterior.
create function privado.sabado_anterior(p_dia date) returns date
language sql immutable set search_path = public
as $$
  select p_dia - ((extract(dow from p_dia)::int + 1) % 7);
$$;

revoke all on function privado.hora_local(timestamptz), privado.cierre_de(date), privado.sabado_de_semana(date),
  privado.sabado_anterior(date) from public, anon;
grant execute on function privado.hora_local(timestamptz), privado.cierre_de(date), privado.sabado_de_semana(date),
  privado.sabado_anterior(date) to authenticated, service_role;

-- El sábado de entrega de un pedido hecho en p_momento: el primero cuyo cierre no pasó y en el que se hornea.
-- El cierre vale hasta el final de su minuto (23:59:59 todavía entra).
create function sabado_de_pedido(p_momento timestamptz default now()) returns date
language plpgsql stable set search_path = public
as $$
declare
  v_local timestamp := date_trunc('minute', privado.hora_local(p_momento));
  v_sabado date := privado.sabado_de_semana(v_local::date);
begin
  for i in 1..52 loop
    if v_local <= privado.cierre_de(v_sabado)
       and not exists (select 1 from sabados_sin_horneado where sabado = v_sabado) then
      return v_sabado;
    end if;
    v_sabado := v_sabado + 7;
  end loop;
  raise exception 'No hay ningún sábado con horneado en el próximo año';
end;
$$;
revoke all on function sabado_de_pedido(timestamptz) from public, anon;
grant execute on function sabado_de_pedido(timestamptz) to authenticated, service_role;

-- El sábado que se sugiere al cargar una venta hoy: si queda por hacer, el del próximo cierre; si ya se entregó, el
-- del horneado. Lo usan registrar_venta (sin fecha) y + Venta en /admin.
create function sabado_de_entrega(p_por_hacer boolean, p_pedido_el date default null) returns date
language sql stable set search_path = public
as $$
  select case when p_por_hacer then sabado_de_pedido() else privado.sabado_anterior(coalesce(p_pedido_el, hoy())) end;
$$;
revoke all on function sabado_de_entrega(boolean, date) from public, anon;
grant execute on function sabado_de_entrega(boolean, date) to authenticated, service_role;

-- La fecha de una venta tiene que ser un sábado (el de entrega).
create function privado.exigir_sabado(p_fecha date) returns void
language plpgsql immutable set search_path = public
as $$
begin
  if extract(dow from p_fecha) <> 6 then
    raise exception 'La fecha de la venta es el sábado de entrega, y el % no es sábado', to_char(p_fecha, 'DD/MM');
  end if;
end;
$$;
revoke all on function privado.exigir_sabado(date) from public, anon;
grant execute on function privado.exigir_sabado(date) to authenticated, service_role;

-- VENTAS ---------------------------------------------------------------------

alter table ventas add column pedido_el date;

-- Las ya cargadas: el horneado (sábado, o domingo como el 06/09) se lleva a su sábado; sin horneado, el sábado de
-- su semana de pedidos. pedido_el se queda con la fecha que tenían (el día del pedido).
update ventas
   set pedido_el = fecha,
       fecha = coalesce(privado.sabado_anterior(horneado), privado.sabado_de_semana(fecha));

alter table ventas
  alter column pedido_el set not null,
  add constraint ventas_fecha_es_sabado check (extract(dow from fecha) = 6);

create or replace view v_ventas with (security_invoker = true) as
with lineas as (
  select l.venta_id,
         string_agg(case when l.cantidad > 1 then l.cantidad || ' × ' else '' end || f.nombre, ' + '
                    order by f.orden, f.nombre) as formatos,
         sum(l.costo_caja) as costo_caja
    from venta_lineas l
    join formatos f on f.id = l.formato_id
   group by l.venta_id
), sab as (
  select l.venta_id,
         sum(s.unidades) as rolls,
         sum(s.unidades::numeric * s.costo_unitario) as costo_produccion,
         string_agg(coalesce(sa.nombre_corto, sa.nombre) || ' ' || s.unidades, ', ' order by sa.orden, sa.nombre) as sabores
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
       v.precio_cobrado + v.cobro_envio + v.propina as total,
       round(coalesce(sab.costo_produccion, 0), 2) as costo_produccion,
       coalesce(l.costo_caja, 0) as costo_caja,
       round(v.precio_cobrado + v.cobro_envio + v.propina - coalesce(sab.costo_produccion, 0) - coalesce(l.costo_caja, 0), 2)
         as ganancia,
       v.notas,
       v.creado_en,
       v.por_hacer,
       v.propina,
       v.pedido_el
  from ventas v
  left join clientes c on c.id = v.cliente_id
  left join lineas l on l.venta_id = v.id
  left join sab on sab.venta_id = v.id
 where v.es_prueba = (select privado.es_prueba());

-- registrar_venta: p.fecha es el sábado de entrega (sin él, sabado_de_entrega) y p.pedido_el el día del pedido (por
-- defecto, hoy). calcular_venta recibe como fecha el día del pedido: precios, costos y promos son los de ese día.
create or replace function registrar_venta(p jsonb) returns jsonb
language plpgsql set search_path = public
as $$
declare
  v_pedido_el date := coalesce(nullif(p->>'pedido_el', '')::date, hoy());
  v_sabado date := coalesce(nullif(p->>'fecha', '')::date,
                            sabado_de_entrega(coalesce(nullif(p->>'por_hacer', '')::boolean, false), v_pedido_el));
  v jsonb := calcular_venta(p || jsonb_build_object('fecha', v_pedido_el));
  v_cliente uuid := nullif(p->>'cliente_id', '')::uuid;
  v_origen text := nullif(trim(p->>'origen'), '');
  v_venta uuid;
begin
  perform privado.exigir_sabado(v_sabado);
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

  insert into ventas (fecha, pedido_el, cliente_id, origen, entrega, cobro_envio, medio_pago, estado_pago,
                      tipo, precio_lista, precio_cobrado, notas, por_hacer, creado_por, propina)
  values (v_sabado, v_pedido_el, v_cliente, v_origen, v->>'entrega', (v->>'cobro_envio')::numeric,
          nullif(lower(p->>'medio_pago'), ''), coalesce(nullif(lower(p->>'estado_pago'), ''), 'pagado'),
          coalesce(nullif(p->>'tipo', ''), 'venta'), (v->>'precio_lista')::numeric,
          (v->>'precio_cobrado')::numeric, nullif(trim(p->>'notas'), ''),
          coalesce(nullif(p->>'por_hacer', '')::boolean, false), auth.uid(), propina_valida(p))
  returning id into v_venta;

  perform guardar_lineas(v_venta, v->'lineas');

  return v || jsonb_build_object('venta_id', v_venta, 'cliente_id', v_cliente, 'propina', propina_valida(p),
                                 'fecha', v_sabado, 'pedido_el', v_pedido_el);
end;
$$;

-- actualizar_venta: la fecha es el sábado de entrega; si cambian los productos se recalculan con el día del pedido.
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

  if p ? 'fecha' then
    v.fecha := (p->>'fecha')::date;
    perform privado.exigir_sabado(v.fecha);
  end if;

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
  if p ? 'propina' then v.propina := propina_valida(p); end if;

  if p ? 'entrega' and p->>'entrega' is distinct from v.entrega then
    v.entrega := p->>'entrega';
    v.cobro_envio := case when v.entrega = 'envio'
      then coalesce((select valor::numeric from parametros where clave = 'precio_envio'), 0) else 0 end;
  end if;
  if p ? 'cobro_envio' then
    v.cobro_envio := case when v.entrega = 'envio' then coalesce(nullif(p->>'cobro_envio', '')::numeric, 0) else 0 end;
  end if;

  if p ? 'lineas' then
    c := calcular_venta(jsonb_build_object('fecha', v.pedido_el, 'entrega', v.entrega, 'lineas', p->'lineas'));
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
         por_hacer = v.por_hacer, propina = v.propina
   where id = p_id;

  return (select to_jsonb(x) from v_ventas x where x.id = p_id);
end;
$$;

-- PEDIDOS WEB ----------------------------------------------------------------

-- El sábado de entrega lo fija la base al crear el pedido. Los confirmados toman el de su venta.
alter table pedidos add column sabado date default sabado_de_pedido();
update pedidos p set sabado = coalesce((select v.fecha from ventas v where v.id = p.venta_id), sabado_de_pedido(p.creado_en));
alter table pedidos alter column sabado set not null;

create or replace view v_pedidos with (security_invoker = true) as
select p.id,
       p.codigo,
       p.creado_en,
       p.estado,
       p.nombre,
       p.telefono,
       p.modalidad,
       p.direccion,
       p.medio_pago,
       p.notas,
       p.total,
       p.ip_hash,
       p.venta_id,
       p.motivo_rechazo,
       p.gestionado_en,
       p.gestionado_por,
       c.id as cliente_sugerido_id,
       c.nombre as cliente_sugerido,
       (select count(*) from ventas v where v.cliente_id = c.id) as compras_cliente,
       p.comprobante,
       p.descuento,
       p.codigo_recomendacion,
       x.porcentaje as descuento_porcentaje,
       r.estado as recomendacion_estado,
       r.motivo as recomendacion_motivo,
       d.nombre as recomendador,
       p.descuento_promo,
       p.promo,
       p.sabado
  from pedidos p
  left join clientes c on c.id = cliente_por_telefono(p.telefono)
  left join canjes_recomendacion x on x.pedido_id = p.id
  left join recomendaciones r on r.pedido_id = p.id
  left join clientes d on d.id = r.recomendador_id;

-- confirmar_pedido: la venta queda para el sábado del pedido, con el día en que entró como pedido_el.
create or replace function confirmar_pedido(p_pedido uuid, p jsonb default '{}') returns jsonb
language plpgsql set search_path = public
as $$
declare
  ped pedidos%rowtype;
  v_cliente uuid;
  v_venta jsonb;
  v_canje text;
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

  select format('Descuento por recomendaciones %s%% en %s (−$%s)', trim_scale(x.porcentaje), f.nombre, trim_scale(x.monto))
    into v_canje
    from canjes_recomendacion x join formatos f on f.id = x.formato_id
   where x.pedido_id = ped.id;

  v_venta := registrar_venta(jsonb_build_object(
    'fecha', coalesce(nullif(p->>'fecha', ''), ped.sabado::text),
    'pedido_el', privado.hora_local(ped.creado_en)::date,
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
    'precio_especial', ped.total - ped.envio,   -- la venta suma el envío aparte (cobro_envio)
    'notas', concat_ws(' · ', 'Pedido web ' || ped.codigo, ped.direccion, ped.notas, v_canje,
                          case when ped.descuento_promo > 0 then format('%s (−$%s)', ped.promo, trim_scale(ped.descuento_promo)) end),
    'lineas', (select jsonb_agg(jsonb_build_object('formato_id', c.formato_id, 'cantidad', 1, 'sabores', c.sabores)
                                order by c.orden)
                 from pedido_cajas c where c.pedido_id = ped.id)));

  update pedidos set estado = 'confirmado', venta_id = (v_venta->>'venta_id')::uuid,
                     gestionado_en = now(), gestionado_por = auth.uid()
   where id = ped.id;
  return v_venta || jsonb_build_object('codigo', ped.codigo);
end;
$$;

-- crear_pedido_web: igual que antes, y devuelve el sábado de entrega (lo pone el default de pedidos.sabado).
create or replace function crear_pedido_web(p jsonb, p_ip_hash text default null) returns jsonb
language plpgsql set search_path = public
as $$
declare
  v_nombre text := left(trim(coalesce(p->>'nombre', '')), 100);
  v_tel text := regexp_replace(coalesce(p->>'telefono', ''), '\D', '', 'g');
  v_modalidad text := lower(coalesce(p->>'modalidad', ''));
  v_direccion text := left(nullif(trim(p->>'direccion'), ''), 200);
  v_pago text := lower(coalesce(p->>'pago', ''));
  v_notas text := left(nullif(trim(p->>'notas'), ''), 500);
  v_prueba boolean := coalesce((p->>'prueba')::boolean, false);
  v_clave text := nullif(left(regexp_replace(upper(coalesce(p->>'codigo_recomendacion', '')), '[^A-Z0-9]', '', 'g'), 20), '');
  v_caja jsonb;
  v_sabor record;
  f formatos%rowtype;
  s sabores%rowtype;
  v_items jsonb;
  v_lineas jsonb := '[]';
  v_calc jsonb;
  v_codigo text;
  v_pedido uuid;
  v_sabado date;
  v_total numeric;
  v_cons jsonb;
  v_rec jsonb;
  k campanas_recomendacion;
  v_dueno uuid;
  v_box record;
  v_pct numeric;
  v_desc numeric := 0;
  v_envio numeric;
  v_promo numeric;
  v_promo_nombre text;
  i int := 0;
begin
  if v_nombre = '' then raise exception 'Falta el nombre'; end if;
  if v_tel !~ '^09[1-9][0-9]{6}$' then raise exception 'El WhatsApp tiene que ser un celular uruguayo (09…)'; end if;
  if v_modalidad not in ('retiro', 'entrega') then raise exception 'Modalidad inválida'; end if;
  if v_modalidad = 'entrega' and v_direccion is null then raise exception 'Falta la dirección de entrega'; end if;
  if v_pago not in ('efectivo', 'transferencia') then raise exception 'Forma de pago inválida'; end if;
  if jsonb_typeof(p->'cajas') is distinct from 'array' or jsonb_array_length(p->'cajas') = 0 then
    raise exception 'El pedido no tiene cajas';
  end if;
  if jsonb_array_length(p->'cajas') > 20 then raise exception 'Demasiadas cajas en un pedido'; end if;

  -- Límite: 5 pedidos cada 15 minutos por IP
  if p_ip_hash is not null and (select count(*) from pedidos
       where ip_hash = p_ip_hash and creado_en > now() - interval '15 minutes') >= 5 then
    raise exception 'Demasiados pedidos seguidos. Probá de nuevo en unos minutos o escribinos por WhatsApp';
  end if;

  for v_caja in select * from jsonb_array_elements(p->'cajas') loop
    if v_caja->>'tipo' = 'caja_fija' then
      select * into f from formatos
       where tipo = 'caja_fija' and activo and visible_web and rolls = nullif(v_caja->>'rolls', '')::int
       order by orden limit 1;
    elsif v_caja->>'tipo' = 'personalizado' then
      select * into f from formatos where tipo = 'personalizado' and activo and visible_web order by orden limit 1;
    else
      raise exception 'Tipo de caja inválido';
    end if;
    if not found then raise exception 'Esa caja ya no está disponible'; end if;
    if jsonb_typeof(v_caja->'sabores') is distinct from 'object' then raise exception 'Caja sin sabores'; end if;

    v_items := '[]';
    for v_sabor in select key, value from jsonb_each(v_caja->'sabores') loop
      select * into s from sabores
       where slug = v_sabor.key and activo and visible_web and not eliminado;
      if not found then raise exception 'El sabor "%" ya no está disponible', v_sabor.key; end if;
      if jsonb_typeof(v_sabor.value) <> 'number' or (v_sabor.value)::text !~ '^[1-9][0-9]?$' then
        raise exception 'Cantidad inválida para "%"', s.nombre;  -- entero de 1 a 99
      end if;
      v_items := v_items || jsonb_build_object('sabor_id', s.id, 'unidades', (v_sabor.value)::text::int);
    end loop;

    v_lineas := v_lineas || jsonb_build_object('formato_id', f.id, 'cantidad', 1, 'sabores', v_items);
  end loop;

  -- Precio y validaciones de rolls: la misma regla que una venta. Con entrega, el envío (parámetro
  -- precio_envio) va en el total; el descuento por recomendación se calcula sin él.
  v_calc := calcular_venta(jsonb_build_object('entrega', case v_modalidad when 'entrega' then 'envio' else 'retiro' end,
                                              'lineas', v_lineas, 'prueba', v_prueba));
  -- Las promos vigentes ya vienen calculadas por caja (lineas[].promo)
  v_promo := coalesce((v_calc->>'descuento_promo')::numeric, 0);
  v_total := (v_calc->>'precio_lista')::numeric - v_promo;
  v_envio := coalesce((v_calc->>'cobro_envio')::numeric, 0);

  -- Código de recomendación: si es el propio, se usa el saldo en la Box fija más cara del pedido.
  if v_clave is not null then
    v_cons := consultar_codigo(v_clave, v_tel, v_prueba);
    v_rec := v_cons;
    if v_cons->>'estado' in ('propio', 'recomendado') then
      k := campana_vigente(hoy(), v_prueba);
      select x.cliente_id into v_dueno from codigos_recomendacion x where x.clave = v_clave;
      -- terminada la campaña, el canje de un bono que sigue vigente queda en la campaña del bono
      if k.id is null then
        select * into k from campanas_recomendacion where id = (bono_recomendacion(v_dueno)).campana_id;
      end if;
    end if;
    if v_cons->>'estado' = 'propio' and (v_cons->>'porcentaje')::numeric > 0 then
      -- Promo y código no se suman: en cada caja vale el mayor. Se elige la Box donde el código gana más.
      v_pct := (v_cons->>'porcentaje')::numeric;
      select (l->>'formato_id')::uuid as formato_id, l->>'formato' as formato, (l->>'precio_lista')::numeric as precio,
             coalesce((l->'promo'->>'monto')::numeric, 0) as promo
        into v_box
        from jsonb_array_elements(v_calc->'lineas') l
        join formatos fo on fo.id = (l->>'formato_id')::uuid
       where fo.tipo = 'caja_fija'
       order by round((l->>'precio_lista')::numeric * v_pct / 100) - coalesce((l->'promo'->>'monto')::numeric, 0) desc,
                (l->>'precio_lista')::numeric desc
       limit 1;
      if v_box.formato_id is not null and round(v_box.precio * v_pct / 100) > v_box.promo then
        v_desc := round(v_box.precio * v_pct / 100);
        v_total := v_total - v_desc + v_box.promo;   -- el código reemplaza la promo de esa caja
        v_promo := v_promo - v_box.promo;
        v_rec := v_rec || jsonb_build_object('aplicado', true, 'monto', v_desc, 'formato', v_box.formato);
      elsif v_box.formato_id is not null then
        v_rec := v_rec || jsonb_build_object('aplicado', false, 'motivo', 'Esa Box ya tiene una promo que descuenta más');
      else
        v_rec := v_rec || jsonb_build_object('aplicado', false, 'motivo', 'Solo se aplica a las Box de 6 y de 12');
      end if;
    end if;
  end if;

  v_total := v_total + v_envio;
  v_promo_nombre := case when v_promo > 0 then
    (select string_agg(distinct l->'promo'->>'promo', ', ') from jsonb_array_elements(v_calc->'lineas') l) end;

  loop
    -- 4 caracteres sin los que se confunden al dictarlos (0/O, 1/I/L)
    v_codigo := 'CM-' || extract(year from now() at time zone 'America/Montevideo')::int || '-'
      || (select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
            from generate_series(1, 4));
    exit when not exists (select 1 from pedidos where codigo = v_codigo);
  end loop;

  insert into pedidos (codigo, nombre, telefono, modalidad, direccion, medio_pago, notas, total, ip_hash,
                       es_prueba, codigo_recomendacion, descuento, envio, descuento_promo, promo)
  values (v_codigo, v_nombre, v_tel, v_modalidad, case when v_modalidad = 'entrega' then v_direccion end,
          v_pago, v_notas, v_total, p_ip_hash, v_prueba, v_clave, v_desc, v_envio, v_promo, v_promo_nombre)
  returning id, sabado into v_pedido, v_sabado;

  for v_caja in select * from jsonb_array_elements(v_calc->'lineas') loop
    i := i + 1;
    insert into pedido_cajas (pedido_id, orden, formato_id, precio, sabores)
    values (v_pedido, i, (v_caja->>'formato_id')::uuid, (v_caja->>'precio_lista')::numeric,
            (select jsonb_agg(jsonb_build_object('sabor_id', x->'sabor_id', 'unidades', x->'unidades'))
               from jsonb_array_elements(v_caja->'sabores') x));
  end loop;

  if v_desc > 0 then
    insert into canjes_recomendacion (campana_id, pedido_id, cliente_id, mes, porcentaje, monto, formato_id)
    values (k.id, v_pedido, v_dueno, date_trunc('month', hoy())::date, v_pct, v_desc, v_box.formato_id);
  elsif v_cons->>'estado' = 'recomendado' then
    insert into recomendaciones (campana_id, pedido_id, recomendador_id) values (k.id, v_pedido, v_dueno);
  end if;

  return jsonb_build_object(
    'codigo', v_codigo,
    'sabado', v_sabado,
    'total', v_total,
    'envio', v_envio,
    'descuento', v_desc,
    'descuento_promo', v_promo,
    'promo', v_promo_nombre,
    'recomendacion', v_rec,
    'cajas', (select jsonb_agg(jsonb_build_object('formato', x->>'formato', 'precio', (x->>'precio_lista')::numeric))
                from jsonb_array_elements(v_calc->'lineas') x));
end;
$$;

-- catalogo_web: suma para qué sábado es un pedido hecho ahora, hasta cuándo se puede pedir para ese sábado
-- (hora de Uruguay) y por qué no es el de esta semana: 'cierre' (ya cerró) o 'sin_horneado' (ese sábado no se hornea).
create or replace function catalogo_web(p_prueba boolean default false) returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'sabores', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.slug,
               'nombre', s.nombre,
               'descripcion', s.descripcion,
               'etiqueta', s.etiqueta_web,
               'foto', s.foto,
               'precio_unidad', precio_vigente(null, s.id))
             order by s.orden, s.nombre)
        from sabores s
       where s.activo and s.visible_web and not s.eliminado
         and nullif(trim(s.slug), '') is not null), '[]'::jsonb),
    'formatos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nombre', f.nombre,
               'tipo', f.tipo,
               'rolls', f.rolls,
               'min_rolls', f.min_rolls,
               'max_rolls', f.max_rolls,
               'precio', precio_vigente(f.id, null))
             order by f.orden, f.nombre)
        from formatos f
       where f.activo and f.visible_web), '[]'::jsonb),
    'contenido', coalesce((select jsonb_object_agg(c.clave, c.valor) from contenido_web c), '{}'::jsonb),
    'envio', (select valor::numeric from parametros where clave = 'precio_envio'),
    -- Promos de hoy. formatos/sabores vacíos = todos; la web hace la misma cuenta que privado.promo_de_linea.
    'promos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nombre', pr.nombre,
               'tipo', pr.tipo,
               'valor', pr.valor,
               'texto', pr.texto_web,
               'hasta', pr.hasta,
               'formatos', (select coalesce(jsonb_agg(jsonb_build_object('tipo', f.tipo, 'rolls', f.rolls)), '[]')
                              from formatos f where f.id = any(pr.formatos)),
               'sabores', (select coalesce(jsonb_agg(s.slug), '[]') from sabores s where s.id = any(pr.sabores)))
             order by pr.desde, pr.nombre)
        from promos pr
       where pr.activa and pr.es_prueba = p_prueba and hoy() between pr.desde and pr.hasta), '[]'::jsonb),
    'pedidos', (
      select jsonb_build_object(
               'sabado', x.sabado,
               'cierre', to_char(privado.cierre_de(x.sabado), 'YYYY-MM-DD"T"HH24:MI'),
               'motivo', case when x.sabado = x.este then null
                              when exists (select 1 from sabados_sin_horneado where sabado = x.este) then 'sin_horneado'
                              else 'cierre' end)
        from (select sabado_de_pedido() as sabado, privado.sabado_de_semana(hoy()) as este) x));
$$;
revoke all on function catalogo_web(boolean) from public, anon, authenticated;
grant execute on function catalogo_web(boolean) to service_role;

-- Textos de la web: para qué sábado es el pedido (arriba del carrito) y en el pedido recibido.
insert into contenido_web (clave, seccion, orden, etiqueta, ayuda, tipo, valor, original)
select clave, seccion, orden, etiqueta, ayuda, 'texto', valor, valor from (values
  ('carrito.sabado', 'Carrito y formulario', 19, 'Para qué sábado es el pedido',
    'Arriba del carrito. {sabado}: el sábado de entrega (31/10). {cierre}: hasta cuándo se puede pedir (jueves 29/10 a las 23:59).',
    'Pedidos para el sábado {sabado}. Se puede pedir hasta el {cierre}.'),
  ('carrito.sabado_cerrado', 'Carrito y formulario', 20, 'Para qué sábado es el pedido (después del cierre)',
    'Cuando ya cerraron los pedidos de este sábado. {sabado}: el sábado de entrega. {cierre}: hasta cuándo se puede pedir.',
    'Ya cerramos los pedidos de este sábado. Tu pedido es para el sábado {sabado}.'),
  ('carrito.sabado_sin_horneado', 'Carrito y formulario', 21, 'Para qué sábado es el pedido (sábado sin horneado)',
    'Cuando este sábado no hornean. {sabado}: el sábado de entrega. {cierre}: hasta cuándo se puede pedir.',
    'Este sábado no horneamos. Tu pedido es para el sábado {sabado}.'),
  ('pedido.sabado', 'Pedido recibido', 2, 'Para qué sábado es', 'Debajo del número de pedido. {sabado}: el sábado de entrega.',
    'Tu pedido es para el sábado {sabado}.')
) as t(clave, seccion, orden, etiqueta, ayuda, valor)
on conflict (clave) do nothing;
