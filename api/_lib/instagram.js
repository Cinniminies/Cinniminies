// Lectura diaria de Instagram (API de Instagram con inicio de sesión de Instagram, cuenta profesional).
// La llama api/instagram.js (cron de Vercel) o scripts/instagram.js (a mano, en local).
// Guarda una foto de la cuenta por día (ig_cuenta_dia) y los números de las últimas publicaciones
// (ig_publicaciones). El token vive en ig_config (solo service_role); el primero sale de INSTAGRAM_TOKEN.
// Los tokens duran 60 días: se renuevan cada RENOVAR_DIAS días al leer.
const { encabezados } = require('./supabase.js');

const API = 'https://graph.instagram.com';
const VERSION = 'v24.0';
const RENOVAR_DIAS = 7;
const PUBLICACIONES = 50;
const ZONA = 'America/Montevideo';

class ErrorInstagram extends Error {
  constructor(mensaje, { codigo, token } = {}) {
    super(mensaje);
    this.codigo = codigo;
    this.tokenInvalido = token === true;
  }
}

// Nunca se loguea ni se devuelve la URL con el token.
async function pedirIg(ruta, params, token, pedir) {
  const u = new URL(ruta.startsWith('/refresh') ? `${API}${ruta}` : `${API}/${VERSION}${ruta}`);
  for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
  u.searchParams.set('access_token', token);
  const r = await pedir(u.toString());
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok || cuerpo.error) {
    const e = cuerpo.error || {};
    throw new ErrorInstagram(`Instagram: ${e.message || `respondió ${r.status}`}`,
      { codigo: e.code, token: e.code === 190 || e.type === 'OAuthException' && r.status === 401 });
  }
  return cuerpo;
}

// Los insights vienen como { name, values: [{ value }] } o { name, total_value: { value } }.
function valoresInsights(datos) {
  const out = {};
  for (const m of datos?.data || []) {
    const v = m.total_value?.value ?? m.values?.[m.values.length - 1]?.value;
    if (typeof v === 'number') out[m.name] = v;
  }
  return out;
}

// Métricas de una publicación. Si la API no acepta alguna (según el tipo o la antigüedad), prueba
// con menos; si no da ninguna, quedan vacías.
async function insightsPublicacion(id, token, pedir) {
  for (const metricas of ['views,reach,saved,shares', 'reach,saved,shares', 'reach']) {
    try {
      return valoresInsights(await pedirIg(`/${id}/insights`, { metric: metricas }, token, pedir));
    } catch (e) {
      if (e.tokenInvalido) throw e;
    }
  }
  return {};
}

async function insightsCuenta(token, pedir) {
  try {
    return valoresInsights(await pedirIg('/me/insights', { metric: 'reach,views', period: 'day', metric_type: 'total_value' }, token, pedir));
  } catch (e) {
    if (e.tokenInvalido) throw e;
    return {};
  }
}

async function leerTodo(token, pedir) {
  const cuenta = await pedirIg('/me', { fields: 'user_id,username,followers_count,follows_count,media_count' }, token, pedir);
  const media = await pedirIg('/me/media', {
    fields: 'id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count',
    limit: String(PUBLICACIONES),
  }, token, pedir);
  const dia = await insightsCuenta(token, pedir);
  const publicaciones = [];
  for (const m of media.data || []) {
    const ins = await insightsPublicacion(m.id, token, pedir);
    publicaciones.push({
      id: m.id,
      publicada_en: m.timestamp,
      tipo: m.media_type,
      producto: m.media_product_type || null,
      texto: m.caption || null,
      enlace: m.permalink || null,
      imagen: m.thumbnail_url || m.media_url || null,
      vistas: ins.views ?? null,
      alcance: ins.reach ?? null,
      me_gusta: m.like_count ?? null,
      comentarios: m.comments_count ?? null,
      guardados: ins.saved ?? null,
      compartidos: ins.shares ?? null,
    });
  }
  return { cuenta, dia, publicaciones };
}

