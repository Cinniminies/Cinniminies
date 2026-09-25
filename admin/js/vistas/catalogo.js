import { sb, q } from '../db.js';
import { h, vaciar, pesos, numero } from '../util.js';

// Costos y márgenes vigentes (salen de las vistas de la base).
export async function mostrar(cont) {
  const [costos, margenes] = await Promise.all([
    q(sb.from('v_costo_sabor').select('*').eq('activo', true).order('nombre')),
    q(sb.from('v_margen_formato').select('*').order('formato').order('sabor')),
  ]);
  const margen = (m) => (m == null ? '—' : pesos(m));

  vaciar(cont,
    h('h2', { class: 'seccion-titulo' }, 'Costo por sabor'),
    h('table', { class: 'tabla card' },
      h('tr', {}, h('th', {}, 'Sabor'), h('th', { class: 'num-der' }, 'Tanda'), h('th', { class: 'num-der' }, 'Roll'),
        h('th', { class: 'num-der' }, 'Unidad'), h('th', { class: 'num-der' }, 'Margen')),
      costos.map((c) => h('tr', {},
        h('td', {}, h('a', { href: `#/sabores/${c.sabor_id}` }, c.nombre)),
        h('td', { class: 'num-der' }, pesos(c.costo_tanda)),
        h('td', { class: 'num-der' }, pesos(c.costo_roll)),
        h('td', { class: 'num-der' }, pesos(c.precio_unidad)),
        h('td', { class: 'num-der' }, margen(c.margen_unidad))))),
    h('p', { class: 'ayuda' }, 'Con los precios de la última compra de cada insumo. "Unidad" es el precio de un roll suelto.'),

    h('h2', { class: 'seccion-titulo' }, 'Margen por caja'),
    h('table', { class: 'tabla card' },
      h('tr', {}, h('th', {}, 'Caja'), h('th', { class: 'num-der' }, 'Precio'), h('th', { class: 'num-der' }, 'Costo'),
        h('th', { class: 'num-der' }, 'Margen')),
      margenes.map((m) => h('tr', {},
        h('td', {}, `${m.formato} ${m.sabor}`),
        h('td', { class: 'num-der' }, pesos(m.precio)),
        h('td', { class: 'num-der' }, pesos(Number(m.costo_rolls) + Number(m.costo_caja))),
        h('td', { class: 'num-der' }, h('strong', {}, margen(m.margen), m.precio > 0 && m.margen != null
          ? h('span', { class: 'sub' }, `${numero(100 * m.margen / m.precio, 0)}%`) : null))))),
    h('p', { class: 'ayuda' }, 'Costo = rolls + caja + papel manteca + sticker.'));
}
