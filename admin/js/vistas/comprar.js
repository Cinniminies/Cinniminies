import { sb, q, rpc } from '../db.js';
import { h, vaciar, stepper, pesos, cantidad, debounce } from '../util.js';
import { catalogo } from '../catalogo.js';
import { subnavProduccion } from '../componentes.js';

// 5.8 "¿Qué compro?": tandas planeadas por sabor → qué falta comprar contra el stock teórico,
// redondeado a la presentación de la última compra de cada insumo.
const plan = {};

export async function mostrar(cont) {
  const [cat, recetas] = await Promise.all([catalogo(), q(sb.from('recetas').select('sabor_id'))]);
  const sabores = cat.saboresActivos.filter((s) => recetas.some((r) => r.sabor_id === s.id));
  const resultado = h('div');
  let pedido = 0;

  const calcular = debounce(async () => {
    const este = ++pedido;
    const p = Object.fromEntries(Object.entries(plan).filter(([, t]) => t > 0));
    if (!Object.keys(p).length) {
      vaciar(resultado, h('p', { class: 'vacio' }, 'Elegí cuántas tandas vas a hacer de cada sabor.'));
      return;
    }
    try {
      const filas = await rpc('que_comprar', { p });
      if (este !== pedido) return;
      const comprar = filas.filter((f) => Number(f.faltante) > 0);
      const total = comprar.reduce((a, f) => a + Number(f.costo_estimado), 0);
      vaciar(resultado,
        h('h2', {}, comprar.length ? `Comprar · ${pesos(total)}` : 'Tenés todo'),
        comprar.length ? h('ul', { class: 'lista' }, comprar.map((f) => h('li', {}, h('div', { class: 'fila' },
          h('div', { class: 'princ' },
            h('div', { class: 't1' }, f.insumo),
            h('div', { class: 't2' }, f.paquetes
              ? `${f.paquetes} × ${cantidad(f.presentacion, f.unidad)} · faltan ${cantidad(f.faltante, f.unidad)}`
              : `faltan ${cantidad(f.faltante, f.unidad)} (sin compras anteriores: costo estimado)`)),
          h('span', { class: 'monto' }, pesos(f.costo_estimado)))))) : null,
        h('h2', {}, 'Detalle'),
        h('table', { class: 'tabla card' },
          h('tr', {}, h('th', {}, 'Insumo'), h('th', { class: 'num-der' }, 'Necesitás'), h('th', { class: 'num-der' }, 'Tenés'),
            h('th', { class: 'num-der' }, 'Faltan')),
          filas.map((f) => h('tr', {}, h('td', {}, f.insumo),
            h('td', { class: 'num-der' }, cantidad(f.necesario, f.unidad)),
            h('td', { class: 'num-der' }, cantidad(f.stock, f.unidad)),
            h('td', { class: 'num-der' }, Number(f.faltante) > 0
              ? h('span', { class: 'badge alerta' }, cantidad(f.faltante, f.unidad)) : '—')))),
        h('p', { class: 'ayuda' }, '"Tenés" es el stock teórico. Si hace mucho que no cuentan, cargá un conteo en Stock.'));
    } catch (e) {
      if (este === pedido) vaciar(resultado, h('p', { class: 'mensaje-error' }, e.message));
    }
  }, 250);

  vaciar(cont,
    subnavProduccion('comprar'),
    h('div', { class: 'card' },
      h('h3', {}, 'Tandas que vas a hacer'),
      sabores.map((s) => h('div', { class: 'stepper-fila' },
        h('div', { class: 'nombre' }, s.nombre),
        stepper(plan[s.id] || 0, (v) => { plan[s.id] = v; calcular(); }, { min: 0, max: 20 })))),
    resultado);
  calcular();
}
