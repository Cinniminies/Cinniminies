// Descuento por recomendación.
// GET  /api/recomendacion → { activa, porcentaje?, tope?, hasta?, prueba }: si mostrar el campo del código.
//      Cacheado en la CDN como el catálogo (en modo prueba, no).
// POST /api/recomendacion { codigo, telefono? } → { estado, nombre?, porcentaje?, tope? } (ver consultar_codigo).
// Si falla, la web sigue sin el campo: el pedido nunca depende de esto.
const { configuracionLista, modoPrueba, responderJson, metodoPermitido, leerCuerpoJson } = require('./_lib/supabase.js');
const { ErrorRecomendacion, leerCampana, consultarCodigo } = require('./_lib/recomendacion.js');

const MAX_CUERPO = 1000; // un código y un celular

module.exports = async (req, res) => {
  const conf = configuracionLista(res);
  if (!conf) return;
  const prueba = modoPrueba();
  try {
    if (req.method === 'GET' || req.method === 'HEAD') {
      const campana = await leerCampana(prueba, conf);
      res.setHeader('Cache-Control', prueba ? 'no-store' : 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600');
      responderJson(res, 200, { ...campana, prueba });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    if (!metodoPermitido(req, res, ['GET', 'HEAD', 'POST'])) return;
    let cuerpo;
    try {
      cuerpo = await leerCuerpoJson(req, { maximo: MAX_CUERPO, muyGrande: () => new ErrorRecomendacion('Consulta inválida') });
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
