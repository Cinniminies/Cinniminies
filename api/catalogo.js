// GET /api/catalogo → sabores y formatos visibles en la web, con precios vigentes.
// Público y cacheado en la CDN de Vercel unos minutos: un cambio en /admin tarda hasta 5 min
// en verse. Si falla, la web usa los valores que trae escritos (cinniminies.js e index.html).
const { configuracionLista, modoPrueba, responderJson, metodoPermitido } = require('./_lib/supabase.js');
const { leerCatalogo } = require('./_lib/catalogo.js');

module.exports = async (req, res) => {
  if (!metodoPermitido(req, res, ['GET', 'HEAD'])) return;
  const conf = configuracionLista(res);
  if (!conf) return;
  try {
    const catalogo = await leerCatalogo({ ...conf, prueba: modoPrueba() });
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400');
    responderJson(res, 200, { generado: new Date().toISOString(), ...catalogo });
  } catch (e) {
    console.error(e);
    res.setHeader('Cache-Control', 'no-store');
    responderJson(res, 502, { error: 'No se pudo leer el catálogo' });
  }
};
