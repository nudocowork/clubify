'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

type Section = any;
type Button = {
  label: string;
  type: 'WHATSAPP' | 'INSTAGRAM' | 'MAPS' | 'MENU' | 'CARD' | 'PROMO' | 'EXTERNAL';
  url?: string;
  style?: 'primary' | 'secondary';
};

type Tenant = {
  id: string;
  brandName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  whatsappPhone: string | null;
  instagramUrl: string | null;
  mapsUrl: string | null;
  slug: string;
};

type Link = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  heroImageUrl: string | null;
  gallery: string[];
  sections: Section[];
  buttons: Button[];
  theme: { primaryColor?: string };
  views: number;
};

export default function PublicInfoLink() {
  const { slug, linkSlug } = useParams<{ slug: string; linkSlug: string }>();
  const [data, setData] = useState<{ tenant: Tenant; link: Link } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [menu, setMenu] = useState<any[]>([]);
  const [storefront, setStorefront] = useState<any>(null);

  useEffect(() => {
    fetch(`${API}/api/public/i/${slug}/${linkSlug}`)
      .then(async (r) => {
        if (!r.ok) throw new Error('No disponible');
        return r.json();
      })
      .then((d) => {
        setData(d);
        // Si tiene embeds, prefetch
        const types = (d.link.sections || []).map((s: any) => s.type);
        if (types.includes('embed_menu')) {
          fetch(`${API}/api/public/m/${slug}/menu`)
            .then((r) => r.json())
            .then(setMenu);
        }
        if (types.includes('embed_promotions') || types.includes('embed_card')) {
          fetch(`${API}/api/public/m/${slug}`)
            .then((r) => r.json())
            .then(setStorefront);
        }
        // Detectar si vino por QR
        const ref = new URLSearchParams(window.location.search).get('ref');
        if (ref === 'qr') {
          fetch(`${API}/api/public/i/${d.link.id}/track`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'qr_scan' }),
          });
        }
      })
      .catch((e) => setErr(e.message));
  }, [slug, linkSlug]);

  function trackClick(label: string) {
    if (!data) return;
    fetch(`${API}/api/public/i/${data.link.id}/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'click_button', metadata: { label } }),
    }).catch(() => null);
  }

  if (err) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="text-center">
          <div className="text-5xl mb-3">😔</div>
          <h1 className="text-xl font-bold">No encontramos este link</h1>
          <p className="text-mute mt-2 text-sm">
            Puede que esté pausado o haya cambiado de URL.
          </p>
        </div>
      </div>
    );
  }
  if (!data) return <div className="p-8 text-mute text-center">Cargando…</div>;

  const { tenant, link } = data;
  const primary = link.theme?.primaryColor ?? tenant.primaryColor ?? '#6366F1';

  function buttonHref(b: Button): string | undefined {
    switch (b.type) {
      case 'WHATSAPP':
        return tenant.whatsappPhone
          ? `https://wa.me/${tenant.whatsappPhone.replace(/\D/g, '')}`
          : undefined;
      case 'INSTAGRAM':
        return tenant.instagramUrl ?? undefined;
      case 'MAPS':
        return tenant.mapsUrl ?? undefined;
      case 'MENU':
        return `/m/${tenant.slug}`;
      case 'CARD':
        return `/m/${tenant.slug}`;
      case 'PROMO':
        return `/m/${tenant.slug}`;
      case 'EXTERNAL':
        return b.url;
    }
  }

  function fmt(n: number) {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(n);
  }

  return (
    <div className="min-h-screen" style={{ background: '#FAFBFC' }}>
      <article className="max-w-md mx-auto bg-white shadow-sm min-h-screen">
        {/* Hero */}
        {link.heroImageUrl ? (
          <img
            src={link.heroImageUrl}
            alt=""
            className="w-full h-56 object-cover"
          />
        ) : (
          <div
            className="w-full h-32"
            style={{
              background: `linear-gradient(135deg, ${primary}, ${tenant.secondaryColor || '#C026D3'})`,
            }}
          />
        )}

        <div className="px-5 py-6">
          {/* Header con logo del tenant */}
          <div className="flex items-center gap-2.5 mb-4">
            {tenant.logoUrl ? (
              <img
                src={tenant.logoUrl}
                alt=""
                className="w-10 h-10 rounded-lg"
              />
            ) : (
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold"
                style={{ background: primary }}
              >
                {tenant.brandName[0]}
              </div>
            )}
            <div className="text-xs text-mute">{tenant.brandName}</div>
          </div>

          <h1 className="text-3xl font-bold tracking-tight leading-tight">
            {link.title}
          </h1>
          {link.subtitle && (
            <p className="text-mute mt-2 leading-relaxed">{link.subtitle}</p>
          )}

          {/* Botones CTAs principales */}
          {link.buttons.length > 0 && (
            <div className="space-y-2.5 mt-6">
              {link.buttons.map((b, i) => {
                const href = buttonHref(b);
                if (!href) return null;
                return (
                  <a
                    key={i}
                    href={href}
                    target={b.type === 'EXTERNAL' || b.type === 'INSTAGRAM' || b.type === 'MAPS' || b.type === 'WHATSAPP' ? '_blank' : undefined}
                    rel="noreferrer"
                    onClick={() => trackClick(b.label)}
                    className="block w-full py-3.5 rounded-full text-center font-semibold transition hover:opacity-90"
                    style={{
                      background:
                        b.style === 'secondary' ? '#fff' : primary,
                      color: b.style === 'secondary' ? primary : '#fff',
                      border: `1px solid ${primary}`,
                    }}
                  >
                    {b.label}
                  </a>
                );
              })}
            </div>
          )}

          {/* Bloques */}
          <div className="mt-6 space-y-5">
            {link.sections.map((s: any, i: number) => {
              if (s.type === 'heading')
                return (
                  <h2 key={i} className="font-bold text-lg">
                    {s.text}
                  </h2>
                );
              if (s.type === 'paragraph')
                return (
                  <p key={i} className="text-sm text-ink/80 leading-relaxed whitespace-pre-wrap">
                    {s.text}
                  </p>
                );
              if (s.type === 'image' && s.url)
                return (
                  <figure key={i}>
                    <img
                      src={s.url}
                      alt={s.caption ?? ''}
                      className="w-full rounded-card"
                    />
                    {s.caption && (
                      <figcaption className="text-xs text-mute text-center mt-1">
                        {s.caption}
                      </figcaption>
                    )}
                  </figure>
                );
              if (s.type === 'gallery')
                return (
                  <div key={i} className="grid grid-cols-3 gap-1.5">
                    {s.images.map((url: string, j: number) => (
                      <img
                        key={j}
                        src={url}
                        alt=""
                        className="w-full h-24 object-cover rounded"
                      />
                    ))}
                  </div>
                );
              if (s.type === 'divider')
                return <hr key={i} className="border-line" />;

              if (s.type === 'embed_menu')
                return (
                  <div key={i}>
                    <h3 className="font-bold text-base mb-3">Nuestro menú</h3>
                    {menu.length === 0 && (
                      <div className="text-sm text-mute">Cargando…</div>
                    )}
                    {menu.slice(0, 2).map((cat: any) => (
                      <div key={cat.id} className="mb-3">
                        <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-2">
                          {cat.name}
                        </div>
                        <div className="space-y-1.5">
                          {cat.products.slice(0, 4).map((p: any) => (
                            <div
                              key={p.id}
                              className="flex justify-between text-sm"
                            >
                              <span>{p.name}</span>
                              <span className="font-medium">
                                {fmt(p.basePrice)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    <a
                      href={`/m/${tenant.slug}`}
                      onClick={() => trackClick('Ver menú completo')}
                      className="text-sm font-medium text-brand"
                    >
                      Ver menú completo →
                    </a>
                  </div>
                );

              if (s.type === 'embed_promotions' && storefront?.promotions)
                return (
                  <div key={i}>
                    <h3 className="font-bold text-base mb-3">Promos activas</h3>
                    <div className="space-y-2">
                      {storefront.promotions.map((p: any) => (
                        <div
                          key={p.id}
                          className="rounded-card p-3 text-white"
                          style={{
                            background: `linear-gradient(135deg, ${primary}, ${tenant.secondaryColor})`,
                          }}
                        >
                          <div className="font-semibold">{p.name}</div>
                          {p.description && (
                            <div className="text-xs opacity-90 mt-0.5">
                              {p.description}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );

              if (s.type === 'embed_card')
                return (
                  <div key={i}>
                    <h3 className="font-bold text-base mb-3">Tarjeta de fidelización</h3>
                    <a
                      href={`/m/${tenant.slug}`}
                      onClick={() => trackClick('Mi tarjeta')}
                      className="block rounded-card p-5 text-white text-center"
                      style={{
                        background: `linear-gradient(135deg, ${primary}, ${tenant.secondaryColor})`,
                      }}
                    >
                      <div className="text-xs uppercase tracking-wider opacity-85">
                        Programa fidelización
                      </div>
                      <div className="font-semibold mt-1">
                        Activar mi tarjeta →
                      </div>
                    </a>
                  </div>
                );

              return null;
            })}
          </div>

          {/* Footer Clubify */}
          <div className="mt-12 pt-6 border-t border-line text-center text-xs text-mute">
            Desarrollado por{' '}
            <a
              href="https://clubify.app"
              target="_blank"
              className="font-semibold text-brand"
            >
              Clubify
            </a>
          </div>
        </div>
      </article>
    </div>
  );
}
