// Service worker mínimo. Chrome ya no exige un manejador de "fetch" para instalar la app, y uno
// vacío solo agrega demora a cada pedido, así que no hay. La app no funciona sin conexión.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
