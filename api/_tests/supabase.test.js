// Pruebas de lo común de las funciones (api/_lib/supabase.js): node --test api/_tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const {
  URL_SUPABASE, configuracion, configuracionLista, responderJson, metodoPermitido, leerCuerpoJson, rpc,
  claveValida, cronAutorizado, fechaLocal, hashIp,
} = require('../_lib/supabase.js');
const { respuesta, respuestaHttp, supabaseFalso, conEntorno } = require('./_ayudas.js');

class ErrorCliente extends Error {}
const limite = { maximo: 50, muyGrande: () => new ErrorCliente('Muy grande') };
// Pedido sin req.body (fuera de Vercel): el cuerpo llega en partes.
const enPartes = (...partes) => Readable.from(partes);

test('responderJson: estado, tipo y cuerpo en JSON con tildes', () => {
  const res = respuesta();
  responderJson(res, 201, { codigo: 'CM-2026-ABCD', nota: 'sábado' });
  assert.equal(res.statusCode, 201);
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
  assert.deepEqual(JSON.parse(res.cuerpo), { codigo: 'CM-2026-ABCD', nota: 'sábado' });
});

test('metodoPermitido: sigue con un método de la lista sin tocar la respuesta', () => {
  const res = respuesta();
  assert.equal(metodoPermitido({ method: 'POST' }, res, ['POST']), true);
  assert.deepEqual(res.headers, {});
  assert.equal(res.cuerpo, '');
});

test('metodoPermitido: con otro método responde 405, Allow y el mensaje sin HEAD', () => {
  let res = respuesta();
  assert.equal(metodoPermitido({ method: 'DELETE' }, res, ['GET', 'HEAD']), false);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'GET, HEAD');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(res.cuerpo), { error: 'Solo GET' });

  res = respuesta();
  metodoPermitido({ method: 'PUT' }, res, ['GET', 'HEAD', 'POST']);
  assert.deepEqual(JSON.parse(res.cuerpo), { error: 'Solo GET o POST' });
  assert.equal(metodoPermitido({ method: 'post' }, respuesta(), ['POST']), false, 'el método va en mayúsculas');
});

test('configuracion: URL por defecto o la de SUPABASE_URL sin barras al final', async () => {
  await conEntorno({ env: { SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: 'eyJx' } }, () => {
    assert.deepEqual(configuracion(), { url: URL_SUPABASE, clave: 'eyJx' });
  });
  await conEntorno({ env: { SUPABASE_URL: 'http://127.0.0.1:54321//' } }, () => {
    assert.equal(configuracion().url, 'http://127.0.0.1:54321');
  });
});

