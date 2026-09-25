import { sb, q, rpc, contar } from '../db.js';
import { h, vaciar, campo, chips, grupo, interruptor, pesos, precioVigenteDe, toast, conBoton } from '../util.js';
import { catalogo, invalidarCatalogo } from '../catalogo.js';
import { seccionPrecios } from '../componentes.js';
import { irA } from '../app.js';

const TIPOS = [
  { valor: 'caja_fija', texto: 'Caja fija' },
  { valor: 'personalizado', texto: 'Personalizado' },
  { valor: 'unidad', texto: 'Unidad' },
];
const AYUDA = {
  caja_fija: 'Una cantidad fija de rolls (6, 12…) a un precio por caja, con cualquier combinación de sabores.',
  personalizado: 'Entre un mínimo y un máximo de rolls; se cobra la suma del precio por unidad de cada sabor.',
  unidad: 'Rolls sueltos; se cobra el precio por unidad de cada sabor.',
};

export async function mostrar(cont, { id }) {
  return id ? ficha(cont, id === 'nuevo' ? null : id) : lista(cont);
}

async function lista(cont) {
  const [formatos, precios] = await Promise.all([
    q(sb.from('formatos').select('*').order('activo', { ascending: false }).order('orden').order('nombre')),
    q(sb.from('precios').select('formato_id,precio,vigente_desde').is('sabor_id', null).not('formato_id', 'is', null)),
  ]);
  const detalle = (f) => (f.tipo === 'caja_fija' ? `${f.rolls} rolls · ${pesos(precioVigenteDe(precios.filter((p) => p.formato_id === f.id)))}`
    : f.tipo === 'personalizado' ? `${f.min_rolls ?? 1} a ${f.max_rolls ?? '∞'} rolls · precio por unidad` : 'Precio por unidad');
  vaciar(cont,
    h('ul', { class: 'lista' }, formatos.map((f) => h('li', {}, h('a', { class: 'fila', href: `#/formatos/${f.id}` },
      h('div', { class: 'princ' },
        h('div', { class: 't1' }, f.nombre, ' ',
          f.activo ? null : h('span', { class: 'badge neutro' }, 'Inactivo'), ' ',
          f.visible_web ? h('span', { class: 'badge ok' }, 'En la web') : null),
        h('div', { class: 't2' }, detalle(f))),
      '›')))),
    h('div', { class: 'acciones' }, h('a', { class: 'btn primario', href: '#/formatos/nuevo' }, '+ Nuevo formato')));
}

