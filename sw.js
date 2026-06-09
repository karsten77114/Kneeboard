const CACHE = 'kneeboard-v57';
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
  './js/views/notice-board.js',
  './js/views/flightcrew.js',
  './js/views/fc-briefing.js',
  './js/views/fc-elb.js',
  './js/views/fc-weather.js',
  './js/views/fc-notam.js',
  './js/views/fc-gate.js',
  './js/views/roster.js',
  './js/views/pa.js',
  './js/views/tools.js',
  './assets/airports.json',
  './manifest.json',
];

// ── Dev mode：localhost / 127.0.0.1 完全不快取 ──────────────────
const IS_DEV = self.location.hostname === 'localhost'
            || self.location.hostname === '127.0.0.1';

self.addEventListener('install', e => {
  console.log(`[SW] Installing ${CACHE}${IS_DEV ? ' (DEV — no cache)' : ''}...`);
  if (IS_DEV) {
    self.skipWaiting();
    return;
  }
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  console.log(`[SW] Activating ${CACHE}...`);
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim()).then(() => {
      // 新版 SW 接管後，通知所有開啟的頁面重新整理
      return self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(client => client.postMessage({ type: 'SW_UPDATED', version: CACHE }));
      });
    })
  );
});

self.addEventListener('fetch', e => {
  // Dev mode：所有請求走 network，不經 cache
  if (IS_DEV) {
    e.respondWith(fetch(e.request));
    return;
  }

  const url = new URL(e.request.url);

  // Always network-first for API calls
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

  // Stale-while-revalidate：先回傳快取（快），同時背景更新快取（保持最新）
  // 下次開啟頁面就是新版，並透過 SW_UPDATED 訊息提示使用者
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        const fetchPromise = fetch(e.request).then(response => {
          if (response.ok && e.request.method === 'GET') {
            cache.put(e.request, response.clone());
          }
          return response;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    )
  );
});
