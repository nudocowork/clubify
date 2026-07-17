'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

const PC = '#0a90bd';

type Ally = {
  slug: string;
  name: string;
  description: string;
  logoUrl: string | null;
  coverUrl: string | null;
  city: string;
  category: { name: string; slug: string; icon: string } | null;
};

export default function NegociosDirectory() {
  const [allies, setAllies] = useState<Ally[] | null>(null);

  useEffect(() => {
    api<Ally[]>('/cuponera/public/allies')
      .then((r) => setAllies(r ?? []))
      .catch(() => setAllies([]));
  }, []);

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '0 20px 80px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '22px 0' }}>
        <Link href="/cuponera" style={{ fontWeight: 900, fontSize: 20, color: PC, textDecoration: 'none' }}>🎟️ Living Card</Link>
        <Link href="/cuponera/mi-tarjeta" style={{ fontSize: 13.5, fontWeight: 700, color: PC, textDecoration: 'none' }}>Mi tarjeta</Link>
      </header>

      <h1 style={{ fontSize: 30, fontWeight: 900, margin: '20px 0 6px' }}>Negocios aliados</h1>
      <p style={{ color: '#64748b', marginBottom: 26 }}>Descubre dónde usar tu Living Card.</p>

      {allies === null ? (
        <div style={{ color: '#94a3b8' }}>Cargando…</div>
      ) : allies.length === 0 ? (
        <div style={{ color: '#94a3b8' }}>Pronto tendremos negocios aliados aquí.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 18 }}>
          {allies.map((a) => (
            <Link
              key={a.slug}
              href={`/cuponera/negocios/${a.slug}`}
              style={{ textDecoration: 'none', color: 'inherit', background: '#fff', borderRadius: 16, overflow: 'hidden', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,.05)' }}
            >
              <div style={{ height: 120, background: a.coverUrl ? `center/cover url(${a.coverUrl})` : 'linear-gradient(135deg,#0a90bd,#075e7d)' }} />
              <div style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {a.logoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.logoUrl} alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'contain', background: '#f1f5f9' }} />
                  )}
                  <div style={{ fontWeight: 800, fontSize: 15.5 }}>{a.name}</div>
                </div>
                <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 6 }}>
                  {a.category?.icon} {a.category?.name}{a.city ? ` · ${a.city}` : ''}
                </div>
                {a.description && <p style={{ fontSize: 13, color: '#475569', marginTop: 8, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{a.description}</p>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
