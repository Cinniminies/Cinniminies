import { h, vaciar, chips, stepper, campo, normalizar, pesos, fechaLarga, fechaCorta, hoyISO, proximoSabado, conBoton, sumar, campoPesos, grupo } from './util.js';
import { PRODUCCION } from './app.js';
import { textoPanel } from './textos.js';


// Selector de cliente con autocompletar y alta de cliente nuevo.
// Valor: { id, nombre, origen, ... } (existente) | { nuevo: true, nombre, contacto, origen } | null.
// Incluye el <datalist id="lista-origenes"> que usan también los campos de origen de la pantalla.
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
        campo('Cómo llegó', entrada('origen', { list: 'lista-origenes', placeholder: 'IG, Familiar, ITSP…' }))));
      return;
    }
    const input = h('input', { type: 'search', placeholder: 'Buscar cliente…', value: texto, autocomplete: 'off' });
    const resultados = h('ul', { class: 'auto-lista', hidden: true });
    const buscar = () => {
      const t = input.value.trim();
      if (!t) { resultados.hidden = true; return; }
      const encontrados = lista.filter((c) => normalizar(c.nombre).includes(normalizar(t))).slice(0, 6);
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
  return h('div', {}, cont, datalist);
}

// Editor de los productos de una venta: una o más líneas (formato + sabores + caja).
// `lineas`: [{ formato_id, cantidad, caja (undefined = la de siempre | null | id), sabores: {sabor_id: unidades},
//             sinGlaseado: {sabor_id: rolls sin glaseado} }].
// El editor modifica ese mismo array (así quien lo usa puede guardar el borrador).
export function editorLineas(cat, lineas, alCambiar) {
  const cont = h('div', { class: 'editor-lineas' });
  const nueva = () => ({ formato_id: null, cantidad: 1, caja: undefined, sabores: {} });
  if (!lineas.length) lineas.push(nueva());
  let mostrarCajas = lineas.some((l) => l.caja !== undefined);

  const avisar = () => { dibujar(); alCambiar(); };

  function dibujarLinea(l, i) {
    const f = cat.formato(l.formato_id);
    const total = sumar(Object.values(l.sabores));
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
      const sinGlaseado = l.sinGlaseado?.[s.id] || 0;
      if (sinGlaseado > actual) { if (actual) l.sinGlaseado[s.id] = actual; else delete l.sinGlaseado[s.id]; }
      return [h('div', { class: 'stepper-fila' },
        h('div', { class: 'nombre' },
          completar
            ? h('button', { type: 'button', class: 'link', onclick: completar, title: 'Completar la caja con este sabor' }, s.nombre)
            : s.nombre,
          s.activo ? null : h('small', {}, ' (inactivo)')),
        stepper(actual, (v) => { if (v) l.sabores[s.id] = v; else delete l.sabores[s.id]; avisar(); },
          { min: 0, max: Math.max(actual, libre) })),
      // Cuántos de ese sabor van sin glaseado (solo si se abrió la opción en esta línea)
      l.verGlaseado && actual ? h('div', { class: 'stepper-fila sub' },
        h('div', { class: 'nombre' }, h('small', {}, `↳ ${s.nombre} sin glaseado`)),
        stepper(Math.min(sinGlaseado, actual), (v) => {
          l.sinGlaseado = l.sinGlaseado || {};
          if (v) l.sinGlaseado[s.id] = v; else delete l.sinGlaseado[s.id];
          alCambiar();
        }, { min: 0, max: actual })) : null];
    }) : [];
    const totalSinGlaseado = Object.entries(l.sinGlaseado || {})
      .reduce((a, [id, n]) => a + Math.min(n, l.sabores[id] || 0), 0);
    const botonGlaseado = f && total ? h('button', {
      type: 'button', class: 'link',
      onclick: () => { l.verGlaseado = !l.verGlaseado; dibujar(); },
    }, l.verGlaseado ? 'Listo' : totalSinGlaseado ? `${totalSinGlaseado} sin glaseado · cambiar` : 'Algunos sin glaseado') : null;

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
      botonGlaseado ? h('p', { class: 'ayuda', style: 'margin:.25rem 0' }, botonGlaseado) : null,
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
        sabores: Object.entries(l.sabores).map(([sabor_id, unidades]) => ({
          sabor_id, unidades, sin_glaseado: Math.min(l.sinGlaseado?.[sabor_id] || 0, unidades),
        })),
      };
      if (l.caja !== undefined) linea.caja_insumo_id = l.caja;
      return linea;
    }),
  };
}

