import { sb, q, rpc } from '../db.js';
import { h, vaciar, chips, stepper, campo, campoFecha, grupo, hoyISO, fechaCorta, numero, toast, conBoton } from '../util.js';
import { catalogo } from '../catalogo.js';
import { irA, refrescarSi } from '../app.js';
import { subnavProduccion } from '../componentes.js';

// Alta rápida ("2 × Canela") e historial. El consumo de insumos lo calcula registrar_tanda
// con la receta del día (snapshot en tanda_consumos).
export async function mostrar(cont) {
  const [cat, historial, produccion] = await Promise.all([
    catalogo(),
    q(sb.from('tandas').select('id,fecha,cantidad,rolls,notas,sabores(nombre)')
      .order('fecha', { ascending: false }).order('creado_en', { ascending: false }).limit(30)),
    q(sb.from('v_produccion_sabor').select('*')),
  ]);
  const f = { fecha: hoyISO(), sabor_id: null, cantidad: 1, rolls: '', notas: '' };
  const rollsPorTanda = () => cat.sabor(f.sabor_id)?.rolls_por_tanda || 12;
  const rollsInput = h('input', {
    type: 'number', inputmode: 'numeric', min: 0, placeholder: String(rollsPorTanda()),
    oninput: (e) => { f.rolls = e.target.value; },
  });
  const actualizarRolls = () => { rollsInput.placeholder = String(Math.round(f.cantidad * rollsPorTanda())); };

  const guardar = h('button', { class: 'btn primario bloque', type: 'button' }, 'Guardar tanda');
  guardar.onclick = () => conBoton(guardar, async () => {
    if (!f.sabor_id) throw new Error('Elegí el sabor');
    const r = await rpc('registrar_tanda', { p: { ...f, rolls: f.rolls === '' ? null : Number(f.rolls) } });
    toast(`Tanda guardada: ${numero(r.cantidad)} × ${r.sabor} (${r.rolls} rolls)`, {
      accion: {
        texto: 'Deshacer',
        fn: async () => { await q(sb.from('tandas').delete().eq('id', r.tanda_id)); toast('Tanda deshecha'); refrescarSi('#/tandas'); },
      },
    });
    irA('#/tandas');
  });

  const produccionPorSabor = produccion.filter((p) => Number(p.tandas) > 0);

  vaciar(cont,
    subnavProduccion('tandas'),
    h('div', { class: 'card' },
      campoFecha(f.fecha, (v) => { f.fecha = v; }),
      grupo('Sabor', chips(cat.saboresActivos.map((s) => ({ valor: s.id, texto: s.nombre })), null,
        (v) => { f.sabor_id = v; actualizarRolls(); })),
      h('div', { class: 'stepper-fila' }, h('div', { class: 'nombre' }, 'Tandas'),
        stepper(1, (v) => { f.cantidad = v; actualizarRolls(); }, { min: 1, max: 10 })),
      campo('Rolls que salieron', rollsInput, 'Dejalo vacío si salieron los de siempre.'),
      campo('Notas', h('input', { oninput: (e) => { f.notas = e.target.value; } })),
      guardar),

    produccionPorSabor.length ? [
      h('h2', {}, 'Producción total'),
      h('table', { class: 'tabla card' },
        h('tr', {}, h('th', {}, 'Sabor'), h('th', { class: 'num-der' }, 'Tandas'), h('th', { class: 'num-der' }, 'Producidos'),
          h('th', { class: 'num-der' }, 'Vendidos')),
        produccionPorSabor.map((p) => h('tr', {}, h('td', {}, p.nombre), h('td', { class: 'num-der' }, numero(p.tandas, 1)),
          h('td', { class: 'num-der' }, numero(p.rolls_producidos, 0)), h('td', { class: 'num-der' }, numero(p.rolls_vendidos, 0))))),
    ] : null,

    h('h2', {}, 'Últimas tandas'),
    historial.length
      ? h('ul', { class: 'lista' }, historial.map((t) => {
        const borrar = h('button', { class: 'btn chico peligro' }, 'Borrar');
        borrar.onclick = () => conBoton(borrar, async () => {
          if (!confirm(`¿Borrar la tanda de ${t.sabores.nombre} del ${fechaCorta(t.fecha)}?`)) return;
          await q(sb.from('tandas').delete().eq('id', t.id));
          toast('Tanda borrada');
          irA('#/tandas');
        });
        const li = h('li');
        const editar = h('button', { class: 'btn chico', type: 'button' }, 'Editar');
        let form = null;
        editar.onclick = () => {
          if (form) { form.remove(); form = null; return; }
          form = formEditar(t, () => { form.remove(); form = null; });
          li.append(form);
        };
        return vaciar(li, h('div', { class: 'fila' },
          h('div', { class: 'princ' },
            h('div', { class: 't1' }, `${numero(t.cantidad)} × ${t.sabores.nombre}`),
            h('div', { class: 't2' }, `${fechaCorta(t.fecha)} · ${t.rolls} rolls${t.notas ? ' · ' + t.notas : ''}`)),
          editar, borrar));
      }))
      : h('p', { class: 'vacio' }, 'Todavía no hay tandas.'));
}

// Corregir cuántas tandas se hicieron (por ejemplo, si salieron más que las del Plan de horneado).
// Lo consumido se escala en proporción, con la receta del día de la tanda.
function formEditar(t, cerrar) {
  const f = { cantidad: String(t.cantidad), rolls: String(t.rolls), notas: t.notas || '' };
  let rollsTocados = false;
  const rolls = h('input', {
    type: 'number', inputmode: 'numeric', min: 0, value: f.rolls,
    oninput: (e) => { f.rolls = e.target.value; rollsTocados = true; },
  });
  const cantidad = h('input', {
    type: 'number', inputmode: 'decimal', min: 0, step: 'any', value: f.cantidad,
    oninput: (e) => {
      f.cantidad = e.target.value;
      const n = Number(f.cantidad);
      if (!rollsTocados && n > 0) { f.rolls = String(Math.round(t.rolls * n / t.cantidad)); rolls.value = f.rolls; }
    },
  });
  const guardar = h('button', { class: 'btn primario chico', type: 'button' }, 'Guardar');
  guardar.onclick = () => conBoton(guardar, async () => {
    if (!(Number(f.cantidad) > 0)) throw new Error('Poné cuántas tandas se hicieron');
    if (f.rolls === '' || Number(f.rolls) < 0) throw new Error('Poné cuántos rolls salieron');
    await rpc('actualizar_tanda', { p_id: t.id, p: { cantidad: Number(f.cantidad), rolls: Number(f.rolls), notas: f.notas } });
    toast(`Tanda de ${t.sabores.nombre} corregida`);
    irA('#/tandas');
  });
  return h('div', { class: 'card', style: 'margin:.5rem 0' },
    h('div', { class: 'fila-campos' },
      campo('Tandas', cantidad),
      campo('Rolls que salieron', rolls)),
    campo('Notas', h('input', { value: f.notas, oninput: (e) => { f.notas = e.target.value; } })),
    h('div', { class: 'acciones' }, guardar, h('button', { class: 'btn chico', type: 'button', onclick: cerrar }, 'Cancelar')));
}
