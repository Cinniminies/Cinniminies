-- Textos del pedido que se sumaron el 23/10 (testeo como cliente y envío en el total), editables en
-- /admin → Web → Textos e imágenes, sección "Carrito y formulario". Los que llevan variables entre llaves los arma
-- la web con textoWeb(); la ayuda de cada uno dice cuáles puede usar.
--
-- También se pone al día el texto "original" (el de "Volver al texto original") de los que se corrigieron ese día
-- (20261023140000 y 20261023160000): si no, volver al original traía los errores de tipeo.

insert into contenido_web (clave, seccion, orden, etiqueta, ayuda, tipo, valor, original)
select clave, 'Carrito y formulario', orden, etiqueta, ayuda, 'texto', valor, valor from (values
  ('carrito.completa_titulo', 10, 'Aviso de caja completa: título', 'Sale al completar una Box de 6 o de 12.',
    '¡Caja completa!'),
  ('carrito.completa_texto', 11, 'Aviso de caja completa: texto', '{rolls}: los rolls de la caja.',
    'Tu caja de {rolls} rolls quedó completa.'),
  ('carrito.minimo_titulo', 12, 'Aviso de caja personalizada: título',
    'Sale cuando la caja personalizada llega al mínimo de rolls.', '¡Ya podés pedir!'),
  ('carrito.minimo_texto', 13, 'Aviso de caja personalizada: texto',
    '{rolls}: los rolls que lleva. {maximo}: el máximo de la caja.',
    'Tu caja personalizada ya tiene {rolls} rolls: podés pedirla así o seguir sumando hasta {maximo}.'),
  ('form.error_whatsapp', 14, 'Error si el WhatsApp está mal', 'Sale en rojo debajo del WhatsApp al salir del campo.',
    'Tiene que ser un celular uruguayo de 9 dígitos que empiece con 09 (ej: 098029462).'),
  ('form.ayuda_envio', 15, 'Ayuda debajo de la dirección', 'Solo con entrega. {envio}: el precio del envío.',
    'El envío cuesta ${envio} y se suma al total.'),
  ('form.total', 16, 'Total (con retiro)', 'Arriba del botón Confirmar pedido. {total}: lo que suman las cajas.',
    'Total: ${total}'),
  ('form.total_envio', 17, 'Total (con entrega)',
    '{total}: cajas + envío. {cajas}: lo que suman las cajas. {envio}: el precio del envío.',
    'Total: ${total} (cajas ${cajas} + envío ${envio})')
) as t(clave, orden, etiqueta, ayuda, valor)
on conflict (clave) do nothing;

update contenido_web set original = 'Alrededor del mediodía'
 where clave = 'local.hora' and original = 'Alrededor del mediodia';
update contenido_web
   set original = 'Sí. Al hacer el pedido elegís retiro (cerca de Barrio Obrero, en Paysandú) o entrega en tu casa; el envío se suma al total del pedido.'
 where clave = 'faq.4.respuesta'
   and original = 'Sí. Al hacer el pedido elegís retiro (cerca de Barrio Obrero, en Paysandú) o entrega en tu casa; el envío se cobra aparte.';
update contenido_web
   set original = 'Ya nos llegó tu pedido. Te vamos a escribir por WhatsApp para confirmar el horario de retiro o entrega. Si querés adelantarte, tocá el botón de abajo.'
 where clave = 'pedido.listo'
   and original = 'Ya nos llegó tu pedido. Te vamos a escribir por WhatsApp para confirmar el horario de retiro. Si querés adelantarte, tocá el botón de abajo.';
