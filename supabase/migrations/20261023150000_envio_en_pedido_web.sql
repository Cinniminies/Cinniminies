-- Envío dentro del total del pedido web (23/10, después del testeo como cliente).
--
-- Antes el pedido con entrega guardaba y mostraba solo los productos ("Total a transferir: $250") y el envío
-- se sumaba recién al confirmarlo como venta. Ahora:
-- * pedidos.envio guarda lo que se cobra de envío (parámetro precio_envio) y pedidos.total lo incluye.
-- * crear_pedido_web lo calcula con calcular_venta (entrega → envío) y lo devuelve aparte.
-- * confirmar_pedido pasa a la venta el precio sin el envío, porque la venta lo suma como cobro_envio.
--   Los pedidos ya cargados quedan con envio = 0 y se confirman igual que antes.
-- * catalogo_web devuelve el precio del envío para mostrarlo en el formulario.

alter table pedidos add column envio numeric(12, 2) not null default 0;
comment on column pedidos.envio is 'Envío incluido en total (0 si es retiro)';

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
  v_envio numeric;
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
                                              'lineas', v_lineas));
  v_total := (v_calc->>'precio_lista')::numeric;
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

  v_total := v_total + v_envio;

  loop
    -- 4 caracteres sin los que se confunden al dictarlos (0/O, 1/I/L)
    v_codigo := 'CM-' || extract(year from now() at time zone 'America/Montevideo')::int || '-'
      || (select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
            from generate_series(1, 4));
    exit when not exists (select 1 from pedidos where codigo = v_codigo);
  end loop;

  insert into pedidos (codigo, nombre, telefono, modalidad, direccion, medio_pago, notas, total, ip_hash,
                       es_prueba, codigo_recomendacion, descuento, envio)
  values (v_codigo, v_nombre, v_tel, v_modalidad, case when v_modalidad = 'entrega' then v_direccion end,
          v_pago, v_notas, v_total, p_ip_hash, v_prueba, v_clave, v_desc, v_envio)
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
    'envio', v_envio,
    'descuento', v_desc,
    'recomendacion', v_rec,
    'cajas', (select jsonb_agg(jsonb_build_object('formato', x->>'formato', 'precio', (x->>'precio_lista')::numeric))
                from jsonb_array_elements(v_calc->'lineas') x));
end;
$$;


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
    'precio_especial', ped.total - ped.envio,   -- la venta suma el envío aparte (cobro_envio)
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

create or replace function catalogo_web() returns jsonb
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
    'envio', (select valor::numeric from parametros where clave = 'precio_envio'));
$$;
