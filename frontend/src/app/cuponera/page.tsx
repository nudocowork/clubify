'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

const PC = '#0a90bd';
const LIME = '#84cc16';

type Plan = {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  interval: 'MONTHLY' | 'ANNUAL';
  description: string;
  benefitsAllowance: number | null;
  level: number;
};
type Category = { id: string; name: string; slug: string; icon: string };
type Campaign = {
  name: string;
  status: string;
  welcomeText: string;
  marketplace: Record<string, any>;
  plans: Plan[];
  categories: Category[];
};

const money = (cents: number, currency = 'COP') =>
  currency === 'COP'
    ? `$ ${Number(cents || 0).toLocaleString('es-CO')}`
    : `${currency} ${(Number(cents || 0) / 100).toFixed(2)}`;

export default function CuponeraLanding() {
  const [data, setData] = useState<Campaign | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    api<Campaign>('/cuponera/public/campaign')
      .then(setData)
      .catch(() => setErr(true));
  }, []);

  if (err) return <div style={{ padding: 40, textAlign: 'center' }}>No se pudo cargar la campaña.</div>;
  if (!data) return <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Cargando…</div>;

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '0 20px 80px' }}>
      {/* Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '22px 0' }}>
        <div style={{ fontWeight: 900, fontSize: 20, color: PC }}>🎟️ {data.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link href="/cuponera/beneficios" style={{ fontSize: 13.5, fontWeight: 700, color: '#334155', textDecoration: 'none' }}>
            Beneficios
          </Link>
          <Link href="/cuponera/negocios" style={{ fontSize: 13.5, fontWeight: 700, color: '#334155', textDecoration: 'none' }}>
            Negocios
          </Link>
          <Link
            href="/cuponera/mi-tarjeta"
            style={{ fontSize: 13.5, fontWeight: 700, color: PC, textDecoration: 'none', border: `1.5px solid ${PC}`, padding: '8px 14px', borderRadius: 999 }}
          >
            Ya soy miembro
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section style={{ textAlign: 'center', padding: '36px 0 28px' }}>
        <h1 style={{ fontSize: 40, fontWeight: 900, lineHeight: 1.1, margin: '0 0 14px', letterSpacing: -1 }}>
          Una tarjeta.{' '}
          <span style={{ color: PC }}>Toda la ciudad</span> con beneficios.
        </h1>
        <p style={{ fontSize: 17, color: '#475569', maxWidth: 620, margin: '0 auto 24px' }}>
          {data.welcomeText || 'Descuentos, experiencias y sorpresas en los negocios aliados de la comunidad. Tu tarjeta vive en Apple y Google Wallet.'}
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <a href="#planes" style={{ background: PC, color: '#fff', padding: '13px 26px', borderRadius: 999, fontWeight: 800, textDecoration: 'none', fontSize: 15 }}>
            Quiero mi Living Card
          </a>
          <Link href="/cuponera/mi-tarjeta" style={{ background: '#fff', color: '#0f172a', padding: '13px 26px', borderRadius: 999, fontWeight: 700, textDecoration: 'none', fontSize: 15, border: '1.5px solid #e2e8f0' }}>
            Añadir a Wallet
          </Link>
        </div>
      </section>

      {/* Categorías */}
      {data.categories.length > 0 && (
        <section style={{ margin: '10px 0 36px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
            {data.categories.map((c) => (
              <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 999, padding: '8px 15px', fontSize: 14, fontWeight: 600, boxShadow: '0 1px 2px rgba(0,0,0,.04)' }}>
                <span style={{ fontSize: 16 }}>{c.icon || '🏷️'}</span>
                {c.name}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Planes */}
      <section id="planes" style={{ paddingTop: 20 }}>
        <h2 style={{ textAlign: 'center', fontSize: 26, fontWeight: 900, marginBottom: 6 }}>Elige tu membresía</h2>
        <p style={{ textAlign: 'center', color: '#64748b', marginBottom: 28 }}>Acceso a los beneficios de la comunidad.</p>
        {data.plans.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#94a3b8' }}>Pronto publicaremos los planes.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 18, maxWidth: 900, margin: '0 auto' }}>
            {data.plans.map((p, i) => {
              const featured = i === Math.min(1, data.plans.length - 1);
              return (
                <div
                  key={p.id}
                  style={{
                    background: '#fff',
                    border: featured ? `2px solid ${PC}` : '1px solid #e2e8f0',
                    borderRadius: 18,
                    padding: 24,
                    position: 'relative',
                    boxShadow: featured ? `0 14px 30px ${PC}22` : '0 2px 8px rgba(0,0,0,.05)',
                  }}
                >
                  {featured && (
                    <span style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', background: LIME, color: '#1a2e05', fontSize: 11, fontWeight: 800, padding: '3px 12px', borderRadius: 999 }}>
                      POPULAR
                    </span>
                  )}
                  <div style={{ fontWeight: 800, fontSize: 17 }}>{p.name}</div>
                  <div style={{ margin: '10px 0 4px', fontSize: 30, fontWeight: 900, color: PC }}>
                    {money(p.priceCents, p.currency)}
                  </div>
                  <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 12 }}>{p.interval === 'ANNUAL' ? 'por año' : 'por mes'}</div>
                  {p.description && <p style={{ fontSize: 13.5, color: '#475569', minHeight: 40 }}>{p.description}</p>}
                  <div style={{ fontSize: 13, color: '#334155', marginBottom: 16 }}>
                    ✓ {p.benefitsAllowance != null ? `${p.benefitsAllowance} beneficios` : 'Beneficios ilimitados'}
                  </div>
                  <Link
                    href={`/cuponera/unirse?plan=${p.id}`}
                    style={{ display: 'block', textAlign: 'center', background: featured ? PC : '#0f172a', color: '#fff', padding: '11px', borderRadius: 999, fontWeight: 800, textDecoration: 'none', fontSize: 14 }}
                  >
                    Unirme
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <footer style={{ textAlign: 'center', marginTop: 60, color: '#94a3b8', fontSize: 12.5 }}>
        Hecho con Clubify · Living Card
      </footer>
    </div>
  );
}
