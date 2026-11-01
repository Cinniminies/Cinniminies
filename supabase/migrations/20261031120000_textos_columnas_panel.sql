-- Títulos nuevos del panel /admin: en la compu, la columna de cargar también lleva título para que las dos columnas
-- arranquen parejas, y los vacíos del Inicio y del plan dicen qué falta. Editables en /admin → Web, "Panel de gestión".
insert into contenido_web (clave, seccion, orden, etiqueta, ayuda, tipo, valor, original)
select clave, 'Panel de gestión', orden, etiqueta, ayuda, 'texto', valor, valor from (values
  ('panel.cargar', 12, 'Título de los accesos para cargar',
    'En Inicio, en la compu, arriba de los botones Tanda, Compra, Gasto, Ingreso y Conteo.', 'Cargar'),
  ('panel.grafico_vacio', 13, 'Gráfico de meses sin ventas',
    'En Inicio, en lugar del gráfico de vendido y ganancia cuando los seis meses dan cero.',
    'Todavía no hubo ventas en estos seis meses.'),
  ('panel.cargar_movimiento', 14, 'Título del formulario de gastos',
    'En Gastos e ingresos, en la compu, arriba del formulario.', 'Cargar un movimiento'),
  ('panel.cargar_compra', 15, 'Título del formulario de compras',
    'En Producción → Compras, en la compu, arriba del formulario.', 'Cargar una compra'),
  ('panel.cargar_tanda', 16, 'Título del formulario de tandas',
    'En Producción → Tandas, en la compu, arriba del formulario.', 'Cargar una tanda'),
  ('panel.plan_que', 17, 'Título de la columna del plan',
    'En Plan de horneado, en la compu, arriba del día de horneado y los pedidos.', 'Qué se hornea'),
  ('panel.plan_nada', 18, 'Plan sin nada para hornear',
    'En Plan de horneado, cuando no hay pedidos elegidos. {fecha} es el sábado.', 'Nada para hornear el {fecha}')
) as t(clave, orden, etiqueta, ayuda, valor)
on conflict (clave) do nothing;
