import { rpc } from '../db.js';
import { h, vaciar, chips, numero, fechaCorta, hoyISO, mesISO, sumarDias } from '../util.js';
import { areas, partes, embudo, variacion } from '../graficos.js';
import { irA } from '../app.js';
import { stat } from '../componentes.js';

// Visitas a la web (idea 6.2): cuántos entran, de dónde vienen y cuántos llegan a pedir. Las registra la web en
// /api/visita (sin cookies ni datos personales) y las resume la base (resumen_visitas).
const PERIODOS = [{ valor: 7, texto: '7 días' }, { valor: 30, texto: '30 días' }, { valor: 'mes', texto: 'Este mes' }];
let periodo = 7;

// Cada origen con su nombre y su color fijo (no cambia con el período).
const ORIGENES = {
  instagram: ['Instagram', 'var(--serie-1)'],
  whatsapp: ['WhatsApp', 'var(--serie-2)'],
  google: ['Google', 'var(--serie-3)'],
  facebook: ['Facebook', 'var(--serie-4)'],
  tiktok: ['TikTok', 'var(--serie-5)'],
  directo: ['Directo (link guardado o escrito)', 'var(--serie-6)'],
  otro: ['Otra página', 'var(--graf-gris)'],
};

export async function mostrar(cont) {
  const hasta = hoyISO();
  const desde = periodo === 'mes' ? mesISO(hasta) : sumarDias(hasta, 1 - periodo);
  const r = await rpc('resumen_visitas', { p_desde: desde, p_hasta: hasta });
  const contra = 'el período anterior';
  const pct = (n) => (r.sesiones ? `${Math.round((100 * n) / r.sesiones)} %` : '—');

  // En 30 días no entran todas las fechas abajo: se rotula una por semana (y la primera y la última).
  const dias = r.por_dia.map((d, i) => ({
    etiqueta: r.por_dia.length <= 8 || i === 0 || i === r.por_dia.length - 1 || i % 7 === 0 ? fechaCorta(d.dia) : '',
    etiquetaLarga: fechaCorta(d.dia),
    valores: { sesiones: d.sesiones, pedidos: d.pedidos },
    destacado: i === r.por_dia.length - 1,
  }));

  vaciar(cont,
    chips(PERIODOS, periodo, (v) => { periodo = v; irA('#/visitas'); }),
    h('div', { class: 'stats' },
      stat('Visitas', numero(r.sesiones, 0), 'personas distintas que entraron',
        variacion(r.sesiones, r.anterior.sesiones, contra)),
      stat('Pidieron', numero(r.embudo.pedido, 0), `${pct(r.embudo.pedido)} de las visitas`,
        variacion(r.embudo.pedido, r.anterior.pedidos, contra)),
      stat('Abrieron el carrito', numero(r.embudo.carrito, 0), `${pct(r.embudo.carrito)} de las visitas`),
      stat('Desde el celular', pct(r.dispositivos.celular), `${numero(r.dispositivos.compu, 0)} desde compu`)),
    h('div', { class: 'graficos' },
      h('div', { class: 'card' }, embudo([
        { etiqueta: 'Entraron', valor: r.sesiones },
        { etiqueta: 'Abrieron el carrito', valor: r.embudo.carrito },
        { etiqueta: 'Tocaron "Pedir ahora"', valor: r.embudo.formulario },
        { etiqueta: 'Mandaron el pedido', valor: r.embudo.pedido },
      ], { titulo: 'Hasta dónde llegan', vacio: 'Todavía no hay visitas en este período.' })),
      h('div', { class: 'card' }, partes(r.origenes.map((o) => ({
        etiqueta: ORIGENES[o.origen][0], valor: o.sesiones, color: ORIGENES[o.origen][1],
      })), { titulo: 'De dónde vienen', formato: (v) => numero(v, 0), vacio: 'Todavía no hay visitas en este período.' }),
      r.origenes.some((o) => o.pedidos) ? h('p', { class: 'ayuda' }, 'Pidieron: ',
        r.origenes.filter((o) => o.pedidos).map((o) => `${ORIGENES[o.origen][0]} ${o.pedidos}`).join(' · ')) : null),
      h('div', { class: 'card' }, areas(dias, {
        titulo: 'Visitas por día',
        series: [
          { clave: 'sesiones', nombre: 'Visitas', color: 'var(--graf-acento)' },
          { clave: 'pedidos', nombre: 'Pidieron', color: 'var(--serie-3)' },
        ],
        formato: (v) => numero(v, 0),
        columnasTabla: [
          ['Día', (d) => d.etiquetaLarga],
          ['Visitas', (d) => numero(d.valores.sesiones, 0)],
          ['Pidieron', (d) => numero(d.valores.pedidos, 0)],
        ],
      }))),
    h('p', { class: 'ayuda' }, 'Se cuentan desde el 30/10/2026, sin cookies ni datos de las personas: cada pestaña del '
      + 'navegador es una visita. No cuentan los buscadores ni las pruebas en el servidor local.'));
}
