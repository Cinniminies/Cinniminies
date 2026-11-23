// Descuento por recomendación (docs/descuento-plan/logica.md): lo que comparten Ventas, Clientes y
// Recomendaciones. Las reglas están en la base (saldo_recomendacion, consultar_codigo, crear_pedido_web).
import { sb, q } from './db.js';
import { hoyISO, linkWhatsapp, diaMes } from './util.js';

const WEB = 'cinniminies.emprendeuy.com';

// Los textos de los WhatsApp, editables en Textos e imágenes: `mensaje` (el código), `mensaje_bono` (lo que se
// agrega si tiene el bono de la Box de 12) y `mensaje_saldo` (el descuento que lleva juntado). null si no están.
export async function mensajesWhatsapp() {
  const claves = ['mensaje', 'mensaje_bono', 'mensaje_saldo'];
  const textos = await q(sb.from('contenido_web').select('clave,valor').in('clave', claves.map((c) => `recomendacion.${c}`)));
  return Object.fromEntries(claves.map((c) => [c, textos.find((t) => t.clave === `recomendacion.${c}`)?.valor || null]));
}

// Campaña vigente hoy (la RLS ya separa las de prueba de las reales) con los textos de mensajesWhatsapp, o null.
export async function campanaVigente() {
  const hoy = hoyISO();
  const [filas, mensajes] = await Promise.all([
    q(sb.from('campanas_recomendacion').select('*').lte('desde', hoy).gte('hasta', hoy)
      .order('desde', { ascending: false }).limit(1)),
    mensajesWhatsapp(),
  ]);
  return filas[0] ? { ...filas[0], ...mensajes } : null;
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

// Si todavía no se cargó el texto editable (o lo dejaron vacío).
const MENSAJE = '¡Hola {nombre}! Gracias por tu compra en Cinniminies. Este es tu código: {codigo}\n\n'
  + `Pasáselo a quien quieras: cada persona nueva que pida en ${WEB} con tu código y pague su pedido te suma `
  + '{porcentaje} % de descuento en una Box de 6 o de 12 (hasta {tope} % por mes).\n\n'
  + 'Para usarlo, poné tu código cuando hagas tu pedido en la web. Lo que juntes en el mes se usa hasta fin de mes.';

const MENSAJE_BONO = 'Y por tu primera Box de 12 ya tenés {bono} % de descuento para tus próximos pedidos, hasta el {vence}.';

const MENSAJE_SALDO = '¡Hola {nombre}! Gracias por recomendar Cinniminies. Ya juntaste {saldo} % de descuento en una Box de 6 '
  + `o de 12.\n\nPara usarlo, poné tu código {codigo} cuando hagas tu pedido en ${WEB}. Vale hasta el {vence}.`;

// Reemplaza las {variables} del texto. Sin nombre queda "¡Hola!" y no "¡Hola !".
const completar = (texto, vars) => texto
  .replace(/ \{nombre\}/g, vars.nombre ? ' {nombre}' : '')
  .replace(/\{(\w+)\}/g, (todo, v) => (v in vars ? vars[v] : todo));

const primerNombre = (nombre) => (nombre || '').trim().split(/\s+/)[0];

// El mensaje que se le manda al cliente con su código, con las {variables} reemplazadas. Si tiene el bono
// de la Box de 12 (bonoDe), se agrega un párrafo con cuánto es y hasta cuándo vale.
export function mensajeCodigo(nombre, codigo, campana, bono = null) {
  const vars = {
    nombre: primerNombre(nombre),
    codigo,
    porcentaje: campana ? num(campana.porcentaje) : '5',
    tope: campana ? num(campana.tope) : '30',
    bono: bono ? num(bono.porcentaje) : '',
    vence: bono ? diaMes(bono.hasta) : '',
  };
  return completar((campana?.mensaje?.trim() || MENSAJE)
    + (bono ? `\n\n${campana?.mensaje_bono?.trim() || MENSAJE_BONO}` : ''), vars);
}

// Link de WhatsApp con el mensaje armado, si el contacto es un celular uruguayo.
export function linkCodigo(contacto, nombre, codigo, campana, bono = null) {
  return linkWhatsapp(contacto, { texto: mensajeCodigo(nombre, codigo, campana, bono) });
}

// Link de WhatsApp con el descuento que juntó. `cliente`: una fila del ranking de resumen_campana
// ({ nombre, contacto, codigo, saldo, vence }); `mensajes`: los de mensajesWhatsapp. null sin saldo o sin celular.
export function linkSaldo(cliente, mensajes) {
  if (!Number(cliente.saldo) || !cliente.codigo) return null;
  const vars = {
    nombre: primerNombre(cliente.nombre), codigo: cliente.codigo, saldo: num(cliente.saldo), vence: diaMes(cliente.vence),
  };
  return linkWhatsapp(cliente.contacto, { texto: completar(mensajes.mensaje_saldo?.trim() || MENSAJE_SALDO, vars) });
}

export const ESTADO_RECOMENDACION = { pendiente: 'Pendiente', valida: 'Válida', anulada: 'Anulada' };
export const CLASE_RECOMENDACION = { pendiente: 'pendiente', valida: 'ok', anulada: 'neutro' };
