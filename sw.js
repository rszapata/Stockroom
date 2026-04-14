const CACHE_NAME = 'stockroom-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/analytics.html',
  '/cobros.html',
  '/publicaciones.html',
  '/migracion.html',
  '/mobile.css',
  '/mobile.js',
  '/chart.umd.min.js',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

const API_PATH_PREFIXES = [
  '/api', '/api-as', '/api-public',
  '/orders', '/cobro', '/ventas', '/flex', '/accounts',
  '/oauth', '/config', '/shipments', '/upload', '/login', '/logout',
];

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Solo manejamos http(s) del mismo origen — ignorar chrome-extension://, data:, etc.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.origin !== self.location.origin) return;

  // API calls y métodos no-GET: red directa, no cachear
  if (event.request.method !== 'GET' || API_PATH_PREFIXES.some(p => url.pathname.startsWith(p))) {
    return;
  }

  // Static assets: network first, fallback to cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Solo cachear respuestas válidas (200) del mismo origen
        if (response && response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, clone).catch(() => {});
          });
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
