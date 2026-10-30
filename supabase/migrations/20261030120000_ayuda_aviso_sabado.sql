-- El aviso de para qué sábado es el pedido ahora también va arriba de la página (y junto a «Confirmar pedido» cuando
-- no es el de esta semana): quien pide después del cierre tiene que enterarse antes de elegir.
update contenido_web c set ayuda = v.ayuda
  from (values
    ('carrito.sabado', 'Arriba de la página y del carrito. {sabado}: el sábado de entrega (31/10). '
      || '{cierre}: hasta cuándo se puede pedir (jueves 29/10 a las 23:59).'),
    ('carrito.sabado_cerrado', 'Arriba de la página, del carrito y junto a «Confirmar pedido», cuando ya cerraron los '
      || 'pedidos de este sábado. {sabado}: el sábado de entrega. {cierre}: hasta cuándo se puede pedir.'),
    ('carrito.sabado_sin_horneado', 'Arriba de la página, del carrito y junto a «Confirmar pedido», cuando este sábado no '
      || 'hornean. {sabado}: el sábado de entrega. {cierre}: hasta cuándo se puede pedir.')
  ) as v(clave, ayuda)
 where c.clave = v.clave;
