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
// Si pasa de `maximo` caracteres tira lo que devuelva `muyGrande()`. Si no se puede leer o no es JSON, tira lo que
// devuelva `invalido()` o, sin él, el error tal cual (un SyntaxError si no es JSON).
async function leerCuerpoJson(req, { maximo, muyGrande, invalido }) {
  let grande = null;
  const excedido = () => {
    grande = muyGrande();
    return grande;
  };
  try {
    return await leerJson(req, maximo, excedido);
  } catch (e) {
    if (e === grande || !invalido) throw e;
    throw invalido();
  }
}

async function leerJson(req, maximo, muyGrande) {
  if (req.body !== undefined) {
    const texto = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (texto.length > maximo) throw muyGrande();
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  }
  // Se juntan los bytes y se pasan a texto al final: una letra con tilde puede quedar partida entre dos pedazos.
  const partes = [];
  let bytes = 0;
  for await (const parte of req) {
    partes.push(Buffer.from(parte));
    bytes += parte.length;
    if (bytes > maximo) throw muyGrande();
  }
  return JSON.parse(Buffer.concat(partes).toString('utf8') || 'null');
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

// Red del cliente para el límite de pedidos: la IPv4 entera, o el prefijo /64 de una IPv6. Cada conexión IPv6 trae
// 2^64 direcciones propias; contar cada una aparte dejaba saltear el límite cambiando de dirección en cada pedido.
function redDeIp(ip) {
  if (!ip.includes(':')) return ip;
  const ipv4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (ipv4) return ipv4[1];
  const [inicio, fin = ''] = ip.toLowerCase().split('::');
  const izquierda = inicio ? inicio.split(':') : [];
  const derecha = fin ? fin.split(':') : [];
  const ceros = Array(Math.max(0, 8 - izquierda.length - derecha.length)).fill('0');
  return [...izquierda, ...ceros, ...derecha].slice(0, 4).map((grupo) => grupo.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

// Hash de la red del cliente según Vercel. La IP no se guarda: solo el hash, para limitar pedidos y visitas seguidos.
// Sin PEDIDOS_SAL usa la service_role (secreta) de clave: una sal escrita en el código dejaba revertir los hashes.
function hashIp(req, sal = process.env.PEDIDOS_SAL || process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  if (!ip || !sal) return null;
  return crypto.createHmac('sha256', sal).update(redDeIp(ip)).digest('hex').slice(0, 32);
}

// Compara la clave recibida con la esperada sin filtrar por tiempo cuántos caracteres coinciden.
function claveValida(recibida, esperada) {
  if (typeof recibida !== 'string' || !recibida || !esperada) return false;
  const a = crypto.createHash('sha256').update(recibida).digest();
  const b = crypto.createHash('sha256').update(esperada).digest();
  return crypto.timingSafeEqual(a, b);
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
  if (!claveValida(req.headers.authorization, `Bearer ${secreto}`)) {
    responderJson(res, 401, { error: 'No autorizado' });
    return false;
  }
  return true;
}

// Handler de una función que llama el cron: autoriza, arma la configuración y responde 200 con lo que devuelve
// `trabajo(conf)`, o 502 con el error (que queda en el log de Vercel con `nombre`).
function funcionCron(nombre, trabajo) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!cronAutorizado(req, res)) return;
    const conf = configuracionLista(res);
    if (!conf) return;
    try {
      responderJson(res, 200, await trabajo(conf));
    } catch (e) {
      console.error(`${nombre}:`, e.message);
      responderJson(res, 502, { error: e.message });
    }
  };
}

module.exports = {
  URL_SUPABASE, configuracion, configuracionLista, encabezados, modoPrueba, responderJson, metodoPermitido, leerCuerpoJson, rpc,
  claveValida, cronAutorizado, funcionCron, fechaLocal, hashIp,
};
