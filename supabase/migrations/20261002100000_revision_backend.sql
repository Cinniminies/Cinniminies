-- Revisión del backend (25/09).

-- 1) Si se borra la venta de un pedido web (por ejemplo con "Borrar venta" o "Deshacer"), el pedido
--    vuelve a "nuevo" para poder confirmarlo de nuevo; antes quedaba "confirmado" y sin venta.
create function privado.pedido_vuelve_a_nuevo() returns trigger
language plpgsql set search_path = public
as $$
begin
  update pedidos
     set estado = 'nuevo', venta_id = null, gestionado_en = null, gestionado_por = null
   where venta_id = old.id;
  return old;
end;
$$;
revoke all on function privado.pedido_vuelve_a_nuevo() from public, anon, authenticated;
create trigger pedido_vuelve_a_nuevo before delete on ventas
  for each row execute function privado.pedido_vuelve_a_nuevo();

-- 2) Índices de las claves foráneas que marcó el asesor de rendimiento.
create index on pedido_cajas (formato_id);
create index on pedidos (venta_id);

-- 3) Tope general de pedidos web (además del límite por IP): 40 pedidos nuevos por hora.
--    Frena un bot que cambia de IP sin afectar un día normal de ventas.
create or replace function privado.tope_pedidos_web() returns trigger
language plpgsql set search_path = public
as $$
begin
  if (select count(*) from pedidos where creado_en > now() - interval '1 hour') >= 40 then
    raise exception 'Demasiados pedidos en este momento. Escribinos por WhatsApp y lo coordinamos';  -- la API responde 429
  end if;
  return new;
end;
$$;
revoke all on function privado.tope_pedidos_web() from public, anon, authenticated;
create trigger tope_pedidos_web before insert on pedidos
  for each row execute function privado.tope_pedidos_web();

-- 4) contenido_web: desde /admin solo se edita el valor (el tipo, la etiqueta y el original
--    quedan fijos; así no se pueden saltear los checks cambiando el tipo).
revoke update on contenido_web from authenticated;
grant update (valor) on contenido_web to authenticated;