// Precios de una combinación (formato, sabor o ambos): el vigente, los programados a futuro y el
// historial, más un formulario para cargar uno nuevo. Los precios nunca se pisan: se agrega uno con
// "vigente desde" (las ventas guardadas conservan el precio con el que se cargaron).
// `filas`: [{ id, precio, vigente_desde }]. `alGuardar(precio, desde)`. `alBorrar(id)` (solo programados).
export function seccionPrecios(filas, alGuardar, alBorrar, { sinPrecio = 'Sin precio cargado' } = {}) {
  const hoy = hoyISO();
  const ordenadas = [...filas].sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde));
  const futuras = ordenadas.filter((f) => f.vigente_desde > hoy);
  const pasadas = ordenadas.filter((f) => f.vigente_desde <= hoy);
  const [actual, ...anteriores] = pasadas;

  const precio = campoPesos({ placeholder: '$' });
  const desde = h('input', { type: 'date', value: hoy });
  const guardar = h('button', { class: 'btn primario', type: 'button' }, 'Guardar precio');
  guardar.onclick = () => conBoton(guardar, async () => {
    if (precio.value === '' || Number(precio.value) < 0) throw new Error('Poné el precio');
    await alGuardar(Number(precio.value), desde.value || hoy);
  });

  return h('div', {},
    h('p', {}, actual
      ? [h('strong', { style: 'font-size:1.2rem' }, pesos(actual.precio)), ` desde el ${fechaLarga(actual.vigente_desde)}`]
      : h('span', { class: 'ayuda' }, sinPrecio)),
    futuras.map((f) => {
      const borrar = h('button', { class: 'btn chico peligro', type: 'button' }, 'Borrar');
      borrar.onclick = () => conBoton(borrar, async () => {
        if (confirm(`¿Borrar el precio de ${pesos(f.precio)} programado para el ${fechaLarga(f.vigente_desde)}?`)) await alBorrar(f.id);
      });
      return h('div', { class: 'stepper-fila' },
        h('div', { class: 'nombre' }, pastilla('neutro', 'Programado'), ` ${pesos(f.precio)} desde el ${fechaLarga(f.vigente_desde)}`),
        borrar);
    }),
    anteriores.length
      ? h('details', {}, h('summary', { class: 'ayuda' }, `Precios anteriores (${anteriores.length})`),
        anteriores.map((f) => h('div', { class: 'ayuda' }, `${pesos(f.precio)} desde el ${fechaLarga(f.vigente_desde)}`)))
      : null,
    h('div', { class: 'fila-campos', style: 'margin-top:.75rem' },
      campo('Precio nuevo', precio), campo('Vigente desde', desde)),
    h('p', { class: 'ayuda' }, 'Las ventas ya cargadas no cambian. Con una fecha futura, el precio queda programado.'),
    guardar);
}

// Pestañas internas de Producción (Tandas · Stock · Compras · ¿Qué compro?).
export function subnavProduccion(actual) {
  return h('nav', { class: 'subnav', 'aria-label': 'Producción' },
    PRODUCCION.map(([ruta, texto]) => h('a', {
      href: `#/${ruta}`, class: ruta === actual ? 'activo' : null, 'aria-current': ruta === actual ? 'page' : null,
    }, texto)));
}

// "Semana del sábado 31/10": la semana de pedidos (domingo a sábado) se nombra por su sábado de entrega.
// Las partes que no están vacías, con `separador` entre una y otra (sirve para textos y elementos).
const intercalar = (partes, separador) => [partes].flat()
  .filter((p) => p != null && p !== false && p !== '')
  .flatMap((p, i) => (i ? [separador, p] : [p]));

