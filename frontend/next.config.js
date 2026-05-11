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
module.exports = nextConfig;
