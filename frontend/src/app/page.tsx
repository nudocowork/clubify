import Link from 'next/link';
import { headers } from 'next/headers';
import { Icon } from '@/components/Icon';
import { detectCountryFromHeaders, getLocalPrice } from '@/lib/pricing';
import { RefCapture } from '@/components/RefCapture';
import { FadeIn } from '@/components/FadeIn';
import { HeroTrio } from '@/components/HeroTrio';
import { HeroBanner } from '@/components/HeroBanner';
import { FidelizacionBanner } from '@/components/FidelizacionBanner';
import { InfoLinksBanner } from '@/components/InfoLinksBanner';
import { Logo } from '@/components/Logo';

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

function buildPricing(country: string | null) {
  const elite = getLocalPrice(50, country);
  return [
    {
      name: 'Elite',
      price: elite.display,
      priceUsd: elite.displayUsd,
      isUsdCountry: elite.isUsdCountry,
      note: 'al mes',
      badge: 'Todo incluido',
      features: [
        'Pedidos ilimitados',
        'Tarjetas wallet (Apple + Google) ilimitadas',
        'Automatizaciones de WhatsApp',
        'Mensajes automáticos por evento (sello, cumpleaños, recordatorio, etc.)',
        'Multi-ubicación + multi-staff',
        'Dominio propio + analítica',
        'Email transaccional + scanner PWA',
        'Soporte por chat',
      ],
      cta: 'Empezar ahora →',
      href: '/signup',
      primary: true,
    },
  ];
}

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
};

// Productos reales del menú de NudoCowork para alimentar la animación del
// HeroBanner. Si el fetch falla, HeroBanner usa los productos hardcoded.
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
    for (const c of cats) {
      for (const p of c.products ?? []) {
        if (!p.imageUrl) continue;
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
    };
  } catch {
    return empty;
  }
}

