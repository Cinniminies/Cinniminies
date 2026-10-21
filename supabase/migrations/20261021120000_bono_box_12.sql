-- Bono por la primera Box de 12 (decisiones del 21/10, docs/descuento-plan/logica.md, sección 10).
--
-- * Cualquier cliente (nuevo o no) que, durante una campaña, paga su primer pedido de la web con una Box de 12
--   recibe su código y además un bono del porcentaje de la campaña (5 %). Uno por cliente y por campaña.
-- * El bono vale 30 días desde que se recibe (cuando la venta queda pagada), aunque la campaña termine antes.
-- * Se suma a lo ganado recomendando, dentro del mismo tope (30 %), y se usa como el resto del saldo: en una
--   Box de 6 o de 12 de cada pedido que haga en la web con su código. No sirve en el pedido que lo genera.
-- * Si la venta deja de estar pagada, cambia de cliente o se borra, el bono se va con ella.

create table bonos_recomendacion (
  id uuid primary key default gen_random_uuid(),
  campana_id uuid not null references campanas_recomendacion on delete cascade,
  cliente_id uuid not null references clientes on delete cascade,
  venta_id uuid not null unique references ventas on delete cascade,  -- la venta pagada que lo dio
  pedido_id uuid not null references pedidos on delete cascade,
  porcentaje numeric(5, 2) not null check (porcentaje > 0),
  desde date not null,                                                 -- el día que se recibió
  hasta date not null,                                                 -- último día en que se puede usar
  creado_en timestamptz not null default now(),
  unique (campana_id, cliente_id),                                     -- uno por cliente y por campaña
  check (hasta >= desde)
);
create index on bonos_recomendacion (cliente_id, desde);
create index on bonos_recomendacion (pedido_id);

alter table bonos_recomendacion enable row level security;
revoke all on bonos_recomendacion from anon;
-- la RLS de clientes ya separa los de prueba de los reales
create policy "solo admins" on bonos_recomendacion for all to authenticated
  using ((select privado.es_admin()) and exists (select 1 from clientes c where c.id = cliente_id))
  with check ((select privado.es_admin()) and exists (select 1 from clientes c where c.id = cliente_id));

-- Días que dura el bono contando el día en que se recibe: el 20/12 → hasta el 19/1.
create function privado.dias_bono() returns int language sql immutable as $$ select 30 $$;

-- El bono vigente de un cliente en una fecha (o null).
create function bono_recomendacion(p_cliente uuid, p_fecha date default null) returns bonos_recomendacion
language sql stable set search_path = public
as $$
  select * from bonos_recomendacion
   where cliente_id = p_cliente and coalesce(p_fecha, hoy()) between desde and hasta
   order by desde desc
   limit 1;
$$;

-- Saldo: lo ganado recomendando en el mes (como antes) + el bono vigente, con el tope de la campaña.
-- Terminada la campaña solo queda el bono (con el tope de su campaña).
create or replace function saldo_recomendacion(p_cliente uuid, p_fecha date default null) returns numeric
language sql stable set search_path = public
as $$
  with d as (select coalesce(p_fecha, hoy()) as dia),
  k as (select (campana_vigente(d.dia, c.es_prueba)).* from clientes c, d where c.id = p_cliente),
  ganado as (
    select k.porcentaje * count(*) as pct from k, d, recomendaciones r
     where k.id is not null and r.recomendador_id = p_cliente and r.campana_id = k.id and r.estado = 'valida'
       and r.mes = date_trunc('month', d.dia)::date
     group by k.porcentaje),
  bono as (
    select b.porcentaje, kb.tope from d, bono_recomendacion(p_cliente, d.dia) b
      join campanas_recomendacion kb on kb.id = b.campana_id
     where b.id is not null)
  select coalesce(least(coalesce((select tope from k), (select tope from bono)),
                        coalesce((select pct from ganado), 0) + coalesce((select porcentaje from bono), 0)), 0);
$$;

-- ¿Hay algún bono vigente? Mientras haya, la web sigue mostrando el campo del código aunque no haya campaña.
create function privado.hay_bonos(p_prueba boolean) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from bonos_recomendacion b join clientes c on c.id = b.cliente_id
                  where c.es_prueba = p_prueba and hoy() between b.desde and b.hasta);
$$;
revoke all on function privado.hay_bonos(boolean) from public, anon, authenticated;
grant execute on function privado.hay_bonos(boolean) to service_role;

