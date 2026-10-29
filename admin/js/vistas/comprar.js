import { sb, q, rpc } from '../db.js';
import {
  h, vaciar, stepper, pesos, numero, cantidad, debounce, sumar, diaMes, proximoSabado, sumarDias, compartirWhatsapp,
} from '../util.js';
import { catalogo } from '../catalogo.js';
import { textoPanel } from '../textos.js';
import { subnavProduccion, filaLista, monto, pastilla } from '../componentes.js';

// 5.8 "¿Qué compro?": tandas planeadas por sabor → qué falta comprar contra el stock teórico,
// redondeado a la presentación de la última compra de cada insumo.
let plan = {};
let desdePlan = false;
let cajas = {};   // { insumo_id: cantidad }: las cajas y el packaging de los pedidos del plan
let fechaPlan = null;

// Desde Producción → Plan: las tandas de cada sabor (con fracciones si hay tanda mezclada), las cajas y el día de horneado.
export function cargarPlan(tandas, { cajas: cajasPlan = {}, fecha = null } = {}) {
  plan = { ...tandas };
  cajas = { ...cajasPlan };
  fechaPlan = fecha;
  desdePlan = true;
}

// "2 × 1 kg": los paquetes de la última compra que cubren lo que falta.
const paquetes = (f) => `${f.paquetes} × ${cantidad(f.presentacion, f.unidad)}`;

// Lo que hay que comprar, en un mensaje de WhatsApp para mandarse uno mismo: se compra el viernes para el
// horneado del sábado. Por insumo: qué comprar, cuánto se usa y cuánto hay, para decidir si llevar de más.
function mensajeCompras(comprar, total) {
  const sabado = proximoSabado(fechaPlan || undefined);
  const titulo = textoPanel('panel.compras_whatsapp', 'Compras del viernes {viernes} para hornear el sábado {sabado}',
    { viernes: diaMes(sumarDias(sabado, -1)), sabado: diaMes(sabado) });
  const lineas = comprar.map((f) => `• *${f.insumo}*: comprar ${f.paquetes ? paquetes(f) : cantidad(f.faltante, f.unidad)}\n`
    + `   se usan ${cantidad(f.necesario, f.unidad)} · tenés ${cantidad(f.stock, f.unidad)}`);
  return [`*${titulo}*`, '', ...lineas, '', `Total estimado: ${pesos(total)}`].join('\n');
}

export async function mostrar(cont) {
  const [cat, recetas] = await Promise.all([catalogo(), q(sb.from('recetas').select('sabor_id'))]);
  const sabores = cat.saboresActivos.filter((s) => recetas.some((r) => r.sabor_id === s.id));
  const resultado = h('div');
  let pedido = 0;

  const calcular = debounce(async () => {
    const este = ++pedido;
    const p = Object.fromEntries(Object.entries(plan).filter(([, t]) => t > 0));
    if (!Object.keys(p).length && !Object.keys(cajas).length) {
      vaciar(resultado, h('p', { class: 'vacio' }, 'Elegí cuántas tandas vas a hacer de cada sabor.'));
      return;
    }
    try {
      const filas = await rpc('que_comprar', { p, p_cajas: cajas });
      if (este !== pedido) return;
      const comprar = filas.filter((f) => Number(f.faltante) > 0);
      const total = sumar(comprar, (f) => f.costo_estimado);
      vaciar(resultado,
        h('h2', {}, comprar.length ? `Comprar · ${pesos(total)}` : 'Tenés todo'),
        ...(comprar.length ? [
          h('div', { class: 'acciones' }, h('a', {
            class: 'btn', href: compartirWhatsapp(mensajeCompras(comprar, total)), target: '_blank', rel: 'noopener',
          }, 'Mandar por WhatsApp')),
          h('ul', { class: 'lista' }, comprar.map((f) => filaLista({
            titulo: f.insumo,
            detalle: f.paquetes
              ? [paquetes(f), `faltan ${cantidad(f.faltante, f.unidad)}`]
              : `faltan ${cantidad(f.faltante, f.unidad)} (sin compras anteriores: costo estimado)`,
            derecha: monto(pesos(f.costo_estimado)),
          }))),
        ] : []),
        h('h2', {}, 'Detalle'),
        h('table', { class: 'tabla card' },
          h('tr', {}, h('th', {}, 'Insumo'), h('th', { class: 'num-der' }, 'Necesitás'), h('th', { class: 'num-der' }, 'Tenés'),
            h('th', { class: 'num-der' }, 'Faltan')),
          filas.map((f) => h('tr', {}, h('td', {}, f.insumo),
            h('td', { class: 'num-der' }, cantidad(f.necesario, f.unidad)),
            h('td', { class: 'num-der' }, cantidad(f.stock, f.unidad)),
            h('td', { class: 'num-der' }, Number(f.faltante) > 0
              ? pastilla('alerta', cantidad(f.faltante, f.unidad)) : '—')))),
        h('p', { class: 'ayuda' }, '"Tenés" es el stock teórico (las cajas de los pedidos por hacer cuentan como disponibles). '
          + 'Si hace mucho que no cuentan, cargá un conteo en Stock.'));
    } catch (e) {
      if (este === pedido) vaciar(resultado, h('p', { class: 'mensaje-error' }, e.message));
    }
  }, 250);

  const notaCajas = Object.keys(cajas).length ? h('p', { class: 'ayuda' }, 'Incluye las cajas y el packaging de los pedidos del plan. ',
    h('button', { class: 'link', type: 'button', onclick: () => { cajas = {}; notaCajas.remove(); calcular(); } }, 'Quitarlas')) : null;

  vaciar(cont,
    subnavProduccion('comprar'),
    h('div', { class: 'card' },
      h('h3', {}, 'Tandas que vas a hacer'),
      desdePlan ? h('p', { class: 'ayuda' }, 'Cargadas desde el ', h('a', { href: '#/plan' }, 'plan de horneado'),
        '. Una tanda mezclada cuenta como una parte de la receta de cada sabor.') : null,
      notaCajas,
      sabores.map((s) => h('div', { class: 'stepper-fila' },
        h('div', { class: 'nombre' }, s.nombre),
        stepper(plan[s.id] || 0, (v) => { plan[s.id] = v; desdePlan = false; calcular(); },
          { min: 0, max: 20, formato: (v) => numero(v) })))),
    resultado);
  calcular();
}
