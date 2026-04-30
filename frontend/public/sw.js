// Clubify Scanner — service worker
// Estrategia:
//   - precache de shell mínima
//   - network-first para navegaciones (HTML); fallback a cache si offline
//   - cache-first para assets estáticos (íconos, fuentes)
//   - bypass total para /api/* y /m|/i|/o (datos en vivo)

const VERSION = 'v1';
const SHELL_CACHE = `clubify-shell-${VERSION}`;
const ASSET_CACHE = `clubify-assets-${VERSION}`;

const SHELL = [
  '/scan',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) =>
      Promise.allSettled(SHELL.map((url) => c.add(url))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => ![SHELL_CACHE, ASSET_CACHE].includes(k))
          .map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Mismo origen únicamente
  if (url.origin !== self.location.origin) return;

  // Bypass para datos vivos
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/m/') ||
    url.pathname.startsWith('/i/') ||
    url.pathname.startsWith('/o/') ||
    url.pathname.startsWith('/admin/') ||
    url.pathname.startsWith('/_next/data/')
  ) {
    return;
  }

  // Navegaciones HTML → network-first
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/scan'))),
    );
    return;
  }

  // Assets estáticos → cache-first
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/fonts/') ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/apple-touch-icon.png' ||
    url.pathname === '/favicon.png'
  ) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(ASSET_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        });
      }),
    );
  }
});
