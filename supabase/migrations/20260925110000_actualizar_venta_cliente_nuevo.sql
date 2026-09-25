-- Review de la Etapa 2: actualizar_venta
-- * Acepta `cliente: { nombre, contacto?, origen? }` para cambiar la venta a un cliente nuevo en la
--   misma transacción (antes el front creaba el cliente aparte y quedaba huérfano si fallaba).
-- * Al cambiar a otro cliente sin indicar `origen`, la venta toma el origen del cliente nuevo.
-- * Si se cambian los productos y la venta tenía precio especial, se conserva (antes se volvía
--   al precio de lista sin avisar). Para volver al de lista: `precio_especial: null`.

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
         cobro_envio = v.cobro_envio, precio_lista = v.precio_lista, precio_cobrado = v.precio_cobrado
   where id = p_id;

  return (select to_jsonb(x) from v_ventas x where x.id = p_id);
end;
$$;
