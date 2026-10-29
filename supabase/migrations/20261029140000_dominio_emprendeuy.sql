-- La web pasó de cinniminies.vercel.app a cinniminies.emprendeuy.com (29/10). El mensaje del código de
-- recomendación nombra la dirección: se cambia en el valor (si lo editaron, igual se cambia solo la dirección) y
-- en el original, al que vuelve "Volver al texto original".
update contenido_web
   set valor = replace(valor, 'cinniminies.vercel.app', 'cinniminies.emprendeuy.com'),
       original = replace(original, 'cinniminies.vercel.app', 'cinniminies.emprendeuy.com')
 where clave = 'recomendacion.mensaje'
   and (valor like '%cinniminies.vercel.app%' or original like '%cinniminies.vercel.app%');
