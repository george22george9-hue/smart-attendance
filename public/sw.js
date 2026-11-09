const CACHE_NAME = 'smart-attendance-v7.5';

const CORE_ASSETS = [
  './',
  './index.html',
  './css/style.css?v=7.5',
  './js/app.js?v=7.5',
  './js/db.js?v=7.5',
  './js/sync.js?v=7.5',
  './js/qr-scanner.js?v=7.5',
  './js/excel.js?v=7.5',
  './js/firebase-app.js?v=7.5',
  './libs/html5-qrcode.min.js?v=7.5',
  './libs/qrcode.js?v=7.5',
  './libs/xlsx.full.min.js?v=7.5',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png'
];

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

  // 3. For navigation requests (opening pages), network-first with offline fallback to cached index.html
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
          const cachedIndex = (await caches.match('./index.html')) || (await caches.match('./'));
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

  // 4. Cache First with background refresh for static assets (CSS, JS, Fonts, Images)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Background revalidation
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {});
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return networkResponse;
      }).catch(async () => {
        // Safe fallback - avoid returning undefined to prevent TypeError
        return new Response('Resource unavailable offline', {
          status: 404,
          statusText: 'Not Found',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      });
    })
  );
});
