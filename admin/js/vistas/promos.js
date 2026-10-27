import { sb, q } from '../db.js';
import { h, vaciar, campo, chips, interruptor, pesos, numero, fechaCorta, hoyISO, precioVigenteDe, toast, conBoton } from '../util.js';
import { catalogo } from '../catalogo.js';
import { irA, sesion } from '../app.js';

// Promos (docs/descuentos-admin.md): un % o un monto por caja, entre dos fechas, para las cajas y sabores
// elegidos. La cuenta la hace la base (privado.promo_de_linea): la web y la venta nueva la descuentan solas.
// Caja mezclada: en proporción a los rolls de esos sabores. Dos promos en la misma caja o promo + código de
// recomendación: vale la que más descuenta.

const valorPromo = (p) => (p.tipo === 'porcentaje' ? `${numero(p.valor, 2).replace(/,00$/, '')} %` : `−${pesos(p.valor)}`);

function estado(p, hoy) {
  if (!p.activa) return ['Apagada', 'neutro'];
  if (p.hasta < hoy) return ['Terminada', 'neutro'];
  if (p.desde > hoy) return ['Programada', 'neutro'];
  return ['En curso', 'ok'];
}

const cuando = (p) => (p.desde === p.hasta ? `Solo el ${fechaCorta(p.desde)}` : `Del ${fechaCorta(p.desde)} al ${fechaCorta(p.hasta)}`);

// Como campo(), pero en un div: con botones adentro, un <label> marcaría el primero al tocar el título.
const grupoAyuda = (etiqueta, control, ayuda) => h('div', { class: 'campo' }, h('span', { class: 'etq-grupo' }, etiqueta), control,
  ayuda ? h('div', { class: 'ayuda' }, ayuda) : null);

// Chips de varias opciones: cada toque marca o desmarca.
function chipsVarios(lista, elegidos, alCambiar) {
  const cont = h('div', { class: 'chips', role: 'group' });
  for (const o of lista) {
    const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(elegidos.has(o.valor)) }, o.texto);
    b.onclick = () => {
      if (elegidos.has(o.valor)) elegidos.delete(o.valor); else elegidos.add(o.valor);
      b.setAttribute('aria-pressed', String(elegidos.has(o.valor)));
      alCambiar();
    };
    cont.append(b);
  }
  return cont;
}

// Cuánto queda cada Box con la promo (toda de los sabores de la promo).
function ejemplos(p, cajas) {
  return cajas
    .filter((c) => c.precio != null && (!p.formatos.length || p.formatos.includes(c.id)))
    .map((c) => {
      const desc = Math.min(c.precio, Math.round(p.tipo === 'porcentaje' ? c.precio * p.valor / 100 : p.valor));
      return { nombre: c.nombre, antes: c.precio, despues: c.precio - desc };
    });
}

