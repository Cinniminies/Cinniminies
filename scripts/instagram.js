// Lee Instagram y guarda los números ahora, sin esperar al cron (mismo código que /api/instagram).
// Usa INSTAGRAM_TOKEN y SUPABASE_SERVICE_ROLE_KEY de .env.local. No muestra el token.
//   node scripts/instagram.js
const fs = require('fs');
const path = require('path');

const env = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(env)) {
  for (const l of fs.readFileSync(env, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const { configuracion } = require('../api/_lib/supabase.js');
const { actualizar } = require('../api/_lib/instagram.js');

const conf = configuracion();
if (!conf.clave) {
  console.error('Falta SUPABASE_SERVICE_ROLE_KEY en .env.local');
  process.exit(1);
}
actualizar(conf).then((r) => console.log(r)).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
