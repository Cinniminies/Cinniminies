-- Cierre de pedidos (3/5): el sábado de entrega en los pedidos web y al confirmarlos.

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
