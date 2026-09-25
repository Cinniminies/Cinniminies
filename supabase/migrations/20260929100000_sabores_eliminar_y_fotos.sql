-- TO-DO 1 y 2: eliminar sabores desde /admin y subirles una foto para la web.

-- Un sabor con ventas o tandas no se puede borrar sin romper el historial: se marca como
-- eliminado (no aparece en /admin, ni en la carga, ni en la web) y se puede restaurar.
alter table sabores add column eliminado boolean not null default false;
alter table sabores add constraint sabores_eliminado_inactivo
  check (not eliminado or (not activo and not visible_web));

-- Borra el sabor si nunca se usó (con su receta y sus precios); si se usó, lo marca como eliminado.
-- Devuelve 'borrado' o 'eliminado'.
create function eliminar_sabor(p_sabor uuid) returns text
language plpgsql set search_path = public
as $$
begin
  if not exists (select 1 from sabores where id = p_sabor) then
    raise exception 'Sabor inexistente';
  end if;
  if exists (select 1 from venta_linea_sabores where sabor_id = p_sabor)
     or exists (select 1 from tandas where sabor_id = p_sabor) then
    update sabores set eliminado = true, activo = false, visible_web = false where id = p_sabor;
    return 'eliminado';
  end if;
  delete from precios where sabor_id = p_sabor;
  delete from sabores where id = p_sabor; -- la receta se borra en cascada
  return 'borrado';
end;
$$;

revoke all on function eliminar_sabor(uuid) from public, anon;
grant execute on function eliminar_sabor(uuid) to authenticated;

-- El catálogo de la web ignora los eliminados (ya son inactivos; esto es por las dudas).
create or replace function catalogo_web() returns jsonb
language sql stable set search_path = public
as $$
  select jsonb_build_object(
    'sabores', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.slug,
               'nombre', s.nombre,
               'descripcion', s.descripcion,
               'etiqueta', s.etiqueta_web,
               'foto', s.foto,
               'precio_unidad', precio_vigente(null, s.id))
             order by s.orden, s.nombre)
        from sabores s
       where s.activo and s.visible_web and not s.eliminado
         and nullif(trim(s.slug), '') is not null), '[]'::jsonb),
    'formatos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nombre', f.nombre,
               'tipo', f.tipo,
               'rolls', f.rolls,
               'min_rolls', f.min_rolls,
               'max_rolls', f.max_rolls,
               'precio', precio_vigente(f.id, null))
             order by f.orden, f.nombre)
        from formatos f
       where f.activo and f.visible_web), '[]'::jsonb));
$$;

revoke all on function catalogo_web() from public, anon, authenticated;
grant execute on function catalogo_web() to service_role;

-- Fotos de los sabores: bucket público (la web las muestra con la URL pública), hasta 5 MB,
-- solo imágenes. Solo los admins suben, reemplazan o borran.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sabores', 'sabores', true, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "admins leen fotos de sabores" on storage.objects for select to authenticated
  using (bucket_id = 'sabores' and (select privado.es_admin()));
create policy "admins suben fotos de sabores" on storage.objects for insert to authenticated
  with check (bucket_id = 'sabores' and (select privado.es_admin()));
create policy "admins cambian fotos de sabores" on storage.objects for update to authenticated
  using (bucket_id = 'sabores' and (select privado.es_admin()))
  with check (bucket_id = 'sabores' and (select privado.es_admin()));
create policy "admins borran fotos de sabores" on storage.objects for delete to authenticated
  using (bucket_id = 'sabores' and (select privado.es_admin()));
