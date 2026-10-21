import { sb, q, rpc } from '../db.js';
import { h, vaciar, campo, pesos, numero, plural, fechaCorta, nombreMes, hoyISO, toast, conBoton } from '../util.js';
import { irA, sesion } from '../app.js';
import { ESTADO_RECOMENDACION, CLASE_RECOMENDACION } from '../recomendacion.js';

// Descuento por recomendación (docs/descuento-plan/logica.md): campañas, cómo va la vigente y la lista de
// recomendaciones. Las reglas están en la base; acá solo se cargan las campañas y se mira.
// En modo prueba (usuario de prueba) todo lo que se ve es de prueba y se puede borrar de una vez.
export async function mostrar(cont) {
  const [campanas, recos] = await Promise.all([
    q(sb.from('campanas_recomendacion').select('*').order('desde', { ascending: false })),
    q(sb.from('v_recomendaciones').select('*').order('creado_en', { ascending: false }).limit(100)),
  ]);
  const hoy = hoyISO();
  const vigente = campanas.find((k) => k.desde <= hoy && k.hasta >= hoy) || null;
  const elegida = vigente || campanas[0] || null;
  const resumen = elegida ? await rpc('resumen_campana', { p_campana: elegida.id }) : null;

  const kpi = (etiqueta, valor, sub) => h('div', { class: 'stat' },
    h('div', { class: 'etq' }, etiqueta), h('div', { class: 'num' }, valor), sub ? h('div', { class: 'sub' }, sub) : null);
  const rango = (k) => `${fechaCorta(k.desde)} al ${fechaCorta(k.hasta)}`;

  // Formulario de campaña: nueva o editar la elegida.
  function formulario(k) {
    const f = { id: k?.id || null, nombre: k?.nombre || '', desde: k?.desde || hoy, hasta: k?.hasta || '',
      porcentaje: k?.porcentaje ?? 5, tope: k?.tope ?? 30 };
    const entrada = (clave, attrs = {}) => h('input', { ...attrs, value: f[clave], oninput: (e) => { f[clave] = e.target.value; } });
    const guardar = h('button', { class: 'btn primario', type: 'button' }, k ? 'Guardar cambios' : 'Crear campaña');
    guardar.onclick = () => conBoton(guardar, async () => {
      await rpc('guardar_campana', { p: f });
      toast(k ? 'Campaña actualizada' : 'Campaña creada');
      irA('#/recomendaciones');
    });
    return h('div', {},
      campo('Nombre', entrada('nombre', { placeholder: sesion.prueba ? 'PRUEBA noviembre' : 'Noviembre y diciembre' })),
      h('div', { class: 'fila-campos' },
        campo('Desde', entrada('desde', { type: 'date', min: '2024-01-01', max: '2099-12-31' })),
        campo('Hasta', entrada('hasta', { type: 'date', min: '2024-01-01', max: '2099-12-31' }))),
      h('div', { class: 'fila-campos' },
        campo('% por recomendación', entrada('porcentaje', { type: 'number', inputmode: 'decimal', min: 1, max: 50 })),
        campo('Tope por mes (%)', entrada('tope', { type: 'number', inputmode: 'decimal', min: 1, max: 50 }))),
      h('div', { class: 'acciones' }, guardar));
  }

  const generar = h('button', { class: 'btn', type: 'button' }, 'Dar código a los que ya compraron');
  generar.onclick = () => conBoton(generar, async () => {
    const n = await rpc('generar_codigos');
    toast(n ? `${plural(n, 'código nuevo', 'códigos nuevos')}` : 'Todos los clientes con compras pagadas ya tenían código');
  });

  // Solo el usuario de prueba: borra pedidos, ventas, clientes y campañas de prueba (y los comprobantes del bucket).
  const borrarPrueba = h('button', { class: 'btn peligro', type: 'button' }, 'Borrar datos de prueba');
  borrarPrueba.onclick = () => conBoton(borrarPrueba, async () => {
    if (!confirm('¿Borrar todos los pedidos, ventas, clientes y campañas de prueba? No se puede deshacer.')) return;
    const conComprobante = await q(sb.from('pedidos').select('comprobante').not('comprobante', 'is', null));
    if (conComprobante.length) await sb.storage.from('comprobantes').remove(conComprobante.map((p) => p.comprobante));
    const r = await rpc('borrar_datos_prueba');
    toast(`Borrados: ${plural(r.pedidos, 'pedido')}, ${plural(r.ventas, 'venta')}, ${plural(r.clientes, 'cliente')}, ${plural(r.campanas, 'campaña')}`);
    irA('#/recomendaciones');
  });

  const reco = (r) => h('li', {}, h(r.venta_id ? 'a' : 'div', { class: 'fila', href: r.venta_id ? `#/ventas/${r.venta_id}` : null },
    h('div', { class: 'princ' },
      h('div', { class: 't1' }, `${r.recomendado || r.nombre_pedido} ← ${r.recomendador}`),
      h('div', { class: 't2' }, [fechaCorta(r.creado_en.slice(0, 10)), `pedido ${r.pedido}`,
        r.mes ? `suma en ${nombreMes(r.mes)}` : null, r.motivo].filter(Boolean).join(' · '))),
    h('span', { class: `badge ${CLASE_RECOMENDACION[r.estado]}` }, ESTADO_RECOMENDACION[r.estado])));

  vaciar(cont,
    sesion.prueba ? h('div', { class: 'card' },
      h('p', { style: 'margin-top:0' }, h('strong', {}, 'Modo prueba. '),
        'Las campañas, pedidos y ventas que ves acá son de prueba: los dueños no los ven y no tocan los números reales. '
        + 'Para probar: abrí la web en el servidor local (con el aviso rojo de modo prueba) y hacé pedidos con celulares inventados.'),
      h('div', { class: 'acciones' }, borrarPrueba)) : null,

    h('h2', {}, vigente ? 'Campaña en curso' : 'Sin campaña en curso'),
    elegida ? h('div', { class: 'card' },
      h('div', { class: 'seccion-cab' }, h('strong', {}, elegida.nombre),
        h('span', { class: `badge ${vigente ? 'ok' : 'neutro'}` }, vigente ? 'En curso' : (elegida.desde > hoy ? 'Programada' : 'Terminada'))),
      h('p', { class: 'ayuda' }, `${rango(elegida)} · ${numero(elegida.porcentaje, 0)} % por recomendación, hasta ${numero(elegida.tope, 0)} % por mes. `
        + 'Se usa en una Box de 6 o de 12 de la web; lo de cada mes vence a fin de mes. '
        + `La primera Box de 12 de la web de cada cliente le da ${numero(elegida.porcentaje, 0)} % por 30 días.`),
      h('div', { class: 'stats' },
        kpi('Clientes nuevos con código', numero(resumen.validas, 0),
          `de ${plural(resumen.clientes_nuevos_total, 'cliente nuevo', 'clientes nuevos')} en esas fechas`),
        kpi('Pendientes', numero(resumen.pendientes, 0), 'esperan que se pague la venta'),
        kpi('Vendido a recomendados', pesos(resumen.vendido_recomendados),
          resumen.volvieron ? `${plural(resumen.volvieron, 'volvió', 'volvieron')} a comprar` : null),
        kpi('Bonos por Box de 12', numero(resumen.bonos, 0),
          resumen.bonos_vigentes ? `${plural(resumen.bonos_vigentes, 'vigente', 'vigentes')} hoy` : null),
        kpi('Descuento entregado', pesos(resumen.descuento_entregado), plural(resumen.canjes, 'canje')),
        kpi('Costo por cliente nuevo', resumen.costo_por_cliente == null ? '—' : pesos(resumen.costo_por_cliente),
          'descuento entregado ÷ clientes nuevos')),
      resumen.ranking.length ? [h('h3', {}, 'Quiénes más recomendaron'),
        h('ul', { class: 'lista' }, resumen.ranking.slice(0, 10).map((x) => h('li', {}, h('a', { class: 'fila', href: `#/clientes/${x.id}` },
          h('div', { class: 'princ' }, h('div', { class: 't1' }, x.nombre)),
          h('span', { class: 'monto' }, plural(x.validas, 'recomendación', 'recomendaciones'))))))] : null,
      h('details', { class: 'plegable' }, h('summary', {}, 'Editar la campaña'), formulario(elegida)),
      h('div', { class: 'acciones' }, generar),
      h('p', { class: 'ayuda' }, 'Cada cliente recibe su código cuando paga una compra durante la campaña. '
        + 'Con el botón, también los que compraron antes: así pueden recomendar desde el primer día.'))
      : h('p', { class: 'vacio' }, 'Todavía no hay campañas.'),

    h('details', { class: 'plegable' }, h('summary', {}, 'Nueva campaña'), formulario(null)),

    campanas.length > 1 ? [h('h2', {}, 'Todas las campañas'),
      h('ul', { class: 'lista' }, campanas.map((k) => h('li', {}, h('div', { class: 'fila' },
        h('div', { class: 'princ' }, h('div', { class: 't1' }, k.nombre), h('div', { class: 't2' }, rango(k))),
        h('span', { class: 'monto' }, `${numero(k.porcentaje, 0)} % / ${numero(k.tope, 0)} %`)))))] : null,

    h('h2', {}, 'Recomendaciones'),
    recos.length ? h('ul', { class: 'lista' }, recos.map(reco))
      : h('p', { class: 'vacio' }, 'Todavía nadie pidió con el código de otra persona.'));
}
