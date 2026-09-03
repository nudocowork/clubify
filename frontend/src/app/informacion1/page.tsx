import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { InfoPageView, type InfoPageData } from '@/components/info-page/InfoPageView';

// Página informativa PERMANENTE de plataforma (soyclubify.com/informacion1) —
// campaña especial. Misma mecánica que /informacion: ruta estática, slug fijo,
// QR permanente. Ver módulo backend info-pages.
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';
const SLUG = 'informacion1';

async function fetchPage(): Promise<InfoPageData | null> {
  try {
    const r = await fetch(`${API}/api/public/info-pages/${SLUG}`, { next: { revalidate: 60 } });
    if (!r.ok) return null;
    return (await r.json()) as InfoPageData;
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const data = await fetchPage();
  if (!data) return { title: 'Clubify' };
  return {
    title: data.title,
    description: data.subtitle ?? undefined,
    openGraph: {
      title: data.title,
      description: data.subtitle ?? undefined,
      images: data.heroImageUrl ? [data.heroImageUrl] : undefined,
    },
  };
}

export default async function Informacion1Page() {
  const data = await fetchPage();
  if (!data) notFound();
  return <InfoPageView data={data} />;
}
