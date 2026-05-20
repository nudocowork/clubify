import type { Metadata } from 'next';

const SITE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? 'https://soyclubify.com';

export const metadata: Metadata = {
  title: 'Clubify por industria · Demos por rubro',
  description:
    'Mirá una demo de 60 segundos del sistema Clubify específica para tu rubro: fidelización, menú digital, pedidos a WhatsApp y automatizaciones.',
  openGraph: {
    title: 'Clubify por industria',
    description:
      'Demos por rubro: cafeterías, restaurantes, barberías, gimnasios, autolavados y más.',
    url: `${SITE_URL}/industrias`,
    siteName: 'Clubify',
    images: [
      {
        url: `${SITE_URL}/og-image.png`,
        width: 1200,
        height: 630,
        alt: 'Clubify — el sistema todo en uno para tu negocio',
      },
    ],
    locale: 'es_CO',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Clubify por industria',
    description:
      'Demos por rubro: cafeterías, restaurantes, barberías, gimnasios, autolavados y más.',
    images: [`${SITE_URL}/og-image.png`],
  },
  alternates: { canonical: `${SITE_URL}/industrias` },
};

export default function IndustriasLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
