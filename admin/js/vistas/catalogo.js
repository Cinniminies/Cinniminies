import { sb, q } from '../db.js';
import { h, vaciar, pesos, numero } from '../util.js';
import { pesas, composicion } from '../graficos.js';

// Costos y márgenes vigentes (salen de las vistas de la base).
export async function mostrar(cont) {
  const [costos, margenes] = await Promise.all([
    q(sb.from('v_costo_sabor').select('*').eq('activo', true).order('nombre')),
    q(sb.from('v_margen_formato').select('*').order('formato').order('sabor')),
  ]);
  const margen = (m) => (m == null ? '—' : pesos(m));
  const porc = (parte, total) => (total > 0 ? `${numero((100 * parte) / total, 0)} %` : '—');

  // Roll suelto: costo y precio sobre la misma regla; el tramo entre los dos es lo que queda.
  const conPrecio = costos.filter((c) => Number(c.precio_unidad) > 0);
  const grafRoll = conPrecio.length ? h('div', { class: 'card' }, pesas(conPrecio.map((c) => ({
    etiqueta: c.nombre, href: `#/sabores/${c.sabor_id}`, desde: Number(c.costo_roll), hasta: Number(c.precio_unidad),
  })), {
    titulo: 'De cada roll suelto, cuánto queda',
    nombres: ['Costo', 'Precio'],
    formato: (v) => pesos(v >= 100 ? Math.round(v) : Math.round(v * 10) / 10),
    nota: (d) => ({ valor: pesos(Math.round(d.hasta - d.desde)), sub: `${porc(d.hasta - d.desde, d.hasta)} queda` }),
  })) : null;

  // Cajas: en qué se va el precio (rolls, empaque y lo que queda), agrupadas por formato.
  const porFormato = new Map();
  for (const m of margenes.filter((x) => Number(x.precio) > 0)) {
    if (!porFormato.has(m.formato)) porFormato.set(m.formato, []);
    porFormato.get(m.formato).push({
      etiqueta: m.sabor, formato: m.formato, total: Number(m.precio),
      valores: { rolls: Number(m.costo_rolls), empaque: Number(m.costo_caja), queda: Number(m.margen) },
    });
  }
  const grafCajas = porFormato.size ? h('div', { class: 'card' }, composicion(
    [...porFormato].map(([titulo, filas]) => ({ titulo, filas })), {
      titulo: 'En qué se va el precio de cada caja',
      partes: [
        { clave: 'rolls', nombre: 'Rolls', color: 'var(--serie-1)' },
        { clave: 'empaque', nombre: 'Caja y empaque', color: 'var(--serie-2)' },
        { clave: 'queda', nombre: 'Queda', color: 'var(--serie-3)' },
      ],
      formato: (v) => pesos(Math.round(v)),
    })) : null;

  vaciar(cont,
    h('div', { class: 'graficos' }, grafRoll, grafCajas),
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
