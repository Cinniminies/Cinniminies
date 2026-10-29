// Descuento por recomendación (docs/descuento-plan/logica.md): lo que comparten Ventas, Clientes y
// Recomendaciones. Las reglas están en la base (saldo_recomendacion, consultar_codigo, crear_pedido_web).
import { sb, q } from './db.js';
import { hoyISO, linkWhatsapp } from './util.js';

const WEB = 'cinniminies.emprendeuy.com';

// Campaña vigente hoy (la RLS ya separa las de prueba de las reales), o null. Trae también `mensaje` y
// `mensaje_bono`: el texto del WhatsApp con el código y lo que se agrega si tiene el bono de la Box de 12,
// editables en Textos e imágenes (recomendacion.mensaje y recomendacion.mensaje_bono).
export async function campanaVigente() {
  const hoy = hoyISO();
  const [filas, textos] = await Promise.all([
    q(sb.from('campanas_recomendacion').select('*').lte('desde', hoy).gte('hasta', hoy)
      .order('desde', { ascending: false }).limit(1)),
    q(sb.from('contenido_web').select('clave,valor').in('clave', ['recomendacion.mensaje', 'recomendacion.mensaje_bono'])),
  ]);
  const texto = (clave) => textos.find((t) => t.clave === clave)?.valor || null;
  return filas[0] ? { ...filas[0], mensaje: texto('recomendacion.mensaje'), mensaje_bono: texto('recomendacion.mensaje_bono') } : null;
}

// Bono vigente hoy por la primera Box de 12 ({ porcentaje, desde, hasta, … }), o null. Dura 30 días aunque
// la campaña termine antes.
export async function bonoDe(clienteId) {
  if (!clienteId) return null;
  const hoy = hoyISO();
  const filas = await q(sb.from('bonos_recomendacion').select('*').eq('cliente_id', clienteId)
    .lte('desde', hoy).gte('hasta', hoy).order('desde', { ascending: false }).limit(1));
  return filas[0] || null;
}

export async function codigoDe(clienteId) {
  if (!clienteId) return null;
  const filas = await q(sb.from('codigos_recomendacion').select('codigo').eq('cliente_id', clienteId));
  return filas[0]?.codigo || null;
}

const num = (n) => String(Number(n)).replace('.', ',');
// "2027-01-19" → "19/1"
export const diaMes = (iso) => { const [, m, d] = iso.split('-'); return `${Number(d)}/${Number(m)}`; };

// Si todavía no se cargó el texto editable (o lo dejaron vacío).
const MENSAJE = '¡Hola {nombre}! Gracias por tu compra en Cinniminies. Este es tu código: {codigo}\n\n'
  + `Pasáselo a quien quieras: cada persona nueva que pida en ${WEB} con tu código y pague su pedido te suma `
  + '{porcentaje} % de descuento en una Box de 6 o de 12 (hasta {tope} % por mes).\n\n'
  + 'Para usarlo, poné tu código cuando hagas tu pedido en la web. Lo que juntes en el mes se usa hasta fin de mes.';

const MENSAJE_BONO = 'Y por tu primera Box de 12 ya tenés {bono} % de descuento para tus próximos pedidos, hasta el {vence}.';

// El mensaje que se le manda al cliente con su código, con las {variables} reemplazadas. Si tiene el bono
// de la Box de 12 (bonoDe), se agrega un párrafo con cuánto es y hasta cuándo vale.
export function mensajeCodigo(nombre, codigo, campana, bono = null) {
  const vars = {
    nombre: (nombre || '').trim().split(/\s+/)[0],
    codigo,
    porcentaje: campana ? num(campana.porcentaje) : '5',
    tope: campana ? num(campana.tope) : '30',
    bono: bono ? num(bono.porcentaje) : '',
    vence: bono ? diaMes(bono.hasta) : '',
  };
  const texto = (campana?.mensaje?.trim() || MENSAJE)
    + (bono ? `\n\n${campana?.mensaje_bono?.trim() || MENSAJE_BONO}` : '');
  return texto
    .replace(/ \{nombre\}/g, vars.nombre ? ' {nombre}' : '') // sin nombre: "¡Hola!" y no "¡Hola !"
    .replace(/\{(\w+)\}/g, (todo, v) => (v in vars ? vars[v] : todo));
}

// Link de WhatsApp con el mensaje armado, si el contacto es un celular uruguayo.
export function linkCodigo(contacto, nombre, codigo, campana, bono = null) {
  return linkWhatsapp(contacto, { texto: mensajeCodigo(nombre, codigo, campana, bono) });
}

export const ESTADO_RECOMENDACION = { pendiente: 'Pendiente', valida: 'Válida', anulada: 'Anulada' };
export const CLASE_RECOMENDACION = { pendiente: 'pendiente', valida: 'ok', anulada: 'neutro' };
