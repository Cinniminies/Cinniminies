-- Etapa 6: los pedidos de la web se guardan en la base y se confirman como venta desde /admin.

create table pedidos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,                  -- CM-2026-X7K2 (lo genera la base)
  creado_en timestamptz not null default now(),
  estado text not null default 'nuevo' check (estado in ('nuevo', 'confirmado', 'rechazado')),
  nombre text not null,
  telefono text not null check (telefono ~ '^09[1-9][0-9]{6}$'),  -- celular uruguayo
  modalidad text not null check (modalidad in ('retiro', 'entrega')),
  direccion text,
  medio_pago text not null check (medio_pago in ('efectivo', 'transferencia')),
  notas text,
  total numeric(12, 2) not null,                -- recalculado por la base, sin envío
  ip_hash text,                                 -- para limitar pedidos por IP (no se guarda la IP)
  venta_id uuid references ventas on delete set null,
  motivo_rechazo text,
  gestionado_en timestamptz,
  gestionado_por uuid,
  check (modalidad <> 'entrega' or nullif(trim(direccion), '') is not null)
);
create index on pedidos (estado, creado_en);
create index on pedidos (ip_hash, creado_en);

create table pedido_cajas (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos on delete cascade,
  orden int not null,
  formato_id uuid not null references formatos,
  precio numeric(12, 2) not null,
  sabores jsonb not null                        -- [{ sabor_id, unidades }]
);
create index on pedido_cajas (pedido_id);

alter table pedidos enable row level security;
alter table pedido_cajas enable row level security;
revoke all on pedidos, pedido_cajas from anon;
create policy "solo admins" on pedidos for all to authenticated
  using ((select privado.es_admin())) with check ((select privado.es_admin()));
create policy "solo admins" on pedido_cajas for all to authenticated
  using ((select privado.es_admin())) with check ((select privado.es_admin()));

-- Guarda un pedido de la web. Lo llama /api/pedidos con la service key.
-- payload: { nombre, telefono, modalidad ('retiro'|'entrega'), direccion?, pago ('efectivo'|'transferencia'),
--            notas?, cajas: [{ tipo: 'caja_fija', rolls: 6, sabores: { canela: 3, oreo: 3 } }
--                            | { tipo: 'personalizado', sabores: { dulce: 2, ... } }] }
-- Los sabores van por identificador web. Solo se aceptan formatos y sabores visibles en la web, y
-- el precio sale de calcular_venta (misma regla que las ventas; el total del navegador no se usa).
create function crear_pedido_web(p jsonb, p_ip_hash text default null) returns jsonb
language plpgsql set search_path = public
as $$
declare
  v_nombre text := left(trim(coalesce(p->>'nombre', '')), 100);
  v_tel text := regexp_replace(coalesce(p->>'telefono', ''), '\D', '', 'g');
  v_modalidad text := lower(coalesce(p->>'modalidad', ''));
  v_direccion text := left(nullif(trim(p->>'direccion'), ''), 200);
  v_pago text := lower(coalesce(p->>'pago', ''));
  v_notas text := left(nullif(trim(p->>'notas'), ''), 500);
  v_caja jsonb;
  v_sabor record;
  f formatos%rowtype;
  s sabores%rowtype;
  v_items jsonb;
  v_lineas jsonb := '[]';
  v_calc jsonb;
  v_codigo text;
  v_pedido uuid;
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

  loop
    -- 4 caracteres sin los que se confunden al dictarlos (0/O, 1/I/L)
    v_codigo := 'CM-' || extract(year from now() at time zone 'America/Montevideo')::int || '-'
      || (select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
            from generate_series(1, 4));
    exit when not exists (select 1 from pedidos where codigo = v_codigo);
  end loop;

  insert into pedidos (codigo, nombre, telefono, modalidad, direccion, medio_pago, notas, total, ip_hash)
  values (v_codigo, v_nombre, v_tel, v_modalidad, case when v_modalidad = 'entrega' then v_direccion end,
          v_pago, v_notas, (v_calc->>'precio_lista')::numeric, p_ip_hash)
  returning id into v_pedido;

  for v_caja in select * from jsonb_array_elements(v_calc->'lineas') loop
    i := i + 1;
    insert into pedido_cajas (pedido_id, orden, formato_id, precio, sabores)
    values (v_pedido, i, (v_caja->>'formato_id')::uuid, (v_caja->>'precio_lista')::numeric,
            (select jsonb_agg(jsonb_build_object('sabor_id', x->'sabor_id', 'unidades', x->'unidades'))
               from jsonb_array_elements(v_caja->'sabores') x));
  end loop;

  return jsonb_build_object(
    'codigo', v_codigo,
    'total', (v_calc->>'precio_lista')::numeric,
    'cajas', (select jsonb_agg(jsonb_build_object('formato', x->>'formato', 'precio', (x->>'precio_lista')::numeric))
                from jsonb_array_elements(v_calc->'lineas') x));
end;
$$;

revoke all on function crear_pedido_web(jsonb, text) from public, anon, authenticated;
grant execute on function crear_pedido_web(jsonb, text) to service_role;

-- Convierte un pedido nuevo en venta (con snapshots, vía registrar_venta). El cliente se busca por
-- teléfono (últimos 8 dígitos del contacto) y, si no existe, se crea con origen "Web".
-- Se cobra el total que vio el cliente (si los precios cambiaron, queda como precio especial).
-- p (opcional): { estado_pago?: 'pagado'|'pendiente' (default pendiente), fecha? }
create function confirmar_pedido(p_pedido uuid, p jsonb default '{}') returns jsonb
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

  select id into v_cliente from clientes
   where right(regexp_replace(coalesce(contacto, ''), '\D', '', 'g'), 8) = right(ped.telefono, 8)
   order by creado_en limit 1;

  v_venta := registrar_venta(jsonb_build_object(
    'fecha', coalesce(nullif(p->>'fecha', ''), hoy()::text),
    'cliente_id', v_cliente,
    'cliente', case when v_cliente is null then
      jsonb_build_object('nombre', ped.nombre, 'contacto', ped.telefono, 'origen', 'Web') end,
    'origen', 'Web',
    'entrega', case ped.modalidad when 'entrega' then 'envio' else 'retiro' end,
    'medio_pago', ped.medio_pago,
    'estado_pago', coalesce(nullif(p->>'estado_pago', ''), 'pendiente'),
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

create function rechazar_pedido(p_pedido uuid, p_motivo text default null) returns void
language plpgsql set search_path = public
as $$
begin
  update pedidos set estado = 'rechazado', motivo_rechazo = nullif(trim(p_motivo), ''),
                     gestionado_en = now(), gestionado_por = auth.uid()
   where id = p_pedido and estado = 'nuevo';
  if not found then raise exception 'El pedido no existe o ya fue gestionado'; end if;
end;
$$;

revoke all on function confirmar_pedido(uuid, jsonb) from public, anon;
revoke all on function rechazar_pedido(uuid, text) from public, anon;
grant execute on function confirmar_pedido(uuid, jsonb) to authenticated;
grant execute on function rechazar_pedido(uuid, text) to authenticated;
