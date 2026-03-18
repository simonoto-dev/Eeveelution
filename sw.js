// ============================================
// SERVICE WORKER — The Familiar (Eeveelution)
// Offline-first PWA caching strategy
// ============================================

const CACHE_NAME = 'familiar-v2026-03-18b';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles2.css',
  '/manifest.json',
  '/bones-1.png',
  '/bones-2.png',
  '/bones-3.png',
  '/bones-4.png',
  '/simon-avatar.png',
  '/icon-192.png',
  '/icon-512.png',
];

const CDN_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600;700&display=swap',
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log('[SW] Removing old cache:', key);
            return caches.delete(key);
          })
      );
    })
  );
  self.clients.claim();
});

// Push notification handler
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const notif = data.notification || data;
  event.waitUntil(
    self.registration.showNotification(notif.title || 'Team Simonoto', {
      body: notif.body || '',
      icon: '/bones-3.png',
      badge: '/icon-192.png',
      data: data,
    })
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('https://eeveelution.professoroffunk.com')
  );
});

// Fetch: network-first for HTML/API, cache-first for assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip WebSocket requests and non-GET
  if (event.request.method !== 'GET') return;
  if (url.protocol === 'wss:' || url.protocol === 'ws:') return;

  // Skip Firebase and API calls — always go to network
  if (url.hostname.includes('firebasestorage') ||
      url.hostname.includes('firebaseio') ||
      url.hostname.includes('googleapis.com') && url.pathname.includes('/v1/') ||
      url.hostname === 'bones.professoroffunk.com' ||
      url.hostname === 'brain.professoroffunk.com') {
    return;
  }

  // For same-origin HTML — network first, fallback to cache
  if (url.origin === self.location.origin && (url.pathname === '/' || url.pathname.endsWith('.html'))) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // For static assets — cache first, fallback to network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Cache successful responses for known asset types
        if (response.ok && (
          url.pathname.endsWith('.css') ||
          url.pathname.endsWith('.png') ||
          url.pathname.endsWith('.jpg') ||
          url.pathname.endsWith('.js') ||
          url.hostname.includes('fonts.googleapis.com') ||
          url.hostname.includes('fonts.gstatic.com') ||
          url.hostname.includes('cdn.jsdelivr.net')
        )) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback for images
        if (event.request.destination === 'image') {
          return new Response('', { status: 404 });
        }
      });
    })
  );
});
