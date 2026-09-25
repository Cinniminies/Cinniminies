// Pruebas de /api/pedidos: node --test api/_tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { hashIp, armarPedido, guardarPedido, ErrorPedido } = require('../_lib/pedidos.js');
const handler = require('../pedidos.js');

const valido = {
  nombre: ' Ana ', telefono: '099123456', modalidad: 'Retiro', pago: 'Efectivo', notas: 'x'.repeat(900),
  cajas: [{ tipo: 'caja_fija', rolls: 6, sabores: { canela: 6 } }],
};

test('armarPedido limpia y recorta', () => {
  const p = armarPedido(valido);
  assert.equal(p.nombre, 'Ana');
  assert.equal(p.modalidad, 'retiro');
  assert.equal(p.pago, 'efectivo');
  assert.equal(p.notas.length, 500);
  assert.deepEqual(p.cajas, [{ tipo: 'caja_fija', rolls: 6, sabores: { canela: 6 } }]);
  assert.throws(() => armarPedido({ ...valido, cajas: [] }), ErrorPedido);
  assert.throws(() => armarPedido([]), ErrorPedido);
  assert.throws(() => armarPedido({ ...valido, cajas: Array(21).fill(valido.cajas[0]) }), /Demasiadas/);
});

test('hashIp: estable, sin la IP en claro', () => {
  const req = { headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } };
  assert.equal(hashIp(req, 's'), hashIp({ headers: { 'x-forwarded-for': '1.2.3.4' } }, 's'));
  assert.ok(!hashIp(req, 's').includes('1.2.3.4'));
  assert.equal(hashIp({ headers: {} }, 's'), null);
});

test('guardarPedido: mensaje de la base como ErrorPedido; otros errores, Error', async () => {
  const conf = (r) => ({ url: 'https://x', clave: 'eyJ', fetch: async () => r });
  await assert.rejects(guardarPedido({}, null, conf({ ok: false, status: 400, json: async () => ({ code: 'P0001', message: 'Falta el nombre' }) })),
    (e) => e instanceof ErrorPedido && e.message === 'Falta el nombre');
  await assert.rejects(guardarPedido({}, null, conf({ ok: false, status: 500, json: async () => ({ code: 'XX000' }) })),
    (e) => !(e instanceof ErrorPedido));
  const ok = await guardarPedido({}, 'h', conf({ ok: true, json: async () => ({ codigo: 'CM-2026-ABCD', total: 250 }) }));
  assert.equal(ok.codigo, 'CM-2026-ABCD');
});

function respuesta() {
  return { statusCode: 200, headers: {}, cuerpo: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(c) { this.cuerpo = c; } };
}

test('handler: método, honeypot y cuerpo inválido', async () => {
  const env = { ...process.env };
  try {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJx';
    let res = respuesta();
    await handler({ method: 'GET', headers: {} }, res);
    assert.equal(res.statusCode, 405);

    res = respuesta();
    await handler({ method: 'POST', headers: {}, body: { ...valido, sitio_web: 'http://spam' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.cuerpo).ignorado, true);

    res = respuesta();
    await handler({ method: 'POST', headers: {}, body: '{no es json' }, res);
    assert.equal(res.statusCode, 400);

    res = respuesta();
    await handler({ method: 'POST', headers: {}, body: { ...valido, cajas: [] } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.headers['cache-control'], 'no-store');
  } finally {
    process.env = env;
  }
});
