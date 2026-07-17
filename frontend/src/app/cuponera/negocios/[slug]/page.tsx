'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';

const PC = '#0a90bd';

type Ally = {
  slug: string;
  name: string;
  description: string;
  logoUrl: string | null;
  coverUrl: string | null;
  photos: string[];
  address: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  whatsapp: string | null;
  instagram: string | null;
  website: string | null;
  category: { name: string; slug: string; icon: string } | null;
};

export default function AllyDetail() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const [ally, setAlly] = useState<Ally | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!slug) return;
    api<Ally>(`/cuponera/public/allies/${slug}`)
      .then(setAlly)
      .catch(() => setErr(true));
  }, [slug]);

  if (err) return <div style={{ padding: 40, textAlign: 'center' }}>Negocio no encontrado. <Link href="/cuponera/negocios" style={{ color: PC }}>Ver todos</Link></div>;
  if (!ally) return <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Cargando…</div>;

  const mapsUrl =
    ally.latitude != null && ally.longitude != null
      ? `https://www.google.com/maps/search/?api=1&query=${ally.latitude},${ally.longitude}`
      : ally.address
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ally.address + ' ' + ally.city)}`
        : null;
  const waUrl = ally.whatsapp ? `https://wa.me/${ally.whatsapp.replace(/\D/g, '')}` : null;
  const igUrl = ally.instagram ? `https://instagram.com/${ally.instagram.replace(/^@/, '')}` : null;
  const photos = Array.isArray(ally.photos) ? ally.photos : [];

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 20px 80px' }}>
      <header style={{ padding: '18px 0' }}>
        <Link href="/cuponera/negocios" style={{ fontSize: 13.5, fontWeight: 700, color: PC, textDecoration: 'none' }}>← Negocios aliados</Link>
      </header>

      <div style={{ height: 200, borderRadius: 18, background: ally.coverUrl ? `center/cover url(${ally.coverUrl})` : 'linear-gradient(135deg,#0a90bd,#075e7d)', marginBottom: -40 }} />
      <div style={{ background: '#fff', borderRadius: 18, padding: 24, boxShadow: '0 8px 30px rgba(0,0,0,.08)', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {ally.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ally.logoUrl} alt="" style={{ width: 60, height: 60, borderRadius: 12, objectFit: 'contain', background: '#f1f5f9' }} />
          )}
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>{ally.name}</h1>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
              {ally.category?.icon} {ally.category?.name}{ally.city ? ` · ${ally.city}` : ''}
            </div>
          </div>
        </div>

        {ally.description && <p style={{ fontSize: 14.5, color: '#334155', marginTop: 16, lineHeight: 1.5 }}>{ally.description}</p>}

        {ally.address && (
          <div style={{ fontSize: 13.5, color: '#475569', marginTop: 14 }}>📍 {ally.address}{ally.city ? `, ${ally.city}` : ''}</div>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 20 }}>
          {mapsUrl && <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{ background: PC, color: '#fff', padding: '10px 18px', borderRadius: 999, fontWeight: 700, textDecoration: 'none', fontSize: 13.5 }}>Cómo llegar</a>}
          {waUrl && <a href={waUrl} target="_blank" rel="noopener noreferrer" style={{ background: '#25D366', color: '#fff', padding: '10px 18px', borderRadius: 999, fontWeight: 700, textDecoration: 'none', fontSize: 13.5 }}>WhatsApp</a>}
          {igUrl && <a href={igUrl} target="_blank" rel="noopener noreferrer" style={{ background: '#fff', color: '#0f172a', border: '1.5px solid #e2e8f0', padding: '10px 18px', borderRadius: 999, fontWeight: 700, textDecoration: 'none', fontSize: 13.5 }}>Instagram</a>}
        </div>

        {photos.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10, marginTop: 22 }}>
            {photos.map((p, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={p} alt="" style={{ width: '100%', height: 100, objectFit: 'cover', borderRadius: 10 }} />
            ))}
          </div>
        )}

        <div style={{ marginTop: 24, padding: 16, background: '#eff6ff', borderRadius: 12, fontSize: 13.5, color: '#1e40af' }}>
          🎟️ Presenta tu <b>Living Card</b> en este negocio para acceder a los beneficios.
        </div>
      </div>
    </div>
  );
}
