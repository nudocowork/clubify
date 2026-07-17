'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
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
  normalPriceCents: number | null;
  memberPriceCents: number | null;
  terms: string;
  validUntil: string | null;
  ally: { name: string; slug: string; city: string; address: string; logoUrl: string | null; whatsapp: string | null } | null;
  category: { name: string; slug: string; icon: string } | null;
};

const money = (c: number) => `$ ${Number(c || 0).toLocaleString('es-CO')}`;
const badge = (b: Benefit) =>
  b.type === 'PERCENT_OFF' && b.percentOff ? `${b.percentOff}% OFF`
  : b.type === 'AMOUNT_OFF' && b.amountOffCents ? `${money(b.amountOffCents)} OFF`
  : b.type === 'TWO_FOR_ONE' ? '2x1'
  : b.type === 'FREEBIE' ? 'Regalo' : 'Beneficio';

export default function BenefitDetail() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [b, setB] = useState<Benefit | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!id) return;
    api<Benefit>(`/cuponera/public/benefits/${id}`).then(setB).catch(() => setErr(true));
  }, [id]);

  if (err) return <div style={{ padding: 40, textAlign: 'center' }}>Beneficio no disponible. <Link href="/cuponera/beneficios" style={{ color: PC }}>Ver todos</Link></div>;
  if (!b) return <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Cargando…</div>;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '0 20px 80px' }}>
      <header style={{ padding: '18px 0' }}>
        <Link href="/cuponera/beneficios" style={{ fontSize: 13.5, fontWeight: 700, color: PC, textDecoration: 'none' }}>← Beneficios</Link>
      </header>

      <div style={{ height: 200, borderRadius: 18, background: b.imageUrl ? `center/cover url(${b.imageUrl})` : 'linear-gradient(135deg,#0a90bd,#075e7d)', position: 'relative', marginBottom: -40 }}>
        <span style={{ position: 'absolute', top: 14, left: 14, background: '#84cc16', color: '#1a2e05', fontWeight: 800, fontSize: 14, padding: '5px 14px', borderRadius: 999 }}>{badge(b)}</span>
      </div>

      <div style={{ background: '#fff', borderRadius: 18, padding: 24, boxShadow: '0 8px 30px rgba(0,0,0,.08)', position: 'relative' }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>{b.title}</h1>
        {b.ally && (
          <Link href={`/cuponera/negocios/${b.ally.slug}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 8, textDecoration: 'none', color: '#334155', fontSize: 13.5 }}>
            {b.category?.icon} <b>{b.ally.name}</b>{b.ally.city ? ` · ${b.ally.city}` : ''}
          </Link>
        )}

        {(b.normalPriceCents || b.memberPriceCents) && (
          <div style={{ marginTop: 14, fontSize: 18 }}>
            {b.memberPriceCents != null && <b style={{ color: PC }}>{money(b.memberPriceCents)}</b>}
            {b.normalPriceCents != null && <span style={{ textDecoration: 'line-through', color: '#94a3b8', marginLeft: 8, fontSize: 15 }}>{money(b.normalPriceCents)}</span>}
          </div>
        )}

        {b.description && <p style={{ fontSize: 14.5, color: '#334155', marginTop: 14, lineHeight: 1.5 }}>{b.description}</p>}
        {b.validUntil && <div style={{ fontSize: 13, color: '#64748b', marginTop: 12 }}>Vigente hasta {new Date(b.validUntil).toLocaleDateString('es-CO')}</div>}
        {b.terms && <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 8 }}>{b.terms}</div>}

        <div style={{ marginTop: 22, padding: 16, background: '#eff6ff', borderRadius: 12, fontSize: 14, color: '#1e40af' }}>
          🎟️ <b>Cómo usarlo:</b> abre tu Living Card en Wallet y presenta el QR en {b.ally?.name || 'el negocio'}. El local lo escanea y listo.
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
          <Link href="/cuponera/mi-tarjeta" style={{ background: PC, color: '#fff', padding: '12px 22px', borderRadius: 999, fontWeight: 800, textDecoration: 'none', fontSize: 14 }}>Abrir mi tarjeta</Link>
          {b.ally?.whatsapp && <a href={`https://wa.me/${b.ally.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" style={{ background: '#25D366', color: '#fff', padding: '12px 22px', borderRadius: 999, fontWeight: 700, textDecoration: 'none', fontSize: 14 }}>WhatsApp</a>}
        </div>
      </div>
    </div>
  );
}
