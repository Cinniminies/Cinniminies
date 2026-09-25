-- Etapa 2: funciones que usa /admin para editar ventas, registrar compras y fusionar clientes.
-- Como las demás, son `security invoker`: la RLS decide (solo admins).

-- Guarda las líneas calculadas por calcular_venta (con sus snapshots) en una venta.
create function guardar_lineas(p_venta uuid, p_lineas jsonb) returns void
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

    insert into venta_linea_sabores (linea_id, sabor_id, unidades, costo_unitario)
    select v_linea, x.sabor_id, x.unidades, x.costo_unitario
      from jsonb_to_recordset(l->'sabores') as x(sabor_id uuid, unidades int, costo_unitario numeric);
  end loop;
end;
$$;

-- Misma regla que antes, ahora usando guardar_lineas.
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
                      tipo, precio_lista, precio_cobrado, notas, creado_por)
  values ((v->>'fecha')::date, v_cliente, v_origen, v->>'entrega', (v->>'cobro_envio')::numeric,
          nullif(lower(p->>'medio_pago'), ''), coalesce(nullif(lower(p->>'estado_pago'), ''), 'pagado'),
          coalesce(nullif(p->>'tipo', ''), 'venta'), (v->>'precio_lista')::numeric,
          (v->>'precio_cobrado')::numeric, nullif(trim(p->>'notas'), ''), auth.uid())
  returning id into v_venta;

  perform guardar_lineas(v_venta, v->'lineas');

  return v || jsonb_build_object('venta_id', v_venta, 'cliente_id', v_cliente);
end;
$$;

-- Edita una venta. Solo cambia lo que viene en el payload:
--   fecha, cliente_id, origen, medio_pago, estado_pago, tipo, notas, entrega, cobro_envio,
--   precio_especial (null = volver al precio de lista),
--   lineas: reemplaza los productos y RECALCULA precio y costo con los valores de la fecha de
--           la venta. Si no vienen, los snapshots no se tocan (regla 5.5).
create function actualizar_venta(p_id uuid, p jsonb) returns jsonb
language plpgsql set search_path = public
as $$
declare
  v ventas%rowtype;
  c jsonb;
begin
  select * into v from ventas where id = p_id for update;
  if not found then
    raise exception 'La venta no existe';
  end if;

  if p ? 'fecha' then v.fecha := (p->>'fecha')::date; end if;
  if p ? 'cliente_id' then v.cliente_id := nullif(p->>'cliente_id', '')::uuid; end if;
  if p ? 'origen' then v.origen := nullif(trim(p->>'origen'), ''); end if;
  if p ? 'medio_pago' then v.medio_pago := nullif(lower(p->>'medio_pago'), ''); end if;
  if p ? 'estado_pago' then v.estado_pago := lower(p->>'estado_pago'); end if;
  if p ? 'tipo' then v.tipo := p->>'tipo'; end if;
  if p ? 'notas' then v.notas := nullif(trim(p->>'notas'), ''); end if;

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
    v.precio_cobrado := v.precio_lista;
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
         cobro_envio = v.cobro_envio, precio_lista = v.precio_lista, precio_cobrado = v.precio_cobrado
   where id = p_id;

  return (select to_jsonb(x) from v_ventas x where x.id = p_id);
end;
$$;

-- Registra una compra. Con insumo, calcula la cantidad en la unidad base del insumo:
-- g/kg, ml/L, un, paq. Sin insumo, es equipamiento u otro (no entra en costos ni stock).
-- payload: { fecha?, proveedor?, descripcion?, insumo_id?, categoria? (sin insumo),
--            cantidad?, unidad?, total, notas? }
create function registrar_compra(p jsonb) returns jsonb
language plpgsql set search_path = public
as $$
declare
  i insumos%rowtype;
  v_cant numeric := nullif(p->>'cantidad', '')::numeric;
  v_unidad text := nullif(trim(p->>'unidad'), '');
  v_total numeric := nullif(p->>'total', '')::numeric;
  v_dim text;
  v_factor numeric;
  v_base numeric;
  v_categoria text;
  v_id uuid;
begin
  if v_total is null or v_total <= 0 then
    raise exception 'Falta el total de la compra';
  end if;

  if nullif(p->>'insumo_id', '') is not null then
    select * into i from insumos where id = (p->>'insumo_id')::uuid;
    if not found then
      raise exception 'Insumo inexistente';
    end if;
    if v_cant is null or v_cant <= 0 then
      raise exception 'Falta la cantidad comprada de %', i.nombre;
    end if;
    select dim, factor into v_dim, v_factor
      from (values ('g', 'g', 1), ('kg', 'g', 1000), ('ml', 'ml', 1), ('l', 'ml', 1000),
                   ('un', 'un', 1), ('paq', 'paq', 1)) as u(unidad, dim, factor)
     where u.unidad = lower(coalesce(v_unidad, i.unidad_base));
    if v_dim is null then
      raise exception 'Unidad desconocida: %', v_unidad;
    end if;
    if v_dim <> i.unidad_base then
      raise exception '% se mide en %', i.nombre, i.unidad_base;
    end if;
    v_base := v_cant * v_factor;
    v_categoria := i.tipo;
  else
    v_categoria := coalesce(nullif(p->>'categoria', ''), 'otro');
    if v_categoria not in ('equipamiento', 'otro') then
      raise exception 'Elegí el insumo de la compra';
    end if;
  end if;

  insert into compras (fecha, proveedor, descripcion, insumo_id, categoria, cantidad, unidad,
                       cantidad_base, total, notas)
  values (coalesce(nullif(p->>'fecha', '')::date, hoy()), nullif(trim(p->>'proveedor'), ''),
          coalesce(nullif(trim(p->>'descripcion'), ''), i.nombre), i.id, v_categoria, v_cant,
          coalesce(v_unidad, i.unidad_base), v_base, v_total, nullif(trim(p->>'notas'), ''))
  returning id into v_id;

  return jsonb_build_object('compra_id', v_id, 'cantidad_base', v_base,
                            'costo_unitario', case when v_base > 0 then v_total / v_base end);
end;
$$;

-- Fusiona dos clientes duplicados: las ventas de `p_borrar` pasan a `p_quedar`, que se queda
-- con el contacto, origen y notas del otro si no tenía. `p_borrar` se elimina.
create function fusionar_clientes(p_quedar uuid, p_borrar uuid) returns void
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
  update clientes
     set contacto = coalesce(contacto, b.contacto),
         origen = coalesce(origen, b.origen),
         notas = nullif(concat_ws('; ', notas, b.notas), '')
   where id = p_quedar;
  delete from clientes where id = p_borrar;
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'guardar_lineas(uuid, jsonb)', 'actualizar_venta(uuid, jsonb)', 'registrar_compra(jsonb)',
    'fusionar_clientes(uuid, uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
