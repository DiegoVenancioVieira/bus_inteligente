// Service worker: cacheia o shell do app (funciona offline; a fila IndexedDB
// segura as posições até a rede voltar).
const CACHE = 'bi-motorista-v1';
const SHELL = ['index.html', 'app.js', 'api.js', 'gps.js', 'queue.js', 'manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // API sempre via rede; shell cache-first
  if (url.pathname.includes('/ingest/') || url.pathname.includes('/dx/') || url.pathname.includes('/live/')) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => hit ?? fetch(e.request)),
  );
});
