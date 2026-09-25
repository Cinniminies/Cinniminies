// Catálogo público para la web (Etapa 5): sale de la función catalogo_web() de la base.
const { encabezados } = require('./supabase.js');

async function leerCatalogo({ url, clave, fetch: pedir = fetch }) {
  const r = await pedir(`${url}/rest/v1/rpc/catalogo_web`, {
    method: 'POST',
    headers: { ...encabezados(clave), 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!r.ok) {
    const detalle = await r.text().catch(() => '');
    throw new Error(`Supabase respondió ${r.status} a catalogo_web: ${detalle.slice(0, 300)}`);
  }
  return limpiar(await r.json());
}

const num = (x) => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
const txt = (x) => (typeof x === 'string' && x.trim() ? x.trim() : null);
// Solo rutas del sitio (img/…) o URLs https: la web la pone en un <img>.
const foto = (x) => {
  const f = txt(x);
  return f && (/^\/?img\/[\w./-]+$/.test(f) || /^https:\/\/[^\s"'<>]+$/.test(f)) ? f : null;
};

// Deja solo los campos que usa la web, con los tipos correctos.
function limpiar(c) {
  return {
    sabores: (c?.sabores || []).filter((s) => txt(s.id)).map((s) => ({
      id: txt(s.id),
      nombre: txt(s.nombre) || txt(s.id),
      descripcion: txt(s.descripcion),
      etiqueta: txt(s.etiqueta),
      foto: foto(s.foto),
      precio_unidad: num(s.precio_unidad),
    })),
    formatos: (c?.formatos || []).map((f) => ({
      nombre: txt(f.nombre),
      tipo: f.tipo,
      rolls: num(f.rolls),
      min_rolls: num(f.min_rolls),
      max_rolls: num(f.max_rolls),
      precio: num(f.precio),
    })),
  };
}

module.exports = { leerCatalogo, limpiar };
