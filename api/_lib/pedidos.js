// Pedidos de la web (Etapa 6): se validan y se guardan en la base con crear_pedido_web(), que
// recalcula el precio con la misma regla que las ventas. El total del navegador no se usa.
const { rpc } = require('./supabase.js');

const MAX_CUERPO = 20000; // bytes: un pedido real ocupa menos de 2 KB

const txt = (x, max) => (typeof x === 'string' ? x.trim().slice(0, max) : '');

// Deja solo lo que la base espera. Errores de forma se responden acá; las reglas (rolls por caja,
// sabores visibles, precios) las valida la base.
function armarPedido(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new ErrorPedido('Pedido inválido');
  if (!Array.isArray(b.cajas) || !b.cajas.length) throw new ErrorPedido('El pedido no tiene cajas');
  if (b.cajas.length > 20) throw new ErrorPedido('Demasiadas cajas en un pedido');
  return {
    nombre: txt(b.nombre, 100).replace(/\d/g, '').replace(/\s+/g, ' ').trim(), // la web ya no deja escribir números
    telefono: txt(b.telefono, 20),
    modalidad: txt(b.modalidad, 20).toLowerCase(),
    direccion: txt(b.direccion, 200),
    pago: txt(b.pago, 20).toLowerCase(),
    notas: txt(b.notas, 500),
    codigo_recomendacion: txt(b.codigo_recomendacion, 20), // la base lo normaliza y decide qué hacer con él
    cajas: b.cajas.map((c) => ({
      tipo: c?.tipo === 'personalizado' ? 'personalizado' : 'caja_fija',
      rolls: Number.isInteger(c?.rolls) ? c.rolls : null,
      sabores: Object.fromEntries(Object.entries(c?.sabores && typeof c.sabores === 'object' ? c.sabores : {})
        .slice(0, 20).map(([k, v]) => [String(k).slice(0, 60), v])),
    })),
  };
}

class ErrorPedido extends Error {}

// Los mensajes de la base (faltan datos, demasiados pedidos seguidos) llegan como ErrorPedido.
function guardarPedido(pedido, ipHash, conf) {
  return rpc('crear_pedido_web', { p: pedido, p_ip_hash: ipHash }, conf, { ErrorCliente: ErrorPedido });
}

module.exports = { MAX_CUERPO, armarPedido, guardarPedido, ErrorPedido };
