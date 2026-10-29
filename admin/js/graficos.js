import { h, plural, sumar } from './util.js';

// Gráficos en HTML y SVG (sin librerías), cada uno para un tipo de dato. Reglas: marcas finas con punta
// redondeada, acento para lo que importa y gris de contexto (colores de --serie-* para identidades),
// etiquetas selectivas en color de texto, detalle al tocar o con el teclado, y una tabla con los mismos datos.

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

  const fig = h('figure', { class: 'grafico' }, h('figcaption', { class: 'graf-titulo' }, titulo), svg, detalle,
    tablaNumeros([...datos].reverse(), columnasTabla));
  queueMicrotask(() => mostrar(datos.length - 1));
  return fig;
}

// Tabla "Ver los números" con los mismos datos del gráfico. columnasTabla: [[título, (d) => texto]].
function tablaNumeros(datos, columnasTabla) {
  return h('details', { class: 'graf-tabla' }, h('summary', {}, 'Ver los números'),
    h('table', { class: 'tabla' },
      h('tr', {}, columnasTabla.map((c, i) => h('th', { class: i ? 'num-der' : null }, c[0]))),
      datos.map((d) => h('tr', {}, columnasTabla.map((c, i) => h('td', { class: i ? 'num-der' : null }, c[1](d)))))));
}

// Gráfico sin datos: el título y un aviso en lugar de la marca.
function sinDatos(titulo, vacio) {
  return h('figure', { class: 'grafico' }, h('figcaption', { class: 'graf-titulo' }, titulo), h('p', { class: 'ayuda' }, vacio));
}

// Leyenda: [{ nombre, color }]. Va siempre que haya dos series o más.
function leyenda(series) {
  return h('div', { class: 'leyenda' }, series.map((serie) => h('span', {}, h('i', { style: `--c:${serie.color}` }), serie.nombre)));
}

