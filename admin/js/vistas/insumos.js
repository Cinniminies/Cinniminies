import { sb, q, rpc, contar } from '../db.js';
import { h, vaciar, campo, chips, grupo, interruptor, pesos, plural, numero, cantidad, fechaLarga, toast, conBoton } from '../util.js';
import { catalogo, invalidarCatalogo } from '../catalogo.js';
import { irA } from '../app.js';
import { linea } from '../graficos.js';
import { puntos, cambio, impactoPorRoll, impactoPorCaja } from '../historial.js';

const TIPOS = [{ valor: 'ingrediente', texto: 'Ingrediente' }, { valor: 'packaging', texto: 'Packaging' }];
const UNIDADES = [{ valor: 'g', texto: 'gramos (g)' }, { valor: 'ml', texto: 'mililitros (ml)' },
  { valor: 'un', texto: 'unidades (un)' }, { valor: 'paq', texto: 'paquetes (paq)' }, { valor: 'cm', texto: 'centímetros (cm)' }];
// Precio legible por unidad de compra: el costo por gramo se muestra por kg, el de ml por litro y el de cm por metro.
const porPresentacion = (costo, unidad) => (unidad === 'g' ? `${pesos(costo * 1000)}/kg`
  : unidad === 'ml' ? `${pesos(costo * 1000)}/L` : unidad === 'cm' ? `${pesos(costo * 100)}/m` : `${pesos(costo)}/${unidad}`);

export async function mostrar(cont, { id }) {
  return id ? ficha(cont, id === 'nuevo' ? null : id) : lista(cont);
}

