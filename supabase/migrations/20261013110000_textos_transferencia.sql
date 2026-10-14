-- Pago por transferencia: los datos de la cuenta por separado (banco, número, a nombre de) y todos los
-- textos del panel, en una sección propia de /admin → Web. La web muestra la cuenta apenas eligen
-- transferencia en el formulario, y otra vez en el panel del comprobante.

-- Tipo nuevo "dato": un renglón que puede quedar vacío (si está vacío, la web no lo muestra).
alter table contenido_web drop constraint contenido_web_tipo_check;
alter table contenido_web add constraint contenido_web_tipo_check
  check (tipo in ('texto', 'texto_largo', 'imagen', 'whatsapp', 'instagram', 'direccion', 'dato'));

-- El texto de la migración anterior pasa a ser lo que se ve mientras no haya cuenta cargada.
update contenido_web
   set seccion = 'Pago por transferencia', orden = 5, tipo = 'texto',
       etiqueta = 'Si no hay número de cuenta',
       ayuda = 'Se muestra en lugar de los datos mientras el número de cuenta esté vacío.'
 where clave = 'pago.transferencia';

insert into contenido_web (clave, seccion, orden, etiqueta, ayuda, tipo, valor, original)
select clave, 'Pago por transferencia', orden, etiqueta, ayuda, tipo, valor, valor from (values
  ('pago.banco', 1, 'Banco', 'Ej: BROU. Si queda vacío no se muestra.', 'dato', ''),
  ('pago.cuenta', 2, 'Número de cuenta',
    'Se muestra apenas eligen pagar por transferencia, con un botón para copiarlo.', 'dato', ''),
  ('pago.titular', 3, 'A nombre de', null, 'dato', ''),
  ('pago.nota', 4, 'Aclaración', 'Opcional. Ej: Caja de ahorro en pesos.', 'dato', ''),
  ('pago.titulo', 6, 'Título del panel', 'El panel que aparece después de confirmar el pedido.', 'texto', 'Pagá por transferencia'),
  ('pago.instruccion', 7, 'Indicación', 'Debajo del total a transferir.', 'texto_largo',
    'Poné el número de pedido en el concepto de la transferencia.'),
  ('pago.ayuda_comprobante', 8, 'Ayuda para subir el comprobante', null, 'texto',
    'Una foto, una captura o el PDF del banco. Si preferís, lo mandás después por WhatsApp.'),
  ('pago.boton_despues', 9, 'Botón para mandarlo después', null, 'texto', 'Lo mando después'),
  ('pago.aviso_despues', 10, 'Aviso si lo mandan después',
    'Se ve al final del pedido si no subieron el comprobante.', 'texto_largo',
    'Cuando hagas la transferencia, mandanos el comprobante por WhatsApp con tu número de pedido.')
) as t(clave, orden, etiqueta, ayuda, tipo, valor);
