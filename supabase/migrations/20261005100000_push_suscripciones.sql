-- Fase 2 · 2.1: avisos push de pedidos nuevos. Cada celular o compu donde un admin activa los avisos
-- (/admin → Más → Avisos de pedidos nuevos) guarda acá su suscripción de Web Push. /api/pedidos las lee
-- con la service key y manda el aviso; si el servicio de push responde 404/410, la borra.

create table push_suscripciones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text not null check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  creado_en timestamptz not null default now(),
  ultimo_error text,
  -- Por usuario: si Pia y Lucio activan los avisos en el mismo navegador quedan dos filas con el
  -- mismo endpoint, y /api/pedidos manda uno solo por endpoint.
  unique (user_id, endpoint)
);

-- Cada admin maneja solo las suyas (/admin hace upsert por user_id + endpoint y borra al desactivar).
alter table push_suscripciones enable row level security;
revoke all on push_suscripciones from anon;
create policy "las propias" on push_suscripciones for all to authenticated
  using (user_id = (select auth.uid()) and (select privado.es_admin()))
  with check (user_id = (select auth.uid()) and (select privado.es_admin()));
