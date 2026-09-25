// GET /api/export/<vista>[?formato=csv] → filas de una vista de reporte, leídas con la
// service key del lado del servidor. Header obligatorio: x-export-key.
const {
  VISTAS, autorizar, leerVista, armarTabla, aCsv, responderJson,
} = require('../_lib/export.js');

module.exports = async (req, res) => {
  const conf = autorizar(req, res);
  if (!conf) return;

  const vista = String(req.query.vista || '').replace(/\.(json|csv)$/, '');
  if (!Object.hasOwn(VISTAS, vista)) {
    responderJson(res, 404, { error: `Vista desconocida: ${vista}`, vistas: Object.keys(VISTAS) });
    return;
  }

  let tabla;
  try {
    tabla = armarTabla(vista, await leerVista(vista, conf));
  } catch (e) {
    console.error(e);
    responderJson(res, 502, { error: 'No se pudo leer la base', detalle: e.message });
    return;
  }

  const csv = req.query.formato === 'csv' || String(req.query.vista).endsWith('.csv');
  if (csv) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${vista}.csv"`);
    res.end(aCsv(tabla));
    return;
  }
  responderJson(res, 200, tabla);
};
