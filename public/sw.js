const CACHE_NAME = 'smart-attendance-v1.3.2';

const CORE_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './css/style.css?v=1.3.2',
  './js/app.js',
  './js/app.js?v=1.3.2',
  './js/db.js',
  './js/db.js?v=1.3.2',
  './js/sync.js',
  './js/sync.js?v=1.3.2',
  './js/qr-scanner.js',
  './js/qr-scanner.js?v=1.3.2',
  './js/excel.js',
  './js/excel.js?v=1.3.2',
  './js/env.js',
  './js/firebase-app.js',
  './js/firebase-app.js?v=1.3.2',
  './libs/firebase-app-compat.js',
  './libs/firebase-app-compat.js?v=1.3.2',
  './libs/firebase-firestore-compat.js',
  './libs/firebase-firestore-compat.js?v=1.3.2',
  './libs/html5-qrcode.min.js',
  './libs/html5-qrcode.min.js?v=1.3.2',
  './libs/qrcode.js',
  './libs/qrcode.js?v=1.3.2',
  './libs/xlsx.full.min.js',
  './libs/xlsx.full.min.js?v=1.3.2',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png',
  './icons/logo.jpg'
];

self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Precache each asset individually so one 404 does not fail the entire installation
      await Promise.allSettled(
        CORE_ASSETS.map((asset) =>
          cache.add(asset).catch((err) => {
            console.warn(`[SW] Could not precache: ${asset}`, err.message);
          })
        )
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[SW] Deleting obsolete cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // 1. NEVER cache /api/ calls (sensitive student data, auth, live sync)
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // 2. Skip firestore live sync streams
  if (url.origin.includes('firestore.googleapis.com')) {
    return;
  }

  // 3. Optional fallback for any residual CDN requests to firebase
  if (url.origin.includes('gstatic.com') && url.pathname.includes('firebase')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((resp) => {
          if (resp && resp.status === 200) {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return resp;
        }).catch(() => {
          return new Response('// Firebase offline placeholder', {
            status: 200,
            headers: { 'Content-Type': 'application/javascript' }
          });
        });
      })
    );
    return;
  }

  // 4. For navigation requests (opening pages), network-first with offline fallback to cached index.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cachedIndex = (await caches.match('./index.html')) || 
                              (await caches.match('./')) || 
                              (await caches.match('/index.html')) || 
                              (await caches.match(event.request, { ignoreSearch: true }));
          if (cachedIndex) return cachedIndex;
          return new Response('Offline - التطبيق غير متصل بالإنترنت حالياً', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        })
    );
    return;
  }

  // 5. Static Assets: Instant response when offline, with smooth cache update when online
  event.respondWith(
    caches.match(event.request).then((cached) => {
      // If client is offline and we have a cached version, serve it instantly
      if (!navigator.onLine && cached) {
        return cached;
      }

      // Try network first, falling back to cache
      return fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(async () => {
          if (cached) return cached;
          const matchWithNoSearch = await caches.match(event.request, { ignoreSearch: true });
          if (matchWithNoSearch) return matchWithNoSearch;
          const matchPath = await caches.match(url.pathname, { ignoreSearch: true });
          if (matchPath) return matchPath;
          const matchDotPath = await caches.match('.' + url.pathname, { ignoreSearch: true });
          if (matchDotPath) return matchDotPath;
          return new Response('Resource unavailable offline', {
            status: 404,
            statusText: 'Not Found',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });
    })
  );
});
