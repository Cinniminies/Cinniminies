-- La protección de la unidad también cubre las cajas ya usadas en ventas.
create or replace function privado.proteger_unidad_insumo() returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.unidad_base is distinct from old.unidad_base and (
       exists (select 1 from compras where insumo_id = old.id)
    or exists (select 1 from recetas where insumo_id = old.id)
    or exists (select 1 from tanda_consumos where insumo_id = old.id)
    or exists (select 1 from conteos where insumo_id = old.id)
    or exists (select 1 from caja_insumos where insumo_id = old.id or caja_insumo_id = old.id)
    or exists (select 1 from venta_lineas where caja_insumo_id = old.id)) then
    raise exception 'No se puede cambiar la unidad de "%": ya tiene compras, recetas, ventas o conteos. Creá un insumo nuevo.', old.nombre;
  end if;
  return new;
end;
$$;
