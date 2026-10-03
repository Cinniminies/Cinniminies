import { sb, q, rpc } from '../db.js';
import { h, vaciar, pesos, cantidad, numero, fechaLarga, fechaCorta, hoyISO, toast, conBoton } from '../util.js';
import { subnavProduccion } from '../componentes.js';
import { irA } from '../app.js';

// 5.7 Stock teórico (último conteo + compras − tandas − cajas usadas), alertas y conteos.
// "Hay" se carga en la misma tabla, al lado del teórico; cada conteo guarda su desvío (ver Desvíos).
export async function mostrar(cont, { id }) {
  return id === 'desvios' ? desvios(cont) : resumen(cont, id === 'conteo');
}

const pct = (x) => `${Number(x) > 0 ? '+' : ''}${numero(Number(x) * 100, 0)} %`;
const claseDesvio = (d) => (d > 0 ? 'desvio-pos' : d < 0 ? 'desvio-neg' : '');

async function resumen(cont, enfocar) {
  const stock = await q(sb.from('v_stock').select('*').order('nombre'));
  const total = (tipo) => stock.filter((s) => s.tipo === tipo).reduce((a, s) => a + Number(s.valor), 0);
  const contado = {};

  const fila = (s) => {
    const desvio = h('span', { class: 'sub' });
    const input = h('input', {
      type: 'number', inputmode: 'decimal', min: 0, step: 'any', 'aria-label': `Hay de ${s.nombre} (${s.unidad_base})`,
      oninput: (e) => {
        if (e.target.value === '' || Number.isNaN(Number(e.target.value))) {
          delete contado[s.insumo_id]; desvio.textContent = ''; return;
        }
        contado[s.insumo_id] = Number(e.target.value);
        const d = Number(s.teorico) - contado[s.insumo_id];
        desvio.textContent = d === 0 ? 'coincide' : d > 0 ? `faltan ${cantidad(d, s.unidad_base)}` : `sobran ${cantidad(-d, s.unidad_base)}`;
        desvio.className = 'sub ' + claseDesvio(d);
      },
    });
    const teorico = cantidad(s.teorico, s.unidad_base);
    return h('tr', {},
      h('td', {}, h('a', { href: `#/insumos/${s.insumo_id}` }, s.nombre),
        h('span', { class: 'sub' }, [
          s.fecha_conteo ? `contado ${fechaCorta(s.fecha_conteo)}: ${cantidad(s.conteo, s.unidad_base)}` : 'nunca contado',
          `mín. ${cantidad(s.stock_minimo, s.unidad_base)}`,
        ].join(' · '))),
      h('td', { style: 'width:7rem;padding-left:.6rem' },
        h('div', { class: 'receta-fila', style: 'grid-template-columns:1fr;margin:0' },
          h('div', { class: 'unidad' }, input, h('small', {}, s.unidad_base))), desvio),
      h('td', { class: 'num-der' }, s.reponer ? h('span', { class: 'badge alerta' }, teorico) : teorico));
  };

  const tabla = (tipo, titulo) => [
    h('div', { class: 'seccion-cab' }, h('h2', {}, titulo), h('span', { class: 'ayuda' }, pesos(total(tipo)))),
    h('table', { class: 'tabla card' },
      h('tr', {}, h('th', {}, 'Insumo'), h('th', { style: 'padding-left:.6rem' }, 'Hay'), h('th', { class: 'num-der' }, 'Teórico')),
      stock.filter((s) => s.tipo === tipo).map(fila)),
  ];
  const alertas = stock.filter((s) => s.reponer).length;

  const guardar = h('button', { class: 'btn primario', type: 'button' }, 'Guardar lo que hay');
  guardar.onclick = () => conBoton(guardar, async () => {
    const items = Object.entries(contado).map(([insumo_id, c]) => ({ insumo_id, cantidad: c }));
    if (!items.length) throw new Error('Cargá al menos una cantidad en "Hay"');
    const r = await rpc('registrar_conteo', { p: { items } });
    toast('Conteo guardado');
    resultado(cont, r, Object.fromEntries(stock.map((s) => [s.insumo_id, s.unidad_base])));
  });

  vaciar(cont, h('div', { class: 'con-guardar' },
    subnavProduccion('stock'),
    h('p', { class: 'ayuda' }, 'Teórico: el último conteo, más lo comprado, menos lo que usaron las tandas y las cajas vendidas después. ',
      'En "Hay" cargá lo que quedó (solo lo que contaste; lo vacío no cambia).'),
    alertas ? h('p', {}, h('span', { class: 'badge alerta' }, `${alertas} para reponer`)) : null,
    h('div', { class: 'acciones' }, h('a', { class: 'btn', href: '#/stock/desvios' }, 'Ver desvíos')),
    tabla('ingrediente', 'Ingredientes'),
    tabla('packaging', 'Packaging')),
  h('div', { class: 'guardar' }, guardar));
  if (enfocar) cont.querySelector('input')?.focus();
}

