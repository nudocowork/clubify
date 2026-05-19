/* eslint-disable @next/next/no-img-element */
import type { CSSProperties, ReactNode } from 'react';
import type { InfoLinkTemplate } from '@/lib/info-link-templates';
import { SectionCoverPreview } from '@/components/menu/SectionCoverPreview';
import { ClubifyBadge } from '@/components/ClubifyBadge';
import {
  getLogoContainerProps,
  getLogoImgStyle,
  type LogoContainerConfig,
} from '@/lib/info-link-logo-container';
import {
  getBannerBackgroundStyle,
  getBannerOverlayBackground,
  type BannerConfig,
} from '@/lib/info-link-banner';

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
  /** theme.logoContainer (opcional) decide el look del card del logo.
   *  theme.bannerConfig (opcional) controla overlay/zoom/blur/posición del
   *  hero image. Si null/undefined, los shells usan sus defaults históricos. */
  theme: {
    primaryColor?: string;
    logoContainer?: LogoContainerConfig | null;
    bannerConfig?: BannerConfig | null;
  } & Record<string, any>;
  views: number;
};

export type ButtonBgStyle = 'solid' | 'transparent' | 'outline';

export type ResolvedButton = {
  label: string;
  href: string;
  newTab: boolean;
  isPrimary: boolean;
  /** Estilo de fondo del botón. `solid` rellena con color de marca,
   *  `transparent` deja el fondo del banner visible, `outline` solo borde.
   *  Default 'solid' para retrocompat. */
  bgStyle: ButtonBgStyle;
  onClick: () => void;
  /** Config visual tipo sección de menú. Si está seteado, el botón se
   *  renderiza como una card grande con cover (igual que las secciones
   *  del layout SECTIONS del menú), pero sigue siendo un <a> clickable
   *  que redirige al href. Independiente del template del InfoLink. */
  cover: unknown;
  /** Subtítulo opcional debajo del título en la portada visual. */
  tagline: string | null;
};

/** Resuelve clases + style inline para un botón según su bgStyle. Pensado
 *  para los 5 shells — cada uno lo invoca con su `primary` y un set base
 *  de clases (radius/padding/typography del shell). El color del texto se
 *  decide así:
 *  - solid: texto blanco (contrasta sobre primary)
 *  - outline: texto en color primary
 *  - transparent: texto sobre fondo del shell (white en dark, ink en light)
 */
export function buttonStyleProps(
  bgStyle: ButtonBgStyle,
  primary: string,
  opts: { dark?: boolean } = {},
): { className: string; style: CSSProperties } {
  const dark = opts.dark === true;
  if (bgStyle === 'transparent') {
    return {
      className: dark
        ? 'bg-transparent text-white hover:bg-white/5'
        : 'bg-transparent text-ink hover:bg-black/[0.03]',
      style: {},
    };
  }
  if (bgStyle === 'outline') {
    return {
      className: 'bg-transparent hover:bg-white/[0.04]',
      style: {
        color: primary,
        border: `1.5px solid ${primary}`,
      },
    };
  }
  // solid (default)
  return {
    className: 'text-white hover:opacity-90 shadow-sm',
    style: { background: primary },
  };
}

/** Tarjeta del logo del negocio. Si `theme.logoContainer` viene seteado,
 *  honramos esa config (override del default del shell). Sino, renderea
 *  el fallback que cada shell pasa (markup original). Nunca recorta el
 *  logo — el <img> interno siempre object-contain con max-w/max-h. */
function ShellLogoCard({
  tenant,
  config,
  primary,
  fallback,
}: {
  tenant: ShellTenant;
  config?: LogoContainerConfig | null;
  primary: string;
  fallback: ReactNode;
}) {
  if (!config || !tenant.logoUrl) return <>{fallback}</>;
  const { style, className } = getLogoContainerProps(config, primary);
  return (
    <div style={style} className={className}>
      <img
        src={tenant.logoUrl}
        alt={tenant.brandName}
        style={getLogoImgStyle(config)}
      />
    </div>
  );
}

/** Botón con cover. Mismo render en todos los shells para coherencia
 *  visual — el cover ya define su propio estilo (imagen, tipografía,
 *  overlay, alto). */
