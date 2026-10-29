-- Título del mensaje de WhatsApp con las compras (Producción → ¿Qué compro?), editable en /admin → Web.
-- {viernes} y {sabado} se reemplazan por las fechas (dd/mm) de la próxima semana de horneado.
insert into contenido_web (clave, seccion, orden, etiqueta, ayuda, tipo, valor, original)
values ('panel.compras_whatsapp', 'Panel de gestión', 11, 'Título del mensaje de compras',
  'Primera línea del WhatsApp que arma ¿Qué compro? {viernes} es el día de compras y {sabado} el de horneado.', 'texto',
  'Compras del viernes {viernes} para hornear el sábado {sabado}',
  'Compras del viernes {viernes} para hornear el sábado {sabado}')
on conflict (clave) do nothing;
