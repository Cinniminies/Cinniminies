// GET /api/instagram → lee Instagram y guarda los números del día (ver _lib/instagram.js).
// La llama el cron de Vercel una vez por día (vercel.json) con "Authorization: Bearer <CRON_SECRET>".
const { funcionCron } = require('./_lib/supabase.js');
const { actualizar } = require('./_lib/instagram.js');

module.exports = funcionCron('Instagram', actualizar);
