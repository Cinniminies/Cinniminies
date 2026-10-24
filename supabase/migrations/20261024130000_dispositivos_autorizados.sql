-- /admin solo desde dispositivos autorizados (pedido del 24/10/2026: "seguridad por MAC").
--
-- La web no puede leer la MAC, así que cada dispositivo (navegador o app instalada) genera una clave al azar,
-- la guarda en su almacenamiento y la manda en cada pedido a Supabase en el encabezado `x-dispositivo`.
-- La base guarda solo el hash (sha256). privado.es_admin(), que usan todas las políticas RLS y las del
-- Storage, ahora pide además que ese dispositivo esté autorizado para ese usuario: con la contraseña sola,
-- desde otro dispositivo, no se lee ni se escribe nada.
--
-- Alta de un dispositivo: desde la pantalla de bloqueo, pedir_dispositivo('iPhone de Pia') lo deja
-- pendiente con un código de 4 letras; alguien desde un dispositivo ya autorizado lo autoriza en
-- /admin → Más → Dispositivos (comparando el código). Para arrancar, mientras no venza
-- `dispositivos_alta_libre_hasta` (parametros), el primer dispositivo de cada usuario se autoriza solo.
-- Las funciones de servidor (api/) usan la service_role y no pasan por acá.

create table dispositivos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  token_hash text not null,
  nombre text not null,
  autorizado boolean not null default false,
  autorizado_por uuid references auth.users on delete set null,
  autorizado_en timestamptz,
  ultimo_uso timestamptz,
  creado_en timestamptz not null default now(),
  unique (user_id, token_hash)
);
alter table dispositivos enable row level security;
revoke all on dispositivos from anon;

insert into parametros (clave, valor) values ('dispositivos_alta_libre_hasta', '2026-11-07')
on conflict (clave) do nothing;

-- Hash de la clave que mandó este dispositivo (null si no mandó ninguna).
create function privado.dispositivo_actual() returns text
language sql stable
set search_path = ''
as $$
  select encode(sha256(convert_to(t, 'UTF8')), 'hex')
    from (select nullif(nullif(current_setting('request.headers', true), '')::json->>'x-dispositivo', '') as t) x
   where t is not null and length(t) >= 32;
$$;
revoke all on function privado.dispositivo_actual() from public, anon;
grant execute on function privado.dispositivo_actual() to authenticated;

create or replace function privado.es_admin() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.usuarios_admin where user_id = (select auth.uid()))
     and exists (select 1 from public.dispositivos d
                  where d.user_id = (select auth.uid()) and d.autorizado
                    and d.token_hash = (select privado.dispositivo_actual()));
$$;

-- Ver y quitar: solo desde un dispositivo autorizado. El alta, con pedir_dispositivo; autorizar, con
-- autorizar_dispositivo (así queda registrado quién lo hizo).
revoke all on dispositivos from authenticated;
grant select, delete on dispositivos to authenticated;
create policy "solo admins" on dispositivos for select to authenticated using ((select privado.es_admin()));
create policy "solo admins quitan" on dispositivos for delete to authenticated using ((select privado.es_admin()));

-- Para la lista de dispositivos: los admins ven el nombre de los otros admins.
create policy "admins ven a los admins" on usuarios_admin for select to authenticated using ((select privado.es_admin()));

-- Estado de este dispositivo para el usuario: { estado: 'autorizado' | 'pendiente' | 'nuevo', nombre, codigo }.
create function estado_dispositivo() returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_hash text := privado.dispositivo_actual();
  d public.dispositivos%rowtype;
begin
  if not exists (select 1 from public.usuarios_admin where user_id = (select auth.uid())) then
    raise exception 'Tu usuario no tiene acceso a la app.';
  end if;
  if v_hash is null then
    return jsonb_build_object('estado', 'nuevo');
  end if;
  update public.dispositivos set ultimo_uso = now()
   where user_id = (select auth.uid()) and token_hash = v_hash
  returning * into d;
  if not found then
    return jsonb_build_object('estado', 'nuevo', 'codigo', upper(left(v_hash, 4)));
  end if;
  return jsonb_build_object('estado', case when d.autorizado then 'autorizado' else 'pendiente' end,
                            'nombre', d.nombre, 'codigo', upper(left(v_hash, 4)));
end;
$$;

-- Pide autorización para este dispositivo. Mientras dure el alta libre, el primero de cada usuario entra solo.
create function pedir_dispositivo(p_nombre text) returns jsonb
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

  return estado_dispositivo();
end;
$$;

create function autorizar_dispositivo(p_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not privado.es_admin() then
    raise exception 'Solo se autoriza desde un dispositivo ya autorizado';
  end if;
  update public.dispositivos set autorizado = true, autorizado_por = (select auth.uid()), autorizado_en = now()
   where id = p_id;
  if not found then raise exception 'Ese dispositivo ya no está'; end if;
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array['estado_dispositivo()', 'pedir_dispositivo(text)', 'autorizar_dispositivo(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- Lista para /admin → Más → Dispositivos, con el nombre de quién es.
create view v_dispositivos with (security_invoker = true) as
select d.id, d.user_id, u.nombre as usuario, d.nombre, d.autorizado, d.autorizado_en, d.ultimo_uso, d.creado_en,
       upper(left(d.token_hash, 4)) as codigo,
       d.token_hash = (select privado.dispositivo_actual()) as este
  from dispositivos d
  left join usuarios_admin u on u.user_id = d.user_id;
revoke all on v_dispositivos from anon;
