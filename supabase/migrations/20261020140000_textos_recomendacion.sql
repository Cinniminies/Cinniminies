-- Descuento por recomendación: los textos que ve el cliente, editables en /admin → Textos e imágenes.
-- Los que dependen de la campaña llevan variables entre llaves ({porcentaje}, {tope}, …) que la web y /admin
-- reemplazan al mostrarlos; la ayuda de cada uno dice cuáles puede usar.

insert into contenido_web (clave, seccion, orden, etiqueta, ayuda, tipo, valor, original)
select clave, 'Descuento por recomendación', orden, etiqueta, ayuda, tipo, valor, valor from (values
  ('recomendacion.titulo', 1, 'Título del campo', 'En el formulario del pedido. Solo aparece mientras haya una campaña.',
    'texto', 'Código de descuento (opcional)'),
  ('recomendacion.ayuda', 2, 'Aclaración debajo del campo', null, 'texto_largo',
    '¿Te lo pasó alguien? Ponelo acá. Si es tu propio código, te descontamos lo que juntaste.'),
  ('recomendacion.de_amigo', 3, 'Si pone el código de otra persona',
    'Cuando el código sirve (es la primera compra). {nombre}: de quién es el código.', 'texto',
    'Código de {nombre} ✓ Gracias por venir de su parte.'),
  ('recomendacion.sin_saldo', 4, 'Si pone su código sin descuento juntado',
    '{porcentaje}: lo que suma cada recomendación.', 'texto_largo',
    'Es tu código. Todavía no juntaste descuento este mes: compartilo y sumás {porcentaje} % por cada persona nueva que compre.'),
  ('recomendacion.premio_titulo', 5, 'Tarjeta del descuento: título',
    'Cuando pone su código y tiene descuento. {saldo}: el % que tiene.', 'texto', 'Tenés {saldo} % de descuento'),
  ('recomendacion.premio_texto', 6, 'Tarjeta del descuento: texto',
    'Va después de lo que ahorra (ej: −$45 en tu Box de 12). {tope}: el máximo por mes.', 'texto',
    'Este mes podés llegar hasta {tope} % recomendando.'),
  ('recomendacion.tope_titulo', 7, 'Tarjeta al llegar al máximo: título',
    'Se pone naranja y sale confeti. {tope}: el máximo por mes.', 'texto', '¡Llegaste al máximo: {tope} % de descuento!'),
  ('recomendacion.tope_texto', 8, 'Tarjeta al llegar al máximo: texto', null, 'texto',
    'Es lo más alto de la campaña: gracias por recomendarnos.'),
  ('recomendacion.mensaje', 9, 'Mensaje de WhatsApp con el código',
    'El que se manda desde /admin (Ventas o Clientes → Mandar por WhatsApp). {nombre}: primer nombre del cliente, '
    || '{codigo}: su código, {porcentaje}: lo que suma cada recomendación, {tope}: el máximo por mes.', 'texto_largo',
    '¡Hola {nombre}! Gracias por tu compra en Cinniminies. Este es tu código: {codigo}' || chr(10) || chr(10)
    || 'Pasáselo a quien quieras: cada persona nueva que pida en cinniminies.vercel.app con tu código y pague su pedido te suma '
    || '{porcentaje} % de descuento en una Box de 6 o de 12 (hasta {tope} % por mes).' || chr(10) || chr(10)
    || 'Para usarlo, poné tu código cuando hagas tu pedido en la web. Lo que juntes en el mes se usa hasta fin de mes.')
) as t(clave, orden, etiqueta, ayuda, tipo, valor);
