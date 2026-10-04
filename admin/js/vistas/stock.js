import { sb, q, rpc } from '../db.js';
import { h, vaciar, chips, interruptor, plural, pesos, cantidad, numero, fechaLarga, fechaCorta, hoyISO, toast, conBoton } from '../util.js';
import { subnavProduccion } from '../componentes.js';
import { irA } from '../app.js';
import {
  filas as filasDesvio, resumen as resumenDesvios, ordenar, escala, porConteo, REVISAR,
  estadoAjuste, propuesta, cambios, MINIMO_AJUSTE,
} from '../desvios.js';

// 5.7 Stock teórico (último conteo + compras − tandas − cajas usadas), alertas y conteos.
// "Hay" se carga en la misma tabla, al lado del teórico; cada conteo guarda su desvío (ver Desvíos).
export async function mostrar(cont, { id }) {
  return id === 'desvios' ? desvios(cont) : resumen(cont, id === 'conteo');
}

const pct = (x) => `${Number(x) > 0 ? '+' : Number(x) < 0 ? '−' : ''}${numero(Math.abs(Number(x)) * 100, 0)} %`;
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

// Desvíos: por insumo, lo que dicen las recetas contra lo que se usó de verdad (desde el último ajuste
// de recetas), en un gráfico divergente para comparar de un vistazo, y cada conteo por separado.
// Estado de la pantalla (sobrevive si se sale y se vuelve).
const verDesvios = { tipo: 'ingrediente', orden: 'plata', abierto: null, conteo: null };

