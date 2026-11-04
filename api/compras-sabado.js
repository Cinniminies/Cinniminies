// GET /api/compras-sabado → manda el aviso push del viernes con lo que hay que comprar para hornear el sábado (idea
// 3.6). Lo llama el cron de Vercel los viernes a la mañana (vercel.json) con "Authorization: Bearer <CRON_SECRET>". La
// lista la arma la base (compras_sabado, la misma de ¿Qué compro?) y el aviso abre esa pantalla con el plan cargado.
const { funcionCron, rpc } = require('./_lib/supabase.js');
const { configuracionPush, armarAvisoCompras, mandarAviso } = require('./_lib/push.js');

// Sin fecha, la base toma el sábado de esta semana. Si ese sábado no se hornea (sabados_sin_horneado), los pedidos son
// de otro sábado: no entra ninguno y no se avisa.
module.exports = funcionCron('Compras del sábado', async (conf) => {
  const vapid = configuracionPush();
  if (!vapid) throw new Error('Faltan las claves VAPID en Vercel');
  const aviso = armarAvisoCompras(await rpc('compras_sabado', {}, conf));
  return { aviso, ...(await mandarAviso(aviso, conf, require('web-push'), vapid)) };
});
