import type { Metadata } from 'next';
import { RaffleForm, RaffleUnavailable, type RaffleData } from './RaffleForm';

// QR universal white-label: soyclubify.com/sorteo → siempre el sorteo ACTIVO.
// Los datos vienen del panel team_clubify vía endpoint público CORS.
const TEAM_BASE = 'https://team.soyclubify.com';
export const metadata: Metadata = { title: 'Sorteo' };

async function fetchActive(): Promise<{ count: number; raffle: RaffleData | null }> {
  try {
    // revalidate 15s: cargas repetidas instantáneas; el sorteo activo se refleja en ≤15s.
    const r = await fetch(`${TEAM_BASE}/api/raffle/active`, { next: { revalidate: 15 } });
    if (!r.ok) return { count: 0, raffle: null };
    return (await r.json()) as { count: number; raffle: RaffleData | null };
  } catch {
    return { count: 0, raffle: null };
  }
}

export default async function SorteoUniversalPage() {
  const { count, raffle } = await fetchActive();
  if (count === 1 && raffle) return <RaffleForm slug={raffle.slug} raffle={raffle} />;
  return <RaffleUnavailable reason={count > 1 ? 'many' : 'none'} />;
}
