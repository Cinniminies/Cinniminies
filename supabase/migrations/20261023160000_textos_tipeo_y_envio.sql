-- Textos de la web (23/10): errores de tipeo que encontró el testeo como cliente y la pregunta frecuente del
-- envío, que decía "se cobra aparte" (ahora el envío va dentro del total, ver 20261023150000).
-- Cada cambio se aplica solo si el texto sigue igual al que se revisó.
update contenido_web set valor = 'Alrededor del mediodía'
 where clave = 'local.hora' and valor = 'Alrededor del mediodia';
update contenido_web set valor = replace(valor, 'horario de retiro o envio para', 'horario de retiro o envío para')
 where clave = 'local.texto' and valor like '%horario de retiro o envio para%';
update contenido_web
   set valor = 'Sí. Al hacer el pedido elegís retiro (cerca de Barrio Obrero, en Paysandú) o entrega en tu casa; el envío se suma al total del pedido.'
 where clave = 'faq.4.respuesta'
   and valor = 'Sí. Al hacer el pedido elegís retiro (cerca de Barrio Obrero, en Paysandú) o entrega en tu casa; el envío se cobra aparte.';

update sabores set etiqueta_web = 'Los más nuevitos' where slug = 'nutella' and etiqueta_web = 'Los mas nuevitos';
update sabores set descripcion = 'Los estabas esperando, nosotros también.'
 where slug = 'nutella' and descripcion = 'Los estabas esperando, nosotros tambien.';
update sabores set descripcion = replace(descripcion, 'Trozos de oreo', 'Trozos de Oreo')
 where slug = 'oreo' and descripcion like 'Trozos de oreo%';
