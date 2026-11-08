const CACHE_NAME = 'smart-attendance-v5';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/style.css?v=5.0',
  './js/app.js?v=5.0',
  './js/db.js?v=5.0',
  './js/sync.js?v=5.0',
  './js/qr-scanner.js?v=5.0',
  './js/excel.js?v=5.0',
  './js/firebase-app.js?v=5.0',
  './libs/html5-qrcode.min.js?v=5.0',
  './libs/qrcode.js?v=5.0',
  './libs/xlsx.full.min.js?v=5.0',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
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
