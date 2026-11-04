// Pruebas del export: node --test api/_tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  VISTAS, TAMANO_PAGINA, claveValida, urlPagina, encabezados, leerVista, armarTabla, aCsv, autorizar,
} = require('../_lib/export.js');
const { respuesta, respuestaHttp, conEntorno, correrHandler } = require('./_ayudas.js');
const handler = require('../export/[vista].js');

test('las vistas del handoff están todas', () => {
  for (const v of ['ventas', 'ventas_sabores', 'costos', 'stock', 'resumen_mensual', 'gastos',
    'compras', 'tandas', 'ingresos']) {
    assert.ok(VISTAS[v], v);
  }
});

test('claveValida', () => {
  assert.equal(claveValida('abc', 'abc'), true);
  assert.equal(claveValida('abd', 'abc'), false);
  assert.equal(claveValida(undefined, 'abc'), false);
  assert.equal(claveValida('', ''), false);
  assert.equal(claveValida('abc', undefined), false);
});

test('urlPagina: columnas, orden y página', () => {
  const u = new URL(urlPagina('https://x.supabase.co/', 'gastos', 2000));
  assert.equal(u.pathname, '/rest/v1/v_gastos');
  assert.ok(u.searchParams.get('select').startsWith('fecha,mes,tipo'));
  assert.equal(u.searchParams.get('order'), 'fecha.asc.nullsfirst,creado_en.asc.nullsfirst,id.asc.nullsfirst');
  assert.equal(u.searchParams.get('offset'), '2000');
  assert.equal(u.searchParams.get('limit'), String(TAMANO_PAGINA));
  // Sin columna única ordena por todas.
  const s = new URL(urlPagina('https://x.supabase.co', 'ventas_sabores', 0));
  assert.equal(s.searchParams.get('order').split(',').length, VISTAS.ventas_sabores.columnas.length);
});

test('encabezados: JWT viejo va también como Bearer; sb_secret solo en apikey', () => {
  assert.equal(encabezados('eyJabc').Authorization, 'Bearer eyJabc');
  assert.equal(encabezados('sb_secret_x').Authorization, undefined);
  assert.equal(encabezados('sb_secret_x').apikey, 'sb_secret_x');
});

test('leerVista pagina hasta que una página viene incompleta', async () => {
  const pedidos = [];
  const falso = async (url) => {
    pedidos.push(new URL(url).searchParams.get('offset'));
    const n = pedidos.length < 3 ? TAMANO_PAGINA : 5;
    return { ok: true, json: async () => Array.from({ length: n }, () => ({ mes: '2026-09-01' })) };
  };
  const filas = await leerVista('resumen_mensual', { url: 'https://x', clave: 'k', fetch: falso });
  assert.deepEqual(pedidos, ['0', '1000', '2000']);
  assert.equal(filas.length, 2 * TAMANO_PAGINA + 5);
});

test('leerVista informa el error de Supabase', async () => {
  const falso = async () => ({ ok: false, status: 401, text: async () => 'JWT inválido' });
  await assert.rejects(leerVista('stock', { url: 'https://x', clave: 'k', fetch: falso }), /401.*v_stock/);
});

test('armarTabla respeta el orden de columnas y pasa números', () => {
  const t = armarTabla('gastos', [{ monto: '12.50', fecha: '2026-09-01', tipo: 'comision', otra: 1 }],
    new Date('2026-09-25T12:00:00Z'));
  assert.equal(t.generado, '2026-09-25T12:00:00.000Z');
  assert.deepEqual(t.columnas[0], { nombre: 'fecha', tipo: 'fecha' });
  assert.deepEqual(t.filas[0].slice(0, 6), ['2026-09-01', null, 'comision', null, 12.5, null]);
  assert.equal(t.filas[0].length, VISTAS.gastos.columnas.length);
});

test('aCsv escapa comillas, comas y saltos', () => {
  const csv = aCsv({ columnas: [{ nombre: 'a' }, { nombre: 'b' }], filas: [['x, y', 'dijo "hola"\n'], [null, 3]] });
  assert.equal(csv, 'a,b\r\n"x, y","dijo ""hola""\n"\r\n,3\r\n');
});

test('armarTabla: números y dinero desde texto; fechas, booleanos y vacíos tal cual', () => {
  const t = armarTabla('costos',
    [{ nombre: 'Canela', activo: false, rolls_por_tanda: '12', costo_roll: 18.5, precio_unidad: undefined }]);
  assert.deepEqual(t.filas[0], ['Canela', false, null, 12, null, 18.5, null, null]);
});