function CoverButtonLink({ b }: { b: ResolvedButton }) {
  return (
    <a
      href={b.href}
      target={b.newTab ? '_blank' : undefined}
      rel="noreferrer"
      onClick={b.onClick}
      className="block w-full rounded-2xl overflow-hidden shadow-md hover:shadow-xl transition active:scale-[0.99]"
    >
      <SectionCoverPreview
        config={b.cover}
        title={b.label}
        tagline={b.tagline ?? null}
      />
    </a>
  );
}

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
          <ShellLogoCard
            tenant={tenant}
            config={link.theme?.logoContainer}
            primary={primary}
            fallback={
              tenant.logoUrl ? (
                <div className="bg-white rounded-2xl shadow-2xl ring-1 ring-white/30 px-5 py-4 flex items-center justify-center max-w-[200px] w-fit">
                  <img
                    src={tenant.logoUrl}
                    alt={tenant.brandName}
                    className="max-w-[160px] w-auto h-auto max-h-[120px] object-contain block"
                  />
                </div>
              ) : (
                <div
                  className="w-24 h-24 rounded-2xl ring-4 ring-white/30 shadow-2xl flex items-center justify-center text-3xl font-bold"
                  style={{ background: primary }}
                >
                  {initial}
                </div>
              )
            }
          />
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
            {buttons.map((b, i) => {
              if (b.cover) return <CoverButtonLink key={i} b={b} />;
              const sp = buttonStyleProps(b.bgStyle, primary, { dark: true });
              // En AURORA el "solid" del shell usa blanco (no primary) por
              // diseño histórico — preservamos eso cuando bgStyle es solid +
              // isPrimary, sino respetamos el helper.
              const auroraSolid = b.bgStyle === 'solid' && b.isPrimary;
              return (
                <a
                  key={i}
                  href={b.href}
                  target={b.newTab ? '_blank' : undefined}
                  rel="noreferrer"
                  onClick={b.onClick}
                  className={`block w-full px-4 py-3 rounded-2xl text-center text-sm font-semibold transition backdrop-blur-md ${
                    auroraSolid
                      ? 'bg-white text-[#1A0E2E] shadow-xl hover:shadow-2xl'
                      : sp.className
                  }`}
                  style={auroraSolid ? undefined : sp.style}
                >
                  {b.label}
                </a>
              );
            })}
          </div>
        )}

        {sectionsNode && (
          <div className="mt-8 text-white/90 prose-aurora">{sectionsNode}</div>
        )}

        <div className="mt-10 text-center">
          <ClubifyBadge variant="pill" />
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
          <ShellLogoCard
            tenant={tenant}
            config={link.theme?.logoContainer}
            primary={primary}
            fallback={
              tenant.logoUrl ? (
                <div className="bg-white rounded-2xl shadow-sm ring-1 ring-black/5 px-4 py-3 flex items-center justify-center max-w-[180px] w-fit">
                  <img
                    src={tenant.logoUrl}
                    alt={tenant.brandName}
                    className="max-w-[140px] w-auto h-auto max-h-[100px] object-contain block"
                  />
                </div>
              ) : (
                <div
                  className="w-20 h-20 rounded-2xl flex items-center justify-center text-2xl font-bold text-white"
                  style={{ background: primary }}
                >
                  {initial}
                </div>
              )
            }
          />
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
            {buttons.map((b, i) => {
              if (b.cover) return <CoverButtonLink key={i} b={b} />;
              const sp = buttonStyleProps(b.bgStyle, primary, { dark: false });
              return (
                <a
                  key={i}
                  href={b.href}
                  target={b.newTab ? '_blank' : undefined}
                  rel="noreferrer"
                  onClick={b.onClick}
                  className={`block w-full px-4 py-3 rounded-xl text-sm text-center font-medium transition ${sp.className}`}
                  style={sp.style}
                >
                  {b.label}
                </a>
              );
            })}
          </div>
        )}

        {sectionsNode && <div className="mt-8 text-ink">{sectionsNode}</div>}

        <ClubifyBadge />
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
    `linear-gradient(135deg, ${primary}, ${tenant.secondaryColor || '#15803D'})`;
  const galleryShown = (link.gallery ?? []).slice(0, 6);
  // Los botones con cover se renderizan aparte como cards full-width.
  // El layout original (primaryBtn pill + secondaryBtns en grid 3) solo
  // aplica a los botones sin cover.
  const coverBtns = buttons.filter((b) => !!b.cover);
  const regularBtns = buttons.filter((b) => !b.cover);
  const primaryBtn = regularBtns.find((b) => b.isPrimary) ?? regularBtns[0];
  const secondaryBtns = regularBtns.filter((b) => b !== primaryBtn).slice(0, 3);

  const bannerConfig = link.theme?.bannerConfig ?? null;
  const overlayBg = getBannerOverlayBackground(bannerConfig);
  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <article className="max-w-md mx-auto bg-white shadow-sm min-h-screen">
        <div className="h-40 relative overflow-hidden">
          {link.heroImageUrl ? (
            <div
              className="absolute inset-0"
              style={getBannerBackgroundStyle(
                link.heroImageUrl,
                bannerConfig,
                heroBg as string,
              )}
            />
          ) : (
            <div className="absolute inset-0" style={{ background: heroBg }} />
          )}
          {/* Overlay: si bannerConfig viene, respetamos su tipo; sino
              dejamos el negro 15% histórico para mantener legibilidad. */}
          {bannerConfig ? (
            overlayBg !== 'transparent' && (
              <div
                className="absolute inset-0"
                style={{ background: overlayBg }}
              />
            )
          ) : (
            <div className="absolute inset-0 bg-black/15" />
          )}
        </div>
        <div className="px-5">
          <div className="-mt-12 flex justify-center">
            <ShellLogoCard
              tenant={tenant}
              config={link.theme?.logoContainer}
              primary={primary}
              fallback={
                tenant.logoUrl ? (
                  <div className="bg-white rounded-2xl ring-4 ring-white shadow-md px-5 py-4 flex items-center justify-center max-w-[200px] w-fit">
                    <img
                      src={tenant.logoUrl}
                      alt={tenant.brandName}
                      className="max-w-[150px] w-auto h-auto max-h-[110px] object-contain block"
                    />
                  </div>
                ) : (
                  <div
                    className="w-24 h-24 rounded-2xl ring-4 ring-white shadow-md flex items-center justify-center text-2xl font-bold text-white"
                    style={{ background: primary }}
                  >
                    {initial}
                  </div>
                )
              }
            />
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

          {coverBtns.length > 0 && (
            <div className="mt-5 space-y-2.5">
              {coverBtns.map((b, i) => (
                <CoverButtonLink key={`cov-${i}`} b={b} />
              ))}
            </div>
          )}
          {primaryBtn && (() => {
            const sp = buttonStyleProps(primaryBtn.bgStyle, primary, { dark: false });
            return (
              <a
                href={primaryBtn.href}
                target={primaryBtn.newTab ? '_blank' : undefined}
                rel="noreferrer"
                onClick={primaryBtn.onClick}
                className={`block w-full mt-5 py-3 rounded-full text-center text-sm font-semibold transition ${
                  primaryBtn.bgStyle === 'solid' ? 'shadow-md' : ''
                } ${sp.className}`}
                style={sp.style}
              >
                {primaryBtn.label}
              </a>
            );
          })()}
          {secondaryBtns.length > 0 && (
            <div className="grid grid-cols-3 gap-1.5 mt-2">
              {secondaryBtns.map((b, i) => {
                const sp = buttonStyleProps(b.bgStyle, primary, { dark: false });
                // Defaults históricos del shell: secondaryBtns sin bgStyle
                // explícito usan border + bg blanco. Si el usuario fijó
                // bgStyle, ese gana.
                const usingDefault = b.bgStyle === 'solid' && !b.isPrimary;
                return (
                  <a
                    key={i}
                    href={b.href}
                    target={b.newTab ? '_blank' : undefined}
                    rel="noreferrer"
                    onClick={b.onClick}
                    className={`py-2.5 rounded-lg text-[11px] font-semibold text-center transition ${
                      usingDefault
                        ? 'border border-line bg-white text-ink hover:bg-bg2/40'
                        : sp.className
                    }`}
                    style={usingDefault ? undefined : sp.style}
                  >
                    {b.label}
                  </a>
                );
              })}
            </div>
          )}

          {sectionsNode && (
            <div className="mt-7 pb-2 text-ink">{sectionsNode}</div>
          )}
          <ClubifyBadge />
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
            <ShellLogoCard
              tenant={tenant}
              config={link.theme?.logoContainer}
              primary={primary}
              fallback={
                tenant.logoUrl ? (
                  <div className="bg-white rounded-2xl ring-2 ring-pink-400 shadow-sm px-2.5 py-2 flex items-center justify-center max-w-[120px] flex-none">
                    <img
                      src={tenant.logoUrl}
                      alt={tenant.brandName}
                      className="max-w-[90px] w-auto h-auto max-h-[64px] object-contain block"
                    />
                  </div>
                ) : (
                  <div
                    className="w-16 h-16 rounded-2xl ring-2 ring-pink-400 flex items-center justify-center text-xl font-bold text-white flex-none"
                    style={{ background: primary }}
                  >
                    {initial}
                  </div>
                )
              }
            />

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
              {buttons.slice(0, 4).map((b, i) => {
                if (b.cover) {
                  return (
                    <div key={i} className="basis-full">
                      <CoverButtonLink b={b} />
                    </div>
                  );
                }
                const sp = buttonStyleProps(b.bgStyle, primary, { dark: false });
                return (
                  <a
                    key={i}
                    href={b.href}
                    target={b.newTab ? '_blank' : undefined}
                    rel="noreferrer"
                    onClick={b.onClick}
                    className={`text-[11px] font-semibold px-3 py-1.5 rounded-full transition ${sp.className}`}
                    style={sp.style}
                  >
                    {b.label}
                  </a>
                );
              })}
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
        <ClubifyBadge />
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
          <ShellLogoCard
            tenant={tenant}
            config={link.theme?.logoContainer}
            primary={accent}
            fallback={
              tenant.logoUrl ? (
                <div
                  className="bg-white rounded-2xl px-5 py-4 flex items-center justify-center max-w-[200px] w-fit"
                  style={{ boxShadow: `0 0 40px ${accent}80, 0 0 80px ${accent}30` }}
                >
                  <img
                    src={tenant.logoUrl}
                    alt={tenant.brandName}
                    className="max-w-[160px] w-auto h-auto max-h-[120px] object-contain block"
                  />
                </div>
              ) : (
                <div
                  className="w-24 h-24 rounded-2xl flex items-center justify-center text-3xl font-bold"
                  style={{
                    background: '#0a0a14',
                    color: accent,
                    boxShadow: `0 0 40px ${accent}80, 0 0 80px ${accent}30`,
                  }}
                >
                  {initial}
                </div>
              )
            }
          />

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
            {buttons.map((b, i) => {
              if (b.cover) return <CoverButtonLink key={i} b={b} />;
              // NEON tiene clip-path estilo cyberpunk + colores de acento
              // propios. Mapeamos bgStyle a tres looks fieles al template:
              // solid = bloque sólido con acento + texto negro
              // outline = borde del acento + texto blanco
              // transparent = sin borde ni bg, texto del acento
              const clip =
                'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)';
              let cls = 'text-white';
              let style: CSSProperties = {
                clipPath: clip,
                background: 'transparent',
              };
              if (b.bgStyle === 'solid') {
                cls = 'text-black hover:opacity-90';
                style = { ...style, background: accent };
              } else if (b.bgStyle === 'outline') {
                cls = 'text-white hover:bg-white/5';
                style = {
                  ...style,
                  border: `1.5px solid ${accent}50`,
                };
              } else {
                // transparent
                cls = 'hover:bg-white/5';
                style = { ...style, color: accent };
              }
              return (
                <a
                  key={i}
                  href={b.href}
                  target={b.newTab ? '_blank' : undefined}
                  rel="noreferrer"
                  onClick={b.onClick}
                  className={`block w-full px-4 py-3 text-sm text-center font-bold uppercase tracking-wider transition ${cls}`}
                  style={style}
                >
                  {b.label}
                </a>
              );
            })}
          </div>
        )}

        {sectionsNode && (
          <div className="mt-8 text-white/85">{sectionsNode}</div>
        )}

        <div className="mt-10 text-center">
          <ClubifyBadge variant="pill" />
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
