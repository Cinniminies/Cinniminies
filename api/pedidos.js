// POST /api/pedidos → guarda un pedido de la web (estado "nuevo") y devuelve { codigo, total, cajas }.
// Lo llama cinniminies.js antes de mandar el mail y el WhatsApp. Si falla, la web sigue como antes.
const { configuracionLista, modoPrueba, responderJson, metodoPermitido, leerCuerpoJson, hashIp } = require('./_lib/supabase.js');
const { MAX_CUERPO, armarPedido, guardarPedido, ErrorPedido } = require('./_lib/pedidos.js');
const { configuracionPush, avisarPedidoNuevo } = require('./_lib/push.js');

// Aviso push a los celulares de los dueños (fase 2 · 2.1), después de responderle al cliente.
// waitUntil le pide a Vercel que no corte la función hasta que termine; fuera de Vercel no hace falta.
function avisar(pedido, guardado, conf) {
  const vapid = configuracionPush();
  if (!vapid) return;
  let tarea;
  try {
    tarea = avisarPedidoNuevo(pedido, guardado, conf, require('web-push'), vapid);
  } catch (e) {
    console.error('Aviso push:', e.message); // sin web-push instalado (npm install) no hay avisos
    return;
  }
  try { require('@vercel/functions').waitUntil(tarea); } catch { /* fuera de Vercel la tarea sigue sola */ }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!metodoPermitido(req, res, ['POST'])) return;
  const conf = configuracionLista(res);
  if (!conf) return;
  try {
    let cuerpo;
    try {
      cuerpo = await leerCuerpoJson(req, { maximo: MAX_CUERPO, muyGrande: () => new ErrorPedido('Pedido demasiado grande') });
    } catch (e) {
      throw e instanceof ErrorPedido ? e : new ErrorPedido('Pedido inválido');
    }
    // Trampa para bots: un campo oculto que una persona nunca completa. Se responde como si nada.
    if (cuerpo && typeof cuerpo.sitio_web === 'string' && cuerpo.sitio_web.trim()) {
      responderJson(res, 200, { codigo: null, ignorado: true });
      return;
    }
    const pedido = armarPedido(cuerpo);
    // En modo prueba (servidor local) el pedido queda marcado y no se avisa a los celulares de los dueños.
    const prueba = modoPrueba();
    const guardado = await guardarPedido(prueba ? { ...pedido, prueba: true } : pedido, hashIp(req), conf);
    responderJson(res, 201, guardado);
    if (!prueba) avisar(pedido, guardado, conf);
  } catch (e) {
    if (e instanceof ErrorPedido) {
      responderJson(res, e.message.startsWith('Demasiados pedidos') ? 429 : 400, { error: e.message });
      return;
    }
    console.error(e);
    responderJson(res, 502, { error: 'No se pudo guardar el pedido' });
  }
};
