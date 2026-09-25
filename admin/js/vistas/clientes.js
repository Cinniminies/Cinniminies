import { sb, q, rpc } from '../db.js';
import { h, vaciar, campo, pesos, fechaCorta, toast, conBoton, linkWhatsapp } from '../util.js';
import { clientes as leerClientes, origenes as leerOrigenes } from '../catalogo.js';
import { irA } from '../app.js';

let busqueda = '';
const normal = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export async function mostrar(cont, { id }) {
  return id ? ficha(cont, id) : lista(cont);
}

async function lista(cont) {
  const todos = (await leerClientes()).sort((a, b) => Number(b.total_comprado) - Number(a.total_comprado));
  const resultados = h('ul', { class: 'lista' });
  const dibujar = () => {
    const t = normal(busqueda.trim());
    const visibles = t ? todos.filter((c) => normal(c.nombre).includes(t) || normal(c.contacto).includes(t)) : todos;
    vaciar(resultados, visibles.map((c) => h('li', {}, h('a', { class: 'fila', href: `#/clientes/${c.id}` },
      h('div', { class: 'princ' },
        h('div', { class: 't1' }, c.nombre),
        h('div', { class: 't2' }, [c.origen, `${c.compras} ${c.compras === 1 ? 'compra' : 'compras'}`,
          c.ultima_compra ? `última ${fechaCorta(c.ultima_compra)}` : null].filter(Boolean).join(' · '))),
      h('span', { class: 'monto' }, pesos(c.total_comprado))))));
  };
  vaciar(cont,
    campo('Buscar', h('input', { type: 'search', value: busqueda, placeholder: 'Nombre o contacto', oninput: (e) => { busqueda = e.target.value; dibujar(); } })),
    h('p', { class: 'ayuda' }, `${todos.length} clientes`),
    resultados);
  dibujar();
}

async function ficha(cont, id) {
  const [todos, origenes, ventas] = await Promise.all([
    leerClientes(),
    leerOrigenes(),
    q(sb.from('v_ventas').select('id,fecha,formatos,total,estado_pago').eq('cliente_id', id).order('fecha', { ascending: false })),
  ]);
  const c = todos.find((x) => x.id === id);
  if (!c) throw new Error('El cliente no existe (¿lo fusionaron o borraron?)');
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
      h('h1', { style: 'margin-top:0' }, c.nombre),
      h('p', { class: 'ayuda' }, `${c.compras} ${c.compras === 1 ? 'compra' : 'compras'} · ${pesos(c.total_comprado)}`,
        c.ultima_compra ? ` · última ${fechaCorta(c.ultima_compra)}` : '',
        wa ? [' · ', h('a', { href: wa, target: '_blank', rel: 'noopener' }, 'WhatsApp')] : null),
      campo('Nombre', entrada('nombre')),
      campo('Contacto', entrada('contacto', { placeholder: '099 123 456 o @instagram' })),
      campo('Cómo llegó', entrada('origen', { list: 'lista-origenes' })),
      h('datalist', { id: 'lista-origenes' }, origenes.map((o) => h('option', { value: o }))),
      campo('Notas', entrada('notas')),
      h('div', { class: 'acciones' }, guardar)),

    h('h2', {}, 'Compras'),
    ventas.length
      ? h('ul', { class: 'lista' }, ventas.map((v) => h('li', {}, h('a', { class: 'fila', href: `#/ventas/${v.id}` },
        h('div', { class: 'princ' }, h('div', { class: 't1' }, v.formatos || 'Venta',
          v.estado_pago === 'pendiente' ? [' ', h('span', { class: 'badge pendiente' }, 'Pendiente')] : null),
        h('div', { class: 't2' }, fechaCorta(v.fecha))),
        h('span', { class: 'monto' }, pesos(v.total))))))
      : h('p', { class: 'vacio' }, 'Sin compras.'),

    h('details', { class: 'plegable' },
      h('summary', {}, 'Fusionar con un duplicado'),
      h('p', { class: 'ayuda' }, `Si el mismo cliente está cargado dos veces, elegí el otro: sus ventas pasan a "${c.nombre}" y el duplicado se borra.`),
      campo('Duplicado', otro),
      h('div', { class: 'acciones', style: 'margin-bottom:1rem' }, fusionar)),

    ventas.length ? null : h('div', { class: 'acciones' }, borrar),
    h('p', { class: 'pie' }, h('a', { href: '#/clientes' }, '← Volver a clientes')));
}
