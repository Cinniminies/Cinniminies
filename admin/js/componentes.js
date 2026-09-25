import { h, vaciar, chips, stepper, campo } from './util.js';

const normal = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Selector de cliente con autocompletar y alta de cliente nuevo.
// Valor: { id, nombre, origen, ... } (existente) | { nuevo: true, nombre, contacto, origen } | null.
export function elegirCliente(lista, inicial, alCambiar, origenes = []) {
  const cont = h('div', { class: 'auto' });
  const datalist = h('datalist', { id: 'lista-origenes' }, origenes.map((o) => h('option', { value: o })));
  let valor = inicial;
  const cambiar = (v) => { valor = v; alCambiar(v); };

  function dibujar(texto = '', enfocar = false) {
    if (valor && !valor.nuevo) {
      vaciar(cont, h('div', { class: 'elegido' },
        h('span', {}, h('strong', {}, valor.nombre), valor.origen ? h('small', {}, ` · ${valor.origen}`) : null),
        h('button', { type: 'button', class: 'link', onclick: () => { cambiar(null); dibujar('', true); } }, 'Cambiar')));
      return;
    }
    if (valor && valor.nuevo) {
      const entrada = (clave, attrs) => h('input', {
        ...attrs, value: valor[clave] || '', autocomplete: 'off',
        oninput: (e) => { valor[clave] = e.target.value; alCambiar(valor); },
      });
      vaciar(cont, h('div', { class: 'card' },
        h('div', { class: 'linea-cab' }, h('h3', {}, 'Cliente nuevo'),
          h('button', { type: 'button', class: 'link', onclick: () => { const t = valor.nombre; cambiar(null); dibujar(t, true); } }, 'Buscar')),
        campo('Nombre', entrada('nombre', {})),
        campo('Contacto', entrada('contacto', { placeholder: '099 123 456 o @instagram' })),
        campo('Cómo llegó', entrada('origen', { list: 'lista-origenes', placeholder: 'IG, Familiar, ITSP…' }))),
      datalist);
      return;
    }
    const input = h('input', { type: 'search', placeholder: 'Buscar cliente…', value: texto, autocomplete: 'off' });
    const resultados = h('ul', { class: 'auto-lista', hidden: true });
    const buscar = () => {
      const t = input.value.trim();
      if (!t) { resultados.hidden = true; return; }
      const encontrados = lista.filter((c) => normal(c.nombre).includes(normal(t))).slice(0, 6);
      vaciar(resultados,
        encontrados.map((c) => h('li', {}, h('button', { type: 'button', onclick: () => { cambiar(c); dibujar(); } },
          c.nombre, h('small', {}, ` · ${c.origen || 'sin origen'} · ${c.compras} ${c.compras === 1 ? 'compra' : 'compras'}`)))),
        h('li', {}, h('button', {
          type: 'button',
          onclick: () => { cambiar({ nuevo: true, nombre: t, contacto: '', origen: '' }); dibujar(); },
        }, '+ Cliente nuevo: ', h('strong', {}, t))));
      resultados.hidden = false;
    };
    input.addEventListener('input', buscar);
    vaciar(cont, input, resultados);
    if (texto) buscar();
    if (enfocar) input.focus();
  }

  dibujar();
  return cont;
}

