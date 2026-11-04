// Pruebas de /api/pedidos: node --test api/_tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { armarPedido, guardarPedido, ErrorPedido, MAX_CUERPO } = require('../_lib/pedidos.js');
const { hashIp } = require('../_lib/supabase.js');
const { respuestaHttp, correrHandler } = require('./_ayudas.js');
const handler = require('../pedidos.js');

const valido = {
  nombre: ' Ana ', telefono: '099123456', modalidad: 'Retiro', pago: 'Efectivo', notas: 'x'.repeat(900),
  cajas: [{ tipo: 'caja_fija', rolls: 6, sabores: { canela: 6 } }],
};
const guardado = { codigo: 'CM-2026-ABCD', total: 250, cajas: [] };
const LIMITE_IP = 'Demasiados pedidos seguidos. Probá de nuevo en unos minutos o escribinos por WhatsApp';
// Sin push ni modo prueba, salvo que la prueba los pida.
const ENTORNO = {
  SUPABASE_SERVICE_ROLE_KEY: 'eyJx', PEDIDOS_SAL: undefined, MODO_PRUEBA: undefined,
  VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined, VAPID_SUBJECT: undefined,
};

const post = (body, headers = {}) => ({ method: 'POST', headers, body });

// /api/pedidos con la base aceptando el pedido, salvo que se pase otro `responder`.
const pedir = (req, { responder = () => respuestaHttp(guardado), env = {} } = {}) =>
  correrHandler(handler, req, { env: { ...ENTORNO, ...env }, responder });

test('armarPedido limpia y recorta', () => {
  const p = armarPedido(valido);
  assert.equal(p.nombre, 'Ana');
  assert.equal(armarPedido({ ...valido, nombre: 'Ana 2 Pérez99' }).nombre, 'Ana Pérez');
  assert.equal(p.modalidad, 'retiro');
  assert.equal(p.pago, 'efectivo');
  assert.equal(p.notas.length, 500);
  assert.deepEqual(p.cajas, [{ tipo: 'caja_fija', rolls: 6, sabores: { canela: 6 } }]);
  assert.throws(() => armarPedido({ ...valido, cajas: [] }), ErrorPedido);
  assert.throws(() => armarPedido([]), ErrorPedido);
  assert.throws(() => armarPedido({ ...valido, cajas: Array(21).fill(valido.cajas[0]) }), /Demasiadas/);
});

test('armarPedido: forma inválida o sin cajas', () => {
  for (const cuerpo of [null, undefined, 'pedido', 42]) assert.throws(() => armarPedido(cuerpo), /Pedido inválido/);
  assert.throws(() => armarPedido({ ...valido, cajas: undefined }), /no tiene cajas/);
  assert.throws(() => armarPedido({ ...valido, cajas: { 0: valido.cajas[0] } }), /no tiene cajas/);
  assert.equal(armarPedido({ ...valido, cajas: Array(20).fill(valido.cajas[0]) }).cajas.length, 20, 'veinte todavía pasan');
});

test('armarPedido: campos que no son texto quedan vacíos y los largos se recortan', () => {
  const p = armarPedido({
    ...valido, nombre: 123, telefono: '0'.repeat(30), modalidad: ['envio'], direccion: ` ${'calle '.repeat(50)}`, pago: null,
    codigo_recomendacion: ' ANA-K7P-ABCDEFGHIJKLMNOP ',
  });
  assert.equal(p.nombre, '');
  assert.equal(p.telefono.length, 20);
  assert.equal(p.modalidad, '');
  assert.equal(p.direccion.length, 200);
  assert.equal(p.pago, '');
  assert.equal(p.codigo_recomendacion, 'ANA-K7P-ABCDEFGHIJKL');
  assert.equal(armarPedido({ ...valido, nombre: '  Ana   María  ' }).nombre, 'Ana María');
});

test('armarPedido: cada caja con tipo conocido, rolls enteros y a lo sumo 20 sabores', () => {
  const muchos = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`sabor${i}`, 1]));
  const [personalizada, rara, sinSabores, enorme] = armarPedido({ ...valido, cajas: [
    { tipo: 'personalizado', rolls: 4, sabores: { oreo: 2, canela: 2 } },
    { tipo: 'gratis', rolls: 6.5, sabores: 'canela' },
    null,
    { rolls: '12', sabores: { ['x'.repeat(80)]: 3, ...muchos } },
  ] }).cajas;
  assert.deepEqual(personalizada, { tipo: 'personalizado', rolls: 4, sabores: { oreo: 2, canela: 2 } });
  assert.deepEqual(rara, { tipo: 'caja_fija', rolls: null, sabores: {} });
  assert.deepEqual(sinSabores, { tipo: 'caja_fija', rolls: null, sabores: {} });
  assert.equal(enorme.rolls, null, 'rolls como texto no se acepta');
  assert.equal(Object.keys(enorme.sabores).length, 20);
  assert.equal(Object.keys(enorme.sabores)[0], 'x'.repeat(60));
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

