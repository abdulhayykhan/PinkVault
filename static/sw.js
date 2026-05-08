// Service Worker for PinkVault Chat PWA
const CACHE_NAME = 'pinkvault-v1';
const URLS_TO_CACHE = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/manifest.json',
    '/logo.png'
];

// Install event: Cache essential files
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                return cache.addAll(URLS_TO_CACHE);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate event: Clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== CACHE_NAME) {
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => self.clients.claim())
    );
});

// Fetch event: Cache-first strategy
self.addEventListener('fetch', event => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Return cached response if available
                if (response) {
                    return response;
                }

                // Otherwise, fetch from network
                return fetch(event.request)
                    .then(response => {
                        // Don't cache if the response is not successful
                        if (!response || response.status !== 200 || response.type === 'error') {
                            return response;
                        }

                        // Clone the response for caching
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME)
                            .then(cache => {
                                cache.put(event.request, responseToCache);
                            });

                        return response;
                    })
                    .catch(() => {
                        // Return offline page or fallback if needed
                        return caches.match('/index.html');
                    });
            })
    );
});
