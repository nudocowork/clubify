'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { InfoLinkShell, ResolvedButton } from '@/components/info-link-shells';
import { resolveTemplate } from '@/lib/info-link-templates';
import { useLocale } from '@/lib/i18n';
import { InfoLinkPopupModal } from '@/components/InfoLinkPopupModal';
import type { PopupConfig } from '@/lib/info-link-popup';
import { safeUrlOrNull } from '@/lib/safe-url';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

type Section = any;
type Button = {
  label: string;
  type:
    | 'WHATSAPP'
    | 'INSTAGRAM'
    | 'MAPS'
    | 'MENU'
    | 'CARD'
    | 'PROMO'
    | 'EXTERNAL'
    | 'POPUP';
  url?: string;
  igHandle?: string;
  waPhone?: string;
  waMessage?: string;
  locationId?: string | null;
  style?: 'primary' | 'secondary';
  /** Estilo de fondo. Default 'solid' — pero si está ausente derivamos
   *  de `style` (primary→solid, secondary→outline) para compat. */
  bgStyle?: 'solid' | 'transparent' | 'outline';
  renderAs?: 'simple' | 'cover';
  cover?: unknown;
  tagline?: string | null;
  isActive?: boolean;
  /** Config del popup (cuando type='POPUP'). */
  popup?: PopupConfig | null;
  /** Variante del destino cuando type='MENU' (actualizado 2026-06-08
   *  con separación de rutas /m vs /d):
   *  - 'DELIVERY' (default) → /d/<slug> (carrito + WhatsApp).
   *  - 'MESA'              → /m/<slug>   (informativo, sin carrito).
   *  - 'BOOK'              → /book/<slug> (flipbook).
   *  Compat: ausente = DELIVERY (comportamiento histórico). */
  menuVariant?: 'DELIVERY' | 'MESA' | 'BOOK';
};

