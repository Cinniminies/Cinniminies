import { sb, q, rpc } from '../db.js';
import { h, vaciar, pesos, plural, chips, campo, interruptor, toast, conBoton, ETIQUETAS } from '../util.js';
import { catalogo, clientes as leerClientes, origenes as leerOrigenes } from '../catalogo.js';
import { elegirCliente } from '../componentes.js';
import { irA } from '../app.js';

// Pedidos que llegan desde la web (Etapa 6). Se confirman como venta (con los precios que vio el
// cliente) o se rechazan. Las reglas están en la base: confirmar_pedido y rechazar_pedido.
const ESTADOS = [
  { valor: 'nuevo', texto: 'Nuevos' },
  { valor: 'confirmado', texto: 'Confirmados' },
  { valor: 'rechazado', texto: 'Rechazados' },
];
let estado = 'nuevo';

const hora = (ts) => new Date(ts).toLocaleString('es-UY', {
  timeZone: 'America/Montevideo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});
const telLindo = (t) => `${t.slice(0, 3)} ${t.slice(3, 6)} ${t.slice(6)}`;
const compras = (n) => plural(n, 'compra', 'compras');
// Un contacto "tiene celular" si trae al menos 8 dígitos (misma regla que cliente_por_telefono).
const tieneCelular = (contacto) => (contacto || '').replace(/\D/g, '').length >= 8;

// A qué cliente va la venta al confirmar. Por defecto, el que la base encontró por el celular
// (v_pedidos.cliente_sugerido_id) o uno nuevo con el nombre del pedido. Se puede elegir otro de la
// libreta o crear uno nuevo. `datos()` devuelve lo que se suma a confirmar_pedido.
function bloqueCliente(p, lista, origenes) {
  const cont = h('div', { class: 'cliente-pedido' });
  let elegido = null; // null = lo que sugiere la base | cliente de la libreta | { nuevo: true, … }
  let eligiendo = false;
  let antes = null; // lo elegido antes de tocar "Cambiar", para "Cancelar"
  let guardarTel = true;
  const elegir = () => { antes = elegido; eligiendo = true; dibujar(); };

  function dibujar() {
    if (eligiendo) {
      vaciar(cont,
        h('div', { class: 'linea-cab' }, h('strong', {}, '¿De quién es el pedido?'),
          h('button', { type: 'button', class: 'link', onclick: () => { elegido = antes; eligiendo = false; dibujar(); } }, 'Cancelar')),
        elegirCliente(lista, null, (c) => {
          elegido = c;
          // Cliente nuevo: se precarga una sola vez con el celular del pedido y origen Web
          // (el formulario se dibuja después de este aviso, así que ya sale con esos valores).
          if (c?.nuevo && !c.precargado) {
            Object.assign(c, { contacto: c.contacto || p.telefono, origen: c.origen || 'Web', precargado: true });
          }
          if (c && !c.nuevo) { eligiendo = false; dibujar(); }
        }, origenes));
      cont.querySelector('input')?.focus();
      return;
    }
    if (elegido && !elegido.nuevo) {
      const ofrecerTel = !tieneCelular(elegido.contacto);
      vaciar(cont,
        h('p', {}, 'Cliente: ', h('a', { href: `#/clientes/${elegido.id}` }, h('strong', {}, elegido.nombre)),
          ` · ${compras(elegido.compras)} `,
          h('button', { type: 'button', class: 'link', onclick: elegir }, 'Cambiar')),
        ofrecerTel ? interruptor(`Guardarle el celular ${telLindo(p.telefono)}`, guardarTel, (v) => { guardarTel = v; },
          'Así el próximo pedido se asocia solo.') : null);
    } else if (p.cliente_sugerido_id) {
      vaciar(cont, h('p', {}, 'Cliente: ', h('a', { href: `#/clientes/${p.cliente_sugerido_id}` }, h('strong', {}, p.cliente_sugerido)),
        ` · ${compras(p.compras_cliente)} `,
        h('button', { type: 'button', class: 'link', onclick: elegir }, 'Es otro cliente')));
    } else {
      vaciar(cont, h('p', {}, h('strong', {}, 'Cliente nuevo'), `: se va a crear «${p.nombre}» `,
        h('button', { type: 'button', class: 'link', onclick: elegir }, 'Elegir de la libreta')));
    }
  }
  dibujar();

  return {
    el: cont,
    // Si quedó a medio elegir un cliente nuevo, se usa lo que se escribió; si está vacío, lo de siempre.
    datos() {
      if (elegido?.nuevo && elegido.nombre?.trim()) {
        return { cliente: { nombre: elegido.nombre, contacto: elegido.contacto, origen: elegido.origen } };
      }
      if (elegido && !elegido.nuevo) {
        return { cliente_id: elegido.id, guardar_telefono: !tieneCelular(elegido.contacto) && guardarTel };
      }
      return {};
    },
    // Para el texto de la confirmación.
    nombre() {
      if (elegido?.nuevo && elegido.nombre?.trim()) return `${elegido.nombre.trim()} (cliente nuevo)`;
      if (elegido && !elegido.nuevo) return elegido.nombre;
      return p.cliente_sugerido || `${p.nombre} (cliente nuevo)`;
    },
  };
}

export async function mostrar(cont) {
  const [cat, pedidos, lista, origenes] = await Promise.all([
    catalogo(true), // fresco: un pedido puede traer un sabor creado después de abrir la app
    q(sb.from('v_pedidos').select('*, pedido_cajas(orden, formato_id, precio, sabores)')
      .eq('estado', estado).order('creado_en', { ascending: estado === 'nuevo' }).limit(100)),
    estado === 'nuevo' ? leerClientes() : [],
    estado === 'nuevo' ? leerOrigenes() : [],
  ]);

  const tarjeta = (p) => {
    const cajas = [...p.pedido_cajas].sort((a, b) => a.orden - b.orden).map((c) =>
      h('li', {}, h('strong', {}, cat.formato(c.formato_id)?.nombre || 'Caja'), ` · ${pesos(c.precio)}`,
        h('div', { class: 'ayuda' }, c.sabores.map((s) => `${cat.sabor(s.sabor_id)?.nombre || 'Sabor'} ${s.unidades}`).join(' · '))));
    const mensaje = encodeURIComponent(`¡Hola ${p.nombre.split(' ')[0]}! Te escribimos de Cinniminies por tu pedido ${p.codigo}.`);

    const acciones = [];
    if (p.estado === 'nuevo') {
      const cliente = bloqueCliente(p, lista, origenes);
      acciones.push(cliente.el);
      const confirmar = h('button', { class: 'btn ok', type: 'button' }, 'Confirmar como venta');
      confirmar.onclick = () => conBoton(confirmar, async () => {
        if (!confirm(`¿Confirmar el pedido ${p.codigo} a nombre de ${cliente.nombre()} por ${pesos(p.total)}? Queda como venta pendiente de cobro.`)) return;
        const v = await rpc('confirmar_pedido', { p_pedido: p.id, p: cliente.datos() });
        toast(`Pedido ${p.codigo} confirmado`, { accion: { texto: 'Ver venta', fn: () => irA(`#/ventas/${v.venta_id}`) } });
        irA('#/pedidos');
      });
      const motivo = h('input', { placeholder: 'Opcional: sin stock, no respondió…' });
      const rechazar = h('button', { class: 'btn peligro chico', type: 'button' }, 'Rechazar');
      rechazar.onclick = () => conBoton(rechazar, async () => {
        await rpc('rechazar_pedido', { p_pedido: p.id, p_motivo: motivo.value });
        toast(`Pedido ${p.codigo} rechazado`);
        irA('#/pedidos');
      });
      acciones.push(h('div', { class: 'acciones' },
        h('a', { class: 'btn', href: `https://wa.me/598${p.telefono.slice(1)}?text=${mensaje}`, target: '_blank', rel: 'noopener' }, 'WhatsApp'),
        confirmar),
      h('details', { class: 'plegable' }, h('summary', {}, 'Rechazar el pedido'), campo('Motivo', motivo), rechazar));
    } else if (p.venta_id) {
      acciones.push(h('div', { class: 'acciones' }, h('a', { class: 'btn', href: `#/ventas/${p.venta_id}` }, 'Ver la venta')));
    } else if (p.estado === 'rechazado') {
      acciones.push(h('p', { class: 'ayuda' }, p.motivo_rechazo ? `Motivo: ${p.motivo_rechazo}` : 'Sin motivo'));
    }

    return h('article', { class: 'card pedido' },
      h('div', { class: 'seccion-cab' },
        h('div', {}, h('strong', {}, p.nombre), ' ', h('span', { class: 'badge neutro' }, p.codigo)),
        h('strong', { class: 'monto' }, pesos(p.total))),
      h('p', { class: 'ayuda', style: 'margin:.25rem 0 .5rem' },
        [hora(p.creado_en), telLindo(p.telefono),
          p.modalidad === 'entrega' ? `Entrega: ${p.direccion}` : 'Retiro',
          ETIQUETAS.medio_pago[p.medio_pago]].join(' · ')),
      h('ul', { class: 'lista plana' }, cajas),
      p.notas ? h('p', {}, h('em', {}, `“${p.notas}”`)) : null,
      acciones);
  };

  vaciar(cont,
    chips(ESTADOS, estado, (v) => { estado = v; irA('#/pedidos'); }),
    estado === 'nuevo' && pedidos.length
      ? h('p', { class: 'ayuda' }, `${plural(pedidos.length, 'pedido nuevo', 'pedidos nuevos')}. El total es sin envío `
        + '(si es con entrega, la venta suma el envío al confirmarla).')
      : null,
    pedidos.length ? pedidos.map(tarjeta)
      : h('p', { class: 'vacio' }, estado === 'nuevo' ? 'No hay pedidos nuevos de la web.' : 'No hay pedidos acá.'));
}
