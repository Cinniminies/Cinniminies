// POST /api/comprobante → adjunta el comprobante de transferencia a un pedido de la web.
// Lo llama cinniminies.js desde el panel "Pagá por transferencia", después de guardar el pedido.
const { configuracionLista, responderJson, metodoPermitido, leerCuerpoJson } = require('./_lib/supabase.js');
const { MAX_CUERPO, armarComprobante, guardarComprobante, ErrorComprobante } = require('./_lib/comprobante.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!metodoPermitido(req, res, ['POST'])) return;
  const conf = configuracionLista(res);
  if (!conf) return;
  try {
    let cuerpo;
    try {
      cuerpo = await leerCuerpoJson(req, { maximo: MAX_CUERPO, muyGrande: () => new ErrorComprobante('El archivo es muy grande (máximo 3 MB)') });
    } catch (e) {
      throw e instanceof ErrorComprobante ? e : new ErrorComprobante('Pedido inválido');
    }
    responderJson(res, 201, await guardarComprobante(armarComprobante(cuerpo), conf));
  } catch (e) {
    if (e instanceof ErrorComprobante) {
      responderJson(res, 400, { error: e.message });
      return;
    }
    console.error(e);
    responderJson(res, 502, { error: 'No se pudo guardar el comprobante' });
  }
};
