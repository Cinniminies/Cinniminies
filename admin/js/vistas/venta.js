import { sb, q, rpc } from '../db.js';
import {
  h, vaciar, chips, campo, campoFecha, grupo, pesos, hoyISO, toast, conBoton, debounce, mostrarError, ETIQUETAS, opciones,
} from '../util.js';
import { catalogo, clientes as leerClientes, origenes as leerOrigenes } from '../catalogo.js';
import { elegirCliente, editorLineas } from '../componentes.js';

// Borrador de la venta: sobrevive si se sale de la pantalla y se vuelve.
let estado = null;
const nuevoEstado = (fecha = hoyISO()) => ({
  fecha, cliente: null, origen: '', entrega: 'retiro', medio_pago: null, estado_pago: 'pagado',
  tipo: 'venta', precio_especial: '', notas: '', lineas: [], abierto: false,
});

export async function mostrar(cont) {
  const [cat, clientes, origenes] = await Promise.all([catalogo(), leerClientes(), leerOrigenes()]);
  if (!estado) estado = nuevoEstado();
  formulario(cont, cat, clientes, origenes);
}

function payload() {
  const p = {
    fecha: estado.fecha,
    entrega: estado.entrega,
    medio_pago: estado.medio_pago,
    estado_pago: estado.estado_pago,
    tipo: estado.tipo,
    notas: estado.notas,
    precio_especial: estado.precio_especial === '' ? null : Number(estado.precio_especial),
    lineas: null,
  };
  if (estado.origen.trim()) p.origen = estado.origen.trim();
  if (estado.cliente?.nuevo) {
    p.cliente = { nombre: estado.cliente.nombre, contacto: estado.cliente.contacto, origen: estado.cliente.origen };
  } else if (estado.cliente) {
    p.cliente_id = estado.cliente.id;
  }
  return p;
}

