import type { Metadata } from 'next';
import { RaffleForm, RaffleUnavailable, type RaffleData } from '../RaffleForm';

// Sorteo público por slug, servido NATIVAMENTE en soyclubify.com (white-label).
// Datos del panel team_clubify vía endpoint público CORS.
const TEAM_BASE = 'https://team.soyclubify.com';
export const dynamic = 'force-dynamic';

async function fetchRaffle(slug: string): Promise<RaffleData | null> {
  try {
    const r = await fetch(`${TEAM_BASE}/api/raffle/${encodeURIComponent(slug)}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = (await r.json()) as { ok: boolean; raffle?: RaffleData };
    return j.ok && j.raffle ? j.raffle : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const r = await fetchRaffle(params.slug);
  return { title: r ? `Sorteo · ${r.name}` : 'Sorteo' };
}

export default async function SorteoSlugPage({ params }: { params: { slug: string } }) {
  const raffle = await fetchRaffle(params.slug);
  if (!raffle) return <RaffleUnavailable reason="notfound" />;
  return <RaffleForm slug={params.slug} raffle={raffle} />;
}
