import type { MetadataRoute } from 'next';

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://soyclubify.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/signup', '/login', '/legal/', '/m/'],
        disallow: [
          '/app/', // panel de tenant — privado
          '/admin/', // panel super admin — privado
          '/o/', // tracking de pedidos — privado
          '/w/', // tarjetas wallet — privado por usuario
          '/onboarding',
          '/scan',
          '/preview/', // mockups internos
          '/api/',
        ],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
