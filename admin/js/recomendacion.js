// Descuento por recomendación (docs/descuento-plan/logica.md): lo que comparten Ventas, Clientes y
// Recomendaciones. Las reglas están en la base (saldo_recomendacion, consultar_codigo, crear_pedido_web).
import { sb, q } from './db.js';
import { hoyISO, linkWhatsapp } from './util.js';

const WEB = 'cinniminies.vercel.app';

// Campaña vigente hoy (la RLS ya separa las de prueba de las reales), o null. Trae también `mensaje`: el texto
// del WhatsApp con el código, editable en Textos e imágenes (recomendacion.mensaje).
export async function campanaVigente() {
  const hoy = hoyISO();
  const [filas, textos] = await Promise.all([
    q(sb.from('campanas_recomendacion').select('*').lte('desde', hoy).gte('hasta', hoy)
      .order('desde', { ascending: false }).limit(1)),
    q(sb.from('contenido_web').select('valor').eq('clave', 'recomendacion.mensaje')),
  ]);
  return filas[0] ? { ...filas[0], mensaje: textos[0]?.valor || null } : null;
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

// El mensaje que se le manda al cliente con su código, con las {variables} reemplazadas.
export function mensajeCodigo(nombre, codigo, campana) {
  const vars = {
    nombre: (nombre || '').trim().split(/\s+/)[0],
    codigo,
    porcentaje: campana ? num(campana.porcentaje) : '5',
    tope: campana ? num(campana.tope) : '30',
  };
  return (campana?.mensaje?.trim() || MENSAJE)
    .replace(/ \{nombre\}/g, vars.nombre ? ' {nombre}' : '') // sin nombre: "¡Hola!" y no "¡Hola !"
    .replace(/\{(\w+)\}/g, (todo, v) => (v in vars ? vars[v] : todo));
}

// Link de WhatsApp con el mensaje armado, si el contacto es un celular uruguayo.
export function linkCodigo(contacto, nombre, codigo, campana) {
  const wa = linkWhatsapp(contacto);
  return wa ? `${wa}?text=${encodeURIComponent(mensajeCodigo(nombre, codigo, campana))}` : null;
}

export const ESTADO_RECOMENDACION = { pendiente: 'Pendiente', valida: 'Válida', anulada: 'Anulada' };
export const CLASE_RECOMENDACION = { pendiente: 'pendiente', valida: 'ok', anulada: 'neutro' };
