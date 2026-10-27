-- Promos (docs/descuentos-admin.md, decisiones del 26/10): descuentos por fechas que se cargan en /admin → Promociones.
-- * Una promo es un % o un monto fijo por caja, entre dos fechas (inclusive), para ciertas cajas (formatos) y
--   ciertos sabores. Sin formatos o sin sabores elegidos = todos.
-- * Caja mezclada: descuenta en proporción a los rolls de los sabores de la promo (3 de 6 = la mitad).
-- * Si dos promos tocan la misma caja, vale la que más descuenta (no se suman).
-- * Código de recomendación + promo en la misma caja: vale el mayor (crear_pedido_web).
-- * Web: el pedido la descuenta solo. Admin: la venta nueva la descuenta sola (aplicar_promo) y se puede sacar.

create table promos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) between 1 and 60),
  tipo text not null check (tipo in ('porcentaje', 'monto')),
  valor numeric not null check (valor > 0 and (tipo <> 'porcentaje' or valor <= 90)),
  desde date not null,
  hasta date not null,
  formatos uuid[] not null default '{}',
  sabores uuid[] not null default '{}',
  texto_web text check (length(texto_web) <= 140),
  activa boolean not null default true,
  es_prueba boolean not null default privado.es_prueba(),
  creado_en timestamptz not null default now(),
  check (hasta >= desde)
);

alter table promos enable row level security;
revoke all on promos from anon;
-- El usuario de prueba solo ve (y solo usa) sus promos; la web real, solo las reales.
create policy "solo admins" on promos for all to authenticated
  using ((select privado.es_admin()) and es_prueba = (select privado.es_prueba()))
  with check ((select privado.es_admin()) and es_prueba = (select privado.es_prueba()));

-- Cuánto descuenta la mejor promo de `p_fecha` en una línea de calcular_venta
-- ({formato_id, cantidad, rolls, precio_lista, sabores: [{sabor_id, unidades}]}). Null si ninguna aplica.
-- p_prueba: promos del usuario de prueba (pedidos de prueba del servidor local) o las reales.
create function privado.promo_de_linea(l jsonb, p_fecha date, p_prueba boolean) returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object('promo_id', x.id, 'promo', x.nombre, 'monto', x.monto)
    from (
      select pr.id, pr.nombre,
             least((l->>'precio_lista')::numeric, round(
               case pr.tipo when 'porcentaje' then (l->>'precio_lista')::numeric * pr.valor / 100
                            else pr.valor * (l->>'cantidad')::int end
               * (select coalesce(sum((s->>'unidades')::int) filter (
                          where cardinality(pr.sabores) = 0 or (s->>'sabor_id')::uuid = any(pr.sabores)), 0)
                    from jsonb_array_elements(l->'sabores') s)
               / nullif((l->>'rolls')::numeric, 0))) as monto
        from promos pr
       where pr.activa and pr.es_prueba = p_prueba and p_fecha between pr.desde and pr.hasta
         and (cardinality(pr.formatos) = 0 or (l->>'formato_id')::uuid = any(pr.formatos))
    ) x
   where x.monto > 0
   order by x.monto desc, x.nombre
   limit 1;
$$;
revoke all on function privado.promo_de_linea(jsonb, date, boolean) from public, anon;
grant execute on function privado.promo_de_linea(jsonb, date, boolean) to authenticated, service_role;

-- Lo que la promo descontó en el pedido web (aparte del descuento por recomendación) y su nombre.
alter table pedidos add column descuento_promo numeric not null default 0, add column promo text;

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
  v_promo numeric := 0;
  v_promo_linea jsonb;
  -- promos de prueba o reales: el pedido web lo dice; en el admin, según quién está usando la app
  v_prueba boolean := coalesce(nullif(p->>'prueba', '')::boolean, privado.es_prueba());
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
    -- Promo vigente que más descuenta en esta línea (la regla está en privado.promo_de_linea)
    v_promo_linea := privado.promo_de_linea(v_lineas->-1, v_fecha, v_prueba);
    if v_promo_linea is not null then
      v_lineas := jsonb_set(v_lineas, '{-1,promo}', v_promo_linea);
      v_promo := v_promo + (v_promo_linea->>'monto')::numeric;
    end if;
    v_lista := v_lista + v_precio_linea;
    v_costo_prod := v_costo_prod + v_costo_prod_linea;
    v_costo_cajas := v_costo_cajas + v_costo_caja;
    v_rolls_total := v_rolls_total + v_rolls;
  end loop;

  -- aplicar_promo: la venta nueva del admin la descuenta sola; el resto la recibe como dato (descuento_promo)
  v_cobrado := coalesce(nullif(p->>'precio_especial', '')::numeric,
                        v_lista - case when coalesce((p->>'aplicar_promo')::boolean, false) then v_promo else 0 end);
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
    'descuento_promo', v_promo,
    'cobro_envio', v_envio,
    'costo_produccion', round(v_costo_prod, 2),
    'costo_caja', v_costo_cajas,
    'ganancia', round(v_cobrado + v_envio - v_costo_prod - v_costo_cajas, 2),
    'lineas', v_lineas);
end;
$$;

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
    'descuento_promo', v_promo,
    'promo', v_promo_nombre,
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

-- catalogo_web ahora recibe p_prueba (el servidor local en modo prueba ve las promos de prueba)
drop function catalogo_web();
create function catalogo_web(p_prueba boolean default false) returns jsonb
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
       where pr.activa and pr.es_prueba = p_prueba and hoy() between pr.desde and pr.hasta), '[]'::jsonb));
$$;
revoke all on function catalogo_web(boolean) from public, anon, authenticated;
grant execute on function catalogo_web(boolean) to service_role;

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
       d.nombre as recomendador,
       p.descuento_promo,
       p.promo
  from pedidos p
  left join clientes c on c.id = cliente_por_telefono(p.telefono)
  left join canjes_recomendacion x on x.pedido_id = p.id
  left join recomendaciones r on r.pedido_id = p.id
  left join clientes d on d.id = r.recomendador_id;

-- Texto nuevo de la tarjeta del descuento, editable en /admin → Textos e imágenes.
insert into contenido_web (clave, seccion, orden, etiqueta, ayuda, tipo, valor, original)
select clave, 'Descuento por recomendación', orden, etiqueta, ayuda, tipo, valor, valor from (values
  ('recomendacion.promo_mayor', 13, 'Tarjeta del descuento: la promo descuenta más',
    'Cuando la promo de su Box descuenta más que su código (no se suman). {caja}: la Box (ej: Box de 6).', 'texto_largo',
    'Esta vez la promo de tu {caja} descuenta más: tu descuento te sigue esperando.')
) as t(clave, orden, etiqueta, ayuda, tipo, valor)
on conflict (clave) do nothing;
