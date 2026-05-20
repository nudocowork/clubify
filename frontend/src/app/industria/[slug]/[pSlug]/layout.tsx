import type { Metadata } from 'next';

const API =
  process.env.BACKEND_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4949';

const SITE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? 'https://soyclubify.com';

/**
 * Metadata server-side por presentation — preview rico al compartir el
 * deck en redes. Re-validamos cada 5 min.
 */
export async function generateMetadata({
  params,
}: {
  params: { slug: string; pSlug: string };
}): Promise<Metadata> {
  const fallback: Metadata = {
    title: 'Presentación · Clubify',
    description: 'Mirá la demo del sistema Clubify.',
  };
  try {
    const res = await fetch(
      `${API}/api/public/presentations/${params.slug}/${params.pSlug}`,
      { next: { revalidate: 300 } },
    );
    if (!res.ok) return fallback;
    const p = await res.json();
    const title = `${p.title} · ${p.industry?.name ?? 'Clubify'}`;
    const description =
      p.description ||
      `${p.title} — demo Clubify para ${p.industry?.name ?? 'tu negocio'}.`;
    const image =
      p.coverImage ||
      p.industry?.iconUrl ||
      `${SITE_URL}/og-image.png`;
    const url = `${SITE_URL}/industria/${params.slug}/${params.pSlug}`;
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
            alt: p.title,
          },
        ],
        locale: 'es_CO',
        type: 'article',
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [image],
      },
      themeColor:
        p.themeColor || p.industry?.themeColor || '#22C55E',
      alternates: { canonical: url },
    };
  } catch {
    return fallback;
  }
}

export default function PresentationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
