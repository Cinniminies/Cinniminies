-- Propina en las ventas (pedido del 24/10/2026).
-- Monto aparte del precio: no cambia el precio de lista ni el cobrado (ni el descuento), pero cuenta como
-- ingreso: entra en el total de la venta, en lo vendido/cobrado, en la ganancia y en la caja.
-- Se carga al hacer la venta (registrar_venta) y al editarla (actualizar_venta).

alter table ventas add column propina numeric(12, 2) not null default 0 check (propina >= 0);

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
         sum(s.unidades * s.costo_unitario) as costo_produccion,
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
       round(v.precio_cobrado + v.cobro_envio + v.propina - coalesce(sab.costo_produccion, 0) - coalesce(l.costo_caja, 0), 2) as ganancia,
       v.notas,
       v.creado_en,
       v.por_hacer,
       v.propina
  from ventas v
  left join clientes c on c.id = v.cliente_id
  left join lineas l on l.venta_id = v.id
  left join sab on sab.venta_id = v.id
 where v.es_prueba = (select privado.es_prueba());


create or replace function propina_valida(p jsonb) returns numeric
language plpgsql immutable set search_path = public
as $$
declare
  v numeric := coalesce(nullif(trim(p->>'propina'), '')::numeric, 0);
begin
  if v < 0 then raise exception 'La propina no puede ser negativa'; end if;
  return round(v, 2);
end;
$$;
revoke all on function propina_valida(jsonb) from public, anon;
grant execute on function propina_valida(jsonb) to authenticated;

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
                      tipo, precio_lista, precio_cobrado, notas, por_hacer, creado_por, propina)
  values ((v->>'fecha')::date, v_cliente, v_origen, v->>'entrega', (v->>'cobro_envio')::numeric,
          nullif(lower(p->>'medio_pago'), ''), coalesce(nullif(lower(p->>'estado_pago'), ''), 'pagado'),
          coalesce(nullif(p->>'tipo', ''), 'venta'), (v->>'precio_lista')::numeric,
          (v->>'precio_cobrado')::numeric, nullif(trim(p->>'notas'), ''),
          coalesce(nullif(p->>'por_hacer', '')::boolean, false), auth.uid(), propina_valida(p))
  returning id into v_venta;

  perform guardar_lineas(v_venta, v->'lineas');

  return v || jsonb_build_object('venta_id', v_venta, 'cliente_id', v_cliente, 'propina', propina_valida(p));
end;
$$;

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
         por_hacer = v.por_hacer, propina = v.propina
   where id = p_id;

  return (select to_jsonb(x) from v_ventas x where x.id = p_id);
end;
$$;
