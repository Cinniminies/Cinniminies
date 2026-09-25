import { sb, q, rpc } from '../db.js';
import {
  h, vaciar, chips, campo, grupo, pesos, numero, plural, fechaCorta, fechaLarga, nombreMes, hoyISO, toast, conBoton, debounce,
  ETIQUETAS, opciones, linkWhatsapp,
} from '../util.js';
import { catalogo, clientes as leerClientes, origenes as leerOrigenes } from '../catalogo.js';
import { elegirCliente, editorLineas } from '../componentes.js';
import { irA } from '../app.js';

// Filtros de la lista: se conservan al volver del detalle.
const filtro = { mes: '', estado: 'todas', texto: '' };

export async function mostrar(cont, { id, accion }) {
  if (id && accion === 'editar') return editar(cont, id);
  if (id) return detalle(cont, id);
  return lista(cont);
}

// ---------------------------------------------------------------- lista

async function lista(cont) {
  const meses = await q(sb.from('v_resumen_mensual').select('mes,ventas').gt('ventas', 0).order('mes', { ascending: false }));
  const resultados = h('div');
  let pedido = 0;

  async function cargar() {
    const este = ++pedido;
    const texto = filtro.texto.trim();
    let consulta = sb.from('v_ventas')
      .select('id,fecha,cliente,formatos,sabores,total,estado_pago,tipo')
      .order('fecha', { ascending: false }).order('creado_en', { ascending: false });
    if (filtro.mes) {
      const [a, m] = filtro.mes.split('-').map(Number);
      const siguiente = new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 10);
      consulta = consulta.gte('fecha', filtro.mes).lt('fecha', siguiente);
    }
    if (filtro.estado === 'pendientes') consulta = consulta.eq('estado_pago', 'pendiente');
    if (texto) consulta = consulta.ilike('cliente', `%${texto.replace(/[%_\\]/g, '')}%`);
    const limitada = !filtro.mes && filtro.estado === 'todas' && !texto;
    if (limitada) consulta = consulta.limit(50);
    try {
      const ventas = await q(consulta);
      if (este === pedido) dibujar(ventas, limitada);
    } catch (e) {
      if (este === pedido) vaciar(resultados, h('p', { class: 'mensaje-error' }, e.message));
    }
  }

  function dibujar(ventas, limitada) {
    const suma = (vs) => vs.reduce((a, v) => a + Number(v.total), 0);
    const pendiente = suma(ventas.filter((v) => v.estado_pago === 'pendiente'));
    // Agrupadas por día, con el total de cada día
    const dias = [];
    for (const v of ventas) {
      if (!dias.length || dias[dias.length - 1].fecha !== v.fecha) dias.push({ fecha: v.fecha, ventas: [] });
      dias[dias.length - 1].ventas.push(v);
    }
    vaciar(resultados,
      h('div', { class: 'resumen-lista' },
        h('div', {}, h('span', { class: 'etq' }, limitada ? 'Últimas' : 'Ventas'), h('strong', {}, numero(ventas.length, 0))),
        h('div', {}, h('span', { class: 'etq' }, 'Total'), h('strong', {}, pesos(suma(ventas)))),
        h('div', {}, h('span', { class: 'etq' }, 'Pendiente'), h('strong', { class: pendiente ? 'texto-alerta' : null }, pesos(pendiente)))),
      dias.length
        ? dias.map((d) => h('section', { class: 'dia' },
          h('h2', { class: 'dia-cab' }, h('span', {}, fechaCorta(d.fecha)),
            h('span', { class: 'ayuda' }, `${plural(d.ventas.length, 'venta')} · ${pesos(suma(d.ventas))}`)),
          h('ul', { class: 'lista' }, d.ventas.map((v) => h('li', {}, h('a', { class: 'fila', href: `#/ventas/${v.id}` },
            h('div', { class: 'princ' },
              h('div', { class: 't1' }, v.cliente || 'Sin cliente', ' ',
                v.estado_pago === 'pendiente' ? h('span', { class: 'badge pendiente' }, 'Pendiente') : null,
                v.tipo !== 'venta' ? h('span', { class: 'badge neutro' }, ETIQUETAS.tipo[v.tipo]) : null),
              h('div', { class: 't2' }, `${v.formatos || ''}${v.sabores ? ' · ' + v.sabores : ''}`)),
            h('span', { class: 'monto' }, pesos(v.total))))))))
        : h('p', { class: 'vacio' }, 'No hay ventas con estos filtros.'));
  }

  const buscar = debounce(cargar, 300);
  const selMes = h('select', { onchange: (e) => { filtro.mes = e.target.value; cargar(); } },
    h('option', { value: '' }, 'Todos'),
    meses.map((m) => h('option', { value: m.mes }, `${nombreMes(m.mes)} (${m.ventas})`)));
  selMes.value = filtro.mes;

  vaciar(cont,
    h('div', { class: 'fila-campos' },
      campo('Mes', selMes),
      campo('Cliente', h('input', {
        type: 'search', value: filtro.texto, placeholder: 'Buscar…',
        oninput: (e) => { filtro.texto = e.target.value; buscar(); },
      }))),
    h('div', { class: 'campo' }, chips([{ valor: 'todas', texto: 'Todas' }, { valor: 'pendientes', texto: 'Pendientes de cobro' }],
      filtro.estado, (v) => { filtro.estado = v; cargar(); })),
    resultados);
  await cargar();
}

