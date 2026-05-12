/* eslint-disable @next/next/no-img-element */
import type { ReactNode } from 'react';
import type { InfoLinkTemplate } from '@/lib/info-link-templates';

// =============================================================
//  Tipos compartidos
// =============================================================

export type ShellTenant = {
  brandName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  whatsappPhone: string | null;
  instagramUrl: string | null;
  mapsUrl: string | null;
  slug: string;
};

export type ShellLink = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  heroImageUrl: string | null;
  gallery: string[];
  sections: any[];
  buttons: { label: string; type: string; url?: string; style?: 'primary' | 'secondary' }[];
  theme: any;
  views: number;
};

export type ResolvedButton = {
  label: string;
  href: string;
  newTab: boolean;
  isPrimary: boolean;
  onClick: () => void;
};

export type ShellProps = {
  tenant: ShellTenant;
  link: ShellLink;
  primary: string;
  buttons: ResolvedButton[];
  /** Bloque de "sections" del editor renderizado. Se inyecta abajo. */
  sectionsNode?: ReactNode;
};

// =============================================================
//  AURORA · gradient mesh + glassmorphism
// =============================================================

export function AuroraShell({ tenant, link, primary, buttons, sectionsNode }: ShellProps) {
  const initial = tenant.brandName[0]?.toUpperCase() ?? '?';
  return (
    <div
      className="min-h-screen text-white"
      style={{
        background: `radial-gradient(circle at 15% 0%, ${primary}66 0%, transparent 40%), radial-gradient(circle at 85% 25%, ${tenant.secondaryColor || '#8B4513'}66 0%, transparent 40%), radial-gradient(circle at 50% 100%, #1a0e2e 0%, transparent 60%), linear-gradient(180deg, #2D1B4E 0%, #1A0E2E 100%)`,
      }}
    >
      <article className="max-w-md mx-auto px-5 pt-10 pb-12">
        <div className="flex flex-col items-center text-center">
          {tenant.logoUrl ? (
            <img
              src={tenant.logoUrl}
              alt=""
              className="w-24 h-24 rounded-full object-cover ring-4 ring-white/30 shadow-2xl"
            />
          ) : (
            <div
              className="w-24 h-24 rounded-full ring-4 ring-white/30 shadow-2xl flex items-center justify-center text-3xl font-bold"
              style={{ background: primary }}
            >
              {initial}
            </div>
          )}
          <h1 className="text-2xl font-bold mt-4">{link.title}</h1>
          <div className="text-[11px] text-white/60 mt-0.5">
            {tenant.brandName}
          </div>
          {link.subtitle && (
            <p className="text-sm text-white/85 mt-3 max-w-sm leading-relaxed">
              {link.subtitle}
            </p>
          )}
        </div>

        {buttons.length > 0 && (
          <div className="mt-7 space-y-2.5">
            {buttons.map((b, i) => (
              <a
                key={i}
                href={b.href}
                target={b.newTab ? '_blank' : undefined}
                rel="noreferrer"
                onClick={b.onClick}
                className={`block w-full px-4 py-3 rounded-2xl text-center text-sm font-semibold transition backdrop-blur-md ${
                  b.isPrimary
                    ? 'bg-white text-[#1A0E2E] shadow-xl hover:shadow-2xl'
                    : 'bg-white/10 text-white border border-white/20 hover:bg-white/15'
                }`}
              >
                {b.label}
              </a>
            ))}
          </div>
        )}

        {sectionsNode && (
          <div className="mt-8 text-white/90 prose-aurora">{sectionsNode}</div>
        )}

        <div className="mt-10 text-center text-[10px] text-white/40">
          Powered by Clubify
        </div>
      </article>
    </div>
  );
}

// =============================================================
//  MINIMAL · profile clean
// =============================================================

