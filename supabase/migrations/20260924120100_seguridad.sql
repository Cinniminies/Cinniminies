-- Seguridad: solo los usuarios de `usuarios_admin` (los 2 dueños) leen y escriben.
-- Sin login no se ve nada. Los usuarios se crean desde el dashboard de Supabase
-- (Authentication → Users → Add user) y después se agregan a esta tabla.

create schema if not exists privado;
revoke all on schema privado from public, anon;
grant usage on schema privado to authenticated;

create table usuarios_admin (
  user_id uuid primary key references auth.users on delete cascade,
  nombre text not null,
  creado_en timestamptz not null default now()
);

create function privado.es_admin() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.usuarios_admin where user_id = (select auth.uid()));
$$;
revoke all on function privado.es_admin() from public, anon;
grant execute on function privado.es_admin() to authenticated;

-- RLS en todas las tablas, con la misma política para todas.
do $$
declare
  t text;
begin
  foreach t in array array[
    'sabores', 'insumos', 'recetas', 'formatos', 'caja_insumos', 'precios', 'parametros',
    'clientes', 'ventas', 'venta_lineas', 'venta_linea_sabores', 'compras', 'tandas',
    'tanda_consumos', 'gastos', 'conteos'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format(
      'create policy "solo admins" on public.%I for all to authenticated
         using ((select privado.es_admin())) with check ((select privado.es_admin()))', t);
  end loop;
end $$;

-- usuarios_admin: cada uno ve su propia fila; nadie la modifica desde la API.
alter table usuarios_admin enable row level security;
revoke all on usuarios_admin from anon;
revoke insert, update, delete on usuarios_admin from authenticated;
create policy "ver la propia fila" on usuarios_admin for select to authenticated
  using (user_id = (select auth.uid()));
