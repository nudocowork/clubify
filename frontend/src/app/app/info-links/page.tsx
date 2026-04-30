'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getUser } from '@/lib/api';
import { Icon } from '@/components/Icon';

type InfoLink = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  heroImageUrl: string | null;
  isActive: boolean;
  views: number;
  updatedAt: string;
  _count: { events: number };
};

export default function InfoLinksList() {
  const router = useRouter();
  const [list, setList] = useState<InfoLink[]>([]);
  const [tenant, setTenant] = useState<any>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    const data = await api<InfoLink[]>('/info-links');
    setList(data);
    setTenant(await api('/tenants/me'));
  }
  useEffect(() => {
    load();
  }, []);

  async function create() {
    setCreating(true);
    try {
      const r = await api<{ id: string }>('/info-links', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Mi nuevo link',
          subtitle: 'Una descripción corta',
          sections: [
            { type: 'paragraph', text: 'Edita este texto.' },
          ],
          buttons: [],
          theme: { primaryColor: '#6366F1' },
        }),
      });
      router.push(`/app/info-links/${r.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function toggle(l: InfoLink) {
    await api(`/info-links/${l.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !l.isActive }),
    });
    load();
  }

  async function remove(id: string) {
    if (!confirm('¿Eliminar link?')) return;
    await api(`/info-links/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Links informativos{' '}
          <span className="page-crumb">
            / {list.length} {list.length === 1 ? 'link' : 'links'}
          </span>
        </h1>
        <button className="btn-primary" onClick={create} disabled={creating}>
          <Icon name="plus" /> {creating ? 'Creando…' : 'Nuevo link'}
        </button>
      </div>

      <p className="text-mute mb-5 max-w-2xl">
        Mini-páginas visuales para presentar tu negocio, servicios, eventos o
        promociones — con embed de tu menú y tarjetas. Cada una tiene URL única
        y QR descargable.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {list.length === 0 && (
          <div className="card card-pad text-mute md:col-span-2 lg:col-span-3">
            Sin links aún. Crea tu primer link informativo (eventos, paquetes,
            galería, etc.).
          </div>
        )}
        {list.map((l) => (
          <div key={l.id} className="card overflow-hidden">
            <Link href={`/app/info-links/${l.id}`} className="block">
              <div
                className="h-32 bg-bg2"
                style={
                  l.heroImageUrl
                    ? {
                        backgroundImage: `url(${l.heroImageUrl})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                      }
                    : {
                        background:
                          'linear-gradient(135deg,#6366F1,#C026D3)',
                      }
                }
              />
            </Link>
            <div className="card-pad">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/app/info-links/${l.id}`}
                    className="font-semibold hover:text-brand"
                  >
                    {l.title}
                  </Link>
                  {l.subtitle && (
                    <div className="text-xs text-mute mt-0.5 truncate">
                      {l.subtitle}
                    </div>
                  )}
                </div>
                <span
                  className={`badge ${l.isActive ? 'badge-ok' : 'badge-mute'}`}
                >
                  {l.isActive ? 'Activo' : 'Pausa'}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-mute mt-3">
                <span>{l.views} vistas</span>
                <code className="text-[11px] truncate max-w-[180px]">
                  /i/{tenant?.slug}/{l.slug}
                </code>
              </div>
              <div className="flex gap-2 mt-3">
                <Link
                  className="btn-link text-xs"
                  href={`/app/info-links/${l.id}`}
                >
                  Editar
                </Link>
                <button className="btn-link text-xs" onClick={() => toggle(l)}>
                  {l.isActive ? 'Pausar' : 'Activar'}
                </button>
                <a
                  href={`/i/${tenant?.slug}/${l.slug}`}
                  target="_blank"
                  className="btn-link text-xs"
                >
                  Ver →
                </a>
                <button
                  className="text-bad text-xs underline ml-auto"
                  onClick={() => remove(l.id)}
                >
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