// ---------------------------------------------------------------- detalle

async function leerVenta(id) {
  const [v, lineas] = await Promise.all([
    q(sb.from('v_ventas').select('*').eq('id', id).maybeSingle()),
    q(sb.from('venta_lineas')
      .select('id,formato_id,cantidad,caja_insumo_id,precio_lista,costo_caja,formatos(nombre,tipo),insumos(nombre),venta_linea_sabores(sabor_id,unidades,costo_unitario,sabores(nombre))')
      .eq('venta_id', id)),
  ]);
  if (!v) throw new Error('La venta no existe (¿la borraron?)');
  return { v, lineas };
}

async function detalle(cont, id) {
  const { v, lineas } = await leerVenta(id);
  const contacto = v.cliente_id ? (await q(sb.from('clientes').select('contacto').eq('id', v.cliente_id).single())).contacto : null;
  const wa = linkWhatsapp(contacto);

  const fila = (etq, valor) => h('tr', {}, h('th', {}, etq), h('td', { class: 'num-der' }, valor));
  const pagada = v.estado_pago === 'pagado';
  const cambiarEstado = h('button', { class: 'btn ' + (pagada ? '' : 'ok') }, pagada ? 'Marcar pendiente' : 'Marcar cobrada');
  cambiarEstado.onclick = () => conBoton(cambiarEstado, async () => {
    await rpc('actualizar_venta', { p_id: id, p: { estado_pago: pagada ? 'pendiente' : 'pagado' } });
    toast(pagada ? 'Marcada como pendiente' : 'Marcada como cobrada');
    await detalle(cont, id);
  });
  const borrar = h('button', { class: 'btn peligro' }, 'Borrar');
  borrar.onclick = () => conBoton(borrar, async () => {
    if (!confirm(`¿Borrar la venta de ${v.cliente || 'sin cliente'} del ${fechaLarga(v.fecha)}? No se puede deshacer.`)) return;
    await q(sb.from('ventas').delete().eq('id', id));
    toast('Venta borrada');
    irA('#/ventas');
  });

  vaciar(cont,
    h('div', { class: 'card' },
      h('h1', { style: 'margin-top:0' }, v.cliente || 'Sin cliente'),
      h('p', { class: 'ayuda' }, `${fechaLarga(v.fecha)} · ${v.origen || 'sin origen'}`,
        contacto ? [' · ', wa ? h('a', { href: wa, target: '_blank', rel: 'noopener' }, contacto) : contacto] : null),
      h('p', {},
        h('span', { class: 'badge ' + (pagada ? 'ok' : 'pendiente') }, ETIQUETAS.estado_pago[v.estado_pago]), ' ',
        v.tipo !== 'venta' ? h('span', { class: 'badge neutro' }, ETIQUETAS.tipo[v.tipo]) : null, ' ',
        `${ETIQUETAS.entrega[v.entrega]} · ${ETIQUETAS.medio_pago[v.medio_pago] || 'sin medio de pago'}`),
      lineas.map((l) => h('div', { class: 'stepper-fila' },
        h('div', { class: 'nombre' },
          h('strong', {}, `${l.cantidad > 1 ? l.cantidad + ' × ' : ''}${l.formatos.nombre}`),
          h('div', { class: 'ayuda' }, l.venta_linea_sabores.map((s) => `${s.sabores.nombre} ${s.unidades}`).join(' · '),
            ` · ${l.insumos?.nombre || 'sin caja'}`)),
        h('span', { class: 'monto' }, pesos(l.precio_lista)))),
      h('table', { class: 'tabla', style: 'margin-top:.75rem' },
        fila('Precio de lista', pesos(v.precio_lista)),
        Number(v.descuento) ? fila(Number(v.descuento) > 0 ? 'Descuento' : 'Recargo', pesos(-v.descuento)) : null,
        Number(v.cobro_envio) ? fila('Envío', pesos(v.cobro_envio)) : null,
        fila('Total', h('strong', {}, pesos(v.total))),
        fila('Costo de producción', pesos(v.costo_produccion)),
        fila('Costo de caja', pesos(v.costo_caja)),
        fila('Ganancia', h('strong', {}, pesos(v.ganancia)))),
      v.notas ? h('p', {}, h('strong', {}, 'Notas: '), v.notas) : null,
      h('div', { class: 'acciones' },
        cambiarEstado,
        h('a', { class: 'btn', href: `#/ventas/${id}/editar` }, 'Editar'),
        borrar)));
}

