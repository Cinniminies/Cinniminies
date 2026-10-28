-- Textos nuevos del panel /admin (rediseño de identidad): editables en /admin → Web, sección "Panel de gestión".
-- No los usa la web pública. {fecha}, {rolls}, {monto} se reemplazan por el dato.
insert into contenido_web (clave, seccion, orden, etiqueta, ayuda, tipo, valor, original)
select clave, 'Panel de gestión', orden, etiqueta, ayuda, 'texto', valor, valor from (values
  ('panel.semana', 1, 'Título de la semana',
    'En Inicio, Ventas, Compras y Gastos, arriba de cada semana. {fecha} es el sábado.', 'Semana del sábado {fecha}'),
  ('panel.semana_ayuda', 2, 'Ayuda de la semana',
    'Debajo del título de la semana en Inicio.', 'Pedidos cargados cada día. Todo se hornea y se entrega el sábado.'),
  ('panel.sabado', 3, 'Rolls del sábado',
    'En la celda del sábado de Inicio, debajo del número. {rolls} es la palabra roll o rolls.', '{rolls} para hornear'),
  ('panel.libro_salio', 4, 'Total que salió en la semana',
    'En Compras y Gastos, al lado del título de cada semana.', 'Salió {monto}'),
  ('panel.libro_entro', 5, 'Total que entró en la semana',
    'En Gastos, al lado del título de cada semana, si entró plata.', 'Entró {monto}'),
  ('panel.vacio_ventas', 6, 'Botón cuando no hay ventas',
    'En Ventas, cuando la lista está vacía.', 'Cargar una venta'),
  ('panel.modo_prueba', 7, 'Cinta de modo prueba',
    'Arriba de todo, solo con el usuario de prueba.', 'Modo prueba: lo que cargues queda en la base real'),
  ('panel.stock_columnas', 8, 'Explicación de las columnas de Stock',
    'En Producción → Stock, el plegable que explica Registro, Hay y Debería haber.', '¿Qué es cada columna?')
) as t(clave, orden, etiqueta, ayuda, valor)
on conflict (clave) do nothing;