-- Para la web: además de la campaña, solo_canje = no hay campaña pero queda algún bono por usar.
create or replace function campana_web(p_prueba boolean default false) returns jsonb
language sql stable set search_path = public
as $$
  select case when k.id is not null
                then jsonb_build_object('activa', true, 'porcentaje', k.porcentaje, 'tope', k.tope, 'hasta', k.hasta)
              when privado.hay_bonos(p_prueba) then jsonb_build_object('activa', false, 'solo_canje', true)
              else jsonb_build_object('activa', false) end
    from campana_vigente(hoy(), p_prueba) k;
$$;

-- consultar_codigo: como antes, y con su propio código también devuelve el bono (bono, bono_hasta) y si hay
-- campaña. Sin campaña pero con bonos vigentes, solo responde a los dueños de los códigos (propio).
create or replace function consultar_codigo(p_codigo text, p_telefono text, p_prueba boolean default false) returns jsonb
language plpgsql stable set search_path = public
as $$
declare
  k campanas_recomendacion;
  b bonos_recomendacion;
  v_clave text := left(regexp_replace(upper(coalesce(p_codigo, '')), '[^A-Z0-9]', '', 'g'), 20);
  v_tel text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_dueno clientes;
  v_cliente uuid;
  v_nombre text;
begin
  k := campana_vigente(hoy(), p_prueba);
  if k.id is null and not privado.hay_bonos(p_prueba) then return jsonb_build_object('estado', 'sin_campana'); end if;
  select c.* into v_dueno from codigos_recomendacion x join clientes c on c.id = x.cliente_id
   where x.clave = v_clave and c.es_prueba = p_prueba;
  if v_dueno.id is null then return jsonb_build_object('estado', 'no_existe'); end if;
  v_nombre := initcap(split_part(trim(v_dueno.nombre), ' ', 1));
  if v_tel !~ '^09[1-9][0-9]{6}$' then return jsonb_build_object('estado', 'existe', 'nombre', v_nombre); end if;

  if right(regexp_replace(coalesce(v_dueno.contacto, ''), '\D', '', 'g'), 8) = right(v_tel, 8) then
    b := bono_recomendacion(v_dueno.id);
    return jsonb_strip_nulls(jsonb_build_object('estado', 'propio', 'nombre', v_nombre,
      'porcentaje', saldo_recomendacion(v_dueno.id),
      'tope', coalesce(k.tope, (select tope from campanas_recomendacion where id = b.campana_id)),
      'campana', k.id is not null, 'bono', b.porcentaje, 'bono_hasta', b.hasta));
  end if;
  if k.id is null then return jsonb_build_object('estado', 'sin_campana'); end if;
  v_cliente := privado.cliente_web(v_tel, p_prueba);
  if v_cliente is not null and exists (select 1 from ventas where cliente_id = v_cliente) then
    return jsonb_build_object('estado', 'ya_cliente', 'nombre', v_nombre);
  end if;
  return jsonb_build_object('estado', 'recomendado', 'nombre', v_nombre);
end;
$$;

