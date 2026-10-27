-- Cinta de la decoración de Halloween (temporada/halloween.js): editable desde /admin → Web.
-- Solo se ve mientras la web está decorada (hasta el domingo 1/11/2026).
insert into contenido_web (clave, seccion, orden, etiqueta, ayuda, tipo, valor, original)
values ('halloween.cinta', 'Inicio', 0, 'Cinta de Halloween',
  'Arriba de todo en la portada. Solo se ve mientras la web está decorada de Halloween (hasta el domingo 1/11).',
  'texto', 'Edición Halloween: este finde los rolls vienen de terror', 'Edición Halloween: este finde los rolls vienen de terror')
on conflict (clave) do nothing;