test('handler: método y cuerpo inválido', async () => {
  let r = await pedir({ method: 'GET', headers: {} });
  assert.equal(r.res.statusCode, 405);

  r = await pedir(post('{no es json'));
  assert.equal(r.res.statusCode, 400);
  assert.equal(r.cuerpo.error, 'Pedido inválido');

  r = await pedir(post(null));
  assert.equal(r.res.statusCode, 400);

  r = await pedir(post({ ...valido, cajas: [] }));
  assert.equal(r.res.statusCode, 400);
  assert.equal(r.res.headers['cache-control'], 'no-store');
});

test('handler: el campo trampa no llega a la base; en blanco o de otro tipo no es trampa', async () => {
  let r = await pedir(post({ ...valido, sitio_web: 'http://spam' }));
  assert.equal(r.res.statusCode, 200, 'se responde como si nada');
  assert.deepEqual(r.cuerpo, { codigo: null, ignorado: true });
  assert.equal(r.llamadas.length, 0);

  r = await pedir(post({ ...valido, sitio_web: '   ' }));
  assert.equal(r.res.statusCode, 201);
  r = await pedir(post({ ...valido, sitio_web: 1 }));
  assert.equal(r.res.statusCode, 201);
});

test('handler: guarda con el hash de la IP y responde 201 con lo que devolvió la base', async () => {
  const req = post(valido, { 'x-forwarded-for': '200.40.1.2' });
  const r = await pedir(req);
  assert.equal(r.res.statusCode, 201);
  assert.deepEqual(r.cuerpo, guardado);
  assert.equal(r.llamadas.length, 1);
  assert.match(r.llamadas[0].url, /\/rest\/v1\/rpc\/crear_pedido_web$/);
  assert.equal(r.llamadas[0].cuerpo.p_ip_hash, hashIp(req, ENTORNO.SUPABASE_SERVICE_ROLE_KEY));
  assert.equal(r.llamadas[0].cuerpo.p.prueba, undefined, 'fuera del modo prueba no va la marca');
});

test('handler: límite por IP de la base → 429; otras reglas de la base → 400', async () => {
  const rechazo = (message) => () => respuestaHttp({ code: 'P0001', message }, 400);
  let r = await pedir(post(valido), { responder: rechazo(LIMITE_IP) });
  assert.equal(r.res.statusCode, 429);
  assert.equal(r.cuerpo.error, LIMITE_IP);

  r = await pedir(post(valido), { responder: rechazo('La Box de 6 lleva 6 rolls') });
  assert.equal(r.res.statusCode, 400);
  assert.equal(r.cuerpo.error, 'La Box de 6 lleva 6 rolls');
});

test('handler: si la base falla responde 502 sin mostrar el detalle', async () => {
  const r = await pedir(post(valido), { responder: () => respuestaHttp({ code: 'XX000', message: 'secreto interno' }, 500) });
  assert.equal(r.res.statusCode, 502);
  assert.deepEqual(r.cuerpo, { error: 'No se pudo guardar el pedido' });
  assert.equal(r.logs.length, 1);
});

test('handler: pedido demasiado grande → 400 sin llegar a la base', async () => {
  const r = await pedir(post({ ...valido, notas: 'x'.repeat(MAX_CUERPO) }));
  assert.equal(r.res.statusCode, 400);
  assert.equal(r.cuerpo.error, 'Pedido demasiado grande');
  assert.equal(r.llamadas.length, 0);
});

test('handler: fuera de Vercel lee el cuerpo del pedido en partes', async () => {
  const texto = JSON.stringify(valido);
  const req = Object.assign(Readable.from([texto.slice(0, 40), texto.slice(40)]), { method: 'POST', headers: {} });
  const r = await pedir(req);
  assert.equal(r.res.statusCode, 201);
  assert.equal(r.llamadas[0].cuerpo.p.nombre, 'Ana');
});

test('handler: con VAPID avisa a los celulares después de guardar', async () => {
  const r = await pedir(post(valido), {
    env: { VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'k', VAPID_SUBJECT: 'mailto:x@y' },
    responder: (url) => respuestaHttp(url.includes('/rpc/') ? guardado : []),
  });
  assert.equal(r.res.statusCode, 201);
  assert.deepEqual(r.llamadas.map((l) => new URL(l.url).pathname),
    ['/rest/v1/rpc/crear_pedido_web', '/rest/v1/push_suscripciones']);
});

test('handler en modo prueba: el pedido va marcado y no se avisa a los celulares', async () => {
  const r = await pedir(post({ ...valido, codigo_recomendacion: ' ana-k7p ' }), {
    env: { MODO_PRUEBA: '1', VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'k', VAPID_SUBJECT: 'mailto:x@y' },
  });
  assert.equal(r.res.statusCode, 201);
  assert.equal(r.llamadas.length, 1, 'solo crear_pedido_web, sin leer suscripciones push');
  assert.equal(r.llamadas[0].cuerpo.p.prueba, true);
  assert.equal(r.llamadas[0].cuerpo.p.codigo_recomendacion, 'ana-k7p');
});