function formulario(cont, cat, clientes, origenes) {
  let pedido = 0;
  const resumen = h('div', { class: 'card resumen' });
  const guardar = h('button', { class: 'btn primario', type: 'button' }, 'Guardar venta');

  const editor = editorLineas(cat, estado.lineas, () => recalcular());

  const recalcular = debounce(async () => {
    const p = payload();
    p.lineas = editor.valor();
    const este = ++pedido;
    if (editor.vacio()) {
      vaciar(resumen, h('p', { class: 'vacio', style: 'padding:0' }, 'Elegí el formato y los sabores.'));
      guardar.textContent = 'Guardar venta';
      return;
    }
    try {
      const r = await rpc('calcular_venta', { p });
      if (este !== pedido) return;
      const total = Number(r.precio_cobrado) + Number(r.cobro_envio);
      vaciar(resumen,
        h('div', { class: 'r' }, h('span', {}, `Lista (${r.rolls} rolls)`), h('span', {}, pesos(r.precio_lista))),
        Number(r.descuento) ? h('div', { class: 'r' }, h('span', {}, Number(r.descuento) > 0 ? 'Descuento' : 'Recargo'),
          h('span', {}, pesos(-r.descuento))) : null,
        Number(r.cobro_envio) ? h('div', { class: 'r' }, h('span', {}, 'Envío'), h('span', {}, pesos(r.cobro_envio))) : null,
        h('div', { class: 'r total' }, h('span', {}, 'Cobrás'), h('span', {}, pesos(total))),
        h('div', { class: 'r' }, h('span', {}, 'Costo rolls + caja'),
          h('span', {}, pesos(Number(r.costo_produccion) + Number(r.costo_caja)))),
        h('div', { class: 'r gan' }, h('span', {}, 'Ganancia'), h('span', {}, pesos(r.ganancia))));
      guardar.textContent = `Guardar venta · ${pesos(total)}`;
    } catch (e) {
      if (este !== pedido) return;
      vaciar(resumen, h('p', { class: 'aviso' }, e.message));
      guardar.textContent = 'Guardar venta';
    }
  }, 250);

  const selector = elegirCliente(clientes, estado.cliente, (c) => {
    estado.cliente = c;
    // El origen de la venta es el habitual del cliente; uno nuevo lo trae en su propio formulario
    estado.origen = c && !c.nuevo ? c.origen || '' : '';
    origen.value = estado.origen;
  }, origenes);

  const origen = h('input', {
    value: estado.origen, list: 'lista-origenes', placeholder: 'El del cliente',
    oninput: (e) => { estado.origen = e.target.value; },
  });
  const opcionesMas = h('details', {
    class: 'plegable', open: estado.abierto,
    ontoggle: (e) => { estado.abierto = e.target.open; editor.mostrarCajas(e.target.open); },
  },
  h('summary', {}, 'Precio especial, caja y notas'),
  campo('Precio especial (lo que se cobró en total, sin envío)', h('input', {
    type: 'number', inputmode: 'decimal', min: 0, step: '0.01', value: estado.precio_especial, placeholder: 'Precio de lista',
    oninput: (e) => { estado.precio_especial = e.target.value; recalcular(); },
  })),
  grupo('Tipo', chips(opciones(ETIQUETAS.tipo), estado.tipo, (v) => { estado.tipo = v; })),
  campo('Origen de esta venta', origen),
  campo('Notas', h('textarea', { value: estado.notas, oninput: (e) => { estado.notas = e.target.value; } })),
  h('p', { class: 'ayuda' }, 'Con esto abierto, cada producto muestra qué caja se usó.'));
  if (estado.abierto) editor.mostrarCajas(true);

  guardar.onclick = () => conBoton(guardar, async () => {
    if (!estado.cliente || (estado.cliente.nuevo && !estado.cliente.nombre.trim())) throw new Error('Elegí o cargá el cliente');
    if (!estado.medio_pago) throw new Error('Elegí el medio de pago');
    const p = payload();
    p.lineas = editor.valor();
    const r = await rpc('registrar_venta', { p });
    const guardado = estado;
    estado = nuevoEstado(guardado.fecha); // si se sale y se vuelve, arranca vacía
    confirmacion(cont, cat, r, guardado);
  });

  vaciar(cont, h('div', { class: 'con-guardar' },
    campoFecha(estado.fecha, (v) => { estado.fecha = v; recalcular(); }),
    grupo('Cliente', selector),
    editor.el,
    grupo('Entrega', chips([
      { valor: 'retiro', texto: 'Retiro' },
      { valor: 'envio', texto: `Envío (+${pesos(cat.precioEnvio)})` },
      { valor: 'sin_envio', texto: 'Sin envío' },
    ], estado.entrega, (v) => { estado.entrega = v; recalcular(); })),
    grupo('Pago', chips(opciones(ETIQUETAS.medio_pago), estado.medio_pago, (v) => { estado.medio_pago = v; })),
    grupo('Estado', chips(opciones(ETIQUETAS.estado_pago), estado.estado_pago, (v) => { estado.estado_pago = v; })),
    opcionesMas,
    h('h2', {}, 'Resumen'),
    resumen),
  h('div', { class: 'guardar' }, guardar));
  recalcular();
}

function confirmacion(cont, cat, r, guardado) {
  const cliente = guardado.cliente;
  const total = Number(r.precio_cobrado) + Number(r.cobro_envio);
  const detalle = r.lineas.map((l) => `${l.cantidad > 1 ? l.cantidad + ' × ' : ''}${l.formato} (${
    l.sabores.map((s) => `${cat.sabor(s.sabor_id)?.nombre_corto || s.sabor} ${s.unidades}`).join(', ')})`).join(' + ');

  const otra = h('button', { class: 'btn primario', type: 'button' }, 'Cargar otra');
  const deshacer = h('button', { class: 'btn peligro', type: 'button' }, 'Deshacer');
  otra.onclick = () => conBoton(otra, () => mostrar(cont));
  deshacer.onclick = () => conBoton(deshacer, async () => {
    await q(sb.from('ventas').delete().eq('id', r.venta_id));
    if (cliente?.nuevo && r.cliente_id) await q(sb.from('clientes').delete().eq('id', r.cliente_id));
    estado = guardado;
    toast('Venta deshecha: podés corregirla y guardarla de nuevo');
    await mostrar(cont).catch(mostrarError);
  });

  vaciar(cont, h('div', { class: 'card hecho' },
    h('div', { class: 'tilde' }, '✓'),
    h('h1', {}, 'Venta guardada'),
    h('div', { class: 'monto-grande' }, pesos(total)),
    h('p', {}, h('strong', {}, cliente?.nombre || ''), ` · ${ETIQUETAS.estado_pago[guardado.estado_pago]}`),
    h('p', { class: 'ayuda' }, detalle),
    h('div', { class: 'acciones', style: 'justify-content:center' }, otra, deshacer)));
  window.scrollTo(0, 0);
}
