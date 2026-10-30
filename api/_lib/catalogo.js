// Catálogo público para la web (Etapa 5): sale de la función catalogo_web() de la base.
const { rpc } = require('./supabase.js');

// prueba: el servidor local en modo prueba ve las promos del usuario de prueba (nunca Vercel).
async function leerCatalogo({ prueba = false, ...conf }) {
  return limpiar(await rpc('catalogo_web', prueba ? { p_prueba: true } : {}, conf));
}

const num = (x) => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
const esFecha = (x) => /^\d{4}-\d{2}-\d{2}$/.test(x);
const txt = (x) => (typeof x === 'string' && x.trim() ? x.trim() : null);
// Solo rutas del sitio (img/…) o URLs https: la web la pone en un <img>.
const foto = (x) => {
  const f = txt(x);
  return f && (/^\/?img\/[\w./-]+$/.test(f) || /^https:\/\/[^\s"'<>]+$/.test(f)) ? f : null;
};

// Textos e imágenes editables (Etapa 7): { clave: texto }. Solo claves "seccion.nombre" y textos cortos;
// la web los escapa antes de mostrarlos.
function limpiarContenido(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return {};
  return Object.fromEntries(Object.entries(c)
    .filter(([k, v]) => /^[a-z]+\.[a-z_]+$/.test(k) && typeof v === 'string' && v.length <= 1000));
}

// Promos de hoy (/admin → Promociones). formatos y sabores vacíos = todos.
function limpiarPromos(lista) {
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((p) => (p?.tipo === 'porcentaje' || p?.tipo === 'monto') && num(p.valor) > 0)
    .map((p) => ({
      nombre: txt(p.nombre) || 'Promo',
      tipo: p.tipo,
      valor: num(p.valor),
      texto: txt(p.texto),
      hasta: esFecha(p.hasta) ? p.hasta : null,
      formatos: (Array.isArray(p.formatos) ? p.formatos : [])
        .filter((f) => f && typeof f.tipo === 'string').map((f) => ({ tipo: f.tipo, rolls: num(f.rolls) })),
      sabores: (Array.isArray(p.sabores) ? p.sabores : []).filter((x) => txt(x)),
    }));
}

// Para qué sábado es el pedido: { sabado: '2026-10-31', cierre: '2026-10-29T23:59', motivo: null | 'cierre' | 'sin_horneado' }.
function limpiarPedidos(p) {
  if (!esFecha(p?.sabado) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(p?.cierre)) return null;
  return { sabado: p.sabado, cierre: p.cierre, motivo: ['cierre', 'sin_horneado'].includes(p.motivo) ? p.motivo : null };
}

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
    contenido: limpiarContenido(c?.contenido),
    envio: num(c?.envio),
    formatos: (c?.formatos || []).map((f) => ({
      nombre: txt(f.nombre),
      tipo: f.tipo,
      rolls: num(f.rolls),
      min_rolls: num(f.min_rolls),
      max_rolls: num(f.max_rolls),
      precio: num(f.precio),
    })),
    promos: limpiarPromos(c?.promos),
    pedidos: limpiarPedidos(c?.pedidos),
  };
}

module.exports = { leerCatalogo, limpiar, limpiarContenido, limpiarPromos };
