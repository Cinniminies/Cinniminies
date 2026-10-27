-- "Borrar datos de prueba" (/admin → Recomendaciones) también borra las promos de prueba (20261027100000_promos.sql).
create or replace function borrar_datos_prueba() returns jsonb
language plpgsql set search_path = public
as $$
declare
  n_pedidos int;
  n_ventas int;
  n_clientes int;
  n_campanas int;
  n_promos int;
begin
  if not privado.es_prueba() then raise exception 'Solo el usuario de prueba puede borrar datos de prueba'; end if;
  delete from pedidos where es_prueba;           -- con sus cajas, recomendaciones y canjes
  get diagnostics n_pedidos = row_count;
  delete from ventas where es_prueba;            -- con sus líneas
  get diagnostics n_ventas = row_count;
  delete from clientes where es_prueba;          -- con sus códigos
  get diagnostics n_clientes = row_count;
  delete from campanas_recomendacion where es_prueba;
  get diagnostics n_campanas = row_count;
  delete from promos where es_prueba;
  get diagnostics n_promos = row_count;
  return jsonb_build_object('pedidos', n_pedidos, 'ventas', n_ventas, 'clientes', n_clientes, 'campanas', n_campanas,
                            'promos', n_promos);
end;
$$;
