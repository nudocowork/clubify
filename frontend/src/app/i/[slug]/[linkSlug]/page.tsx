'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { InfoLinkShell, ResolvedButton } from '@/components/info-link-shells';
import {
  pickButtonStyle,
  type InfoLinkButtonStyle,
} from '@/components/info-link-button-style';
import type { BrandBadgeBrand } from '@/components/BrandBadge';
import { resolveTemplate } from '@/lib/info-link-templates';
import { telHref } from '@/lib/tel-link';
import { useLocale } from '@/lib/i18n';
import { InfoLinkPopupModal } from '@/components/InfoLinkPopupModal';
import type { PopupConfig } from '@/lib/info-link-popup';
import { safeUrlOrNull } from '@/lib/safe-url';
import {
  backgroundCss,
  type InfoLinkBackground,
  type InfoLinkPopup,
} from '@/lib/info-link-extras';
import { InfoLinkGlobalPopup } from '@/components/info-link-global-popup';
import { infolinkCapabilities } from '@/lib/infolink-tier';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

type Section = any;
type Button = InfoLinkButtonStyle & {
  label: string;
  type:
    | 'WHATSAPP'
    | 'INSTAGRAM'
    | 'MAPS'
    | 'MENU'
    | 'CARD'
    | 'PROMO'
    | 'EXTERNAL'
    | 'POPUP'
    | 'PHONE';
  url?: string;
  igHandle?: string;
  /** PHONE: número con indicativo de país. Se abre el marcador con `tel:`. */
  phoneNumber?: string;
  waPhone?: string;
  waMessage?: string;
  locationId?: string | null;
  /** MAPS multi-sede (2026-07-25). Ver editor. */
  locationMode?: 'default' | 'all' | 'selected';
  locationIds?: string[];
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
  mapsUrl?: string | null;
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
  // Freemium Sellea: nivel del negocio → decide si mostramos la tarjeta de
  // captación (solo INFOLINK + FREE). PRO/FULL no la muestran.
  businessType?: string | null;
  infolinkTier?: string | null;
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
  theme: {
    primaryColor?: string;
    background?: InfoLinkBackground | null;
    popup?: InfoLinkPopup | null;
    popups?: InfoLinkPopup[] | null;
  };
  views: number;
};

