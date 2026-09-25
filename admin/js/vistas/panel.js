import { sb, q, rpc } from '../db.js';
import { h, vaciar, chips, pesos, numero, fechaCorta, mesISO, nombreMes, hoyISO, conBoton, toast, plural } from '../util.js';
import { icono } from '../iconos.js';
import { columnas, barras, variacion } from '../graficos.js';
import { irA, sesion } from '../app.js';

const PERIODOS = [{ valor: 'mes', texto: 'Este mes' }, { valor: 'anterior', texto: 'Mes pasado' }, { valor: 'todo', texto: 'Todo' }];
let periodo = 'mes';

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
// Primer día del mes que está `n` meses antes de `mes` (ISO 'AAAA-MM-01').
function mesesAntes(mes, n) {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 - n, 1)).toISOString().slice(0, 10);
}
const nombreCorto = (mes) => MESES_CORTOS[Number(mes.slice(5, 7)) - 1];
const soloMes = (mes) => nombreMes(mes).split(' ')[0];

export async function mostrar(cont) {
  const actual = mesISO();
  // El mes en curso se compara contra el mismo tramo del mes anterior (del 1 al día de hoy),
  // no contra el mes anterior completo, que siempre parecería más grande.
  const dia = Number(hoyISO().slice(8, 10));
  const inicioAnterior = mesesAntes(actual, 1);
  const finAnterior = new Date(Date.UTC(Number(inicioAnterior.slice(0, 4)), Number(inicioAnterior.slice(5, 7)) - 1,
    Math.min(dia, new Date(Date.UTC(Number(actual.slice(0, 4)), Number(actual.slice(5, 7)) - 1, 0)).getUTCDate()))).toISOString().slice(0, 10);
  const [resumen, total, pendientes, alertas, ultimas, tramoAnterior, pedidosNuevos] = await Promise.all([
    q(sb.from('v_resumen_mensual').select('*').order('mes')),
    q(sb.from('v_panel').select('*').single()),
    q(sb.from('v_ventas').select('id,fecha,cliente,formatos,total').eq('estado_pago', 'pendiente').order('fecha')),
    q(sb.from('v_stock').select('nombre').eq('reponer', true).order('nombre')),
    q(sb.from('v_ventas').select('id,fecha,cliente,formatos,sabores,total,estado_pago')
      .order('fecha', { ascending: false }).order('creado_en', { ascending: false }).limit(5)),
    q(sb.from('v_ventas').select('total,ganancia,rolls,tipo').gte('fecha', inicioAnterior).lte('fecha', finAnterior)),
    q(sb.from('pedidos').select('nombre,total').eq('estado', 'nuevo').order('creado_en')),
  ]);
  const cuentan = tramoAnterior.filter((v) => v.tipo !== 'regalo');
  const mismoTramo = {
    mes: inicioAnterior,
    vendido: cuentan.reduce((a, v) => a + Number(v.total), 0),
    ventas: cuentan.length,
    rolls_vendidos: tramoAnterior.reduce((a, v) => a + Number(v.rolls), 0),
    ganancia_bruta: tramoAnterior.reduce((a, v) => a + Number(v.ganancia), 0),
  };
  const deMes = (mes) => resumen.find((r) => r.mes === mes)
    || { mes, vendido: 0, ventas: 0, rolls_vendidos: 0, ganancia_bruta: 0, total_gastado: 0 };

  // ---- accesos rápidos y tareas (no dependen del período)
  const acceso = (href, ico, texto) => h('a', { class: 'acceso', href }, h('span', { class: 'acceso-ico' }, icono(ico)), texto);
  const hoy = new Date(`${hoyISO()}T12:00:00`).toLocaleDateString('es-UY', { weekday: 'long', day: 'numeric', month: 'long' });

  const tareas = [];
  if (pedidosNuevos.length) {
    tareas.push(h('a', { class: 'card tarea tarea-link', href: '#/pedidos' },
      h('div', { class: 'tarea-cab' }, icono('carrito'),
        h('div', {}, h('strong', {}, `${plural(pedidosNuevos.length, 'pedido nuevo', 'pedidos nuevos')} de la web`),
          h('div', { class: 'ayuda' }, pedidosNuevos.map((p) => `${p.nombre} ${pesos(p.total)}`).join(' · ')))),
      icono('derecha', 'icono chev')));
  }
  if (pendientes.length) {
    tareas.push(h('div', { class: 'card tarea' },
      h('div', { class: 'tarea-cab' }, icono('reloj'),
        h('div', {}, h('strong', {}, `${plural(pendientes.length, 'venta pendiente', 'ventas pendientes')} de cobro`),
          h('div', { class: 'ayuda' }, pesos(pendientes.reduce((a, v) => a + Number(v.total), 0))))),
      h('ul', { class: 'lista plana' }, pendientes.map((v) => {
        const boton = h('button', { class: 'btn chico ok', type: 'button', 'aria-label': `Marcar cobrada la venta de ${v.cliente || 'sin cliente'}` }, 'Cobrada');
        boton.onclick = () => conBoton(boton, async () => {
          await rpc('actualizar_venta', { p_id: v.id, p: { estado_pago: 'pagado' } });
          toast(`Venta de ${v.cliente || 'sin cliente'} marcada como cobrada`);
          irA('#/panel');
        });
        return h('li', { class: 'fila' },
          h('a', { class: 'princ', href: `#/ventas/${v.id}` },
            h('div', { class: 't1' }, v.cliente || 'Sin cliente'),
            h('div', { class: 't2' }, `${fechaCorta(v.fecha)} · ${v.formatos || ''} · ${pesos(v.total)}`)),
          boton);
      }))));
  }
  if (alertas.length) {
    tareas.push(h('a', { class: 'card tarea tarea-link', href: '#/stock' },
      h('div', { class: 'tarea-cab' }, icono('alerta'),
        h('div', {}, h('strong', {}, `${plural(alertas.length, 'insumo', 'insumos')} para reponer`),
          h('div', { class: 'ayuda' }, alertas.map((a) => a.nombre).join(', ')))),
      icono('derecha', 'icono chev')));
  }

  // ---- resumen del período elegido
  const contPeriodo = h('div');
  function dibujarPeriodo() {
    const mesSel = periodo === 'mes' ? actual : periodo === 'anterior' ? mesesAntes(actual, 1) : null;
    const datos = mesSel ? deMes(mesSel) : {
      vendido: total.vendido, ventas: total.ventas, rolls_vendidos: total.rolls_vendidos,
      ganancia_bruta: total.ganancia_bruta, total_gastado: total.total_gastado,
    };
    const previo = periodo === 'mes' ? mismoTramo : mesSel ? deMes(mesesAntes(mesSel, 1)) : null;
    const contra = periodo === 'mes'
      ? `1–${Number(finAnterior.slice(8, 10))} de ${soloMes(inicioAnterior)}`
      : previo ? soloMes(previo.mes) : null;
    const vendido = Number(datos.vendido);
    const ganancia = Number(datos.ganancia_bruta);
    const margen = vendido > 0 ? Math.round((100 * ganancia) / vendido) : null;
    const ticket = Number(datos.ventas) > 0 ? vendido / Number(datos.ventas) : null;

    const kpi = (etiqueta, valor, sub, delta) => h('div', { class: 'stat' },
      h('div', { class: 'etq' }, etiqueta), h('div', { class: 'num' }, valor),
      sub ? h('div', { class: 'sub' }, sub) : null, delta);

    // Últimos 6 meses (con ceros si en alguno no hubo ventas)
    const seis = Array.from({ length: 6 }, (_, i) => deMes(mesesAntes(actual, 5 - i)));
    const grafico = columnas(seis.map((r) => ({
      etiqueta: nombreCorto(r.mes),
      etiquetaLarga: nombreMes(r.mes),
      valor: Number(r.vendido),
      destacado: r.mes === (mesSel || actual),
      filas: [['Ganancia bruta', pesos(r.ganancia_bruta)], ['Ventas', numero(r.ventas, 0)], ['Rolls', numero(r.rolls_vendidos, 0)]],
    })), {
      titulo: 'Vendido por mes',
      formato: (v) => (v >= 10000 ? `$${numero(v / 1000, 1)} mil` : pesos(v)),
      columnasTabla: [
        ['Mes', (d) => d.etiquetaLarga],
        ['Vendido', (d) => pesos(d.valor)],
        ['Ganancia', (d) => d.filas[0][1]],
        ['Ventas', (d) => d.filas[1][1]],
      ],
    });

    const porSabor = h('div', {}, h('p', { class: 'ayuda' }, 'Cargando rolls por sabor…'));
    let consulta = sb.from('v_ventas_sabores').select('sabor,unidades');
    if (mesSel) consulta = consulta.eq('mes', mesSel);
    q(consulta).then((filas) => {
      const suma = {};
      for (const f of filas) suma[f.sabor] = (suma[f.sabor] || 0) + f.unidades;
      vaciar(porSabor, barras(Object.entries(suma).map(([etiqueta, valor]) => ({ etiqueta, valor })), {
        titulo: 'Rolls vendidos por sabor',
        formato: (v) => numero(v, 0),
        vacio: 'No hubo ventas en este período.',
      }));
    }).catch((e) => vaciar(porSabor, h('p', { class: 'mensaje-error' }, e.message)));

    vaciar(contPeriodo,
      h('div', { class: 'hero' },
        h('div', { class: 'etq' }, mesSel ? `Vendido en ${nombreMes(mesSel)}` : 'Vendido desde el principio'),
        h('div', { class: 'hero-num' }, pesos(vendido)),
        previo ? variacion(vendido, Number(previo.vendido), contra) : null),
      h('div', { class: 'stats' },
        kpi('Ganancia bruta', pesos(ganancia), margen != null ? `${margen} % de lo vendido` : null,
          previo ? variacion(ganancia, Number(previo.ganancia_bruta), contra) : null),
        kpi('Ventas', numero(datos.ventas, 0), `${numero(datos.rolls_vendidos, 0)} rolls`,
          previo ? variacion(Number(datos.ventas), Number(previo.ventas), contra) : null),
        kpi('Ticket promedio', ticket != null ? pesos(Math.round(ticket)) : '—', 'por venta'),
        kpi('Gastado', pesos(datos.total_gastado), 'compras y gastos')),
      h('div', { class: 'graficos' }, h('div', { class: 'card' }, grafico), h('div', { class: 'card' }, porSabor)));
  }

  const plata = (etiqueta, valor, ayuda) => h('div', { class: 'dato' },
    h('dt', {}, etiqueta, ayuda ? h('small', {}, ayuda) : null), h('dd', {}, valor));

  vaciar(cont,
    h('div', { class: 'saludo' },
      h('p', { class: 'saludo-hola' }, `Hola, ${sesion.nombre}`),
      h('p', { class: 'ayuda' }, hoy.charAt(0).toUpperCase() + hoy.slice(1))),
    h('nav', { class: 'accesos', 'aria-label': 'Cargar' },
      acceso('#/tandas', 'roll', 'Tanda'),
      acceso('#/compras', 'carrito', 'Compra'),
      acceso('#/gastos', 'gasto', 'Gasto'),
      acceso('#/stock/conteo', 'conteo', 'Conteo')),

    tareas.length ? [h('h2', { class: 'seccion-titulo' }, 'Para hacer'), tareas] : null,

    h('div', { class: 'seccion-cab' }, h('h2', { class: 'seccion-titulo' }, 'Resumen'),
      chips(PERIODOS, periodo, (v) => { periodo = v; dibujarPeriodo(); })),
    contPeriodo,

    h('h2', { class: 'seccion-titulo' }, 'La plata, acumulado'),
    h('dl', { class: 'card datos' },
      plata('Caja teórica', pesos(total.caja_teorica), 'lo que debería haber'),
      plata('Pendiente de cobro', pesos(total.pendiente)),
      plata('Stock', pesos(Number(total.stock_ingredientes) + Number(total.stock_packaging)), 'ingredientes y packaging'),
      plata('Capital', pesos(total.capital), 'caja + stock'),
      plata('Retiros de socios', pesos(total.retiros)),
      plata('Tandas hechas', `${numero(total.tandas, 1)} · ${numero(total.rolls_producidos, 0)} rolls`)),

    h('div', { class: 'seccion-cab' }, h('h2', { class: 'seccion-titulo' }, 'Últimas ventas'),
      h('a', { href: '#/ventas', class: 'ver-todo' }, 'Ver todas')),
    ultimas.length
      ? h('ul', { class: 'lista' }, ultimas.map((v) => h('li', {}, h('a', { class: 'fila', href: `#/ventas/${v.id}` },
        h('div', { class: 'princ' },
          h('div', { class: 't1' }, v.cliente || 'Sin cliente', ' ',
            v.estado_pago === 'pendiente' ? h('span', { class: 'badge pendiente' }, 'Pendiente') : null),
          h('div', { class: 't2' }, `${fechaCorta(v.fecha)} · ${v.formatos || ''}${v.sabores ? ' · ' + v.sabores : ''}`)),
        h('span', { class: 'monto' }, pesos(v.total))))))
      : h('p', { class: 'vacio' }, 'Todavía no hay ventas.'));
  dibujarPeriodo();
}
