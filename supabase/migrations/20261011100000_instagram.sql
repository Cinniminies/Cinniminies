-- Redes (pedido de Lucio, 03/10): números de Instagram leídos por la API todos los días
-- (api/instagram.js, cron de Vercel). /admin → Redes los muestra con tendencias y sugerencias.

-- El token de la API. Solo el servidor (service_role) lo lee y lo escribe: ni /admin lo ve.
-- El primero sale de INSTAGRAM_TOKEN (Vercel); acá se guarda el renovado (vence a los 60 días).
create table ig_config (
  id int primary key default 1 check (id = 1),
  token text not null,
  renovado_en timestamptz not null default now(),
  usuario text,
  cuenta_id text,
  ultima_lectura timestamptz,
  ultimo_error text
);
alter table ig_config enable row level security;
revoke all on ig_config from anon, authenticated;

-- Una foto de la cuenta por día.
create table ig_cuenta_dia (
  fecha date primary key,
  seguidores int not null,
  seguidos int,
  publicaciones int,
  alcance int,       -- cuentas alcanzadas ese día (si la API lo da)
  vistas int,        -- vistas de todo el contenido ese día (si la API lo da)
  creado_en timestamptz not null default now()
);

-- Cada publicación con sus últimos números (se actualizan en cada lectura).
create table ig_publicaciones (
  id text primary key,                  -- id de Instagram
  publicada_en timestamptz not null,
  tipo text not null,                   -- IMAGE, VIDEO, CAROUSEL_ALBUM
  producto text,                        -- FEED, REELS, STORY
  texto text,
  enlace text,
  imagen text,                          -- miniatura (la URL de Instagram vence; se renueva al leer)
  vistas int,
  alcance int,
  me_gusta int,
  comentarios int,
  guardados int,
  compartidos int,
  actualizado_en timestamptz not null default now()
);
create index on ig_publicaciones (publicada_en);

do $$
declare t text;
begin
  foreach t in array array['ig_cuenta_dia', 'ig_publicaciones'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon', t);
    execute format('revoke insert, update, delete, truncate on %I from authenticated', t);
    execute format('create policy "solo admins leen" on %I for select to authenticated using ((select privado.es_admin()))', t);
  end loop;
end $$;

-- Estado de la conexión para /admin, sin el token.
create function ig_estado() returns jsonb
language sql security definer set search_path = public
as $$
  select case when not privado.es_admin() then null else
    coalesce((select jsonb_build_object('conectada', true, 'usuario', usuario, 'ultima_lectura', ultima_lectura,
                                        'ultimo_error', ultimo_error, 'token_renovado_en', renovado_en)
                from ig_config), jsonb_build_object('conectada', false)) end;
$$;
revoke all on function public.ig_estado() from public, anon;
grant execute on function public.ig_estado() to authenticated;