// Editor de los productos de una venta: una o más líneas (formato + sabores + caja).
// `lineas`: [{ formato_id, cantidad, caja (undefined = la de siempre | null | id), sabores: {sabor_id: unidades} }].
// El editor modifica ese mismo array (así quien lo usa puede guardar el borrador).
export function editorLineas(cat, lineas, alCambiar) {
  const cont = h('div');
  const nueva = () => ({ formato_id: null, cantidad: 1, caja: undefined, sabores: {} });
  if (!lineas.length) lineas.push(nueva());
  let mostrarCajas = lineas.some((l) => l.caja !== undefined);

  const avisar = () => { dibujar(); alCambiar(); };

  function dibujarLinea(l, i) {
    const f = cat.formato(l.formato_id);
    const total = Object.values(l.sabores).reduce((a, b) => a + b, 0);
    const objetivo = f?.tipo === 'caja_fija' ? f.rolls * l.cantidad : null;
    const tope = f?.tipo === 'caja_fija' ? objetivo : f?.tipo === 'personalizado' ? (f.max_rolls ?? Infinity) : Infinity;

    let contador = null;
    if (f?.tipo === 'caja_fija') {
      contador = h('span', { class: 'contador ' + (total === objetivo ? 'ok' : 'falta') }, `${total}/${objetivo}`);
    } else if (f?.tipo === 'personalizado') {
      const ok = total >= (f.min_rolls ?? 1) && total <= (f.max_rolls ?? Infinity);
      contador = h('span', { class: 'contador ' + (ok ? 'ok' : 'falta') }, `${total} rolls (${f.min_rolls}–${f.max_rolls})`);
    } else if (f) {
      contador = h('span', { class: 'contador' }, `${total} u.`);
    }

    // Sabores activos + los que ya tenga la línea aunque estén inactivos (ventas viejas)
    const sabores = [...cat.saboresActivos,
      ...cat.sabores.filter((s) => !s.activo && l.sabores[s.id])];

    const filasSabores = f ? sabores.map((s) => {
      const actual = l.sabores[s.id] || 0;
      const libre = tope - (total - actual);
      const completar = f.tipo === 'caja_fija' && libre > actual
        ? () => { l.sabores[s.id] = libre; avisar(); } : null;
      return h('div', { class: 'stepper-fila' },
        h('div', { class: 'nombre' },
          completar
            ? h('button', { type: 'button', class: 'link', onclick: completar, title: 'Completar la caja con este sabor' }, s.nombre)
            : s.nombre,
          s.activo ? null : h('small', {}, ' (inactivo)')),
        stepper(actual, (v) => { if (v) l.sabores[s.id] = v; else delete l.sabores[s.id]; avisar(); },
          { min: 0, max: Math.max(actual, libre) }));
    }) : [];

    let selectorCaja = null;
    if (f && mostrarCajas) {
      const sel = h('select', {
        onchange: (e) => {
          const v = e.target.value;
          l.caja = v === '__siempre' ? undefined : v === '__sin' ? null : v;
          alCambiar();
        },
      },
      h('option', { value: '__siempre' }, f.tipo === 'caja_fija'
        ? `La de siempre (${cat.insumo(f.caja_insumo_id)?.nombre || 'sin caja'})`
        : f.tipo === 'personalizado' ? 'La que corresponda (6 o 12)' : 'Sin caja (por defecto)'),
      cat.cajas.map((c) => h('option', { value: c.id }, c.nombre)),
      h('option', { value: '__sin' }, 'Sin caja'));
      sel.value = l.caja === undefined ? '__siempre' : l.caja === null ? '__sin' : l.caja;
      selectorCaja = campo('Caja', sel);
    }

    return h('div', { class: 'card linea' },
      h('div', { class: 'linea-cab' },
        h('h3', {}, lineas.length > 1 ? `Producto ${i + 1}` : 'Producto'),
        contador,
        lineas.length > 1
          ? h('button', { type: 'button', class: 'quitar', 'aria-label': 'Quitar producto', onclick: () => { lineas.splice(i, 1); avisar(); } }, '×')
          : null),
      h('div', { class: 'campo' },
        chips(cat.formatosActivos.map((fo) => ({ valor: fo.id, texto: fo.nombre })), l.formato_id,
          (v) => { l.formato_id = v; l.cantidad = 1; avisar(); })),
      f?.tipo === 'caja_fija'
        ? h('div', { class: 'stepper-fila' }, h('div', { class: 'nombre' }, 'Cantidad de cajas'),
          stepper(l.cantidad, (v) => { l.cantidad = v; avisar(); }, { min: 1, max: 20 }))
        : null,
      f ? h('div', { class: 'etq-grupo' }, 'Sabores',
        f.tipo === 'caja_fija' ? h('small', { class: 'ayuda' }, ' · tocá un sabor para completar la caja') : null) : null,
      filasSabores,
      selectorCaja);
  }

  function dibujar() {
    vaciar(cont,
      lineas.map(dibujarLinea),
      h('button', { type: 'button', class: 'btn chico', onclick: () => { lineas.push(nueva()); avisar(); } }, '+ Agregar otro producto'));
  }

  dibujar();

  return {
    el: cont,
    mostrarCajas(v) { mostrarCajas = v; dibujar(); },
    vacio: () => lineas.every((l) => !l.formato_id || !Object.keys(l.sabores).length),
    valor: () => lineas.filter((l) => l.formato_id).map((l) => {
      const f = cat.formato(l.formato_id);
      const linea = {
        formato_id: l.formato_id,
        cantidad: f?.tipo === 'caja_fija' ? l.cantidad : 1,
        sabores: Object.entries(l.sabores).map(([sabor_id, unidades]) => ({ sabor_id, unidades })),
      };
      if (l.caja !== undefined) linea.caja_insumo_id = l.caja;
      return linea;
    }),
  };
}
