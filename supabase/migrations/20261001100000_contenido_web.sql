-- Etapa 7: textos e imágenes de la web pública editables desde /admin.
-- Cada fila es un lugar de index.html (atributo data-contenido="clave"). `original` guarda el valor
-- de fábrica para poder volver atrás. La web lo recibe dentro de /api/catalogo.

create table contenido_web (
  clave text primary key,
  seccion text not null,
  orden int not null default 0,
  etiqueta text not null,
  ayuda text,
  tipo text not null check (tipo in ('texto', 'texto_largo', 'imagen', 'whatsapp', 'instagram', 'direccion')),
  valor text not null,
  original text not null,
  actualizado_en timestamptz not null default now(),
  check (length(valor) <= 1000),
  check (tipo <> 'imagen' or valor ~ '^(/?img/[A-Za-z0-9._/-]+|https://[^\s"''<>]+)$'),
  check (tipo <> 'whatsapp' or valor ~ '^598[0-9]{8}$'),
  check (tipo <> 'instagram' or valor ~ '^[A-Za-z0-9._]{1,30}$'),
  check (tipo not in ('texto', 'imagen', 'whatsapp', 'instagram') or valor <> '')
);

alter table contenido_web enable row level security;
revoke all on contenido_web from anon;
revoke insert, delete, truncate on contenido_web from authenticated;
create policy "solo admins" on contenido_web for all to authenticated
  using ((select privado.es_admin())) with check ((select privado.es_admin()));

create function privado.contenido_actualizado() returns trigger
language plpgsql set search_path = public
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;
revoke all on function privado.contenido_actualizado() from public, anon, authenticated;
create trigger contenido_actualizado before update on contenido_web
  for each row execute function privado.contenido_actualizado();

insert into contenido_web (clave, seccion, orden, etiqueta, ayuda, tipo, valor, original)
select clave, seccion, orden, etiqueta, ayuda, tipo, valor, valor from (values
  ('hero.frase', 'Inicio', 1, 'Frase de arriba', null, 'texto', 'Horneado en Paysandú con exceso de amor.'),
  ('hero.titulo', 'Inicio', 2, 'Título', 'Cada renglón es un salto de línea. Entre *asteriscos* va en cursiva.', 'texto_largo',
    E'El roll\nque se *desenrolla*\nen capas de canela.'),
  ('hero.texto', 'Inicio', 3, 'Texto', null, 'texto_largo', 'Cinniminies es un horno chico en Paysandú donde cada caja se arma a mano.'),
  ('hero.foto', 'Inicio', 4, 'Foto de fondo', 'Horizontal, se ve detrás del título.', 'imagen', 'img/hero-bg.webp'),

  ('local.frase', 'Dónde encontrarnos', 1, 'Frase de arriba', null, 'texto', 'Dónde encontrarnos'),
  ('local.titulo', 'Dónde encontrarnos', 2, 'Título', 'Cada renglón es un salto de línea.', 'texto_largo', E'Retiro en Paysandú,\ncon aviso previo.'),
  ('local.texto', 'Dónde encontrarnos', 3, 'Texto', null, 'texto_largo',
    'No tenemos local, funcionamos por pedido. Escribinos por WhatsApp o por DM en Instagram y coordinamos juntos el horario de retiro para el día sábado.'),
  ('local.zona', 'Dónde encontrarnos', 4, 'Zona', null, 'texto', 'Cerca de Barrio Obrero, Paysandú'),
  ('local.cuando', 'Dónde encontrarnos', 5, '¿Cuándo estamos?', null, 'texto', 'Los días sábado'),
  ('local.hora', 'Dónde encontrarnos', 6, '¿A qué hora?', null, 'texto', 'Alrededor del mediodia'),
  ('local.mapa', 'Dónde encontrarnos', 7, 'Dirección del mapa',
    'Vacío = el mapa de siempre. Si ponés una dirección (calle, número, ciudad), el mapa la muestra.', 'direccion', ''),

  ('contacto.frase', 'Contacto', 1, 'Frase de arriba', null, 'texto', '¿Pedimos?'),
  ('contacto.titulo', 'Contacto', 2, 'Título', 'Cada renglón es un salto de línea.', 'texto_largo', E'Escribinos y coordinamos\ntu caja para este finde.'),
  ('contacto.whatsapp', 'Contacto', 3, 'Número de WhatsApp',
    'Con 598 adelante y sin el 0: 59895226739. Es el número al que llegan los pedidos.', 'whatsapp', '59895226739'),
  ('contacto.whatsapp_nota', 'Contacto', 4, 'Nota debajo de WhatsApp', null, 'texto', 'Respuesta en el día'),
  ('contacto.instagram', 'Contacto', 5, 'Usuario de Instagram', 'Sin la @.', 'instagram', 'cinniminies.pay'),
  ('contacto.pie', 'Contacto', 6, 'Texto del pie', null, 'texto', '© 2026 · Hecho a mano en Paysandú'),

  ('pedido.listo', 'Pedido recibido', 1, 'Texto al terminar el pedido', null, 'texto_largo',
    'Ya nos llegó tu pedido. Te vamos a escribir por WhatsApp para confirmar el horario de retiro. Si querés adelantarte, tocá el botón de abajo.')
) as t(clave, seccion, orden, etiqueta, ayuda, tipo, valor);

-- El catálogo de la web suma el contenido editable (una sola llamada, con la misma cache).
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
       where f.activo and f.visible_web), '[]'::jsonb),
    'contenido', coalesce((select jsonb_object_agg(c.clave, c.valor) from contenido_web c), '{}'::jsonb));
$$;

revoke all on function catalogo_web() from public, anon, authenticated;
grant execute on function catalogo_web() to service_role;

-- Imágenes de la web (foto del inicio, etc.): bucket público "web", igual que el de sabores.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('web', 'web', true, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "admins leen imágenes de la web" on storage.objects for select to authenticated
  using (bucket_id = 'web' and (select privado.es_admin()));
create policy "admins suben imágenes de la web" on storage.objects for insert to authenticated
  with check (bucket_id = 'web' and (select privado.es_admin()));
create policy "admins cambian imágenes de la web" on storage.objects for update to authenticated
  using (bucket_id = 'web' and (select privado.es_admin()))
  with check (bucket_id = 'web' and (select privado.es_admin()));
create policy "admins borran imágenes de la web" on storage.objects for delete to authenticated
  using (bucket_id = 'web' and (select privado.es_admin()));
