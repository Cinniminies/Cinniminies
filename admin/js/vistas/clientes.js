import { sb, q, rpc } from '../db.js';
import { h, vaciar, campo, pesos, numero, fechaCorta, diaMes, toast, conBoton, linkWhatsapp, normalizar, plural } from '../util.js';
import { filaLista, pastilla, monto, linkExterno } from '../componentes.js';
import { clientes as leerClientes, origenes as leerOrigenes } from '../catalogo.js';
import { irA } from '../app.js';
import { textoPanel } from '../textos.js';
import { campanaVigente, codigoDe, bonoDe, linkCodigo, ESTADO_RECOMENDACION, CLASE_RECOMENDACION } from '../recomendacion.js';

let busqueda = '';

export async function mostrar(cont, { id }) {
  return id ? ficha(cont, id) : lista(cont);
}

async function lista(cont) {
  const todos = (await leerClientes()).sort((a, b) => Number(b.total_comprado) - Number(a.total_comprado));
  const resultados = h('ul', { class: 'lista' });
  const dibujar = () => {
    const t = normalizar(busqueda.trim());
    const visibles = t ? todos.filter((c) => normalizar(c.nombre).includes(t) || normalizar(c.contacto).includes(t)) : todos;
    vaciar(resultados, visibles.map((c) => filaLista({
      href: `#/clientes/${c.id}`,
      titulo: c.nombre,
      detalle: [c.origen, plural(c.compras, 'compra'), c.ultima_compra ? `última ${fechaCorta(c.ultima_compra)}` : null],
      derecha: monto(pesos(c.total_comprado)),
    })));
  };
  vaciar(cont,
    campo('Buscar', h('input', { type: 'search', value: busqueda, placeholder: 'Nombre o contacto', oninput: (e) => { busqueda = e.target.value; dibujar(); } })),
    h('p', { class: 'ayuda' }, textoPanel('panel.clientes.cuantos', '{cantidad} clientes', { cantidad: todos.length })),
    resultados);
  dibujar();
}

