import { sb, q, rpc } from '../db.js';
import { h, vaciar, chips, pesos, numero, fechaCorta, mesISO, nombreMes, hoyISO, proximoSabado, conBoton, toast, plural, ETIQUETAS } from '../util.js';
import { icono } from '../iconos.js';
import { areas, partes, variacion } from '../graficos.js';
import { catalogo } from '../catalogo.js';
import { irA, sesion } from '../app.js';
import { tituloSemana } from '../componentes.js';
import { textoPanel } from '../textos.js';

const PERIODOS = [{ valor: 'mes', texto: 'Este mes' }, { valor: 'anterior', texto: 'Mes pasado' }, { valor: 'todo', texto: 'Todo' }];
// 'mes', 'anterior', 'todo' o un mes elegido en el gráfico ('AAAA-MM-01').
let periodo = 'mes';

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
// Primer día del mes que está `n` meses antes de `mes` (ISO 'AAAA-MM-01').
function mesesAntes(mes, n) {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 - n, 1)).toISOString().slice(0, 10);
}
const nombreCorto = (mes) => MESES_CORTOS[Number(mes.slice(5, 7)) - 1];
const soloMes = (mes) => nombreMes(mes).split(' ')[0];
// Fecha ISO `n` días después (o antes, con n negativo).
const masDias = (iso, n) => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + n))
  .toISOString().slice(0, 10);

// La semana de pedidos: de domingo a sábado entran los pedidos (cuántos se cargaron cada día) y el sábado,
// en canela, se hornea y se entrega (los rolls de las ventas "por hacer", lo mismo que usa el plan de horneado).
function tiraSemana(sabado, ventasSemana, rollsPorHacer) {
  const hoy = hoyISO();
  const dias = Array.from({ length: 6 }, (_, i) => masDias(sabado, i - 6));
  const cuantos = (dia) => ventasSemana.filter((v) => v.fecha === dia).length;
  const clases = (dia) => ['semana-dia', dia > hoy ? 'futuro' : '', dia === hoy ? 'hoy' : ''].join(' ').trim();
  return h('section', { class: 'semana', 'aria-labelledby': 'semana-titulo' },
    h('div', { class: 'semana-cab' },
      h('h2', { id: 'semana-titulo' }, tituloSemana(sabado)),
      h('p', { class: 'ayuda' }, textoPanel('panel.semana_ayuda', 'Pedidos cargados cada día. Todo se hornea y se entrega el sábado.'))),
    h('ol', { class: 'semana-dias' },
      dias.map((dia) => {
        const n = cuantos(dia);
        return h('li', { class: clases(dia) + (dia <= hoy && !n ? ' cero' : ''),
          'aria-label': `${fechaCorta(dia)}: ${dia > hoy ? 'todavía no llegó' : plural(n, 'pedido')}` },
        h('span', { class: 'dia', 'aria-hidden': 'true' }, fechaCorta(dia).slice(0, 3)),
        h('span', { class: 'cuantos', 'aria-hidden': 'true' }, dia > hoy ? '·' : n));
      }),
      h('li', { class: 'semana-sabado-cont' },
        h('a', { class: 'semana-dia semana-sabado' + (sabado === hoy ? ' hoy' : ''), href: '#/plan' },
          h('span', { class: 'dia' }, `sábado ${Number(sabado.slice(8, 10))}`),
          h('span', { class: 'cuantos' }, numero(rollsPorHacer, 0)),
          h('span', { class: 'que' }, textoPanel('panel.sabado', '{rolls} para hornear', { rolls: rollsPorHacer === 1 ? 'roll' : 'rolls' }))))));
}