export function MinimalShell({ tenant, link, primary, buttons, sectionsNode }: ShellProps) {
  const initial = tenant.brandName[0]?.toUpperCase() ?? '?';
  const social: { emoji: string; href?: string }[] = [
    { emoji: '📷', href: tenant.instagramUrl ?? undefined },
    {
      emoji: '💬',
      href: tenant.whatsappPhone
        ? `https://wa.me/${tenant.whatsappPhone.replace(/\D/g, '')}`
        : undefined,
    },
    { emoji: '📍', href: tenant.mapsUrl ?? undefined },
  ].filter((s) => !!s.href);

  return (
    <div className="min-h-screen bg-white">
      <article className="max-w-md mx-auto px-6 pt-10 pb-12">
        <div className="flex flex-col items-center text-center">
          {tenant.logoUrl ? (
            <img
              src={tenant.logoUrl}
              alt=""
              className="w-20 h-20 rounded-full object-cover"
            />
          ) : (
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold text-white"
              style={{ background: primary }}
            >
              {initial}
            </div>
          )}
          <h1 className="text-lg font-semibold mt-3 text-ink">{link.title}</h1>
          <div className="text-[11px] text-mute">{tenant.brandName}</div>
          {link.subtitle && (
            <p className="text-sm text-mute mt-2 leading-relaxed max-w-xs">
              {link.subtitle}
            </p>
          )}

          {social.length > 0 && (
            <div className="flex gap-2 mt-3">
              {social.map((s, i) => (
                <a
                  key={i}
                  href={s.href}
                  target="_blank"
                  rel="noreferrer"
                  className="w-9 h-9 rounded-full bg-bg2 flex items-center justify-center text-base hover:bg-line transition"
                >
                  {s.emoji}
                </a>
              ))}
            </div>
          )}
        </div>

        {buttons.length > 0 && (
          <div className="mt-7 space-y-2">
            {buttons.map((b, i) => (
              <a
                key={i}
                href={b.href}
                target={b.newTab ? '_blank' : undefined}
                rel="noreferrer"
                onClick={b.onClick}
                className={`block w-full px-4 py-3 rounded-xl border text-sm text-center font-medium transition ${
                  b.isPrimary
                    ? 'border-transparent text-white'
                    : 'border-line text-ink hover:bg-bg2/60'
                }`}
                style={b.isPrimary ? { background: primary } : undefined}
              >
                {b.label}
              </a>
            ))}
          </div>
        )}

        {sectionsNode && <div className="mt-8 text-ink">{sectionsNode}</div>}
      </article>
    </div>
  );
}

// =============================================================
//  SHOP · hero + grid de productos (gallery)
// =============================================================