function resultado(cont, r, unidad) {
  vaciar(cont, h('div', { class: 'card' },
    h('h1', { style: 'margin-top:0' }, 'Conteo guardado'),
    h('p', { class: 'ayuda' }, `${r.length} insumos, ${fechaLarga(hoyISO())}. Desde ahora el stock teórico arranca de estas cantidades.`),
    h('table', { class: 'tabla' },
      h('tr', {}, h('th', {}, 'Insumo'), h('th', { class: 'num-der' }, 'Teórico'), h('th', { class: 'num-der' }, 'Hay'), h('th', { class: 'num-der' }, 'Desvío')),
      r.map((x) => h('tr', {}, h('td', {}, x.insumo),
        h('td', { class: 'num-der' }, cantidad(x.teorico, unidad[x.insumo_id])),
        h('td', { class: 'num-der' }, cantidad(x.contado, unidad[x.insumo_id])),
        h('td', { class: 'num-der ' + claseDesvio(x.desvio) },
          Number(x.desvio) === 0 ? '—' : cantidad(x.desvio, unidad[x.insumo_id]))))),
    h('p', { class: 'ayuda' }, 'Desvío = teórico − hay. Positivo: hay menos de lo que debería (se usó más, se tiró o faltó cargar algo).'),
    h('div', { class: 'acciones' }, h('a', { class: 'btn', href: '#/stock' }, 'Volver al stock'),
      h('a', { class: 'btn', href: '#/stock/desvios' }, 'Ver desvíos'))));
}

