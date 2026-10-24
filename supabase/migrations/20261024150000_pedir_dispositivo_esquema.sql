-- pedir_dispositivo corre con search_path vacío: estado_dispositivo() va con el esquema (si no, "Pedir
-- autorización" fallaba con "function estado_dispositivo() does not exist"). Aplicada el 24/10.

create or replace function pedir_dispositivo(p_nombre text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_hash text := privado.dispositivo_actual();
  v_libre boolean;
begin
  if not exists (select 1 from public.usuarios_admin where user_id = (select auth.uid())) then
    raise exception 'Tu usuario no tiene acceso a la app.';
  end if;
  if v_hash is null then
    raise exception 'Este navegador no guarda datos: no se puede autorizar (¿modo incógnito?)';
  end if;
  if coalesce(trim(p_nombre), '') = '' then
    raise exception 'Poné un nombre para reconocer el dispositivo';
  end if;
  v_libre := public.hoy() <= coalesce((select valor::date from public.parametros where clave = 'dispositivos_alta_libre_hasta'), '-infinity')
         and not exists (select 1 from public.dispositivos where user_id = (select auth.uid()) and autorizado);

  insert into public.dispositivos (user_id, token_hash, nombre, autorizado, autorizado_en, ultimo_uso)
  values ((select auth.uid()), v_hash, left(trim(p_nombre), 60), v_libre, case when v_libre then now() end, now())
  on conflict (user_id, token_hash) do update set nombre = excluded.nombre;

  return public.estado_dispositivo();
end;
$$;
