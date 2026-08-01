const CACHE_VERSION = '__BUILD_TIMESTAMP__';
const CACHE_NAME = 'vidhence-cache-' + CACHE_VERSION;
const urlsToCache = /* CACHE_URLS_PLACEHOLDER */;

// ── INSTALL: cache all app shell assets ──────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing, cache:', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // addAll fails if ANY url fails — use individual adds so one bad asset
        // doesn't break the whole cache
        return Promise.allSettled(
          urlsToCache.map(url =>
            cache.add(url).catch(err => {
              console.warn('[SW] Failed to cache:', url, err);
            })
          )
        );
      })
      .then(() => {
        console.log('[SW] Install complete');
        // Activate immediately without waiting for old SW to die
        return self.skipWaiting();
      })
  );
});

// ── ACTIVATE: delete old caches ──────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter(name => name.startsWith('vidhence-cache-') && name !== CACHE_NAME)
            .map(name => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Taking control of clients');
        return self.clients.claim();
      })
  );
});

// ── FETCH: cache-first with network fallback ─────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests — skip POST/PUT/DELETE (API calls etc.)
  if (request.method !== 'GET') return;

  // Skip cross-origin requests except for known CDNs
  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  if (!isSameOrigin) return;

  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          // Serve from cache, but also refresh cache in background
          const fetchPromise = fetch(request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                const responseClone = networkResponse.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
              }
              return networkResponse;
            })
            .catch(() => {/* background refresh failed, that's ok */});

          return cachedResponse; // Return cached immediately
        }

        // Not in cache — try network
        return fetch(request)
          .then((networkResponse) => {
            if (!networkResponse || networkResponse.status !== 200) {
              return networkResponse;
            }
            // Cache the new response
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
            return networkResponse;
          })
          .catch(() => {
            // Network failed and not in cache
            // For navigation requests (page loads), return cached index.html
            if (request.mode === 'navigate') {
              console.log('[SW] Offline - serving cached index.html');
              return caches.match('/index.html');
            }
            // For other assets, just fail silently
            return new Response('', { status: 408, statusText: 'Offline' });
          });
      })
  );
});
