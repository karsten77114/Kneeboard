const CACHE = 'kneeboard-v17';
const PRECACHE = [
  './',
  './index.html',
  './css/base.css',
  './css/layout.css',
  './js/app.js',
  './js/store.js',
  './js/utils.js',
  './js/services/api.js',
  './js/services/storage.js',
  './js/views/home.js',
  './js/views/flightcrew.js',
  './js/views/fc-briefing.js',
  './js/views/fc-elb.js',
  './js/views/fc-weather.js',
  './js/views/fc-notam.js',
  './js/views/fc-gate.js',
  './js/views/pa.js',
  './js/views/tools.js',
  './assets/airports.json',
  './manifest.json',
];

self.addEventListener('install', e => {
  console.log('[SW] Installing v17...');
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  console.log('[SW] Activating v17...');
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always network-first for Cloudflare Worker API calls
  if (url.hostname.endsWith('.workers.dev') || url.hostname.includes('unpkg.com')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        caches.match(e.request).then(r => r || new Response('{"error":"offline"}', {
          headers: { 'Content-Type': 'application/json' }
        }))
      )
    );
    return;
  }

  // Cache-first for app shell
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (resp.ok && e.request.method === 'GET') {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      });
    })
  );
});
