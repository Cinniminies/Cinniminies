-- Descuento por recomendación (docs/descuento-plan/logica.md, decisiones del 20/10).
--
-- * Cada cliente que paga una compra durante una campaña recibe su código (ANA-K7P), atado a su cliente
--   (y por él, a su celular).
-- * Si alguien nuevo pide en la web con ese código y su venta queda pagada, el dueño del código gana el
--   porcentaje de la campaña (5 %), acumulable hasta el tope (30 %) dentro del mes en que se validó.
-- * El dueño lo usa en la web poniendo su propio código con su celular: se descuenta de una Box fija
--   (la más cara del pedido; las personalizadas no). Lo que no usa en el mes se pierde.
-- * Solo cuentan los pedidos de la web.
-- Todo respeta la marca es_prueba (migración anterior): las campañas de prueba solo valen para datos de prueba.

create table campanas_recomendacion (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  desde date not null,
  hasta date not null,
  porcentaje numeric(5, 2) not null default 5 check (porcentaje > 0 and porcentaje <= 50),
  tope numeric(5, 2) not null default 30 check (tope <= 50),
  es_prueba boolean not null default privado.es_prueba(),
  creado_en timestamptz not null default now(),
  check (hasta >= desde),
  check (tope >= porcentaje)
);

create table codigos_recomendacion (
  cliente_id uuid primary key references clientes on delete cascade,
  codigo text not null,                                   -- ANA-K7P (así se muestra)
  clave text not null unique generated always as (regexp_replace(upper(codigo), '[^A-Z0-9]', '', 'g')) stored,
  creado_en timestamptz not null default now()
);

-- Una por pedido web que trajo el código de otra persona. Queda pendiente hasta que la venta se paga.
create table recomendaciones (
  id uuid primary key default gen_random_uuid(),
  campana_id uuid not null references campanas_recomendacion on delete cascade,
  pedido_id uuid not null unique references pedidos on delete cascade,
  recomendador_id uuid not null references clientes on delete cascade,  -- el dueño del código
  recomendado_id uuid references clientes on delete set null,           -- el cliente de la venta, al validarla
  estado text not null default 'pendiente' check (estado in ('pendiente', 'valida', 'anulada')),
  motivo text,                                                          -- por qué se anuló
  mes date,                                                             -- mes en que suma (el de la validación)
  validada_en timestamptz,
  creado_en timestamptz not null default now(),
  check (estado <> 'valida' or (recomendado_id is not null and mes is not null))
);
create unique index on recomendaciones (recomendado_id) where estado = 'valida';  -- se cuenta una vez por cliente
create index on recomendaciones (recomendador_id, mes) where estado = 'valida';

-- Descuento usado en un pedido web. Vale mientras el pedido no esté rechazado.
create table canjes_recomendacion (
  id uuid primary key default gen_random_uuid(),
  campana_id uuid not null references campanas_recomendacion on delete cascade,
  pedido_id uuid not null unique references pedidos on delete cascade,
  cliente_id uuid not null references clientes on delete cascade,
  mes date not null,
  porcentaje numeric(5, 2) not null,
  monto numeric(12, 2) not null,
  formato_id uuid not null references formatos,                         -- la box a la que se aplicó
  creado_en timestamptz not null default now()
);
create index on canjes_recomendacion (cliente_id, mes);

alter table pedidos add column codigo_recomendacion text;               -- lo que escribió el cliente (normalizado)
alter table pedidos add column descuento numeric(12, 2) not null default 0;  -- ya restado de total

alter table campanas_recomendacion enable row level security;
alter table codigos_recomendacion enable row level security;
alter table recomendaciones enable row level security;
alter table canjes_recomendacion enable row level security;
revoke all on campanas_recomendacion, codigos_recomendacion, recomendaciones, canjes_recomendacion from anon;
create policy "solo admins" on campanas_recomendacion for all to authenticated
  using ((select privado.es_admin()) and es_prueba = (select privado.es_prueba()))
  with check ((select privado.es_admin()) and es_prueba = (select privado.es_prueba()));
