// Pruebas de la lectura de Instagram: node --test api/_tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { actualizar, valoresInsights, RENOVAR_DIAS } = require('../_lib/instagram.js');
const { respuestaHttp, correrHandler } = require('./_ayudas.js');

// Instagram simulado: tokens válidos en `validos`; anota las rutas pedidas (sin el token).
function instagram({ validos = ['TOK'], renovado = 'TOK2', sinViews = [] } = {}) {
  const rutas = [];
  const pedir = async (url) => {
    const u = new URL(url);
    const token = u.searchParams.get('access_token');
    const ruta = u.pathname.replace('/v24.0', '');
    rutas.push(`${ruta}?${[...u.searchParams].filter(([k]) => k !== 'access_token').map(([k, v]) => `${k}=${v}`).join('&')}`);
    if (!validos.includes(token)) return respuestaHttp({ error: { message: 'Invalid OAuth access token', type: 'OAuthException', code: 190 } }, 400);
    if (ruta === '/refresh_access_token') return respuestaHttp({ access_token: renovado, expires_in: 5184000 });
    if (ruta === '/me') return respuestaHttp({ user_id: '17841', username: 'cinniminies', followers_count: 812, follows_count: 120, media_count: 64 });
    if (ruta === '/me/insights') return respuestaHttp({ data: [{ name: 'reach', total_value: { value: 300 } }, { name: 'views', total_value: { value: 900 } }] });
    if (ruta === '/me/media') {
      return respuestaHttp({ data: [
        { id: 'A', caption: 'Rolls de Oreo', media_type: 'VIDEO', media_product_type: 'REELS', permalink: 'https://ig/a', thumbnail_url: 'https://cdn/a.jpg', timestamp: '2026-10-01T21:00:00+0000', like_count: 50, comments_count: 4 },
        { id: 'B', caption: null, media_type: 'IMAGE', media_product_type: 'FEED', media_url: 'https://cdn/b.jpg', timestamp: '2026-09-28T14:00:00+0000', like_count: 20, comments_count: 1 },
      ] });
    }
    const [, id] = ruta.split('/');
    const metricas = u.searchParams.get('metric');
    if (sinViews.includes(id) && metricas.includes('views')) return respuestaHttp({ error: { message: 'metric not supported', code: 100 } }, 400);
    return respuestaHttp({ data: metricas.split(',').map((name, i) => ({ name, values: [{ value: (i + 1) * 100 }] })) });
  };
  return { pedir, rutas };
}

// Supabase simulado: ig_config inicial y lo que se escribe.
function supabase(config = null) {
  const escrito = {};
  const fetch = async (url, op = {}) => {
    const tabla = new URL(url).pathname.split('/').pop();
    if (!op.method) return respuestaHttp(config ? [config] : []);
    escrito[tabla] = JSON.parse(op.body);
    return { ok: true, status: 201, json: async () => null };
  };
  return { conf: { url: 'https://x', clave: 'eyJ', fetch }, escrito };
}

const ahora = new Date('2026-10-03T12:00:00Z');

test('valoresInsights: values y total_value', () => {
  assert.deepEqual(valoresInsights({ data: [{ name: 'reach', values: [{ value: 1 }, { value: 7 }] }, { name: 'views', total_value: { value: 9 } }] }),
    { reach: 7, views: 9 });
});

test('primera vez: usa INSTAGRAM_TOKEN, lo renueva y guarda todo', async () => {
  const ig = instagram();
  const db = supabase();
  const r = await actualizar(db.conf, { env: { INSTAGRAM_TOKEN: 'TOK' }, pedirIg: ig.pedir, ahora });
  assert.deepEqual(r, { usuario: 'cinniminies', seguidores: 812, publicaciones: 2, con_vistas: 2, token_renovado: true });
  assert.equal(db.escrito.ig_config[0].token, 'TOK2');
  assert.equal(db.escrito.ig_config[0].ultimo_error, null);
  assert.deepEqual(db.escrito.ig_cuenta_dia[0], { fecha: '2026-10-03', seguidores: 812, seguidos: 120, publicaciones: 64, alcance: 300, vistas: 900 });
  const a = db.escrito.ig_publicaciones.find((p) => p.id === 'A');
  assert.equal(a.vistas, 100);
  assert.equal(a.alcance, 200);
  assert.equal(a.guardados, 300);
  assert.equal(a.compartidos, 400);
  assert.equal(a.imagen, 'https://cdn/a.jpg');
  assert.equal(db.escrito.ig_publicaciones.find((p) => p.id === 'B').imagen, 'https://cdn/b.jpg');
});

test('token guardado reciente: no lo renueva', async () => {
  const ig = instagram({ validos: ['GUARDADO'] });
  const db = supabase({ token: 'GUARDADO', renovado_en: '2026-10-01T00:00:00Z' });
  const r = await actualizar(db.conf, { env: {}, pedirIg: ig.pedir, ahora });
  assert.equal(r.token_renovado, false);
  assert.ok(!ig.rutas.some((x) => x.startsWith('/refresh')));
  assert.equal(db.escrito.ig_config[0].token, 'GUARDADO');
  assert.equal(db.escrito.ig_config[0].renovado_en, '2026-10-01T00:00:00.000Z');
});

