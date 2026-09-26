-- Fase 2 · 6.5: más textos de la web editables desde /admin → Web. Solo los de index.html que la web no
-- reescribe con JS (los avisos y errores del carrito quedan fijos en cinniminies.js).
-- Cada fila va con su atributo data-contenido en index.html y su sección en SECCIONES (admin/js/vistas/web.js).

-- Los botones del inicio van antes de la foto.
update contenido_web set orden = 6 where clave = 'hero.foto';

insert into contenido_web (clave, seccion, orden, etiqueta, ayuda, tipo, valor, original)
select clave, seccion, orden, etiqueta, ayuda, 'texto', valor, valor from (values
  ('nav.menu', 'Barra de arriba', 1, 'Link al menú', 'Se ve arriba en la compu y en el menú desplegable del celular.', 'Menú'),
  ('nav.local', 'Barra de arriba', 2, 'Link a "Dónde encontrarnos"', null, 'Local'),
  ('nav.contacto', 'Barra de arriba', 3, 'Link al contacto', null, 'Contactanos'),
  ('nav.pedido', 'Barra de arriba', 4, 'Botón de pedido', 'El botón destacado de la barra (en la compu).', 'Hacer pedido'),

  ('hero.boton_menu', 'Inicio', 4, 'Botón principal', 'Lleva al menú.', 'Ver el menú'),
  ('hero.boton_contacto', 'Inicio', 5, 'Botón secundario', 'Lleva al contacto.', 'Contactanos'),

  ('menu.animacion', 'Menú', 1, 'Texto de la animación', 'Debajo del roll que se "hornea" al bajar.', 'Scrolleá para hornear ↓'),
  ('menu.frase', 'Menú', 2, 'Frase de arriba', null, 'El menú'),
  ('menu.titulo', 'Menú', 3, 'Segunda línea del título',
    'La primera ("Tres rolls.", "Cuatro rolls."…) la arma la web según cuántos sabores hay.', 'Ninguno apurado.'),
  ('menu.paso_caja', 'Menú', 4, 'Título para elegir la caja', null, '1. Elegí el tamaño de tu caja'),

  ('carrito.titulo', 'Carrito y formulario', 1, 'Título del carrito', null, 'Tu pedido'),
  ('carrito.boton', 'Carrito y formulario', 2, 'Botón para seguir', 'Pasa del carrito a "Tus datos".', 'Pedir ahora'),
  ('form.titulo', 'Carrito y formulario', 3, 'Título del formulario', null, 'Tus datos'),
  ('form.ayuda_whatsapp', 'Carrito y formulario', 4, 'Ayuda debajo del WhatsApp', null, 'No hace falta el +598.'),

  ('pedido.titulo', 'Pedido recibido', 0, 'Título al terminar el pedido', null, '¡Listo, pedido recibido!')
) as t(clave, seccion, orden, etiqueta, ayuda, valor);
