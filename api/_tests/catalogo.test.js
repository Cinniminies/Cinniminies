// Pruebas del catálogo público: node --test api/_tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { leerCatalogo, limpiar, limpiarContenido, limpiarPromos } = require('../_lib/catalogo.js');
const { respuestaHttp, correrHandler } = require('./_ayudas.js');
const handler = require('../catalogo.js');

test('limpiar: tipos, sabores sin id y fotos no permitidas', () => {
  const c = limpiar({
    sabores: [
      { id: 'canela', nombre: 'Canela', precio_unidad: '50', foto: 'img/roll-canela.webp', descripcion: ' ' },
      { id: '', nombre: 'Sin id' },
      { id: 'x', nombre: 'X', foto: 'javascript:alert(1)', precio_unidad: null },
      { id: 'y', nombre: 'Y', foto: 'https://cdn.ejemplo.com/y.jpg' },
    ],
    formatos: [{ nombre: 'Box de 6', tipo: 'caja_fija', rolls: 6, precio: 250 }],
  });
  assert.deepEqual(c.sabores.map((s) => s.id), ['canela', 'x', 'y']);
  assert.equal(c.sabores[0].precio_unidad, 50);
  assert.equal(c.sabores[0].descripcion, null);
  assert.equal(c.sabores[1].foto, null);
  assert.equal(c.sabores[1].precio_unidad, null);
  assert.equal(c.sabores[2].foto, 'https://cdn.ejemplo.com/y.jpg');
  assert.deepEqual(c.formatos[0], { nombre: 'Box de 6', tipo: 'caja_fija', rolls: 6, min_rolls: null, max_rolls: null, precio: 250 });
  assert.deepEqual(limpiar(null), { sabores: [], contenido: {}, envio: null, formatos: [], promos: [], pedidos: null });
  assert.equal(limpiar({ envio: '25' }).envio, 25, 'precio del envío');
  assert.deepEqual(limpiar({ contenido: { 'hero.titulo': 'Hola', 'mal clave': 'x', 'hero.num': 3, 'hero.largo': 'x'.repeat(1001) } }).contenido,
    { 'hero.titulo': 'Hola' });
});

test('limpiar: promos con tipo y valor válidos, formatos y sabores', () => {
  const c = limpiar({ promos: [
    { nombre: 'Halloween', tipo: 'porcentaje', valor: '6.66', texto: ' Solo el sábado ', hasta: '2026-10-31',
      formatos: [{ tipo: 'caja_fija', rolls: 6 }, null, { rolls: 12 }], sabores: ['canela', '', 3] },
    { nombre: 'Rara', tipo: 'regalo', valor: 10 },
    { nombre: 'Cero', tipo: 'monto', valor: 0 },
    { tipo: 'monto', valor: 20, hasta: 'mañana' },
  ] });
  assert.deepEqual(c.promos, [
    { nombre: 'Halloween', tipo: 'porcentaje', valor: 6.66, texto: 'Solo el sábado', hasta: '2026-10-31',
      formatos: [{ tipo: 'caja_fija', rolls: 6 }], sabores: ['canela'] },
    { nombre: 'Promo', tipo: 'monto', valor: 20, texto: null, hasta: null, formatos: [], sabores: [] },
  ]);
});

test('limpiar: para qué sábado es el pedido', () => {
  assert.deepEqual(limpiar({ pedidos: { sabado: '2026-11-07', cierre: '2026-11-05T23:59', motivo: 'cierre' } }).pedidos,
    { sabado: '2026-11-07', cierre: '2026-11-05T23:59', motivo: 'cierre' });
  assert.equal(limpiar({ pedidos: { sabado: '2026-10-31', cierre: '2026-10-29T23:59', motivo: 'otro' } }).pedidos.motivo, null);
  assert.equal(limpiar({ pedidos: { sabado: 'sábado', cierre: '2026-10-29T23:59' } }).pedidos, null);
});