export default function PublicInfoLink() {
  const { slug, linkSlug } = useParams<{ slug: string; linkSlug: string }>();
  const [locale] = useLocale();
  const [data, setData] = useState<{
    tenant: Tenant;
    link: Link;
    brand?: BrandBadgeBrand;
  } | null>(null);
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
  // Modal de "elige tu ubicación" — se abre cuando un botón MAPS tiene varias
  // sedes. Cada item lleva a su propio Google Maps.
  const [openLocations, setOpenLocations] = useState<{
    title: string;
    items: { id: string; name: string; address: string; href: string }[];
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

  function trackClick(label: string, buttonType?: string) {
    if (!data) return;
    fetch(`${API}/api/public/i/${data.link.id}/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `type` del botón (WHATSAPP/MAPS/…) permite desglosar "WhatsApp abiertos"
      // en las estadísticas del negocio InfoLink. Aditivo: eventos viejos no lo
      // tienen y siguen contando como clic.
      body: JSON.stringify({ type: 'click_button', metadata: { label, ...(buttonType ? { buttonType } : {}) } }),
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
  // Freemium: la tarjeta de captación "Crea tu Infolink gratis" solo aparece en
  // negocios INFOLINK + FREE. PRO/FULL no la muestran (el badge de marca queda
  // igual para todos). Aditivo: los infolinks existentes no cambian.
  const showFreemiumCta = infolinkCapabilities(
    tenant.businessType,
    tenant.infolinkTier,
  ).showSelleaAds;

  // #20 (2026-06-17): si la sede tiene mapsUrl (link EXACTO de Google Maps),
  // lo abrimos tal cual; si no, búsqueda por nombre+dirección (o lat,lng).
  const mapsForLoc = (l: Location) => {
    if (l.mapsUrl && l.mapsUrl.trim()) return l.mapsUrl.trim();
    const query =
      [l.name, l.address].filter(Boolean).join(', ').trim() ||
      `${l.latitude},${l.longitude}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      query,
    )}`;
  };

  // Sedes que debe mostrar un botón MAPS según su modo multi-sede (2026-07-25):
  //   'all'      → todas las sedes activas
  //   'selected' → solo locationIds (si no eligió ninguna, cae a todas)
  //   'default'  → 1 sola (locationId legacy o la primera)
  const mapsLocsFor = (b: Button): Location[] => {
    const all = tenant.locations ?? [];
    if (all.length === 0) return [];
    const mode = b.locationMode ?? 'default';
    if (mode === 'all') return all;
    if (mode === 'selected') {
      const ids = b.locationIds ?? [];
      const sel = all.filter((l) => ids.includes(l.id));
      return sel.length > 0 ? sel : all;
    }
    if (b.locationId) {
      const one = all.find((l) => l.id === b.locationId);
      return one ? [one] : [all[0]];
    }
    return [all[0]];
  };

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
        // Con multi-sede, el href es el de la PRIMERA sede resuelta (fallback
        // sin-JS); cuando hay >1 el onClick abre un modal con la lista. Con 1
        // sola sede el link va directo a su Google Maps.
        const locs = mapsLocsFor(b);
        if (locs.length > 0) return mapsForLoc(locs[0]);
        if (tenant.mapsUrl) return tenant.mapsUrl;
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
      case 'PHONE':
        // Sin número válido el botón NO se pinta (buttonHref devolviendo
        // undefined lo filtra). Un botón de llamada que abre el marcador
        // vacío es peor que no tenerlo.
        return telHref(b.phoneNumber) ?? undefined;
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
      // 'PHONE' queda fuera a propósito: `tel:` en pestaña nueva deja una
      // pestaña en blanco detrás del marcador.
      // Botón ubicación: con 1 sede mostramos su nombre+dirección como
      // tagline; con varias, un conteo ("N ubicaciones") y el click abre el
      // modal de selección de sede.
      const mapsLocs = b.type === 'MAPS' ? mapsLocsFor(b) : [];
      const mapsMulti = mapsLocs.length > 1;
      const buttonLabel = b.label;
      let buttonTagline = b.tagline ?? null;
      if (b.type === 'MAPS' && mapsLocs.length > 0 && !buttonTagline) {
        if (mapsMulti) {
          buttonTagline = `${mapsLocs.length} ubicaciones`;
        } else if (mapsLocs[0].address) {
          buttonTagline = `${mapsLocs[0].name} · ${mapsLocs[0].address}`;
        }
      }
      return {
        ...pickButtonStyle(b),
        label: buttonLabel,
        href,
        newTab,
        isPrimary: b.style !== 'secondary',
        bgStyle,
        onClick: (e?: React.MouseEvent) => {
          trackClick(b.label, b.type);
          // Acción real del botón: MAPS con varias sedes → modal de selección;
          // resto → navegar (pestaña nueva o misma). Se ejecuta directo o, si
          // hay popup pre-acción, desde el botón "Continuar" del popup.
          const runAction = () => {
            if (b.type === 'MAPS' && mapsMulti) {
              setOpenLocations({
                title: b.label || 'Ubicaciones',
                items: mapsLocs.map((l) => ({
                  id: l.id,
                  name: l.name,
                  address: l.address,
                  href: mapsForLoc(l),
                })),
              });
            } else if (newTab) {
              window.open(href, '_blank', 'noopener,noreferrer');
            } else {
              window.location.href = href;
            }
          };
          // Cualquier botón con `popup` configurado intercepta el click:
          //   - type='POPUP': el popup ES la acción (no continúa a ningún link).
          //   - otros: popup PRE-ACCIÓN — modal con "Continuar" que ejecuta la
          //     acción real (incluye abrir el modal de sedes si es MAPS multi).
          if (b.popup) {
            e?.preventDefault();
            if (isPopupBtn) {
              setOpenPopup({ config: b.popup });
            } else {
              setOpenPopup({
                config: b.popup,
                continueAction: { onContinue: runAction },
              });
            }
            return;
          }
          // Sin popup: MAPS multi abre el modal; los demás siguen el <a> normal.
          if (b.type === 'MAPS' && mapsMulti) {
            e?.preventDefault();
            runAction();
          }
        },
        cover: useCover ? b.cover : null,
        tagline: (useCover ? buttonTagline : null) as string | null,
        /** Sub-label visible bajo el botón regular (no-cover). Hoy lo
         *  usamos para mostrar la sede del botón MAPS. */
        subLabel: !useCover && b.type === 'MAPS' ? buttonTagline : null,
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
                  loading="lazy"
                  decoding="async"
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
                    loading="lazy"
                    decoding="async"
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
  const customBg = backgroundCss(link.theme?.background ?? null);

  return (
    <>
      <InfoLinkShell
        template={template}
        tenant={tenant}
        link={link}
        primary={primary}
        buttons={resolvedButtons}
        sectionsNode={sectionsNode}
        customBackground={customBg}
        brand={data.brand}
      />
      {showFreemiumCta && (
        <a
          href="/infolink"
          target="_blank"
          rel="noreferrer"
          className="fixed left-1/2 z-40 flex items-center gap-3 rounded-2xl px-4 py-2.5 shadow-lg no-underline"
          style={{
            bottom: 'calc(0.75rem + env(safe-area-inset-bottom))',
            transform: 'translateX(-50%)',
            width: 'min(420px, calc(100% - 24px))',
            background: '#1A1033',
            color: '#FFF6F0',
          }}
        >
          <span
            style={{ width: 32, height: 32, borderRadius: 9, background: '#FF4D3D', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, flex: 'none' }}
          >
            {(data.brand?.name?.[0] ?? 'S').toUpperCase()}
          </span>
          <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, lineHeight: 1.3 }}>
            Crea tu Infolink gratis
            <small style={{ display: 'block', opacity: 0.7, fontWeight: 600, fontSize: 11 }}>
              Reúne todo en un link · {data.brand?.name ?? 'Sellea'}
            </small>
          </span>
          <span
            style={{ background: '#fff', color: '#1A1033', fontSize: 11.5, fontWeight: 800, padding: '7px 12px', borderRadius: 999, flex: 'none' }}
          >
            Crear el mío
          </span>
        </a>
      )}
      <InfoLinkPopupModal
        popup={openPopup?.config ?? null}
        primary={primary}
        onClose={() => setOpenPopup(null)}
        continueAction={openPopup?.continueAction}
      />
      <InfoLinkLocationsModal
        data={openLocations}
        primary={primary}
        onClose={() => setOpenLocations(null)}
      />
      <InfoLinkGlobalPopup
        linkId={link.id}
        config={link.theme?.popup ?? null}
        popups={link.theme?.popups ?? null}
        primary={primary}
      />
    </>
  );
}

// Modal "elige tu ubicación" para botones MAPS con varias sedes. Cada item
// abre su propio Google Maps en pestaña nueva. Componente separado para que su
// hook de Escape no rompa las reglas de hooks del componente principal (que
// tiene early-returns por error/carga).
function InfoLinkLocationsModal({
  data,
  primary,
  onClose,
}: {
  data: {
    title: string;
    items: { id: string; name: string; address: string; href: string }[];
  } | null;
  primary: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!data) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [data, onClose]);
  if (!data) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white rounded-2xl shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <h3 className="font-bold text-base m-0 truncate">{data.title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-mute hover:text-ink text-2xl leading-none px-1"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto divide-y divide-line">
          {data.items.map((it) => (
            <a
              key={it.id}
              href={it.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
              className="flex items-start gap-3 px-4 py-3 hover:bg-bg2/60 transition"
            >
              <span className="mt-0.5 text-lg shrink-0" style={{ color: primary }}>
                📍
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-sm truncate">
                  {it.name}
                </span>
                {it.address ? (
                  <span className="block text-xs text-mute">{it.address}</span>
                ) : null}
              </span>
              <span className="self-center text-mute text-lg leading-none">›</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
