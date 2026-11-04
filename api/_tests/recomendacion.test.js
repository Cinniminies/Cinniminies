// Pruebas de /api/recomendacion: node --test api/_tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { ErrorRecomendacion, leerCampana, consultarCodigo, limpiarCodigo } = require('../_lib/recomendacion.js');
const { modoPrueba } = require('../_lib/supabase.js');
const { respuestaHttp, correrHandler } = require('./_ayudas.js');

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
  assert.deepEqual(await leerCampana(false, falso({ activa: false, solo_canje: true }).conf), { activa: false, solo_canje: true });
});

test('consultarCodigo: normaliza, filtra campos y rechaza códigos cortos', async () => {
  const f = falso({ estado: 'propio', nombre: 'Ana', porcentaje: 10, tope: 30, celular: '099' });
  assert.deepEqual(await consultarCodigo({ codigo: 'ana-k7p', telefono: '099 123 456' }, false, f.conf),
    { estado: 'propio', nombre: 'Ana', porcentaje: 10, tope: 30, campana: true });
  // con el bono de la Box de 12 (y sin campaña: solo queda el bono)
  assert.deepEqual(await consultarCodigo({ codigo: 'ANA-K7P', telefono: '099123456' }, false, falso({
    estado: 'propio', nombre: 'Ana', porcentaje: '5.00', tope: '30.00', campana: false, bono: '5.00', bono_hasta: '2027-01-19' }).conf),
  { estado: 'propio', nombre: 'Ana', porcentaje: 5, tope: 30, campana: false, bono: 5, bono_hasta: '2027-01-19' });
  assert.deepEqual(f.pedidos[0].cuerpo, { p_codigo: 'ANAK7P', p_telefono: '099123456', p_prueba: false });
  // el porcentaje solo se muestra con el código propio
  assert.deepEqual(await consultarCodigo({ codigo: 'ANA-K7P' }, false, falso({ estado: 'recomendado', nombre: 'Ana', porcentaje: 10 }).conf),
    { estado: 'recomendado', nombre: 'Ana' });
  await assert.rejects(consultarCodigo({ codigo: 'AN' }, false, f.conf), ErrorRecomendacion);
  await assert.rejects(consultarCodigo({ codigo: 'ANAK7P' }, false, falso({ estado: 'raro' }).conf), (e) => !(e instanceof ErrorRecomendacion));
});

test('limpiarCodigo: hasta 20 caracteres', () => {
  assert.equal(limpiarCodigo('a'.repeat(30)), 'A'.repeat(20));
  assert.equal(limpiarCodigo(null), '');
});

test('leerCampana: sin respuesta de la base no hay campaña; un porcentaje que no es número queda null', async () => {
  assert.deepEqual(await leerCampana(false, falso(null).conf), { activa: false });
  assert.equal((await leerCampana(false, falso({ activa: true, porcentaje: 'x', tope: '30' }).conf)).porcentaje, null);
});

test('consultarCodigo: el bono necesita porcentaje y fecha válidos; el nombre se recorta', async () => {
  const propio = { estado: 'propio', nombre: 'A'.repeat(60), porcentaje: 5, tope: 30, bono: 5, bono_hasta: '19/01/2027' };
  assert.deepEqual(await consultarCodigo({ codigo: 'ANAK7P' }, false, falso(propio).conf),
    { estado: 'propio', nombre: 'A'.repeat(40), porcentaje: 5, tope: 30, campana: true });
  assert.deepEqual(await consultarCodigo({ codigo: 'ANAK7P' }, false, falso({ estado: 'no_existe', nombre: 3 }).conf),
    { estado: 'no_existe' });
  const f = falso({ estado: 'sin_campana' });
  await consultarCodigo({ codigo: 'ana-k7p', telefono: 12345 }, true, f.conf);
  assert.deepEqual(f.pedidos[0].cuerpo, { p_codigo: 'ANAK7P', p_telefono: '', p_prueba: true });
});

const handler = require('../recomendacion.js');
const CAMPANA = { activa: true, porcentaje: 5, tope: 30, hasta: '2026-12-31' };
const consultar = (req, { prueba = false, responder = () => respuestaHttp(CAMPANA) } = {}) => correrHandler(handler, req, {
  env: { SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x', MODO_PRUEBA: prueba ? '1' : undefined }, responder,
});

test('handler: GET sin cache en modo prueba, POST con error 400 para el cliente', async () => {
  const r1 = await consultar({ method: 'GET' }, { prueba: true });
  assert.equal(r1.res.statusCode, 200);
  assert.equal(r1.cuerpo.prueba, true);
  assert.equal(r1.res.headers['cache-control'], 'no-store');
  const r2 = await consultar({ method: 'POST', body: { codigo: 'x' } }, { prueba: true });
  assert.equal(r2.res.statusCode, 400);
});

test('handler: GET y HEAD reales se cachean en la CDN', async () => {
  for (const method of ['GET', 'HEAD']) {
    const { res, cuerpo } = await consultar({ method });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['cache-control'], /^public, .*s-maxage=300/);
    assert.deepEqual(cuerpo, { ...CAMPANA, prueba: false });
  }
});

test('handler: POST con el código, JSON inválido, otro método y base caída', async () => {
  let r = await consultar({ method: 'POST', body: { codigo: 'ANA-K7P' } },
    { responder: () => respuestaHttp({ estado: 'recomendado', nombre: 'Ana' }) });
  assert.equal(r.res.statusCode, 200);
  assert.deepEqual(r.cuerpo, { estado: 'recomendado', nombre: 'Ana' });
  assert.equal(r.res.headers['cache-control'], 'no-store');

  r = await consultar({ method: 'POST', body: '{"codigo":' });
  assert.equal(r.res.statusCode, 400);
  assert.deepEqual(r.cuerpo, { error: 'Consulta inválida' });

  r = await consultar({ method: 'POST', body: { codigo: 'ANAK7P', relleno: 'x'.repeat(1000) } });
  assert.equal(r.res.statusCode, 400);

  r = await consultar({ method: 'PUT' });
  assert.equal(r.res.statusCode, 405);

  r = await consultar({ method: 'GET' }, { responder: () => respuestaHttp(null, 500) });
  assert.equal(r.res.statusCode, 502);
  assert.equal(r.res.headers['cache-control'], 'no-store', 'un error no queda cacheado en la CDN');
});