// Fila de una lista: el título (con sus etiquetas), el detalle y, a la derecha, un monto, una etiqueta o
// botones. Título y detalle pueden ser listas: se saltean las partes vacías y el detalle se une con " · ".
// Con `href` la fila es un link y, si no hay nada a la derecha, lleva la flecha.
export function filaLista({ href, titulo, detalle, derecha }) {
  const sub = intercalar(detalle, ' · ');
  return h('li', {}, h(href ? 'a' : 'div', { class: 'fila', href },
    h('div', { class: 'princ' }, h('div', { class: 't1' }, intercalar(titulo, ' ')), sub.length ? h('div', { class: 't2' }, sub) : null),
    derecha ?? (href ? h('span', { class: 'chev', 'aria-hidden': 'true' }, '›') : null)));
}

// Etiqueta de estado ("Pendiente", "Inactivo"…). clase: ok, neutro, pendiente, alerta.
export const pastilla = (clase, texto) => h('span', { class: `badge ${clase}` }, texto);

// Un monto a la derecha de una fila.
export const monto = (texto) => h('span', { class: 'monto' }, texto);

// Chips para elegir la unidad de un insumo (g o kg, ml o L…). Si hay una sola opción no muestra nada.
export function chipsUnidad(lista, valor, alCambiar) {
  return lista.length > 1 ? grupo('Unidad', chips(lista.map((u) => ({ valor: u, texto: u })), valor, alCambiar)) : null;
}

// Tarjeta de un número: etiqueta, valor grande, aclaración y, si hay, la variación contra el período anterior.
export const stat = (etiqueta, valor, sub, delta) => h('div', { class: 'stat' },
  h('div', { class: 'etq' }, etiqueta), h('div', { class: 'num' }, valor), sub ? h('div', { class: 'sub' }, sub) : null, delta);

export const tituloSemana = (sabado) => textoPanel('panel.semana', 'Semana del sábado {fecha}', { fecha: fechaCorta(sabado).slice(4) });

// Libro de caja (Compras, Gastos): los movimientos agrupados por semana de pedidos, con lo que salió y entró
// en cada una y los montos alineados en su columna. Las filas tienen que venir ordenadas por fecha, más nuevas primero.
// `filas`: [{ fecha, titulo, detalle, monto, entra, accion }]. `cortada`: la lista llegó al límite de la consulta, así
// que la semana más vieja puede estar incompleta y no se le muestra el total.
export function libroCaja(filas, vacio, { cortada = false } = {}) {
  if (!filas.length) return h('p', { class: 'vacio' }, vacio);
  const semanas = new Map();
  for (const f of filas) {
    const s = proximoSabado(f.fecha);
    if (!semanas.has(s)) semanas.set(s, []);
    semanas.get(s).push(f);
  }
  return h('div', { class: 'libro' }, [...semanas].map(([sabado, deSemana], i) => {
    const sinTotal = cortada && i === semanas.size - 1;
    const suma = (entra) => sumar(deSemana.filter((f) => !!f.entra === entra), (f) => f.monto);
    const salio = suma(false);
    const entro = suma(true);
    return h('section', { class: 'libro-semana' },
      h('h3', { class: 'libro-cab' }, tituloSemana(sabado),
        sinTotal ? null : h('span', { class: 'libro-totales' },
          salio ? h('span', {}, textoPanel('panel.libro_salio', 'Salió {monto}', { monto: pesos(salio) })) : null,
          entro ? h('span', { class: 'entra' }, textoPanel('panel.libro_entro', 'Entró {monto}', { monto: `+ ${pesos(entro)}` })) : null)),
      h('ul', { class: 'libro-filas' }, deSemana.map((f) => h('li', { class: 'libro-fila' },
        h('span', { class: 'libro-dia' }, fechaCorta(f.fecha)),
        h('div', { class: 'libro-princ' }, h('div', { class: 't1' }, f.titulo), f.detalle ? h('div', { class: 't2' }, f.detalle) : null),
        h('span', { class: 'libro-monto' + (f.entra ? ' entra' : '') }, f.entra ? `+ ${pesos(f.monto)}` : pesos(f.monto)),
        f.accion || null))));
  }));
}