test('leerCatalogo pide las promos de prueba solo en modo prueba', async () => {
  const cuerpos = [];
  const falso = async (url, op) => { cuerpos.push(op.body); return { ok: true, json: async () => ({}) }; };
  await leerCatalogo({ url: 'https://x.supabase.co', clave: 'eyJk', fetch: falso });
  await leerCatalogo({ url: 'https://x.supabase.co', clave: 'eyJk', fetch: falso, prueba: true });
  assert.deepEqual(cuerpos, ['{}', '{"p_prueba":true}']);
});

test('leerCatalogo llama a la RPC con la clave', async () => {
  let pedido;
  const falso = async (url, op) => { pedido = { url, op }; return { ok: true, json: async () => ({ sabores: [], formatos: [] }) }; };
  await leerCatalogo({ url: 'https://x.supabase.co', clave: 'eyJk', fetch: falso });
  assert.equal(pedido.url, 'https://x.supabase.co/rest/v1/rpc/catalogo_web');
  assert.equal(pedido.op.method, 'POST');
  assert.equal(pedido.op.headers.apikey, 'eyJk');
});

test('limpiar: fotos con barra inicial sí; http, espacios o etiquetas no; nombre por defecto el id', () => {
  const sabores = limpiar({ sabores: [
    { id: ' canela ', nombre: ' ', foto: '/img/roll-canela.webp' },
    { id: 'b', foto: 'http://cdn.ejemplo.com/b.jpg' },
    { id: 'c', foto: 'https://cdn.ejemplo.com/una foto.jpg' },
    { id: 'd', foto: 'img/<script>.jpg' },
  ] }).sabores;
  assert.deepEqual(sabores.map((s) => [s.id, s.nombre, s.foto]),
    [['canela', 'canela', '/img/roll-canela.webp'], ['b', 'b', null], ['c', 'c', null], ['d', 'd', null]]);
});

test('limpiar: formatos personalizados con mínimo y máximo, y números que no lo son', () => {
  const formato = { nombre: ' ', tipo: 'personalizado', min_rolls: '3', max_rolls: '', precio: 'x' };
  assert.deepEqual(limpiar({ formatos: [formato] }).formatos,
    [{ nombre: null, tipo: 'personalizado', rolls: null, min_rolls: 3, max_rolls: null, precio: null }]);
});

test('limpiarContenido y limpiarPromos: lo que no es objeto o lista queda vacío', () => {
  for (const nada of [null, 'texto', ['a'], 3]) assert.deepEqual(limpiarContenido(nada), {});
  assert.deepEqual(limpiarPromos({ nombre: 'Halloween' }), []);
  assert.deepEqual(limpiarPromos([null, { tipo: 'monto', valor: '-5' }, { tipo: 'monto', valor: 'abc' }]), []);
});

const GET = { method: 'GET', headers: {} };
const ENTORNO = { SUPABASE_SERVICE_ROLE_KEY: 'eyJx', MODO_PRUEBA: undefined };

test('handler: sin clave responde 500 sin caché; POST da 405', async () => {
  let { res } = await correrHandler(handler, GET, { env: { SUPABASE_SERVICE_ROLE_KEY: undefined } });
  assert.equal(res.statusCode, 500);
  assert.equal(res.headers['cache-control'], 'no-store');
  ({ res } = await correrHandler(handler, { method: 'POST', headers: {} }, { env: ENTORNO }));
  assert.equal(res.statusCode, 405);
});

test('handler: catálogo limpio, con la hora y cacheado en la CDN', async () => {
  const { res, cuerpo } = await correrHandler(handler, GET, { env: ENTORNO,
    responder: () => respuestaHttp({ sabores: [{ id: 'canela', nombre: 'Canela', precio_unidad: '50' }], envio: '120' }) });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['cache-control'], /^public, .*s-maxage=300/);
  assert.ok(!Number.isNaN(Date.parse(cuerpo.generado)));
  assert.equal(cuerpo.sabores[0].precio_unidad, 50);
  assert.equal(cuerpo.envio, 120);
});

test('handler: si la base falla responde 502 sin caché (la web usa lo que trae escrito)', async () => {
  const { res, logs } = await correrHandler(handler, GET, { env: ENTORNO, responder: () => respuestaHttp(null, 503) });
  assert.equal(res.statusCode, 502);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(logs.length, 1);
});
