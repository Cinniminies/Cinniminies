// Pruebas de /api/recomendacion: node --test api/_tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { ErrorRecomendacion, leerCampana, consultarCodigo, limpiarCodigo } = require('../_lib/recomendacion.js');
const { modoPrueba } = require('../_lib/supabase.js');

// Simula Supabase: guarda lo que se pidió y responde lo que se le pasa.
function falso(respuesta, ok = true) {
  const pedidos = [];
  return {
    pedidos,
    conf: { url: 'https://x', clave: 'sb_secret_x', fetch: async (url, op) => {
      pedidos.push({ url, cuerpo: JSON.parse(op.body) });
      return { ok, status: ok ? 200 : 500, json: async () => respuesta, text: async () => 'error' };
    } },
  };
}

test('limpiarCodigo deja letras y números en mayúscula', () => {
  assert.equal(limpiarCodigo(' ana-k7p '), 'ANAK7P');
  assert.equal(limpiarCodigo(42), '');
});

test('modoPrueba solo con MODO_PRUEBA=1', () => {
  assert.equal(modoPrueba({ MODO_PRUEBA: '1' }), true);
  assert.equal(modoPrueba({ MODO_PRUEBA: '0' }), false);
  assert.equal(modoPrueba({}), false);
});

test('leerCampana pasa la marca de prueba y limpia la respuesta', async () => {
  const f = falso({ activa: true, porcentaje: '5.00', tope: '30.00', hasta: '2026-12-31', otra: 'x' });
  assert.deepEqual(await leerCampana(true, f.conf), { activa: true, porcentaje: 5, tope: 30, hasta: '2026-12-31' });
  assert.match(f.pedidos[0].url, /rpc\/campana_web$/);
  assert.deepEqual(f.pedidos[0].cuerpo, { p_prueba: true });
  assert.deepEqual(await leerCampana(false, falso({ activa: false }).conf), { activa: false });
});

test('consultarCodigo: normaliza, filtra campos y rechaza códigos cortos', async () => {
  const f = falso({ estado: 'propio', nombre: 'Ana', porcentaje: 10, tope: 30, celular: '099' });
  assert.deepEqual(await consultarCodigo({ codigo: 'ana-k7p', telefono: '099 123 456' }, false, f.conf),
    { estado: 'propio', nombre: 'Ana', porcentaje: 10, tope: 30 });
  assert.deepEqual(f.pedidos[0].cuerpo, { p_codigo: 'ANAK7P', p_telefono: '099123456', p_prueba: false });
  // el porcentaje solo se muestra con el código propio
  assert.deepEqual(await consultarCodigo({ codigo: 'ANA-K7P' }, false, falso({ estado: 'recomendado', nombre: 'Ana', porcentaje: 10 }).conf),
    { estado: 'recomendado', nombre: 'Ana' });
  await assert.rejects(consultarCodigo({ codigo: 'AN' }, false, f.conf), ErrorRecomendacion);
  await assert.rejects(consultarCodigo({ codigo: 'ANAK7P' }, false, falso({ estado: 'raro' }).conf), (e) => !(e instanceof ErrorRecomendacion));
});

test('handler: GET sin cache en modo prueba, POST con error 400 para el cliente', async () => {
  const handler = require('../recomendacion.js');
  const antes = { ...process.env };
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_x';
  process.env.MODO_PRUEBA = '1';
  const fetchAntes = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ activa: true, porcentaje: 5, tope: 30, hasta: '2026-12-31' }) });
  const respuesta = () => {
    const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, end(c) { r.cuerpo = JSON.parse(c); } };
    return r;
  };
  try {
    const r1 = respuesta();
    await handler({ method: 'GET' }, r1);
    assert.equal(r1.statusCode, 200);
    assert.equal(r1.cuerpo.prueba, true);
    assert.equal(r1.headers['Cache-Control'], 'no-store');
    const r2 = respuesta();
    await handler({ method: 'POST', body: { codigo: 'x' } }, r2);
    assert.equal(r2.statusCode, 400);
  } finally {
    global.fetch = fetchAntes;
    process.env = antes;
  }
});
