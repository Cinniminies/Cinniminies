// Pedidos de la web (Etapa 6): se validan y se guardan en la base con crear_pedido_web(), que
// recalcula el precio con la misma regla que las ventas. El total del navegador no se usa.
const crypto = require('node:crypto');
const { encabezados } = require('./supabase.js');

const MAX_CUERPO = 20000; // bytes: un pedido real ocupa menos de 2 KB

// IP del cliente según Vercel. No se guarda: solo un hash, para limitar pedidos seguidos.
function hashIp(req, sal = process.env.PEDIDOS_SAL || 'cinniminies') {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  return ip ? crypto.createHash('sha256').update(`${sal}:${ip}`).digest('hex').slice(0, 32) : null;
}

const txt = (x, max) => (typeof x === 'string' ? x.trim().slice(0, max) : '');

// Deja solo lo que la base espera. Errores de forma se responden acá; las reglas (rolls por caja,
// sabores visibles, precios) las valida la base.
function armarPedido(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new ErrorPedido('Pedido inválido');
  if (!Array.isArray(b.cajas) || !b.cajas.length) throw new ErrorPedido('El pedido no tiene cajas');
  if (b.cajas.length > 20) throw new ErrorPedido('Demasiadas cajas en un pedido');
  return {
    nombre: txt(b.nombre, 100),
    telefono: txt(b.telefono, 20),
    modalidad: txt(b.modalidad, 20).toLowerCase(),
    direccion: txt(b.direccion, 200),
    pago: txt(b.pago, 20).toLowerCase(),
    notas: txt(b.notas, 500),
    cajas: b.cajas.map((c) => ({
      tipo: c?.tipo === 'personalizado' ? 'personalizado' : 'caja_fija',
      rolls: Number.isInteger(c?.rolls) ? c.rolls : null,
      sabores: Object.fromEntries(Object.entries(c?.sabores && typeof c.sabores === 'object' ? c.sabores : {})
        .slice(0, 20).map(([k, v]) => [String(k).slice(0, 60), v])),
    })),
  };
}

class ErrorPedido extends Error {}

async function guardarPedido(pedido, ipHash, { url, clave, fetch: pedir = fetch }) {
  const r = await pedir(`${url}/rest/v1/rpc/crear_pedido_web`, {
    method: 'POST',
    headers: { ...encabezados(clave), 'Content-Type': 'application/json' },
    body: JSON.stringify({ p: pedido, p_ip_hash: ipHash }),
  });
  const cuerpo = await r.json().catch(() => null);
  if (r.ok) return cuerpo;
  // Los `raise exception` de la base (P0001) son mensajes para el cliente; el resto, error interno.
  if (cuerpo?.code === 'P0001' && cuerpo.message) throw new ErrorPedido(cuerpo.message);
  throw new Error(`Supabase respondió ${r.status}: ${JSON.stringify(cuerpo).slice(0, 300)}`);
}

module.exports = { MAX_CUERPO, hashIp, armarPedido, guardarPedido, ErrorPedido };
