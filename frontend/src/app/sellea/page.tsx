import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { FadeIn } from '@/components/FadeIn';
import { HeroTrio } from '@/components/HeroTrio';
import { HeroBanner } from '@/components/HeroBanner';
import { InfoLinksBanner } from '@/components/InfoLinksBanner';
import { LandingPricingCheckout } from '@/components/LandingPricingCheckout';
import { SelleaLogo } from '@/components/sellea/SelleaLogo';
import { SelleaFidelizacionBanner } from '@/components/sellea/SelleaFidelizacionBanner';

/**
 * Landing de Sellea = CLON 1:1 de la de Clubify (soyclubify.com): misma
 * estructura, jerarquía, bloques, espaciados y tamaños. Reusa los MISMOS
 * componentes (HeroTrio, HeroBanner, InfoLinksBanner, LandingPricingCheckout)
 * y FidelizacionBanner clonado. Lo único que cambia:
 *   - Logo → SelleaLogo
 *   - Verde (tokens brand/ok) → naranja, vía override CSS scopeado .sellea-theme
 *   - Textos → Sellea
 * Preview: /sellea · Producción: selleala.com.
 */
export const metadata: Metadata = {
  title: 'Sellea · Fidelización digital para tu negocio',
  description:
    'Tarjetas de sellos en Apple y Google Wallet, menús con IA, pedidos por WhatsApp e InfoLinks. Cada compra deja su sello.',
};

const LOGOS = [
  'Nudo Cowork', 'Birria León', 'Wok Explosivo', 'Valmont Barbería',
  'Pizza Roma', 'Burger Lab', 'Panadería 21', 'Café del Día', 'Bowls & Co',
];

const STATS = [
  { value: '+150', label: 'Negocios activos en LATAM' },
  { value: '+30K', label: 'Clientes con tarjeta wallet' },
  { value: '50K', label: 'Pedidos procesados / mes' },
  { value: '4.9 / 5', label: 'Calificación de dueños' },
];

const TESTIMONIALS = [
  { quote: 'En dos meses la gente empezó a volver mucho más. Ver el progreso en el wallet los engancha.', name: 'Jesus G', role: 'Level Up Offroad · Venezuela', avatar: '🚙' },
  { quote: 'Duplicamos nuestra base de clientes registrados. Ahora sé quién vuelve y les escribo directo.', name: 'Maria J', role: 'Oasis Nutrition · Miami', avatar: '🥗' },
  { quote: 'Recuperé la inversión en menos de un mes. Lo configuré solo en un fin de semana, sin saber código.', name: 'Juan L', role: 'Nails Supplies · México', avatar: '💅' },
];

const FAQS = [
  { q: '¿Cuánto pago y en qué moneda?', a: 'Desde USD 80/mes en el plan mensual. También tenemos el plan Anual por USD 799 (ahorras ~USD 160 frente al mensual). Te mostramos el equivalente en tu moneda local al cambio del día. Sin contratos — cancelas cuando quieras desde tu panel.' },
  { q: '¿Mis clientes necesitan descargar una app?', a: 'No. Las tarjetas se instalan directamente en su Wallet del teléfono (Apple Wallet en iPhone, Google Wallet en Android). Cero fricción.' },
  { q: '¿Funciona para negocios con pocos clientes o recién abiertos?', a: 'Sin duda. Un programa de fidelización al iniciar un negocio te ayuda a crear comunidad desde el primer momento, ayudando a crecer la marca y las ventas.' },
  { q: '¿Cómo se procesa el pago?', a: 'Procesamos los pagos a través de una pasarela de pago segura ampliamente usada en LATAM. Acepta tarjeta de crédito, débito y métodos locales según tu país.' },
  { q: '¿Necesito Apple Developer Program para emitir tarjetas wallet?', a: 'No. Las tarjetas funcionan en Google Wallet (Android e iPhone) sin pagar nada. Si quieres .pkpass nativo en Apple Wallet, sí necesitas Apple Developer (USD 99/año), pero no es obligatorio.' },
  { q: '¿Qué pasa con mis datos si decido cancelar?', a: 'Te exportamos todo: clientes, menú, pedidos, tarjetas. Mantenemos tu información disponible para descarga durante 30 días después de cancelar.' },
  { q: '¿Hay costos extras?', a: 'No. Pedidos, tarjetas, automatizaciones y clientes son ilimitados con tu suscripción. Sin comisiones por transacción.' },
  { q: '¿Funciona si no soy técnico?', a: 'Sí. El setup inicial son 5 pasos visuales. No tienes que escribir código ni configurar servidores. Si te trabas, escríbenos por WhatsApp.' },
];

