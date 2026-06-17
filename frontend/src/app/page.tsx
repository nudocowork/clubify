import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Icon } from '@/components/Icon';
import { RefCapture } from '@/components/RefCapture';
import { FadeIn } from '@/components/FadeIn';
import { HeroTrio } from '@/components/HeroTrio';
import { HeroBanner } from '@/components/HeroBanner';
import { FidelizacionBanner } from '@/components/FidelizacionBanner';
import { InfoLinksBanner } from '@/components/InfoLinksBanner';
import { Logo } from '@/components/Logo';
import { LandingPricingCheckout } from '@/components/LandingPricingCheckout';
import { LanguageSwitcherIntl } from '@/components/LanguageSwitcherIntl';
import { fetchLandingPlans } from '@/lib/landing-plans';

const TESTIMONIALS = [
  {
    quote:
      'Antes manejaba pedidos por WhatsApp uno por uno. Hoy entran al kanban, suenan, los confirmo y la gente recibe estado en tiempo real. Vendí 30% más en 2 meses.',
    name: 'Carolina M.',
    role: 'Café del Día · Bogotá',
    avatar: '☕',
  },
  {
    quote:
      'La tarjeta wallet cambió todo. Mis clientes vuelven más porque les llega el progreso al iPhone. Sin imprimir, sin tarjetas físicas perdidas.',
    name: 'Andrés R.',
    role: 'Burger Lab · CDMX',
    avatar: '🍔',
  },
  {
    quote:
      'El soporte por WhatsApp y la activación inmediata me dieron confianza. Configuré todo en un fin de semana sin saber código.',
    name: 'Sofía L.',
    role: 'Bowls Saludables · Lima',
    avatar: '🥗',
  },
];

// Logos placeholder (texto, sin assets externos)
const LOGOS = [
  'Café del Día',
  'Burger Lab',
  'Bowls & Co',
  'Helados Tina',
  'Pizza Roma',
  'Sushi Kira',
  'Tacos del Sur',
  'Panadería 21',
];

// Default fallback. Los valores reales vienen del Setting `landing.stats`
// (editables desde /admin/branding sin redeploy).
const STATS_FALLBACK = [
  { value: '+150', label: 'Negocios activos en LATAM' },
  { value: '+30K', label: 'Clientes con tarjeta wallet' },
  { value: '50K', label: 'Pedidos procesados / mes' },
  { value: '4.9 / 5', label: 'Calificación de dueños' },
];

type SalesContact = {
  whatsapp: string | null;
  email: string | null;
  instagram: string | null;
};

type LandingStats = {
  businesses: string | null;
  walletCustomers: string | null;
  orders: string | null;
  rating: string | null;
};

type BrandingPublic = {
  sales: SalesContact;
  stats: LandingStats;
  // Logo lockup de la landing pública. Si está seteado, reemplaza el
  // <Logo> default. Null = usa el logo Clubify built-in.
  landingLogoUrl: string | null;
};

// Productos reales del menú de NudoCowork para alimentar la animación del
// HeroBanner. Si el fetch falla, HeroBanner usa los productos hardcoded.
// Dedupe por product.id porque la categoría virtual "Recomendados" repite
// productos que ya viven en su categoría real.
async function fetchNudoMenuItems(): Promise<
  { name: string; price: string; img: string }[]
> {
  const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';
  try {
    const r = await fetch(`${API}/api/public/m/nudocowork/menu`, {
      next: { revalidate: 300 },
    });
    if (!r.ok) return [];
    const cats: any[] = await r.json();
    const items: { name: string; price: string; img: string }[] = [];
    const seen = new Set<string>();
    for (const c of cats) {
      for (const p of c.products ?? []) {
        if (!p.imageUrl) continue;
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        items.push({
          name: p.name,
          price: `$ ${Number(p.basePrice ?? 0).toLocaleString('es-CO')}`,
          img: p.imageUrl,
        });
        if (items.length >= 8) break;
      }
      if (items.length >= 8) break;
    }
    return items;
  } catch {
    return [];
  }
}