export async function mostrar(cont) {
  const actual = mesISO();
  // El mes en curso se compara contra el mismo tramo del mes anterior (del 1 al día de hoy),
  // no contra el mes anterior completo, que siempre parecería más grande.
  const dia = Number(hoyISO().slice(8, 10));
  const inicioAnterior = mesesAntes(actual, 1);
  const finAnterior = new Date(Date.UTC(Number(inicioAnterior.slice(0, 4)), Number(inicioAnterior.slice(5, 7)) - 1,
    Math.min(dia, new Date(Date.UTC(Number(actual.slice(0, 4)), Number(actual.slice(5, 7)) - 1, 0)).getUTCDate()))).toISOString().slice(0, 10);
  const [resumen, total, pendientes, alertas, ultimas, tramoAnterior, pedidosNuevos, porHacer, ventasSemana] = await Promise.all([
    q(sb.from('v_resumen_mensual').select('*').order('mes')),
    q(sb.from('v_panel').select('*').single()),
    q(sb.from('v_ventas').select('id,fecha,cliente,formatos,total,medio_pago').eq('estado_pago', 'pendiente').order('fecha')),
    q(sb.from('v_stock').select('nombre').eq('reponer', true).order('nombre')),
    q(sb.from('v_ventas').select('id,fecha,cliente,formatos,sabores,total,estado_pago')
      .order('fecha', { ascending: false }).order('creado_en', { ascending: false }).limit(5)),
    q(sb.from('v_ventas').select('total,ganancia,rolls,tipo').gte('fecha', inicioAnterior).lte('fecha', finAnterior)),
    q(sb.from('pedidos').select('nombre,total').eq('estado', 'nuevo').order('creado_en')),
    q(sb.from('v_ventas').select('rolls').eq('por_hacer', true)),
    q(sb.from('v_ventas').select('fecha').gte('fecha', masDias(proximoSabado(), -6)).lte('fecha', proximoSabado())),
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
    || { mes, vendido: 0, ventas: 0, rolls_vendidos: 0, ganancia_bruta: 0, total_gastado: 0, aportes: 0, otros_ingresos: 0 };

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
  if (porHacer.length) {
    tareas.push(h('a', { class: 'card tarea tarea-link', href: '#/plan' },
      h('div', { class: 'tarea-cab' }, icono('roll'),
        h('div', {}, h('strong', {}, `${plural(porHacer.length, 'pedido', 'pedidos')} por hacer`),
          h('div', { class: 'ayuda' }, `${plural(porHacer.reduce((a, v) => a + v.rolls, 0), 'roll')} · ver el plan de horneado`))),
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
            h('div', { class: 't2' }, [fechaCorta(v.fecha), v.formatos, pesos(v.total), ETIQUETAS.medio_pago[v.medio_pago] || 'sin medio de pago']
              .filter(Boolean).join(' · '))),
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
  const contChips = h('div');
  // Tocar un mes del gráfico lo elige; si es este mes o el pasado, se marca su chip.
  const elegirMes = (mes) => {
    periodo = mes === actual ? 'mes' : mes === mesesAntes(actual, 1) ? 'anterior' : mes;
    dibujarPeriodo();
    contPeriodo.querySelector('.graf-franja[aria-pressed="true"]')?.focus({ preventScroll: true });
  };
  function dibujarPeriodo() {
    const mesSel = periodo === 'mes' ? actual : periodo === 'anterior' ? mesesAntes(actual, 1)
      : periodo === 'todo' ? null : periodo;
    const otroMes = !PERIODOS.some((p) => p.valor === periodo);
    vaciar(contChips, chips(otroMes ? [...PERIODOS, { valor: periodo, texto: nombreMes(periodo) }] : PERIODOS,
      periodo, (v) => { periodo = v; dibujarPeriodo(); }));
    const datos = mesSel ? deMes(mesSel) : {
      vendido: total.vendido, ventas: total.ventas, rolls_vendidos: total.rolls_vendidos,
      ganancia_bruta: total.ganancia_bruta, total_gastado: total.total_gastado,
      aportes: total.aportes, otros_ingresos: total.otros_ingresos,
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
    // Vendido y, adentro, la ganancia bruta: la franja entre las dos es lo que se fue en costos.
    const grafico = areas(seis.map((r) => ({
      mes: r.mes,
      etiqueta: nombreCorto(r.mes),
      etiquetaLarga: nombreMes(r.mes),
      valores: { vendido: Number(r.vendido), ganancia: Math.max(0, Number(r.ganancia_bruta)) },
      ventas: Number(r.ventas),
      destacado: r.mes === (mesSel || actual),
    })), {
      titulo: 'Vendido y ganancia por mes',
      series: [
        { clave: 'vendido', nombre: 'Vendido', color: 'var(--graf-acento)' },
        { clave: 'ganancia', nombre: 'Ganancia bruta', color: 'var(--serie-3)' },
      ],
      formato: (v) => (v >= 10000 ? `$${numero(v / 1000, 1)} mil` : pesos(v)),
      alElegir: (d) => elegirMes(d.mes),
      ayudaElegir: 'Tocá un mes para ver su resumen.',
      columnasTabla: [
        ['Mes', (d) => d.etiquetaLarga],
        ['Vendido', (d) => pesos(d.valores.vendido)],
        ['Ganancia', (d) => pesos(d.valores.ganancia)],
        ['Ventas', (d) => numero(d.ventas, 0)],
      ],
    });

    const porSabor = h('div', {}, h('p', { class: 'ayuda' }, 'Cargando rolls por sabor…'));
    let consulta = sb.from('v_ventas_sabores').select('sabor,unidades');
    if (mesSel) consulta = consulta.eq('mes', mesSel);
    Promise.all([q(consulta), catalogo()]).then(([filas, cat]) => {
      const suma = {};
      for (const f of filas) suma[f.sabor] = (suma[f.sabor] || 0) + f.unidades;
      // Cada sabor con su color fijo, así no cambia cuando cambia el período: primero los de masa compartida
      // (los mismos colores que en el desglose del plan de horneado), después los de masa propia y los inactivos.
      const orden = [...cat.saboresActivos.filter((x) => !x.masa_propia), ...cat.saboresActivos.filter((x) => x.masa_propia),
        ...cat.sabores.filter((x) => !x.activo)].map((x) => x.nombre);
      const colorDe = (nombre) => {
        const i = orden.indexOf(nombre);
        return i >= 0 && i < 6 ? `var(--serie-${i + 1})` : 'var(--graf-gris)';
      };
      const lista = Object.entries(suma).map(([etiqueta, valor]) => ({ etiqueta, valor, color: colorDe(etiqueta) }))
        .sort((a, b) => (orden.indexOf(a.etiqueta) + 1 || 999) - (orden.indexOf(b.etiqueta) + 1 || 999));
      vaciar(porSabor, partes(lista, {
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
      entroAparte(datos),
      h('div', { class: 'graficos' }, h('div', { class: 'card' }, grafico), h('div', { class: 'card' }, porSabor)));
  }

  // Plata que entró sin ser una venta (aportes de socios y otros ingresos), si hubo.
  function entroAparte(d) {
    const aportes = Number(d.aportes || 0);
    const otros = Number(d.otros_ingresos || 0);
    if (!aportes && !otros) return null;
    const partes = [aportes ? `aportes de socios ${pesos(aportes)}` : null, otros ? `otros ingresos ${pesos(otros)}` : null];
    return h('p', { class: 'ayuda' }, `Además entraron ${pesos(aportes + otros)} que no son ventas: `,
      partes.filter(Boolean).join(' · '), '.');
  }

  const plata = (etiqueta, valor, ayuda) => h('div', { class: 'dato' },
    h('dt', {}, etiqueta, ayuda ? h('small', {}, ayuda) : null), h('dd', {}, valor));

  // En la compu: lo pendiente, el resumen y los gráficos a la izquierda; la plata y las últimas ventas a la derecha.
  vaciar(cont, h('div', { class: 'dos-col ancha-izq' }, h('div', {},
    h('div', { class: 'saludo' },
      h('p', { class: 'saludo-hola' }, `Hola, ${sesion.nombre}`),
      h('p', { class: 'ayuda' }, hoy.charAt(0).toUpperCase() + hoy.slice(1))),
    tiraSemana(proximoSabado(), ventasSemana, porHacer.reduce((a, v) => a + Number(v.rolls), 0)),

    tareas.length ? [h('h2', { class: 'seccion-titulo' }, 'Para hacer'), tareas] : null,

    h('nav', { class: 'accesos', 'aria-label': 'Cargar' },
      acceso('#/tandas', 'roll', 'Tanda'),
      acceso('#/compras', 'carrito', 'Compra'),
      acceso('#/gastos', 'gasto', 'Gasto'),
      acceso('#/gastos/ingreso', 'ingreso', 'Ingreso'),
      acceso('#/stock/conteo', 'conteo', 'Conteo')),

    h('div', { class: 'seccion-cab' }, h('h2', { class: 'seccion-titulo' }, 'Resumen'),
      contChips),
    contPeriodo),

    h('div', {},

    h('h2', { class: 'seccion-titulo' }, 'La plata, acumulado'),
    h('dl', { class: 'card datos' },
      plata('Caja teórica', pesos(total.caja_teorica), 'lo que debería haber'),
      plata('Pendiente de cobro', pesos(total.pendiente)),
      plata('Stock', pesos(Number(total.stock_ingredientes) + Number(total.stock_packaging)), 'ingredientes y packaging'),
      plata('Capital', pesos(total.capital), 'caja + stock'),
      plata('Retiros de socios', pesos(total.retiros)),
      plata('Aportes de socios', pesos(total.aportes)),
      Number(total.otros_ingresos) ? plata('Otros ingresos', pesos(total.otros_ingresos), 'que no son ventas') : null,
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
      : h('p', { class: 'vacio' }, 'Todavía no hay ventas.'))));
  dibujarPeriodo();
}
