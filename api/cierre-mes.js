// GET /api/cierre-mes → manda el aviso push con el cierre del mes que terminó (idea 4.4). Lo llama el cron de Vercel
// el día 1 de cada mes (vercel.json) con "Authorization: Bearer <CRON_SECRET>". El resumen lo arma la base
// (cierre_mes) y el aviso abre /admin → Cierre de mes, donde se guarda en PDF o se manda por WhatsApp.
const { configuracionLista, responderJson, cronAutorizado, rpc, fechaLocal } = require('./_lib/supabase.js');
const { configuracionPush, armarAvisoCierre, mandarAviso } = require('./_lib/push.js');

// El primer día del mes anterior al de `hoy` (AAAA-MM-DD): mesAnterior('2026-11-01') → '2026-10-01'.
function mesAnterior(hoy) {
  const [a, m] = hoy.split('-').map(Number);
  return new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 10);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!cronAutorizado(req, res)) return;
  const conf = configuracionLista(res);
  if (!conf) return;
  const vapid = configuracionPush();
  if (!vapid) {
    responderJson(res, 500, { error: 'Faltan las claves VAPID en Vercel' });
    return;
  }
  try {
    const cierre = await rpc('cierre_mes', { p_mes: mesAnterior(fechaLocal()) }, conf);
    const aviso = armarAvisoCierre(cierre);
    responderJson(res, 200, { aviso, ...(await mandarAviso(aviso, conf, require('web-push'), vapid)) });
  } catch (e) {
    console.error('Cierre de mes:', e.message);
    responderJson(res, 502, { error: e.message });
  }
};

module.exports.mesAnterior = mesAnterior;
