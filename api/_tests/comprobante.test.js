// Pruebas de /api/comprobante: node --test api/_tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { tipoReal, armarComprobante, guardarComprobante, ErrorComprobante, MAX_ARCHIVO } = require('../_lib/comprobante.js');
const handler = require('../comprobante.js');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
const valido = { codigo: 'cm-2026-ab12', telefono: '099 111 333', archivo: `data:image/png;base64,${PNG.toString('base64')}` };

test('tipoReal: por los primeros bytes', () => {
  assert.deepEqual(tipoReal(PNG), ['image/png', 'png']);
  assert.deepEqual(tipoReal(Buffer.from('%PDF-1.7 xxxxxxxx')), ['application/pdf', 'pdf']);
  assert.deepEqual(tipoReal(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(20)])), ['image/jpeg', 'jpg']);
  assert.deepEqual(tipoReal(Buffer.from('\0\0\0\x18ftypheic\0\0\0\0', 'latin1')), ['image/heic', 'heic']);
  assert.equal(tipoReal(Buffer.from('<html><script>alert(1)</script>')), null);
});

test('armarComprobante: normaliza y valida', () => {
  const c = armarComprobante(valido);
  assert.equal(c.codigo, 'CM-2026-AB12');
  assert.equal(c.telefono, '099111333');
  assert.equal(c.tipo, 'image/png');
  assert.throws(() => armarComprobante({ ...valido, codigo: 'x' }), /número de pedido/);
  assert.throws(() => armarComprobante({ ...valido, telefono: '123' }), /celular/);
  assert.throws(() => armarComprobante({ ...valido, archivo: Buffer.from('hola mundo, no soy una foto').toString('base64') }), /foto/);
  assert.throws(() => armarComprobante({ ...valido, archivo: Buffer.alloc(MAX_ARCHIVO + 1).toString('base64') }), /grande/);
});

test('guardarComprobante: sube, anota y, si la base lo rechaza, borra el archivo', async () => {
  const pedidos = [];
  const fetchFalso = (rpc) => async (url, op) => {
    pedidos.push([op.method, url.replace('https://x', '')]);
    if (url.includes('/rpc/')) return rpc;
    return { ok: true, text: async () => '' };
  };
  const c = armarComprobante(valido);
  const ok = await guardarComprobante(c, { url: 'https://x', clave: 'eyJ', fetch: fetchFalso({ ok: true, json: async () => 'CM-2026-AB12/x.png' }) });
  assert.equal(ok.codigo, 'CM-2026-AB12');
  assert.match(pedidos[0][1], /^\/storage\/v1\/object\/comprobantes\/CM-2026-AB12\/[0-9a-f]{12}\.png$/);

  pedidos.length = 0;
  const rechazo = { ok: false, status: 400, json: async () => ({ code: 'P0001', message: 'El pedido ya tiene un comprobante' }) };
  await assert.rejects(guardarComprobante(c, { url: 'https://x', clave: 'eyJ', fetch: fetchFalso(rechazo) }),
    (e) => e instanceof ErrorComprobante && /ya tiene/.test(e.message));
  assert.deepEqual(pedidos.map((p) => p[0]), ['POST', 'POST', 'DELETE']);
});

function respuesta() {
  return { statusCode: 200, headers: {}, cuerpo: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(c) { this.cuerpo = c; } };
}

test('handler: método y cuerpo inválido', async () => {
  const env = { ...process.env };
  try {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJx';
    let res = respuesta();
    await handler({ method: 'GET', headers: {} }, res);
    assert.equal(res.statusCode, 405);
    res = respuesta();
    await handler({ method: 'POST', headers: {}, body: '{no es json' }, res);
    assert.equal(res.statusCode, 400);
    res = respuesta();
    await handler({ method: 'POST', headers: {}, body: { ...valido, telefono: '' } }, res);
    assert.equal(res.statusCode, 400);
  } finally {
    process.env = env;
  }
});
