// Desvíos de stock para Producción → Stock → Desvíos (funciones puras, pruebas en tests/desvios.test.mjs).
// Por insumo compara lo que dicen las recetas y las cajas ("según recetas") con lo que se usó de verdad
// ("real" = según recetas + lo que faltó en los conteos). Viene de v_desvio_insumo.

export const REVISAR = 0.1; // a partir de ±10 % vale la pena mirar el insumo
export const CONFIABLE = 2; // conteos comparados para que el % no sea casualidad

export function filas(porInsumo) {
  return porInsumo.map((d) => {
    const usado = Number(d.usado);
    const desvio = Number(d.desvio);
    return {
      insumo_id: d.insumo_id,
      nombre: d.nombre,
      tipo: d.tipo,
      unidad: d.unidad_base,
      conteos: Number(d.conteos),
      segunRecetas: usado,
      real: usado + desvio,
      desvio,
      rel: d.desvio_relativo == null ? null : Number(d.desvio_relativo),
      valor: Number(d.valor),
      confiable: Number(d.conteos) >= CONFIABLE,
    };
  });
}

// Plata que se fue de más (faltó) y que sobró, e insumos para revisar.
export function resumen(lista) {
  return {
    deMas: lista.filter((f) => f.valor > 0).reduce((a, f) => a + f.valor, 0),
    sobro: lista.filter((f) => f.valor < 0).reduce((a, f) => a - f.valor, 0),
    revisar: lista.filter((f) => f.confiable && f.rel != null && Math.abs(f.rel) >= REVISAR).length,
  };
}

// 'plata': mayor impacto en $ primero; 'pct': mayor desvío relativo primero (sin % al final).
export function ordenar(lista, por) {
  const clave = por === 'pct' ? (f) => (f.rel == null ? -1 : Math.abs(f.rel)) : (f) => Math.abs(f.valor);
  return [...lista].sort((a, b) => clave(b) - clave(a) || a.nombre.localeCompare(b.nombre));
}

// Escala del gráfico: el mayor |%| (entre 10 % y 100 %; lo que pasa de 100 % llega al borde).
export function escala(lista) {
  const max = Math.max(0, ...lista.map((f) => Math.abs(f.rel ?? 0)));
  return Math.min(1, Math.max(REVISAR, max));
}

// Conteos agrupados por momento (los insumos de una misma carga comparten creado_en), del más nuevo al
// más viejo: [{ clave, fecha, hora, filas }]. `hora` solo viene si ese día hubo más de un conteo.
export function porConteo(historial) {
  const m = new Map();
  for (const x of historial) {
    const clave = x.creado_en || x.fecha;
    if (!m.has(clave)) m.set(clave, []);
    m.get(clave).push(x);
  }
  const grupos = [...m].map(([clave, xs]) => ({ clave, fecha: xs[0].fecha, creado_en: xs[0].creado_en, filas: xs }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || String(b.creado_en).localeCompare(String(a.creado_en)));
  const porDia = {};
  for (const g of grupos) porDia[g.fecha] = (porDia[g.fecha] || 0) + 1;
  return grupos.map((g) => ({
    clave: g.clave,
    fecha: g.fecha,
    hora: porDia[g.fecha] > 1 && g.creado_en ? horaDe(g.creado_en) : null,
    filas: g.filas.sort((a, b) => Math.abs(Number(b.valor)) - Math.abs(Number(a.valor)) || a.nombre.localeCompare(b.nombre)),
  }));
}

const horaDe = (iso) => new Date(iso).toLocaleTimeString('es-UY', { timeZone: 'America/Montevideo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// ---------------------------------------------------------------- recetas propuestas
// Uso real promedio por tanda de un ingrediente en un sabor = receta × (1 + desvío del ingrediente).
// Supuesto: lo que se usa de más (o de menos) se reparte en proporción entre los sabores que lo llevan.
export const MINIMO_AJUSTE = 0.05; // menos de ±5 % no vale la pena tocar la receta

// Estado de cada ingrediente para la propuesta: 'ajustar' (se propone), 'chico' (desvío menor al mínimo),
// 'pocos' (un solo conteo) o 'sin' (sin conteos comparables).
export function estadoAjuste(f) {
  if (!f || f.rel == null) return 'sin';
  if (!f.confiable) return 'pocos';
  if (Math.abs(f.rel) < MINIMO_AJUSTE) return 'chico';
  return 'ajustar';
}

// Cantidades cómodas para la cocina: g/ml de a 0,5 (menos de 20), de a 1 (menos de 100) o de a 5; unidades de a 0,5.
export function redondear(n, unidad) {
  const paso = unidad === 'g' || unidad === 'ml' ? (n < 20 ? 0.5 : n < 100 ? 1 : 5) : 0.5;
  return Math.max(paso, Math.round(n / paso) * paso);
}

// recetas: [{ sabor_id, sabor, rolls, insumo_id, nombre, unidad, cantidad }] (solo ingredientes de sabores activos)
// porInsumo: filas(...) de v_desvio_insumo; elegidos: Set de insumo_id a ajustar; costos: { insumo_id: costo por unidad }.
// Devuelve un sabor por elemento: { sabor_id, sabor, rolls, items, costoAntes, costoDespues }.
export function propuesta(recetas, porInsumo, elegidos, costos = {}) {
  const desvio = Object.fromEntries(porInsumo.map((f) => [f.insumo_id, f]));
  const sabores = new Map();
  for (const r of recetas) {
    if (!sabores.has(r.sabor_id)) sabores.set(r.sabor_id, { sabor_id: r.sabor_id, sabor: r.sabor, rolls: r.rolls, items: [] });
    const f = desvio[r.insumo_id];
    const receta = Number(r.cantidad);
    const real = f?.rel == null ? null : receta * (1 + f.rel);
    const cambia = elegidos.has(r.insumo_id) && real != null;
    sabores.get(r.sabor_id).items.push({
      insumo_id: r.insumo_id, nombre: r.nombre, unidad: r.unidad, receta, real,
      propuesta: cambia ? redondear(real, r.unidad) : receta,
      estado: estadoAjuste(f),
    });
  }
  return [...sabores.values()].map((s) => {
    const costo = (campo) => s.items.reduce((a, i) => a + i[campo] * (Number(costos[i.insumo_id]) || 0), 0);
    s.items.sort((a, b) => Number(b.propuesta !== b.receta) - Number(a.propuesta !== a.receta) || a.nombre.localeCompare(b.nombre));
    return { ...s, costoAntes: costo('receta'), costoDespues: costo('propuesta') };
  }).sort((a, b) => a.sabor.localeCompare(b.sabor));
}

// Lo que se manda a aplicar_recetas_propuestas: solo lo que cambia.
export function cambios(sabores) {
  return sabores.flatMap((s) => s.items.filter((i) => i.propuesta !== i.receta)
    .map((i) => ({ sabor_id: s.sabor_id, insumo_id: i.insumo_id, cantidad: i.propuesta })));
}