// ---------------------------------------------------------------- editar

async function editar(cont, id) {
  const [{ v, lineas }, cat, clientes, origenes] = await Promise.all([leerVenta(id), catalogo(), leerClientes(), leerOrigenes()]);
  const cambios = {};
  const cliente = clientes.find((c) => c.id === v.cliente_id) || null;
  const lineasEdit = lineas.map((l) => ({
    formato_id: l.formato_id,
    cantidad: l.cantidad,
    caja: l.caja_insumo_id,
    sabores: Object.fromEntries(l.venta_linea_sabores.map((s) => [s.sabor_id, s.unidades])),
  }));
  let productosTocados = false;
  const editor = editorLineas(cat, lineasEdit, () => { productosTocados = true; });

  const precio = h('input', {
    type: 'number', inputmode: 'decimal', min: 0, step: '0.01', value: v.precio_cobrado,
    oninput: (e) => { cambios.precio_especial = e.target.value === '' ? null : Number(e.target.value); },
  });
  const envio = h('input', {
    type: 'number', inputmode: 'decimal', min: 0, step: '0.01', value: v.cobro_envio,
    oninput: (e) => { cambios.cobro_envio = e.target.value; },
  });
  const campoEnvio = campo('Cobro de envío', envio);
  campoEnvio.hidden = v.entrega !== 'envio';
  const origen = h('input', { value: v.origen || '', list: 'lista-origenes', oninput: (e) => { cambios.origen = e.target.value; } });

  const guardar = h('button', { class: 'btn primario', type: 'button' }, 'Guardar cambios');
  guardar.onclick = () => conBoton(guardar, async () => {
    const p = { ...cambios };
    if (productosTocados) {
      if (!confirm('Cambiaste los productos: se recalculan precio de lista y costos con los valores del '
        + `${fechaLarga(p.fecha || v.fecha)}. ¿Seguir?`)) return;
      p.lineas = editor.valor();
    }
    if (!Object.keys(p).length) { irA(`#/ventas/${id}`); return; }
    if ('cliente' in p) {
      // Un cliente nuevo lo crea actualizar_venta en la misma transacción
      const c = p.cliente;
      delete p.cliente;
      if (c?.nuevo) {
        if (!c.nombre.trim()) throw new Error('Falta el nombre del cliente nuevo');
        p.cliente = { nombre: c.nombre, contacto: c.contacto, origen: c.origen };
      } else {
        p.cliente_id = c?.id || null;
      }
    }
    await rpc('actualizar_venta', { p_id: id, p });
    toast('Venta actualizada');
    irA(`#/ventas/${id}`);
  });

  vaciar(cont, h('div', { class: 'con-guardar' },
    campo('Fecha', h('input', { type: 'date', value: v.fecha, max: hoyISO(), onchange: (e) => { cambios.fecha = e.target.value; } })),
    grupo('Cliente', elegirCliente(clientes, cliente, (c) => {
      cambios.cliente = c;
      // Al cambiar de cliente, la venta toma su origen (lo resuelve actualizar_venta)
      delete cambios.origen;
      origen.value = c && !c.nuevo ? c.origen || '' : c?.origen || '';
    }, origenes)),
    grupo('Entrega', chips(opciones(ETIQUETAS.entrega), v.entrega, (e) => {
      cambios.entrega = e;
      delete cambios.cobro_envio;
      campoEnvio.hidden = e !== 'envio';
      if (e === 'envio' && Number(envio.value) === 0) envio.value = cat.precioEnvio;
    })),
    campoEnvio,
    grupo('Pago', chips(opciones(ETIQUETAS.medio_pago), v.medio_pago, (m) => { cambios.medio_pago = m; })),
    grupo('Estado', chips(opciones(ETIQUETAS.estado_pago), v.estado_pago, (e) => { cambios.estado_pago = e; })),
    grupo('Tipo', chips(opciones(ETIQUETAS.tipo), v.tipo, (t) => { cambios.tipo = t; })),
    campo('Precio cobrado (sin envío)', precio, `Precio de lista: ${pesos(v.precio_lista)}. Vacío = precio de lista.`),
    campo('Origen', origen),
    campo('Notas', h('textarea', { value: v.notas || '', oninput: (e) => { cambios.notas = e.target.value; } })),
    h('details', { class: 'plegable', ontoggle: (e) => editor.mostrarCajas(e.target.open) },
      h('summary', {}, 'Cambiar productos'),
      h('p', { class: 'ayuda' }, 'Si cambiás los productos se recalculan el precio de lista y los costos con los valores de la fecha de la venta '
        + '(si tenía precio especial, se mantiene). Si no los tocás, la venta conserva los valores con los que se guardó.'),
      editor.el),
    h('p', { class: 'pie' }, h('a', { href: `#/ventas/${id}` }, 'Cancelar'))),
  h('div', { class: 'guardar' }, guardar));
}