test('aCsv: un retorno de carro solo también va entre comillas', () => {
  assert.equal(aCsv({ columnas: [{ nombre: 'notas' }], filas: [['a\rb'], [0]] }), 'notas\r\n"a\rb"\r\n0\r\n');
});

const ENTORNO = { EXPORT_KEY: 'secreta', SUPABASE_SERVICE_ROLE_KEY: 'eyJx' };
const CLAVE = { 'x-export-key': 'secreta' };

test('autorizar: sin variables, sin clave, clave mala, método', async () => {
  await conEntorno({ env: { EXPORT_KEY: undefined } }, () => {
    const res = respuesta();
    assert.equal(autorizar({ method: 'GET', headers: {} }, res), null);
    assert.equal(res.statusCode, 500);
  });

  await conEntorno({ env: ENTORNO }, () => {
    let res = respuesta();
    assert.equal(autorizar({ method: 'GET', headers: {} }, res), null);
    assert.equal(res.statusCode, 401);

    res = respuesta();
    assert.equal(autorizar({ method: 'GET', headers: { 'x-export-key': 'otra' } }, res), null);
    assert.equal(res.statusCode, 401);

    res = respuesta();
    assert.equal(autorizar({ method: 'POST', headers: CLAVE }, res), null);
    assert.equal(res.statusCode, 405);

    res = respuesta();
    const conf = autorizar({ method: 'GET', headers: CLAVE }, res);
    assert.equal(conf.clave, 'eyJx');
    assert.match(conf.url, /^https:\/\/.+\.supabase\.co$/);
    assert.equal(res.headers['cache-control'], 'no-store');
  });
});

// Una página corta de v_gastos (con una coma en la descripción, para ver el CSV).
const gastos = () => respuestaHttp([{ fecha: '2026-10-31', tipo: 'mejora', descripcion: 'Bandejas, 2', monto: '540' }]);
const exportar = (vista, { query = {}, responder = gastos } = {}) =>
  correrHandler(handler, { method: 'GET', headers: CLAVE, query: { vista, ...query } }, { env: ENTORNO, responder });

test('handler: vista desconocida da 404', async () => {
  const { res, cuerpo } = await exportar('clientes');
  assert.equal(res.statusCode, 404);
  assert.match(cuerpo.error, /Vista desconocida/);
  assert.ok(cuerpo.vistas.includes('ventas'));
  assert.equal((await exportar('toString')).res.statusCode, 404, 'una propiedad heredada no es una vista');
});

test('handler: la vista en JSON con sus columnas y números', async () => {
  const { res, cuerpo, llamadas } = await exportar('gastos');
  assert.equal(res.statusCode, 200);
  assert.equal(cuerpo.vista, 'gastos');
  assert.equal(cuerpo.filas[0][VISTAS.gastos.columnas.findIndex(([c]) => c === 'monto')], 540);
  assert.equal(new URL(llamadas[0].url).pathname, '/rest/v1/v_gastos');
});

test('handler: CSV con ?formato=csv o con la vista terminada en .csv', async () => {
  for (const pedido of [exportar('gastos', { query: { formato: 'csv' } }), exportar('gastos.csv')]) {
    const { res, cuerpo } = await pedido;
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'text/csv; charset=utf-8');
    assert.equal(res.headers['content-disposition'], 'inline; filename="gastos.csv"');
    assert.ok(cuerpo.startsWith('fecha,mes,tipo,descripcion,monto'));
    assert.match(cuerpo, /\r\n2026-10-31,,mejora,"Bandejas, 2",540,/);
  }
  assert.equal((await exportar('gastos.json')).res.headers['content-type'], 'application/json; charset=utf-8');
});

test('handler: si la base falla responde 502 con el detalle (es un endpoint privado)', async () => {
  const { res, cuerpo } = await exportar('gastos', { responder: () => respuestaHttp('sin permiso', 401) });
  assert.equal(res.statusCode, 502);
  assert.match(cuerpo.detalle, /401 al leer v_gastos/);
});

test('/api/export: lista las vistas con su título, solo con la clave', async () => {
  const lista = require('../export/index.js');
  const { cuerpo } = await correrHandler(lista, { method: 'GET', headers: CLAVE }, { env: ENTORNO });
  assert.deepEqual(cuerpo.vistas.map((v) => v.nombre), Object.keys(VISTAS));
  assert.equal(cuerpo.vistas[0].titulo, VISTAS.ventas.titulo);
  assert.equal((await correrHandler(lista, { method: 'GET', headers: {} }, { env: ENTORNO })).res.statusCode, 401);
});

