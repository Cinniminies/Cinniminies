// POST /api/pedidos → guarda un pedido de la web (estado "nuevo") y devuelve { codigo, total, cajas }.
// Lo llama cinniminies.js antes de mandar el mail y el WhatsApp. Si falla, la web sigue como antes.
const { configuracion, responderJson } = require('./_lib/supabase.js');
const { MAX_CUERPO, hashIp, armarPedido, guardarPedido, ErrorPedido } = require('./_lib/pedidos.js');

// Vercel ya parsea el JSON en req.body; en otros entornos se lee a mano.
async function leerCuerpo(req) {
  if (req.body !== undefined) {
    const texto = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (texto.length > MAX_CUERPO) throw new ErrorPedido('Pedido demasiado grande');
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  }
  let texto = '';
  for await (const parte of req) {
    texto += parte;
    if (texto.length > MAX_CUERPO) throw new ErrorPedido('Pedido demasiado grande');
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
      throw e instanceof ErrorPedido ? e : new ErrorPedido('Pedido inválido');
    }
    // Trampa para bots: un campo oculto que una persona nunca completa. Se responde como si nada.
    if (cuerpo && typeof cuerpo.sitio_web === 'string' && cuerpo.sitio_web.trim()) {
      responderJson(res, 200, { codigo: null, ignorado: true });
      return;
    }
    const guardado = await guardarPedido(armarPedido(cuerpo), hashIp(req), conf);
    responderJson(res, 201, guardado);
  } catch (e) {
    if (e instanceof ErrorPedido) {
      responderJson(res, e.message.startsWith('Demasiados pedidos') ? 429 : 400, { error: e.message });
      return;
    }
    console.error(e);
    responderJson(res, 502, { error: 'No se pudo guardar el pedido' });
  }
};