test('configuracionLista: sin la clave de servicio responde 500 sin caché y devuelve null', async () => {
  await conEntorno({ env: { SUPABASE_SERVICE_ROLE_KEY: undefined } }, () => {
    const res = respuesta();
    assert.equal(configuracionLista(res), null);
    assert.equal(res.statusCode, 500);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.match(JSON.parse(res.cuerpo).error, /SUPABASE_SERVICE_ROLE_KEY/);
  });
  await conEntorno({ env: { SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x' } }, () => {
    const res = respuesta();
    assert.equal(configuracionLista(res).clave, 'sb_secret_x');
    assert.equal(res.cuerpo, '', 'con la clave no responde nada');
  });
});

test('leerCuerpoJson: el cuerpo que ya parseó Vercel, como objeto o como texto', async () => {
  const pedido = { cajas: [{ rolls: 6 }] };
  assert.equal(await leerCuerpoJson({ body: pedido }, limite), pedido);
  assert.deepEqual(await leerCuerpoJson({ body: '{"cajas":[]}' }, limite), { cajas: [] });
  assert.equal(await leerCuerpoJson({ body: null }, limite), null);
});

test('leerCuerpoJson: JSON inválido o vacío tira SyntaxError', async () => {
  await assert.rejects(leerCuerpoJson({ body: '{no es json' }, limite), SyntaxError);
  await assert.rejects(leerCuerpoJson({ body: '' }, limite), SyntaxError);
  await assert.rejects(leerCuerpoJson(enPartes('{"a":', ']'), limite), SyntaxError);
});

test('leerCuerpoJson: más grande que el máximo tira el error propio', async () => {
  const largo = 'x'.repeat(60);
  await assert.rejects(leerCuerpoJson({ body: { notas: largo } }, limite), ErrorCliente);
  await assert.rejects(leerCuerpoJson({ body: JSON.stringify({ notas: largo }) }, limite), ErrorCliente);
  await assert.rejects(leerCuerpoJson(enPartes('{"notas":"', largo, '"}'), limite), ErrorCliente);
  const justo = JSON.stringify({ n: 'x'.repeat(42) });
  assert.equal(justo.length, 50);
  assert.deepEqual(await leerCuerpoJson({ body: justo }, limite), { n: 'x'.repeat(42) }, 'justo en el máximo pasa');
});

test('leerCuerpoJson: fuera de Vercel junta las partes; sin cuerpo da null', async () => {
  assert.deepEqual(await leerCuerpoJson(enPartes('{"nombre":', '"Ana"}'), limite), { nombre: 'Ana' });
  assert.equal(await leerCuerpoJson(enPartes(), limite), null);
});

test('leerCuerpoJson: una letra con tilde partida entre dos pedazos llega entera', {
  todo: 'fuera de Vercel suma cada Buffer como texto por separado: una "ñ" partida entre dos pedazos llega como "��"',
}, async () => {
  const bytes = Buffer.from('{"nombre":"Ñandú"}');
  const corte = bytes.indexOf(0xc3) + 1; // en el medio de la Ñ
  assert.deepEqual(await leerCuerpoJson(enPartes(bytes.subarray(0, corte), bytes.subarray(corte)), limite),
    { nombre: 'Ñandú' });
});

test('rpc: POST a /rest/v1/rpc/<nombre> con los argumentos y la clave', async () => {
  const { conf, llamadas } = supabaseFalso(() => respuestaHttp({ codigo: 'CM-2026-ABCD' }));
  assert.deepEqual(await rpc('crear_pedido_web', { p: { nombre: 'Ana' } }, conf), { codigo: 'CM-2026-ABCD' });
  assert.deepEqual(llamadas,
    [{ url: 'https://x/rest/v1/rpc/crear_pedido_web', metodo: 'POST', cuerpo: { p: { nombre: 'Ana' } } }]);
});

test('rpc: los raise exception de la base llegan como ErrorCliente solo si se pide y traen mensaje', async () => {
  const conError = (cuerpo, status = 400) => supabaseFalso(() => respuestaHttp(cuerpo, status)).conf;
  const mensaje = { code: 'P0001', message: 'Demasiados pedidos seguidos' };
  const noEsDelCliente = (e) => !(e instanceof ErrorCliente);
  await assert.rejects(rpc('f', {}, conError(mensaje), { ErrorCliente }),
    (e) => e instanceof ErrorCliente && e.message === mensaje.message);
  await assert.rejects(rpc('f', {}, conError(mensaje)), (e) => noEsDelCliente(e) && /400 a f/.test(e.message));
  await assert.rejects(rpc('f', {}, conError({ code: 'P0001' }), { ErrorCliente }), noEsDelCliente);
  await assert.rejects(rpc('f', {}, conError({ code: '23505', message: 'duplicate key' }), { ErrorCliente }), noEsDelCliente);
  // Una página de error HTML en vez de JSON.
  const sinJson = { ok: false, status: 502, json: async () => JSON.parse('<html>') };
  await assert.rejects(rpc('f', {}, supabaseFalso(() => sinJson).conf, { ErrorCliente }), /Supabase respondió 502 a f: null/);
});

test('hashIp: estable, sin la IP en claro, solo la primera de x-forwarded-for', () => {
  const req = { headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } };
  assert.equal(hashIp(req, 's'), hashIp({ headers: { 'x-forwarded-for': '1.2.3.4' } }, 's'));
  assert.ok(!hashIp(req, 's').includes('1.2.3.4'));
  assert.equal(hashIp({ headers: {} }, 's'), null);
});

