-- Recetas propuestas (pedido de Lucio, 03/10): en Stock → Desvíos se calcula cuánto se usa en promedio
-- por tanda de cada ingrediente (receta × (1 + desvío)) y se proponen cantidades redondeadas.
-- Esta función guarda esas cantidades tal cual (no un factor parejo, porque el redondeo cambia por sabor)
-- y, para cada ingrediente ajustado, reinicia el promedio de desvíos (receta_ajustada_en).
-- p: { items: [{ sabor_id, insumo_id, cantidad }] }. Devuelve cuántas filas de receta cambió.
create function aplicar_recetas_propuestas(p jsonb) returns int
language plpgsql set search_path = public
as $$
declare
  n int;
begin
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'No hay cambios para aplicar';
  end if;
  if exists (select 1 from jsonb_to_recordset(p->'items') as y(sabor_id uuid, insumo_id uuid, cantidad numeric)
               left join recetas r on r.sabor_id = y.sabor_id and r.insumo_id = y.insumo_id
               left join insumos i on i.id = y.insumo_id
              where r.sabor_id is null or i.tipo <> 'ingrediente') then
    raise exception 'Solo se pueden cambiar ingredientes que ya están en la receta';
  end if;
  if exists (select 1 from jsonb_to_recordset(p->'items') as y(cantidad numeric) where y.cantidad is null or y.cantidad <= 0) then
    raise exception 'Las cantidades tienen que ser mayores a 0';
  end if;

  update recetas r set cantidad = y.cantidad
    from jsonb_to_recordset(p->'items') as y(sabor_id uuid, insumo_id uuid, cantidad numeric)
   where r.sabor_id = y.sabor_id and r.insumo_id = y.insumo_id;
  get diagnostics n = row_count;

  update insumos set receta_ajustada_en = now()
   where id in (select (x->>'insumo_id')::uuid from jsonb_array_elements(p->'items') x);
  return n;
end;
$$;
revoke all on function public.aplicar_recetas_propuestas(jsonb) from public, anon;
grant execute on function public.aplicar_recetas_propuestas(jsonb) to authenticated;