create policy "solo admins" on codigos_recomendacion for all to authenticated
  using ((select privado.es_admin()) and exists (select 1 from clientes c where c.id = cliente_id))
  with check ((select privado.es_admin()) and exists (select 1 from clientes c where c.id = cliente_id));
create policy "solo admins" on recomendaciones for all to authenticated
  using ((select privado.es_admin()) and exists (select 1 from pedidos p where p.id = pedido_id))
  with check ((select privado.es_admin()) and exists (select 1 from pedidos p where p.id = pedido_id));
create policy "solo admins" on canjes_recomendacion for all to authenticated
  using ((select privado.es_admin()) and exists (select 1 from pedidos p where p.id = pedido_id))
  with check ((select privado.es_admin()) and exists (select 1 from pedidos p where p.id = pedido_id));

-- Campaña vigente en una fecha, para datos reales o de prueba.
create function campana_vigente(p_fecha date, p_prueba boolean) returns campanas_recomendacion
language sql stable set search_path = public
as $$
  select * from campanas_recomendacion
   where p_fecha between desde and hasta and es_prueba = p_prueba
   order by desde desc
   limit 1;
$$;

-- Porcentaje que le queda a un cliente en el mes de p_fecha: lo ganado (con tope) menos lo usado.
create function saldo_recomendacion(p_cliente uuid, p_fecha date default null) returns numeric
language sql stable set search_path = public
as $$
  with k as (
    select (campana_vigente(coalesce(p_fecha, hoy()), c.es_prueba)).* from clientes c where c.id = p_cliente
  ), m as (select date_trunc('month', coalesce(p_fecha, hoy()))::date as mes)
  select coalesce((
    select greatest(0,
             least(k.tope, k.porcentaje * (select count(*) from recomendaciones r
                                            where r.recomendador_id = p_cliente and r.campana_id = k.id
                                              and r.estado = 'valida' and r.mes = m.mes))
             - coalesce((select sum(x.porcentaje) from canjes_recomendacion x join pedidos p on p.id = x.pedido_id
                          where x.cliente_id = p_cliente and x.campana_id = k.id and x.mes = m.mes
                            and p.estado <> 'rechazado'), 0))
      from k, m where k.id is not null), 0);
$$;

-- Crea el código de un cliente si no tiene: primer nombre (hasta 6 letras, sin tildes) + 3 caracteres que no
-- se confunden al dictarlos (mismo alfabeto que los códigos de pedido). Devuelve el código.
create function privado.crear_codigo(p_cliente uuid) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_codigo text;
  v_base text;
begin
  select codigo into v_codigo from codigos_recomendacion where cliente_id = p_cliente;
  if found then return v_codigo; end if;
  select left(coalesce(nullif(regexp_replace(upper(translate(split_part(trim(nombre), ' ', 1),
                'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')), '[^A-Z]', '', 'g'), ''), 'CINNI'), 6)
    into v_base from clientes where id = p_cliente;
  if v_base is null then return null; end if;
  loop
    v_codigo := v_base || '-' || (select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
                                    from generate_series(1, 3));
    begin
      insert into codigos_recomendacion (cliente_id, codigo) values (p_cliente, v_codigo);
      return v_codigo;
    exception when unique_violation then
      -- otro cliente ya tiene esa clave: se prueba con otros 3 caracteres
    end;
  end loop;
end;
$$;
revoke all on function privado.crear_codigo(uuid) from public, anon, authenticated;

-- Cliente de un celular (últimos 8 dígitos, como cliente_por_telefono) dentro de los datos reales o de prueba.
-- Lo usan las funciones de la web, que corren con la service key y no tienen la RLS que separa los datos.
create function privado.cliente_web(p_tel text, p_prueba boolean) returns uuid
language sql stable set search_path = public
as $$
  select id from clientes
   where es_prueba = p_prueba
     and length(regexp_replace(coalesce(p_tel, ''), '\D', '', 'g')) >= 8
     and right(regexp_replace(coalesce(contacto, ''), '\D', '', 'g'), 8) = right(regexp_replace(p_tel, '\D', '', 'g'), 8)
   order by creado_en
   limit 1;
$$;
revoke all on function privado.cliente_web(text, boolean) from public, anon, authenticated;
grant execute on function privado.cliente_web(text, boolean) to service_role;