export function ShopShell({ tenant, link, primary, buttons, sectionsNode }: ShellProps) {
  const initial = tenant.brandName[0]?.toUpperCase() ?? '?';
  const heroBg =
    link.heroImageUrl ||
    `linear-gradient(135deg, ${primary}, ${tenant.secondaryColor || '#A855F7'})`;
  const galleryShown = (link.gallery ?? []).slice(0, 6);
  const primaryBtn = buttons.find((b) => b.isPrimary) ?? buttons[0];
  const secondaryBtns = buttons.filter((b) => b !== primaryBtn).slice(0, 3);

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <article className="max-w-md mx-auto bg-white shadow-sm min-h-screen">
        <div
          className="h-40 bg-cover bg-center relative"
          style={{
            background: link.heroImageUrl ? `url(${heroBg}) center/cover` : heroBg,
          }}
        >
          <div className="absolute inset-0 bg-black/15" />
        </div>
        <div className="px-5">
          <div className="-mt-12 flex justify-center">
            {tenant.logoUrl ? (
              <img
                src={tenant.logoUrl}
                alt=""
                className="w-24 h-24 rounded-2xl ring-4 ring-white shadow-md object-cover"
              />
            ) : (
              <div
                className="w-24 h-24 rounded-2xl ring-4 ring-white shadow-md flex items-center justify-center text-2xl font-bold text-white"
                style={{ background: primary }}
              >
                {initial}
              </div>
            )}
          </div>
          <div className="text-center mt-3">
            <h1 className="text-xl font-bold text-ink">{link.title}</h1>
            <div className="text-[11px] text-mute mt-0.5">{tenant.brandName}</div>
            {link.subtitle && (
              <p className="text-sm text-mute mt-2 leading-relaxed">
                {link.subtitle}
              </p>
            )}
          </div>

          {galleryShown.length > 0 && (
            <div className="grid grid-cols-2 gap-2 mt-5">
              {galleryShown.map((url, i) => (
                <div
                  key={i}
                  className="aspect-square rounded-xl bg-cover bg-center shadow-sm"
                  style={{ backgroundImage: `url(${url})` }}
                />
              ))}
            </div>
          )}

          {primaryBtn && (
            <a
              href={primaryBtn.href}
              target={primaryBtn.newTab ? '_blank' : undefined}
              rel="noreferrer"
              onClick={primaryBtn.onClick}
              className="block w-full mt-5 py-3 rounded-full text-white text-center text-sm font-semibold shadow-md hover:opacity-95"
              style={{ background: primary }}
            >
              {primaryBtn.label}
            </a>
          )}
          {secondaryBtns.length > 0 && (
            <div className="grid grid-cols-3 gap-1.5 mt-2">
              {secondaryBtns.map((b, i) => (
                <a
                  key={i}
                  href={b.href}
                  target={b.newTab ? '_blank' : undefined}
                  rel="noreferrer"
                  onClick={b.onClick}
                  className="py-2.5 rounded-lg text-[11px] font-semibold border border-line bg-white text-center text-ink hover:bg-bg2/40"
                >
                  {b.label}
                </a>
              ))}
            </div>
          )}

          {sectionsNode && (
            <div className="mt-7 pb-10 text-ink">{sectionsNode}</div>
          )}
        </div>
      </article>
    </div>
  );
}

// =============================================================
//  STORIES · IG-style feed
// =============================================================

