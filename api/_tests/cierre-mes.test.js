// Pruebas de /api/cierre-mes (cron del día 1, idea 4.4): node --test api/_tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../cierre-mes.js');
const { respuestaHttp, correrHandler } = require('./_ayudas.js');

const { mesAnterior } = handler;
const CRON = { authorization: 'Bearer secreto' };
const ENTORNO = {
  CRON_SECRET: 'secreto', SUPABASE_SERVICE_ROLE_KEY: 'eyJx',
  VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'k', VAPID_SUBJECT: 'mailto:x@y',
};
const cierre = {
  mes: '2026-10-01', actual: { vendido: 6790, ganancia_bruta: 4120 }, anterior: { mes: '2026-09-01', vendido: 4565 },
};
// La base devuelve el cierre a la RPC y ninguna suscripción push.
const base = (url) => respuestaHttp(url.includes('/rpc/') ? cierre : []);

const cerrar = (headers, { env = {}, responder = base } = {}) =>
  correrHandler(handler, { method: 'GET', headers }, { env: { ...ENTORNO, ...env }, responder });

test('mesAnterior: el mes que terminó, también en enero', () => {
  assert.equal(mesAnterior('2026-11-01'), '2026-10-01');
  assert.equal(mesAnterior('2027-01-01'), '2026-12-01');
  assert.equal(mesAnterior('2028-03-01'), '2028-02-01');
});

test('handler: sin el secreto del cron no hace nada', async () => {
  let r = await cerrar({});
  assert.equal(r.res.statusCode, 401);
  r = await cerrar(CRON, { env: { CRON_SECRET: undefined } });
  assert.equal(r.res.statusCode, 500);
  assert.equal(r.llamadas.length, 0);
});

test('handler: sin las claves VAPID responde 500 antes de pedir el cierre', async () => {
  const r = await cerrar(CRON, { env: { VAPID_PRIVATE_KEY: undefined } });
  assert.equal(r.res.statusCode, 500);
  assert.match(r.cuerpo.error, /VAPID/);
  assert.equal(r.llamadas.length, 0);
});

test('handler: pide el cierre del mes que terminó y arma el aviso', async (t) => {
  // El cron corre el día 1 a las 12:00 UTC (9:00 en Montevideo).
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-01T12:00:00Z') });
  const r = await cerrar(CRON);
  assert.equal(r.res.statusCode, 200);
  assert.equal(r.res.headers['cache-control'], 'no-store');
  assert.equal(r.cuerpo.aviso.titulo, 'Cierre de octubre');
  assert.deepEqual([r.cuerpo.enviados, r.cuerpo.borrados, r.cuerpo.fallidos], [0, 0, 0]);
  const rpc = r.llamadas.find((l) => l.url.includes('/rpc/cierre_mes'));
  assert.deepEqual(rpc.cuerpo, { p_mes: '2026-10-01' });
});

test('handler: si la base falla responde 502', async () => {
  const r = await cerrar(CRON, { responder: () => respuestaHttp({ message: 'timeout' }, 500) });
  assert.equal(r.res.statusCode, 502);
  assert.match(r.logs[0], /^Cierre de mes:/);
});
