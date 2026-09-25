import { sb, q, rpc } from '../db.js';
import { h, vaciar, chips, campo, campoFecha, grupo, hoyISO, fechaCorta, pesos, numero, toast, conBoton } from '../util.js';
import { catalogo } from '../catalogo.js';
import { irA, refrescarSi } from '../app.js';

// Unidades que se pueden elegir según la unidad base del insumo (la primera es la de siempre).
const UNIDADES = { g: ['kg', 'g'], ml: ['L', 'ml'], un: ['un'], paq: ['paq'] };
const FACTOR = { g: 1, kg: 1000, ml: 1, L: 1000, un: 1, paq: 1 };

// Lo que se recuerda entre cargas (proveedor y fecha suelen repetirse en una misma salida).
const recordar = { fecha: null, proveedor: '' };

export async function mostrar(cont) {
  const [cat, historial, costos, proveedores] = await Promise.all([
    catalogo(),
    q(sb.from('compras').select('id,fecha,proveedor,descripcion,cantidad,unidad,total,categoria,insumos(nombre)')
      .order('fecha', { ascending: false }).order('creado_en', { ascending: false }).limit(30)),
    q(sb.from('v_costo_insumo').select('insumo_id,costo_unitario,presentacion,precio_presentacion')),
    q(sb.from('compras').select('proveedor').not('proveedor', 'is', null)),
  ]);
  const costoDe = Object.fromEntries(costos.map((c) => [c.insumo_id, c]));
  const f = { fecha: recordar.fecha || hoyISO(), insumo: '', proveedor: recordar.proveedor, descripcion: '', cantidad: '', unidad: null, total: '', notas: '' };

  const unidadesCont = h('div');
  const vistaPrevia = h('p', { class: 'ayuda' });
  const insumo = () => (f.insumo && !f.insumo.startsWith('__') ? cat.insumo(f.insumo) : null);

  function dibujarUnidades() {
    const i = insumo();
    if (!i) { vaciar(unidadesCont); f.unidad = null; return; }
    const lista = UNIDADES[i.unidad_base];
    if (!lista.includes(f.unidad)) f.unidad = lista[0];
    vaciar(unidadesCont, lista.length > 1
      ? grupo('Unidad', chips(lista.map((u) => ({ valor: u, texto: u })), f.unidad, (u) => { f.unidad = u; previa(); }))
      : null);
  }

  function previa() {
    const i = insumo();
    const cant = Number(f.cantidad);
    const total = Number(f.total);
    if (!i || !cant || !total) { vaciar(vistaPrevia); return; }
    const base = cant * FACTOR[f.unidad];
    const unitario = total / base;
    const antes = costoDe[i.id]?.costo_unitario;
    const porPresentacion = i.unidad_base === 'g' || i.unidad_base === 'ml' ? 1000 : 1;
    const txtUnidad = porPresentacion === 1000 ? (i.unidad_base === 'g' ? 'kg' : 'L') : i.unidad_base;
    vaciar(vistaPrevia,
      `= ${numero(base)} ${i.unidad_base} · ${pesos(unitario * porPresentacion)} por ${txtUnidad}`,
      antes ? ` (antes ${pesos(antes * porPresentacion)})` : '');
  }

  const selInsumo = h('select', {
    onchange: (e) => { f.insumo = e.target.value; dibujarUnidades(); previa(); },
  },
  h('option', { value: '' }, 'Elegí qué compraste…'),
  h('optgroup', { label: 'Ingredientes' },
    cat.insumos.filter((i) => i.tipo === 'ingrediente' && i.activo).map((i) => h('option', { value: i.id }, i.nombre))),
  h('optgroup', { label: 'Packaging' },
    cat.insumos.filter((i) => i.tipo === 'packaging' && i.activo).map((i) => h('option', { value: i.id }, i.nombre))),
  h('optgroup', { label: 'Otros (no entran en costos ni stock)' },
    h('option', { value: '__equipamiento' }, 'Equipamiento (balanza, moldes…)'),
    h('option', { value: '__otro' }, 'Otro')));

  const guardar = h('button', { class: 'btn primario bloque', type: 'button' }, 'Guardar compra');
  guardar.onclick = () => conBoton(guardar, async () => {
    if (!f.insumo) throw new Error('Elegí qué compraste');
    const p = {
      fecha: f.fecha, proveedor: f.proveedor, descripcion: f.descripcion, notas: f.notas,
      total: f.total === '' ? null : Number(f.total),
    };
    if (f.insumo.startsWith('__')) {
      p.categoria = f.insumo.slice(2);
      if (!f.descripcion.trim()) throw new Error('Poné una descripción');
    } else {
      Object.assign(p, { insumo_id: f.insumo, cantidad: f.cantidad === '' ? null : Number(f.cantidad), unidad: f.unidad });
    }
    const r = await rpc('registrar_compra', { p });
    Object.assign(recordar, { fecha: f.fecha, proveedor: f.proveedor });
    toast(`Compra guardada: ${pesos(p.total)}`, {
      accion: {
        texto: 'Deshacer',
        fn: async () => { await q(sb.from('compras').delete().eq('id', r.compra_id)); toast('Compra deshecha'); refrescarSi('#/compras'); },
      },
    });
    irA('#/compras');
  });

  vaciar(cont,
    h('div', { class: 'card' },
      campoFecha(f.fecha, (v) => { f.fecha = v; }),
      campo('Qué', selInsumo),
      campo('Descripción', h('input', { placeholder: 'Harina Uruguay 0000', oninput: (e) => { f.descripcion = e.target.value; } })),
      campo('Proveedor', h('input', { value: f.proveedor, list: 'lista-proveedores', oninput: (e) => { f.proveedor = e.target.value; } })),
      h('datalist', { id: 'lista-proveedores' },
        [...new Set(proveedores.map((p) => p.proveedor))].sort().map((p) => h('option', { value: p }))),
      h('div', { class: 'fila-campos' },
        campo('Cantidad', h('input', { type: 'number', inputmode: 'decimal', min: 0, step: 'any', oninput: (e) => { f.cantidad = e.target.value; previa(); } })),
        campo('Total pagado', h('input', { type: 'number', inputmode: 'decimal', min: 0, step: '0.01', oninput: (e) => { f.total = e.target.value; previa(); } }))),
      unidadesCont,
      vistaPrevia,
      campo('Notas', h('input', { oninput: (e) => { f.notas = e.target.value; } })),
      guardar),

    h('h2', {}, 'Últimas compras'),
    historial.length
      ? h('ul', { class: 'lista' }, historial.map((c) => {
        const borrar = h('button', { class: 'btn chico peligro' }, 'Borrar');
        borrar.onclick = () => conBoton(borrar, async () => {
          if (!confirm(`¿Borrar la compra "${c.descripcion || c.insumos?.nombre}" del ${fechaCorta(c.fecha)}?`)) return;
          await q(sb.from('compras').delete().eq('id', c.id));
          toast('Compra borrada');
          irA('#/compras');
        });
        return h('li', {}, h('div', { class: 'fila' },
          h('div', { class: 'princ' },
            h('div', { class: 't1' }, c.descripcion || c.insumos?.nombre || c.categoria),
            h('div', { class: 't2' }, [fechaCorta(c.fecha), c.proveedor,
              c.cantidad ? `${numero(c.cantidad)} ${c.unidad || ''}` : null].filter(Boolean).join(' · '))),
          h('span', { class: 'monto' }, pesos(c.total)),
          borrar));
      }))
      : h('p', { class: 'vacio' }, 'Todavía no hay compras.'));
}
