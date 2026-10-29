// Pruebas de los avisos push (fase 2 · 2.1 y cierre de mes): node --test api/_tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { configuracionPush, armarAviso, armarAvisoCierre, avisarPedidoNuevo } = require('../_lib/push.js');
const { mesAnterior } = require('../cierre-mes.js');

const vapid = { publica: 'pub', privada: 'priv', sujeto: 'mailto:x@y.z' };
const pedido = { nombre: 'Ana', modalidad: 'retiro' };
const guardado = { codigo: 'CM-2026-ABCD', total: 450 };

// Supabase simulado: devuelve las suscripciones y anota los DELETE/PATCH.
function base(filas) {
  const llamadas = [];
  const fetch = async (url, op = {}) => {
    llamadas.push({ url, metodo: op.method || 'GET', cuerpo: op.body });
    return { ok: true, status: 200, json: async () => filas };
  };
  return { conf: { url: 'https://x', clave: 'eyJ', fetch }, llamadas };
}

test('configuracionPush: necesita las tres variables', () => {
  assert.equal(configuracionPush({ VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b' }), null);
  assert.deepEqual(configuracionPush({ VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b', VAPID_SUBJECT: 'mailto:c' }),
    { publica: 'a', privada: 'b', sujeto: 'mailto:c' });
});

test('armarAviso: nombre, total y link a Pedidos web', () => {
  const a = armarAviso(pedido, guardado);
  assert.equal(a.titulo, 'Pedido nuevo');
  assert.equal(a.cuerpo, 'Ana · $450');
  assert.equal(a.url, '/admin/#/pedidos');
  assert.equal(a.tag, 'CM-2026-ABCD');
  assert.match(armarAviso({ ...pedido, modalidad: 'entrega' }, guardado).cuerpo, /con entrega$/);
});

test('armarAvisoCierre: mes, vendido contra el mes anterior, ganancia y link al cierre', () => {
  const cierre = {
    mes: '2026-10-01',
    actual: { vendido: 6790, ganancia_bruta: 4120 },
    anterior: { mes: '2026-09-01', vendido: 4565 },
  };
  const a = armarAvisoCierre(cierre);
  assert.equal(a.titulo, 'Cierre de octubre');
  assert.equal(a.cuerpo, 'Vendieron $6.790 (sube 49 % vs septiembre) · ganancia $4.120');
  assert.equal(a.url, '/admin/#/cierre/2026-10-01');
  assert.equal(a.tag, 'cierre-2026-10-01');
  // Sin mes anterior (el primero) o un mes sin ventas: sin comparación
  assert.equal(armarAvisoCierre({ mes: '2026-05-01', actual: null, anterior: null }).cuerpo, 'Vendieron $0 · ganancia $0');
});

test('mesAnterior: el mes que terminó, también en enero', () => {
  assert.equal(mesAnterior('2026-11-01'), '2026-10-01');
  assert.equal(mesAnterior('2027-01-01'), '2026-12-01');
});

test('avisarPedidoNuevo: uno por endpoint, borra los vencidos (410/404) y anota otros errores', async () => {
  const { conf, llamadas } = base([
    { id: '1', endpoint: 'https://push/a', p256dh: 'k', auth: 'a' },
    { id: '2', endpoint: 'https://push/a', p256dh: 'k', auth: 'a' }, // mismo navegador, otra cuenta
    { id: '3', endpoint: 'https://push/vieja', p256dh: 'k', auth: 'a' },
    { id: '4', endpoint: 'https://push/404', p256dh: 'k', auth: 'a' },
    { id: '5', endpoint: 'https://push/caida', p256dh: 'k', auth: 'a' },
  ]);
  const enviados = [];
  const webpush = {
    async sendNotification(sub, datos, op) {
      enviados.push(sub.endpoint);
      assert.equal(JSON.parse(datos).cuerpo, 'Ana · $450');
      assert.equal(op.vapidDetails.privateKey, 'priv');
      if (sub.endpoint.endsWith('vieja')) throw Object.assign(new Error('Gone'), { statusCode: 410 });
      if (sub.endpoint.endsWith('404')) throw Object.assign(new Error('Not Found'), { statusCode: 404 });
      if (sub.endpoint.endsWith('caida')) throw Object.assign(new Error('Server error'), { statusCode: 500 });
    },
  };
  const r = await avisarPedidoNuevo(pedido, guardado, conf, webpush, vapid);
  assert.deepEqual(r, { enviados: 1, borrados: 2, fallidos: 1 });
  assert.equal(enviados.filter((e) => e === 'https://push/a').length, 1);
  const borrados = llamadas.filter((l) => l.metodo === 'DELETE').map((l) => decodeURIComponent(l.url));
  assert.deepEqual(borrados.sort(), ['https://x/rest/v1/push_suscripciones?endpoint=eq.https://push/404',
    'https://x/rest/v1/push_suscripciones?endpoint=eq.https://push/vieja']);
  const anotado = llamadas.find((l) => l.metodo === 'PATCH');
  assert.equal(anotado.url, 'https://x/rest/v1/push_suscripciones?id=eq.5');
  assert.match(JSON.parse(anotado.cuerpo).ultimo_error, /500 Server error/);
});

test('avisarPedidoNuevo: sin VAPID o si falla Supabase, no hace nada ni tira error', async () => {
  const webpush = { sendNotification: async () => assert.fail('no tenía que mandar') };
  assert.deepEqual(await avisarPedidoNuevo(pedido, guardado, base([]).conf, webpush, null),
    { enviados: 0, borrados: 0, fallidos: 0 });
  const caida = { url: 'https://x', clave: 'eyJ', fetch: async () => ({ ok: false, status: 503 }) };
  const error = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await avisarPedidoNuevo(pedido, guardado, caida, webpush, vapid), { enviados: 0, borrados: 0, fallidos: 0 });
  } finally {
    console.error = error;
  }
});

test('avisarPedidoNuevo con la librería real: cifra y manda al endpoint', async () => {
  // web-push de verdad, con claves generadas acá y el envío interceptado (no sale nada a internet).
  const webpush = require('web-push');
  const claves = webpush.generateVAPIDKeys();
  const cliente = require('crypto').createECDH('prime256v1');
  cliente.generateKeys();
  const sub = { id: '1', endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    p256dh: cliente.getPublicKey().toString('base64url'), auth: require('crypto').randomBytes(16).toString('base64url') };
  const https = require('https');
  const original = https.request;
  let pedidoHttp;
  https.request = (op, cb) => {
    pedidoHttp = op;
    const { EventEmitter } = require('events');
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => { const res = new EventEmitter(); res.statusCode = 201; cb(res); res.emit('end'); };
    return req;
  };
  try {
    const r = await avisarPedidoNuevo(pedido, guardado, base([sub]).conf, webpush,
      { publica: claves.publicKey, privada: claves.privateKey, sujeto: 'mailto:x@y.z' });
    assert.deepEqual(r, { enviados: 1, borrados: 0, fallidos: 0 });
    assert.equal(pedidoHttp.hostname, 'fcm.googleapis.com');
    assert.equal(pedidoHttp.headers['Content-Encoding'], 'aes128gcm');
    assert.match(pedidoHttp.headers.Authorization, /^vapid t=.+, k=/);
    assert.equal(pedidoHttp.headers.Urgency, 'high');
  } finally {
    https.request = original;
  }
});
