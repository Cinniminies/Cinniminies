-- Pedidos web pagados por transferencia: la web muestra los datos de la cuenta y deja subir el comprobante.
-- El archivo va a un bucket privado (solo los admins lo ven); lo sube /api/comprobante con la service_role,
-- así la web pública no necesita permisos sobre Storage.

alter table pedidos add column comprobante text;  -- ruta dentro del bucket "comprobantes"

-- Hasta 4 MB (lo que entra en una función de Vercel). Fotos o capturas de la app del banco, o el PDF.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes', 'comprobantes', false, 4194304,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']);
create policy "admins ven comprobantes" on storage.objects for select to authenticated
  using (bucket_id = 'comprobantes' and (select privado.es_admin()));

-- Lo llama /api/comprobante después de subir el archivo. Pide el código y el celular del pedido, y solo
-- acepta uno por pedido, mientras sigue nuevo y en las primeras 24 horas: así nadie adjunta archivos a
-- pedidos ajenos o viejos adivinando códigos.
create function adjuntar_comprobante(p_codigo text, p_telefono text, p_ruta text) returns text
language plpgsql set search_path = public
as $$
declare
  ped pedidos;
begin
  select * into ped from pedidos where codigo = upper(trim(p_codigo)) and telefono = p_telefono for update;
  if ped.id is null then raise exception 'No encontramos el pedido'; end if;
  if ped.medio_pago <> 'transferencia' then raise exception 'El pedido no es con transferencia'; end if;
  if ped.estado <> 'nuevo' or ped.creado_en < now() - interval '24 hours' then
    raise exception 'El pedido ya no acepta comprobantes: mandalo por WhatsApp';
  end if;
  if ped.comprobante is not null then raise exception 'El pedido ya tiene un comprobante'; end if;
  update pedidos set comprobante = p_ruta where id = ped.id;
  return ped.codigo;
end;
$$;
revoke all on function adjuntar_comprobante(text, text, text) from public, anon, authenticated;
grant execute on function adjuntar_comprobante(text, text, text) to service_role;

-- La vista de /admin → Pedidos web suma la columna (al final, para poder reemplazarla).
create or replace view v_pedidos with (security_invoker = true) as
select p.id, p.codigo, p.creado_en, p.estado, p.nombre, p.telefono, p.modalidad, p.direccion, p.medio_pago,
       p.notas, p.total, p.ip_hash, p.venta_id, p.motivo_rechazo, p.gestionado_en, p.gestionado_por,
       c.id as cliente_sugerido_id,
       c.nombre as cliente_sugerido,
       (select count(*) from ventas v where v.cliente_id = c.id) as compras_cliente,
       p.comprobante
  from pedidos p
  left join clientes c on c.id = cliente_por_telefono(p.telefono);

-- Los datos de la cuenta, editables en /admin → Web → Carrito y formulario.
insert into contenido_web (clave, seccion, orden, etiqueta, ayuda, tipo, valor, original)
values ('pago.transferencia', 'Carrito y formulario', 5, 'Datos para transferir',
        'Banco, número de cuenta y a nombre de quién. Se muestra después del pedido si eligen pagar por transferencia.',
        'texto_largo', 'Te pasamos los datos de la cuenta por WhatsApp.', 'Te pasamos los datos de la cuenta por WhatsApp.');
