// Avisos push de pedidos nuevos (fase 2 · 2.1). Los manda /api/pedidos después de guardar el pedido,
// a todas las suscripciones de push_suscripciones (una por endpoint). El cifrado de Web Push lo hace
// la librería web-push; acá solo se arma el aviso y se limpian las suscripciones vencidas.
const { encabezados } = require('./supabase.js');

// Claves VAPID de Vercel (las genera scripts/generar-vapid.js). Sin ellas no se manda nada.
function configuracionPush(env = process.env) {
  const { VAPID_PUBLIC_KEY: publica, VAPID_PRIVATE_KEY: privada, VAPID_SUBJECT: sujeto } = env;
  return publica && privada && sujeto ? { publica, privada, sujeto } : null;
}

const pesos = (n) => `$${Number(n).toLocaleString('es-UY', { maximumFractionDigits: 2 })}`;

// Lo que muestra el celular: "Pedido nuevo · Ana · $450". El service worker de /admin lo lee.
function armarAviso(pedido, guardado) {
  return {
    titulo: 'Pedido nuevo',
    cuerpo: `${pedido.nombre} · ${pesos(guardado.total)}${pedido.modalidad === 'entrega' ? ' · con entrega' : ''}`,
    url: '/admin/#/pedidos',
    tag: guardado.codigo,
  };
}

// Manda el aviso a todas las suscripciones. Nunca tira error: el pedido ya está guardado y el cliente
// no tiene que enterarse si falla un aviso. Devuelve { enviados, borrados, fallidos } (para las pruebas).
async function avisarPedidoNuevo(pedido, guardado, { url, clave, fetch: pedir = fetch }, webpush, vapid) {
  const resultado = { enviados: 0, borrados: 0, fallidos: 0 };
  if (!vapid || !guardado?.codigo) return resultado;
  const base = `${url}/rest/v1/push_suscripciones`;
  const h = encabezados(clave);
  try {
    const r = await pedir(`${base}?select=id,endpoint,p256dh,auth&order=creado_en.desc`, { headers: h });
    if (!r.ok) throw new Error(`Supabase respondió ${r.status}`);
    const filas = await r.json();
    const vistos = new Set();
    const subs = filas.filter((s) => !vistos.has(s.endpoint) && vistos.add(s.endpoint));
    const aviso = JSON.stringify(armarAviso(pedido, guardado));
    const opciones = {
      TTL: 60 * 60 * 24, // si el celular está apagado, el aviso espera hasta un día
      urgency: 'high',
      vapidDetails: { subject: vapid.sujeto, publicKey: vapid.publica, privateKey: vapid.privada },
    };
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, aviso, opciones);
        resultado.enviados++;
      } catch (e) {
        // 404/410: la suscripción ya no existe (desinstalaron la app o sacaron el permiso) → se borra
        // (todas las filas con ese endpoint). Otro error: se anota y se reintenta en el próximo pedido.
        const vencida = e.statusCode === 404 || e.statusCode === 410;
        const filtro = vencida ? `endpoint=eq.${encodeURIComponent(s.endpoint)}` : `id=eq.${s.id}`;
        await pedir(`${base}?${filtro}`, {
          method: vencida ? 'DELETE' : 'PATCH',
          headers: { ...h, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: vencida ? undefined : JSON.stringify({ ultimo_error: `${e.statusCode || ''} ${e.message}`.trim().slice(0, 300) }),
        }).catch(() => {});
        if (vencida) resultado.borrados++; else resultado.fallidos++;
      }
    }));
  } catch (e) {
    console.error('Aviso push:', e.message);
  }
  return resultado;
}

module.exports = { configuracionPush, armarAviso, avisarPedidoNuevo };
