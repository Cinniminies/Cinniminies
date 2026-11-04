// Pruebas de /api/visita (idea 6.2): node --test api/_tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { esBot, armarVisita } = require('../_lib/visitas.js');
const { respuestaHttp, correrHandler } = require('./_ayudas.js');
const handler = require('../visita.js');

const valida = { sesion: 'abc123def456', tipo: 'visita', origen: 'instagram', dispositivo: 'celular' };
const CELULAR = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300';

const post = (body, userAgent = CELULAR) => ({
  method: 'POST', headers: { 'user-agent': userAgent, 'x-forwarded-for': '1.2.3.4' }, body,
});

const visitar = (req, { env = {}, responder } = {}) =>
  correrHandler(handler, req, { env: { SUPABASE_SERVICE_ROLE_KEY: 'eyJx', MODO_PRUEBA: undefined, ...env }, responder });

test('armarVisita: deja solo los cuatro campos y descarta lo que no es texto corto', () => {
  assert.deepEqual(armarVisita({ ...valida, extra: 'x' }), valida);
  assert.equal(armarVisita({ ...valida, tipo: 3 }), null);
  assert.equal(armarVisita({ ...valida, origen: 'x'.repeat(40) }), null);
  assert.equal(armarVisita({ sesion: valida.sesion }), null);
  assert.equal(armarVisita(null), null);
});

test('armarVisita: hasta 32 caracteres por campo', () => {
  assert.deepEqual(armarVisita({ ...valida, sesion: 'x'.repeat(32) }), { ...valida, sesion: 'x'.repeat(32) });
  assert.equal(armarVisita({ ...valida, sesion: 'x'.repeat(33) }), null);
  assert.equal(armarVisita([]), null);
});

test('esBot: buscadores, vistas previas y navegadores sin nombre', () => {
  assert.ok(esBot('Mozilla/5.0 (compatible; Googlebot/2.1)'));
  assert.ok(esBot('facebookexternalhit/1.1'));
  assert.ok(esBot('Mozilla/5.0 HeadlessChrome/120'));
  assert.ok(esBot(''));
  assert.ok(!esBot(CELULAR));
});

test('handler: guarda la visita con el hash de la IP y responde 204 sin cuerpo', async () => {
  const { res, llamadas } = await visitar(post(valida));
  assert.equal(res.statusCode, 204);
  assert.equal(res.cuerpo, undefined);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(llamadas.length, 1);
  assert.match(llamadas[0].url, /\/rest\/v1\/rpc\/registrar_visita$/);
  assert.deepEqual(llamadas[0].cuerpo.p, valida);
  assert.match(llamadas[0].cuerpo.p_ip_hash, /^[0-9a-f]{32}$/);
});

test('handler: bots, modo prueba, forma inválida o cuerpo grande se ignoran con 204', async () => {
  for (const [req, env] of [
    [post(valida, 'Googlebot/2.1')],
    [post(valida, '')],
    [post(valida), { MODO_PRUEBA: '1' }],
    [post({ ...valida, tipo: 3 })],
    [post('{no es json')],
    [post({ ...valida, extra: 'x'.repeat(400) })],
  ]) {
    const { res, llamadas } = await visitar(req, { env });
    assert.equal(res.statusCode, 204);
    assert.equal(llamadas.length, 0);
  }
});

test('handler: si la base falla igual responde 204; GET da 405', async () => {
  const { res, logs } = await visitar(post(valida), { responder: () => respuestaHttp({ code: 'XX000' }, 500) });
  assert.equal(res.statusCode, 204);
  assert.match(logs[0], /^Visita: Supabase respondió 500/);
  assert.equal((await visitar({ method: 'GET', headers: {} })).res.statusCode, 405);
});
