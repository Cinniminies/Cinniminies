import { h } from './util.js';

// Gráficos simples en HTML (sin librerías). Reglas: marcas finas con punta redondeada, un solo
// color de acento (el resto en gris de contexto), etiquetas selectivas en color de texto, detalle
// al tocar o con el teclado, y siempre una tabla con los mismos datos.

// Columnas (p. ej. vendido por mes). datos: [{ etiqueta, valor, destacado, filas: [[nombre, texto]] }]
// Se rotula solo la columna destacada y la más alta; el resto está en el detalle y en la tabla.
export function columnas(datos, { formato, titulo, columnasTabla }) {
  const max = Math.max(0, ...datos.map((d) => d.valor));
  const iMax = datos.findIndex((d) => d.valor === max && max > 0);
  const detalle = h('div', { class: 'graf-detalle', role: 'status' });

  const mostrar = (d, col) => {
    detalle.replaceChildren(
      h('strong', {}, formato(d.valor)), h('span', {}, d.etiquetaLarga || d.etiqueta),
      ...(d.filas || []).map(([n, t]) => h('span', { class: 'graf-fila' }, `${n}: ${t}`)));
    for (const c of col.parentNode.children) c.classList.toggle('activa', c === col);
  };

  const cols = datos.map((d, i) => {
    const alto = max > 0 && d.valor > 0 ? Math.max(2, (100 * d.valor) / max) : 0;
    const col = h('button', {
      type: 'button', class: 'graf-col' + (d.destacado ? ' destacado' : ''),
      'aria-label': `${d.etiquetaLarga || d.etiqueta}: ${formato(d.valor)}`,
    },
    h('span', { class: 'graf-valor' }, d.destacado || i === iMax ? formato(d.valor) : ''),
    h('span', { class: 'graf-area' }, h('span', { class: 'graf-barra', style: `height:${alto}%` })),
    h('span', { class: 'graf-etq' }, d.etiqueta));
    const ver = () => mostrar(d, col);
    col.addEventListener('pointerenter', ver);
    col.addEventListener('focus', ver);
    col.addEventListener('click', ver);
    return col;
  });

  const tabla = h('details', { class: 'graf-tabla' }, h('summary', {}, 'Ver los números'),
    h('table', { class: 'tabla' },
      h('tr', {}, columnasTabla.map((c, i) => h('th', { class: i ? 'num-der' : null }, c[0]))),
      datos.map((d) => h('tr', {}, columnasTabla.map((c, i) => h('td', { class: i ? 'num-der' : null }, c[1](d)))))));

  const destacado = datos.find((d) => d.destacado) || datos[datos.length - 1];
  const fig = h('figure', { class: 'grafico' },
    h('figcaption', { class: 'graf-titulo' }, titulo),
    h('div', { class: 'graf-columnas', style: `--n:${datos.length}` }, cols),
    detalle,
    tabla);
  if (destacado) queueMicrotask(() => mostrar(destacado, cols[datos.indexOf(destacado)]));
  return fig;
}

// Barras horizontales para comparar cantidades (p. ej. rolls por sabor), de mayor a menor.
// datos: [{ etiqueta, valor }]. El valor va en la punta de cada barra.
export function barras(datos, { formato, titulo, vacio }) {
  const ordenados = [...datos].filter((d) => d.valor > 0).sort((a, b) => b.valor - a.valor);
  const max = Math.max(0, ...ordenados.map((d) => d.valor));
  return h('figure', { class: 'grafico' },
    h('figcaption', { class: 'graf-titulo' }, titulo),
    ordenados.length
      ? h('ul', { class: 'graf-barras' }, ordenados.map((d) => h('li', {},
        h('span', { class: 'graf-etq' }, d.etiqueta),
        h('span', { class: 'graf-pista' },
          h('span', { class: 'graf-barra', style: `width:${(100 * d.valor) / max}%` }),
          h('span', { class: 'graf-valor' }, formato(d.valor))))))
      : h('p', { class: 'ayuda' }, vacio));
}

// Variación contra el período anterior: "▲ 12 % vs agosto" (verde si sube algo bueno).
export function variacion(actual, anterior, contra, { masEsMejor = true } = {}) {
  if (!anterior || anterior === 0 || actual == null) return null;
  const cambio = (actual - anterior) / Math.abs(anterior);
  if (!Number.isFinite(cambio)) return null;
  const pct = Math.abs(cambio * 100);
  if (pct < 0.05) return h('span', { class: 'delta' }, `igual que ${contra}`);
  const sube = cambio > 0;
  const bueno = sube === masEsMejor;
  return h('span', { class: 'delta ' + (bueno ? 'bueno' : 'malo') },
    h('span', { 'aria-hidden': 'true' }, sube ? '▲ ' : '▼ '),
    `${sube ? 'sube' : 'baja'} ${pct < 10 ? pct.toFixed(1).replace('.', ',') : Math.round(pct)} % vs ${contra}`);
}
