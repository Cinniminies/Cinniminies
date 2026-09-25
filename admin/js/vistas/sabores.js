import { sb, q, rpc, contar } from '../db.js';
import { h, vaciar, campo, interruptor, pesos, plural, toast, conBoton } from '../util.js';
import { catalogo, invalidarCatalogo } from '../catalogo.js';
import { seccionPrecios } from '../componentes.js';
import { irA } from '../app.js';
import { srcFoto, subirFoto, borrarFotoDelBucket } from '../fotos.js';

export async function mostrar(cont, { id }) {
  return id ? ficha(cont, id === 'nuevo' ? null : id) : lista(cont);
}

async function lista(cont) {
  const [sabores, costos] = await Promise.all([
    q(sb.from('sabores').select('*').order('activo', { ascending: false }).order('orden').order('nombre')),
    q(sb.from('v_costo_sabor').select('sabor_id,costo_roll,precio_unidad')),
  ]);
  const costoDe = Object.fromEntries(costos.map((c) => [c.sabor_id, c]));
  const eliminados = sabores.filter((s) => s.eliminado);
  vaciar(cont,
    h('ul', { class: 'lista' }, sabores.filter((s) => !s.eliminado).map((s) => h('li', {}, h('a', { class: 'fila', href: `#/sabores/${s.id}` },
      h('div', { class: 'princ' },
        h('div', { class: 't1' }, s.nombre, ' ',
          s.activo ? null : h('span', { class: 'badge neutro' }, 'Inactivo'), ' ',
          s.visible_web ? h('span', { class: 'badge ok' }, 'En la web') : null),
        h('div', { class: 't2' }, costoDe[s.id]?.costo_roll != null
          ? `Costo ${pesos(costoDe[s.id].costo_roll)} por roll · unidad ${pesos(costoDe[s.id].precio_unidad)}`
          : 'Sin receta')),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'))))),
    h('div', { class: 'acciones' }, h('a', { class: 'btn primario', href: '#/sabores/nuevo' }, '+ Nuevo sabor')),
    eliminados.length ? h('details', { class: 'plegable', style: 'margin-top:1.25rem' },
      h('summary', {}, `Eliminados (${eliminados.length})`),
      h('p', { class: 'ayuda' }, 'Tienen ventas o tandas, así que se guardan para el historial. Entrá para restaurarlos.'),
      h('ul', { class: 'lista' }, eliminados.map((s) => h('li', {}, h('a', { class: 'fila', href: `#/sabores/${s.id}` },
        h('div', { class: 'princ' }, h('div', { class: 't1' }, s.nombre)),
        h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')))))) : null);
}

async function ficha(cont, id) {
  const [cat, recetas, costos, precios, usos] = await Promise.all([
    catalogo(true),
    q(sb.from('recetas').select('sabor_id,insumo_id,cantidad')),
    q(sb.from('v_costo_insumo').select('insumo_id,costo_unitario')),
    id ? q(sb.from('precios').select('id,precio,vigente_desde').eq('sabor_id', id).is('formato_id', null)) : [],
    id ? Promise.all([
      contar('venta_linea_sabores', (c) => c.eq('sabor_id', id)),
      contar('tandas', (c) => c.eq('sabor_id', id)),
    ]) : [0, 0],
  ]);
  const sabor = id ? cat.sabor(id) : null;
  if (id && !sabor) throw new Error('El sabor no existe');
  const datos = sabor
    ? { ...sabor }
    : { nombre: '', nombre_corto: '', slug: '', descripcion: '', etiqueta_web: '', foto: '', rolls_por_tanda: 12, activo: true, visible_web: false, orden: 10 };
  const costoDe = Object.fromEntries(costos.map((c) => [c.insumo_id, Number(c.costo_unitario)]));
  const receta = recetas.filter((r) => r.sabor_id === id).map((r) => ({ insumo_id: r.insumo_id, cantidad: Number(r.cantidad) }));

  // ---- receta
  const ingredientes = cat.insumos.filter((i) => i.tipo === 'ingrediente');
  const filasReceta = h('div');
  const costoReceta = h('p', { class: 'ayuda' });

  function calcularCosto() {
    let total = 0;
    let falta = false;
    for (const r of receta) {
      if (!r.insumo_id || !r.cantidad) continue;
      if (costoDe[r.insumo_id] == null) falta = true;
      else total += r.cantidad * costoDe[r.insumo_id];
    }
    const rolls = Number(datos.rolls_por_tanda) || 12;
    costoReceta.textContent = receta.some((r) => r.insumo_id && r.cantidad)
      ? `Costo por tanda ${pesos(total)} · por roll ${pesos(total / rolls)}${falta ? ' (hay ingredientes sin costo: cargales una compra o un costo de referencia)' : ''}`
      : 'Sin receta: no se puede vender ni hacer tandas de este sabor.';
  }

  function dibujarReceta() {
    vaciar(filasReceta, receta.map((r, i) => {
      const unidad = cat.insumo(r.insumo_id)?.unidad_base || '';
      const sel = h('select', { onchange: (e) => { r.insumo_id = e.target.value; dibujarReceta(); } },
        h('option', { value: '' }, 'Ingrediente…'),
        ingredientes.filter((ing) => ing.activo || ing.id === r.insumo_id)
          .map((ing) => h('option', { value: ing.id }, ing.nombre)));
      sel.value = r.insumo_id || '';
      return h('div', { class: 'receta-fila' },
        sel,
        h('div', { class: 'unidad' },
          h('input', { type: 'number', inputmode: 'decimal', min: 0, step: 'any', value: r.cantidad || '',
            oninput: (e) => { r.cantidad = Number(e.target.value); calcularCosto(); } }),
          h('small', {}, unidad)),
        h('button', { type: 'button', class: 'quitar', 'aria-label': 'Quitar', onclick: () => { receta.splice(i, 1); dibujarReceta(); } }, '×'));
    }));
    calcularCosto();
  }

  const conReceta = cat.sabores.filter((s) => s.id !== id && !s.eliminado && recetas.some((r) => r.sabor_id === s.id));
  const copiar = h('select', {
    onchange: (e) => {
      if (!e.target.value) return;
      receta.splice(0, receta.length, ...recetas.filter((r) => r.sabor_id === e.target.value)
        .map((r) => ({ insumo_id: r.insumo_id, cantidad: Number(r.cantidad) })));
      e.target.value = '';
      dibujarReceta();
      toast('Receta copiada: ajustala y guardá');
    },
  }, h('option', { value: '' }, 'Copiar receta de…'), conReceta.map((s) => h('option', { value: s.id }, s.nombre)));

  // ---- guardar
  const guardar = h('button', { class: 'btn primario', type: 'button' }, id ? 'Guardar' : 'Crear sabor');
  guardar.onclick = () => conBoton(guardar, async () => {
    if (!datos.nombre.trim()) throw new Error('Poné el nombre');
    if (!(Number(datos.rolls_por_tanda) > 0)) throw new Error('Los rolls por tanda tienen que ser más de 0');
    if (datos.eliminado && (datos.activo || datos.visible_web)) throw new Error('Primero restaurá el sabor (arriba)');
    const fila = {
      nombre: datos.nombre.trim(),
      nombre_corto: datos.nombre_corto?.trim() || null,
      slug: datos.slug?.trim() || null,
      descripcion: datos.descripcion?.trim() || null,
      etiqueta_web: datos.etiqueta_web?.trim() || null,
      foto: datos.foto?.trim() || null,
      rolls_por_tanda: Number(datos.rolls_por_tanda),
      activo: datos.activo,
      visible_web: datos.visible_web,
      orden: Number(datos.orden) || 0,
    };
    const guardado = id
      ? await q(sb.from('sabores').update(fila).eq('id', id).select('id').single())
      : await q(sb.from('sabores').insert(fila).select('id').single());
    await rpc('guardar_receta', {
      p_sabor: guardado.id,
      p_items: receta.filter((r) => r.insumo_id && r.cantidad > 0).map((r) => ({ insumo_id: r.insumo_id, cantidad: r.cantidad })),
    });
    if (sabor?.foto && sabor.foto !== fila.foto) await borrarFotoDelBucket('sabores', sabor.foto);
    invalidarCatalogo();
    toast(id ? 'Sabor guardado' : 'Sabor creado');
    irA(`#/sabores/${guardado.id}`);
  });

  const texto = (clave, attrs = {}) => h('input', { ...attrs, value: datos[clave] ?? '', oninput: (e) => { datos[clave] = e.target.value; } });
  const [vendidos, tandas] = usos;
  const usado = vendidos + tandas > 0;
  let eliminar = null;
  if (id && !sabor.eliminado) {
    eliminar = h('button', { class: 'btn peligro', type: 'button' }, 'Eliminar sabor');
    eliminar.onclick = () => conBoton(eliminar, async () => {
      const aviso = usado
        ? `¿Eliminar "${sabor.nombre}"? Tiene ${plural(vendidos, 'venta')} y ${plural(tandas, 'tanda')}: esas quedan en el historial, `
          + 'pero el sabor desaparece de la lista, de la carga y de la web. Se puede restaurar.'
        : `¿Eliminar "${sabor.nombre}" para siempre? Se borran también su receta y sus precios.`;
      if (!confirm(aviso)) return;
      const r = await rpc('eliminar_sabor', { p_sabor: id });
      if (r === 'borrado') await borrarFotoDelBucket('sabores', sabor.foto);
      invalidarCatalogo();
      toast(r === 'borrado' ? 'Sabor borrado' : 'Sabor eliminado (se puede restaurar)');
      irA('#/sabores');
    });
  }
  let avisoEliminado = null;
  if (sabor?.eliminado) {
    const restaurar = h('button', { class: 'btn primario', type: 'button' }, 'Restaurar sabor');
    restaurar.onclick = () => conBoton(restaurar, async () => {
      await q(sb.from('sabores').update({ eliminado: false }).eq('id', id));
      invalidarCatalogo();
      toast('Sabor restaurado: quedó inactivo, activalo si lo vas a vender');
      irA(`#/sabores/${id}`);
    });
    avisoEliminado = h('div', { class: 'card' },
      h('p', { style: 'margin-top:0' }, h('strong', {}, 'Sabor eliminado. '),
        'No aparece en la carga ni en la web; sus ventas y tandas siguen en el historial.'),
      restaurar);
  }

  // ---- foto
  const vistaFoto = h('div', { class: 'foto-sabor' });
  const archivo = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const subir = h('button', { class: 'btn chico', type: 'button', onclick: () => archivo.click() });
  const quitar = h('button', { class: 'btn chico', type: 'button', onclick: () => { datos.foto = ''; dibujarFoto(); } }, 'Quitar');
  function dibujarFoto() {
    vaciar(vistaFoto, datos.foto
      ? h('img', { src: srcFoto(datos.foto), alt: `Foto de ${datos.nombre || 'el sabor'}` })
      : h('div', { class: 'foto-vacia' }, (datos.nombre || '?').charAt(0).toUpperCase()));
    subir.textContent = datos.foto ? 'Cambiar foto' : 'Subir foto';
    quitar.hidden = !datos.foto;
    rutaFoto.value = datos.foto || '';
  }
  archivo.onchange = () => conBoton(subir, async () => {
    const f = archivo.files[0];
    archivo.value = '';
    if (!f) return;
    subir.textContent = 'Subiendo…';
    try {
      datos.foto = await subirFoto('sabores', f, datos.slug || datos.nombre);
      toast('Foto subida: tocá Guardar para que quede');
    } finally {
      dibujarFoto();
    }
  });
  const rutaFoto = texto('foto', { placeholder: 'img/roll-pistacho.webp' });
  rutaFoto.addEventListener('change', dibujarFoto);

  vaciar(cont,
    avisoEliminado,
    h('div', { class: 'card' },
      h('h1', { style: 'margin-top:0' }, sabor?.nombre || 'Nuevo sabor'),
      campo('Nombre', texto('nombre', { placeholder: 'Pistacho' })),
      h('div', { class: 'fila-campos' },
        campo('Nombre corto', texto('nombre_corto', { placeholder: 'Para listas: DDL' })),
        campo('Rolls por tanda', h('input', { type: 'number', inputmode: 'numeric', min: 1, value: datos.rolls_por_tanda,
          oninput: (e) => { datos.rolls_por_tanda = e.target.value; calcularCosto(); } }))),
      interruptor('Activo', datos.activo, (v) => { datos.activo = v; }, 'Se puede vender y hacer tandas. Desactivalo en vez de borrarlo.'),
      interruptor('Visible en la web', datos.visible_web, (v) => { datos.visible_web = v; }, 'Aparece en la web (necesita el identificador web). La web se actualiza en unos 5 minutos.'),
      h('details', { class: 'plegable' }, h('summary', {}, 'Textos para la web y orden'),
        campo('Etiqueta', texto('etiqueta_web', { placeholder: 'Nuestro producto estrella' })),
        campo('Descripción', h('textarea', { value: datos.descripcion || '', oninput: (e) => { datos.descripcion = e.target.value; } })),
        h('div', { class: 'fila-campos' },
          campo('Identificador web', texto('slug', { placeholder: 'pistacho' })),
          campo('Orden', texto('orden', { type: 'number', inputmode: 'numeric' }))),
        h('p', { class: 'ayuda' }, 'En la caja personalizada de la web el sabor se ofrece solo si tiene precio por unidad.'))),

    h('div', { class: 'card' },
      h('h3', { style: 'margin-top:0' }, 'Foto para la web'),
      h('div', { class: 'foto-fila' }, vistaFoto,
        h('div', {},
          h('div', { class: 'acciones', style: 'margin-top:0' }, subir, quitar, archivo),
          h('p', { class: 'ayuda' }, 'Se achica sola antes de subirla. Sin foto, la web muestra la inicial del sabor.'))),
      h('details', { class: 'plegable' }, h('summary', {}, 'Usar una imagen del sitio o un link'),
        campo('Ruta o link', rutaFoto))),

    h('div', { class: 'card' },
      h('div', { class: 'seccion-cab' }, h('h3', {}, 'Receta por tanda'), copiar),
      filasReceta,
      h('button', { type: 'button', class: 'btn chico', onclick: () => { receta.push({ insumo_id: '', cantidad: 0 }); dibujarReceta(); } }, '+ Ingrediente'),
      costoReceta),

    h('div', { class: 'acciones' }, guardar, eliminar),

    id ? h('div', { class: 'card', style: 'margin-top:1rem' },
      h('h3', {}, 'Precio por unidad'),
      h('p', { class: 'ayuda' }, 'Lo que vale un roll suelto de este sabor (personalizado y unidad). Las cajas tienen su precio en Formatos.'),
      seccionPrecios(precios,
        async (precio, desde) => { await rpc('fijar_precio', { p: { sabor_id: id, precio, vigente_desde: desde } }); toast('Precio guardado'); irA(`#/sabores/${id}`); },
        async (pid) => { await q(sb.from('precios').delete().eq('id', pid)); toast('Precio borrado'); irA(`#/sabores/${id}`); }))
      : h('p', { class: 'ayuda' }, 'El precio por unidad se carga después de crear el sabor.'),

    usado && id && !sabor.eliminado ? h('p', { class: 'ayuda' }, `Se vendió en ${plural(vendidos, 'venta')} y tiene ${plural(tandas, 'tanda')}: `
      + 'al eliminarlo se oculta de todo pero se conserva para el historial (se puede restaurar).') : null);
  dibujarReceta();
  dibujarFoto();
}
