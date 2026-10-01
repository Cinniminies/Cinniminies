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
const AYUDA_INGRESO = {
  aporte_socios: 'Plata que ponen ustedes en el negocio. Entra a la caja, pero no cuenta como ganancia.',
  otro: 'Plata que entra por algo que no es una venta (las ventas se cargan en + Venta). Cuenta como ingreso del negocio.',
};

// Gastos (sale plata) e ingresos (entra plata) comparten pantalla; cada uno va a su tabla.
// '#/gastos/ingreso' abre directo en "Entra plata".
export async function mostrar(cont, { id } = {}) {
  const [gastos, ingresos] = await Promise.all([
    q(sb.from('gastos').select('*').order('fecha', { ascending: false }).order('creado_en', { ascending: false }).limit(30)),
    q(sb.from('ingresos').select('*').order('fecha', { ascending: false }).order('creado_en', { ascending: false }).limit(30)),
  ]);
  const historial = [
    ...gastos.map((g) => ({ ...g, tabla: 'gastos' })),
    ...ingresos.map((i) => ({ ...i, tabla: 'ingresos' })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creado_en.localeCompare(a.creado_en)).slice(0, 30);

  let entra = id === 'ingreso';
  const f = { fecha: hoyISO(), tipo: null, descripcion: '', monto: '', rolls: '', notas: '' };
  const ayuda = h('p', { class: 'ayuda' });
  const campoRolls = campo('Rolls', h('input', { type: 'number', inputmode: 'numeric', min: 0, oninput: (e) => { f.rolls = e.target.value; } }));
  campoRolls.hidden = true;
  const contTipo = h('div');
  function dibujarTipos() {
    f.tipo = null;
    ayuda.textContent = '';
    campoRolls.hidden = true;
    vaciar(contTipo, grupo('Tipo', chips(opciones(entra ? ETIQUETAS.ingreso : ETIQUETAS.gasto), null, (t) => {
      f.tipo = t;
      ayuda.textContent = (entra ? AYUDA_INGRESO : AYUDA)[t] || '';
      campoRolls.hidden = entra || !['merma', 'tanda_descartada'].includes(t);
    })));
  }
  dibujarTipos();

  const guardar = h('button', { class: 'btn primario bloque', type: 'button' }, 'Guardar');
  guardar.onclick = () => conBoton(guardar, async () => {
    if (!f.tipo) throw new Error('Elegí el tipo');
    if (!f.descripcion.trim()) throw new Error('Poné una descripción');
    if (!(Number(f.monto) > 0)) throw new Error('Poné el monto');
    const tabla = entra ? 'ingresos' : 'gastos';
    const aca = entra ? '#/gastos/ingreso' : '#/gastos';
    const fila = { fecha: f.fecha, tipo: f.tipo, descripcion: f.descripcion.trim(), monto: Number(f.monto), notas: f.notas.trim() || null };
    if (!entra) fila.rolls = f.rolls === '' || campoRolls.hidden ? null : Number(f.rolls);
    const r = await q(sb.from(tabla).insert(fila).select('id').single());
    const etiqueta = entra ? (f.tipo === 'otro' ? 'Ingreso' : ETIQUETAS.ingreso[f.tipo]) : ETIQUETAS.gasto[f.tipo];
    toast(`${etiqueta} guardado: ${pesos(f.monto)}`, {
      accion: {
        texto: 'Deshacer',
        fn: async () => { await q(sb.from(tabla).delete().eq('id', r.id)); toast('Deshecho'); refrescarSi(aca); },
      },
    });
    irA(aca);
  });

  vaciar(cont,
    h('div', { class: 'card' },
      h('div', { class: 'sentido' }, chips([{ valor: 'sale', texto: 'Sale plata' }, { valor: 'entra', texto: 'Entra plata' }],
        entra ? 'entra' : 'sale', (v) => {
          entra = v === 'entra';
          dibujarTipos();
        })),
      campoFecha(f.fecha, (v) => { f.fecha = v; }),
      contTipo,
      ayuda,
      campo('Descripción', h('input', { oninput: (e) => { f.descripcion = e.target.value; } })),
      campo('Monto', h('input', { type: 'number', inputmode: 'decimal', min: 0, step: '0.01', oninput: (e) => { f.monto = e.target.value; } })),
      campoRolls,
      campo('Notas', h('input', { oninput: (e) => { f.notas = e.target.value; } })),
      guardar),

    h('h2', {}, 'Últimos movimientos'),
    historial.length
      ? h('ul', { class: 'lista' }, historial.map((g) => {
        const esIngreso = g.tabla === 'ingresos';
        const borrar = h('button', { class: 'btn chico peligro' }, 'Borrar');
        borrar.onclick = () => conBoton(borrar, async () => {
          if (!confirm(`¿Borrar "${g.descripcion}" del ${fechaCorta(g.fecha)}?`)) return;
          await q(sb.from(g.tabla).delete().eq('id', g.id));
          toast('Borrado');
          irA(entra ? '#/gastos/ingreso' : '#/gastos');
        });
        const tipo = esIngreso ? ETIQUETAS.ingreso[g.tipo] : ETIQUETAS.gasto[g.tipo];
        return h('li', {}, h('div', { class: 'fila' },
          h('div', { class: 'princ' },
            h('div', { class: 't1' }, g.descripcion),
            h('div', { class: 't2' }, `${fechaCorta(g.fecha)} · ${tipo}${g.notas ? ' · ' + g.notas : ''}`)),
          h('span', { class: 'monto' + (esIngreso ? ' entra' : '') }, esIngreso ? `+ ${pesos(g.monto)}` : pesos(g.monto)),
          borrar));
      }))
      : h('p', { class: 'vacio' }, 'Todavía no hay gastos ni ingresos.'));
}
