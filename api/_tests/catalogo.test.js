// Pruebas del catálogo público: node --test api/_tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { leerCatalogo, limpiar } = require('../_lib/catalogo.js');
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
  assert.deepEqual(limpiar(null), { sabores: [], contenido: {}, envio: null, formatos: [], promos: [] });
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

function respuesta() {
  return { statusCode: 200, headers: {}, cuerpo: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(c) { this.cuerpo = c; } };
}

test('handler: sin clave responde 500 sin caché; POST da 405', async () => {
  const env = { ...process.env };
  try {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    let res = respuesta();
    await handler({ method: 'GET', headers: {} }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.headers['cache-control'], 'no-store');
    res = respuesta();
    await handler({ method: 'POST', headers: {} }, res);
    assert.equal(res.statusCode, 405);
  } finally {
    process.env = env;
  }
});