export function StoriesShell({ tenant, link, primary, buttons, sectionsNode }: ShellProps) {
  const initial = tenant.brandName[0]?.toUpperCase() ?? '?';
  const stories = (link.gallery ?? []).slice(0, 6);

  return (
    <div className="min-h-screen bg-white">
      <article className="max-w-md mx-auto bg-white shadow-sm min-h-screen pb-10">
        <div className="px-5 pt-7 pb-3 border-b border-line2">
          <div className="flex items-center gap-3">
            {tenant.logoUrl ? (
              <img
                src={tenant.logoUrl}
                alt=""
                className="w-16 h-16 rounded-full object-cover ring-2 ring-pink-400"
              />
            ) : (
              <div
                className="w-16 h-16 rounded-full ring-2 ring-pink-400 flex items-center justify-center text-xl font-bold text-white"
                style={{ background: primary }}
              >
                {initial}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="font-bold text-ink leading-tight">
                {tenant.brandName}
              </div>
              <div className="text-xs text-mute mt-0.5">{link.title}</div>
            </div>
          </div>
          {link.subtitle && (
            <p className="text-sm text-ink mt-3 leading-relaxed">
              {link.subtitle}
            </p>
          )}
          {buttons.length > 0 && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {buttons.slice(0, 4).map((b, i) => (
                <a
                  key={i}
                  href={b.href}
                  target={b.newTab ? '_blank' : undefined}
                  rel="noreferrer"
                  onClick={b.onClick}
                  className={`text-[11px] font-semibold px-3 py-1.5 rounded-full ${
                    b.isPrimary
                      ? 'text-white'
                      : 'border border-line text-ink hover:bg-bg2/40'
                  }`}
                  style={b.isPrimary ? { background: primary } : undefined}
                >
                  {b.label}
                </a>
              ))}
            </div>
          )}
        </div>

        {stories.length > 0 && (
          <div className="px-3 py-3 flex gap-3 overflow-x-auto scrollbar-none border-b border-line2">
            {stories.map((url, i) => (
              <div key={i} className="flex flex-col items-center gap-1 flex-none">
                <div
                  className="w-14 h-14 rounded-full p-0.5"
                  style={{
                    background:
                      'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)',
                  }}
                >
                  <div className="w-full h-full rounded-full bg-white p-0.5">
                    <div
                      className="w-full h-full rounded-full bg-cover bg-center"
                      style={{ backgroundImage: `url(${url})` }}
                    />
                  </div>
                </div>
                <div className="text-[9px] text-ink">#{i + 1}</div>
              </div>
            ))}
          </div>
        )}

        {sectionsNode && (
          <div className="px-5 pt-5 text-ink">{sectionsNode}</div>
        )}
      </article>
    </div>
  );
}

// =============================================================
//  NEON · dark accent
// =============================================================

export function NeonShell({ tenant, link, primary, buttons, sectionsNode }: ShellProps) {
  const accent = primary;
  const initial = tenant.brandName[0]?.toUpperCase() ?? '?';
  return (
    <div
      className="min-h-screen text-white"
      style={{
        background:
          'radial-gradient(ellipse at top, #1a1a2e 0%, #0f0f1e 100%)',
      }}
    >
      <article className="max-w-md mx-auto px-5 pt-10 pb-12">
        <div className="flex flex-col items-center text-center">
          {tenant.logoUrl ? (
            <img
              src={tenant.logoUrl}
              alt=""
              className="w-24 h-24 rounded-full object-cover"
              style={{ boxShadow: `0 0 40px ${accent}80, 0 0 80px ${accent}30` }}
            />
          ) : (
            <div
              className="w-24 h-24 rounded-full flex items-center justify-center text-3xl font-bold"
              style={{
                background: '#0a0a14',
                color: accent,
                boxShadow: `0 0 40px ${accent}80, 0 0 80px ${accent}30`,
              }}
            >
              {initial}
            </div>
          )}
          <h1
            className="text-3xl font-black mt-4 tracking-tight"
            style={{
              color: accent,
              textShadow: `0 0 24px ${accent}80`,
            }}
          >
            {link.title.toUpperCase()}
          </h1>
          <div className="text-[10px] uppercase tracking-[0.3em] text-white/50 mt-1">
            {tenant.brandName}
          </div>
          {link.subtitle && (
            <p className="text-sm text-white/70 mt-3 max-w-sm leading-relaxed">
              {link.subtitle}
            </p>
          )}
        </div>

        {buttons.length > 0 && (
          <div className="mt-7 space-y-2.5">
            {buttons.map((b, i) => (
              <a
                key={i}
                href={b.href}
                target={b.newTab ? '_blank' : undefined}
                rel="noreferrer"
                onClick={b.onClick}
                className={`block w-full px-4 py-3 text-sm text-center font-bold uppercase tracking-wider transition ${
                  b.isPrimary
                    ? 'text-black'
                    : 'border text-white hover:bg-white/5'
                }`}
                style={{
                  background: b.isPrimary ? accent : 'transparent',
                  borderColor: b.isPrimary ? 'transparent' : `${accent}50`,
                  clipPath:
                    'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
                }}
              >
                {b.label}
              </a>
            ))}
          </div>
        )}

        {sectionsNode && (
          <div className="mt-8 text-white/85">{sectionsNode}</div>
        )}

        <div
          className="mt-10 text-center text-[10px] uppercase tracking-[0.3em]"
          style={{ color: `${accent}50` }}
        >
          ━━ clubify ━━
        </div>
      </article>
    </div>
  );
}

// =============================================================
//  Switch
// =============================================================

export function InfoLinkShell(
  props: ShellProps & { template: InfoLinkTemplate },
) {
  switch (props.template) {
    case 'AURORA':
      return <AuroraShell {...props} />;
    case 'SHOP':
      return <ShopShell {...props} />;
    case 'STORIES':
      return <StoriesShell {...props} />;
    case 'NEON':
      return <NeonShell {...props} />;
    case 'MINIMAL':
    default:
      return <MinimalShell {...props} />;
  }
}
