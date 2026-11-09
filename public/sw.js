const CACHE_NAME = 'smart-attendance-v7.2';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/style.css?v=7.2',
  './js/app.js?v=7.2',
  './js/db.js?v=7.2',
  './js/sync.js?v=7.2',
  './js/qr-scanner.js?v=7.2',
  './js/excel.js?v=7.2',
  './js/firebase-app.js?v=7.2',
  './libs/html5-qrcode.min.js?v=7.2',
  './libs/qrcode.js?v=7.2',
  './libs/xlsx.full.min.js?v=7.2',
  './manifest.json?v=7.2',
  './icons/icon.svg',
  './icons/icon-192.png?v=7.2',
  './icons/icon-512.png?v=7.2',
  './icons/icon-maskable-192.png?v=7.2',
  './icons/icon-maskable-512.png?v=7.2',
  './icons/apple-touch-icon.png?v=7.2',
  './icons/favicon.png?v=7.2'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW v5] Pre-caching all assets');
      return cache.addAll(ASSETS_TO_CACHE);
    }).catch(err => {
      console.warn('[SW v5] Cache warning:', err);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[SW v5] Deleting old obsolete cache:', cache);
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

  // Skip firestore and external googleapis from SW cache
  if (url.origin.includes('firestore.googleapis.com') || url.origin.includes('gstatic.com')) {
    return;
  }

  // Network First with Offline Fallback
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Fallback to cache when offline
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html') || caches.match('./');
          }
        });
      })
  );
});
