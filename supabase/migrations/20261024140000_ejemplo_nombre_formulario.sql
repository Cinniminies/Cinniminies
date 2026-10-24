-- El ejemplo del campo "Nombre y apellido" del pedido decía el nombre de una de las dueñas: pasa a uno genérico
-- y queda editable en /admin → Web → Textos e imágenes ("Carrito y formulario"). En index.html va con
-- data-contenido-placeholder.

insert into contenido_web (clave, seccion, orden, etiqueta, ayuda, tipo, valor, original)
values ('form.ejemplo_nombre', 'Carrito y formulario', 18, 'Ejemplo en "Nombre y apellido"',
        'Texto gris que se ve dentro del campo vacío.', 'texto', 'Ej: Ana García', 'Ej: Ana García')
on conflict (clave) do nothing;
