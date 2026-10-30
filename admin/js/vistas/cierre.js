import { sb, q, rpc } from '../db.js';
import { h, vaciar, pesos, numero, plural, nombreMes, soloMes, mesISO, sumarMeses, diaMes, compartirWhatsapp } from '../util.js';
import { variacion, textoVariacion } from '../graficos.js';
import { catalogo } from '../catalogo.js';
import { irA } from '../app.js';
import { stat, filaLista, monto, tituloSemana, partesPorSabor } from '../componentes.js';

// Cierre de mes (idea 4.4): el resumen de un mes para guardarlo en PDF (imprimir) o mandárselo al socio por WhatsApp.
// Los números los arma la base (cierre_mes); el día 1 llega un aviso push con el link al mes que terminó
// (api/cierre-mes.js). Sin mes en la ruta, muestra el mes pasado.
export async function mostrar(cont, { id }) {
  const mes = id || sumarMeses(mesISO(), -1);
  const [cierre, meses, cat] = await Promise.all([
    rpc('cierre_mes', { p_mes: mes }),
    q(sb.from('v_resumen_mensual').select('mes').gt('ventas', 0).order('mes', { ascending: false })),
    catalogo(),
  ]);
  const actual = cierre.actual || {};
  const anterior = cierre.anterior || {};
  const contra = cierre.anterior ? soloMes(cierre.anterior.mes) : null;
  const valor = (fila, clave) => Number(fila[clave] || 0);
  const comparar = { actual, anterior, contra, valor };
  const delta = (clave) => variacion(valor(actual, clave), valor(anterior, clave), contra);

  const elegir = h('select', { 'aria-label': 'Mes', onchange: (e) => irA(`#/cierre/${e.target.value}`) },
    [...new Set([mes, ...meses.map((m) => m.mes)])].sort().reverse()
      .map((m) => h('option', { value: m }, nombreMes(m))));
  elegir.value = mes;

  const imprimir = h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Guardar PDF');
  const whatsapp = h('a', {
    class: 'btn primario', href: compartirWhatsapp(mensaje(cierre, cat, comparar)), target: '_blank', rel: 'noopener',
  }, 'Mandar por WhatsApp');

  vaciar(cont,
    h('div', { class: 'cierre-cab' }, elegir, h('div', { class: 'acciones' }, imprimir, whatsapp)),
    h('h1', { class: 'cierre-titulo' }, `Cierre de ${nombreMes(mes)}`),
    h('div', { class: 'hero' },
      h('div', { class: 'etq' }, 'Vendido'),
      h('div', { class: 'hero-num' }, pesos(valor(actual, 'vendido'))),
      delta('vendido')),
    h('div', { class: 'stats' },
      stat('Ganancia bruta', pesos(valor(actual, 'ganancia_bruta')),
        cierre.margen != null ? `${cierre.margen} % de lo vendido` : null, delta('ganancia_bruta')),
      stat('Resultado', pesos(valor(actual, 'resultado')), 'lo vendido menos compras y gastos', delta('resultado')),
      stat('Ventas', numero(valor(actual, 'ventas'), 0), `${numero(valor(actual, 'rolls_vendidos'), 0)} rolls`, delta('ventas')),
      stat('Ticket promedio', cierre.ticket != null ? pesos(cierre.ticket) : '—', 'por venta'),
      stat('Clientes', numero(cierre.clientes_total, 0), plural(cierre.clientes_nuevos, 'nuevo', 'nuevos')),
      stat('Gastado', pesos(valor(actual, 'total_gastado')), 'compras y gastos')),
    h('div', { class: 'graficos' },
      h('div', { class: 'card' }, partesPorSabor(cierre.sabores, cat)),
      h('div', { class: 'card' }, h('h3', {}, 'Cada sábado'),
        h('table', { class: 'tabla' }, cierre.semanas.map((s) => h('tr', {},
          h('td', {}, tituloSemana(s.sabado)),
          h('td', { class: 'num-der' }, Number(s.rolls) ? `${numero(s.rolls, 0)} rolls` : 'sin ventas'),
          h('td', { class: 'num-der' }, pesos(s.vendido))))))),
    h('h2', { class: 'seccion-titulo' }, 'Los que más compraron'),
    cierre.clientes.length
      ? h('ul', { class: 'lista' }, cierre.clientes.map((c) => filaLista({
        href: `#/clientes/${c.id}`,
        titulo: c.nombre,
        detalle: [plural(c.compras, 'compra')],
        derecha: monto(pesos(c.total)),
      })))
      : h('p', { class: 'vacio' }, 'No hubo ventas este mes.'));
}

// El resumen para WhatsApp: los números del mes, el sabor que más salió y el mejor sábado. `comparar`: lo mismo
// que usa la pantalla para las variaciones contra el mes anterior.
function mensaje(cierre, cat, { actual, anterior, contra, valor }) {
  const vs = (clave) => {
    const texto = textoVariacion(valor(actual, clave), valor(anterior, clave), contra);
    return texto ? ` (${texto})` : '';
  };
  const sabor = cierre.sabor_top;
  const mejor = cierre.mejor_sabado;
  return [
    `*Cierre de ${nombreMes(cierre.mes)}*`,
    '',
    `Vendido: ${pesos(valor(actual, 'vendido'))}${vs('vendido')}`,
    `Ganancia bruta: ${pesos(valor(actual, 'ganancia_bruta'))}${vs('ganancia_bruta')}`,
    `Resultado (menos compras y gastos): ${pesos(valor(actual, 'resultado'))}`,
    `Ventas: ${numero(valor(actual, 'ventas'), 0)} · ${numero(valor(actual, 'rolls_vendidos'), 0)} rolls`,
    `Clientes: ${numero(cierre.clientes_total, 0)} (${plural(cierre.clientes_nuevos, 'nuevo', 'nuevos')})`,
    sabor ? `Sabor que más salió: ${cat.sabores.find((s) => s.nombre === sabor.nombre)?.nombre_corto || sabor.nombre} `
      + `(${sabor.pct} %)` : null,
    mejor ? `Mejor sábado: ${diaMes(mejor.sabado)} con ${pesos(mejor.vendido)}` : null,
  ].filter((l) => l !== null).join('\n');
}