async function ficha(cont, id) {
  const [todos, origenes, ventas, codigo, campana, recomendo, saldo, bono] = await Promise.all([
    leerClientes(),
    leerOrigenes(),
    q(sb.from('v_ventas').select('id,fecha,formatos,total,estado_pago').eq('cliente_id', id).order('fecha', { ascending: false })),
    codigoDe(id),
    campanaVigente(),
    q(sb.from('v_recomendaciones').select('*').eq('recomendador_id', id).order('creado_en', { ascending: false })),
    rpc('saldo_recomendacion', { p_cliente: id }),
    bonoDe(id),
  ]);
  const c = todos.find((x) => x.id === id);
  if (!c) throw new Error(textoPanel('panel.clientes.no_existe', 'El cliente no existe (¿lo fusionaron o borraron?)'));
  const waCodigo = codigo ? linkCodigo(c.contacto, c.nombre, codigo, campana, bono) : null;
  const datos = { nombre: c.nombre, contacto: c.contacto || '', origen: c.origen || '', notas: c.notas || '' };
  const entrada = (clave, attrs = {}) => h('input', { ...attrs, value: datos[clave], oninput: (e) => { datos[clave] = e.target.value; } });
  const wa = linkWhatsapp(c.contacto);

  const guardar = h('button', { class: 'btn primario', type: 'button' }, 'Guardar');
  guardar.onclick = () => conBoton(guardar, async () => {
    if (!datos.nombre.trim()) throw new Error(textoPanel('panel.clientes.falta_nombre', 'El nombre no puede quedar vacío'));
    await q(sb.from('clientes').update({
      nombre: datos.nombre.trim(), contacto: datos.contacto.trim() || null,
      origen: datos.origen.trim() || null, notas: datos.notas.trim() || null,
    }).eq('id', id));
    toast(textoPanel('panel.clientes.actualizado', 'Cliente actualizado'));
    irA(`#/clientes/${id}`);
  });

  // Fusionar: este cliente se queda con las ventas del otro, que se borra.
  const otro = h('select', {},
    h('option', { value: '' }, 'Elegí el duplicado…'),
    todos.filter((x) => x.id !== id).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      .map((x) => h('option', { value: x.id }, `${x.nombre} (${x.compras})`)));
  const fusionar = h('button', { class: 'btn', type: 'button' }, 'Fusionar');
  fusionar.onclick = () => conBoton(fusionar, async () => {
    const dup = todos.find((x) => x.id === otro.value);
    if (!dup) throw new Error(textoPanel('panel.clientes.falta_duplicado', 'Elegí el cliente duplicado'));
    const pregunta = textoPanel('panel.clientes.fusionar_confirmar',
      'Las {compras} ventas de "{duplicado}" pasan a "{cliente}" y "{duplicado}" se borra. ¿Seguir?',
      { compras: dup.compras, duplicado: dup.nombre, cliente: c.nombre });
    if (!confirm(pregunta)) return;
    await rpc('fusionar_clientes', { p_quedar: id, p_borrar: dup.id });
    toast(textoPanel('panel.clientes.fusionados', 'Clientes fusionados'));
    irA(`#/clientes/${id}`);
  });

  const borrar = h('button', { class: 'btn peligro', type: 'button' }, 'Borrar cliente');
  borrar.onclick = () => conBoton(borrar, async () => {
    if (!confirm(textoPanel('panel.clientes.borrar_confirmar', '¿Borrar a "{cliente}"?', { cliente: c.nombre }))) return;
    await q(sb.from('clientes').delete().eq('id', id));
    toast(textoPanel('panel.clientes.borrado', 'Cliente borrado'));
    irA('#/clientes');
  });

  vaciar(cont,
    h('div', { class: 'card' },
      h('h1', {}, c.nombre),
      h('p', { class: 'ayuda' }, `${plural(c.compras, 'compra')} · ${pesos(c.total_comprado)}`,
        c.ultima_compra ? ` · última ${fechaCorta(c.ultima_compra)}` : '',
        wa ? [' · ', linkExterno(wa, 'WhatsApp')] : null),
      campo('Nombre', entrada('nombre')),
      campo('Contacto', entrada('contacto', { placeholder: '099 123 456 o @instagram' })),
      campo('Cómo llegó', entrada('origen', { list: 'lista-origenes' })),
      h('datalist', { id: 'lista-origenes' }, origenes.map((o) => h('option', { value: o }))),
      campo('Notas', entrada('notas')),
      h('div', { class: 'acciones' }, guardar)),

    codigo ? h('div', { class: 'card' },
      h('div', { class: 'seccion-cab' }, h('strong', {}, `Código para recomendar: ${codigo}`),
        waCodigo ? linkExterno(waCodigo, 'Mandar por WhatsApp', { clase: 'btn chico' }) : null),
      h('p', { class: 'ayuda' }, campana || bono
        ? textoPanel('panel.clientes.descuento',
          'Hoy tiene {porcentaje} % de descuento en una box de cada pedido que haga en la web con su código.',
          { porcentaje: numero(saldo, 0) })
        : textoPanel('panel.clientes.sin_campana', 'No hay una campaña en curso.')),
      bono ? h('p', { class: 'ayuda' }, textoPanel('panel.clientes.bono',
        'Incluye {porcentaje} % por su primera Box de 12 de la web (desde el {desde}, vale hasta el {hasta}).',
        { porcentaje: numero(bono.porcentaje, 0), desde: diaMes(bono.desde), hasta: diaMes(bono.hasta) })) : null,
      recomendo.length ? h('ul', { class: 'lista' }, recomendo.map((r) => filaLista({
        titulo: r.recomendado || r.nombre_pedido,
        detalle: [fechaCorta(r.creado_en), r.motivo],
        derecha: pastilla(CLASE_RECOMENDACION[r.estado], ESTADO_RECOMENDACION[r.estado]),
      })))
        : h('p', { class: 'ayuda' }, textoPanel('panel.clientes.sin_recomendados', 'Todavía no recomendó a nadie.'))) : null,

    h('h2', {}, textoPanel('panel.clientes.compras', 'Compras')),
    ventas.length
      ? h('ul', { class: 'lista' }, ventas.map((v) => filaLista({
        href: `#/ventas/${v.id}`,
        titulo: [v.formatos || 'Venta', v.estado_pago === 'pendiente' ? pastilla('pendiente', 'Pendiente') : null],
        detalle: fechaCorta(v.fecha),
        derecha: monto(pesos(v.total)),
      })))
      : h('p', { class: 'vacio' }, textoPanel('panel.clientes.sin_compras', 'Sin compras.')),

    h('details', { class: 'plegable' },
      h('summary', {}, textoPanel('panel.clientes.fusionar', 'Fusionar con un duplicado')),
      h('p', { class: 'ayuda' }, textoPanel('panel.clientes.fusionar_ayuda',
        'Si el mismo cliente está cargado dos veces, elegí el otro: sus ventas pasan a "{cliente}" y el duplicado se borra.',
        { cliente: c.nombre })),
      campo('Duplicado', otro),
      h('div', { class: 'acciones', style: 'margin-bottom:1rem' }, fusionar)),

    ventas.length ? null : h('div', { class: 'acciones' }, borrar));
}
