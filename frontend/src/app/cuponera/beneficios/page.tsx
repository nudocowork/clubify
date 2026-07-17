'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

const PC = '#0a90bd';

type Benefit = {
  id: string;
  type: string;
  title: string;
  description: string;
  imageUrl: string | null;
  percentOff: number | null;
  amountOffCents: number | null;
  ally: { name: string; slug: string; city: string; logoUrl: string | null } | null;
  category: { name: string; slug: string; icon: string } | null;
};

const money = (c: number) => `$ ${Number(c || 0).toLocaleString('es-CO')}`;
const badge = (b: Benefit) =>
  b.type === 'PERCENT_OFF' && b.percentOff ? `${b.percentOff}% OFF`
  : b.type === 'AMOUNT_OFF' && b.amountOffCents ? `${money(b.amountOffCents)} OFF`
  : b.type === 'TWO_FOR_ONE' ? '2x1'
  : b.type === 'FREEBIE' ? 'Regalo' : 'Beneficio';

export default function BeneficiosMarketplace() {
  const [benefits, setBenefits] = useState<Benefit[] | null>(null);

  useEffect(() => {
    api<Benefit[]>('/cuponera/public/benefits').then((r) => setBenefits(r ?? [])).catch(() => setBenefits([]));
  }, []);

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '0 20px 80px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '22px 0' }}>
        <Link href="/cuponera" style={{ fontWeight: 900, fontSize: 20, color: PC, textDecoration: 'none' }}>🎟️ Living Card</Link>
        <Link href="/cuponera/mi-tarjeta" style={{ fontSize: 13.5, fontWeight: 700, color: PC, textDecoration: 'none' }}>Mi tarjeta</Link>
      </header>

      <h1 style={{ fontSize: 30, fontWeight: 900, margin: '20px 0 6px' }}>Beneficios</h1>
      <p style={{ color: '#64748b', marginBottom: 26 }}>Todas las promociones de la comunidad.</p>

      {benefits === null ? (
        <div style={{ color: '#94a3b8' }}>Cargando…</div>
      ) : benefits.length === 0 ? (
        <div style={{ color: '#94a3b8' }}>Pronto habrá beneficios disponibles.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 18 }}>
          {benefits.map((b) => (
            <Link key={b.id} href={`/cuponera/beneficios/${b.id}`} style={{ textDecoration: 'none', color: 'inherit', background: '#fff', borderRadius: 16, overflow: 'hidden', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,.05)' }}>
              <div style={{ height: 130, background: b.imageUrl ? `center/cover url(${b.imageUrl})` : 'linear-gradient(135deg,#0a90bd,#075e7d)', position: 'relative' }}>
                <span style={{ position: 'absolute', top: 10, left: 10, background: '#84cc16', color: '#1a2e05', fontWeight: 800, fontSize: 12, padding: '4px 10px', borderRadius: 999 }}>{badge(b)}</span>
              </div>
              <div style={{ padding: 16 }}>
                <div style={{ fontWeight: 800, fontSize: 15.5 }}>{b.title}</div>
                <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 5 }}>
                  {b.ally?.name}{b.ally?.city ? ` · ${b.ally.city}` : ''}
                </div>
                {b.description && <p style={{ fontSize: 13, color: '#475569', marginTop: 8, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{b.description}</p>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