-- Qué significa un código para quien pide con ese celular. Lo usan la web (para avisar antes de mandar) y
-- crear_pedido_web. Devuelve { estado, nombre?, porcentaje?, tope? } con estado:
--   sin_campana | no_existe | propio (es suyo: porcentaje = saldo) | ya_cliente (no cuenta: ya compró)
--   | recomendado (cuenta si la venta se paga) | existe (falta el celular para saber)
-- El nombre es solo el primero del dueño del código: nunca se devuelve el celular.
create function consultar_codigo(p_codigo text, p_telefono text, p_prueba boolean default false) returns jsonb
language plpgsql stable set search_path = public
as $$
declare
  k campanas_recomendacion;
  v_clave text := left(regexp_replace(upper(coalesce(p_codigo, '')), '[^A-Z0-9]', '', 'g'), 20);
  v_tel text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_dueno clientes;
  v_cliente uuid;
  v_nombre text;
begin
  k := campana_vigente(hoy(), p_prueba);
  if k.id is null then return jsonb_build_object('estado', 'sin_campana'); end if;
  select c.* into v_dueno from codigos_recomendacion x join clientes c on c.id = x.cliente_id
   where x.clave = v_clave and c.es_prueba = p_prueba;
  if v_dueno.id is null then return jsonb_build_object('estado', 'no_existe'); end if;
  v_nombre := initcap(split_part(trim(v_dueno.nombre), ' ', 1));
  if v_tel !~ '^09[1-9][0-9]{6}$' then return jsonb_build_object('estado', 'existe', 'nombre', v_nombre); end if;

  if right(regexp_replace(coalesce(v_dueno.contacto, ''), '\D', '', 'g'), 8) = right(v_tel, 8) then
    return jsonb_build_object('estado', 'propio', 'nombre', v_nombre,
                              'porcentaje', saldo_recomendacion(v_dueno.id), 'tope', k.tope);
  end if;
  v_cliente := privado.cliente_web(v_tel, p_prueba);
  if v_cliente is not null and exists (select 1 from ventas where cliente_id = v_cliente) then
    return jsonb_build_object('estado', 'ya_cliente', 'nombre', v_nombre);
  end if;
  return jsonb_build_object('estado', 'recomendado', 'nombre', v_nombre);
end;
$$;
revoke all on function consultar_codigo(text, text, boolean) from public, anon, authenticated;
grant execute on function consultar_codigo(text, text, boolean) to service_role;

-- Para la web: si hay campaña y con qué números (se muestra el campo del código solo si hay).
create function campana_web(p_prueba boolean default false) returns jsonb
language sql stable set search_path = public
as $$
  select case when k.id is null then jsonb_build_object('activa', false)
              else jsonb_build_object('activa', true, 'porcentaje', k.porcentaje, 'tope', k.tope, 'hasta', k.hasta) end
    from campana_vigente(hoy(), p_prueba) k;
$$;
revoke all on function campana_web(boolean) from public, anon, authenticated;
grant execute on function campana_web(boolean) to service_role;