// Desvíos: promedio por insumo (desde el último ajuste de recetas) e historial de conteos.
async function desvios(cont) {
  const [porInsumo, historial, recetas] = await Promise.all([
    q(sb.from('v_desvio_insumo').select('*').order('nombre')),
    q(sb.from('v_desvios').select('*').order('fecha', { ascending: false }).order('creado_en', { ascending: false }).limit(60)),
    q(sb.from('recetas').select('insumo_id,cantidad,sabores(nombre,activo)').gt('cantidad', 0)),
  ]);
  const valorTotal = porInsumo.reduce((a, d) => a + Number(d.valor), 0);

  const tarjeta = (d) => {
    const rel = d.desvio_relativo == null ? null : Number(d.desvio_relativo);
    const deEste = recetas.filter((r) => r.insumo_id === d.insumo_id && r.sabores?.activo);
    const factor = rel == null ? null : 1 + rel;
    const ajustar = h('button', { class: 'btn chico', type: 'button' }, `Ajustar recetas ${pct(rel)}`);
    ajustar.onclick = () => conBoton(ajustar, async () => {
      if (!confirm(`¿Cambiar ${d.nombre} en ${deEste.length} receta(s) un ${pct(rel)}? El promedio de desvíos de ${d.nombre} arranca de nuevo.`)) return;
      await rpc('ajustar_recetas_insumo', { p_insumo: d.insumo_id, p_factor: factor });
      toast(`Recetas con ${d.nombre} ajustadas`);
      irA('#/stock/desvios');
    });
    const sugerir = d.tipo === 'ingrediente' && rel != null && Math.abs(rel) >= 0.02 && deEste.length && factor > 0;
    const sugerencia = sugerir
      ? h('div', { class: 'ayuda', style: 'margin-top:.35rem' },
        'Receta por tanda: ', deEste.map((r) => `${r.sabores.nombre} ${cantidad(r.cantidad, d.unidad_base)} → ${cantidad(Math.round(r.cantidad * factor * 100) / 100, d.unidad_base)}`).join(' · '),
        Number(d.conteos) < 3 ? ' (con menos de 3 conteos el promedio es poco confiable)' : '', ' ', ajustar)
      : null;
    return h('li', {}, h('div', { class: 'fila' },
      h('div', { class: 'princ' },
        h('div', { class: 't1' }, d.nombre),
        h('div', { class: 't2' }, [
          `${numero(d.conteos, 0)} ${Number(d.conteos) === 1 ? 'conteo' : 'conteos'}`,
          `se usaron ${cantidad(d.usado, d.unidad_base)}`,
          Number(d.desvio) === 0 ? 'sin desvío' : Number(d.desvio) > 0 ? `faltaron ${cantidad(d.desvio, d.unidad_base)}` : `sobraron ${cantidad(-d.desvio, d.unidad_base)}`,
        ].join(' · ')),
        sugerencia),
      h('div', { class: 'num-der' },
        h('div', { class: claseDesvio(Number(d.desvio)) }, rel == null ? '—' : pct(rel)),
        h('div', { class: 'sub ayuda' }, pesos(d.valor)))));
  };

  vaciar(cont,
    subnavProduccion('stock'),
    h('p', { class: 'ayuda' },
      'Cada vez que cargás lo que hay, se compara con el teórico. El % es el desvío sobre lo que se usó según las recetas y las cajas: ',
      '+10 % quiere decir que por cada 1 kg que dicen las recetas se fueron 1,1 kg (o algo no se cargó). Negativo: sobró.'),
    porInsumo.length ? [
      h('div', { class: 'seccion-cab' }, h('h2', {}, 'Promedio por insumo'),
        h('span', { class: 'ayuda' }, `${valorTotal >= 0 ? 'faltante' : 'sobrante'} ${pesos(Math.abs(valorTotal))}`)),
      ['ingrediente', 'packaging'].map((tipo) => {
        const lista = porInsumo.filter((d) => d.tipo === tipo);
        return lista.length ? [h('h3', {}, tipo === 'ingrediente' ? 'Ingredientes' : 'Packaging'),
          h('ul', { class: 'lista card' }, lista.map(tarjeta))] : null;
      }),
    ] : h('p', { class: 'vacio' }, 'Todavía no hay desvíos: hacen falta dos conteos de un insumo.'),

    historial.length ? [
      h('h2', {}, 'Conteos'),
      h('table', { class: 'tabla card' },
        h('tr', {}, h('th', {}, 'Insumo'), h('th', { class: 'num-der' }, 'Teórico'), h('th', { class: 'num-der' }, 'Hay'), h('th', { class: 'num-der' }, 'Desvío')),
        historial.map((x) => h('tr', {},
          h('td', {}, x.nombre, h('span', { class: 'sub' }, fechaCorta(x.fecha))),
          h('td', { class: 'num-der' }, cantidad(x.teorico, x.unidad_base)),
          h('td', { class: 'num-der' }, cantidad(x.contado, x.unidad_base)),
          h('td', { class: 'num-der ' + claseDesvio(Number(x.desvio)) },
            Number(x.desvio) === 0 ? '—' : cantidad(x.desvio, x.unidad_base),
            x.desvio_relativo != null && Number(x.desvio) !== 0 ? h('span', { class: 'sub' }, pct(x.desvio_relativo)) : null)))),
    ] : null);
}
