// Service worker mínimo: solo hace que la app sea instalable. No guarda nada offline
// (la primera versión no tiene soporte offline); todo va directo a la red.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
