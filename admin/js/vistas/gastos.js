import { sb, q } from '../db.js';
import { h, vaciar, chips, campo, campoFecha, grupo, hoyISO, fechaCorta, pesos, toast, conBoton, ETIQUETAS, opciones } from '../util.js';
import { irA, refrescarSi } from '../app.js';

const AYUDA = {
  merma: 'Rolls quemados, muestras regaladas…',
  tanda_descartada: 'Una tanda que salió mal. Cargá también la tanda en Tandas para que descuente los insumos.',
  gasto_operativo: 'Bolsas, transporte, cosas chicas del negocio.',
  comision: 'Comisiones del banco o por ventas.',
  retiro_socios: 'Plata que sacan ustedes (salidas, comida…). No cuenta como gasto del negocio, pero sale de la caja.',
  ajuste_caja: 'Para que la caja teórica coincida con la real. No cuenta como gasto.',
  otro: '',
};

export async function mostrar(cont) {
  const historial = await q(sb.from('gastos').select('*')
    .order('fecha', { ascending: false }).order('creado_en', { ascending: false }).limit(30));
  const f = { fecha: hoyISO(), tipo: null, descripcion: '', monto: '', rolls: '', notas: '' };
  const ayuda = h('p', { class: 'ayuda' });
  const campoRolls = campo('Rolls', h('input', { type: 'number', inputmode: 'numeric', min: 0, oninput: (e) => { f.rolls = e.target.value; } }));
  campoRolls.hidden = true;

  const guardar = h('button', { class: 'btn primario bloque', type: 'button' }, 'Guardar');
  guardar.onclick = () => conBoton(guardar, async () => {
    if (!f.tipo) throw new Error('Elegí el tipo');
    if (!f.descripcion.trim()) throw new Error('Poné una descripción');
    if (!(Number(f.monto) > 0)) throw new Error('Poné el monto');
    const r = await q(sb.from('gastos').insert({
      fecha: f.fecha, tipo: f.tipo, descripcion: f.descripcion.trim(), monto: Number(f.monto),
      rolls: f.rolls === '' || campoRolls.hidden ? null : Number(f.rolls), notas: f.notas.trim() || null,
    }).select('id').single());
    toast(`${ETIQUETAS.gasto[f.tipo]} guardado: ${pesos(f.monto)}`, {
      accion: {
        texto: 'Deshacer',
        fn: async () => { await q(sb.from('gastos').delete().eq('id', r.id)); toast('Deshecho'); refrescarSi('#/gastos'); },
      },
    });
    irA('#/gastos');
  });

  vaciar(cont,
    h('div', { class: 'card' },
      campoFecha(f.fecha, (v) => { f.fecha = v; }),
      grupo('Tipo', chips(opciones(ETIQUETAS.gasto), null, (t) => {
        f.tipo = t;
        ayuda.textContent = AYUDA[t] || '';
        campoRolls.hidden = !['merma', 'tanda_descartada'].includes(t);
      })),
      ayuda,
      campo('Descripción', h('input', { oninput: (e) => { f.descripcion = e.target.value; } })),
      campo('Monto', h('input', { type: 'number', inputmode: 'decimal', min: 0, step: '0.01', oninput: (e) => { f.monto = e.target.value; } })),
      campoRolls,
      campo('Notas', h('input', { oninput: (e) => { f.notas = e.target.value; } })),
      guardar),

    h('h2', {}, 'Últimos gastos y retiros'),
    historial.length
      ? h('ul', { class: 'lista' }, historial.map((g) => {
        const borrar = h('button', { class: 'btn chico peligro' }, 'Borrar');
        borrar.onclick = () => conBoton(borrar, async () => {
          if (!confirm(`¿Borrar "${g.descripcion}" del ${fechaCorta(g.fecha)}?`)) return;
          await q(sb.from('gastos').delete().eq('id', g.id));
          toast('Borrado');
          irA('#/gastos');
        });
        return h('li', {}, h('div', { class: 'fila' },
          h('div', { class: 'princ' },
            h('div', { class: 't1' }, g.descripcion),
            h('div', { class: 't2' }, `${fechaCorta(g.fecha)} · ${ETIQUETAS.gasto[g.tipo]}${g.notas ? ' · ' + g.notas : ''}`)),
          h('span', { class: 'monto' }, pesos(g.monto)),
          borrar));
      }))
      : h('p', { class: 'vacio' }, 'Todavía no hay gastos.'));
}