// Áreas en el tiempo: dos montos que van uno dentro del otro (p. ej. vendido y, adentro, la ganancia), mes a mes.
// datos: [{ etiqueta, etiquetaLarga, valores: { clave: n }, destacado }]; series: [{ clave, nombre, color }], la
// primera es la de afuera. Un solo eje en pesos desde cero. Tocar una franja muestra el mes (y lo elige con `alElegir`).
export function areas(datos, { series, formato, titulo, columnasTabla, alElegir, ayudaElegir }) {
  const W = 340, H = 180, IZQ = 12, DER = 12, ARR = 26, ABA = 26;
  const n = datos.length;
  const valor = (d, serie) => Number(d.valores[serie.clave]) || 0;
  const nombreDe = (d) => d.etiquetaLarga || d.etiqueta;
  const max = Math.max(1, ...datos.flatMap((d) => series.map((serie) => valor(d, serie))));
  const paso = (W - IZQ - DER) / Math.max(1, n - 1);
  const px = (i) => IZQ + i * paso;
  const py = (v) => ARR + (1 - Math.max(0, v) / max) * (H - ARR - ABA);
  const base = H - ABA;

  const detalle = h('div', { class: 'graf-detalle', role: 'status' });
  const guia = s('line', { class: 'graf-guia', y1: ARR - 6, y2: base, x1: -10, x2: -10 });
  const marcasMes = series.map((serie) => datos.map((d, i) => s('circle', {
    class: 'graf-marca', cx: px(i), cy: py(valor(d, serie)), r: 4, style: `fill:${serie.color}`, opacity: 0,
  })));
  const etiquetas = [];
  const franjas = [];
  const mostrar = (i) => {
    const d = datos[i];
    detalle.replaceChildren(h('span', {}, nombreDe(d)),
      ...series.map((serie) => h('span', { class: 'graf-fila' }, h('i', { class: 'graf-punto-leyenda', style: `--c:${serie.color}` }),
        `${serie.nombre}: `, h('strong', {}, formato(valor(d, serie))))));
    guia.setAttribute('x1', px(i)); guia.setAttribute('x2', px(i));
    marcasMes.forEach((fila) => fila.forEach((p, j) => p.setAttribute('opacity', i === j ? 1 : 0)));
    etiquetas.forEach((t, j) => t.classList.toggle('activa', i === j));
    franjas.forEach((f, j) => f.classList.toggle('activa', i === j));
  };

  const capas = series.map((serie) => {
    const trazo = datos.map((d, i) => `${px(i)},${py(valor(d, serie))}`).join(' ');
    return [
      s('polygon', { class: 'graf-relleno', points: `${px(0)},${base} ${trazo} ${px(n - 1)},${base}`, style: `fill:${serie.color}` }),
      s('polyline', { class: 'graf-trazo', points: trazo, style: `stroke:${serie.color}` }),
    ];
  });
  const svg = s('svg', { class: 'graf-linea graf-areas', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': titulo },
    s('line', { class: 'graf-base', x1: IZQ, x2: W - DER, y1: base, y2: base }),
    ...capas.flat(), guia, ...marcasMes.flat(),
    ...datos.map((d, i) => {
      const t = s('text', { class: 'graf-eje' + (d.destacado ? ' destacado' : ''), x: px(i), y: H - 6,
        'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }, d.etiqueta);
      etiquetas.push(t);
      return t;
    }),
    // Franjas invisibles a lo alto: el blanco del toque es todo el mes, no el punto.
    ...datos.map((d, i) => {
      const montos = series.map((serie) => `${serie.nombre} ${formato(valor(d, serie))}`).join(', ');
      const f = s('rect', { class: 'graf-franja', x: px(i) - paso / 2, y: 0, width: paso, height: H, tabindex: '0', role: 'button',
        'aria-label': `${nombreDe(d)}: ${montos}`, 'aria-pressed': alElegir ? String(Boolean(d.destacado)) : null });
      f.addEventListener('pointerenter', () => mostrar(i));
      f.addEventListener('focus', () => mostrar(i));
      f.addEventListener('click', alElegir ? () => alElegir(d) : () => mostrar(i));
      f.addEventListener('keydown', (e) => {
        if (!alElegir || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        alElegir(d);
      });
      franjas.push(f);
      return f;
    }));

  const elegido = Math.max(0, datos.findIndex((d) => d.destacado));
  const fig = h('figure', { class: 'grafico' }, h('figcaption', { class: 'graf-titulo' }, titulo),
    leyenda(series), svg, detalle,
    alElegir && ayudaElegir ? h('p', { class: 'graf-ayuda' }, ayudaElegir) : null,
    tablaNumeros(datos, columnasTabla));
  queueMicrotask(() => mostrar(elegido));
  return fig;
}

// Partes de un total (p. ej. rolls vendidos por sabor): una sola barra partida y, abajo, cada parte con su
// cantidad y su porcentaje. datos: [{ etiqueta, valor, color }] en el orden fijo de las entidades (el color
// sigue al sabor, no al puesto). Más de 7 partes: las chicas se juntan en "Otros".
export function partes(datos, { formato, titulo, vacio }) {
  let lista = datos.filter((d) => d.valor > 0);
  if (lista.length > 7) {
    const chicas = [...lista].sort((a, b) => b.valor - a.valor).slice(6);
    lista = [...lista.filter((d) => !chicas.includes(d)),
      { etiqueta: 'Otros', valor: sumar(chicas, (d) => d.valor), color: 'var(--graf-gris)' }];
  }
  const total = sumar(lista, (d) => d.valor);
  const pct = (v) => `${Math.round((100 * v) / total)} %`;
  if (!total) return sinDatos(titulo, vacio);
  const mayor = Math.max(...lista.map((d) => d.valor));
  return h('figure', { class: 'grafico' },
    h('figcaption', { class: 'graf-titulo' }, titulo, h('span', { class: 'graf-total' }, ` · ${formato(total)} en total`)),
    h('div', { class: 'graf-partes', role: 'img', 'aria-label': lista.map((d) => `${d.etiqueta} ${pct(d.valor)}`).join(', ') },
      lista.map((d) => h('span', {
        style: `flex:${d.valor};--c:${d.color}`, title: `${d.etiqueta}: ${formato(d.valor)} (${pct(d.valor)})`,
      }))),
    h('ul', { class: 'graf-partes-lista' }, lista.map((d) => h('li', { class: d.valor === mayor ? 'mayor' : null },
      h('i', { style: `--c:${d.color}` }), h('span', { class: 'graf-etq' }, d.etiqueta),
      h('span', { class: 'graf-valor' }, formato(d.valor)), h('span', { class: 'graf-pct' }, pct(d.valor))))));
}

// Pesas (dumbbell): dos montos por fila sobre la misma escala desde cero, unidos por el tramo que los separa
// (p. ej. costo → precio: el tramo es lo que queda). datos: [{ etiqueta, desde, hasta, nota, href }];
// nombres: [nombre de "desde", nombre de "hasta"]. Ordenadas por el tramo, de mayor a menor.
export function pesas(datos, { formato, titulo, nombres, nota, columnasTabla }) {
  // Un poco de aire a la derecha para que la cifra de la punta no se salga.
  const max = Math.max(1, ...datos.map((d) => d.hasta)) * 1.08;
  const pos = (v) => `${(100 * Math.max(0, v)) / max}%`;
  const ordenadas = [...datos].sort((a, b) => (b.hasta - b.desde) - (a.hasta - a.desde));
  const notaDe = ({ valor, sub }) => h('span', { class: 'graf-nota' }, h('strong', {}, valor), h('small', {}, sub));
  return h('figure', { class: 'grafico' },
    h('figcaption', { class: 'graf-titulo' }, titulo),
    leyenda([{ nombre: nombres[0], color: 'var(--graf-gris)' }, { nombre: nombres[1], color: 'var(--graf-acento)' }]),
    h('ul', { class: 'graf-pesas' }, ordenadas.map((d) => h('li', {},
      d.href ? h('a', { class: 'graf-etq', href: d.href }, d.etiqueta) : h('span', { class: 'graf-etq' }, d.etiqueta),
      h('span', { class: 'graf-pesa', role: 'img',
        'aria-label': `${d.etiqueta}: ${nombres[0]} ${formato(d.desde)}, ${nombres[1]} ${formato(d.hasta)}` },
        h('span', { class: 'graf-tramo', style: `left:${pos(d.desde)};width:calc(${pos(d.hasta)} - ${pos(d.desde)})` }),
        h('span', { class: 'graf-bola desde', style: `left:${pos(d.desde)}` }),
        h('span', { class: 'graf-bola hasta', style: `left:${pos(d.hasta)}` }),
        h('span', { class: 'graf-cifra desde', style: `left:${pos(d.desde)}` }, formato(d.desde)),
        h('span', { class: 'graf-cifra hasta', style: `left:${pos(d.hasta)}` }, formato(d.hasta))),
      notaDe(nota(d))))),
    columnasTabla ? tablaNumeros(ordenadas, columnasTabla) : null);
}

// Composición al 100 %: en qué se va el precio de cada cosa (p. ej. cada caja: rolls, empaque y lo que queda).
// grupos: [{ titulo, filas: [{ etiqueta, total, valores: { clave: n } }] }]; partes: [{ clave, nombre, color }],
// la última es la que se rotula a la derecha con su porcentaje. Tocar una fila muestra sus montos.
export function composicion(grupos, { partes: piezas, formato, titulo, columnasTabla }) {
  const ultima = piezas[piezas.length - 1];
  const detalle = h('div', { class: 'graf-detalle', role: 'status' });
  const filas = [];
  const mostrar = (f, el) => {
    detalle.replaceChildren(h('span', {}, `${f.etiqueta} · ${formato(f.total)}`),
      ...piezas.map((p) => h('span', { class: 'graf-fila' }, h('i', { class: 'graf-punto-leyenda', style: `--c:${p.color}` }),
        `${p.nombre}: `, h('strong', {}, formato(f.valores[p.clave])))));
    filas.forEach((x) => x.classList.toggle('activa', x === el));
  };
  const pct = (f, clave) => (f.total > 0 ? (100 * Math.max(0, f.valores[clave])) / f.total : 0);
  let primera = null;
  const cuerpo = grupos.map((g) => h('div', { class: 'graf-grupo' },
    grupos.length > 1 ? h('div', { class: 'graf-subtitulo' }, g.titulo) : null,
    g.filas.map((f) => {
      const el = h('button', { type: 'button', class: 'graf-comp',
        'aria-label': `${f.etiqueta}: ${piezas.map((p) => `${p.nombre} ${formato(f.valores[p.clave])}`).join(', ')}` },
      h('span', { class: 'graf-etq' }, f.etiqueta),
      h('span', { class: 'graf-pila' }, piezas.map((p) => h('span', { style: `flex:${pct(f, p.clave)};--c:${p.color}` }))),
      h('span', { class: 'graf-valor' }, `${Math.round(pct(f, ultima.clave))} %`));
      el.addEventListener('pointerenter', () => mostrar(f, el));
      el.addEventListener('focus', () => mostrar(f, el));
      el.addEventListener('click', () => mostrar(f, el));
      filas.push(el);
      if (!primera) primera = [f, el];
      return el;
    })));
  const fig = h('figure', { class: 'grafico' }, h('figcaption', { class: 'graf-titulo' }, titulo),
    leyenda(piezas), h('div', { class: 'graf-comps' }, cuerpo), detalle,
    columnasTabla ? tablaNumeros(grupos.flatMap((g) => g.filas), columnasTabla) : null);
  if (primera) queueMicrotask(() => mostrar(...primera));
  return fig;
}

// Puntos por grupo (strip plot): cada publicación es un punto y la raya oscura es el promedio del grupo. Muestra
// además de "cuál rinde más en promedio" si es parejo o depende de una sola. grupos: [{ etiqueta, puntos:
// [{ valor, etiqueta }] }]. Escala desde cero, compartida.
export function puntos(grupos, { formato, titulo, vacio }) {
  const conPuntos = grupos.filter((g) => g.puntos.length);
  if (!conPuntos.length) return sinDatos(titulo, vacio);
  const max = Math.max(1, ...conPuntos.flatMap((g) => g.puntos.map((p) => p.valor)));
  const pos = (v) => `${(100 * v) / max}%`;
  const promedio = (g) => sumar(g.puntos, (p) => p.valor) / g.puntos.length;
  const ordenados = [...conPuntos].sort((a, b) => promedio(b) - promedio(a));
  const detalle = h('div', { class: 'graf-detalle', role: 'status' });
  const todos = [];
  const mostrar = (p, g, el) => {
    detalle.replaceChildren(h('strong', {}, formato(p.valor)), h('span', {}, `${g.etiqueta} · ${p.etiqueta}`));
    todos.forEach((x) => x.classList.toggle('activa', x === el));
  };
  return h('figure', { class: 'grafico' },
    h('figcaption', { class: 'graf-titulo' }, titulo),
    h('ul', { class: 'graf-puntos' }, ordenados.map((g) => h('li', {},
      h('span', { class: 'graf-etq' }, g.etiqueta, h('small', {}, plural(g.puntos.length, 'publicación', 'publicaciones'))),
      h('span', { class: 'graf-riel' },
        g.puntos.map((p) => {
          const el = h('button', { type: 'button', class: 'graf-pto', style: `left:${pos(p.valor)}`,
            'aria-label': `${g.etiqueta}, ${p.etiqueta}: ${formato(p.valor)}` });
          el.addEventListener('pointerenter', () => mostrar(p, g, el));
          el.addEventListener('focus', () => mostrar(p, g, el));
          el.addEventListener('click', () => mostrar(p, g, el));
          todos.push(el);
          return el;
        }),
        h('span', { class: 'graf-media', style: `left:${pos(promedio(g))}`, 'aria-hidden': 'true' })),
      h('span', { class: 'graf-valor' }, formato(Math.round(promedio(g))), h('small', {}, 'promedio'))))),
    h('div', { class: 'leyenda' }, h('span', {}, h('i', { class: 'redondo', style: '--c:var(--graf-acento)' }), 'una publicación'),
      h('span', {}, h('i', { class: 'raya', style: '--c:var(--texto)' }), 'promedio')),
    detalle);
}
