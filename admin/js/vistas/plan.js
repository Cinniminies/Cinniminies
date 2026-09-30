import { sb, q, rpc } from '../db.js';
import {
  h, vaciar, chips, stepper, campo, numero, plural, fechaCorta, proximoSabado, toast, conBoton, debounce,
} from '../util.js';
import { catalogo } from '../catalogo.js';
import { irA } from '../app.js';
import { subnavProduccion } from '../componentes.js';
import { cargarPlan } from './comprar.js';

// 3.1 + 3.2 Plan de horneado: con las ventas marcadas "Por hacer" (cobradas o no), cuántas tandas hacer.
// El cálculo lo hace plan_horneado en la base: masa propia (Oreo) aparte; los sabores de masa compartida
// arman tandas enteras y lo que sobra va a una tanda mezclada, completada con el sabor elegido.
// Lo elegido acá sobrevive si se sale de la pantalla y se vuelve.
const estado = { fecha: null, excluidas: new Set(), extra: {}, completar: null };

export async function mostrar(cont) {
  const [cat, recetas, porHacer, pedidosNuevos] = await Promise.all([
    catalogo(),
    q(sb.from('recetas').select('sabor_id')),
    q(sb.from('v_ventas').select('id,fecha,cliente,sabores,rolls,estado_pago')
      .eq('por_hacer', true).order('fecha').order('creado_en')),
    q(sb.from('pedidos').select('id').eq('estado', 'nuevo')),
  ]);
  if (!estado.fecha || estado.fecha < proximoSabado()) estado.fecha = proximoSabado();
  // Las que ya no están por hacer no se recuerdan
  for (const id of estado.excluidas) if (!porHacer.some((v) => v.id === id)) estado.excluidas.delete(id);

  const sabores = cat.saboresActivos.filter((s) => recetas.some((r) => r.sabor_id === s.id));
  const compartidos = sabores.filter((s) => !s.masa_propia);
  const incluidas = () => porHacer.filter((v) => !estado.excluidas.has(v.id)).map((v) => v.id);
  const payload = () => ({
    ventas: incluidas(),
    extra: Object.fromEntries(Object.entries(estado.extra).filter(([, n]) => n > 0)),
    completar: estado.completar,
  });

  const resultado = h('div');
  let pedido = 0;
  let plan = null;

  const calcular = debounce(async () => {
    const este = ++pedido;
    try {
      const r = await rpc('plan_horneado', { p: payload() });
      if (este !== pedido) return;
      plan = r;
      dibujarResultado();
    } catch (e) {
      if (este === pedido) vaciar(resultado, h('p', { class: 'mensaje-error' }, e.message));
    }
  }, 200);

  function dibujarResultado() {
    if (!plan.sabores.length) {
      plan = null;
      vaciar(resultado, h('p', { class: 'vacio' }, 'No hay nada para hornear: elegí pedidos o sumá rolls extra.'));
      return;
    }
    const hayMezcla = plan.tandas.some((t) => t.tipo === 'mezcla');
    const verComprar = h('button', { class: 'btn', type: 'button' }, 'Ver qué comprar');
    verComprar.onclick = () => {
      cargarPlan(Object.fromEntries(plan.sabores.map((s) => [s.sabor_id, Number(s.tandas)])));
      irA('#/comprar');
    };
    const registrar = h('button', { class: 'btn primario', type: 'button' }, 'Registrar horneado');
    registrar.onclick = () => conBoton(registrar, async () => {
      const n = incluidas().length;
      if (!confirm(`¿Registrar ${plural(plan.total_tandas, 'tanda')} con fecha ${fechaCorta(estado.fecha)}?`
        + (n ? ` ${plural(n, 'pedido pasa', 'pedidos pasan')} a hecho.` : ''))) return;
      const r = await rpc('registrar_horneado', { p: { ...payload(), fecha: estado.fecha } });
      estado.excluidas.clear();
      estado.extra = {};
      toast(`Horneado registrado: ${plural(r.total_tandas, 'tanda')}`
        + (r.ventas_hechas ? ` · ${plural(r.ventas_hechas, 'pedido hecho', 'pedidos hechos')}` : ''));
      irA('#/tandas');
    });

    vaciar(resultado,
      h('h2', {}, `${plural(plan.total_tandas, 'tanda')} para el ${fechaCorta(estado.fecha)}`),
      h('ul', { class: 'lista' }, plan.tandas.map((t) => h('li', {}, h('div', { class: 'fila' },
        h('div', { class: 'princ' },
          t.tipo === 'sola'
            ? h('div', { class: 't1' }, `${t.cantidad} × ${t.sabores[0].nombre}`)
            : h('div', { class: 't1' }, 'Tanda mezclada ', h('span', { class: 'badge neutro' }, 'una masa')),
          h('div', { class: 't2' }, t.tipo === 'sola'
            ? `${t.rolls} rolls`
            : t.sabores.map((s) => `${s.nombre} ${s.rolls}`).join(' · '))))))),
      hayMezcla && compartidos.length > 1 ? h('div', { class: 'card' },
        h('div', { class: 'campo' }, h('span', { class: 'etq-grupo' }, 'Completar la tanda mezclada con'),
          chips(compartidos.map((s) => ({ valor: s.id, texto: s.nombre })), plan.completar,
            (v) => { estado.completar = v; calcular(); })),
        h('p', { class: 'ayuda', style: 'margin:0' }, 'La masa rinde la tanda entera: los lugares libres van para vender.')) : null,
      h('table', { class: 'tabla card' },
        h('tr', {}, h('th', {}, 'Sabor'), h('th', { class: 'num-der' }, 'Pedidos'), h('th', { class: 'num-der' }, 'Hacés'),
          h('th', { class: 'num-der' }, 'Para vender'), h('th', { class: 'num-der' }, 'Receta')),
        plan.sabores.map((s) => h('tr', {}, h('td', {}, s.nombre),
          h('td', { class: 'num-der' }, s.pedidos),
          h('td', { class: 'num-der' }, h('strong', {}, s.rolls)),
          h('td', { class: 'num-der' }, s.para_vender || '—'),
          h('td', { class: 'num-der' }, `× ${numero(s.tandas)}`)))),
      h('p', { class: 'ayuda' }, '"Receta" es cuántas veces la receta de ese sabor se usa (una tanda mezclada usa una parte de cada una). '
        + 'Con eso se calcula qué comprar y se descuenta el stock al registrar.'),
      h('div', { class: 'acciones' }, verComprar, registrar));
  }

  const fecha = h('input', {
    type: 'date', value: estado.fecha, required: true,
    onchange: (e) => { estado.fecha = e.target.value || proximoSabado(); if (plan) dibujarResultado(); },
  });

  const listaPedidos = porHacer.length
    ? h('div', {}, porHacer.map((v) => h('label', { class: 'interruptor' },
      h('input', {
        type: 'checkbox', checked: !estado.excluidas.has(v.id),
        onchange: (e) => { if (e.target.checked) estado.excluidas.delete(v.id); else estado.excluidas.add(v.id); calcular(); },
      }),
      h('span', {}, h('strong', {}, v.cliente || 'Sin cliente'), ` · ${fechaCorta(v.fecha)} `,
        h('span', { class: 'badge ' + (v.estado_pago === 'pagado' ? 'ok' : 'pendiente') },
          v.estado_pago === 'pagado' ? 'Cobrado' : 'Sin cobrar'),
        h('small', {}, `${v.sabores || ''} · `, h('a', { href: `#/ventas/${v.id}` }, 'ver venta'))))))
    : h('p', { class: 'vacio', style: 'padding:0' }, 'No hay ventas por hacer. Al cargar una venta, elegí "Por hacer"; '
      + 'los pedidos web confirmados entran solos.');

  vaciar(cont,
    subnavProduccion('plan'),
    h('div', { class: 'card' },
      campo('Día de horneado', fecha),
      pedidosNuevos.length ? h('p', { class: 'ayuda' }, h('a', { href: '#/pedidos' },
        `${plural(pedidosNuevos.length, 'pedido web', 'pedidos web')} sin confirmar`), ': confirmalos para que entren al plan.') : null),
    h('div', { class: 'card' },
      h('h3', {}, 'Pedidos por hacer'),
      h('p', { class: 'ayuda' }, 'Destildá los que no vas a hacer esta vez (por ejemplo, si todavía no pagaron).'),
      listaPedidos),
    h('div', { class: 'card' },
      h('h3', {}, 'Rolls extra para vender'),
      sabores.map((s) => h('div', { class: 'stepper-fila' },
        h('div', { class: 'nombre' }, s.nombre, s.masa_propia ? h('div', { class: 'ayuda' }, 'Masa propia') : null),
        stepper(estado.extra[s.id] || 0, (v) => { estado.extra[s.id] = v; calcular(); }, { min: 0, max: 48, paso: 6 })))),
    resultado);
  vaciar(resultado, h('p', { class: 'cargando' }, 'Calculando…'));
  calcular();
}
