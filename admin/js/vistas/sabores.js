import { sb, q, rpc, contar } from '../db.js';
import { h, vaciar, campo, interruptor, pesos, plural, toast, conBoton } from '../util.js';
import { catalogo, invalidarCatalogo } from '../catalogo.js';
import { seccionPrecios } from '../componentes.js';
import { irA } from '../app.js';

export async function mostrar(cont, { id }) {
  return id ? ficha(cont, id === 'nuevo' ? null : id) : lista(cont);
}

async function lista(cont) {
  const [sabores, costos] = await Promise.all([
    q(sb.from('sabores').select('*').order('activo', { ascending: false }).order('orden').order('nombre')),
    q(sb.from('v_costo_sabor').select('sabor_id,costo_roll,precio_unidad')),
  ]);
  const costoDe = Object.fromEntries(costos.map((c) => [c.sabor_id, c]));
  vaciar(cont,
    h('ul', { class: 'lista' }, sabores.map((s) => h('li', {}, h('a', { class: 'fila', href: `#/sabores/${s.id}` },
      h('div', { class: 'princ' },
        h('div', { class: 't1' }, s.nombre, ' ',
          s.activo ? null : h('span', { class: 'badge neutro' }, 'Inactivo'), ' ',
          s.visible_web ? h('span', { class: 'badge ok' }, 'En la web') : null),
        h('div', { class: 't2' }, costoDe[s.id]?.costo_roll != null
          ? `Costo ${pesos(costoDe[s.id].costo_roll)} por roll · unidad ${pesos(costoDe[s.id].precio_unidad)}`
          : 'Sin receta')),
      '›')))),
    h('div', { class: 'acciones' }, h('a', { class: 'btn primario', href: '#/sabores/nuevo' }, '+ Nuevo sabor')));
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
    : { nombre: '', nombre_corto: '', slug: '', descripcion: '', etiqueta_web: '', rolls_por_tanda: 12, activo: true, visible_web: false, orden: 10 };
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

  const conReceta = cat.sabores.filter((s) => s.id !== id && recetas.some((r) => r.sabor_id === s.id));
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
    const fila = {
      nombre: datos.nombre.trim(),
      nombre_corto: datos.nombre_corto?.trim() || null,
      slug: datos.slug?.trim() || null,
      descripcion: datos.descripcion?.trim() || null,
      etiqueta_web: datos.etiqueta_web?.trim() || null,
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
    invalidarCatalogo();
    toast(id ? 'Sabor guardado' : 'Sabor creado');
    irA(`#/sabores/${guardado.id}`);
  });

  const texto = (clave, attrs = {}) => h('input', { ...attrs, value: datos[clave] ?? '', oninput: (e) => { datos[clave] = e.target.value; } });
  const [vendidos, tandas] = usos;
  const usado = vendidos + tandas > 0;
  let borrar = null;
  if (id && !usado) {
    borrar = h('button', { class: 'btn peligro', type: 'button' }, 'Borrar sabor');
    borrar.onclick = () => conBoton(borrar, async () => {
      if (!confirm(`¿Borrar "${sabor.nombre}"? Todavía no se vendió ni se hizo ninguna tanda.`)) return;
      await q(sb.from('precios').delete().eq('sabor_id', id));
      await q(sb.from('sabores').delete().eq('id', id));
      invalidarCatalogo();
      toast('Sabor borrado');
      irA('#/sabores');
    });
  }

  vaciar(cont,
    h('div', { class: 'card' },
      h('h1', { style: 'margin-top:0' }, sabor?.nombre || 'Nuevo sabor'),
      campo('Nombre', texto('nombre', { placeholder: 'Pistacho' })),
      h('div', { class: 'fila-campos' },
        campo('Nombre corto', texto('nombre_corto', { placeholder: 'Para listas: DDL' })),
        campo('Rolls por tanda', h('input', { type: 'number', inputmode: 'numeric', min: 1, value: datos.rolls_por_tanda,
          oninput: (e) => { datos.rolls_por_tanda = e.target.value; calcularCosto(); } }))),
      interruptor('Activo', datos.activo, (v) => { datos.activo = v; }, 'Se puede vender y hacer tandas. Desactivalo en vez de borrarlo.'),
      interruptor('Visible en la web', datos.visible_web, (v) => { datos.visible_web = v; }, 'Se usa cuando la web lea el catálogo (etapa 5).'),
      h('details', { class: 'plegable' }, h('summary', {}, 'Textos para la web y orden'),
        campo('Etiqueta', texto('etiqueta_web', { placeholder: 'Nuestro producto estrella' })),
        campo('Descripción', h('textarea', { value: datos.descripcion || '', oninput: (e) => { datos.descripcion = e.target.value; } })),
        h('div', { class: 'fila-campos' },
          campo('Identificador web', texto('slug', { placeholder: 'pistacho' })),
          campo('Orden', texto('orden', { type: 'number', inputmode: 'numeric' }))))),

    h('div', { class: 'card' },
      h('div', { class: 'seccion-cab' }, h('h3', {}, 'Receta por tanda'), copiar),
      filasReceta,
      h('button', { type: 'button', class: 'btn chico', onclick: () => { receta.push({ insumo_id: '', cantidad: 0 }); dibujarReceta(); } }, '+ Ingrediente'),
      costoReceta),

    h('div', { class: 'acciones' }, guardar, borrar),

    id ? h('div', { class: 'card', style: 'margin-top:1rem' },
      h('h3', {}, 'Precio por unidad'),
      h('p', { class: 'ayuda' }, 'Lo que vale un roll suelto de este sabor (personalizado y unidad). Las cajas tienen su precio en Formatos.'),
      seccionPrecios(precios,
        async (precio, desde) => { await rpc('fijar_precio', { p: { sabor_id: id, precio, vigente_desde: desde } }); toast('Precio guardado'); irA(`#/sabores/${id}`); },
        async (pid) => { await q(sb.from('precios').delete().eq('id', pid)); toast('Precio borrado'); irA(`#/sabores/${id}`); }))
      : h('p', { class: 'ayuda' }, 'El precio por unidad se carga después de crear el sabor.'),

    usado && id ? h('p', { class: 'ayuda' }, `Se vendió en ${plural(vendidos, 'venta')} y tiene ${plural(tandas, 'tanda')}: no se puede borrar, pero se puede desactivar.`) : null,
    h('p', { class: 'pie' }, h('a', { href: '#/sabores' }, '← Volver a sabores')));
  dibujarReceta();
}
