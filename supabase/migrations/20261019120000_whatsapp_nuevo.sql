-- WhatsApp Business nuevo (+598 98 029 462): el valor ya se cambió desde /admin;
-- acá se actualizan el original (al que vuelve "restaurar") y el ejemplo de la ayuda.
update contenido_web
set original = '59898029462',
    ayuda = 'Con 598 adelante y sin el 0: 59898029462. Es el número al que llegan los pedidos.'
where clave = 'contacto.whatsapp';