async function ficha(cont, id) {
  const [cat, precios, ventas] = await Promise.all([
    catalogo(true),
    id ? q(sb.from('precios').select('id,sabor_id,precio,vigente_desde').eq('formato_id', id)) : [],
    id ? contar('venta_lineas', (c) => c.eq('formato_id', id)) : 0,
  ]);
  const formato = id ? cat.formato(id) : null;
  if (id && !formato) throw new Error('El formato no existe');
  const datos = formato
    ? { ...formato }
    : { nombre: '', tipo: 'caja_fija', rolls: 6, min_rolls: 3, max_rolls: 12, caja_insumo_id: null, activo: true, visible_web: false, orden: 10 };

  const ayuda = h('p', { class: 'ayuda' }, AYUDA[datos.tipo]);
  const numeroInput = (clave, attrs = {}) => h('input', { type: 'number', inputmode: 'numeric', min: 1, ...attrs,
    value: datos[clave] ?? '', oninput: (e) => { datos[clave] = e.target.value; } });
  const cajaSel = h('select', { onchange: (e) => { datos.caja_insumo_id = e.target.value || null; } },
    h('option', { value: '' }, 'Sin caja'),
    cat.insumos.filter((i) => i.tipo === 'packaging' && (i.activo || i.id === datos.caja_insumo_id))
      .map((i) => h('option', { value: i.id }, i.nombre)));
  cajaSel.value = datos.caja_insumo_id || '';

  const camposFija = h('div', {}, h('div', { class: 'fila-campos' },
    campo('Rolls por caja', numeroInput('rolls')), campo('Caja que usa', cajaSel)));
  const camposPers = h('div', {}, h('div', { class: 'fila-campos' },
    campo('Mínimo de rolls', numeroInput('min_rolls')), campo('Máximo de rolls', numeroInput('max_rolls'))),
  h('p', { class: 'ayuda' }, 'La caja se elige sola: la caja fija más chica donde entran los rolls.'));
  const mostrarCampos = () => {
    camposFija.hidden = datos.tipo !== 'caja_fija';
    camposPers.hidden = datos.tipo !== 'personalizado';
    ayuda.textContent = AYUDA[datos.tipo];
  };

  const guardar = h('button', { class: 'btn primario', type: 'button' }, id ? 'Guardar' : 'Crear formato');
  guardar.onclick = () => conBoton(guardar, async () => {
    if (!datos.nombre.trim()) throw new Error('Poné el nombre');
    const fila = {
      nombre: datos.nombre.trim(), tipo: datos.tipo, activo: datos.activo, visible_web: datos.visible_web,
      orden: Number(datos.orden) || 0,
      rolls: datos.tipo === 'caja_fija' ? Number(datos.rolls) : null,
      min_rolls: datos.tipo === 'personalizado' ? Number(datos.min_rolls) || null : null,
      max_rolls: datos.tipo === 'personalizado' ? Number(datos.max_rolls) || null : null,
      caja_insumo_id: datos.tipo === 'caja_fija' ? datos.caja_insumo_id : null,
    };
    if (fila.tipo === 'caja_fija' && !(fila.rolls > 0)) throw new Error('Poné cuántos rolls lleva la caja');
    if (fila.min_rolls && fila.max_rolls && fila.min_rolls > fila.max_rolls) throw new Error('El mínimo no puede ser mayor que el máximo');
    const guardado = id
      ? await q(sb.from('formatos').update(fila).eq('id', id).select('id').single())
      : await q(sb.from('formatos').insert(fila).select('id').single());
    invalidarCatalogo();
    toast(id ? 'Formato guardado' : 'Formato creado');
    irA(`#/formatos/${guardado.id}`);
  });

  let borrar = null;
  if (id && !ventas) {
    borrar = h('button', { class: 'btn peligro', type: 'button' }, 'Borrar formato');
    borrar.onclick = () => conBoton(borrar, async () => {
      if (!confirm(`¿Borrar "${formato.nombre}"? Todavía no se usó en ninguna venta.`)) return;
      await q(sb.from('precios').delete().eq('formato_id', id));
      await q(sb.from('formatos').delete().eq('id', id));
      invalidarCatalogo();
      toast('Formato borrado');
      irA('#/formatos');
    });
  }

  const refrescar = () => irA(`#/formatos/${id}`);
  const guardarPrecio = (sabor_id) => async (precio, desde) => {
    await rpc('fijar_precio', { p: { formato_id: id, sabor_id, precio, vigente_desde: desde } });
    toast('Precio guardado');
    refrescar();
  };
  const borrarPrecio = async (pid) => { await q(sb.from('precios').delete().eq('id', pid)); toast('Precio borrado'); refrescar(); };

  // Precios especiales de esta caja para un solo sabor (p. ej. "Box de 6 Nutella" más cara)
  const conEspecial = [...new Set(precios.filter((p) => p.sabor_id).map((p) => p.sabor_id))];
  const nuevoEspecial = h('select', {
    onchange: (e) => {
      if (!e.target.value) return;
      especiales.append(bloqueEspecial(e.target.value));
      e.target.querySelector(`option[value="${e.target.value}"]`).remove();
      e.target.value = '';
    },
  }, h('option', { value: '' }, '+ Precio especial para un sabor…'),
  cat.saboresActivos.filter((s) => !conEspecial.includes(s.id)).map((s) => h('option', { value: s.id }, s.nombre)));
  const bloqueEspecial = (sabor_id) => h('div', { class: 'card' },
    h('h3', {}, `${datos.nombre} ${cat.sabor(sabor_id)?.nombre || ''}`),
    seccionPrecios(precios.filter((p) => p.sabor_id === sabor_id), guardarPrecio(sabor_id), borrarPrecio,
      { sinPrecio: 'Sin precio especial: se usa el de la caja' }));
  const especiales = h('div', {}, conEspecial.map(bloqueEspecial));

  vaciar(cont,
    h('div', { class: 'card' },
      h('h1', { style: 'margin-top:0' }, formato?.nombre || 'Nuevo formato'),
      campo('Nombre', h('input', { value: datos.nombre, placeholder: 'Box de 9', oninput: (e) => { datos.nombre = e.target.value; } })),
      ventas
        ? h('p', { class: 'ayuda' }, `Tipo: ${TIPOS.find((t) => t.valor === datos.tipo).texto} (ya se usó en ventas, no se puede cambiar).`)
        : grupo('Tipo', chips(TIPOS, datos.tipo, (v) => { datos.tipo = v; mostrarCampos(); })),
      ayuda,
      camposFija,
      camposPers,
      interruptor('Activo', datos.activo, (v) => { datos.activo = v; }, 'Aparece para cargar ventas.'),
      interruptor('Visible en la web', datos.visible_web, (v) => { datos.visible_web = v; }),
      campo('Orden', numeroInput('orden', { min: 0 }))),
    h('div', { class: 'acciones' }, guardar, borrar),

    id && datos.tipo === 'caja_fija' ? [
      h('div', { class: 'card', style: 'margin-top:1rem' },
        h('h3', {}, 'Precio de la caja'),
        seccionPrecios(precios.filter((p) => !p.sabor_id), guardarPrecio(null), borrarPrecio)),
      h('h2', {}, 'Precios especiales por sabor'),
      h('p', { class: 'ayuda' }, 'Solo si una caja de un único sabor vale distinto (las mixtas usan el precio de la caja).'),
      especiales,
      campo('Agregar', nuevoEspecial),
    ] : null,
    id && datos.tipo !== 'caja_fija'
      ? h('p', { class: 'ayuda' }, 'Este formato cobra el precio por unidad de cada sabor: se carga en cada sabor.') : null,
    h('p', { class: 'pie' }, h('a', { href: '#/formatos' }, '← Volver a formatos')));
  mostrarCampos();
}
