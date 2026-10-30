// POST /api/visita → guarda un paso de una visita a la web (idea 6.2). Lo manda cinniminies.js con sendBeacon, que
// no espera respuesta: siempre se contesta 204, aunque se ignore (bots, modo prueba, forma inválida o un error).
const { configuracionLista, modoPrueba, metodoPermitido, leerCuerpoJson, hashIp } = require('./_lib/supabase.js');
const { MAX_CUERPO, esBot, armarVisita, guardarVisita } = require('./_lib/visitas.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!metodoPermitido(req, res, ['POST'])) return;
  const conf = configuracionLista(res);
  if (!conf) return;
  try {
    const visita = armarVisita(await leerCuerpoJson(req, { maximo: MAX_CUERPO, muyGrande: () => new Error('Muy grande') }));
    // En el servidor local (modo prueba) no se cuenta: serían las visitas de los dueños probando
    if (visita && !modoPrueba() && !esBot(req.headers['user-agent'])) await guardarVisita(visita, hashIp(req), conf);
  } catch (e) {
    console.error('Visita:', e.message);
  }
  res.statusCode = 204;
  res.end();
};
