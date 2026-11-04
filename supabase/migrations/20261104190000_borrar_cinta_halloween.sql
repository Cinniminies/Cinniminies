-- La decoración de Halloween terminó el 2/11 y su script se borró en el #108: la cinta ya no la lee nadie y solo
-- quedaba en /admin → Web como un texto que no se ve en ningún lado.
delete from contenido_web where clave = 'halloween.cinta';