-- Pedido de la web: lo de antes + código de recomendación (p.codigo_recomendacion) y marca de prueba (p.prueba,
-- solo la manda el servidor local). Un código inválido no frena el pedido: se ignora y se avisa en la respuesta.
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
  v_total numeric;
  v_cons jsonb;
  v_rec jsonb;
  k campanas_recomendacion;
  v_dueno uuid;
  v_box record;
  v_pct numeric;
  v_desc numeric := 0;
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

  -- Precio y validaciones de rolls: la misma regla que una venta (sin envío: se coordina aparte)
  v_calc := calcular_venta(jsonb_build_object('entrega', 'retiro', 'lineas', v_lineas));
  v_total := (v_calc->>'precio_lista')::numeric;

  -- Código de recomendación: si es el propio, se usa el saldo en la Box fija más cara del pedido.
  if v_clave is not null then
    v_cons := consultar_codigo(v_clave, v_tel, v_prueba);
    v_rec := v_cons;
    if v_cons->>'estado' in ('propio', 'recomendado') then
      k := campana_vigente(hoy(), v_prueba);
      select x.cliente_id into v_dueno from codigos_recomendacion x where x.clave = v_clave;
    end if;
    if v_cons->>'estado' = 'propio' and (v_cons->>'porcentaje')::numeric > 0 then
      select (l->>'formato_id')::uuid as formato_id, l->>'formato' as formato, (l->>'precio_lista')::numeric as precio
        into v_box
        from jsonb_array_elements(v_calc->'lineas') l
        join formatos fo on fo.id = (l->>'formato_id')::uuid
       where fo.tipo = 'caja_fija'
       order by (l->>'precio_lista')::numeric desc
       limit 1;
      if v_box.formato_id is not null then
        v_pct := (v_cons->>'porcentaje')::numeric;
        v_desc := round(v_box.precio * v_pct / 100);
        v_total := v_total - v_desc;
        v_rec := v_rec || jsonb_build_object('aplicado', true, 'monto', v_desc, 'formato', v_box.formato);
      else
        v_rec := v_rec || jsonb_build_object('aplicado', false, 'motivo', 'Solo se aplica a las Box de 6 y de 12');
      end if;
    end if;
  end if;

  loop
    -- 4 caracteres sin los que se confunden al dictarlos (0/O, 1/I/L)
    v_codigo := 'CM-' || extract(year from now() at time zone 'America/Montevideo')::int || '-'
      || (select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
            from generate_series(1, 4));
    exit when not exists (select 1 from pedidos where codigo = v_codigo);
  end loop;

  insert into pedidos (codigo, nombre, telefono, modalidad, direccion, medio_pago, notas, total, ip_hash,
                       es_prueba, codigo_recomendacion, descuento)
  values (v_codigo, v_nombre, v_tel, v_modalidad, case when v_modalidad = 'entrega' then v_direccion end,
          v_pago, v_notas, v_total, p_ip_hash, v_prueba, v_clave, v_desc)
  returning id into v_pedido;

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
    'total', v_total,
    'descuento', v_desc,
    'recomendacion', v_rec,
    'cajas', (select jsonb_agg(jsonb_build_object('formato', x->>'formato', 'precio', (x->>'precio_lista')::numeric))
                from jsonb_array_elements(v_calc->'lineas') x));
end;
$$;

-- confirmar_pedido: igual que antes; la nota de la venta dice si tuvo descuento por recomendación.
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
    'notas', concat_ws(' · ', 'Pedido web ' || ped.codigo, ped.direccion, ped.notas, v_canje),
    'lineas', (select jsonb_agg(jsonb_build_object('formato_id', c.formato_id, 'cantidad', 1, 'sabores', c.sabores)
                                order by c.orden)
                 from pedido_cajas c where c.pedido_id = ped.id)));

  update pedidos set estado = 'confirmado', venta_id = (v_venta->>'venta_id')::uuid,
                     gestionado_en = now(), gestionado_por = auth.uid()
   where id = ped.id;
  return v_venta || jsonb_build_object('codigo', ped.codigo);
end;
$$;

