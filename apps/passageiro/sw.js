// Shell cache-first (repeat visit < 1s); dados /live sempre via rede,
// com fallback ao último cache quando offline (RF-P10).
const CACHE = 'bi-passageiro-v1';
const SHELL = ['index.html', 'app.js', 'api.js', 'map.js', 'manifest.webmanifest',
  'icon.svg', 'vendor/leaflet.js', 'vendor/leaflet.css'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.includes('/live/')) {
    // network-first com fallback de cache (dados marcados como desatualizados pela UI)
    e.respondWith(
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request)),
    );
    return;
  }
  if (url.origin === location.origin || url.hostname.includes('openstreetmap')) {
    e.respondWith(
      caches.match(e.request, { ignoreSearch: url.origin === location.origin })
        .then(hit => hit ?? fetch(e.request).then((res) => {
          if (url.hostname.includes('openstreetmap')) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
          }
          return res;
        })),
    );
  }
});
