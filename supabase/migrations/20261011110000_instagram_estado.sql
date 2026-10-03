-- ig_estado() era security definer (aviso del linter). En su lugar, /admin lee directo de ig_config
-- solo las columnas sin el token (permiso por columna) y solo si es admin.
drop function ig_estado();
grant select (id, usuario, renovado_en, ultima_lectura, ultimo_error) on ig_config to authenticated;
create policy "solo admins leen el estado" on ig_config for select to authenticated
  using ((select privado.es_admin()));
