// Avisos push a los celulares de los dueños: pedido nuevo (fase 2 · 2.1, lo manda /api/pedidos después de guardar
// el pedido), cierre de mes (idea 4.4, lo manda el cron del día 1, /api/cierre-mes) y compras del viernes (idea 3.6,
// el cron de los viernes, /api/compras-sabado). Van a todas las suscripciones
// de push_suscripciones (una por endpoint). El cifrado de Web Push lo hace la librería web-push; acá solo se arma
// el aviso y se limpian las suscripciones vencidas.
const { encabezados } = require('./supabase.js');
const { pesos, textoVariacion, diaMes } = require('../../admin/js/cifras.js');

// Claves VAPID de Vercel (las genera scripts/generar-vapid.js). Sin ellas no se manda nada.
function configuracionPush(env = process.env) {
  const { VAPID_PUBLIC_KEY: publica, VAPID_PRIVATE_KEY: privada, VAPID_SUBJECT: sujeto } = env;
  return publica && privada && sujeto ? { publica, privada, sujeto } : null;
}

// Lo que muestra el celular: "Pedido nuevo · Ana · $450". El service worker de /admin lo lee.
function armarAviso(pedido, guardado) {
  return {
    titulo: 'Pedido nuevo',
    cuerpo: `${pedido.nombre} · ${pesos(guardado.total)}${pedido.modalidad === 'entrega' ? ' · con entrega' : ''}`,
    url: '/admin/#/pedidos',
    tag: guardado.codigo,
  };
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre',
  'noviembre', 'diciembre'];
// "octubre" (sin el año), como soloMes en admin/js/util.js.
const soloMes = (mes) => MESES[Number(mes.slice(5, 7)) - 1];

// "Cierre de octubre" · "Vendieron $6.790 (sube 49 % vs septiembre) · ganancia $4.120". `cierre`: lo que devuelve
// la función cierre_mes de la base. El link abre /admin → Cierre de mes en ese mes.
function armarAvisoCierre(cierre) {
  const actual = cierre.actual || { vendido: 0, ganancia_bruta: 0 };
  const variacion = cierre.anterior && textoVariacion(Number(actual.vendido), Number(cierre.anterior.vendido),
    soloMes(cierre.anterior.mes));
  const comparacion = variacion ? ` (${variacion})` : '';
  return {
    titulo: `Cierre de ${soloMes(cierre.mes)}`,
    cuerpo: `Vendieron ${pesos(actual.vendido)}${comparacion} · ganancia ${pesos(actual.ganancia_bruta)}`,
    url: `/admin/#/cierre/${cierre.mes}`,
    tag: `cierre-${cierre.mes}`,
  };
}

// "Compras para el sábado 07/11" · "Leche, Huevos, Manteca y 2 más · $854,27". `compras`: lo que devuelve la función
// compras_sabado de la base. Sin pedidos por hacer no hay nada que avisar (null). El link abre ¿Qué compro? con el
// plan de ese sábado, donde está el botón para mandar la lista por WhatsApp.
function armarAvisoCompras(compras) {
  if (!compras.pedidos) return null;
  const nombres = compras.comprar.map((f) => f.insumo);
  const lista = unir(nombres.length > 4 ? [...nombres.slice(0, 3), `${nombres.length - 3} más`] : nombres);
  return {
    titulo: `Compras para el sábado ${diaMes(compras.sabado)}`,
    cuerpo: nombres.length
      ? `${lista} · ${pesos(compras.total)}`
      : `Tenés todo para ${compras.pedidos === 1 ? 'el pedido' : `los ${compras.pedidos} pedidos`}`,
    url: `/admin/#/comprar/${compras.sabado}`,
    tag: `compras-${compras.sabado}`,
  };
}

// "Leche", "Leche y Huevos", "Leche, Huevos y Manteca".
const unir = (nombres) => nombres.length > 1 ? `${nombres.slice(0, -1).join(', ')} y ${nombres.at(-1)}` : nombres.join('');

// Pedido nuevo: nombre y total. Devuelve lo mismo que mandarAviso.
async function avisarPedidoNuevo(pedido, guardado, conf, webpush, vapid) {
  return mandarAviso(guardado?.codigo ? armarAviso(pedido, guardado) : null, conf, webpush, vapid);
}

// Manda el aviso a todas las suscripciones. Nunca tira error: lo que lo disparó (un pedido, el cron) ya pasó y no
// depende del aviso. Sin aviso (null: nada que contar) no manda nada. Devuelve { enviados, borrados, fallidos }.
async function mandarAviso(aviso, { url, clave, fetch: pedir = fetch }, webpush, vapid) {
  const resultado = { enviados: 0, borrados: 0, fallidos: 0 };
  if (!aviso || !vapid) return resultado;
  const base = `${url}/rest/v1/push_suscripciones`;
  const h = encabezados(clave);
  try {
    const r = await pedir(`${base}?select=id,endpoint,p256dh,auth&order=creado_en.desc`, { headers: h });
    if (!r.ok) throw new Error(`Supabase respondió ${r.status}`);
    const filas = await r.json();
    const vistos = new Set();
    const subs = filas.filter((s) => !vistos.has(s.endpoint) && vistos.add(s.endpoint));
    const cuerpo = JSON.stringify(aviso);
    const opciones = {
      TTL: 60 * 60 * 24, // si el celular está apagado, el aviso espera hasta un día
      urgency: 'high',
      vapidDetails: { subject: vapid.sujeto, publicKey: vapid.publica, privateKey: vapid.privada },
    };
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, cuerpo, opciones);
        resultado.enviados++;
      } catch (e) {
        // 404/410: la suscripción ya no existe (desinstalaron la app o sacaron el permiso) → se borra
        // (todas las filas con ese endpoint). Otro error: se anota y se reintenta en el próximo aviso.
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

module.exports = { configuracionPush, armarAviso, armarAvisoCierre, armarAvisoCompras, avisarPedidoNuevo, mandarAviso };
