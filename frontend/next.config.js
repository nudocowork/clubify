const { withSentryConfig } = require('@sentry/nextjs');

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

module.exports = withSentryConfig(nextConfig, sentryConfig);