export default async function Landing() {
  const country = detectCountryFromHeaders(headers());
  const PRICING = buildPricing(country);
  const [branding, nudoMenuItems] = await Promise.all([
    fetchBranding(),
    fetchNudoMenuItems(),
  ]);
  const { sales, stats } = branding;
  const waLink = sales.whatsapp
    ? `https://wa.me/${sales.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent('Hola, quiero saber más de Clubify')}`
    : 'https://wa.me/573000000000?text=Hola%2C%20quiero%20saber%20m%C3%A1s%20de%20Clubify';
  const mailLink = sales.email
    ? `mailto:${sales.email}?subject=${encodeURIComponent('Quiero saber más de Clubify')}`
    : null;
  const igLink = sales.instagram ?? null;

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
            <Logo size={36} priority />
          </Link>

          <nav className="hidden lg:flex items-center gap-8 text-[14px] text-mute">
            <a href="#producto" className="hover:text-ink">Producto</a>
            <a href="#como" className="hover:text-ink">Cómo funciona</a>
            <a href="#clientes" className="hover:text-ink">Clientes</a>
            <a href="#precios" className="hover:text-ink">Precios</a>
          </nav>

          <div className="flex gap-2 items-center">
            <Link className="hidden sm:inline-flex text-sm text-mute hover:text-ink" href="/login">
              Ingresar
            </Link>
            <Link
              className="inline-flex items-center gap-1.5 bg-ink text-white text-sm font-semibold px-4 py-2 rounded-pill hover:bg-ink/90"
              href="#precios"
            >
              Empezar ahora →
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
                <span>4.9/5</span>
                <span className="text-mute font-normal">·</span>
                <span className="text-mute font-normal">+150 negocios en LATAM</span>
              </div>

              <h1 className="text-[44px] md:text-[56px] lg:text-[64px] font-bold leading-[1.04] tracking-tight">
                Una plataforma{' '}
                <span className="bg-gradient-to-r from-brand-400 via-brand-500 to-brand-700 bg-clip-text text-transparent">
                  todo en uno
                </span>{' '}
                para tu negocio local.
              </h1>

              <p className="mt-6 text-lg lg:text-xl text-mute max-w-xl leading-relaxed">
                Tarjetas de fidelización, menú digital, CRM de pedidos y
                automatizaciones de delivery.
              </p>

              {/* Pilares inline */}
              <div className="flex flex-wrap gap-2 mt-6">
                {['Pedidos', 'Fidelización', 'Automatización', 'CRM', 'Analítica'].map(
                  (p) => (
                    <span
                      key={p}
                      className="text-xs font-medium bg-bg2 text-ink/80 px-2.5 py-1 rounded-full"
                    >
                      {p}
                    </span>
                  ),
                )}
              </div>

              <div className="flex gap-3 mt-8 flex-wrap">
                <Link
                  className="inline-flex items-center bg-ink text-white font-semibold text-base px-6 py-3.5 rounded-pill hover:bg-ink/90 transition shadow-md"
                  href="#precios"
                >
                  Ver plan y empezar
                </Link>
                <a
                  className="inline-flex items-center gap-2 bg-white border border-line text-ink font-semibold text-base px-6 py-3.5 rounded-pill hover:border-ink/30 transition"
                  href={waLink}
                  target="_blank"
                  rel="noreferrer"
                >
                  Hablar con ventas
                </a>
              </div>

              <div className="flex items-center gap-5 mt-8 text-xs text-mute flex-wrap">
                <div className="flex items-center gap-1.5">
                  <Icon name="check" size={14} className="text-ok" /> Activación inmediata
                </div>
                <div className="flex items-center gap-1.5">
                  <Icon name="check" size={14} className="text-ok" /> Cancela cuando quieras
                </div>
                <div className="flex items-center gap-1.5">
                  <Icon name="check" size={14} className="text-ok" /> En español, soporte LATAM
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
            Negocios LATAM creciendo con Clubify
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

      {/* ─────────── Hero secundario "Menús con IA" (estilo Cluvi) ─────────── */}
      <HeroBanner
        waLink={waLink}
        mailLink={mailLink}
        igLink={igLink}
        menuItems={nudoMenuItems.length > 0 ? nudoMenuItems : undefined}
        brandName={nudoMenuItems.length > 0 ? 'nudo cowork' : undefined}
      />

      {/* ─────────── Bloque Fidelización (mismo estilo que Menús IA) ─────────── */}
      <FidelizacionBanner waLink={waLink} />

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
              Activa tu cuenta con un cobro mensual, configura todo en
              minutos y empieza a vender. Sin contratos, cancela cuando
              quieras desde tu panel.
            </p>
          </div>
          <div className="max-w-md mx-auto">
            {PRICING.map((p) => (
              <div
                key={p.name}
                className="relative bg-white rounded-2xl p-7 border border-brand shadow-xl"
              >
                {p.primary && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-ink text-white text-xs font-semibold px-3 py-1 rounded-full">
                    Plan único
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold text-xl">{p.name}</div>
                  {p.badge && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-ok-soft text-ok">
                      {p.badge}
                    </span>
                  )}
                </div>
                <div className="mt-3">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-4xl font-bold">{p.price}</span>
                    <span className="text-mute text-sm">/{p.note}</span>
                  </div>
                  {!p.isUsdCountry && p.priceUsd && (
                    <div className="text-[11px] text-mute mt-1">
                      ≈ {p.priceUsd} al cambio del día
                    </div>
                  )}
                </div>
                <ul className="mt-6 space-y-2.5 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Icon
                        name="check"
                        size={14}
                        className="text-ok mt-0.5 flex-none"
                      />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href={p.href}
                  className={`block text-center mt-7 px-5 py-3 rounded-pill font-semibold text-sm ${
                    p.primary
                      ? 'bg-ink text-white hover:bg-ink/90'
                      : 'bg-bg2 text-ink hover:bg-line'
                  }`}
                >
                  {p.cta}
                </Link>
              </div>
            ))}
          </div>
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
                a: 'USD 50/mes, cobrados al crear tu cuenta. Te mostramos el equivalente en tu moneda local (COP, MXN, ARS, BRL, etc.) al cambio del día. Sin contratos — cancelas cuando quieras desde tu panel.',
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

      {/* ─────────── Final CTA ─────────── */}
      <section className="py-24">
        <div className="mx-auto max-w-5xl px-6">
          <div className="bg-ink text-white rounded-[28px] p-10 md:p-16 text-center relative overflow-hidden">
            <div
              className="absolute inset-0 opacity-25"
              style={{
                background:
                  'radial-gradient(ellipse 60% 60% at 50% 100%, rgba(91,94,238,0.6), transparent 70%)',
              }}
            />
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight relative leading-[1.1]">
              Tu negocio merece tecnología{' '}
              <span className="bg-gradient-to-r from-brand-400 to-brand-700 bg-clip-text text-transparent">
                que vende
              </span>
            </h2>
            <p className="text-white/75 mt-4 leading-relaxed text-base md:text-lg relative">
              5 minutos para tu primer pedido. Si no te sirve, te ayudamos a
              exportar todo y migrar.
            </p>
            <div className="flex gap-3 justify-center mt-8 flex-wrap relative">
              <Link
                href="#precios"
                className="bg-white text-ink font-semibold text-base px-6 py-3.5 rounded-pill hover:bg-white/95"
              >
                Ver planes y empezar
              </Link>
              <a
                href={waLink}
                target="_blank"
                rel="noreferrer"
                className="bg-white/10 hover:bg-white/15 text-white font-semibold text-base px-6 py-3.5 rounded-pill border border-white/25"
              >
                Hablar con ventas
              </a>
            </div>
            <div className="text-xs text-white/55 mt-4 relative">
              Sin permanencia · cancela cuando quieras desde tu panel
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── Footer ─────────── */}
      <footer className="border-t border-line bg-white">
        <div className="mx-auto max-w-7xl px-6 py-14">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 text-sm">
            <div className="col-span-2">
              <div className="flex items-center mb-3">
                <Logo size={28} />
              </div>
              <p className="text-mute text-sm leading-relaxed max-w-xs">
                La plataforma todo-en-uno para negocios locales en LATAM.
                Pedidos, fidelización, CRM y automatización en una sola cuenta.
              </p>
              <div className="flex gap-2 mt-4">
                <a
                  href={waLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs bg-bg2 text-ink px-3 py-1.5 rounded-pill hover:bg-line"
                >
                  💬 WhatsApp
                </a>
                <a
                  href="mailto:hola@soyclubify.com"
                  className="text-xs bg-bg2 text-ink px-3 py-1.5 rounded-pill hover:bg-line"
                >
                  ✉ Email
                </a>
              </div>
            </div>
            <div>
              <div className="font-semibold mb-3 text-[13px]">Producto</div>
              <ul className="space-y-2 text-mute">
                <li><a href="#producto" className="hover:text-ink">Funciones</a></li>
                <li><a href="#como" className="hover:text-ink">Cómo funciona</a></li>
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
            <div>© {new Date().getFullYear()} Clubify · Hecho en LATAM</div>
            <div className="flex items-center gap-3">
              <span className="text-[10px] uppercase tracking-wider bg-bg2 px-2 py-1 rounded font-semibold">
                SOC 2 · LGPD
              </span>
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
