// Pruebas de /api/compras-sabado (cron de los viernes, idea 3.6): node --test api/_tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../compras-sabado.js');
const { respuestaHttp, correrHandler } = require('./_ayudas.js');

const CRON = { authorization: 'Bearer secreto' };
const ENTORNO = {
  CRON_SECRET: 'secreto', SUPABASE_SERVICE_ROLE_KEY: 'eyJx',
  VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'k', VAPID_SUBJECT: 'mailto:x@y',
};
const compras = { sabado: '2026-11-07', pedidos: 2, total: 250, comprar: [{ insumo: 'Leche' }, { insumo: 'Huevos' }] };
// La base devuelve `lista` a la RPC y ninguna suscripción push.
const base = (lista) => (url) => respuestaHttp(url.includes('/rpc/') ? lista : []);

const avisar = (headers, { env = {}, responder = base(compras) } = {}) =>
  correrHandler(handler, { method: 'GET', headers }, { env: { ...ENTORNO, ...env }, responder });

test('handler: sin el secreto del cron o sin VAPID no pide nada', async () => {
  let r = await avisar({});
  assert.equal(r.res.statusCode, 401);
  r = await avisar(CRON, { env: { VAPID_SUBJECT: undefined } });
  assert.equal(r.res.statusCode, 502);
  assert.match(r.cuerpo.error, /VAPID/);
  assert.equal(r.llamadas.length, 0);
});

test('handler: pide las compras de este sábado (la base elige la fecha) y arma el aviso', async () => {
  const r = await avisar(CRON);
  assert.equal(r.res.statusCode, 200);
  assert.equal(r.cuerpo.aviso.titulo, 'Compras para el sábado 07/11');
  assert.equal(r.cuerpo.aviso.cuerpo, 'Leche y Huevos · $250');
  const rpc = r.llamadas.find((l) => l.url.includes('/rpc/compras_sabado'));
  assert.deepEqual(rpc.cuerpo, {});
  assert.ok(r.llamadas.some((l) => l.url.includes('/push_suscripciones')), 'busca a quién mandarlo');
});

test('handler: sin pedidos por hacer no manda nada', async () => {
  const r = await avisar(CRON, { responder: base({ ...compras, pedidos: 0, comprar: [] }) });
  assert.equal(r.res.statusCode, 200);
  assert.deepEqual(r.cuerpo, { aviso: null, enviados: 0, borrados: 0, fallidos: 0 });
  assert.ok(!r.llamadas.some((l) => l.url.includes('/push_suscripciones')));
});

test('handler: si la base falla responde 502', async () => {
  const r = await avisar(CRON, { responder: () => respuestaHttp({ message: 'timeout' }, 500) });
  assert.equal(r.res.statusCode, 502);
  assert.match(r.logs[0], /^Compras del sábado:/);
});
