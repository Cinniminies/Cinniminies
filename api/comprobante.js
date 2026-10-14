// POST /api/comprobante → adjunta el comprobante de transferencia a un pedido de la web.
// Lo llama cinniminies.js desde el panel "Pagá por transferencia", después de guardar el pedido.
const { configuracion, responderJson } = require('./_lib/supabase.js');
const { MAX_CUERPO, armarComprobante, guardarComprobante, ErrorComprobante } = require('./_lib/comprobante.js');

// Vercel ya parsea el JSON en req.body; en otros entornos se lee a mano.
async function leerCuerpo(req) {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
      if (req.body.length > MAX_CUERPO) throw new ErrorComprobante('El archivo es muy grande (máximo 3 MB)');
      return JSON.parse(req.body);
    }
    return req.body;
  }
  let texto = '';
  for await (const parte of req) {
    texto += parte;
    if (texto.length > MAX_CUERPO) throw new ErrorComprobante('El archivo es muy grande (máximo 3 MB)');
  }
  return JSON.parse(texto || 'null');
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    responderJson(res, 405, { error: 'Solo POST' });
    return;
  }
  const conf = configuracion();
  if (!conf.clave) {
    responderJson(res, 500, { error: 'Falta SUPABASE_SERVICE_ROLE_KEY en Vercel' });
    return;
  }
  try {
    let cuerpo;
    try {
      cuerpo = await leerCuerpo(req);
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
