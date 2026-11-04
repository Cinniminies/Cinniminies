// Pruebas de /api/comprobante: node --test api/_tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  tipoReal, armarComprobante, guardarComprobante, ErrorComprobante, MAX_ARCHIVO, MAX_CUERPO,
} = require('../_lib/comprobante.js');
const { respuestaHttp, correrHandler } = require('./_ayudas.js');
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

test('tipoReal: WebP y archivos demasiado cortos para saber', () => {
  assert.deepEqual(tipoReal(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1')), ['image/webp', 'webp']);
  assert.equal(tipoReal(Buffer.from('RIFF\0\0\0\0WAVEfmt ', 'latin1')), null, 'un RIFF que no es WebP');
  assert.equal(tipoReal(Buffer.from('%PDF-1.7')), null);
  assert.equal(tipoReal(Buffer.alloc(0)), null);
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

test('armarComprobante: forma inválida, celulares que no son de Uruguay y archivo sin el prefijo data:', () => {
  for (const cuerpo of [null, [], 'archivo']) assert.throws(() => armarComprobante(cuerpo), /Pedido inválido/);
  assert.throws(() => armarComprobante({ ...valido, telefono: '090 111 333' }), /celular/);
  assert.throws(() => armarComprobante({ ...valido, telefono: '0991113333' }), /celular/);
  assert.throws(() => armarComprobante({ ...valido, codigo: 42 }), /número de pedido/);
  assert.throws(() => armarComprobante({ ...valido, archivo: '' }), /Falta el archivo/);
  assert.equal(armarComprobante({ ...valido, archivo: PNG.toString('base64') }).ext, 'png');
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

const ENTORNO = { SUPABASE_SERVICE_ROLE_KEY: 'eyJx' };
const post = (body) => ({ method: 'POST', headers: {}, body });

test('handler: método y cuerpo inválido', async () => {
  let r = await correrHandler(handler, { method: 'GET', headers: {} }, { env: ENTORNO });
  assert.equal(r.res.statusCode, 405);
  r = await correrHandler(handler, post('{no es json'), { env: ENTORNO });
  assert.equal(r.res.statusCode, 400);
  assert.equal(r.cuerpo.error, 'Pedido inválido');
  r = await correrHandler(handler, post({ ...valido, telefono: '' }), { env: ENTORNO });
  assert.equal(r.res.statusCode, 400);
  assert.equal(r.llamadas.length, 0);
});

test('handler: sube el archivo, lo anota en el pedido y responde 201 con el código', async () => {
  const r = await correrHandler(handler, post(valido), { env: ENTORNO });
  assert.equal(r.res.statusCode, 201);
  assert.deepEqual(r.cuerpo, { codigo: 'CM-2026-AB12' });
  assert.deepEqual(r.llamadas.map((l) => new URL(l.url).pathname.split('/').slice(0, 5).join('/')),
    ['/storage/v1/object/comprobantes', '/rest/v1/rpc/adjuntar_comprobante']);
  const { p_codigo: codigo, p_telefono: telefono } = r.llamadas[1].cuerpo;
  assert.deepEqual([codigo, telefono], ['CM-2026-AB12', '099111333']);
});

test('handler: cuerpo más grande que el máximo → 400 con el aviso del tamaño', async () => {
  const r = await correrHandler(handler, post({ ...valido, archivo: 'A'.repeat(MAX_CUERPO) }), { env: ENTORNO });
  assert.equal(r.res.statusCode, 400);
  assert.match(r.cuerpo.error, /máximo 3 MB/);
});

test('handler: si Storage falla responde 502 sin el detalle', async () => {
  const r = await correrHandler(handler, post(valido), { env: ENTORNO, responder: () => respuestaHttp('bucket caído', 500) });
  assert.equal(r.res.statusCode, 502);
  assert.deepEqual(r.cuerpo, { error: 'No se pudo guardar el comprobante' });
  assert.match(r.logs[0], /Storage respondió 500/);
});
