import { sb, q, rpc } from '../db.js';
import { h, vaciar, chips, stepper, campo, grupo, hoyISO, fechaCorta, numero, toast, conBoton } from '../util.js';
import { catalogo } from '../catalogo.js';
import { irA } from '../app.js';

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
        fn: async () => { await q(sb.from('tandas').delete().eq('id', r.tanda_id)); toast('Tanda deshecha'); irA('#/tandas'); },
      },
    });
    irA('#/tandas');
  });

  const produccionPorSabor = produccion.filter((p) => Number(p.tandas) > 0);

  vaciar(cont,
    h('div', { class: 'card' },
      campo('Fecha', h('input', { type: 'date', value: f.fecha, max: hoyISO(), onchange: (e) => { f.fecha = e.target.value; } })),
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
        return h('li', {}, h('div', { class: 'fila' },
          h('div', { class: 'princ' },
            h('div', { class: 't1' }, `${numero(t.cantidad)} × ${t.sabores.nombre}`),
            h('div', { class: 't2' }, `${fechaCorta(t.fecha)} · ${t.rolls} rolls${t.notas ? ' · ' + t.notas : ''}`)),
          borrar));
      }))
      : h('p', { class: 'vacio' }, 'Todavía no hay tandas.'));
}