const waLink = 'https://wa.me/?text=' + encodeURIComponent('Hola, quiero saber más de Sellea');
const demoLink = 'https://wa.me/';
const igLink = 'https://www.instagram.com/selleala';
const mailLink = 'mailto:hola@selleala.com';

// Override CSS scopeado: voltea los tokens verdes (brand/ok) a NARANJA dentro
// de .sellea-theme. Recolorea TODO el árbol (markup propio + componentes
// reusados) sin tocar la estructura.
const SELLEA_THEME_CSS = `
.sellea-theme .text-brand,.sellea-theme .hover\\:text-brand:hover{color:#FF4D3D!important}
.sellea-theme [class*="bg-brand"]:not([class*="bg-brand-soft"]){background-color:#FF4D3D!important}
.sellea-theme [class*="bg-brand-soft"]{background-color:#FFE9E5!important}
.sellea-theme [class*="border-brand"]{border-color:#FF4D3D!important}
.sellea-theme .text-ok,.sellea-theme [class*="text-ok"]{color:#FF4D3D!important}
.sellea-theme [class*="from-brand"]{--tw-gradient-from:#FF6A4D var(--tw-gradient-from-position)!important;--tw-gradient-to:rgb(255 106 77 / 0) var(--tw-gradient-to-position)!important;--tw-gradient-stops:var(--tw-gradient-from),var(--tw-gradient-via),var(--tw-gradient-to)!important}
.sellea-theme [class*="via-brand"]{--tw-gradient-to:rgb(255 77 61 / 0) var(--tw-gradient-to-position)!important;--tw-gradient-stops:var(--tw-gradient-from),#FF4D3D var(--tw-gradient-via-position),var(--tw-gradient-to)!important}
.sellea-theme [class*="to-brand"]{--tw-gradient-to:#E63521 var(--tw-gradient-to-position)!important}
`;

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

/** Logo SUBIDO de la marca (WhiteLabel.logoUrl), resuelto por host — el mismo
 *  que ya usan favicon y login. En el dominio Clubify (preview /sellea) o si la
 *  marca no tiene logo, devuelve null → cae al SelleaLogo SVG. */
async function fetchBrandLogoByHost(host: string): Promise<string | null> {
  const h = (host || '').toLowerCase().split(':')[0];
  if (
    !h ||
    h === 'localhost' ||
    h.startsWith('127.') ||
    h.endsWith('soyclubify.com') ||
    h.endsWith('clubify.app')
  ) {
    return null;
  }
  try {
    const r = await fetch(
      `${API_URL}/api/superadmin-public/white-labels/branding-by-host?host=${encodeURIComponent(h)}`,
      { next: { revalidate: 60 } },
    );
    if (!r.ok) return null;
    const d = await r.json();
    if (!d || !d.slug || d.slug === 'clubify') return null;
    return d.logoUrl ?? null;
  } catch {
    return null;
  }
}

