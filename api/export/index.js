// GET /api/export → lista de vistas disponibles. Header obligatorio: x-export-key.
const { autorizar, listarVistas, responderJson } = require('../_lib/export.js');

module.exports = async (req, res) => {
  if (!autorizar(req, res)) return;
  responderJson(res, 200, { vistas: listarVistas() });
};