const fechaLocal = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(d);

// Supabase por REST con service_role.
function base({ url, clave, fetch: pedir = fetch }) {
  const h = encabezados(clave);
  const llamar = async (ruta, op = {}) => {
    const r = await pedir(`${url}/rest/v1/${ruta}`, {
      ...op, headers: { ...h, 'Content-Type': 'application/json', ...(op.headers || {}) },
    });
    if (!r.ok) throw new Error(`Supabase respondió ${r.status} en ${ruta.split('?')[0]}`);
    return r.status === 204 ? null : r.json().catch(() => null);
  };
  const upsert = (tabla, filas, conflicto) => llamar(`${tabla}?on_conflict=${conflicto}`, {
    method: 'POST', body: JSON.stringify(filas), headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  });
  return { llamar, upsert };
}

// Lee Instagram y guarda. Devuelve un resumen sin datos sensibles.
async function actualizar(conf, { env = process.env, pedirIg: pedir = fetch, ahora = new Date() } = {}) {
  const db = base(conf);
  const [fila] = (await db.llamar('ig_config?select=token,renovado_en&id=eq.1')) || [];
  const candidatos = [...new Set([fila?.token, env.INSTAGRAM_TOKEN].filter(Boolean))];
  if (!candidatos.length) throw new ErrorInstagram('Falta INSTAGRAM_TOKEN (Vercel o .env.local)');

  let token;
  let datos;
  let error;
  for (const t of candidatos) {
    try {
      datos = await leerTodo(t, pedir);
      token = t;
      break;
    } catch (e) {
      error = e;
      if (!e.tokenInvalido) break; // otro error: no tiene sentido probar el otro token
    }
  }
  if (!datos) {
    if (fila) {
      await db.llamar('ig_config?id=eq.1', { method: 'PATCH', body: JSON.stringify({ ultimo_error: error.message }) })
        .catch(() => {});
    }
    throw error;
  }

  // Renovar el token si es nuevo (vino de la variable) o si pasaron RENOVAR_DIAS días.
  let renovado = false;
  let renovadoEn = fila?.token === token ? new Date(fila.renovado_en) : new Date(0);
  if (ahora - renovadoEn > RENOVAR_DIAS * 86400e3) {
    try {
      const r = await pedirIg('/refresh_access_token', { grant_type: 'ig_refresh_token' }, token, pedir);
      if (r.access_token) { token = r.access_token; renovado = true; renovadoEn = ahora; }
    } catch { /* un token con menos de 24 h no se puede renovar todavía: se intenta mañana */ }
  }

  const { cuenta, dia, publicaciones } = datos;
  await db.upsert('ig_config', [{
    id: 1, token, renovado_en: (renovado || fila?.token !== token ? ahora : renovadoEn).toISOString(),
    usuario: cuenta.username || null, cuenta_id: String(cuenta.user_id || cuenta.id || ''),
    ultima_lectura: ahora.toISOString(), ultimo_error: null,
  }], 'id');
  await db.upsert('ig_cuenta_dia', [{
    fecha: fechaLocal(ahora),
    seguidores: cuenta.followers_count ?? 0,
    seguidos: cuenta.follows_count ?? null,
    publicaciones: cuenta.media_count ?? null,
    alcance: dia.reach ?? null,
    vistas: dia.views ?? null,
  }], 'fecha');
  if (publicaciones.length) {
    await db.upsert('ig_publicaciones', publicaciones.map((p) => ({ ...p, actualizado_en: ahora.toISOString() })), 'id');
  }
  return {
    usuario: cuenta.username, seguidores: cuenta.followers_count, publicaciones: publicaciones.length,
    con_vistas: publicaciones.filter((p) => p.vistas != null).length, token_renovado: renovado,
  };
}

module.exports = { actualizar, valoresInsights, fechaLocal, ErrorInstagram, RENOVAR_DIAS };
