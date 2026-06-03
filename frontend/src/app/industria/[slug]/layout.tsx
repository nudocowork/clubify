import type { Metadata } from 'next';

const API =
  process.env.BACKEND_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4949';

const SITE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? 'https://soyclubify.com';

/**
 * Metadata server-side por industria — preview rico al compartir el link
 * en WhatsApp/IG/Facebook. Re-validamos cada 5 min para no martirizar el
 * backend si la página se hace viral.
 */
export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const fallback: Metadata = {
    title: 'Industria · Clubify',
    description:
      'Demo del sistema Clubify para tu rubro: fidelización, menú digital y pedidos a WhatsApp.',
  };
  try {
    const res = await fetch(
      `${API}/api/public/industries/${params.slug}`,
      { next: { revalidate: 300 } },
    );
    if (!res.ok) return fallback;
    const i = await res.json();
    const title = `${i.emoji ? `${i.emoji} ` : ''}${i.name} · Clubify`;
    const description =
      i.description ||
      `Mira cómo Clubify funciona para ${i.name}: fidelización wallet, menú digital y pedidos a WhatsApp.`;
    const image =
      i.coverImage || i.iconUrl || `${SITE_URL}/og-image.png`;
    const url = `${SITE_URL}/industria/${i.slug}`;
    return {
      title,
      description,
      openGraph: {
        title,
        description,
        url,
        siteName: 'Clubify',
        images: [
          {
            url: image,
            width: 1200,
            height: 630,
            alt: i.name,
          },
        ],
        locale: 'es_CO',
        type: 'website',
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [image],
      },
      themeColor: i.themeColor || '#22C55E',
      alternates: { canonical: url },
    };
  } catch {
    return fallback;
  }
}

export default function IndustryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
