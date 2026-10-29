import { sb, q, rpc } from '../db.js';
import { h, vaciar, campo, pesos, numero, fechaCorta, toast, conBoton, linkWhatsapp, normalizar, plural } from '../util.js';
import { filaLista, pastilla, monto } from '../componentes.js';
import { clientes as leerClientes, origenes as leerOrigenes } from '../catalogo.js';
import { irA } from '../app.js';
import { campanaVigente, codigoDe, bonoDe, diaMes, linkCodigo, ESTADO_RECOMENDACION, CLASE_RECOMENDACION } from '../recomendacion.js';

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
    h('p', { class: 'ayuda' }, `${todos.length} clientes`),
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
  if (!c) throw new Error('El cliente no existe (¿lo fusionaron o borraron?)');
  const waCodigo = codigo ? linkCodigo(c.contacto, c.nombre, codigo, campana, bono) : null;
  const datos = { nombre: c.nombre, contacto: c.contacto || '', origen: c.origen || '', notas: c.notas || '' };
  const entrada = (clave, attrs = {}) => h('input', { ...attrs, value: datos[clave], oninput: (e) => { datos[clave] = e.target.value; } });
  const wa = linkWhatsapp(c.contacto);

  const guardar = h('button', { class: 'btn primario', type: 'button' }, 'Guardar');
  guardar.onclick = () => conBoton(guardar, async () => {
    if (!datos.nombre.trim()) throw new Error('El nombre no puede quedar vacío');
    await q(sb.from('clientes').update({
      nombre: datos.nombre.trim(), contacto: datos.contacto.trim() || null,
      origen: datos.origen.trim() || null, notas: datos.notas.trim() || null,
    }).eq('id', id));
    toast('Cliente actualizado');
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
    if (!dup) throw new Error('Elegí el cliente duplicado');
    if (!confirm(`Las ${dup.compras} ventas de "${dup.nombre}" pasan a "${c.nombre}" y "${dup.nombre}" se borra. ¿Seguir?`)) return;
    await rpc('fusionar_clientes', { p_quedar: id, p_borrar: dup.id });
    toast('Clientes fusionados');
    irA(`#/clientes/${id}`);
  });

  const borrar = h('button', { class: 'btn peligro', type: 'button' }, 'Borrar cliente');
  borrar.onclick = () => conBoton(borrar, async () => {
    if (!confirm(`¿Borrar a "${c.nombre}"?`)) return;
    await q(sb.from('clientes').delete().eq('id', id));
    toast('Cliente borrado');
    irA('#/clientes');
  });

  vaciar(cont,
    h('div', { class: 'card' },
      h('h1', {}, c.nombre),
      h('p', { class: 'ayuda' }, `${plural(c.compras, 'compra')} · ${pesos(c.total_comprado)}`,
        c.ultima_compra ? ` · última ${fechaCorta(c.ultima_compra)}` : '',
        wa ? [' · ', h('a', { href: wa, target: '_blank', rel: 'noopener' }, 'WhatsApp')] : null),
      campo('Nombre', entrada('nombre')),
      campo('Contacto', entrada('contacto', { placeholder: '099 123 456 o @instagram' })),
      campo('Cómo llegó', entrada('origen', { list: 'lista-origenes' })),
      h('datalist', { id: 'lista-origenes' }, origenes.map((o) => h('option', { value: o }))),
      campo('Notas', entrada('notas')),
      h('div', { class: 'acciones' }, guardar)),

    codigo ? h('div', { class: 'card' },
      h('div', { class: 'seccion-cab' }, h('strong', {}, `Código para recomendar: ${codigo}`),
        waCodigo ? h('a', { class: 'btn chico', href: waCodigo, target: '_blank', rel: 'noopener' }, 'Mandar por WhatsApp') : null),
      h('p', { class: 'ayuda' }, campana || bono
        ? `Hoy tiene ${numero(saldo, 0)} % de descuento en una box de cada pedido que haga en la web con su código.`
        : 'No hay una campaña en curso.'),
      bono ? h('p', { class: 'ayuda' },
        `Incluye ${numero(bono.porcentaje, 0)} % por su primera Box de 12 de la web (desde el ${diaMes(bono.desde)}, vale hasta el ${diaMes(bono.hasta)}).`) : null,
      recomendo.length ? h('ul', { class: 'lista' }, recomendo.map((r) => filaLista({
        titulo: r.recomendado || r.nombre_pedido,
        detalle: [fechaCorta(r.creado_en), r.motivo],
        derecha: pastilla(CLASE_RECOMENDACION[r.estado], ESTADO_RECOMENDACION[r.estado]),
      })))
        : h('p', { class: 'ayuda' }, 'Todavía no recomendó a nadie.')) : null,

    h('h2', {}, 'Compras'),
    ventas.length
      ? h('ul', { class: 'lista' }, ventas.map((v) => filaLista({
        href: `#/ventas/${v.id}`,
        titulo: [v.formatos || 'Venta', v.estado_pago === 'pendiente' ? pastilla('pendiente', 'Pendiente') : null],
        detalle: fechaCorta(v.fecha),
        derecha: monto(pesos(v.total)),
      })))
      : h('p', { class: 'vacio' }, 'Sin compras.'),

    h('details', { class: 'plegable' },
      h('summary', {}, 'Fusionar con un duplicado'),
      h('p', { class: 'ayuda' }, `Si el mismo cliente está cargado dos veces, elegí el otro: sus ventas pasan a "${c.nombre}" y el duplicado se borra.`),
      campo('Duplicado', otro),
      h('div', { class: 'acciones', style: 'margin-bottom:1rem' }, fusionar)),

    ventas.length ? null : h('div', { class: 'acciones' }, borrar));
}
