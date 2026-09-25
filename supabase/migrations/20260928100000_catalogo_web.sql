-- Etapa 5: la web pública lee el catálogo (/api/catalogo).

-- Foto de cada sabor: ruta dentro del sitio (img/…) o una URL completa.
alter table sabores add column foto text;
update sabores set foto = 'img/roll-canela.webp' where slug = 'canela' and foto is null;
update sabores set foto = 'img/roll-dulce.webp' where slug = 'dulce' and foto is null;
update sabores set foto = 'img/roll-oreo.webp' where slug = 'oreo' and foto is null;

-- Lo que muestra la web: sabores activos y visibles con identificador web, y formatos activos y
-- visibles, cada uno con su precio vigente hoy. Solo datos públicos (nada de costos ni recetas).
-- La llama /api/catalogo con la service key; ni anon ni los usuarios logueados la necesitan.
create function catalogo_web() returns jsonb
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
       where s.activo and s.visible_web and nullif(trim(s.slug), '') is not null), '[]'::jsonb),
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
