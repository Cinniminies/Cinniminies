import { sb, q } from '../db.js';
import { h, vaciar, chips, campo, campoFecha, grupo, hoyISO, fechaCorta, pesos, toast, conBoton, ETIQUETAS, opciones, campoPesos } from '../util.js';
import { irA, refrescarSi } from '../app.js';
import { libroCaja } from '../componentes.js';
import { textoPanel } from '../textos.js';

// La ayuda de cada tipo, debajo de los chips (se lee al elegirlo, ya con los textos del panel cargados).
const AYUDA = {
  merma: () => textoPanel('panel.gastos.ayuda_merma',
    'Rolls quemados, muestras regaladas… Si se perdió un ingrediente (bolsa rota), '
    + 'cargalo en Producción → Stock → Registrar pérdida.'),
  tanda_descartada: () => textoPanel('panel.gastos.ayuda_tanda_descartada',
    'Una tanda que salió mal. Cargá también la tanda en Tandas para que descuente los insumos.'),
  gasto_operativo: () => textoPanel('panel.gastos.ayuda_gasto_operativo', 'Bolsas, transporte, cosas chicas del negocio.'),
  mejora: () => textoPanel('panel.gastos.ayuda_mejora',
    'Cosas para trabajar mejor: un palote de amasar, moldes, la balanza… Cuenta como gasto del mes.'),
  comision: () => textoPanel('panel.gastos.ayuda_comision', 'Comisiones del banco o por ventas.'),
  retiro_socios: () => textoPanel('panel.gastos.ayuda_retiro_socios',
    'Plata que sacan ustedes (salidas, comida…). No cuenta como gasto del negocio, pero sale de la caja.'),
  ajuste_caja: () => textoPanel('panel.gastos.ayuda_ajuste_caja',
    'Para que la caja teórica coincida con la real. No cuenta como gasto.'),
};
const AYUDA_INGRESO = {
  aporte_socios: () => textoPanel('panel.gastos.ayuda_aporte_socios',
    'Plata que ponen ustedes en el negocio. Entra a la caja, pero no cuenta como ganancia.'),
  otro: () => textoPanel('panel.gastos.ayuda_otro_ingreso',
    'Plata que entra por algo que no es una venta (las ventas se cargan en + Venta). Cuenta como ingreso del negocio.'),
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
      ayuda.textContent = (entra ? AYUDA_INGRESO : AYUDA)[t]?.() || '';
      campoRolls.hidden = entra || !['merma', 'tanda_descartada'].includes(t);
    })));
  }
  dibujarTipos();

  const guardar = h('button', { class: 'btn primario bloque', type: 'button' }, 'Guardar');
  guardar.onclick = () => conBoton(guardar, async () => {
    if (!f.tipo) throw new Error(textoPanel('panel.gastos.falta_tipo', 'Elegí el tipo'));
    if (!f.descripcion.trim()) throw new Error(textoPanel('panel.falta_descripcion', 'Poné una descripción'));
    if (!(Number(f.monto) > 0)) throw new Error(textoPanel('panel.gastos.falta_monto', 'Poné el monto'));
    const tabla = entra ? 'ingresos' : 'gastos';
    const aca = entra ? '#/gastos/ingreso' : '#/gastos';
    const fila = { fecha: f.fecha, tipo: f.tipo, descripcion: f.descripcion.trim(), monto: Number(f.monto), notas: f.notas.trim() || null };
    if (!entra) fila.rolls = f.rolls === '' || campoRolls.hidden ? null : Number(f.rolls);
    const r = await q(sb.from(tabla).insert(fila).select('id').single());
    const etiqueta = entra ? (f.tipo === 'otro' ? 'Ingreso' : ETIQUETAS.ingreso[f.tipo]) : ETIQUETAS.gasto[f.tipo];
    toast(textoPanel('panel.gastos.guardado', '{tipo} guardado: {monto}', { tipo: etiqueta, monto: pesos(f.monto) }), {
      accion: {
        texto: 'Deshacer',
        fn: async () => {
          await q(sb.from(tabla).delete().eq('id', r.id));
          toast(textoPanel('panel.gastos.deshecho', 'Deshecho'));
          refrescarSi(aca);
        },
      },
    });
    irA(aca);
  });

  vaciar(cont, h('div', { class: 'dos-col' },
    h('div', { class: 'col-fija' },
      h('h2', { class: 'solo-lateral' }, textoPanel('panel.cargar_movimiento', 'Cargar un movimiento')),
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
      campo('Monto', campoPesos({ oninput: (e) => { f.monto = e.target.value; } })),
      campoRolls,
      campo('Notas', h('input', { oninput: (e) => { f.notas = e.target.value; } })),
      guardar)),

    h('div', {},
    h('h2', {}, textoPanel('panel.gastos.ultimos', 'Últimos movimientos')),
    libroCaja(historial.map((g) => {
      const esIngreso = g.tabla === 'ingresos';
      const borrar = h('button', { class: 'btn chico peligro', 'aria-label': `Borrar ${g.descripcion}` }, 'Borrar');
      borrar.onclick = () => conBoton(borrar, async () => {
        const pregunta = textoPanel('panel.gastos.borrar_confirmar', '¿Borrar "{descripcion}" del {fecha}?',
          { descripcion: g.descripcion, fecha: fechaCorta(g.fecha) });
        if (!confirm(pregunta)) return;
        await q(sb.from(g.tabla).delete().eq('id', g.id));
        toast(textoPanel('panel.gastos.borrado', 'Borrado'));
        irA(entra ? '#/gastos/ingreso' : '#/gastos');
      });
      const tipo = esIngreso ? ETIQUETAS.ingreso[g.tipo] : ETIQUETAS.gasto[g.tipo];
      return {
        fecha: g.fecha,
        titulo: g.descripcion,
        detalle: `${tipo}${g.notas ? ' · ' + g.notas : ''}`,
        monto: g.monto,
        entra: esIngreso,
        accion: borrar,
      };
    }), textoPanel('panel.gastos.vacio', 'Todavía no hay gastos ni ingresos.'), { cortada: historial.length >= 30 }))));
}
