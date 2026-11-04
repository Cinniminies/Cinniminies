// GET /api/cierre-mes → manda el aviso push con el cierre del mes que terminó (idea 4.4). Lo llama el cron de Vercel
// el día 1 de cada mes (vercel.json) con "Authorization: Bearer <CRON_SECRET>". El resumen lo arma la base
// (cierre_mes) y el aviso abre /admin → Cierre de mes, donde se guarda en PDF o se manda por WhatsApp.
const { funcionCron, rpc, fechaLocal } = require('./_lib/supabase.js');
const { configuracionPush, armarAvisoCierre, mandarAviso } = require('./_lib/push.js');

// El primer día del mes anterior al de `hoy` (AAAA-MM-DD): mesAnterior('2026-11-01') → '2026-10-01'.
function mesAnterior(hoy) {
  const [a, m] = hoy.split('-').map(Number);
  return new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 10);
}

// Sin las claves VAPID no hay a quién avisar: es un error de configuración y responde 502 como cualquier otro.
module.exports = funcionCron('Cierre de mes', async (conf) => {
  const vapid = configuracionPush();
  if (!vapid) throw new Error('Faltan las claves VAPID en Vercel');
  const cierre = await rpc('cierre_mes', { p_mes: mesAnterior(fechaLocal()) }, conf);
  const aviso = armarAvisoCierre(cierre);
  return { aviso, ...(await mandarAviso(aviso, conf, require('web-push'), vapid)) };
});

module.exports.mesAnterior = mesAnterior;
