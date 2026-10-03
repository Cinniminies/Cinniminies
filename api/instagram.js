// GET /api/instagram → lee Instagram y guarda los números del día (ver _lib/instagram.js).
// La llama el cron de Vercel una vez por día (vercel.json) con "Authorization: Bearer <CRON_SECRET>".
const { configuracion, responderJson } = require('./_lib/supabase.js');
const { actualizar } = require('./_lib/instagram.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    responderJson(res, 500, { error: 'Falta CRON_SECRET en Vercel' });
    return;
  }
  if (req.headers.authorization !== `Bearer ${secreto}`) {
    responderJson(res, 401, { error: 'No autorizado' });
    return;
  }
  const conf = configuracion();
  if (!conf.clave) {
    responderJson(res, 500, { error: 'Falta SUPABASE_SERVICE_ROLE_KEY en Vercel' });
    return;
  }
  try {
    responderJson(res, 200, await actualizar(conf));
  } catch (e) {
    console.error('Instagram:', e.message);
    responderJson(res, 502, { error: e.message });
  }
};
