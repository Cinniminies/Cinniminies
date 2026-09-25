// Pruebas del export: node --test api/_tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  VISTAS, TAMANO_PAGINA, claveValida, urlPagina, encabezados, leerVista, armarTabla, aCsv, autorizar,
} = require('../_lib/export.js');
const handler = require('../export/[vista].js');

test('las vistas del handoff están todas', () => {
  for (const v of ['ventas', 'ventas_sabores', 'costos', 'stock', 'resumen_mensual', 'gastos',
    'compras', 'tandas']) {
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

// Respuesta falsa al estilo de Vercel/Node.
function respuesta() {
  return {
    statusCode: 200, headers: {}, cuerpo: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(c) { this.cuerpo = c; },
  };
}

test('autorizar: sin variables, sin clave, clave mala, método', () => {
  const env = { ...process.env };
  try {
    delete process.env.EXPORT_KEY;
    let res = respuesta();
    assert.equal(autorizar({ method: 'GET', headers: {} }, res), null);
    assert.equal(res.statusCode, 500);

    process.env.EXPORT_KEY = 'secreta';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJx';
    res = respuesta();
    assert.equal(autorizar({ method: 'GET', headers: {} }, res), null);
    assert.equal(res.statusCode, 401);

    res = respuesta();
    assert.equal(autorizar({ method: 'GET', headers: { 'x-export-key': 'otra' } }, res), null);
    assert.equal(res.statusCode, 401);

    res = respuesta();
    assert.equal(autorizar({ method: 'POST', headers: { 'x-export-key': 'secreta' } }, res), null);
    assert.equal(res.statusCode, 405);

    res = respuesta();
    const conf = autorizar({ method: 'GET', headers: { 'x-export-key': 'secreta' } }, res);
    assert.equal(conf.clave, 'eyJx');
    assert.match(conf.url, /^https:\/\/.+\.supabase\.co$/);
    assert.equal(res.headers['cache-control'], 'no-store');
  } finally {
    process.env = env;
  }
});

test('handler: vista desconocida da 404', async () => {
  const env = { ...process.env };
  try {
    process.env.EXPORT_KEY = 'secreta';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJx';
    const res = respuesta();
    await handler({ method: 'GET', headers: { 'x-export-key': 'secreta' }, query: { vista: 'clientes' } }, res);
    assert.equal(res.statusCode, 404);
    assert.match(res.cuerpo, /Vista desconocida/);
  } finally {
    process.env = env;
  }
});
