import { sb, q, rpc } from '../db.js';
import { h, vaciar, pesos, cantidad, numero, fechaLarga, fechaCorta, hoyISO, toast, conBoton } from '../util.js';
import { subnavProduccion } from '../componentes.js';

// 5.7 Stock teórico (último conteo + compras − tandas − cajas usadas), alertas y conteos.
export async function mostrar(cont, { id }) {
  return id === 'conteo' ? conteo(cont) : resumen(cont);
}

async function resumen(cont) {
  const stock = await q(sb.from('v_stock').select('*').order('nombre'));
  const total = (tipo) => stock.filter((s) => s.tipo === tipo).reduce((a, s) => a + Number(s.valor), 0);
  const tabla = (tipo, titulo) => [
    h('div', { class: 'seccion-cab' }, h('h2', {}, titulo), h('span', { class: 'ayuda' }, pesos(total(tipo)))),
    h('table', { class: 'tabla card' },
      h('tr', {}, h('th', {}, 'Insumo'), h('th', { class: 'num-der' }, 'Hay'), h('th', { class: 'num-der' }, 'Mínimo'), h('th', { class: 'num-der' }, 'Valor')),
      stock.filter((s) => s.tipo === tipo).map((s) => h('tr', {},
        h('td', {}, h('a', { href: `#/insumos/${s.insumo_id}` }, s.nombre),
          h('span', { class: 'sub' }, s.fecha_conteo ? `contado el ${fechaCorta(s.fecha_conteo)}` : 'nunca contado')),
        h('td', { class: 'num-der' }, s.reponer ? h('span', { class: 'badge alerta' }, cantidad(s.teorico, s.unidad_base)) : cantidad(s.teorico, s.unidad_base)),
        h('td', { class: 'num-der' }, cantidad(s.stock_minimo, s.unidad_base)),
        h('td', { class: 'num-der' }, pesos(s.valor))))),
  ];
  const alertas = stock.filter((s) => s.reponer).length;

  vaciar(cont,
    subnavProduccion('stock'),
    h('p', { class: 'ayuda' }, 'Stock teórico: el último conteo, más lo comprado, menos lo que usaron las tandas y las cajas vendidas después.'),
    alertas ? h('p', {}, h('span', { class: 'badge alerta' }, `${alertas} para reponer`)) : null,
    h('div', { class: 'acciones' }, h('a', { class: 'btn primario', href: '#/stock/conteo' }, 'Cargar conteo')),
    tabla('ingrediente', 'Ingredientes'),
    tabla('packaging', 'Packaging'));
}

async function conteo(cont) {
  const stock = await q(sb.from('v_stock').select('insumo_id,nombre,tipo,unidad_base,teorico').order('tipo').order('nombre'));
  const contado = {};

  const filas = stock.map((s) => {
    const desvio = h('span', { class: 'sub' });
    const input = h('input', {
      type: 'number', inputmode: 'decimal', min: 0, step: 'any', placeholder: numero(s.teorico),
      oninput: (e) => {
        if (e.target.value === '') { delete contado[s.insumo_id]; desvio.textContent = ''; return; }
        contado[s.insumo_id] = Number(e.target.value);
        const d = Number(s.teorico) - contado[s.insumo_id];
        desvio.textContent = d === 0 ? 'coincide' : d > 0 ? `faltan ${cantidad(d, s.unidad_base)}` : `sobran ${cantidad(-d, s.unidad_base)}`;
        desvio.className = 'sub ' + (d > 0 ? 'desvio-pos' : d < 0 ? 'desvio-neg' : '');
      },
    });
    return h('tr', {},
      h('td', {}, s.nombre, h('span', { class: 'sub' }, `teórico ${cantidad(s.teorico, s.unidad_base)}`)),
      h('td', { style: 'width:9rem' }, h('div', { class: 'receta-fila', style: 'grid-template-columns:1fr;margin:0' },
        h('div', { class: 'unidad' }, input, h('small', {}, s.unidad_base))), desvio));
  });

  const guardar = h('button', { class: 'btn primario', type: 'button' }, 'Guardar conteo');
  guardar.onclick = () => conBoton(guardar, async () => {
    const items = Object.entries(contado).map(([insumo_id, c]) => ({ insumo_id, cantidad: c }));
    if (!items.length) throw new Error('Cargá al menos una cantidad');
    const r = await rpc('registrar_conteo', { p: { items } });
    const unidad = Object.fromEntries(stock.map((s) => [s.insumo_id, s.unidad_base]));
    vaciar(cont, h('div', { class: 'card' },
      h('h1', { style: 'margin-top:0' }, 'Conteo guardado'),
      h('p', { class: 'ayuda' }, `${r.length} insumos, ${fechaLarga(hoyISO())}. Desde ahora el stock teórico arranca de estas cantidades.`),
      h('table', { class: 'tabla' },
        h('tr', {}, h('th', {}, 'Insumo'), h('th', { class: 'num-der' }, 'Teórico'), h('th', { class: 'num-der' }, 'Contado'), h('th', { class: 'num-der' }, 'Desvío')),
        r.map((x) => h('tr', {}, h('td', {}, x.insumo),
          h('td', { class: 'num-der' }, cantidad(x.teorico, unidad[x.insumo_id])),
          h('td', { class: 'num-der' }, cantidad(x.contado, unidad[x.insumo_id])),
          h('td', { class: 'num-der ' + (x.desvio > 0 ? 'desvio-pos' : x.desvio < 0 ? 'desvio-neg' : '') },
            Number(x.desvio) === 0 ? '—' : cantidad(x.desvio, unidad[x.insumo_id]))))),
      h('p', { class: 'ayuda' }, 'Desvío = teórico − contado. Positivo: hay menos de lo que debería (se usó más, se tiró o faltó cargar algo).'),
      h('div', { class: 'acciones' }, h('a', { class: 'btn', href: '#/stock' }, 'Volver al stock'))));
    toast('Conteo guardado');
  });

  vaciar(cont, h('div', { class: 'con-guardar' },
    h('p', { class: 'ayuda' }, 'Cargá solo lo que contaste; lo que dejes vacío no cambia. El número gris es lo que debería haber.'),
    h('table', { class: 'tabla card' }, filas),
    h('p', { class: 'pie' }, h('a', { href: '#/stock' }, 'Cancelar'))),
  h('div', { class: 'guardar' }, guardar));
}