async function lista(cont) {
  const [insumos, costos] = await Promise.all([
    q(sb.from('insumos').select('*').order('activo', { ascending: false }).order('nombre')),
    q(sb.from('v_costo_insumo').select('insumo_id,costo_unitario,fuente,ultima_compra')),
  ]);
  const costoDe = Object.fromEntries(costos.map((c) => [c.insumo_id, c]));
  const grupoTipo = (tipo, titulo) => [
    h('h2', {}, titulo),
    h('ul', { class: 'lista' }, insumos.filter((i) => i.tipo === tipo).map((i) => {
      const c = costoDe[i.id];
      return h('li', {}, h('a', { class: 'fila', href: `#/insumos/${i.id}` },
        h('div', { class: 'princ' },
          h('div', { class: 't1' }, i.nombre, ' ', i.activo ? null : h('span', { class: 'badge neutro' }, 'Inactivo')),
          h('div', { class: 't2' }, [
            c?.costo_unitario != null ? porPresentacion(Number(c.costo_unitario), i.unidad_base) : 'sin costo',
            c?.fuente === 'referencia' ? 'costo de referencia' : null,
            Number(i.stock_minimo) ? `mínimo ${cantidad(i.stock_minimo, i.unidad_base)}` : null,
          ].filter(Boolean).join(' · '))),
        h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')));
    })),
  ];
  vaciar(cont,
    grupoTipo('ingrediente', 'Ingredientes'),
    grupoTipo('packaging', 'Packaging'),
    h('div', { class: 'acciones' }, h('a', { class: 'btn primario', href: '#/insumos/nuevo' }, '+ Nuevo insumo')));
}

async function ficha(cont, id) {
  const [cat, costo, lleva, usos, historial, costos] = await Promise.all([
    catalogo(true),
    id ? q(sb.from('v_costo_insumo').select('*').eq('insumo_id', id).maybeSingle()) : null,
    id ? q(sb.from('caja_insumos').select('insumo_id,cantidad').eq('caja_insumo_id', id)) : [],
    id ? Promise.all([
      ...['compras', 'recetas', 'tanda_consumos', 'conteos', 'caja_insumos'].map((t) => contar(t, (c) => c.eq('insumo_id', id))),
      contar('venta_lineas', (c) => c.eq('caja_insumo_id', id)),
    ]) : [0, 0, 0, 0, 0, 0],
    id ? leerHistorial(id) : null,
    q(sb.from('v_costo_insumo').select('insumo_id,costo_unitario')),
  ]);
  const costoDe = Object.fromEntries(costos.map((c) => [c.insumo_id, Number(c.costo_unitario) || 0]));
  const insumo = id ? cat.insumo(id) : null;
  if (id && !insumo) throw new Error('El insumo no existe');
  const [compras, enRecetas] = usos;
  const enUso = usos.some((n) => n > 0);
  const datos = insumo
    ? { ...insumo }
    : { nombre: '', tipo: 'ingrediente', unidad_base: 'g', stock_minimo: 0, costo_referencia: null, activo: true };

  // Packaging que lleva esta caja (solo para cajas)
  const extra = lleva.map((l) => ({ insumo_id: l.insumo_id, cantidad: Number(l.cantidad) }));
  const filasExtra = h('div');
  const totalCaja = h('p', { class: 'ayuda' });
  const otrosPackaging = cat.insumos.filter((i) => i.tipo === 'packaging' && i.id !== id
    && (i.activo || extra.some((x) => x.insumo_id === i.id)));
  // Costo de la caja con lo que lleva (papel por cm, stickers…), como lo calcula costo_caja.
  function dibujarTotal() {
    const partes = extra.filter((x) => x.insumo_id && x.cantidad > 0)
      .map((x) => ({ nombre: cat.insumo(x.insumo_id)?.nombre || '', costo: x.cantidad * (costoDe[x.insumo_id] || 0) }));
    const caja = id ? costoDe[id] || 0 : 0;
    const total = caja + partes.reduce((s, p) => s + p.costo, 0);
    totalCaja.textContent = `Costo por caja: ${[`caja ${pesos(caja)}`, ...partes.map((p) => `${p.nombre.toLowerCase()} ${pesos(p.costo)}`)].join(' + ')}`
      + ` = ${pesos(total)}`;
  }
  function dibujarExtra() {
    vaciar(filasExtra, extra.map((x, i) => {
      const unidad = h('small', {}, cat.insumo(x.insumo_id)?.unidad_base || 'un');
      const sel = h('select', { onchange: (e) => {
        x.insumo_id = e.target.value;
        unidad.textContent = cat.insumo(x.insumo_id)?.unidad_base || 'un';
        dibujarTotal();
      } },
      h('option', { value: '' }, 'Packaging…'), otrosPackaging.map((o) => h('option', { value: o.id }, o.nombre)));
      sel.value = x.insumo_id || '';
      return h('div', { class: 'receta-fila' }, sel,
        h('div', { class: 'unidad' }, h('input', { type: 'number', inputmode: 'decimal', min: 0, step: 'any', value: x.cantidad || '',
          oninput: (e) => { x.cantidad = Number(e.target.value); dibujarTotal(); } }), unidad),
        h('button', { type: 'button', class: 'quitar', 'aria-label': 'Quitar', onclick: () => { extra.splice(i, 1); dibujarExtra(); } }, '×'));
    }));
    dibujarTotal();
  }
  const esCaja = () => datos.tipo === 'packaging' && /^caja/i.test(datos.nombre || '');
  const seccionCaja = h('div', { class: 'card' },
    h('h3', {}, 'Lo que lleva cada caja'),
    h('p', { class: 'ayuda' }, 'Cada caja usada en una venta descuenta esto del stock y lo suma al costo de caja.'),
    filasExtra,
    totalCaja,
    h('button', { type: 'button', class: 'btn chico', onclick: () => { extra.push({ insumo_id: '', cantidad: 1 }); dibujarExtra(); } }, '+ Packaging'));
  const actualizarCaja = () => { seccionCaja.hidden = !esCaja(); };

  const guardar = h('button', { class: 'btn primario', type: 'button' }, id ? 'Guardar' : 'Crear insumo');
  guardar.onclick = () => conBoton(guardar, async () => {
    if (!datos.nombre.trim()) throw new Error('Poné el nombre');
    const ref = datos.costo_referencia === '' || datos.costo_referencia == null ? null : Number(datos.costo_referencia);
    const fila = {
      nombre: datos.nombre.trim(), tipo: datos.tipo, unidad_base: datos.unidad_base,
      stock_minimo: Number(datos.stock_minimo) || 0, costo_referencia: ref, activo: datos.activo,
      es_glaseado: datos.tipo === 'ingrediente' && !!datos.es_glaseado,
    };
    const guardado = id
      ? await q(sb.from('insumos').update(fila).eq('id', id).select('id').single())
      : await q(sb.from('insumos').insert(fila).select('id').single());
    if (esCaja()) {
      await rpc('guardar_packaging_caja', {
        p_caja: guardado.id,
        p_items: extra.filter((x) => x.insumo_id && x.cantidad > 0),
      });
    }
    invalidarCatalogo();
    toast(id ? 'Insumo guardado' : 'Insumo creado');
    irA(`#/insumos/${guardado.id}`);
  });

  let borrar = null;
  if (id && !enUso) {
    borrar = h('button', { class: 'btn peligro', type: 'button' }, 'Borrar insumo');
    borrar.onclick = () => conBoton(borrar, async () => {
      if (!confirm(`¿Borrar "${insumo.nombre}"?`)) return;
      await q(sb.from('insumos').delete().eq('id', id));
      invalidarCatalogo();
      toast('Insumo borrado');
      irA('#/insumos');
    });
  }

  const unidadTxt = () => datos.unidad_base;
  const ayudaRef = h('div', { class: 'ayuda' });
  const actualizarAyudaRef = () => {
    ayudaRef.textContent = `Por ${unidadTxt()}. Se usa solo si todavía no hay compras con cantidad. `
      + (datos.unidad_base === 'g' ? 'Ej.: harina a $210 los 5 kg → 0,042.'
        : datos.unidad_base === 'cm' ? 'Ej.: rollo de 7,5 m a $75 → 0,1.' : '');
  };
  actualizarAyudaRef();

  vaciar(cont,
    h('div', { class: 'card' },
      h('h1', { style: 'margin-top:0' }, insumo?.nombre || 'Nuevo insumo'),
      costo?.costo_unitario != null
        ? h('p', { class: 'ayuda' }, `Costo actual ${porPresentacion(Number(costo.costo_unitario), datos.unidad_base)}`,
          costo.fuente === 'compra'
            ? ` · última compra ${fechaLarga(costo.ultima_compra)}: ${cantidad(costo.presentacion, datos.unidad_base)} por ${pesos(costo.precio_presentacion)}`
            : ' · costo de referencia (todavía sin compras)')
        : null,
      campo('Nombre', h('input', { value: datos.nombre, oninput: (e) => { datos.nombre = e.target.value; actualizarCaja(); } })),
      enUso
        ? h('p', { class: 'ayuda' }, `Tipo y unidad no se pueden cambiar: ya se usó (${plural(compras, 'compra')}, ${plural(enRecetas, 'receta')}). `
          + 'Si cambió la presentación no hace falta: la cantidad se carga en cada compra.')
        : [
          grupo('Tipo', chips(TIPOS, datos.tipo, (v) => { datos.tipo = v; actualizarCaja(); })),
          grupo('Unidad base', chips(UNIDADES, datos.unidad_base, (v) => { datos.unidad_base = v; actualizarAyudaRef(); })),
        ],
      h('div', { class: 'fila-campos' },
        campo('Stock mínimo', h('input', { type: 'number', inputmode: 'decimal', min: 0, step: 'any', value: datos.stock_minimo,
          oninput: (e) => { datos.stock_minimo = e.target.value; } }), 'En la unidad base. Avisa cuando queda menos.'),
        campo('Costo de referencia', h('input', { type: 'number', inputmode: 'decimal', min: 0, step: 'any', value: datos.costo_referencia ?? '',
          oninput: (e) => { datos.costo_referencia = e.target.value; } }), ayudaRef)),
      datos.tipo === 'ingrediente' ? interruptor('Va en el glaseado', !!datos.es_glaseado, (v) => { datos.es_glaseado = v; },
        'Los rolls que se piden sin glaseado no lo gastan ni lo cuentan en el costo.') : null,
      interruptor('Activo', datos.activo, (v) => { datos.activo = v; }, 'Los inactivos no aparecen para comprar, contar ni en recetas nuevas.')),
    historial ? seccionHistorial(historial, insumo, cat) : null,
    seccionCaja,
    h('div', { class: 'acciones' }, guardar, borrar));
  dibujarExtra();
  actualizarCaja();
}

// ---------- Historial de precios (ideas 3.4) ----------
async function leerHistorial(id) {
  const [compras, recetas, costos, enCajas] = await Promise.all([
    q(sb.from('compras').select('fecha,creado_en,total,cantidad_base').eq('insumo_id', id).gt('cantidad_base', 0)),
    q(sb.from('recetas').select('sabor_id,cantidad').eq('insumo_id', id)),
    q(sb.from('v_costo_sabor').select('sabor_id,costo_roll')),
    q(sb.from('caja_insumos').select('caja_insumo_id,cantidad').eq('insumo_id', id)),
  ]);
  return { compras, recetas, costos: Object.fromEntries(costos.map((c) => [c.sabor_id, c.costo_roll])), enCajas };
}

function seccionHistorial({ compras, recetas, costos, enCajas }, insumo, cat) {
  // Por kg o por litro si la unidad base es g o ml, como en el resto de la ficha.
  const escala = ['g', 'ml'].includes(insumo.unidad_base) ? 1000 : insumo.unidad_base === 'cm' ? 100 : 1;
  const unidad = { g: 'kg', ml: 'L', cm: 'm' }[insumo.unidad_base] || insumo.unidad_base;
  const pts = puntos(compras);
  const titulo = h('h3', {}, 'Historial de precios');
  if (pts.length < 2) {
    return h('div', { class: 'card' }, titulo, h('p', { class: 'ayuda' }, pts.length
      ? `Hay una sola compra (${fechaLarga(pts[0].fecha)}, ${pesos(pts[0].precio * escala)}/${unidad}). Con la próxima se ve cómo cambia.`
      : 'Todavía no hay compras con cantidad.'));
  }
  const c = cambio(pts);
  const pct = c.relativo == null ? '' : `${Math.round(Math.abs(c.relativo) * 100)} %`;
  const precios = pts.map((p) => p.precio * escala);
  const [min, max] = [Math.min(...precios), Math.max(...precios)];
  const resumen = (Math.abs(c.diferencia) < 1e-9
    ? `La última compra salió igual que la primera (${fechaLarga(c.desde.fecha)}): ${pesos(c.hasta.precio * escala)}/${unidad}.`
    : `Desde la primera compra (${fechaLarga(c.desde.fecha)}) ${c.diferencia > 0 ? 'subió' : 'bajó'} ${pct}: `
      + `de ${pesos(c.desde.precio * escala)} a ${pesos(c.hasta.precio * escala)}/${unidad}.`)
    + (max - min > 1e-9 ? ` En ${pts.length} compras estuvo entre ${pesos(min)} y ${pesos(max)}.` : '');

  const grafico = linea(pts.map((p) => ({
    x: p.fecha, valor: p.precio * escala, etiqueta: fechaLarga(p.fecha), etiquetaEje: fechaLarga(p.fecha),
  })), {
    formato: pesos,
    titulo: `Precio por ${unidad} en cada compra`,
    columnasTabla: [['Compra', (d) => d.etiqueta], [`Por ${unidad}`, (d) => pesos(d.valor)]],
  });

  // Impacto: la diferencia de precio por las cantidades de hoy (recetas o lo que lleva cada caja).
  const signo = (n) => (n > 0 ? '+' : '') + pesos(n);
  let impacto = null;
  if (Math.abs(c.diferencia) >= 1e-9) {
    const porRoll = impactoPorRoll(c.diferencia, recetas, cat.sabores, costos).filter((r) => r.activo);
    const usosCaja = [
      ...(/^caja/i.test(insumo.nombre) ? [{ caja: insumo.nombre, cantidad: 1 }] : []),
      ...enCajas.map((u) => ({ caja: cat.insumo(u.caja_insumo_id)?.nombre || 'Caja', cantidad: u.cantidad })),
    ];
    const porCaja = impactoPorCaja(c.diferencia, usosCaja);
    if (porRoll.length || porCaja.length) {
      impacto = [
        h('p', { class: 'ayuda', style: 'margin:.75rem 0 .35rem' },
          `Con las ${porRoll.length ? 'recetas' : 'cajas'} de hoy, esa diferencia ${c.diferencia > 0 ? 'suma' : 'resta'}:`),
        h('table', { class: 'tabla' },
          porRoll.map((r) => h('tr', {}, h('td', {}, r.sabor),
            h('td', { class: 'num-der' }, `${signo(r.porRoll)} por roll`,
              r.relativo != null ? h('div', { class: 'ayuda' }, `${numero(Math.abs(r.relativo) * 100, 1)} % del costo de hoy`) : null))),
          porCaja.map((u) => h('tr', {}, h('td', {}, u.caja), h('td', { class: 'num-der' }, `${signo(u.porCaja)} por caja`)))),
      ];
    }
  }
  return h('div', { class: 'card' }, titulo, h('p', { class: 'ayuda' }, resumen), grafico, impacto);
}
