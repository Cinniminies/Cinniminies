// Cliente de Supabase falso para las pruebas de /admin (lo carga _cargador.mjs en lugar del de la CDN).
// Cada consulta devuelve las filas de `tablas[tabla]` (o el error de `errores[tabla]`) y queda anotada en
// `consultas` con sus pasos: [['select', '*'], ['eq', 'cliente_id', 'c1'], …]. Las RPC se anotan como 'rpc:nombre'.
export const tablas = {};
export const errores = {};
export const consultas = [];

export function reiniciar() {
  for (const objeto of [tablas, errores]) for (const clave of Object.keys(objeto)) delete objeto[clave];
  consultas.length = 0;
}

// Los pasos de la última consulta a `tabla`.
export const pasosDe = (tabla) => consultas.findLast((c) => c.tabla === tabla)?.pasos;

function consulta(tabla, pasos = []) {
  consultas.push({ tabla, pasos });
  const encadenable = new Proxy({}, {
    get(_, metodo) {
      if (metodo !== 'then') return (...args) => { pasos.push([metodo, ...args]); return encadenable; };
      const filas = tablas[tabla] ?? [];
      const resultado = errores[tabla]
        ? { data: null, error: errores[tabla], count: null }
        : { data: filas, error: null, count: filas.length };
      return (ok, mal) => Promise.resolve(resultado).then(ok, mal);
    },
  });
  return encadenable;
}

export function createClient() {
  return { from: (tabla) => consulta(tabla), rpc: (nombre, args) => consulta(`rpc:${nombre}`, [['rpc', args]]) };
}
