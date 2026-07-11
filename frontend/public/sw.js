// Clubify Scanner — service worker
// Estrategia:
//   - precache de shell mínima
//   - network-first para navegaciones (HTML); fallback a cache si offline
//   - cache-first para assets estáticos (íconos, fuentes)
//   - bypass total para /api/* y /m|/i|/o (datos en vivo)

// Bumpear esta versión cuando un deploy contenga cambios visuales/lógicos
// importantes que necesitan invalidar TODA la cache de los clientes.
// Cada vez que cambia, el SW activate purga las caches viejas y los clientes
// vuelven a descargar todo fresh.
const VERSION = 'v30-2026-07-11-service-reservations-bugfixes';
const SHELL_CACHE = `clubify-shell-${VERSION}`;
const ASSET_CACHE = `clubify-assets-${VERSION}`;

const SHELL = [
  '/scan',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/apple-touch-icon.png',
  '/favicon.ico',
  '/favicon-16.png',
  '/favicon-32.png',
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
    (async () => {
      // Purge caches viejas
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => ![SHELL_CACHE, ASSET_CACHE].includes(k))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
      // Forzar reload de TABs abiertas para que vean los assets nuevos.
      // CRÍTICO (M8 2026-06-05): NO navegar tabs que están en páginas
      // transaccionales (/c/, /r/, /q/, /signup) — el cliente está
      // llenando un form y reloadear le pierde el input. Esas tabs
      // recibirán el SW nuevo en su próxima visita.
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of allClients) {
        try {
          if (!client.url || !client.url.startsWith('http')) continue;
          if (!('navigate' in client)) continue;
          const pn = new URL(client.url).pathname;
          if (
            pn.startsWith('/c/') ||
            pn.startsWith('/r/') ||
            pn.startsWith('/q/') ||
            pn.startsWith('/cita/') ||
            pn.startsWith('/signup') ||
            pn.startsWith('/prueba') ||
            pn.startsWith('/trial')
          ) {
            continue;
          }
          await client.navigate(client.url);
        } catch {
          /* noop — algunas plataformas restringen navigate */
        }
      }
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Mismo origen únicamente
  if (url.origin !== self.location.origin) return;

  // Bypass para datos vivos y páginas transaccionales (donde queremos
  // siempre red fresh — no se cachea HTML que el cliente está
  // completando como formulario). M8 2026-06-05 agrega /c/, /r/, /q/,
  // /signup, /prueba, /trial al bypass.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/m/') ||
    url.pathname.startsWith('/i/') ||
    url.pathname.startsWith('/o/') ||
    url.pathname.startsWith('/c/') ||
    url.pathname.startsWith('/r/') ||
    url.pathname.startsWith('/q/') ||
    url.pathname.startsWith('/cita/') ||
    url.pathname.startsWith('/signup') ||
    url.pathname.startsWith('/prueba') ||
    url.pathname.startsWith('/trial') ||
    url.pathname.startsWith('/admin/') ||
    // v16 2026-07-07: las páginas de la app (login + paneles) SIEMPRE frescas
    // desde red. Sin esto, /login era network-first CON fallback a caché: tras
    // un deploy, el HTML viejo cacheado referenciaba chunks /_next/static con
    // hash muerto (404) → React no hidrataba → el input de correo quedaba
    // "congelado" (SSR sin JS). /admin/ ya estaba excluido; faltaban el resto.
    url.pathname === '/login' ||
    url.pathname.startsWith('/login/') ||
    url.pathname === '/app' ||
    url.pathname.startsWith('/app/') ||
    url.pathname === '/affiliate' ||
    url.pathname.startsWith('/affiliate/') ||
    url.pathname === '/domicilios' ||
    url.pathname.startsWith('/domicilios/') ||
    url.pathname === '/superadmin' ||
    url.pathname.startsWith('/superadmin/') ||
    url.pathname === '/forgot' ||
    url.pathname.startsWith('/forgot/') ||
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
    url.pathname === '/favicon.png' ||
    url.pathname === '/favicon.ico' ||
    url.pathname === '/favicon-16.png' ||
    url.pathname === '/favicon-32.png' ||
    url.pathname === '/favicon-48.png' ||
    url.pathname === '/favicon-96.png' ||
    url.pathname === '/og-image.png'
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
