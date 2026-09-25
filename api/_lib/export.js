// Export de las vistas de reporte para el Google Sheet de análisis (Etapa 4).
// Lo usan api/export/index.js y api/export/[vista].js. La carpeta empieza con "_"
// para que Vercel no la publique como función.
//
// Cada vista declara sus columnas con un tipo; el Apps Script del Sheet usa ese tipo
// para dar formato (fechas, $), así agregar una columna no obliga a tocar el script.

const crypto = require('node:crypto');
const { configuracion, encabezados, responderJson } = require('./supabase.js');

// Tipos: texto, fecha (AAAA-MM-DD), mes (primer día del mes), fechahora (ISO),
// dinero, numero, bool.
const VISTAS = {
  ventas: {
    tabla: 'v_ventas',
    titulo: 'Ventas (una fila por venta)',
    columnas: [
      ['id', 'texto'], ['fecha', 'fecha'], ['mes', 'mes'], ['cliente', 'texto'],
      ['origen', 'texto'], ['tipo', 'texto'], ['entrega', 'texto'], ['medio_pago', 'texto'],
      ['estado_pago', 'texto'], ['formatos', 'texto'], ['sabores', 'texto'], ['rolls', 'numero'],
      ['precio_lista', 'dinero'], ['precio_cobrado', 'dinero'], ['descuento', 'dinero'],
      ['cobro_envio', 'dinero'], ['total', 'dinero'], ['costo_produccion', 'dinero'],
      ['costo_caja', 'dinero'], ['ganancia', 'dinero'], ['notas', 'texto'],
      ['creado_en', 'fechahora'],
    ],
    orden: ['fecha', 'creado_en', 'id'],
  },
  ventas_sabores: {
    tabla: 'v_ventas_sabores',
    titulo: 'Ventas por sabor (ingreso prorrateado por unidades)',
    columnas: [
      ['venta_id', 'texto'], ['fecha', 'fecha'], ['mes', 'mes'], ['tipo', 'texto'],
      ['estado_pago', 'texto'], ['formato', 'texto'], ['sabor', 'texto'], ['unidades', 'numero'],
      ['ingreso', 'dinero'], ['costo', 'dinero'], ['costo_unitario', 'dinero'],
    ],
    // Sin columna única: se ordena por todas para que la paginación no repita ni saltee filas.
    orden: null,
  },
  costos: {
    tabla: 'v_costo_sabor',
    titulo: 'Costo y margen por sabor (precios de hoy)',
    columnas: [
      ['nombre', 'texto'], ['activo', 'bool'], ['visible_web', 'bool'],
      ['rolls_por_tanda', 'numero'], ['costo_tanda', 'dinero'], ['costo_roll', 'dinero'],
      ['precio_unidad', 'dinero'], ['margen_unidad', 'dinero'],
    ],
    orden: ['nombre', 'sabor_id'],
  },
  margenes: {
    tabla: 'v_margen_formato',
    titulo: 'Margen por formato y sabor (precios de hoy)',
    columnas: [
      ['formato', 'texto'], ['sabor', 'texto'], ['precio', 'dinero'], ['costo_rolls', 'dinero'],
      ['costo_caja', 'dinero'], ['margen', 'dinero'],
    ],
    orden: ['formato', 'sabor', 'formato_id', 'sabor_id'],
  },
  stock: {
    tabla: 'v_stock',
    titulo: 'Stock teórico por insumo',
    columnas: [
      ['nombre', 'texto'], ['tipo', 'texto'], ['unidad_base', 'texto'],
      ['fecha_conteo', 'fecha'], ['conteo', 'numero'], ['comprado', 'numero'],
      ['usado_tandas', 'numero'], ['usado_ventas', 'numero'], ['teorico', 'numero'],
      ['stock_minimo', 'numero'], ['costo_unitario', 'dinero'], ['reponer', 'bool'],
      ['valor', 'dinero'],
    ],
    orden: ['nombre', 'insumo_id'],
  },
  resumen_mensual: {
    tabla: 'v_resumen_mensual',
    titulo: 'Resumen por mes',
    columnas: [
      ['mes', 'mes'], ['ventas', 'numero'], ['rolls_vendidos', 'numero'], ['vendido', 'dinero'],
      ['cobrado', 'dinero'], ['pendiente', 'dinero'], ['costo_produccion', 'dinero'],
      ['costo_caja', 'dinero'], ['ganancia_bruta', 'dinero'], ['compras', 'dinero'],
      ['gastos', 'dinero'], ['total_gastado', 'dinero'], ['retiros', 'dinero'],
      ['ajustes_caja', 'dinero'], ['resultado', 'dinero'],
    ],
    orden: ['mes'],
  },
  gastos: {
    tabla: 'v_gastos',
    titulo: 'Gastos y retiros',
    columnas: [
      ['fecha', 'fecha'], ['mes', 'mes'], ['tipo', 'texto'], ['descripcion', 'texto'],
      ['monto', 'dinero'], ['es_gasto', 'bool'], ['rolls', 'numero'], ['notas', 'texto'],
      ['creado_en', 'fechahora'],
    ],
    orden: ['fecha', 'creado_en', 'id'],
  },
  compras: {
    tabla: 'v_compras',
    titulo: 'Compras',
    columnas: [
      ['fecha', 'fecha'], ['mes', 'mes'], ['categoria', 'texto'], ['insumo', 'texto'],
      ['descripcion', 'texto'], ['proveedor', 'texto'], ['cantidad', 'numero'],
      ['unidad', 'texto'], ['cantidad_base', 'numero'], ['unidad_base', 'texto'],
      ['total', 'dinero'], ['costo_unitario', 'dinero'], ['notas', 'texto'],
      ['creado_en', 'fechahora'],
    ],
    orden: ['fecha', 'creado_en', 'id'],
  },
  tandas: {
    tabla: 'v_tandas',
    titulo: 'Tandas (costo estimado con los precios de su fecha)',
    columnas: [
      ['fecha', 'fecha'], ['mes', 'mes'], ['sabor', 'texto'], ['tandas', 'numero'],
      ['rolls', 'numero'], ['costo', 'dinero'], ['costo_roll', 'dinero'], ['notas', 'texto'],
      ['creado_en', 'fechahora'],
    ],
    orden: ['fecha', 'creado_en', 'id'],
  },
};

