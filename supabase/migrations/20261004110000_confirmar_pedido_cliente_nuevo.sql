-- Fase 2 · 2.2: confirmar un pedido web con un cliente nuevo elegido a mano ("Es otro cliente" → "+ Cliente nuevo").

-- p (opcional): { estado_pago?: 'pagado'|'pendiente' (default pendiente), fecha?,
--                 cliente_id?: el cliente elegido a mano (manda sobre la búsqueda por celular),
--                 guardar_telefono?: true → le suma el celular del pedido al contacto de ese cliente,
--                 cliente?: { nombre, contacto?, origen? } → crea un cliente nuevo aunque el celular coincida
--                           con otro (por ejemplo, un celular compartido); contacto y origen por defecto
--                           son el celular del pedido y "Web" }
create or replace function confirmar_pedido(p_pedido uuid, p jsonb default '{}') returns jsonb
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

  if nullif(p->>'cliente_id', '') is not null then
    select id into v_cliente from clientes where id = (p->>'cliente_id')::uuid;
    if not found then raise exception 'El cliente elegido ya no existe'; end if;
    if (p->>'guardar_telefono')::boolean and cliente_por_telefono(ped.telefono) is distinct from v_cliente then
      update clientes set contacto = concat_ws(' · ', nullif(trim(contacto), ''), ped.telefono) where id = v_cliente;
    end if;
  elsif nullif(trim(p->'cliente'->>'nombre'), '') is null then
    v_cliente := cliente_por_telefono(ped.telefono);
  end if;

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