export async function mostrar(cont) {
  const [cat, promos, precios] = await Promise.all([
    catalogo(),
    q(sb.from('promos').select('*').order('desde', { ascending: false }).order('nombre')),
    q(sb.from('precios').select('formato_id,precio,vigente_desde').is('sabor_id', null).not('formato_id', 'is', null)),
  ]);
  const hoy = hoyISO();
  const formatos = cat.formatosActivos.filter((f) => f.tipo !== 'unidad');
  const cajas = formatos.filter((f) => f.tipo === 'caja_fija')
    .map((f) => ({ ...f, precio: precioVigenteDe(precios.filter((x) => x.formato_id === f.id)) }));
  const nombreFormato = (id) => cat.formato(id)?.nombre || '¿?';
  const nombreSabor = (id) => cat.sabor(id)?.nombre || '¿?';

  function formulario(p) {
    const f = {
      nombre: p?.nombre || '', tipo: p?.tipo || 'porcentaje', valor: p?.valor ?? '', desde: p?.desde || hoy,
      hasta: p?.hasta || hoy, texto_web: p?.texto_web || '', activa: p?.activa ?? true,
    };
    const elegFormatos = new Set(p?.formatos || []);
    const elegSabores = new Set(p?.sabores || []);
    const vista = h('div', { class: 'promo-vista' });
    const dibujarVista = () => {
      const valor = Number(f.valor);
      if (!(valor > 0)) { vaciar(vista); return; }
      const borrador = { tipo: f.tipo, valor, formatos: [...elegFormatos] };
      const filas = ejemplos(borrador, cajas);
      vaciar(vista,
        filas.map((e) => h('div', { class: 'promo-ejemplo' }, h('span', {}, e.nombre),
          h('span', {}, h('s', {}, pesos(e.antes)), ' ', h('strong', {}, pesos(e.despues))))),
        elegSabores.size ? h('p', { class: 'ayuda' }, 'Si la caja es mezclada, descuenta solo la parte de esos sabores.') : null);
    };
    const entrada = (clave, attrs = {}) => h('input', {
      ...attrs, value: f[clave], oninput: (e) => { f[clave] = e.target.value; dibujarVista(); },
    });
    const guardar = h('button', { class: 'btn primario', type: 'button' }, p ? 'Guardar cambios' : 'Crear promo');
    guardar.onclick = () => conBoton(guardar, async () => {
      if (!f.nombre.trim()) throw new Error('Ponele un nombre');
      if (!(Number(f.valor) > 0)) throw new Error('El descuento tiene que ser mayor que cero');
      if (f.tipo === 'porcentaje' && Number(f.valor) > 90) throw new Error('El porcentaje va hasta 90 %');
      if (!f.desde || !f.hasta || f.hasta < f.desde) throw new Error('Revisá las fechas: "hasta" no puede ser antes de "desde"');
      const fila = {
        nombre: f.nombre.trim(), tipo: f.tipo, valor: Number(f.valor), desde: f.desde, hasta: f.hasta,
        formatos: [...elegFormatos], sabores: [...elegSabores], texto_web: f.texto_web.trim() || null, activa: f.activa,
      };
      await q(p ? sb.from('promos').update(fila).eq('id', p.id) : sb.from('promos').insert(fila));
      toast(p ? 'Promo actualizada' : 'Promo creada');
      irA('#/promos');
    });
    const cuanto = () => (f.tipo === 'porcentaje' ? 'Cuánto (%)' : 'Cuánto por caja ($)');
    const unidad = h('span', { class: 'etq' }, cuanto());
    dibujarVista();
    return h('div', { class: 'promo-form' },
      campo('Nombre', entrada('nombre', { maxlength: 60, placeholder: sesion.prueba ? 'PRUEBA Halloween' : 'Halloween' }),
        'Lo ve el cliente en el carrito y queda en la nota de la venta.'),
      grupoAyuda('Descuento', chips([{ valor: 'porcentaje', texto: 'Porcentaje' }, { valor: 'monto', texto: 'Monto fijo por caja' }],
        f.tipo, (v) => { f.tipo = v; unidad.textContent = cuanto(); dibujarVista(); })),
      h('label', { class: 'campo' }, unidad, entrada('valor', { type: 'number', inputmode: 'decimal', min: 0.01, step: 0.01 })),
      h('div', { class: 'fila-campos' },
        campo('Desde', entrada('desde', { type: 'date', min: '2024-01-01', max: '2099-12-31' })),
        campo('Hasta (inclusive)', entrada('hasta', { type: 'date', min: '2024-01-01', max: '2099-12-31' }))),
      grupoAyuda('Cajas', chipsVarios(formatos.map((x) => ({ valor: x.id, texto: x.nombre })), elegFormatos, dibujarVista),
        'Sin marcar ninguna: todas.'),
      grupoAyuda('Sabores', chipsVarios(cat.saboresActivos.map((x) => ({ valor: x.id, texto: x.nombre })), elegSabores, dibujarVista),
        'Sin marcar ninguno: todos.'),
      campo('Texto para la web (opcional)', entrada('texto_web', { maxlength: 140, placeholder: 'Ej: Solo este sábado: 6,66 % en todas las Box 🎃' }),
        'Sale en una cinta arriba de las cajas. Si lo dejás vacío, se arma con el nombre y el descuento.'),
      interruptor('Prendida', f.activa, (v) => { f.activa = v; }, 'Apagada no descuenta aunque esté en fecha.'),
      grupoAyuda('Así queda', vista),
      h('div', { class: 'acciones' }, guardar));
  }

  function tarjeta(p) {
    const [texto, clase] = estado(p, hoy);
    const prender = h('button', { class: 'btn', type: 'button' }, p.activa ? 'Apagar' : 'Prender');
    prender.onclick = () => conBoton(prender, async () => {
      await q(sb.from('promos').update({ activa: !p.activa }).eq('id', p.id));
      toast(p.activa ? 'Promo apagada' : 'Promo prendida');
      irA('#/promos');
    });
    const borrar = h('button', { class: 'btn peligro', type: 'button' }, 'Borrar');
    borrar.onclick = () => conBoton(borrar, async () => {
      if (!confirm(`¿Borrar la promo "${p.nombre}"? Las ventas y pedidos que ya la usaron no cambian.`)) return;
      await q(sb.from('promos').delete().eq('id', p.id));
      toast('Promo borrada');
      irA('#/promos');
    });
    const filas = ejemplos(p, cajas);
    return h('article', { class: `promo-tarjeta${clase === 'ok' ? ' en-curso' : ''}` },
      h('div', { class: 'promo-valor' }, h('strong', {}, valorPromo(p)), h('span', {}, p.tipo === 'porcentaje' ? 'de descuento' : 'por caja')),
      h('div', { class: 'promo-cuerpo' },
        h('div', { class: 'seccion-cab' }, h('h3', {}, p.nombre), h('span', { class: `badge ${clase}` }, texto)),
        h('p', { class: 'promo-cuando' }, cuando(p)),
        h('div', { class: 'promo-alcance' },
          ...(p.formatos.length ? p.formatos.map(nombreFormato) : ['Todas las cajas']).map((t) => h('span', { class: 'promo-tag' }, t)),
          ...(p.sabores.length ? p.sabores.map(nombreSabor) : ['Todos los sabores']).map((t) => h('span', { class: 'promo-tag sabor' }, t))),
        filas.length ? h('div', { class: 'promo-ejemplos' }, filas.map((e) => h('span', {},
          `${e.nombre}: `, h('s', {}, pesos(e.antes)), ' ', h('strong', {}, pesos(e.despues))))) : null,
        p.texto_web ? h('p', { class: 'promo-texto' }, `“${p.texto_web}”`) : null,
        h('details', { class: 'plegable' }, h('summary', {}, 'Editar'), formulario(p)),
        h('div', { class: 'acciones' }, prender, borrar)));
  }

  const vigentes = promos.filter((p) => estado(p, hoy)[1] === 'ok');
  const programadas = promos.filter((p) => p.activa && p.desde > hoy);
  const resto = promos.filter((p) => !vigentes.includes(p) && !programadas.includes(p));

  vaciar(cont,
    sesion.prueba ? h('div', { class: 'card' }, h('p', { style: 'margin:0' }, h('strong', {}, 'Modo prueba. '),
      'Las promos que cargues acá solo valen en los pedidos y ventas de prueba: la web de verdad no las ve. '
      + 'Se borran con los demás datos de prueba (Recomendaciones → Borrar datos de prueba).')) : null,
    h('p', { class: 'ayuda' }, 'Se aplican solas en la web y en la venta nueva. Si dos promos tocan la misma caja, o una promo y un código de '
      + 'recomendación, vale la que más descuenta.'),
    h('details', { class: 'plegable', open: !promos.length }, h('summary', {}, 'Nueva promo'), formulario(null)),
    h('h2', {}, 'En curso'),
    vigentes.length ? h('div', { class: 'promo-lista' }, vigentes.map(tarjeta)) : h('p', { class: 'vacio' }, 'Ninguna promo está corriendo hoy.'),
    programadas.length ? [h('h2', {}, 'Programadas'), h('div', { class: 'promo-lista' }, programadas.map(tarjeta))] : null,
    resto.length ? h('details', { class: 'plegable' }, h('summary', {}, `Terminadas y apagadas (${resto.length})`),
      h('div', { class: 'promo-lista' }, resto.map(tarjeta))) : null);
}