export default async function SelleaLandingPage() {
  const host = headers().get('host') ?? '';
  const brandLogo = await fetchBrandLogoByHost(host);

  // Precios PROPIOS de Sellea: solo Mensual ($80) y Anual ($799) — sin
  // Trimestral ni Semestral. checkoutUrl null = botón "Próximamente" hasta
  // integrar Stripe para Sellea. NO se reusan los links de Hotmart de Clubify.
  const landingPlans = [
    { id: 'mensual' as const, name: 'Mensual', shortName: 'Mensual', months: 1, price: 80, checkoutUrl: null, description: '' },
    { id: 'anual' as const, name: 'Anual', shortName: 'Anual', months: 12, price: 799, checkoutUrl: null, description: '' },
  ];

  return (
    <main className="sellea-theme min-h-screen bg-white text-ink">
      <style dangerouslySetInnerHTML={{ __html: SELLEA_THEME_CSS }} />

      {/* ─────────── Header ─────────── */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-white/85 border-b border-line/80">
        <div className="mx-auto max-w-7xl px-6 flex items-center justify-between h-16">
          <Link href="/" className="flex items-center" aria-label="Sellea">
            {brandLogo ? (
              <img src={brandLogo} alt="Sellea" className="h-9 w-auto max-w-[180px] object-contain" />
            ) : (
              <SelleaLogo size={34} />
            )}
          </Link>
          <nav className="hidden lg:flex items-center gap-8 text-[14px] text-mute">
            <a href="#clientes" className="hover:text-ink">Clientes</a>
            <a href="#precios" className="hover:text-ink">Precios</a>
          </nav>
          <div className="flex gap-2 items-center">
            <Link className="inline-flex text-sm text-mute hover:text-ink" href="/login">Iniciar sesión</Link>
            <Link className="inline-flex items-center gap-1.5 bg-ink text-white text-sm font-semibold px-4 py-2 rounded-pill hover:bg-ink/90" href="#precios">
              Comenzar →
            </Link>
          </div>
        </div>
      </header>

      {/* ─────────── Hero ─────────── */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 -z-10 opacity-40"
          style={{ background: 'radial-gradient(ellipse 70% 60% at 30% 20%, rgba(255,77,61,0.14), transparent 60%), radial-gradient(ellipse 60% 50% at 80% 30%, rgba(230,53,33,0.10), transparent 60%)' }}
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
                Haz que tus clientes{' '}
                <span className="bg-gradient-to-r from-brand-400 via-brand-500 to-brand-700 bg-clip-text text-transparent">
                  vuelvan más seguido
                </span>{' '}
                con Sellea.
              </h1>
              <p className="mt-6 text-lg lg:text-xl text-mute max-w-xl leading-relaxed">
                Sellos en el wallet del cliente, menús con IA, pedidos por
                WhatsApp e InfoLinks. Todo para que cada compra deje su sello —
                y tus clientes regresen.
              </p>
              <div className="flex flex-wrap gap-2 mt-6">
                {['Tarjetas de sellos', 'Apple & Google Wallet', 'Menús con IA', 'InfoLink', 'CRM de clientes'].map((p) => (
                  <span key={p} className="text-xs font-medium bg-bg2 text-ink/80 px-2.5 py-1 rounded-full">{p}</span>
                ))}
              </div>
              <div className="flex gap-3 mt-8 flex-wrap">
                <Link className="inline-flex items-center bg-ink text-white font-semibold text-base px-6 py-3.5 rounded-pill hover:bg-ink/90 transition shadow-md" href="#precios">
                  Ver plan y empezar
                </Link>
                <a className="inline-flex items-center gap-2 bg-white border border-line text-ink font-semibold text-base px-6 py-3.5 rounded-pill hover:border-ink/30 transition" href={demoLink} target="_blank" rel="noreferrer">
                  Agendar una Demo
                </a>
              </div>
              <div className="flex items-center gap-5 mt-8 text-xs text-mute flex-wrap">
                <div className="flex items-center gap-1.5"><Icon name="check" size={14} className="text-ok" /> Activación inmediata</div>
                <div className="flex items-center gap-1.5"><Icon name="check" size={14} className="text-ok" /> Sin permanencia</div>
                <div className="flex items-center gap-1.5"><Icon name="check" size={14} className="text-ok" /> Soporte en español</div>
              </div>
            </div>
            <div className="relative flex justify-center lg:justify-end">
              <HeroTrio />
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── Logos band (marquee) ─────────── */}
      <section className="border-y border-line/80 bg-bg2/40 py-8 overflow-hidden">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center text-[11px] uppercase tracking-[0.18em] text-mute font-semibold mb-5">
            Negocios LATAM creciendo con Sellea
          </div>
        </div>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 w-24 z-10" style={{ background: 'linear-gradient(to right, rgba(244,244,247,1), transparent)' }} />
          <div className="absolute inset-y-0 right-0 w-24 z-10" style={{ background: 'linear-gradient(to left, rgba(244,244,247,1), transparent)' }} />
          <div className="flex gap-12 animate-marquee whitespace-nowrap">
            {[...LOGOS, ...LOGOS, ...LOGOS].map((l, i) => (
              <span key={`${l}-${i}`} className="text-mute font-semibold opacity-70 hover:opacity-100 hover:text-ink transition text-sm flex-none">{l}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── Stats band ─────────── */}
      <section className="py-14">
        <div className="mx-auto max-w-7xl px-6 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {STATS.map((s, i) => (
            <FadeIn key={s.label} delay={i * 90}>
              <div className="text-3xl md:text-4xl font-bold tracking-tight">{s.value}</div>
              <div className="text-xs text-mute mt-1.5 leading-snug">{s.label}</div>
            </FadeIn>
          ))}
        </div>
      </section>

      {/* ─────────── Wallet (Fidelización) ─────────── */}
      <SelleaFidelizacionBanner waLink={waLink} demoLink={demoLink} />

      {/* ─────────── Menús con IA ─────────── */}
      <HeroBanner waLink={waLink} demoLink={demoLink} mailLink={mailLink} igLink={igLink} />

      {/* ─────────── InfoLinks ─────────── */}
      <InfoLinksBanner />

      {/* ─────────── Testimonios ─────────── */}
      <section id="clientes" className="bg-bg2/40 border-y border-line/80 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center mb-12 max-w-2xl mx-auto">
            <div className="text-xs uppercase tracking-[0.18em] text-brand font-semibold mb-3">Lo que dicen</div>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight leading-[1.1]">Nuestros clientes</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {TESTIMONIALS.map((t, i) => (
              <FadeIn key={t.name} delay={i * 100} className="bg-white rounded-2xl p-7 border border-line">
                <div className="text-amber-500 text-sm mb-3">★★★★★</div>
                <p className="text-ink leading-relaxed text-[15px]">“{t.quote}”</p>
                <div className="mt-5 flex items-center gap-3 pt-4 border-t border-line2">
                  <div className="w-10 h-10 rounded-full bg-brand-soft flex items-center justify-center text-xl">{t.avatar}</div>
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
            <div className="text-xs uppercase tracking-[0.18em] text-brand font-semibold mb-3">Precios</div>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight leading-[1.1]">Precios claros · sin sorpresas</h2>
            <p className="text-mute mt-4 text-lg">
              Elige la periodicidad que más te convenga. Mientras más tiempo,
              más ahorras. Activa tu cuenta en minutos y empieza a vender —
              cancela cuando quieras desde tu panel.
            </p>
          </div>
          <LandingPricingCheckout
            plans={landingPlans}
            footnote={
              <span className="text-mute">
                Costo de instalación $250 · precio promocional $180 (incluye el
                primer mes).
              </span>
            }
          />
        </div>
      </section>

      {/* ─────────── FAQ ─────────── */}
      <section className="border-t border-line bg-bg2/40 py-24">
        <div className="mx-auto max-w-3xl px-6">
          <div className="text-center mb-10">
            <div className="text-xs uppercase tracking-[0.18em] text-brand font-semibold mb-3">Preguntas frecuentes</div>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight">Lo que casi todos preguntan</h2>
          </div>
          <div className="space-y-3">
            {FAQS.map((item) => (
              <details key={item.q} className="group bg-white rounded-xl border border-line transition hover:border-ink/20">
                <summary className="cursor-pointer px-5 py-4 list-none flex justify-between items-center font-semibold text-sm">
                  <span>{item.q}</span>
                  <span className="text-mute group-open:rotate-180 transition text-xs">▼</span>
                </summary>
                <div className="px-5 pb-5 text-sm text-mute leading-relaxed -mt-1">{item.a}</div>
              </details>
            ))}
          </div>
          <div className="text-center text-xs text-mute mt-6">
            ¿Otra pregunta?{' '}
            <a href={waLink} className="text-brand hover:underline">Escríbenos por WhatsApp</a>
          </div>
        </div>
      </section>

      {/* ─────────── Footer ─────────── */}
      <footer className="border-t border-line bg-white">
        <div className="mx-auto max-w-7xl px-6 py-14">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 text-sm">
            <div className="col-span-2">
              <div className="flex items-center mb-3">
                {brandLogo ? (
                  <img src={brandLogo} alt="Sellea" className="h-8 w-auto max-w-[160px] object-contain" />
                ) : (
                  <SelleaLogo size={30} />
                )}
              </div>
              <p className="text-mute text-sm leading-relaxed max-w-xs">
                Sistema de fidelización digital para negocios de LATAM. Sellos,
                menús, pedidos y CRM en una sola cuenta. Cada compra deja su sello.
              </p>
              <div className="flex gap-2 mt-4 flex-wrap">
                <a href={waLink} target="_blank" rel="noreferrer" className="text-xs bg-bg2 text-ink px-3 py-1.5 rounded-pill hover:bg-line">💬 WhatsApp</a>
                <a href={mailLink} className="text-xs bg-bg2 text-ink px-3 py-1.5 rounded-pill hover:bg-line">✉ Email</a>
                <a href={igLink} target="_blank" rel="noreferrer" className="text-xs bg-bg2 text-ink px-3 py-1.5 rounded-pill hover:bg-line inline-flex items-center gap-1.5">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
                  </svg>
                  Instagram
                </a>
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
                <li><a href="#precios" className="hover:text-ink">Empezar ahora</a></li>
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
            <div>© 2025 Sellea</div>
            <div className="flex items-center gap-3"><span>www.selleala.com · @selleala</span></div>
          </div>
        </div>
      </footer>
    </main>
  );
}
