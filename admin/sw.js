// Service worker: instala la app y muestra los avisos push de pedidos nuevos (fase 2 · 2.1).
// Chrome ya no exige un manejador de "fetch" para instalar la app, y uno vacío solo agrega demora a
// cada pedido, así que no hay. La app no funciona sin conexión.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// El aviso lo arma api/_lib/push.js: { titulo, cuerpo, url, tag }.
self.addEventListener('push', (e) => {
  let aviso = {};
  try { aviso = e.data ? e.data.json() : {}; } catch { aviso = { cuerpo: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(aviso.titulo || 'Cinniminies', {
    body: aviso.cuerpo || 'Hay novedades en Pedidos web',
    icon: 'icons/icono-192.png',
    tag: aviso.tag,
    data: { url: aviso.url || '/admin/#/pedidos' },
  }));
});

// Al tocar el aviso: si la app ya está abierta, la trae al frente en Pedidos web; si no, la abre.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/admin/#/pedidos', self.location.origin).href;
  e.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = abiertas.find((c) => c.url.startsWith(self.registration.scope));
    if (app) {
      await app.focus();
      return app.navigate(url).catch(() => {});
    }
    return self.clients.openWindow(url);
  })());
});
