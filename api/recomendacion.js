// Descuento por recomendación.
// GET  /api/recomendacion → { activa, porcentaje?, tope?, hasta?, prueba }: si mostrar el campo del código.
//      Cacheado en la CDN como el catálogo (en modo prueba, no).
// POST /api/recomendacion { codigo, telefono? } → { estado, nombre?, porcentaje?, tope? } (ver consultar_codigo).
// Si falla, la web sigue sin el campo: el pedido nunca depende de esto.
const { configuracion, modoPrueba, responderJson } = require('./_lib/supabase.js');
const { ErrorRecomendacion, leerCampana, consultarCodigo } = require('./_lib/recomendacion.js');

async function leerCuerpo(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  let texto = '';
  for await (const parte of req) {
    texto += parte;
    if (texto.length > 1000) throw new ErrorRecomendacion('Consulta inválida');
  }
  return JSON.parse(texto || 'null');
}

module.exports = async (req, res) => {
  const conf = configuracion();
  const prueba = modoPrueba();
  if (!conf.clave) {
    res.setHeader('Cache-Control', 'no-store');
    responderJson(res, 500, { error: 'Falta SUPABASE_SERVICE_ROLE_KEY en Vercel' });
    return;
  }
  try {
    if (req.method === 'GET' || req.method === 'HEAD') {
      const campana = await leerCampana(prueba, conf);
      res.setHeader('Cache-Control', prueba ? 'no-store' : 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600');
      responderJson(res, 200, { ...campana, prueba });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, HEAD, POST');
      responderJson(res, 405, { error: 'Solo GET o POST' });
      return;
    }
    let cuerpo;
    try {
      cuerpo = await leerCuerpo(req);
    } catch {
      throw new ErrorRecomendacion('Consulta inválida');
    }
    responderJson(res, 200, await consultarCodigo(cuerpo, prueba, conf));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    if (e instanceof ErrorRecomendacion) {
      responderJson(res, 400, { error: e.message });
      return;
    }
    console.error(e);
    responderJson(res, 502, { error: 'No se pudo consultar el código' });
  }
};
