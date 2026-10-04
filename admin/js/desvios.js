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
