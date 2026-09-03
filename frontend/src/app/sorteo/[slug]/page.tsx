import type { Metadata } from 'next';
import { cache } from 'react';
import { RaffleForm, RaffleUnavailable, type RaffleData } from '../RaffleForm';

// Sorteo público por slug, servido NATIVAMENTE en soyclubify.com (white-label).
// Datos del panel team_clubify vía endpoint público CORS.
const TEAM_BASE = 'https://team.soyclubify.com';

// `cache()` deduplica el fetch dentro del mismo request → generateMetadata y la página
// comparten UN solo fetch (antes eran 2). `revalidate: 15` cachea 15s → cargas repetidas
// son instantáneas. El estado activo/inactivo lo re-valida el endpoint de registro igual.
const fetchRaffle = cache(async (slug: string): Promise<RaffleData | null> => {
  try {
    const r = await fetch(`${TEAM_BASE}/api/raffle/${encodeURIComponent(slug)}`, { next: { revalidate: 15 } });
    if (!r.ok) return null;
    const j = (await r.json()) as { ok: boolean; raffle?: RaffleData };
    return j.ok && j.raffle ? j.raffle : null;
  } catch {
    return null;
  }
});

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const r = await fetchRaffle(params.slug);
  return { title: r ? `Sorteo · ${r.name}` : 'Sorteo' };
}

export default async function SorteoSlugPage({ params }: { params: { slug: string } }) {
  const raffle = await fetchRaffle(params.slug);
  if (!raffle) return <RaffleUnavailable reason="notfound" />;
  return <RaffleForm slug={params.slug} raffle={raffle} />;
}
