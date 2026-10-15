-- Preguntas frecuentes de la web, editables desde /admin → Web. Diez lugares fijos (pregunta + respuesta):
-- los siete primeros con el texto que se escribió para los buscadores y tres vacíos para sumar más.
-- Si la pregunta o la respuesta están vacías, la web no muestra ese lugar.

insert into contenido_web (clave, seccion, orden, etiqueta, ayuda, tipo, valor, original)
select clave, 'Preguntas frecuentes', orden, etiqueta, ayuda, tipo, valor, valor from (values
  ('faq.frase', 1, 'Frase de arriba', null, 'texto', 'Preguntas frecuentes'),
  ('faq.titulo', 2, 'Título', 'Cada renglón es un salto de línea.', 'texto_largo', E'Cinnamon rolls en Paysandú:\nlo que más nos preguntan.'),
  ('faq.1.pregunta', 10, 'Pregunta 1', 'Si la pregunta o la respuesta quedan vacías, no se muestra.', 'dato', '¿Dónde compro cinnamon rolls en Paysandú?'),
  ('faq.1.respuesta', 11, 'Respuesta 1', null, 'texto_largo', 'En Cinniminies hacemos cinnamon rolls (rolls o rollos de canela) a mano, en Paysandú. Hacés el pedido en esta web, por WhatsApp o por Instagram, y coordinamos el retiro o el envío para el sábado.'),
  ('faq.2.pregunta', 20, 'Pregunta 2', null, 'dato', '¿Qué sabores de rolls tienen?'),
  ('faq.2.respuesta', 21, 'Respuesta 2', null, 'texto_largo', 'Cuatro: Canela, el clásico con glaseado simple; Dulce de Leche; Oreo, nuestro producto estrella; y Nutella, los más nuevos. Podés mezclar sabores en la misma caja.'),
  ('faq.3.pregunta', 30, 'Pregunta 3', null, 'dato', '¿Cómo se venden?'),
  ('faq.3.respuesta', 31, 'Respuesta 3', null, 'texto_largo', 'En cajas de 6 o de 12 rolls, o en una caja personalizada de 3 a 12 rolls en la que cada sabor tiene su precio. Los precios actualizados están en el menú de arriba.'),
  ('faq.4.pregunta', 40, 'Pregunta 4', null, 'dato', '¿Hacen envíos a domicilio?'),
  ('faq.4.respuesta', 41, 'Respuesta 4', null, 'texto_largo', 'Sí. Al hacer el pedido elegís retiro (cerca de Barrio Obrero, en Paysandú) o entrega en tu casa; el envío se cobra aparte.'),
  ('faq.5.pregunta', 50, 'Pregunta 5', null, 'dato', '¿Qué días entregan?'),
  ('faq.5.respuesta', 51, 'Respuesta 5', null, 'texto_largo', 'Horneamos para los sábados y entregamos alrededor del mediodía. Pedí durante la semana y te escribimos por WhatsApp para confirmar el horario.'),
  ('faq.6.pregunta', 60, 'Pregunta 6', null, 'dato', '¿Cómo se paga?'),
  ('faq.6.respuesta', 61, 'Respuesta 6', null, 'texto_largo', 'En efectivo al retirar o recibir, o por transferencia. Si elegís transferencia, te mostramos los datos de la cuenta al terminar el pedido.'),
  ('faq.7.pregunta', 70, 'Pregunta 7', null, 'dato', '¿Sirven para regalar o para un cumpleaños?'),
  ('faq.7.respuesta', 71, 'Respuesta 7', null, 'texto_largo', 'Sí: una caja de rolls de canela es un regalo rico para una merienda, un desayuno sorpresa o para compartir en familia. Si necesitás más de una caja para un evento, escribinos y lo coordinamos.'),
  ('faq.8.pregunta', 80, 'Pregunta 8', null, 'dato', ''),
  ('faq.8.respuesta', 81, 'Respuesta 8', null, 'texto_largo', ''),
  ('faq.9.pregunta', 90, 'Pregunta 9', null, 'dato', ''),
  ('faq.9.respuesta', 91, 'Respuesta 9', null, 'texto_largo', ''),
  ('faq.10.pregunta', 100, 'Pregunta 10', null, 'dato', ''),
  ('faq.10.respuesta', 101, 'Respuesta 10', null, 'texto_largo', '')
) as t(clave, orden, etiqueta, ayuda, tipo, valor);