const TAMANO_PAGINA = 1000; // el máximo que devuelve la API de Supabase por pedido

// Compara la clave recibida con la esperada sin filtrar por tiempo cuántos caracteres coinciden.
function claveValida(recibida, esperada) {
  if (typeof recibida !== 'string' || !recibida || !esperada) return false;
  const a = crypto.createHash('sha256').update(recibida).digest();
  const b = crypto.createHash('sha256').update(esperada).digest();
  return crypto.timingSafeEqual(a, b);
}

function listarVistas() {
  return Object.entries(VISTAS).map(([nombre, v]) => ({ nombre, titulo: v.titulo }));
}

// URL de PostgREST para una página de la vista.
function urlPagina(base, vista, desde) {
  const v = VISTAS[vista];
  const orden = v.orden || v.columnas.map(([c]) => c);
  const params = new URLSearchParams({
    select: v.columnas.map(([c]) => c).join(','),
    order: orden.map((c) => `${c}.asc.nullsfirst`).join(','),
    offset: String(desde),
    limit: String(TAMANO_PAGINA),
  });
  return `${base.replace(/\/+$/, '')}/rest/v1/${v.tabla}?${params}`;
}

// Trae todas las filas de la vista, página por página.
async function leerVista(vista, { url, clave, fetch: pedir = fetch }) {
  const filas = [];
  for (let desde = 0; ; desde += TAMANO_PAGINA) {
    const r = await pedir(urlPagina(url, vista, desde), { headers: encabezados(clave) });
    if (!r.ok) {
      const detalle = await r.text().catch(() => '');
      throw new Error(`Supabase respondió ${r.status} al leer ${VISTAS[vista].tabla}: ${detalle.slice(0, 300)}`);
    }
    const pagina = await r.json();
    filas.push(...pagina);
    if (pagina.length < TAMANO_PAGINA) return filas;
  }
}

function valor(v, tipo) {
  if (v === null || v === undefined) return null;
  if (tipo === 'dinero' || tipo === 'numero') return typeof v === 'number' ? v : Number(v);
  return v;
}

// { vista, titulo, generado, columnas: [{ nombre, tipo }], filas: [[…], …] }
function armarTabla(vista, objetos, generado = new Date()) {
  const v = VISTAS[vista];
  return {
    vista,
    titulo: v.titulo,
    generado: generado.toISOString(),
    columnas: v.columnas.map(([nombre, tipo]) => ({ nombre, tipo })),
    filas: objetos.map((o) => v.columnas.map(([c, tipo]) => valor(o[c], tipo))),
  };
}

function aCsv(tabla) {
  const celda = (x) => {
    if (x === null || x === undefined) return '';
    const s = String(x);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = [tabla.columnas.map((c) => celda(c.nombre)).join(',')];
  for (const f of tabla.filas) lineas.push(f.map(celda).join(','));
  return lineas.join('\r\n') + '\r\n';
}

// Controles comunes a los dos endpoints. Devuelve la configuración o responde el error.
function autorizar(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    responderJson(res, 405, { error: 'Solo GET' });
    return null;
  }
  const esperada = process.env.EXPORT_KEY;
  const { url, clave } = configuracion();
  if (!esperada || !url || !clave) {
    responderJson(res, 500, {
      error: 'Faltan variables de entorno en Vercel (EXPORT_KEY o SUPABASE_SERVICE_ROLE_KEY)',
    });
    return null;
  }
  if (!claveValida(req.headers['x-export-key'], esperada)) {
    responderJson(res, 401, { error: 'Clave de export inválida' });
    return null;
  }
  return { url, clave };
}

module.exports = {
  VISTAS, TAMANO_PAGINA, claveValida, listarVistas, urlPagina, encabezados, leerVista,
  armarTabla, aCsv, autorizar, responderJson,
};