async function fetchBranding(): Promise<BrandingPublic> {
  const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';
  const empty: BrandingPublic = {
    sales: { whatsapp: null, email: null, instagram: null },
    stats: { businesses: null, walletCustomers: null, orders: null, rating: null },
    landingLogoUrl: null,
  };
  try {
    const r = await fetch(`${API}/api/branding`, { next: { revalidate: 60 } });
    if (!r.ok) return empty;
    const d: any = await r.json();
    return {
      sales: {
        whatsapp: d?.salesWhatsapp ?? null,
        email: d?.salesEmail ?? null,
        instagram: d?.salesInstagram ?? null,
      },
      stats: {
        businesses: d?.landingStatBusinesses ?? null,
        walletCustomers: d?.landingStatWalletCustomers ?? null,
        orders: d?.landingStatOrders ?? null,
        rating: d?.landingStatRating ?? null,
      },
      landingLogoUrl: d?.landingLogoUrl ?? null,
    };
  } catch {
    return empty;
  }
}

export default async function Landing() {
  const [branding, nudoMenuItems, landingPlans, tHeader, tHero, tLogos] = await Promise.all([
    fetchBranding(),
    fetchNudoMenuItems(),
    fetchLandingPlans(),
    getTranslations('landing.header'),
    getTranslations('landing.hero'),
    getTranslations('landing.logos'),
  ]);
  const { sales, stats, landingLogoUrl } = branding;
  const waLink = sales.whatsapp
    ? `https://wa.me/${sales.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent('Hola, quiero saber más de Clubify')}`
    : 'https://wa.me/573189367158?text=' +
      encodeURIComponent('Hola, quiero saber más de Clubify');
  const mailLink = sales.email
    ? `mailto:${sales.email}?subject=${encodeURIComponent('Quiero saber más de Clubify')}`
    : 'mailto:Soyclubify@gmail.com';
  const igLink = sales.instagram ?? 'https://www.instagram.com/clubify.oficial';
  // CTAs de "Agendar una Demo" — link fijo al embed de Calendly, NO al
  // WhatsApp (decisión del founder: separar consulta comercial general
  // del booking de demo). Sin override por Settings — si se quiere
  // cambiar, modificar aquí.
  const demoLink = 'https://soyclubify.lat/demo';

  // Stats: usa lo seteado en admin si está, sino el fallback hardcoded.
  const STATS = [
    { value: stats.businesses || STATS_FALLBACK[0].value, label: STATS_FALLBACK[0].label },
    { value: stats.walletCustomers || STATS_FALLBACK[1].value, label: STATS_FALLBACK[1].label },
    { value: stats.orders || STATS_FALLBACK[2].value, label: STATS_FALLBACK[2].label },
    { value: stats.rating || STATS_FALLBACK[3].value, label: STATS_FALLBACK[3].label },
  ];
  return (
    <main className="min-h-screen bg-white text-ink">
      <RefCapture />

      {/* ─────────── Header ─────────── */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-white/85 border-b border-line/80">
        <div className="mx-auto max-w-7xl px-6 flex items-center justify-between h-16">
          <Link href="/" className="flex items-center" aria-label="Clubify">
            {landingLogoUrl ? (
              // Logo custom subido desde /admin/branding. Ratio ~3.4:1 esperado.
              // Si la imagen tiene otra proporción, height fija + width auto
              // preserva el aspecto sin recortar. Cargado priority igual que
              // el default para no degradar LCP.
              // #7 (2026-06-17): logo más grande + horizontal. h fija (más
              // visible) + w auto + max-w con object-contain → los logos
              // horizontales usan el espacio y no se deforman; los cuadrados
              // se ven proporcionados, no chiquitos.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={landingLogoUrl}
                alt="Logo"
                className="block h-12 w-auto max-w-[240px] object-contain"
              />
            ) : (
              <Logo size={40} priority />
            )}
          </Link>

          <nav className="hidden lg:flex items-center gap-8 text-[14px] text-mute">
            <a href="#clientes" className="hover:text-ink">{tHeader('nav_customers')}</a>
            <a href="#precios" className="hover:text-ink">{tHeader('nav_pricing')}</a>
          </nav>

          <div className="flex gap-2 items-center">
            <LanguageSwitcherIntl />
            <Link className="inline-flex text-sm text-mute hover:text-ink" href="/login">
              {tHeader('cta_login')}
            </Link>
            <Link
              className="inline-flex items-center gap-1.5 bg-ink text-white text-sm font-semibold px-4 py-2 rounded-pill hover:bg-ink/90"
              href="#precios"
            >
              {tHeader('cta_start')} →
            </Link>
          </div>
        </div>
      </header>

      {/* ─────────── Hero ─────────── */}
      <section className="relative overflow-hidden">
        {/* Background ambient */}
        <div
          className="absolute inset-0 -z-10 opacity-40"
          style={{
            background:
              'radial-gradient(ellipse 70% 60% at 30% 20%, rgba(91,94,238,0.16), transparent 60%), radial-gradient(ellipse 60% 50% at 80% 30%, rgba(192,38,211,0.10), transparent 60%)',
          }}
        />
        <div className="mx-auto max-w-7xl px-6 pt-8 pb-20 lg:pt-12 lg:pb-28">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] gap-12 lg:gap-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-white border border-line shadow-sm text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
                <span className="text-amber-500">★★★★★</span>
                <span>{tHero('badge_rating', { rating: '4.9' })}</span>
                <span className="text-mute font-normal">·</span>
                <span className="text-mute font-normal">{tHero('badge_businesses')}</span>
              </div>

              <h1 className="text-[44px] md:text-[56px] lg:text-[64px] font-bold leading-[1.04] tracking-tight">
                {tHero('title_pre')}{' '}
                <span className="bg-gradient-to-r from-brand-400 via-brand-500 to-brand-700 bg-clip-text text-transparent">
                  {tHero('title_highlight')}
                </span>{' '}
                {tHero('title_post')}
              </h1>

              <p className="mt-6 text-lg lg:text-xl text-mute max-w-xl leading-relaxed">
                {tHero('subtitle')}
              </p>

              {/* Pilares inline */}
              <div className="flex flex-wrap gap-2 mt-6">
                {([
                  tHero('pillars.orders'),
                  tHero('pillars.loyalty'),
                  tHero('pillars.automation'),
                  tHero('pillars.crm'),
                  tHero('pillars.analytics'),
                ]).map((p) => (
                  <span
                    key={p}
                    className="text-xs font-medium bg-bg2 text-ink/80 px-2.5 py-1 rounded-full"
                  >
                    {p}
                  </span>
                ))}
              </div>

              <div className="flex gap-3 mt-8 flex-wrap">
                <Link
                  className="inline-flex items-center bg-ink text-white font-semibold text-base px-6 py-3.5 rounded-pill hover:bg-ink/90 transition shadow-md"
                  href="#precios"
                >
                  {tHero('cta_start_now')}
                </Link>
                <a
                  className="inline-flex items-center gap-2 bg-white border border-line text-ink font-semibold text-base px-6 py-3.5 rounded-pill hover:border-ink/30 transition"
                  href={demoLink}
                  target="_blank"
                  rel="noreferrer"
                >
                  {tHero('cta_demo')}
                </a>
              </div>

              <div className="flex items-center gap-5 mt-8 text-xs text-mute flex-wrap">
                <div className="flex items-center gap-1.5">
                  <Icon name="check" size={14} className="text-ok" /> {tHero('check_instant_activation')}
                </div>
                <div className="flex items-center gap-1.5">
                  <Icon name="check" size={14} className="text-ok" /> {tHero('check_cancel_anytime')}
                </div>
                <div className="flex items-center gap-1.5">
                  <Icon name="check" size={14} className="text-ok" /> {tHero('check_spanish_support')}
                </div>
              </div>
            </div>

            {/* Visual: phone + wallet card layered */}
            <HeroVisual />
          </div>
        </div>
      </section>

      {/* ─────────── Logos band (marquee) ─────────── */}
      <section className="border-y border-line/80 bg-bg2/40 py-8 overflow-hidden">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center text-[11px] uppercase tracking-[0.18em] text-mute font-semibold mb-5">
            {tLogos('title')}
          </div>
        </div>
        <div className="relative">
          <div
            className="absolute inset-y-0 left-0 w-24 z-10"
            style={{
              background: 'linear-gradient(to right, rgba(244,244,247,1), transparent)',
            }}
          />
          <div
            className="absolute inset-y-0 right-0 w-24 z-10"
            style={{
              background: 'linear-gradient(to left, rgba(244,244,247,1), transparent)',
            }}
          />
          <div className="flex gap-12 animate-marquee whitespace-nowrap">
            {[...LOGOS, ...LOGOS, ...LOGOS].map((l, i) => (
              <span
                key={`${l}-${i}`}
                className="text-mute font-semibold opacity-70 hover:opacity-100 hover:text-ink transition text-sm flex-none"
              >
                {l}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── Stats band ─────────── */}
      <section className="py-14">
        <div className="mx-auto max-w-7xl px-6 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {STATS.map((s, i) => (
            <FadeIn key={s.label} delay={i * 90}>
              <div className="text-3xl md:text-4xl font-bold tracking-tight">
                {s.value}
              </div>
              <div className="text-xs text-mute mt-1.5 leading-snug">{s.label}</div>
            </FadeIn>
          ))}
        </div>
      </section>

      {/* ─────────── Bloque Fidelización (va arriba de Menús IA) ─────────── */}
      <FidelizacionBanner waLink={waLink} demoLink={demoLink} />

      {/* ─────────── Hero secundario "Menús con IA" (estilo Cluvi) ─────────── */}
      <HeroBanner
        waLink={waLink}
        demoLink={demoLink}
        mailLink={mailLink}
        igLink={igLink}
        menuItems={nudoMenuItems.length > 0 ? nudoMenuItems : undefined}
        brandName={nudoMenuItems.length > 0 ? 'nudo cowork' : undefined}
      />

      {/* ─────────── InfoLinks (mini-pages estilo Linktree) ─────────── */}
      <InfoLinksBanner />

      {/* ─────────── Testimonios ─────────── */}
      <section id="clientes" className="bg-bg2/40 border-y border-line/80 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center mb-12 max-w-2xl mx-auto">
            <div className="text-xs uppercase tracking-[0.18em] text-brand font-semibold mb-3">
              Lo que dicen
            </div>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight leading-[1.1]">
              Nuestros clientes
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {TESTIMONIALS.map((t, i) => (
              <FadeIn
                key={t.name}
                delay={i * 100}
                className="bg-white rounded-2xl p-7 border border-line"
              >
                <div className="text-amber-500 text-sm mb-3">★★★★★</div>
                <p className="text-ink leading-relaxed text-[15px]">
                  “{t.quote}”
                </p>
                <div className="mt-5 flex items-center gap-3 pt-4 border-t border-line2">
                  <div className="w-10 h-10 rounded-full bg-brand-soft flex items-center justify-center text-xl">
                    {t.avatar}
                  </div>
                  <div>
                    <div className="font-semibold text-sm">{t.name}</div>
                    <div className="text-xs text-mute">{t.role}</div>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── Pricing ─────────── */}
      <section id="precios" className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center mb-12 max-w-2xl mx-auto">
            <div className="text-xs uppercase tracking-[0.18em] text-brand font-semibold mb-3">
              Precios
            </div>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight leading-[1.1]">
              Precios claros · sin sorpresas
            </h2>
            <p className="text-mute mt-4 text-lg">
              Elige la periodicidad que más te convenga. Mientras más
              tiempo, más ahorras. Activa tu cuenta en minutos y empieza
              a vender — cancela cuando quieras desde tu panel.
            </p>
          </div>
          <LandingPricingCheckout plans={landingPlans} />
        </div>
      </section>

      {/* ─────────── FAQ ─────────── */}
      <section className="border-t border-line bg-bg2/40 py-24">
        <div className="mx-auto max-w-3xl px-6">
          <div className="text-center mb-10">
            <div className="text-xs uppercase tracking-[0.18em] text-brand font-semibold mb-3">
              Preguntas frecuentes
            </div>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight">
              Lo que casi todos preguntan
            </h2>
          </div>
          <div className="space-y-3">
            {[
              {
                q: '¿Cuánto pago y en qué moneda?',
                a: 'Desde USD 68/mes en el plan mensual. Tenemos también Trimestral, Semestral y Anual con descuento por compromiso (el Anual te sale en USD ~42/mes equivalente). Te mostramos el equivalente en tu moneda local (COP, MXN, ARS, BRL, etc.) al cambio del día. Sin contratos — cancelas cuando quieras desde tu panel.',
              },
              {
                q: '¿Mis clientes necesitan descargar una app?',
                a: 'No, los clientes no necesitan descargar ninguna APP. Las tarjetas se instalan directamente en su Wallet del teléfono (Apple Wallet en iPhone, Google Wallet en Android). Cero fricción.',
              },
              {
                q: '¿Funciona para negocios con pocos clientes o recién abiertos?',
                a: 'Sin duda. Un programa de fidelización al iniciar un negocio te ayuda a crear comunidad desde el primer momento, ayudando así a crecer la marca y las ventas.',
              },
              {
                q: '¿Cómo se procesa el pago?',
                a: 'Procesamos los pagos a través de Hotmart, una pasarela segura ampliamente usada en LATAM. Acepta tarjeta de crédito, débito y métodos locales (PSE, Mercado Pago, etc.) según tu país.',
              },
              {
                q: '¿Necesito Apple Developer Program para emitir tarjetas wallet?',
                a: 'No. Las tarjetas funcionan en Google Wallet (Android e iPhone) sin pagar nada. Si quieres .pkpass nativo en Apple Wallet, sí necesitas Apple Developer (USD 99/año), pero no es obligatorio.',
              },
              {
                q: '¿Qué pasa con mis datos si decido cancelar?',
                a: 'Te exportamos todo: clientes, menú, pedidos, tarjetas. Mantenemos tu información disponible para descarga durante 30 días después de cancelar.',
              },
              {
                q: '¿Hay costos extras?',
                a: 'No. Pedidos, tarjetas, automatizaciones y clientes son ilimitados con tu suscripción. Sin comisiones por transacción.',
              },
              {
                q: '¿Funciona si no soy técnico?',
                a: 'Sí. El setup inicial son 5 pasos visuales. No tienes que escribir código ni configurar servidores. Si te trabas, escríbenos por WhatsApp.',
              },
            ].map((item) => (
              <details
                key={item.q}
                className="group bg-white rounded-xl border border-line transition hover:border-ink/20"
              >
                <summary className="cursor-pointer px-5 py-4 list-none flex justify-between items-center font-semibold text-sm">
                  <span>{item.q}</span>
                  <span className="text-mute group-open:rotate-180 transition text-xs">
                    ▼
                  </span>
                </summary>
                <div className="px-5 pb-5 text-sm text-mute leading-relaxed -mt-1">
                  {item.a}
                </div>
              </details>
            ))}
          </div>
          <div className="text-center text-xs text-mute mt-6">
            ¿Otra pregunta?{' '}
            <a
              href={waLink}
              className="text-brand hover:underline"
            >
              Escríbenos por WhatsApp
            </a>
          </div>
        </div>
      </section>

      {/* ─────────── Footer ─────────── */}
      <footer className="border-t border-line bg-white">
        <div className="mx-auto max-w-7xl px-6 py-14">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 text-sm">
            <div className="col-span-2">
              <div className="flex items-center mb-3">
                {landingLogoUrl ? (
                  // #7 (2026-06-17): mismo criterio que el header, algo más chico.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={landingLogoUrl}
                    alt="Logo"
                    className="block h-9 w-auto max-w-[200px] object-contain"
                  />
                ) : (
                  <Logo size={32} />
                )}
              </div>
              <p className="text-mute text-sm leading-relaxed max-w-xs">
                La plataforma todo-en-uno para negocios locales en LATAM.
                Pedidos, fidelización, CRM y automatización en una sola cuenta.
              </p>
              <div className="flex gap-2 mt-4 flex-wrap">
                <a
                  href={waLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs bg-bg2 text-ink px-3 py-1.5 rounded-pill hover:bg-line"
                >
                  💬 WhatsApp
                </a>
                <a
                  href={mailLink ?? 'mailto:Soyclubify@gmail.com'}
                  className="text-xs bg-bg2 text-ink px-3 py-1.5 rounded-pill hover:bg-line"
                >
                  ✉ Email
                </a>
                {igLink && (
                  <a
                    href={igLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs bg-bg2 text-ink px-3 py-1.5 rounded-pill hover:bg-line inline-flex items-center gap-1.5"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden
                    >
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
                    </svg>
                    Instagram
                  </a>
                )}
              </div>
            </div>
            <div>
              <div className="font-semibold mb-3 text-[13px]">Producto</div>
              <ul className="space-y-2 text-mute">
                <li><a href="#clientes" className="hover:text-ink">Clientes</a></li>
                <li><a href="#precios" className="hover:text-ink">Precios</a></li>
              </ul>
            </div>
            <div>
              <div className="font-semibold mb-3 text-[13px]">Crece</div>
              <ul className="space-y-2 text-mute">
                <li><Link href="/refer" className="hover:text-ink">Referidos</Link></li>
                <li><Link href="/#precios" className="hover:text-ink">Empezar ahora</Link></li>
                <li><Link href="/login" className="hover:text-ink">Ingresar</Link></li>
              </ul>
            </div>
            <div>
              <div className="font-semibold mb-3 text-[13px]">Legal</div>
              <ul className="space-y-2 text-mute">
                <li><Link href="/legal/terms" className="hover:text-ink">Términos</Link></li>
                <li><Link href="/legal/privacy" className="hover:text-ink">Privacidad</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-line mt-10 pt-6 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-mute">
            <div>© 2025 Clubify</div>
            <div className="flex items-center gap-3">
              <span>Pagos seguros con tarjeta</span>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}

// =====================================================
// Hero visual: phone frame + wallet card overlap
// =====================================================
function HeroVisual() {
  return (
    <div className="relative flex justify-center lg:justify-end">
      <HeroTrio />
    </div>
  );
}
