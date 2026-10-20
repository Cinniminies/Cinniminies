-- generar_codigos corre con los permisos de quien la llama (aviso del linter de Supabase): la RLS ya deja ver
-- solo las ventas de su marca de prueba. privado.crear_codigo sigue siendo definer, pero el esquema privado no
-- se publica en la API, así que darle permiso a authenticated no la expone.
create or replace function generar_codigos() returns int
language plpgsql security invoker set search_path = public
as $$
declare
  c record;
  n int := 0;
begin
  if not privado.es_admin() then raise exception 'Solo admins'; end if;
  for c in select distinct v.cliente_id from ventas v
            where v.cliente_id is not null and v.estado_pago = 'pagado'
              and not exists (select 1 from codigos_recomendacion x where x.cliente_id = v.cliente_id) loop
    perform privado.crear_codigo(c.cliente_id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
grant execute on function privado.crear_codigo(uuid) to authenticated;
