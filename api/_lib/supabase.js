// Lo común para leer Supabase desde las funciones de Vercel (siempre del lado del servidor).
const crypto = require('node:crypto');

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

// Responde 405 si el método no está en `permitidos` (['GET', 'HEAD'], ['POST'], …). Devuelve si se puede seguir.
function metodoPermitido(req, res, permitidos) {
  if (permitidos.includes(req.method)) return true;
  res.setHeader('Allow', permitidos.join(', '));
  res.setHeader('Cache-Control', 'no-store');
  responderJson(res, 405, { error: `Solo ${permitidos.filter((m) => m !== 'HEAD').join(' o ')}` });
  return false;
}

// La configuración con la clave de servicio, o null después de responder 500 si falta en Vercel.
function configuracionLista(res) {
  const conf = configuracion();
  if (conf.clave) return conf;
  res.setHeader('Cache-Control', 'no-store');
  responderJson(res, 500, { error: 'Falta SUPABASE_SERVICE_ROLE_KEY en Vercel' });
  return null;
}

// Cuerpo JSON del pedido. Vercel ya lo parsea en req.body; en otros entornos se lee a mano.
// Si pasa de `maximo` caracteres tira lo que devuelva `muyGrande()`; si no es JSON, un SyntaxError.
async function leerCuerpoJson(req, { maximo, muyGrande }) {
  if (req.body !== undefined) {
    const texto = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (texto.length > maximo) throw muyGrande();
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  }
  let texto = '';
  for await (const parte of req) {
    texto += parte;
    if (texto.length > maximo) throw muyGrande();
  }
  return JSON.parse(texto || 'null');
}

// Llama a una función de la base (POST /rest/v1/rpc/nombre) y devuelve su resultado. Los `raise exception` de la
// base (P0001) son mensajes para el cliente: si se pasa `ErrorCliente`, llegan como ese error; el resto, Error.
async function rpc(nombre, args, { url, clave, fetch: pedir = fetch }, { ErrorCliente } = {}) {
  const r = await pedir(`${url}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: { ...encabezados(clave), 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (r.ok) return r.json();
  const cuerpo = await r.json().catch(() => null);
  if (ErrorCliente && cuerpo?.code === 'P0001' && cuerpo.message) throw new ErrorCliente(cuerpo.message);
  throw new Error(`Supabase respondió ${r.status} a ${nombre}: ${JSON.stringify(cuerpo).slice(0, 300)}`);
}

// IP del cliente según Vercel. No se guarda: solo un hash, para limitar pedidos y visitas seguidos.
function hashIp(req, sal = process.env.PEDIDOS_SAL || 'cinniminies') {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  return ip ? crypto.createHash('sha256').update(`${sal}:${ip}`).digest('hex').slice(0, 32) : null;
}

// El día de hoy (o de `d`) en Uruguay, AAAA-MM-DD.
const fechaLocal = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo' }).format(d);

// Las funciones que llama el cron de Vercel (vercel.json) traen "Authorization: Bearer <CRON_SECRET>". Si no, responde
// el error y devuelve false.
function cronAutorizado(req, res) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    responderJson(res, 500, { error: 'Falta CRON_SECRET en Vercel' });
    return false;
  }
  if (req.headers.authorization !== `Bearer ${secreto}`) {
    responderJson(res, 401, { error: 'No autorizado' });
    return false;
  }
  return true;
}

module.exports = {
  URL_SUPABASE, configuracion, configuracionLista, encabezados, modoPrueba, responderJson, metodoPermitido, leerCuerpoJson, rpc,
  cronAutorizado, fechaLocal, hashIp,
};