test('token guardado vencido: prueba con INSTAGRAM_TOKEN', async () => {
  const ig = instagram({ validos: ['NUEVO'] });
  const db = supabase({ token: 'VIEJO', renovado_en: '2026-07-01T00:00:00Z' });
  const r = await actualizar(db.conf, { env: { INSTAGRAM_TOKEN: 'NUEVO' }, pedirIg: ig.pedir, ahora });
  assert.equal(r.seguidores, 812);
});

test('ningún token sirve: guarda el error y lo tira', async () => {
  const ig = instagram({ validos: [] });
  const db = supabase({ token: 'VIEJO', renovado_en: '2026-07-01T00:00:00Z' });
  await assert.rejects(actualizar(db.conf, { env: {}, pedirIg: ig.pedir, ahora }), /Invalid OAuth/);
  assert.match(db.escrito.ig_config.ultimo_error, /Invalid OAuth/);
});

test('sin token en ningún lado', async () => {
  await assert.rejects(actualizar(supabase().conf, { env: {}, pedirIg: instagram().pedir, ahora }), /Falta INSTAGRAM_TOKEN/);
});

test('publicación sin "views": usa las otras métricas', async () => {
  const ig = instagram({ sinViews: ['B'] });
  const db = supabase();
  await actualizar(db.conf, { env: { INSTAGRAM_TOKEN: 'TOK' }, pedirIg: ig.pedir, ahora });
  const b = db.escrito.ig_publicaciones.find((p) => p.id === 'B');
  assert.equal(b.vistas, null);
  assert.equal(b.alcance, 100);
});

test('nunca pide el token en una ruta anotada (sanidad del simulador)', async () => {
  const ig = instagram();
  await actualizar(supabase().conf, { env: { INSTAGRAM_TOKEN: 'TOK' }, pedirIg: ig.pedir, ahora });
  assert.ok(ig.rutas.every((x) => !x.includes('TOK')));
});

test('Instagram caído (no es el token): no prueba el otro token y guarda el error', async () => {
  const ig = instagram({ validos: ['GUARDADO', 'NUEVO'] });
  const caido = async (url) => (new URL(url).searchParams.get('access_token') === 'GUARDADO'
    ? respuestaHttp({}, 500) : ig.pedir(url));
  const db = supabase({ token: 'GUARDADO', renovado_en: '2026-10-01T00:00:00Z' });
  await assert.rejects(actualizar(db.conf, { env: { INSTAGRAM_TOKEN: 'NUEVO' }, pedirIg: caido, ahora }),
    /Instagram: respondió 500/);
  assert.equal(ig.rutas.length, 0, 'no llegó a pedir nada con NUEVO');
  assert.match(db.escrito.ig_config.ultimo_error, /respondió 500/);
});

test('renovar el token: a los 7 días justos todavía no; si la renovación falla, sigue con el mismo', async () => {
  // Token guardado renovado hace `ms` milisegundos.
  const renovadoHace = (ms) => actualizar(supabase({ token: 'TOK', renovado_en: new Date(ahora - ms).toISOString() }).conf,
    { env: {}, pedirIg: instagram().pedir, ahora });
  const sieteDias = RENOVAR_DIAS * 86400e3;
  assert.equal((await renovadoHace(sieteDias)).token_renovado, false);
  assert.equal((await renovadoHace(sieteDias + 1)).token_renovado, true);

  const ig = instagram();
  const sinRenovar = async (url) => (url.includes('/refresh_access_token')
    ? respuestaHttp({ error: { message: 'token muy nuevo', code: 10 } }, 400) : ig.pedir(url));
  const db = supabase();
  const r = await actualizar(db.conf, { env: { INSTAGRAM_TOKEN: 'TOK' }, pedirIg: sinRenovar, ahora });
  assert.equal(r.token_renovado, false);
  assert.equal(db.escrito.ig_config[0].token, 'TOK');
  assert.equal(db.escrito.ig_config[0].renovado_en, ahora.toISOString(), 'un token nuevo cuenta desde hoy');
});

test('handler: solo con el secreto del cron; si Instagram falla responde 502', async () => {
  const handler = require('../instagram.js');
  const env = { CRON_SECRET: 'secreto', SUPABASE_SERVICE_ROLE_KEY: 'eyJx', INSTAGRAM_TOKEN: undefined };
  let r = await correrHandler(handler, { method: 'GET', headers: {} }, { env });
  assert.equal(r.res.statusCode, 401);
  assert.equal(r.llamadas.length, 0);

  r = await correrHandler(handler, { method: 'GET', headers: { authorization: 'Bearer secreto' } },
    { env, responder: () => respuestaHttp([]) });
  assert.equal(r.res.statusCode, 502);
  assert.match(r.cuerpo.error, /Falta INSTAGRAM_TOKEN/);
  assert.equal(r.res.headers['cache-control'], 'no-store');

  const ig = instagram();
  r = await correrHandler(handler, { method: 'GET', headers: { authorization: 'Bearer secreto' } }, {
    env: { ...env, INSTAGRAM_TOKEN: 'TOK' },
    // Instagram al simulador; a Supabase, ig_config vacío y escrituras aceptadas.
    responder: (url, op) => (url.startsWith('https://graph.instagram.com')
      ? ig.pedir(url) : respuestaHttp(op.method ? null : [])),
  });
  assert.equal(r.res.statusCode, 200);
  assert.equal(r.cuerpo.usuario, 'cinniminies');
});
