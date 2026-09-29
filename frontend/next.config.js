const { withSentryConfig } = require('@sentry/nextjs');
const createNextIntlPlugin = require('next-intl/plugin');
const { sentryActivo } = require('./src/lib/sentry-activo.cjs');

// Apunta al request config en src/i18n/request.ts — provee el locale
// detectado (cookie/header/IP) y las messages al SSR.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * El hostname de una URL, o null si no se puede leer. Existe para no meter un
 * comodín en `remotePatterns`: de una variable mal puesta se prefiere no
 * permitir nada a permitir un dominio entero.
 */
function hostDe(url) {
  if (!url) return null;
  try {
    const h = new URL(url).hostname;
    return h || null;
  } catch {
    return null;
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/:path*`,
      },
    ];
  },
  // next/image necesita whitelist de hosts remotos. Sin esto,
  // <Image src="https://pub-xxx.r2.dev/..." /> tira error.
  //
  // Van los hosts EXACTOS, nunca `**.r2.dev`: ese es un dominio COMPARTIDO de
  // Cloudflare — todo bucket público de R2 del mundo es un `pub-<hash>.r2.dev`.
  // Con el comodín, cualquiera con un bucket ahí podía hacer que nuestro
  // optimizador le sirviera sus imágenes desde app.soyclubify.com: le
  // regalábamos ancho de banda (la API de imágenes de Next tiene DoS conocido,
  // GHSA-h64f-5h5j-jqjh) y nuestro dominio para alojar lo que quisiera. Igual
  // `**.r2.cloudflarestorage.com`, que es el dominio compartido de la API.
  //
  // Al cambiar de bucket hay que añadir el host nuevo acá, o las imágenes
  // dejarán de cargar. Es a propósito: una lista de permitidos que acepta
  // cualquier cosa no es una lista de permitidos.
  images: {
    remotePatterns: [
      // El bucket público de producción (S3_PUBLIC_URL del backend).
      { protocol: 'https', hostname: 'pub-6de3a37544604346a69b9836aed1c6cf.r2.dev' },
      // El endpoint de la cuenta R2, host exacto. Va por si quedan URLs
      // guardadas de antes de que existiera S3_PUBLIC_URL: media.service.ts
      // cae a `${endpoint}/${bucket}` cuando esa variable falta, así que una
      // imagen vieja puede apuntar acá. Quitarlo sin comprobar la base rompería
      // esas imágenes, y con un comodín valdría cualquier cuenta de R2.
      { protocol: 'https', hostname: '5e5288c7d32815944510f3a01aa82614.r2.cloudflarestorage.com' },
      // Si hay CDN propio configurado, su host exacto — no un comodín.
      ...(hostDe(process.env.NEXT_PUBLIC_S3_PUBLIC_URL)
        ? [{ protocol: 'https', hostname: hostDe(process.env.NEXT_PUBLIC_S3_PUBLIC_URL) }]
        : []),
      { protocol: 'https', hostname: 'cdn.soyclubify.com' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' }, // Google profile
      { protocol: 'https', hostname: 'static-media.hotmart.com' },
      // Bucket público del Onboarding (Supabase): fotos de menú/branding
      // sincronizadas. Restringido al path público de storage.
      {
        protocol: 'https',
        hostname: 'ugbqfcogmqkuhhepecfq.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      { protocol: 'http', hostname: 'localhost' }, // dev MinIO
    ],
    // 1 año de cache CDN para imágenes optimizadas — los IDs son únicos
    // (nanoid en MediaService), así que el cache es safe.
    minimumCacheTTL: 31_536_000,
  },
  // react-konva (QrPosterEditor) intenta resolver 'canvas' (binding nativo
  // de Node). Es client-only via dynamic import, pero webpack igual lo
  // escanea. Marcar como external evita el module-not-found.
  webpack: (config) => {
    config.externals = [...(config.externals || []), { canvas: 'canvas' }];
    return config;
  },
};

// withSentryConfig: source maps + tunneling + auto-instrumentación.
// Sin SENTRY_AUTH_TOKEN configurado en CI, simplemente skipea el upload de
// sourcemaps pero los errores siguen siendo reportados (con stack
// minificado). Cuando se quiera trazabilidad full, setear el token.
const sentryConfig = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.SENTRY_AUTH_TOKEN,
  // Túnel para evadir ad-blockers que rompen el endpoint público de Sentry.
  tunnelRoute: '/monitoring',
  // No subir sourcemaps si falta el token (evita warnings ruidosos en CI).
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
  // Sentry ya hace tree-shake; nuestras configs son condicionales por env.
  disableLogger: true,
};

// Solo con DSN. `withSentryConfig` inyecta `sentry.client.config.ts` en TODAS
// las páginas, y aunque sin DSN no inicializa nada, el SDK y Replay viajaban
// igual al navegador: en producción no había DSN y cada página cargaba 119 KB
// de Replay para nada (medido el 2026-09-17). Con DSN, todo como antes. Ver
// src/lib/sentry-activo.cjs y scripts/pruebas-sentry-sin-dsn.mjs.
module.exports = sentryActivo(process.env)
  ? withSentryConfig(withNextIntl(nextConfig), sentryConfig)
  : withNextIntl(nextConfig);