type Location = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
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
  locations?: Location[];
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
  const [locale] = useLocale();
  const [data, setData] = useState<{ tenant: Tenant; link: Link } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [menu, setMenu] = useState<any[]>([]);
  const [storefront, setStorefront] = useState<any>(null);
  /** Popup activo. `config` viene del botón. `continueAction` aparece
   *  cuando el botón NO es type='POPUP' — el popup es PRE-ACCIÓN y el
   *  modal renderea botón "Continuar →" que ejecuta el link original
   *  (caso: "Antes de reservar, instala tu tarjeta", G2). */
  const [openPopup, setOpenPopup] = useState<{
    config: PopupConfig;
    continueAction?: { onContinue: () => void; label?: string };
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/public/i/${slug}/${linkSlug}?locale=${locale}`)
      .then(async (r) => {
        if (!r.ok) throw new Error('No disponible');
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        // Si tiene embeds, prefetch — también traducidos para coherencia
        const types = (d.link.sections || []).map((s: any) => s.type);
        if (types.includes('embed_menu')) {
          fetch(`${API}/api/public/m/${slug}/menu?locale=${locale}`)
            .then((r) => r.json())
            .then((m) => {
              if (!cancelled) setMenu(m);
            });
        }
        if (types.includes('embed_promotions') || types.includes('embed_card')) {
          fetch(`${API}/api/public/m/${slug}?locale=${locale}`)
            .then((r) => r.json())
            .then((sf) => {
              if (!cancelled) setStorefront(sf);
            });
        }
        // Detectar si vino por QR (sólo una vez, no depende de locale)
        const ref = new URLSearchParams(window.location.search).get('ref');
        if (ref === 'qr') {
          fetch(`${API}/api/public/i/${d.link.id}/track`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'qr_scan' }),
          });
        }
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, linkSlug, locale]);

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
  const primary = link.theme?.primaryColor ?? tenant.primaryColor ?? '#22C55E';

  function buttonHref(b: Button): string | undefined {
    switch (b.type) {
      case 'WHATSAPP': {
        // Prioridad: número específico del botón > whatsappPhone del tenant
        const phone = (b.waPhone || tenant.whatsappPhone || '').replace(/\D/g, '');
        if (!phone) return undefined;
        const msg = (b.waMessage || '').trim();
        return msg
          ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
          : `https://wa.me/${phone}`;
      }
      case 'INSTAGRAM': {
        // Prioridad: handle específico del botón > instagramUrl del tenant
        if (b.igHandle) {
          const handle = b.igHandle.replace(/^@/, '').trim();
          return `https://instagram.com/${handle}`;
        }
        return tenant.instagramUrl ?? undefined;
      }
      case 'MAPS': {
        // Prioridad: location específico del botón > mapsUrl del tenant > primera location
        if (b.locationId && tenant.locations) {
          const loc = tenant.locations.find((l) => l.id === b.locationId);
          if (loc) {
            return `https://maps.google.com/?q=${loc.latitude},${loc.longitude}`;
          }
        }
        if (tenant.mapsUrl) return tenant.mapsUrl;
        if (tenant.locations && tenant.locations.length > 0) {
          const l = tenant.locations[0];
          return `https://maps.google.com/?q=${l.latitude},${l.longitude}`;
        }
        return undefined;
      }
      case 'MENU': {
        // El dueño elige a qué versión del menú lleva el botón. Default
        // DELIVERY para preservar el comportamiento histórico.
        // Fix 2026-06-08: con la separación de rutas /m vs /d, DELIVERY
        // ahora va a /d/<slug>. Antes caía en /m/<slug> y abría el
        // menú mesa por error.
        const v = b.menuVariant ?? 'DELIVERY';
        if (v === 'BOOK') return `/book/${tenant.slug}`;
        if (v === 'MESA') return `/m/${tenant.slug}`;
        return `/d/${tenant.slug}`;
      }
      case 'CARD':
        return `/m/${tenant.slug}`;
      case 'PROMO':
        return `/m/${tenant.slug}`;
      case 'EXTERNAL':
        // Defense-in-depth contra stored XSS: aunque el backend ya
        // sanitiza al PATCH, filtramos aquí cualquier scheme exótico
        // (javascript:, data:, vbscript:) que pudiera haber quedado de
        // registros viejos pre-fix.
        return safeUrlOrNull(b.url) ?? undefined;
      case 'POPUP':
        // POPUP no navega — usamos '#' como href neutro; el onClick del
        // botón intercepta con preventDefault y abre el modal.
        return '#';
    }
  }

  function fmt(n: number) {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(n);
  }

  // Resuelve los buttons del editor a {href, target, isPrimary, onClick}.
  // Los pausados (isActive === false) no se renderizan. El cover se
  // entrega solo cuando renderAs === 'cover' (o legacy: !!cover sin
  // renderAs explícito).
  const resolvedButtons: ResolvedButton[] = link.buttons
    .filter((b) => b.isActive !== false)
    .map((b) => {
      const href = buttonHref(b);
      if (!href) return null;
      const useCover = b.renderAs ? b.renderAs === 'cover' : !!b.cover;
      const bgStyle =
        b.bgStyle ?? (b.style === 'secondary' ? 'outline' : 'solid');
      const isPopupBtn = b.type === 'POPUP';
      const newTab =
        b.type === 'EXTERNAL' ||
        b.type === 'INSTAGRAM' ||
        b.type === 'MAPS' ||
        b.type === 'WHATSAPP';
      return {
        label: b.label,
        href,
        newTab,
        isPrimary: b.style !== 'secondary',
        bgStyle,
        onClick: (e?: React.MouseEvent) => {
          trackClick(b.label);
          // Cualquier botón con `popup` configurado intercepta el click:
          //   - type='POPUP': el popup ES la acción (no continúa a ningún link).
          //   - otros: popup PRE-ACCIÓN — modal con botón "Continuar" que
          //     ejecuta el link original. Cancelar = solo cierra (G2).
          if (b.popup) {
            e?.preventDefault();
            if (isPopupBtn) {
              setOpenPopup({ config: b.popup });
            } else {
              setOpenPopup({
                config: b.popup,
                continueAction: {
                  onContinue: () => {
                    if (newTab) {
                      window.open(href, '_blank', 'noopener,noreferrer');
                    } else {
                      window.location.href = href;
                    }
                  },
                },
              });
            }
          }
        },
        cover: useCover ? b.cover : null,
        tagline: (useCover ? b.tagline ?? null : null) as string | null,
      };
    })
    .filter((x): x is ResolvedButton => !!x);

  // Bloque de sections — se renderiza igual independiente del template
  const sectionsNode =
    link.sections.length > 0 ? (
      <div className="space-y-5">
        {link.sections.map((s: any, i: number) => {
          if (s.type === 'heading')
            return (
              <h2 key={i} className="font-bold text-lg">
                {s.text}
              </h2>
            );
          if (s.type === 'paragraph')
            return (
              <p
                key={i}
                className="text-sm leading-relaxed whitespace-pre-wrap opacity-85"
              >
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
                  <figcaption className="text-xs opacity-70 text-center mt-1">
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
            return <hr key={i} className="border-current opacity-15" />;

          if (s.type === 'embed_menu')
            return (
              <div key={i}>
                <h3 className="font-bold text-base mb-3">Nuestro menú</h3>
                {menu.length === 0 && (
                  <div className="text-sm opacity-60">Cargando…</div>
                )}
                {menu.slice(0, 2).map((cat: any) => (
                  <div key={cat.id} className="mb-3">
                    <div className="text-xs uppercase tracking-wider opacity-60 font-semibold mb-2">
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
                  className="text-sm font-medium underline"
                  style={{ color: primary }}
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
                <h3 className="font-bold text-base mb-3">
                  Tarjeta de fidelización
                </h3>
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
                  <div className="font-semibold mt-1">Activar mi tarjeta →</div>
                </a>
              </div>
            );

          return null;
        })}
      </div>
    ) : null;

  const template = resolveTemplate(link.theme);

  return (
    <>
      <InfoLinkShell
        template={template}
        tenant={tenant}
        link={link}
        primary={primary}
        buttons={resolvedButtons}
        sectionsNode={sectionsNode}
      />
      <InfoLinkPopupModal
        popup={openPopup?.config ?? null}
        primary={primary}
        onClose={() => setOpenPopup(null)}
        continueAction={openPopup?.continueAction}
      />
    </>
  );
}
