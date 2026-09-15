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
const VERSION = 'v58-2026-09-15-sin-cachear-errores';
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

      // AQUÍ NO SE NAVEGA A NADIE. Hubo un bucle que hacía
      // `await client.navigate(client.url)` sobre cada pestaña abierta para
      // que vieran los assets nuevos, y era un bloqueo mutuo:
      //
      //   · `client.navigate()` no resuelve hasta que TERMINA la navegación.
      //   · El evento `fetch` de esa navegación no se despacha hasta que el
      //     worker acabe de activarse.
      //   · Activarse es justo lo que está esperando a `navigate()`.
      //
      // Resultado, la PRIMERA visita de cualquier cliente nuevo: Chrome y
      // Firefox se quedaban con la pestaña cargando indefinidamente; WebKit
      // cancelaba las peticiones en vuelo y el menú pintaba «Negocio no
      // disponible». Recargando funcionaba, y por eso nunca lo vimos desde
      // dentro: al que ya había entrado una vez no le pasa. Lo mismo ocurría
      // en la primera visita después de cada despliegue que cambie VERSION.
      //
      // No hace falta nada a cambio: `clients.claim()` dispara
      // `controllerchange` y `PWARegister` ya recarga ahí —y solo cuando ya
      // había un worker antes, para no recargarle la página al cliente que
      // está tecleando en un formulario—.
    })(),
  );
});

/**
 * Lo que se ve si no hay red y no hay nada bueno guardado.
 *
 * Se reintenta SOLA: al volver la red (`online`) y probando cada 15 s. En un
 * kiosco sin barra de direcciones ni F5 —el escáner en Electron— una pantalla
 * que no se recarga es una avería hasta reiniciar la app, justo el síntoma que
 * se quería quitar (Fable, 2026-09-15). Sin nombre de marca: la ve el cliente
 * de cualquier marca blanca.
 */
const SIN_CONEXION = '<!doctype html><html lang="es"><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Sin conexión</title>' +
  '<body style="margin:0;display:grid;place-items:center;min-height:100vh;font:16px system-ui,sans-serif;color:#111">' +
  '<div style="text-align:center;padding:24px;max-width:22rem">' +
  '<p style="font-size:2rem;margin:0 0 .5rem">📶</p>' +
  '<p style="font-weight:600;margin:0 0 .25rem">Sin conexión</p>' +
  '<p style="margin:0 0 1rem;color:#666">Revisa el internet. Esta pantalla vuelve sola en cuanto haya conexión.</p>' +
  '<button onclick="location.reload()" style="font:inherit;padding:.6rem 1.2rem;border-radius:.6rem;border:1px solid #ccc;background:#fff;cursor:pointer">Reintentar</button>' +
  '</div>' +
  '<script>' +
  'addEventListener("online",function(){location.reload()});' +
  'setInterval(function(){fetch(location.href,{method:"HEAD",cache:"no-store"}).then(function(r){if(r.ok)location.reload()}).catch(function(){})},15000);' +
  '</script></body></html>';

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
    // `/d/` es el MISMO menú que `/m/`, en modo domicilio, y se le había
    // quedado fuera: es la página por la que entran los pedidos. Cacheada,
    // después de un despliegue servía un HTML viejo que apunta a chunks que
    // ya no existen. `/w/` es la tarjeta del cliente y también es dato vivo.
    url.pathname.startsWith('/d/') ||
    url.pathname.startsWith('/w/') ||
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
    url.pathname.startsWith('/_next/data/') ||
    // Igual que /login (v16): el lanzador y las páginas con token en la URL
    // no pueden servirse desde una copia vieja que apunta a chunks muertos,
    // ni dejar ese token guardado en la cache (Fable, 2026-09-15).
    url.pathname === '/hub' ||
    url.pathname.startsWith('/hub/') ||
    url.pathname.startsWith('/onboarding') ||
    url.pathname.startsWith('/activar') ||
    url.pathname.startsWith('/entrar') ||
    url.pathname.startsWith('/reset')
  ) {
    return;
  }

  // Navegaciones HTML → network-first
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // SOLO SE GUARDA LO QUE SALIÓ BIEN.
          //
          // Antes se guardaba la respuesta fuera cual fuera. Un 403 del borde
          // —Vercel mitigando una IP, un portal cautivo del wifi, el router de
          // una casa— se quedaba cacheado como la pantalla de arranque de
          // `/scan`, y a partir de ahí CADA arranque sin red servía esa
          // pantalla de «esta solicitud fue bloqueada» aunque el servidor ya
          // contestara bien. Convertía un corte de un minuto en una avería
          // permanente en esa máquina: le pasó a Wok Explosivo, que con los
          // datos del teléfono entraba y con su wifi no (2026-09-15).
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => {
          // Al caer a la cache tampoco se sirve un error guardado, ni una
          // respuesta redirigida: a una navegación el navegador la rechaza y
          // el respaldo se convertiría en una pantalla de error.
          const sirve = (r) => r && r.ok && !r.redirected;
          const guardada = await caches.match(req);
          if (sirve(guardada)) return guardada;
          // La pantalla del escáner es respaldo SOLO del escáner: antes, un
          // cliente que abría su tarjeta o una alianza sin red recibía el login
          // del personal (Fable, 2026-09-15).
          if (url.pathname.startsWith('/scan')) {
            const shell = await caches.match('/scan');
            if (sirve(shell)) return shell;
          }
          return new Response(SIN_CONEXION, {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }),
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
