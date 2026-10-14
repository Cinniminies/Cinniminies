import { h } from './util.js';

// Gráficos simples en HTML (sin librerías). Reglas: marcas finas con punta redondeada, un solo
// color de acento (el resto en gris de contexto), etiquetas selectivas en color de texto, detalle
// al tocar o con el teclado, y siempre una tabla con los mismos datos.

// Columnas (p. ej. vendido por mes). datos: [{ etiqueta, valor, destacado, filas: [[nombre, texto]] }]
// Se rotula solo la columna destacada y la más alta; el resto está en el detalle y en la tabla.
// `alElegir(d)`: si está, tocar (o Enter sobre) una columna la elige además de mostrar el detalle.
export function columnas(datos, { formato, titulo, columnasTabla, alElegir, ayudaElegir }) {
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
      'aria-pressed': alElegir ? String(Boolean(d.destacado)) : null,
    },
    h('span', { class: 'graf-valor' }, d.destacado || i === iMax ? formato(d.valor) : ''),
    h('span', { class: 'graf-area' }, h('span', { class: 'graf-barra', style: `height:${alto}%` })),
    h('span', { class: 'graf-etq' }, d.etiqueta));
    const ver = () => mostrar(d, col);
    col.addEventListener('pointerenter', ver);
    col.addEventListener('focus', ver);
    col.addEventListener('click', alElegir ? () => alElegir(d) : ver);
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
    alElegir && ayudaElegir ? h('p', { class: 'graf-ayuda' }, ayudaElegir) : null,
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

// Línea en el tiempo (p. ej. el precio de un insumo en cada compra). datos: [{ x: 'AAAA-MM-DD', valor,
// etiqueta }], ordenados por fecha. El eje x respeta las fechas (compras espaciadas quedan espaciadas)
// y el y arranca en el mínimo, no en cero: lo que importa es cuánto cambió. Se rotulan la primera y la
// última; tocar (o enfocar) un punto muestra su detalle con una línea vertical.
const SVG = 'http://www.w3.org/2000/svg';
function s(tag, attrs, ...hijos) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  el.append(...hijos);
  return el;
}

export function linea(datos, { formato, titulo, columnasTabla }) {
  const W = 320, H = 160, IZQ = 10, DER = 10, ARR = 22, ABA = 36;
  const dia = (iso) => Date.parse(`${iso}T12:00:00Z`) / 864e5;
  const x0 = dia(datos[0].x), x1 = dia(datos[datos.length - 1].x);
  const vals = datos.map((d) => d.valor);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (max - min < 1e-9) { min -= Math.abs(min) * 0.1 || 1; max += Math.abs(max) * 0.1 || 1; }
  const px = (d, i) => (x1 > x0 ? IZQ + ((dia(d.x) - x0) / (x1 - x0)) * (W - IZQ - DER)
    : IZQ + (i / Math.max(1, datos.length - 1)) * (W - IZQ - DER));
  const py = (v) => ARR + (1 - (v - min) / (max - min)) * (H - ARR - ABA);
  const pts = datos.map((d, i) => [px(d, i), py(d.valor)]);

  const detalle = h('div', { class: 'graf-detalle', role: 'status' });
  const guia = s('line', { class: 'graf-guia', y1: ARR - 8, y2: H - ABA, x1: -10, x2: -10 });
  const marcas = [];
  const mostrar = (i) => {
    const d = datos[i];
    detalle.replaceChildren(h('strong', {}, formato(d.valor)), h('span', {}, d.etiqueta));
    guia.setAttribute('x1', pts[i][0]); guia.setAttribute('x2', pts[i][0]);
    marcas.forEach((m, j) => m.classList.toggle('activa', i === j));
  };
  const rotulo = (i, abajo = false) => {
    const [x, y] = pts[i];
    const ancla = i === 0 && datos.length > 1 ? 'start' : i === datos.length - 1 ? 'end' : 'middle';
    return s('text', { class: 'graf-rotulo', x, y: abajo ? y + 18 : y - 10, 'text-anchor': ancla }, formato(datos[i].valor));
  };
  // Primera, última, y el mínimo y el máximo si quedan en el medio.
  const ultimo = datos.length - 1;
  const iMin = vals.indexOf(Math.min(...vals)), iMax = vals.indexOf(Math.max(...vals));
  const rotulos = [rotulo(0), ultimo ? rotulo(ultimo) : ''];
  if (iMax > 0 && iMax < ultimo) rotulos.push(rotulo(iMax));
  if (iMin > 0 && iMin < ultimo && iMin !== iMax) rotulos.push(rotulo(iMin, true));

  const svg = s('svg', { class: 'graf-linea', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': titulo },
    s('line', { class: 'graf-base', x1: IZQ, x2: W - DER, y1: H - ABA + 6, y2: H - ABA + 6 }),
    s('text', { class: 'graf-eje', x: IZQ, y: H - 4, 'text-anchor': 'start' }, datos[0].etiquetaEje || ''),
    datos.length > 1 ? s('text', { class: 'graf-eje', x: W - DER, y: H - 4, 'text-anchor': 'end' }, datos[datos.length - 1].etiquetaEje || '') : '',
    guia,
    s('polyline', { class: 'graf-trazo', points: pts.map((p) => p.join(',')).join(' ') }),
    ...datos.map((d, i) => {
      const g = s('g', { class: 'graf-punto', tabindex: '0', role: 'button', 'aria-label': `${d.etiqueta}: ${formato(d.valor)}` },
        s('circle', { class: 'graf-toque', cx: pts[i][0], cy: pts[i][1], r: 14 }),
        s('circle', { class: 'graf-marca', cx: pts[i][0], cy: pts[i][1], r: 4.5 }));
      const ver = () => mostrar(i);
      g.addEventListener('pointerenter', ver);
      g.addEventListener('focus', ver);
      g.addEventListener('click', ver);
      marcas.push(g);
      return g;
    }),
    ...rotulos);

  const tabla = h('details', { class: 'graf-tabla' }, h('summary', {}, 'Ver los números'),
    h('table', { class: 'tabla' },
      h('tr', {}, columnasTabla.map((c, i) => h('th', { class: i ? 'num-der' : null }, c[0]))),
      [...datos].reverse().map((d) => h('tr', {}, columnasTabla.map((c, i) => h('td', { class: i ? 'num-der' : null }, c[1](d)))))));

  const fig = h('figure', { class: 'grafico' }, h('figcaption', { class: 'graf-titulo' }, titulo), svg, detalle, tabla);
  queueMicrotask(() => mostrar(datos.length - 1));
  return fig;
}