async function desvios(cont) {
  const [porInsumo, historial, recetas, costos] = await Promise.all([
    q(sb.from('v_desvio_insumo').select('*').order('nombre')),
    q(sb.from('v_desvios').select('*').order('fecha', { ascending: false }).order('creado_en', { ascending: false }).limit(500)),
    q(sb.from('recetas').select('sabor_id,insumo_id,cantidad,sabores(nombre,activo,rolls_por_tanda),insumos(nombre,unidad_base,tipo)').gt('cantidad', 0)),
    q(sb.from('v_costo_insumo').select('insumo_id,costo_unitario')),
  ]);
  const todas = filasDesvio(porInsumo);
  const conteos = porConteo(historial);
  if (!todas.length) {
    vaciar(cont, subnavProduccion('stock'),
      h('p', { class: 'vacio' }, 'Todavía no hay desvíos: hacen falta dos conteos de un mismo insumo (en Stock, columna "Hay").'));
    return;
  }

  const r = resumenDesvios(todas);
  const etiquetaConteo = (c) => (c.hora ? `${fechaCorta(c.fecha)} ${c.hora}` : fechaCorta(c.fecha));
  const kpi = (etiqueta, valor, sub) => h('div', { class: 'stat' },
    h('div', { class: 'etq' }, etiqueta), h('div', { class: 'num' }, valor), h('div', { class: 'sub' }, sub));
  const contGrafico = h('div');
  const contConteo = h('div');
  const contPropuesta = h('div');
  const elegidos = new Set(todas.filter((f) => f.tipo === 'ingrediente' && estadoAjuste(f) === 'ajustar').map((f) => f.insumo_id));
  const recetasSabor = recetas.filter((x) => x.sabores?.activo && x.insumos?.tipo === 'ingrediente').map((x) => ({
    sabor_id: x.sabor_id, sabor: x.sabores.nombre, rolls: x.sabores.rolls_por_tanda,
    insumo_id: x.insumo_id, nombre: x.insumos.nombre, unidad: x.insumos.unidad_base, cantidad: x.cantidad,
  }));
  const costoDe = Object.fromEntries(costos.map((c) => [c.insumo_id, c.costo_unitario]));

  function dibujarGrafico() {
    const lista = ordenar(todas.filter((f) => f.tipo === verDesvios.tipo), verDesvios.orden);
    const max = escala(lista);
    const filaGrafico = (f) => {
      const ancho = f.rel == null ? 0 : Math.min(1, Math.abs(f.rel) / max) * 100;
      const abierto = verDesvios.abierto === f.insumo_id;
      const boton = h('button', {
        type: 'button', class: 'div-fila' + (f.confiable ? '' : ' poco') + (abierto ? ' abierto' : ''), 'aria-expanded': String(abierto),
        'aria-label': `${f.nombre}: ${f.rel == null ? 'sin %' : pct(f.rel)}, ${pesos(f.valor)}${f.confiable ? '' : ', un solo conteo'}`,
        onclick: () => { verDesvios.abierto = abierto ? null : f.insumo_id; dibujarGrafico(); },
      },
      h('span', { class: 'div-nombre' }, f.nombre, f.confiable ? null : h('small', {}, '1 conteo')),
      h('span', { class: 'div-pista' },
        h('span', { class: 'div-mitad izq' }, f.rel < 0 ? h('span', { class: 'div-barra sobro', style: `width:${ancho}%` }) : null),
        h('span', { class: 'div-mitad der' }, f.rel > 0 ? h('span', { class: 'div-barra demas', style: `width:${ancho}%` }) : null)),
      h('span', { class: 'div-valor' }, h('strong', {}, f.rel == null ? '—' : pct(f.rel)), h('small', {}, pesos(f.valor))));
      return [boton, abierto ? detalle(f) : null];
    };
    vaciar(contGrafico,
      h('div', { class: 'acciones-fila' },
        chips([{ valor: 'ingrediente', texto: 'Ingredientes' }, { valor: 'packaging', texto: 'Packaging' }], verDesvios.tipo,
          (v) => { verDesvios.tipo = v; verDesvios.abierto = null; dibujarGrafico(); }),
        chips([{ valor: 'plata', texto: 'Por $' }, { valor: 'pct', texto: 'Por %' }], verDesvios.orden,
          (v) => { verDesvios.orden = v; dibujarGrafico(); })),
      lista.length ? h('figure', { class: 'grafico div-grafico' },
        h('figcaption', { class: 'graf-titulo' }, 'Lo que se usó contra lo previsto'),
        h('div', { class: 'div-ejes', 'aria-hidden': 'true' }, h('span'),
          h('span', { class: 'div-pista' }, h('span', { class: 'div-mitad izq' }, '← sobró'), h('span', { class: 'div-mitad der' }, 'de más →')),
          h('span')),
        lista.map(filaGrafico),
        h('p', { class: 'graf-ayuda' }, 'Tocá un insumo para ver el detalle. Las barras claras tienen un solo conteo: tomalas con pinzas.'),
        tablaComparar(lista))
        : h('p', { class: 'vacio' }, 'No hay desvíos de este tipo todavía.'));
  }

  // Detalle de un insumo: según recetas vs real, cada conteo y, para ingredientes, cómo quedarían las recetas.
  function detalle(f) {
    const deEste = recetas.filter((x) => x.insumo_id === f.insumo_id && x.sabores?.activo);
    const factor = f.rel == null ? null : 1 + f.rel;
    const suyos = historial.filter((x) => x.insumo_id === f.insumo_id);
    const ajustar = h('button', { class: 'btn chico', type: 'button' }, `Ajustar recetas ${pct(f.rel)}`);
    ajustar.onclick = () => conBoton(ajustar, async () => {
      if (!confirm(`¿Cambiar ${f.nombre} en ${deEste.length} receta(s) un ${pct(f.rel)}? El promedio de ${f.nombre} arranca de nuevo.`)) return;
      await rpc('ajustar_recetas_insumo', { p_insumo: f.insumo_id, p_factor: factor });
      toast(`Recetas con ${f.nombre} ajustadas`);
      verDesvios.abierto = null;
      irA('#/stock/desvios');
    });
    const sugerir = f.tipo === 'ingrediente' && f.rel != null && Math.abs(f.rel) >= 0.02 && deEste.length && factor > 0;
    return h('div', { class: 'div-detalle' },
      h('div', { class: 'stats' },
        kpi('Previsto', cantidad(f.segunRecetas, f.unidad), f.tipo === 'ingrediente' ? 'según las recetas de las tandas' : 'según las cajas vendidas'),
        kpi('Real', cantidad(f.real, f.unidad), f.desvio === 0 ? 'igual a las recetas'
          : `${f.desvio > 0 ? 'se usaron' : 'sobraron'} ${cantidad(Math.abs(f.desvio), f.unidad)} (${pesos(Math.abs(f.valor))})`)),
      h('table', { class: 'tabla' },
        h('tr', {}, h('th', {}, 'Conteo'), h('th', { class: 'num-der' }, 'Debería'), h('th', { class: 'num-der' }, 'Había'), h('th', { class: 'num-der' }, 'Diferencia')),
        suyos.map((x) => h('tr', {},
          h('td', {}, etiquetaConteo(conteos.find((c) => c.filas.includes(x)) || x)),
          h('td', { class: 'num-der' }, cantidad(x.teorico, x.unidad_base)),
          h('td', { class: 'num-der' }, cantidad(x.contado, x.unidad_base)),
          h('td', { class: 'num-der ' + claseDesvio(Number(x.desvio)) }, Number(x.desvio) === 0 ? '—' : cantidad(x.desvio, x.unidad_base),
            x.desvio_relativo != null && Number(x.desvio) !== 0 ? h('span', { class: 'sub' }, pct(x.desvio_relativo)) : null)))),
      sugerir ? [
        h('h3', { style: 'margin-top:.75rem' }, 'Si ajustás las recetas'),
        h('table', { class: 'tabla' },
          h('tr', {}, h('th', {}, 'Sabor (por tanda)'), h('th', { class: 'num-der' }, 'Hoy'), h('th', { class: 'num-der' }, 'Quedaría')),
          deEste.map((x) => h('tr', {}, h('td', {}, x.sabores.nombre),
            h('td', { class: 'num-der' }, cantidad(x.cantidad, f.unidad)),
            h('td', { class: 'num-der' }, h('strong', {}, cantidad(Math.round(x.cantidad * factor * 100) / 100, f.unidad)))))),
        f.confiable ? null : h('p', { class: 'ayuda' }, 'Con un solo conteo el % puede ser casualidad: mejor esperar otro conteo.'),
        h('div', { class: 'acciones' }, ajustar),
      ] : null);
  }

  // La misma información en tabla, para comparar números exactos.
  const tablaComparar = (lista) => h('details', { class: 'graf-tabla' }, h('summary', {}, 'Ver la tabla'),
    h('table', { class: 'tabla' },
      h('tr', {}, h('th', {}, 'Insumo'), h('th', { class: 'num-der' }, 'Previsto'), h('th', { class: 'num-der' }, 'Real'),
        h('th', { class: 'num-der' }, 'Dif.'), h('th', { class: 'num-der' }, '$')),
      lista.map((f) => h('tr', {},
        h('td', {}, f.nombre, h('span', { class: 'sub' }, `${f.conteos} ${f.conteos === 1 ? 'conteo' : 'conteos'}`)),
        h('td', { class: 'num-der' }, cantidad(f.segunRecetas, f.unidad)),
        h('td', { class: 'num-der' }, cantidad(f.real, f.unidad)),
        h('td', { class: 'num-der ' + claseDesvio(f.desvio) }, f.rel == null ? '—' : pct(f.rel)),
        h('td', { class: 'num-der' }, pesos(f.valor))))));

  // Recetas propuestas: el uso real promedio por tanda de cada ingrediente y la receta redondeada que sale
  // de ahí, sabor por sabor, con el costo antes y después. Se eligen qué ingredientes ajustar.
  function dibujarPropuesta() {
    const ingredientes = ordenar(todas.filter((f) => f.tipo === 'ingrediente'), 'pct');
    const ajustables = ingredientes.filter((f) => estadoAjuste(f) === 'ajustar');
    const pocos = ingredientes.filter((f) => estadoAjuste(f) === 'pocos');
    const chicos = ingredientes.filter((f) => estadoAjuste(f) === 'chico');
    const sabores = propuesta(recetasSabor, todas, elegidos, costoDe);
    const lista = cambios(sabores);
    const signo = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${pesos(Math.abs(n))}`;

    const aplicar = h('button', { class: 'btn primario', type: 'button', disabled: !lista.length },
      lista.length ? `Aplicar recetas propuestas (${plural(lista.length, 'cambio')})` : 'Elegí al menos un ingrediente');
    aplicar.onclick = () => conBoton(aplicar, async () => {
      if (!confirm(`¿Cambiar ${plural(lista.length, 'cantidad', 'cantidades')} en las recetas? `
        + 'El costo de las tandas nuevas sale de las recetas nuevas, y el promedio de desvíos de esos ingredientes arranca de nuevo.')) return;
      await rpc('aplicar_recetas_propuestas', { p: { items: lista } });
      toast('Recetas actualizadas');
      verDesvios.abierto = null;
      irA('#/stock/desvios');
    });

    vaciar(contPropuesta,
      h('h2', {}, 'Recetas propuestas'),
      h('p', { class: 'ayuda' }, 'Cuánto se usa de verdad por tanda: la receta más el desvío de cada ingrediente '
        + '(lo que se usa de más o de menos se reparte en proporción entre los sabores que lo llevan). '
        + `Se propone ajustar los que tienen 2 conteos o más y se desvían ±${Math.round(MINIMO_AJUSTE * 100)} % o más, redondeado.`),
      ajustables.length ? h('div', { class: 'card' },
        h('h3', {}, 'Qué ingredientes ajustar'),
        ajustables.map((f) => interruptor(`${f.nombre} ${pct(f.rel)}`, elegidos.has(f.insumo_id), (si) => {
          if (si) elegidos.add(f.insumo_id); else elegidos.delete(f.insumo_id);
          dibujarPropuesta();
        }, `${f.conteos} conteos · ${f.rel > 0 ? 'se usa más' : 'se usa menos'} de lo que dice la receta`)),
        pocos.length ? h('p', { class: 'ayuda' }, `Esperar otro conteo: ${pocos.map((f) => `${f.nombre} ${pct(f.rel)}`).join(', ')}.`) : null,
        chicos.length ? h('p', { class: 'ayuda' }, `Sin cambios (menos de ±${Math.round(MINIMO_AJUSTE * 100)} %): ${chicos.map((f) => `${f.nombre} ${pct(f.rel)}`).join(', ')}.`) : null)
        : h('p', { class: 'vacio' }, 'Todavía ningún ingrediente tiene datos suficientes para proponer un cambio.'),
      sabores.map((sab) => {
        const dif = sab.costoDespues - sab.costoAntes;
        return h('div', { class: 'card' },
          h('div', { class: 'seccion-cab' }, h('h3', { style: 'margin:0' }, sab.sabor),
            h('span', { class: 'ayuda' }, Math.abs(dif) < 0.005 ? 'sin cambios'
              : `${signo(dif)} por tanda · ${signo(dif / (sab.rolls || 12))} por roll`)),
          h('table', { class: 'tabla' },
            h('tr', {}, h('th', {}, 'Ingrediente'), h('th', { class: 'num-der' }, 'Receta'), h('th', { class: 'num-der' }, 'Se usa'),
              h('th', { class: 'num-der' }, 'Propuesta')),
            sab.items.map((i) => {
              const cambia = i.propuesta !== i.receta;
              return h('tr', {},
                h('td', {}, i.nombre),
                h('td', { class: 'num-der' }, cantidad(i.receta, i.unidad)),
                h('td', { class: 'num-der' }, i.real == null ? '—' : cantidad(Math.round(i.real * 10) / 10, i.unidad)),
                h('td', { class: 'num-der ' + (cambia ? claseDesvio(i.propuesta - i.receta) : '') },
                  cambia ? h('strong', {}, cantidad(i.propuesta, i.unidad)) : 'igual'));
            })),
          h('p', { class: 'ayuda', style: 'margin:.4rem 0 0' },
            `Costo de ingredientes por tanda: ${pesos(sab.costoAntes)}${Math.abs(dif) < 0.005 ? '' : ` → ${pesos(sab.costoDespues)}`}.`));
      }),
      ajustables.length ? h('div', { class: 'acciones' }, aplicar) : null);
  }

  // Un conteo puntual: todo lo que se contó ese día, ordenado por impacto.
  function dibujarConteo() {
    if (!conteos.length) { vaciar(contConteo); return; }
    if (!conteos.some((c) => c.clave === verDesvios.conteo)) verDesvios.conteo = conteos[0].clave;
    const c = conteos.find((x) => x.clave === verDesvios.conteo);
    const total = c.filas.reduce((a, x) => a + Number(x.valor), 0);
    vaciar(contConteo,
      h('h2', {}, 'Cada conteo'),
      chips(conteos.slice(0, 8).map((x) => ({ valor: x.clave, texto: etiquetaConteo(x) })), verDesvios.conteo,
        (v) => { verDesvios.conteo = v; dibujarConteo(); }),
      h('table', { class: 'tabla card', style: 'margin-top:.6rem' },
        h('tr', {}, h('th', {}, 'Insumo'), h('th', { class: 'num-der' }, 'Debería'), h('th', { class: 'num-der' }, 'Había'), h('th', { class: 'num-der' }, 'Diferencia')),
        c.filas.map((x) => h('tr', {},
          h('td', {}, x.nombre, h('span', { class: 'sub' }, pesos(x.valor))),
          h('td', { class: 'num-der' }, cantidad(x.teorico, x.unidad_base)),
          h('td', { class: 'num-der' }, cantidad(x.contado, x.unidad_base)),
          h('td', { class: 'num-der ' + claseDesvio(Number(x.desvio)) }, Number(x.desvio) === 0 ? '—' : cantidad(x.desvio, x.unidad_base),
            x.desvio_relativo != null && Number(x.desvio) !== 0 ? h('span', { class: 'sub' }, pct(x.desvio_relativo)) : null)))),
      h('p', { class: 'ayuda' }, `Ese día, en total: ${total >= 0 ? 'faltó' : 'sobró'} mercadería por ${pesos(Math.abs(total))}.`));
  }

  vaciar(cont,
    subnavProduccion('stock'),
    h('p', { class: 'ayuda' }, 'Compara lo que dicen las recetas y las cajas con lo que se usó de verdad según los conteos, '
      + 'desde el último ajuste de recetas de cada insumo.'),
    h('div', { class: 'stats' },
      kpi('Se usó de más', pesos(r.deMas), 'faltó en los conteos'),
      kpi('Sobró', pesos(r.sobro), 'había más de lo debido'),
      kpi('Para revisar', String(r.revisar), `pasan ±${Math.round(REVISAR * 100)} % (2+ conteos)`),
      kpi('Conteos', String(conteos.length), conteos.length ? `último: ${fechaCorta(conteos[0].fecha)}` : '—')),
    contGrafico,
    contPropuesta,
    contConteo);
  dibujarGrafico();
  dibujarPropuesta();
  dibujarConteo();
}
