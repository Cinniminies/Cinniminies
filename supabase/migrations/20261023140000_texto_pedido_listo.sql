-- Mensaje de "pedido recibido" (23/10, testeo como cliente): decía "confirmar el horario de retiro" también
-- cuando el cliente elegía entrega. Se cambia solo si sigue el texto original (si lo editaron, queda como está).
update contenido_web
   set valor = 'Ya nos llegó tu pedido. Te vamos a escribir por WhatsApp para confirmar el horario de retiro o entrega. Si querés adelantarte, tocá el botón de abajo.'
 where clave = 'pedido.listo'
   and valor = 'Ya nos llegó tu pedido. Te vamos a escribir por WhatsApp para confirmar el horario de retiro. Si querés adelantarte, tocá el botón de abajo.';
