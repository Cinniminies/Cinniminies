import { sb, q } from './db.js';

// Catálogo en memoria: sabores, formatos, insumos y parámetros. Se lee una vez por sesión
// (o cuando se pide `forzar`), así las pantallas de carga arman chips y steppers al instante.
let cache = null;

export async function catalogo(forzar = false) {
  if (cache && !forzar) return cache;
  const [sabores, formatos, insumos, parametros] = await Promise.all([
    q(sb.from('sabores').select('*').order('orden').order('nombre')),
    q(sb.from('formatos').select('*').order('orden').order('nombre')),
    q(sb.from('insumos').select('*').order('tipo').order('nombre')),
    q(sb.from('parametros').select('*')),
  ]);
  const param = Object.fromEntries(parametros.map((p) => [p.clave, p.valor]));
  cache = {
    sabores,
    formatos,
    insumos,
    saboresActivos: sabores.filter((s) => s.activo),
    formatosActivos: formatos.filter((f) => f.activo),
    cajas: insumos.filter((i) => i.tipo === 'packaging' && i.activo && /^caja/i.test(i.nombre)),
    precioEnvio: Number(param.precio_envio || 0),
    sabor: (id) => sabores.find((s) => s.id === id),
    formato: (id) => formatos.find((f) => f.id === id),
    insumo: (id) => insumos.find((i) => i.id === id),
  };
  return cache;
}

// Después de editar sabores, formatos o insumos, para que las pantallas de carga los vean.
export function invalidarCatalogo() {
  cache = null;
}

export async function clientes() {
  return q(sb.from('v_clientes').select('*').order('compras', { ascending: false }).order('nombre'));
}

export async function origenes() {
  const filas = await q(sb.from('clientes').select('origen').not('origen', 'is', null));
  return [...new Set(filas.map((f) => f.origen))].sort((a, b) => a.localeCompare(b, 'es'));
}
