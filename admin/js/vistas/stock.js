import { sb, q, rpc } from '../db.js';
import {
  h, vaciar, chips, interruptor, plural, pesos, cantidad, numero, fechaLarga, fechaCorta, hoyISO, toast, conBoton,
  campo, campoFecha, sumar,
} from '../util.js';
import { subnavProduccion, stat, filaLista, monto, pastilla, chipsUnidad } from '../componentes.js';
import { catalogo } from '../catalogo.js';
import { irA, refrescarSi } from '../app.js';
import { textoPanel } from '../textos.js';
import {
  filas as filasDesvio, resumen as resumenDesvios, ordenar, escala, porConteo, REVISAR,
  estadoAjuste, propuesta, cambios, MINIMO_AJUSTE,
} from '../desvios.js';

// 5.7 Stock teórico (último conteo + compras − tandas − cajas usadas − pérdidas), alertas y conteos.
// Tres columnas: "Registro" para cargar lo contado, "Hay" (el último conteo + lo comprado − lo perdido después,
// que se cargan medidos) y "Debería haber" (el teórico).
// Cada conteo guarda su desvío (ver Desvíos) y el último se puede deshacer.
export async function mostrar(cont, { id }) {
  if (id === 'perdida') return perdida(cont);
  return id === 'desvios' ? desvios(cont) : resumen(cont, id === 'conteo');
}

const pct = (x) => `${Number(x) > 0 ? '+' : Number(x) < 0 ? '−' : ''}${numero(Math.abs(Number(x)) * 100, 0)} %`;
const claseDesvio = (d) => (d > 0 ? 'desvio-pos' : d < 0 ? 'desvio-neg' : '');
// Las tres columnas de un conteo comparado: lo que debería haber, lo que había y la diferencia (con su %).
const celdasDesvio = (x) => [
  h('td', { class: 'num-der' }, cantidad(x.teorico, x.unidad_base)),
  h('td', { class: 'num-der' }, cantidad(x.contado, x.unidad_base)),
  h('td', { class: 'num-der ' + claseDesvio(Number(x.desvio)) }, Number(x.desvio) === 0 ? '—' : cantidad(x.desvio, x.unidad_base),
    x.desvio_relativo != null && Number(x.desvio) !== 0 ? h('span', { class: 'sub' }, pct(x.desvio_relativo)) : null),
];

