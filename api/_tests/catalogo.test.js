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
  assert.deepEqual(limpiar(null), { sabores: [], formatos: [] });
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
