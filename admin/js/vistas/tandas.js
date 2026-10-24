import { sb, q, rpc } from '../db.js';
import { h, vaciar, chips, stepper, campo, campoFecha, grupo, hoyISO, fechaCorta, numero, pesos, plural, toast, conBoton } from '../util.js';
import { catalogo } from '../catalogo.js';
import { irA, refrescarSi } from '../app.js';
import { subnavProduccion } from '../componentes.js';

// Alta rápida ("2 × Canela") e historial. El consumo de insumos lo calcula registrar_tanda
// con la receta del día (snapshot en tanda_consumos).
export async function mostrar(cont) {
  const [cat, historial, produccion, sobrantes] = await Promise.all([
    catalogo(),
    q(sb.from('tandas').select('id,fecha,cantidad,rolls,notas,sabores(nombre)')
      .order('fecha', { ascending: false }).order('creado_en', { ascending: false }).limit(30)),
    q(sb.from('v_produccion_sabor').select('*')),
    q(sb.from('v_sobrantes').select('*').order('inicio', { ascending: false })),
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

    seccionSobrantes(sobrantes, cat),

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

// Rolls que sobraron de cada horneado (v_sobrantes): producidos menos vendidos, regalados o comidos.
// Solo informativo: su costo es la pérdida, pero no va a gastos (la plata ya salió en las compras).
function seccionSobrantes(filas, cat) {
  if (!filas.length) return null;
  const porHorneado = new Map();
  for (const f of filas) {
    if (!porHorneado.has(f.inicio)) porHorneado.set(f.inicio, []);
    porHorneado.get(f.inicio).push(f);
  }
  const horneados = [...porHorneado.values()].slice(0, 8);
  const suma = (fs, k) => fs.reduce((a, f) => a + Number(f[k]), 0);
  const orden = (f) => cat.sabor(f.sabor_id)?.orden ?? 0;
  const titulo = (f) => (f.inicio === f.fin ? fechaCorta(f.inicio) : `${fechaCorta(f.inicio)} y ${fechaCorta(f.fin)}`);
  const total = suma(filas, 'costo');
  return [
    h('h2', {}, 'Rolls que sobraron'),
    h('p', { class: 'ayuda' }, 'Por horneado: lo que salió de las tandas menos lo vendido, regalado o comido. '
      + 'Los rolls sueltos que vendas en los días siguientes se descuentan del último horneado. '
      + 'Solo es pérdida lo que sobra dentro de lo que rinde la receta: si una tanda de 12 dio 13, el de más no cuenta. '
      + 'No se suma a gastos porque esa plata ya salió en las compras.'),
    horneados.map((fs) => {
      const sob = suma(fs, 'sobrantes');
      const perd = suma(fs, 'perdidos');
      return h('details', { class: 'plegable' },
        h('summary', {}, `${titulo(fs[0])} · `, sob ? `${plural(sob, 'roll')} sin vender · ${perd ? `perdido ${pesos(suma(fs, 'costo'))}` : 'sin pérdida'}` : 'no sobró nada'),
        h('table', { class: 'tabla' },
          h('tr', {}, h('th', {}, 'Sabor'), h('th', { class: 'num-der' }, 'Hechos'), h('th', { class: 'num-der' }, 'Vendidos'),
            h('th', { class: 'num-der' }, 'Sobraron'), h('th', { class: 'num-der' }, 'Perdido')),
          fs.sort((a, b) => orden(a) - orden(b)).map((f) => h('tr', {}, h('td', {}, f.nombre),
            h('td', { class: 'num-der' }, f.producidos),
            h('td', { class: 'num-der' }, f.usados),
            h('td', { class: 'num-der' }, Number(f.sobrantes) ? h('strong', {}, f.sobrantes) : '—'),
            h('td', { class: 'num-der' }, Number(f.costo) ? `${f.perdidos} · ${pesos(f.costo)}` : '—')))));
    }),
    h('p', { class: 'ayuda' }, `Perdido desde septiembre: ${pesos(total)} (${plural(suma(filas, 'perdidos'), 'roll')}).`),
  ];
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