test('hashIp: la IP del socket si no hay x-forwarded-for, y la sal cambia el hash', () => {
  const porSocket = hashIp({ headers: {}, socket: { remoteAddress: '1.2.3.4' } }, 's');
  assert.equal(porSocket, hashIp({ headers: { 'x-forwarded-for': ' 1.2.3.4 ' } }, 's'));
  assert.match(porSocket, /^[0-9a-f]{32}$/);
  assert.notEqual(hashIp({ headers: { 'x-forwarded-for': '1.2.3.4' } }, 'otra'), porSocket);
  assert.notEqual(hashIp({ headers: { 'x-forwarded-for': '1.2.3.5' } }, 's'), porSocket);
});

test('fechaLocal: el día de Montevideo en los bordes de la medianoche', () => {
  assert.equal(fechaLocal(new Date('2026-10-04T02:00:00Z')), '2026-10-03');
  assert.equal(fechaLocal(new Date('2026-11-01T02:59:00Z')), '2026-10-31');
  assert.equal(fechaLocal(new Date('2026-11-01T03:00:00Z')), '2026-11-01');
  assert.equal(fechaLocal(new Date('2027-01-01T02:00:00Z')), '2026-12-31');
});

test('cronAutorizado: sin CRON_SECRET 500, con otra clave 401, con la buena sigue', async () => {
  await conEntorno({ env: { CRON_SECRET: undefined } }, () => {
    const res = respuesta();
    assert.equal(cronAutorizado({ headers: { authorization: 'Bearer ' } }, res), false);
    assert.equal(res.statusCode, 500);
  });
  await conEntorno({ env: { CRON_SECRET: 'secreto' } }, () => {
    let res = respuesta();
    assert.equal(cronAutorizado({ headers: { authorization: 'Bearer otro' } }, res), false);
    assert.equal(res.statusCode, 401);
    res = respuesta();
    assert.equal(cronAutorizado({ headers: {} }, res), false);
    assert.equal(res.statusCode, 401);
    res = respuesta();
    assert.equal(cronAutorizado({ headers: { authorization: 'Bearer secreto' } }, res), true);
    assert.equal(res.cuerpo, '');
  });
});

test('hashIp: sin sal no guarda nada', () => {
  assert.equal(hashIp({ headers: { 'x-forwarded-for': '1.2.3.4' } }, ''), null);
});

test('hashIp: una IPv6 cuenta por su red /64', () => {
  const de = (ip) => hashIp({ headers: { 'x-forwarded-for': ip } }, 's');
  assert.equal(de('2001:db8:1:2:aaaa::1'), de('2001:db8:1:2:bbbb:cccc:dddd:eeee'));
  assert.equal(de('2001:db8:1:2::'), de('2001:0db8:0001:0002::5'));
  assert.equal(de('2001:db8::1'), de('2001:db8:0:0:1::'));
  assert.notEqual(de('2001:db8:1:2::1'), de('2001:db8:1:3::1'));
  assert.equal(de('::ffff:1.2.3.4'), de('1.2.3.4'));
  assert.notEqual(de('1.2.3.4'), de('1.2.3.5'));
});

test('claveValida', () => {
  assert.equal(claveValida('abc', 'abc'), true);
  assert.equal(claveValida('abd', 'abc'), false);
  assert.equal(claveValida(undefined, 'abc'), false);
  assert.equal(claveValida('', ''), false);
  assert.equal(claveValida('abc', undefined), false);
});