-- Da, mueve o saca el bono de una venta. Lo da si la venta viene de un pedido web confirmado, está pagada,
-- tiene una Box de 12, el pedido se hizo durante una campaña y el cliente no tenía bono en esa campaña.
create function privado.evaluar_bono(p_venta uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v ventas;
  ped pedidos;
  b bonos_recomendacion;
  k campanas_recomendacion;
begin
  select * into v from ventas where id = p_venta;
  if v.id is null then return; end if;  -- borrada: el bono se borró con ella
  select * into ped from pedidos where venta_id = v.id;
  if ped.id is not null then
    k := campana_vigente((ped.creado_en at time zone 'America/Montevideo')::date, v.es_prueba);
  end if;
  if ped.estado is distinct from 'confirmado' or v.estado_pago <> 'pagado' or v.cliente_id is null or k.id is null
     or not exists (select 1 from venta_lineas l join formatos f on f.id = l.formato_id
                     where l.venta_id = v.id and f.tipo = 'caja_fija' and f.rolls = 12) then
    delete from bonos_recomendacion where venta_id = v.id;
    return;
  end if;

  select * into b from bonos_recomendacion where venta_id = v.id;
  if b.id is null then
    insert into bonos_recomendacion (campana_id, cliente_id, venta_id, pedido_id, porcentaje, desde, hasta)
    values (k.id, v.cliente_id, v.id, ped.id, k.porcentaje, hoy(), hoy() + privado.dias_bono())
    on conflict (campana_id, cliente_id) do nothing;
  elsif b.cliente_id <> v.cliente_id then
    -- la venta cambió de cliente (o se fusionaron): el bono la sigue, salvo que el otro ya tenga uno
    if exists (select 1 from bonos_recomendacion x where x.cliente_id = v.cliente_id and x.campana_id = b.campana_id) then
      delete from bonos_recomendacion where id = b.id;
    else
      update bonos_recomendacion set cliente_id = v.cliente_id where id = b.id;
    end if;
  end if;
end;
$$;
revoke all on function privado.evaluar_bono(uuid) from public, anon, authenticated;

-- La evaluación de cada venta (la llaman los triggers de ventas y pedidos) ahora también mira el bono.
create or replace function privado.recomendacion_por_venta() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.estado_pago is not distinct from new.estado_pago
     and old.cliente_id is not distinct from new.cliente_id then
    return null;
  end if;
  perform privado.evaluar_recomendacion(new.id);
  perform privado.evaluar_bono(new.id);
  return null;
end;
$$;

create or replace function privado.recomendacion_por_pedido() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.estado = 'confirmado' and new.venta_id is not null then
    perform privado.evaluar_recomendacion(new.venta_id);
    perform privado.evaluar_bono(new.venta_id);
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


-- Pedido de la web: igual que antes; terminada la campaña, el canje de un bono vigente va a la campaña del bono.
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
      -- terminada la campaña, el canje de un bono que sigue vigente queda en la campaña del bono
      if k.id is null then
        select * into k from campanas_recomendacion where id = (bono_recomendacion(v_dueno)).campana_id;
      end if;
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

-- Resumen de la campaña: + bonos dados y vigentes.
create or replace function resumen_campana(p_campana uuid) returns jsonb
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
    'bonos', (select count(*) from bonos_recomendacion where campana_id = p_campana),
    'bonos_vigentes', (select count(*) from bonos_recomendacion where campana_id = p_campana and hoy() between desde and hasta),
    'canjes', (select count(*) from canjes),
    'descuento_entregado', coalesce((select sum(monto) from canjes), 0),
    'costo_por_cliente', (select round(coalesce(sum(monto), 0) / nullif((select count(*) from nuevos), 0), 2) from canjes),
    'ranking', coalesce((select jsonb_agg(x order by x.validas desc, x.nombre)
                           from (select c.id, c.nombre, count(*) as validas from r join clientes c on c.id = r.recomendador_id
                                  where r.estado = 'valida' group by c.id, c.nombre) x), '[]'));
$$;

-- Textos nuevos del bono, editables en /admin → Textos e imágenes ({bono}: el % del bono, {vence}: hasta cuándo).
insert into contenido_web (clave, seccion, orden, etiqueta, ayuda, tipo, valor, original)
select clave, 'Descuento por recomendación', orden, etiqueta, ayuda, tipo, valor, valor from (values
  ('recomendacion.bono_aviso', 10, 'Aviso del bono por la Box de 12',
    'Debajo del campo del código, mientras haya campaña. {bono}: el % del bono.', 'texto_largo',
    'Tu primera Box de 12 de la campaña te deja {bono} % de descuento para tus próximos pedidos, por 30 días.'),
  ('recomendacion.bono_premio', 11, 'Tarjeta del descuento: bono',
    'Se agrega a la tarjeta cuando tiene el bono. {bono}: el % del bono, {vence}: último día (ej: 19/1).', 'texto',
    'Incluye {bono} % por tu primera Box de 12, hasta el {vence}.'),
  ('recomendacion.mensaje_bono', 12, 'Mensaje de WhatsApp: bono',
    'Se agrega al mensaje con el código cuando el cliente tiene el bono. {bono}: el % del bono, {vence}: último día.',
    'texto_largo', 'Y por tu primera Box de 12 ya tenés {bono} % de descuento para tus próximos pedidos, hasta el {vence}.')
) as t(clave, orden, etiqueta, ayuda, tipo, valor);

revoke all on function bono_recomendacion(uuid, date) from public, anon;
grant execute on function bono_recomendacion(uuid, date) to authenticated, service_role;