async function resumen(cont, enfocar) {
  const [stock, [ultimo]] = await Promise.all([
    q(sb.from('v_stock').select('*').order('nombre')),
    q(sb.from('conteos').select('fecha,creado_en').order('creado_en', { ascending: false }).limit(1)),
  ]);
  const total = (tipo) => sumar(stock.filter((s) => s.tipo === tipo), (s) => s.valor);
  const contado = {};

  const fila = (s) => {
    const desvio = h('span', { class: 'sub' });
    const input = h('input', {
      type: 'number', inputmode: 'decimal', min: 0, step: 'any', 'aria-label': `Registro de ${s.nombre} (${s.unidad_base})`,
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
    // Lo que no se puede medir (el papel manteca) no se cuenta: su "Hay" baja solo con las cajas y las tandas.
    const registro = s.se_descuenta_solo
      ? h('span', { class: 'sub' }, textoPanel('panel.stock_solo', 'se descuenta solo'))
      : [h('div', { class: 'receta-fila', style: 'grid-template-columns:1fr;margin:0' },
        h('div', { class: 'unidad' }, input, h('small', {}, s.unidad_base))), desvio];
    return h('tr', {},
      h('td', {}, h('a', { href: `#/insumos/${s.insumo_id}` }, s.nombre),
        h('span', { class: 'sub' }, [
          `mín. ${cantidad(s.stock_minimo, s.unidad_base)}`,
          s.se_descuenta_solo ? null : s.fecha_conteo ? `contado ${fechaCorta(s.fecha_conteo)}` : 'nunca contado',
        ].filter(Boolean).join(' · '))),
      h('td', { class: 'registro' }, registro),
      h('td', { class: 'num-der' }, cantidad(s.hay, s.unidad_base)),
      h('td', { class: 'num-der' }, s.reponer ? pastilla('alerta', teorico) : teorico));
  };

  const tabla = (tipo, titulo) => [
    h('div', { class: 'seccion-cab' }, h('h2', {}, titulo), h('span', { class: 'ayuda' }, pesos(total(tipo)))),
    h('table', { class: 'tabla card tabla-stock' },
      h('tr', {}, h('th', {}, 'Insumo'), h('th', { class: 'registro' }, 'Registro'), h('th', { class: 'num-der' }, 'Hay'),
        h('th', { class: 'num-der' }, 'Debería haber')),
      stock.filter((s) => s.tipo === tipo).map(fila)),
  ];
  const alertas = stock.filter((s) => s.reponer).length;

  const guardar = h('button', { class: 'btn primario', type: 'button' }, 'Guardar lo contado');
  guardar.onclick = () => conBoton(guardar, async () => {
    const items = Object.entries(contado).map(([insumo_id, c]) => ({ insumo_id, cantidad: c }));
    if (!items.length) throw new Error(textoPanel('panel.stock.falta_cantidad', 'Cargá al menos una cantidad en "Registro"'));
    const r = await rpc('registrar_conteo', { p: { items } });
    toast(textoPanel('panel.stock.conteo_guardado', 'Conteo guardado'));
    resultado(cont, r, Object.fromEntries(stock.map((s) => [s.insumo_id, s.unidad_base])));
  });

  vaciar(cont, h('div', { class: 'con-guardar' },
    subnavProduccion('stock'),
    alertas ? h('p', { style: 'margin-top:0' }, pastilla('alerta',
      textoPanel('panel.stock.reponer', '{cantidad} para reponer', { cantidad: alertas }))) : null,
    h('div', { class: 'acciones' }, h('a', { class: 'btn', href: '#/stock/desvios' }, 'Ver desvíos'),
      h('a', { class: 'btn', href: '#/stock/perdida' }, 'Registrar pérdida'),
      // Deshacer es de vez en cuando y borra un conteo: queda más callado que las otras dos
      ultimo ? botonDeshacer(ultimo, undefined, 'btn chico peligro') : null),
    // La explicación de las columnas, plegada: la tabla es lo que se viene a ver
    h('details', { class: 'plegable', style: 'margin-top:.75rem' },
      h('summary', {}, textoPanel('panel.stock_columnas', '¿Qué es cada columna?')),
      h('p', { class: 'ayuda', style: 'margin-top:0' }, textoPanel('panel.stock.columnas_ayuda',
        'En "Registro" cargá lo que contaste (lo vacío no cambia). '
        + '"Hay" es lo del último conteo más lo que compraste y menos lo que se perdió después; '
        + '"Debería haber" parte del último conteo, suma lo comprado y resta lo que usaron las tandas, las cajas vendidas '
        + 'y las pérdidas después. Lo que no se puede medir, como el papel manteca, no se cuenta: '
        + 'su "Hay" es lo que debería haber.'))),
    tabla('ingrediente', 'Ingredientes'),
    tabla('packaging', 'Packaging')),
  h('div', { class: 'guardar' }, guardar));
  if (enfocar) cont.querySelector('input')?.focus();
}

// Deshace el último conteo guardado (todos los insumos de esa vez) y vuelve al stock.
function botonDeshacer(ultimo, texto = `Deshacer el conteo del ${fechaCorta(ultimo.fecha)}`, clase = 'btn') {
  const b = h('button', { class: clase, type: 'button' }, texto);
  b.onclick = () => conBoton(b, async () => {
    if (!confirm(textoPanel('panel.stock.deshacer_confirmar', '¿Deshacer el conteo del {fecha}? Se borran todas las cantidades '
      + 'que cargaste esa vez y el stock vuelve a calcularse desde el conteo anterior.',
      { fecha: fechaCorta(ultimo.fecha) }))) return;
    const r = await rpc('deshacer_ultimo_conteo');
    toast(textoPanel('panel.stock.conteo_deshecho', 'Conteo deshecho ({insumos})', { insumos: plural(r.insumos, 'insumo') }));
    irA('#/stock');
  });
  return b;
}

function resultado(cont, r, unidad) {
  vaciar(cont, h('div', { class: 'card' },
    h('h1', {}, textoPanel('panel.stock.conteo_guardado', 'Conteo guardado')),
    h('p', { class: 'ayuda' }, textoPanel('panel.stock.conteo_ayuda',
      '{cantidad} insumos, {fecha}. Desde ahora el stock teórico arranca de estas cantidades.',
      { cantidad: r.length, fecha: fechaLarga(hoyISO()) })),
    h('table', { class: 'tabla' },
      h('tr', {}, h('th', {}, 'Insumo'), h('th', { class: 'num-der' }, 'Debería haber'), h('th', { class: 'num-der' }, 'Hay'), h('th', { class: 'num-der' }, 'Desvío')),
      r.map((x) => h('tr', {}, h('td', {}, x.insumo),
        h('td', { class: 'num-der' }, cantidad(x.teorico, unidad[x.insumo_id])),
        h('td', { class: 'num-der' }, cantidad(x.contado, unidad[x.insumo_id])),
        h('td', { class: 'num-der ' + claseDesvio(x.desvio) },
          Number(x.desvio) === 0 ? '—' : cantidad(x.desvio, unidad[x.insumo_id]))))),
    h('p', { class: 'ayuda' }, textoPanel('panel.stock.desvio_ayuda',
      'Desvío = debería haber − hay. Positivo: hay menos de lo que debería (se usó más, se tiró o faltó cargar algo).')),
    h('div', { class: 'acciones' }, h('a', { class: 'btn', href: '#/stock' }, 'Volver al stock'),
      h('a', { class: 'btn', href: '#/stock/desvios' }, 'Ver desvíos'),
      botonDeshacer({ fecha: hoyISO() }, 'Deshacer este conteo'))));
}

// Pérdida de un insumo (se rompió una bolsa, se venció algo): sale del stock teórico. Lo que valía se muestra,
// pero no se suma a gastos: la plata ya se contó al cargar la compra.
const UNIDADES_PERDIDA = { g: ['kg', 'g'], ml: ['L', 'ml'], un: ['un'], paq: ['paq'], cm: ['m', 'cm'] };
const FACTOR_PERDIDA = { g: 1, kg: 1000, ml: 1, L: 1000, un: 1, paq: 1, cm: 1, m: 100 };

async function perdida(cont) {
  const [cat, costos, ultimas] = await Promise.all([
    catalogo(),
    q(sb.from('v_costo_insumo').select('insumo_id,costo_unitario')),
    q(sb.from('perdidas').select('id,fecha,cantidad,costo,motivo,insumos(nombre,unidad_base)')
      .order('fecha', { ascending: false }).order('creado_en', { ascending: false }).limit(20)),
  ]);
  const costoDe = Object.fromEntries(costos.map((c) => [c.insumo_id, Number(c.costo_unitario) || 0]));
  const f = { fecha: hoyISO(), insumo: '', cantidad: '', unidad: null, motivo: '' };
  const insumo = () => (f.insumo ? cat.insumo(f.insumo) : null);
  const base = () => Number(f.cantidad) * (FACTOR_PERDIDA[f.unidad] || 1);

  const unidadesCont = h('div');
  const vistaPrevia = h('p', { class: 'ayuda' });
  function previa() {
    const i = insumo();
    if (!i || !(Number(f.cantidad) > 0)) { vaciar(vistaPrevia); return; }
    vaciar(vistaPrevia, `= ${cantidad(base(), i.unidad_base)} · valía ${pesos(base() * (costoDe[i.id] || 0))}`);
  }
  function dibujarUnidades() {
    const i = insumo();
    const lista = i ? UNIDADES_PERDIDA[i.unidad_base] || [i.unidad_base] : [];
    if (!lista.includes(f.unidad)) f.unidad = lista[0] || null;
    vaciar(unidadesCont, chipsUnidad(lista, f.unidad, (u) => { f.unidad = u; previa(); }));
  }

  const activos = (tipo) => cat.insumos.filter((i) => i.tipo === tipo && i.activo).map((i) => h('option', { value: i.id }, i.nombre));
  const selInsumo = h('select', { onchange: (e) => { f.insumo = e.target.value; dibujarUnidades(); previa(); } },
    h('option', { value: '' }, 'Elegí qué se perdió…'),
    h('optgroup', { label: 'Ingredientes' }, activos('ingrediente')),
    h('optgroup', { label: 'Packaging' }, activos('packaging')));

  const guardar = h('button', { class: 'btn primario bloque', type: 'button' }, 'Guardar pérdida');
  guardar.onclick = () => conBoton(guardar, async () => {
    const i = insumo();
    if (!i) throw new Error(textoPanel('panel.stock.falta_perdida', 'Elegí qué se perdió'));
    if (!(Number(f.cantidad) > 0)) throw new Error(textoPanel('panel.stock.falta_cuanto', 'Poné cuánto se perdió'));
    const r = await q(sb.from('perdidas').insert({
      fecha: f.fecha, insumo_id: i.id, cantidad: base(), motivo: f.motivo.trim() || null,
    }).select('id,costo').single());
    toast(textoPanel('panel.stock.perdida_guardada', 'Pérdida guardada: {cantidad} de {insumo} ({monto})',
      { cantidad: cantidad(base(), i.unidad_base), insumo: i.nombre.toLowerCase(), monto: pesos(r.costo) }), {
      accion: {
        texto: 'Deshacer',
        fn: async () => {
          await q(sb.from('perdidas').delete().eq('id', r.id));
          toast(textoPanel('panel.stock.perdida_deshecha', 'Pérdida deshecha'));
          refrescarSi('#/stock/perdida');
        },
      },
    });
    irA('#/stock/perdida');
  });

  vaciar(cont,
    subnavProduccion('stock'),
    h('div', { class: 'card' },
      h('p', { class: 'ayuda' }, textoPanel('panel.stock.perdida_ayuda', 'Se rompió una bolsa, se venció algo… '
        + 'Lo que cargues sale del stock teórico. Lo que valía queda anotado, pero no se suma a gastos: '
        + 'esa plata ya se contó al cargar la compra.')),
      campoFecha(f.fecha, (v) => { f.fecha = v; }),
      campo('Qué', selInsumo),
      h('div', { class: 'fila-campos' },
        campo('Cantidad', h('input', { type: 'number', inputmode: 'decimal', min: 0, step: 'any',
          oninput: (e) => { f.cantidad = e.target.value; previa(); } }))),
      unidadesCont,
      vistaPrevia,
      campo('Motivo', h('input', { placeholder: 'Se rompió la bolsa', oninput: (e) => { f.motivo = e.target.value; } })),
      guardar),

    h('h2', {}, textoPanel('panel.stock.ultimas_perdidas', 'Últimas pérdidas')),
    ultimas.length
      ? h('ul', { class: 'lista' }, ultimas.map((p) => {
        const borrar = h('button', { class: 'btn chico peligro' }, 'Borrar');
        borrar.onclick = () => conBoton(borrar, async () => {
          const pregunta = textoPanel('panel.stock.perdida_borrar_confirmar',
            '¿Borrar la pérdida de {insumo} del {fecha}? Vuelve al stock.',
            { insumo: p.insumos.nombre, fecha: fechaCorta(p.fecha) });
          if (!confirm(pregunta)) return;
          await q(sb.from('perdidas').delete().eq('id', p.id));
          toast(textoPanel('panel.stock.perdida_borrada', 'Borrada'));
          irA('#/stock/perdida');
        });
        return filaLista({
          titulo: `${p.insumos.nombre} · ${cantidad(p.cantidad, p.insumos.unidad_base)}`,
          detalle: [fechaCorta(p.fecha), p.motivo],
          derecha: [monto(pesos(p.costo)), borrar],
        });
      }))
      : h('p', { class: 'vacio' }, textoPanel('panel.stock.perdidas_vacio', 'Todavía no hay pérdidas cargadas.')),
    h('div', { class: 'acciones' }, h('a', { class: 'btn', href: '#/stock' }, 'Volver al stock')));
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
      h('p', { class: 'vacio' }, textoPanel('panel.stock.desvios_vacio',
        'Todavía no hay desvíos: hacen falta dos conteos de un mismo insumo (en Stock, columna "Registro").')));
    return;
  }

  const r = resumenDesvios(todas);
  const etiquetaConteo = (c) => (c.hora ? `${fechaCorta(c.fecha)} ${c.hora}` : fechaCorta(c.fecha));
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
        h('figcaption', { class: 'graf-titulo' }, textoPanel('panel.stock.desvios_grafico', 'Lo que se usó contra lo previsto')),
        h('div', { class: 'div-ejes', 'aria-hidden': 'true' }, h('span'),
          h('span', { class: 'div-pista' }, h('span', { class: 'div-mitad izq' }, '← sobró'), h('span', { class: 'div-mitad der' }, 'de más →')),
          h('span')),
        lista.map(filaGrafico),
        h('p', { class: 'graf-ayuda' }, textoPanel('panel.stock.desvios_grafico_ayuda',
          'Tocá un insumo para ver el detalle. Las barras claras tienen un solo conteo: tomalas con pinzas.')),
        tablaComparar(lista))
        : h('p', { class: 'vacio' }, textoPanel('panel.stock.desvios_tipo_vacio', 'No hay desvíos de este tipo todavía.')));
  }

  // Detalle de un insumo: según recetas vs real, cada conteo y, para ingredientes, cómo quedarían las recetas.
  function detalle(f) {
    const deEste = recetas.filter((x) => x.insumo_id === f.insumo_id && x.sabores?.activo);
    const factor = f.rel == null ? null : 1 + f.rel;
    const suyos = historial.filter((x) => x.insumo_id === f.insumo_id);
    const ajustar = h('button', { class: 'btn chico', type: 'button' }, `Ajustar recetas ${pct(f.rel)}`);
    ajustar.onclick = () => conBoton(ajustar, async () => {
      const pregunta = textoPanel('panel.stock.ajustar_confirmar',
        '¿Cambiar {insumo} en {recetas} receta(s) un {porcentaje}? El promedio de {insumo} arranca de nuevo.',
        { insumo: f.nombre, recetas: deEste.length, porcentaje: pct(f.rel) });
      if (!confirm(pregunta)) return;
      await rpc('ajustar_recetas_insumo', { p_insumo: f.insumo_id, p_factor: factor });
      toast(textoPanel('panel.stock.ajustadas', 'Recetas con {insumo} ajustadas', { insumo: f.nombre }));
      verDesvios.abierto = null;
      irA('#/stock/desvios');
    });
    const sugerir = f.tipo === 'ingrediente' && f.rel != null && Math.abs(f.rel) >= 0.02 && deEste.length && factor > 0;
    return h('div', { class: 'div-detalle' },
      h('div', { class: 'stats' },
        stat('Previsto', cantidad(f.segunRecetas, f.unidad), f.tipo === 'ingrediente' ? 'según las recetas de las tandas' : 'según las cajas vendidas'),
        stat('Real', cantidad(f.real, f.unidad), f.desvio === 0 ? 'igual a las recetas'
          : `${f.desvio > 0 ? 'se usaron' : 'sobraron'} ${cantidad(Math.abs(f.desvio), f.unidad)} (${pesos(Math.abs(f.valor))})`)),
      h('table', { class: 'tabla' },
        h('tr', {}, h('th', {}, 'Conteo'), h('th', { class: 'num-der' }, 'Debería'), h('th', { class: 'num-der' }, 'Había'), h('th', { class: 'num-der' }, 'Diferencia')),
        suyos.map((x) => h('tr', {},
          h('td', {}, etiquetaConteo(conteos.find((c) => c.filas.includes(x)) || x)),
          celdasDesvio(x)))),
      sugerir ? [
        h('h3', { style: 'margin-top:.75rem' }, textoPanel('panel.stock.si_ajustas', 'Si ajustás las recetas')),
        h('table', { class: 'tabla' },
          h('tr', {}, h('th', {}, 'Sabor (por tanda)'), h('th', { class: 'num-der' }, 'Hoy'), h('th', { class: 'num-der' }, 'Quedaría')),
          deEste.map((x) => h('tr', {}, h('td', {}, x.sabores.nombre),
            h('td', { class: 'num-der' }, cantidad(x.cantidad, f.unidad)),
            h('td', { class: 'num-der' }, h('strong', {}, cantidad(Math.round(x.cantidad * factor * 100) / 100, f.unidad)))))),
        f.confiable ? null : h('p', { class: 'ayuda' },
          textoPanel('panel.stock.un_conteo', 'Con un solo conteo el % puede ser casualidad: mejor esperar otro conteo.')),
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
    const conPorcentaje = (fs) => fs.map((f) => `${f.nombre} ${pct(f.rel)}`).join(', ');

    const aplicar = h('button', { class: 'btn primario', type: 'button', disabled: !lista.length },
      lista.length ? `Aplicar recetas propuestas (${plural(lista.length, 'cambio')})` : 'Elegí al menos un ingrediente');
    aplicar.onclick = () => conBoton(aplicar, async () => {
      const pregunta = textoPanel('panel.stock.propuestas_confirmar', '¿Cambiar {cantidades} en las recetas? '
        + 'El costo de las tandas nuevas sale de las recetas nuevas, '
        + 'y el promedio de desvíos de esos ingredientes arranca de nuevo.',
        { cantidades: plural(lista.length, 'cantidad', 'cantidades') });
      if (!confirm(pregunta)) return;
      await rpc('aplicar_recetas_propuestas', { p: { items: lista } });
      toast(textoPanel('panel.stock.recetas_actualizadas', 'Recetas actualizadas'));
      verDesvios.abierto = null;
      irA('#/stock/desvios');
    });

    vaciar(contPropuesta,
      h('h2', {}, textoPanel('panel.stock.propuestas', 'Recetas propuestas')),
      h('p', { class: 'ayuda' }, textoPanel('panel.stock.propuestas_ayuda',
        'Cuánto se usa de verdad por tanda: la receta más el desvío de cada ingrediente '
        + '(lo que se usa de más o de menos se reparte en proporción entre los sabores que lo llevan). '
        + 'Se propone ajustar los que tienen 2 conteos o más y se desvían ±{minimo} % o más, redondeado.',
        { minimo: Math.round(MINIMO_AJUSTE * 100) })),
      ajustables.length ? h('div', { class: 'card' },
        h('h3', {}, textoPanel('panel.stock.que_ajustar', 'Qué ingredientes ajustar')),
        ajustables.map((f) => interruptor(`${f.nombre} ${pct(f.rel)}`, elegidos.has(f.insumo_id), (si) => {
          if (si) elegidos.add(f.insumo_id); else elegidos.delete(f.insumo_id);
          dibujarPropuesta();
        }, `${f.conteos} conteos · ${f.rel > 0 ? 'se usa más' : 'se usa menos'} de lo que dice la receta`)),
        pocos.length ? h('p', { class: 'ayuda' },
          textoPanel('panel.stock.esperar_conteo', 'Esperar otro conteo: {insumos}.', { insumos: conPorcentaje(pocos) })) : null,
        chicos.length ? h('p', { class: 'ayuda' },
          textoPanel('panel.stock.sin_cambios', 'Sin cambios (menos de ±{minimo} %): {insumos}.',
            { minimo: Math.round(MINIMO_AJUSTE * 100), insumos: conPorcentaje(chicos) })) : null)
        : h('p', { class: 'vacio' },
          textoPanel('panel.stock.propuestas_vacio', 'Todavía ningún ingrediente tiene datos suficientes para proponer un cambio.')),
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
            textoPanel('panel.stock.costo_tanda', 'Costo de ingredientes por tanda: {costo}.',
              { costo: `${pesos(sab.costoAntes)}${Math.abs(dif) < 0.005 ? '' : ` → ${pesos(sab.costoDespues)}`}` })));
      }),
      ajustables.length ? h('div', { class: 'acciones' }, aplicar) : null);
  }

  // Un conteo puntual: todo lo que se contó ese día, ordenado por impacto.
  function dibujarConteo() {
    if (!conteos.length) { vaciar(contConteo); return; }
    if (!conteos.some((c) => c.clave === verDesvios.conteo)) verDesvios.conteo = conteos[0].clave;
    const c = conteos.find((x) => x.clave === verDesvios.conteo);
    const total = sumar(c.filas, (x) => x.valor);
    vaciar(contConteo,
      h('h2', {}, textoPanel('panel.stock.cada_conteo', 'Cada conteo')),
      chips(conteos.slice(0, 8).map((x) => ({ valor: x.clave, texto: etiquetaConteo(x) })), verDesvios.conteo,
        (v) => { verDesvios.conteo = v; dibujarConteo(); }),
      h('table', { class: 'tabla card', style: 'margin-top:.6rem' },
        h('tr', {}, h('th', {}, 'Insumo'), h('th', { class: 'num-der' }, 'Debería'), h('th', { class: 'num-der' }, 'Había'), h('th', { class: 'num-der' }, 'Diferencia')),
        c.filas.map((x) => h('tr', {},
          h('td', {}, x.nombre, h('span', { class: 'sub' }, pesos(x.valor))),
          celdasDesvio(x)))),
      h('p', { class: 'ayuda' }, textoPanel('panel.stock.conteo_total', 'Ese día, en total: {resultado} mercadería por {monto}.',
        { resultado: total >= 0 ? 'faltó' : 'sobró', monto: pesos(Math.abs(total)) })));
  }

  vaciar(cont,
    subnavProduccion('stock'),
    h('p', { class: 'ayuda' }, textoPanel('panel.stock.desvios_ayuda', 'Compara lo que dicen las recetas y las cajas con lo que '
      + 'se usó de verdad según los conteos, desde el último ajuste de recetas de cada insumo.')),
    h('div', { class: 'stats' },
      stat('Se usó de más', pesos(r.deMas), 'faltó en los conteos'),
      stat('Sobró', pesos(r.sobro), 'había más de lo debido'),
      stat('Para revisar', String(r.revisar), `pasan ±${Math.round(REVISAR * 100)} % (2+ conteos)`),
      stat('Conteos', String(conteos.length), conteos.length ? `último: ${fechaCorta(conteos[0].fecha)}` : '—')),
    contGrafico,
    contPropuesta,
    contConteo);
  dibujarGrafico();
  dibujarPropuesta();
  dibujarConteo();
}
