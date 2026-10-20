// Lo común para leer Supabase desde las funciones de Vercel (siempre del lado del servidor).

// La URL es pública (también está en admin/js/config.js); se puede pisar con SUPABASE_URL.
const URL_SUPABASE = 'https://skysdjfxuykrufawhzvn.supabase.co';

function configuracion() {
  return {
    url: (process.env.SUPABASE_URL || URL_SUPABASE).replace(/\/+$/, ''),
    clave: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

function encabezados(clave) {
  const h = { apikey: clave, Accept: 'application/json' };
  // Las claves nuevas (sb_secret_…) van solo en apikey; la service_role vieja es un JWT.
  if (!clave.startsWith('sb_')) h.Authorization = `Bearer ${clave}`;
  return h;
}

// Modo prueba (descuento por recomendación, 20/10): solo lo prende scripts/servidor-dev.js, nunca Vercel.
// Los pedidos quedan marcados como de prueba (solo los ve el usuario de prueba) y no se mandan avisos.
function modoPrueba(env = process.env) {
  return env.MODO_PRUEBA === '1';
}

function responderJson(res, estado, cuerpo) {
  res.statusCode = estado;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(cuerpo));
}

module.exports = { URL_SUPABASE, configuracion, encabezados, modoPrueba, responderJson };
