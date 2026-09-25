import { sb, q, rpc } from '../db.js';
import { h, vaciar, pesos, numero, fechaCorta, mesISO, nombreMes, conBoton, toast } from '../util.js';
import { irA } from '../app.js';

const stat = (etiqueta, valor, sub, destacado) =>
  h('div', { class: 'stat' + (destacado ? ' destacado' : '') },
    h('div', { class: 'etq' }, etiqueta), h('div', { class: 'num' }, valor), sub ? h('div', { class: 'sub' }, sub) : null);

export async function mostrar(cont) {
  const [panel, mes, pendientes, alertas, ultimas] = await Promise.all([
    q(sb.from('v_panel').select('*').single()),
    q(sb.from('v_resumen_mensual').select('*').eq('mes', mesISO()).maybeSingle()),
    q(sb.from('v_ventas').select('id,fecha,cliente,formatos,total').eq('estado_pago', 'pendiente').order('fecha')),
    q(sb.from('v_stock').select('nombre,teorico,stock_minimo,unidad_base').eq('reponer', true).order('nombre')),
    q(sb.from('v_ventas').select('id,fecha,cliente,formatos,sabores,total,estado_pago')
      .order('fecha', { ascending: false }).order('creado_en', { ascending: false }).limit(6)),
  ]);

  const filaVenta = (v, extra) => h('li', {},
    h('a', { class: 'fila', href: `#/ventas/${v.id}` },
      h('div', { class: 'princ' },
        h('div', { class: 't1' }, v.cliente || 'Sin cliente'),
        h('div', { class: 't2' }, `${fechaCorta(v.fecha)} · ${v.formatos || ''}${v.sabores ? ' · ' + v.sabores : ''}`)),
      h('span', { class: 'monto' }, pesos(v.total))),
    extra);

  vaciar(cont,
    h('h2', {}, `Este mes · ${nombreMes(mesISO())}`),
    h('div', { class: 'stats' },
      stat('Vendido', pesos(mes?.vendido || 0), `${mes?.ventas || 0} ventas · ${numero(mes?.rolls_vendidos || 0, 0)} rolls`, true),
      stat('Ganancia bruta', pesos(mes?.ganancia_bruta || 0), `Gastado ${pesos(mes?.total_gastado || 0)}`, true)),

    h('h2', {}, 'Total'),
    h('div', { class: 'stats' },
      stat('Vendido', pesos(panel.vendido), `Cobrado ${pesos(panel.cobrado)}`),
      stat('Pendiente de cobro', pesos(panel.pendiente), `${panel.ventas_pendientes} ventas`),
      stat('Gastado', pesos(panel.total_gastado), `Compras ${pesos(panel.compras)}`),
      stat('Ganancia bruta', pesos(panel.ganancia_bruta), 'Ventas − costo − cajas'),
      stat('Caja teórica', pesos(panel.caja_teorica), `Retiros ${pesos(panel.retiros)}`),
      stat('Capital', pesos(panel.capital), `Stock ${pesos(Number(panel.stock_ingredientes) + Number(panel.stock_packaging))}`),
      stat('Tandas', numero(panel.tandas, 1), `${numero(panel.rolls_producidos, 0)} rolls`),
      stat('Rolls vendidos', numero(panel.rolls_vendidos, 0))),

    pendientes.length ? [
      h('h2', {}, 'Pendientes de cobro'),
      h('ul', { class: 'lista' }, pendientes.map((v) => {
        const boton = h('button', { class: 'btn chico ok' }, 'Cobrada');
        boton.onclick = () => conBoton(boton, async () => {
          await rpc('actualizar_venta', { p_id: v.id, p: { estado_pago: 'pagado' } });
          toast(`Venta de ${v.cliente || 'sin cliente'} marcada como cobrada`);
          irA('#/panel');
        });
        return filaVenta(v, h('div', { class: 'acciones', style: 'margin:0 .9rem .7rem' }, boton));
      })),
    ] : null,

    alertas.length ? [
      h('h2', {}, 'Stock para reponer'),
      h('ul', { class: 'lista' }, alertas.map((a) => h('li', {}, h('a', { class: 'fila', href: '#/compras' },
        h('div', { class: 'princ' }, h('div', { class: 't1' }, a.nombre)),
        h('span', { class: 'badge alerta' }, `${numero(a.teorico)} / mín. ${numero(a.stock_minimo)} ${a.unidad_base}`))))),
    ] : null,

    h('h2', {}, 'Últimas ventas'),
    ultimas.length
      ? h('ul', { class: 'lista' }, ultimas.map((v) => filaVenta(v)))
      : h('p', { class: 'vacio' }, 'Todavía no hay ventas.'),
    h('p', { class: 'pie' }, h('a', { href: '#/ventas' }, 'Ver todas las ventas')));
}