-- Evalúa la venta: si está pagada, el cliente recibe su código (si hay campaña) y, si la venta viene de un
-- pedido con el código de otra persona, la recomendación se valida o se anula. Si no está pagada, la
-- recomendación queda pendiente. Se evalúa desde cero cada vez (la llaman los dos triggers de abajo).
create function privado.evaluar_recomendacion(p_venta uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v ventas;
  r recomendaciones;
  v_motivo text;
begin
  select * into v from ventas where id = p_venta;
  if v.id is null then return; end if;

  select r0.* into r from recomendaciones r0 join pedidos p on p.id = r0.pedido_id where p.venta_id = v.id;
  if r.id is not null and r.estado <> 'pendiente' then
    update recomendaciones set estado = 'pendiente', recomendado_id = null, mes = null, validada_en = null, motivo = null
     where id = r.id;
  end if;

  if v.estado_pago <> 'pagado' or v.cliente_id is null then return; end if;

  if (campana_vigente(hoy(), v.es_prueba)).id is not null then
    perform privado.crear_codigo(v.cliente_id);
  end if;

  if r.id is null then return; end if;
  if v.cliente_id = r.recomendador_id then
    v_motivo := 'Usó su propio código';
  elsif exists (select 1 from ventas x where x.cliente_id = v.cliente_id and x.id <> v.id and x.creado_en < v.creado_en) then
    v_motivo := 'Ya era cliente';
  elsif exists (select 1 from recomendaciones x where x.recomendado_id = v.cliente_id and x.estado = 'valida') then
    v_motivo := 'Ya lo había recomendado otra persona';
  end if;
  update recomendaciones
     set estado = case when v_motivo is null then 'valida' else 'anulada' end,
         motivo = v_motivo,
         recomendado_id = v.cliente_id,
         mes = date_trunc('month', hoy())::date,
         validada_en = now()
   where id = r.id;
end;
$$;
revoke all on function privado.evaluar_recomendacion(uuid) from public, anon, authenticated;

-- Venta nueva o que cambia de estado de pago o de cliente.
create function privado.recomendacion_por_venta() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.estado_pago is not distinct from new.estado_pago
     and old.cliente_id is not distinct from new.cliente_id then
    return null;
  end if;
  perform privado.evaluar_recomendacion(new.id);
  return null;
end;
$$;
revoke all on function privado.recomendacion_por_venta() from public, anon, authenticated;

create trigger recomendacion_por_venta after insert or update of estado_pago, cliente_id on ventas
  for each row execute function privado.recomendacion_por_venta();

-- Pedido confirmado (confirmar_pedido crea la venta antes de enlazarla): se evalúa su venta. Rechazado: la
-- recomendación se anula. Vuelve a nuevo (se borró la venta): vuelve a pendiente. El canje no se toca: deja
-- de contar mientras el pedido está rechazado (saldo_recomendacion).
create function privado.recomendacion_por_pedido() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.estado = 'confirmado' and new.venta_id is not null then
    perform privado.evaluar_recomendacion(new.venta_id);
  elsif new.estado = 'rechazado' then
    update recomendaciones set estado = 'anulada', motivo = 'Pedido rechazado', recomendado_id = null
     where pedido_id = new.id;
  elsif new.estado = 'nuevo' then
    update recomendaciones set estado = 'pendiente', motivo = null, recomendado_id = null, mes = null, validada_en = null
     where pedido_id = new.id;
  end if;
  return null;
end;
$$;
revoke all on function privado.recomendacion_por_pedido() from public, anon, authenticated;

create trigger recomendacion_por_pedido after update of estado, venta_id on pedidos
  for each row when (old.estado is distinct from new.estado or old.venta_id is distinct from new.venta_id)
  execute function privado.recomendacion_por_pedido();

-- fusionar_clientes: además de las ventas, se mueven las recomendaciones y los canjes; queda el código más viejo.
create or replace function fusionar_clientes(p_quedar uuid, p_borrar uuid) returns void
language plpgsql set search_path = public
as $$
declare
  b clientes%rowtype;
begin
  if p_quedar = p_borrar then
    raise exception 'Elegí dos clientes distintos';
  end if;
  select * into b from clientes where id = p_borrar;
  if not found or not exists (select 1 from clientes where id = p_quedar) then
    raise exception 'Cliente inexistente';
  end if;
  update ventas set cliente_id = p_quedar where cliente_id = p_borrar;
  update recomendaciones set recomendador_id = p_quedar where recomendador_id = p_borrar;
  -- si los dos habían llegado recomendados, cuenta la primera
  update recomendaciones set estado = 'anulada', motivo = 'Clientes fusionados'
   where recomendado_id = p_borrar and estado = 'valida'
     and exists (select 1 from recomendaciones x where x.recomendado_id = p_quedar and x.estado = 'valida');
  update recomendaciones set recomendado_id = p_quedar where recomendado_id = p_borrar;
  update canjes_recomendacion set cliente_id = p_quedar where cliente_id = p_borrar;
  if exists (select 1 from codigos_recomendacion where cliente_id = p_borrar)
     and (not exists (select 1 from codigos_recomendacion where cliente_id = p_quedar)
          or (select creado_en from codigos_recomendacion where cliente_id = p_borrar)
             < (select creado_en from codigos_recomendacion where cliente_id = p_quedar)) then
    delete from codigos_recomendacion where cliente_id = p_quedar;
    update codigos_recomendacion set cliente_id = p_quedar where cliente_id = p_borrar;
  end if;
  update clientes
     set contacto = coalesce(contacto, b.contacto),
         origen = coalesce(origen, b.origen),
         notas = nullif(concat_ws('; ', notas, b.notas), '')
   where id = p_quedar;
  delete from clientes where id = p_borrar;
end;
$$;

-- Crear o editar una campaña desde /admin. p: { id?, nombre, desde, hasta, porcentaje?, tope? }.
-- No se pueden pisar dos campañas (de la misma marca de prueba).
create function guardar_campana(p jsonb) returns uuid
language plpgsql set search_path = public
as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_desde date := (p->>'desde')::date;
  v_hasta date := (p->>'hasta')::date;
begin
  if nullif(trim(p->>'nombre'), '') is null then raise exception 'Falta el nombre de la campaña'; end if;
  if v_desde is null or v_hasta is null then raise exception 'Faltan las fechas'; end if;
  if v_hasta < v_desde then raise exception 'La campaña termina antes de empezar'; end if;
  if exists (select 1 from campanas_recomendacion
              where id is distinct from v_id and es_prueba = privado.es_prueba()
                and desde <= v_hasta and hasta >= v_desde) then
    raise exception 'Ya hay una campaña en esas fechas';
  end if;
  if v_id is null then
    insert into campanas_recomendacion (nombre, desde, hasta, porcentaje, tope)
    values (trim(p->>'nombre'), v_desde, v_hasta,
            coalesce(nullif(p->>'porcentaje', '')::numeric, 5), coalesce(nullif(p->>'tope', '')::numeric, 30))
    returning id into v_id;
  else
    update campanas_recomendacion
       set nombre = trim(p->>'nombre'), desde = v_desde, hasta = v_hasta,
           porcentaje = coalesce(nullif(p->>'porcentaje', '')::numeric, porcentaje),
           tope = coalesce(nullif(p->>'tope', '')::numeric, tope)
     where id = v_id;
    if not found then raise exception 'La campaña no existe'; end if;
  end if;
  return v_id;
end;
$$;

-- Al arrancar una campaña: código para todos los clientes que ya compraron (así pueden recomendar desde el día 1).
create function generar_codigos() returns int
language plpgsql security definer set search_path = public
as $$
declare
  c record;
  n int := 0;
begin
  if not privado.es_admin() then raise exception 'Solo admins'; end if;
  for c in select distinct v.cliente_id from ventas v
            where v.cliente_id is not null and v.estado_pago = 'pagado' and v.es_prueba = privado.es_prueba()
              and not exists (select 1 from codigos_recomendacion x where x.cliente_id = v.cliente_id) loop
    perform privado.crear_codigo(c.cliente_id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Resumen de una campaña para /admin → Recomendaciones.
create function resumen_campana(p_campana uuid) returns jsonb
language sql stable set search_path = public
as $$
  with k as (select * from campanas_recomendacion where id = p_campana),
  r as (select r.* from recomendaciones r where r.campana_id = p_campana),
  nuevos as (select recomendado_id from r where estado = 'valida'),
  canjes as (select x.* from canjes_recomendacion x join pedidos p on p.id = x.pedido_id
              where x.campana_id = p_campana and p.estado = 'confirmado'),
  -- clientes nuevos de cualquier origen en las fechas de la campaña (para comparar)
  primeras as (select v.cliente_id, min(v.fecha) as fecha from ventas v where v.cliente_id is not null group by 1)
  select jsonb_build_object(
    'validas', (select count(*) from r where estado = 'valida'),
    'pendientes', (select count(*) from r where estado = 'pendiente'),
    'anuladas', (select count(*) from r where estado = 'anulada'),
    'clientes_nuevos_total', (select count(*) from primeras, k where primeras.fecha between k.desde and k.hasta),
    'vendido_recomendados', coalesce((select sum(v.precio_cobrado + v.cobro_envio) from ventas v, k
                                       where v.cliente_id in (select recomendado_id from nuevos)
                                         and v.fecha between k.desde and k.hasta), 0),
    'volvieron', (select count(*) from nuevos n where (select count(*) from ventas v where v.cliente_id = n.recomendado_id) > 1),
    'canjes', (select count(*) from canjes),
    'descuento_entregado', coalesce((select sum(monto) from canjes), 0),
    'costo_por_cliente', (select round(coalesce(sum(monto), 0) / nullif((select count(*) from nuevos), 0), 2) from canjes),
    'ranking', coalesce((select jsonb_agg(x order by x.validas desc, x.nombre)
                           from (select c.id, c.nombre, count(*) as validas from r join clientes c on c.id = r.recomendador_id
                                  where r.estado = 'valida' group by c.id, c.nombre) x), '[]'));
$$;

-- Recomendaciones con nombres, para /admin.
create view v_recomendaciones with (security_invoker = true) as
select r.*, k.nombre as campana, p.codigo as pedido, p.venta_id,
       d.nombre as recomendador, n.nombre as recomendado, p.nombre as nombre_pedido
  from recomendaciones r
  join campanas_recomendacion k on k.id = r.campana_id
  join pedidos p on p.id = r.pedido_id
  join clientes d on d.id = r.recomendador_id
  left join clientes n on n.id = r.recomendado_id;

-- Pedidos web: lo de antes + descuento, código usado y qué pasó con él.
create or replace view v_pedidos with (security_invoker = true) as
select p.id, p.codigo, p.creado_en, p.estado, p.nombre, p.telefono, p.modalidad, p.direccion, p.medio_pago, p.notas,
       p.total, p.ip_hash, p.venta_id, p.motivo_rechazo, p.gestionado_en, p.gestionado_por,
       c.id as cliente_sugerido_id,
       c.nombre as cliente_sugerido,
       (select count(*) from ventas v where v.cliente_id = c.id) as compras_cliente,
       p.comprobante,
       p.descuento,
       p.codigo_recomendacion,
       x.porcentaje as descuento_porcentaje,
       r.estado as recomendacion_estado,
       r.motivo as recomendacion_motivo,
       d.nombre as recomendador
  from pedidos p
  left join clientes c on c.id = cliente_por_telefono(p.telefono)
  left join canjes_recomendacion x on x.pedido_id = p.id
  left join recomendaciones r on r.pedido_id = p.id
  left join clientes d on d.id = r.recomendador_id;

-- Borra todo lo cargado en modo prueba (solo lo puede llamar el usuario de prueba). Los comprobantes de los
-- pedidos de prueba los borra /admin del bucket antes de llamar a esto.
create function borrar_datos_prueba() returns jsonb
language plpgsql set search_path = public
as $$
declare
  n_pedidos int;
  n_ventas int;
  n_clientes int;
  n_campanas int;
begin
  if not privado.es_prueba() then raise exception 'Solo el usuario de prueba puede borrar datos de prueba'; end if;
  delete from pedidos where es_prueba;           -- con sus cajas, recomendaciones y canjes
  get diagnostics n_pedidos = row_count;
  delete from ventas where es_prueba;            -- con sus líneas
  get diagnostics n_ventas = row_count;
  delete from clientes where es_prueba;          -- con sus códigos
  get diagnostics n_clientes = row_count;
  delete from campanas_recomendacion where es_prueba;
  get diagnostics n_campanas = row_count;
  return jsonb_build_object('pedidos', n_pedidos, 'ventas', n_ventas, 'clientes', n_clientes, 'campanas', n_campanas);
end;
$$;

revoke all on function campana_vigente(date, boolean) from public, anon;
revoke all on function saldo_recomendacion(uuid, date) from public, anon;
revoke all on function guardar_campana(jsonb) from public, anon;
revoke all on function generar_codigos() from public, anon;
revoke all on function resumen_campana(uuid) from public, anon;
revoke all on function borrar_datos_prueba() from public, anon;
grant execute on function campana_vigente(date, boolean) to authenticated, service_role;
grant execute on function saldo_recomendacion(uuid, date) to authenticated, service_role;
grant execute on function guardar_campana(jsonb) to authenticated;
grant execute on function generar_codigos() to authenticated;
grant execute on function resumen_campana(uuid) to authenticated;
grant execute on function borrar_datos_prueba() to authenticated;
revoke all on v_recomendaciones from anon;
