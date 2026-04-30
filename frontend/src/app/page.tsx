import Link from 'next/link';
import { Icon } from '@/components/Icon';

const FEATURES = [
  {
    icon: 'shopping-bag' as const,
    title: 'Vendé sin app',
    desc: 'Menú digital + carrito + checkout que dispara el pedido al WhatsApp del dueño en un click. Cero apps que descargar.',
  },
  {
    icon: 'card' as const,
    title: 'Fidelizá con Wallet',
    desc: 'Tarjetas de sellos y puntos que viven dentro de Apple Wallet y Google Wallet. Sin imprimir, sin perder.',
  },
  {
    icon: 'spark' as const,
    title: 'Automatizá todo',
    desc: 'Reglas IF→THEN que mandan WhatsApp, suman sellos, recuerdan cumpleaños. Una vez configuradas, trabajan solas.',
  },
  {
    icon: 'qr' as const,
    title: 'Scanner para staff',
    desc: 'PWA instalable en cualquier celular. Tu cajero escanea el QR del cliente y suma sello en 1 segundo.',
  },
  {
    icon: 'history' as const,
    title: 'Analítica que entiende',
    desc: 'Funnels, heatmaps de horario pico, retención por cohortes. Sabés qué producto vender más fuerte cada hora.',
  },
  {
    icon: 'arrow-right' as const,
    title: 'Mini-páginas + dominio',
    desc: 'Links informativos tipo Linktree con embed de menú/promos. Conectá tu dominio propio (ej. micafe.com).',
  },
];

const STEPS = [
  {
    n: 1,
    title: 'Subí tu menú',
    desc: 'Categorías, productos, fotos. 5 minutos. O importás del Excel que ya tenés.',
  },
  {
    n: 2,
    title: 'Compartí tu link',
    desc: 'Pegalo en Instagram, WhatsApp, mesas con QR. Tus clientes piden directo, sin intermediarios.',
  },
  {
    n: 3,
    title: 'Recibí pedidos',
    desc: 'Los pedidos llegan al kanban en tiempo real. Confirmás → cliente recibe estado en vivo.',
  },
  {
    n: 4,
    title: 'Fidelizá automáticamente',
    desc: 'Cada pedido suma sello en su tarjeta wallet. Cuando completa, le mandás un mensaje automático.',
  },
];

const PRICING = [
  {
    name: 'Free',
    price: '$0',
    note: 'Para empezar',
    features: [
      'Hasta 100 pedidos/mes',
      '1 tarjeta de fidelización',
      '1 ubicación',
      'Storefront público + 1 link informativo',
      'WhatsApp link (no Cloud API)',
    ],
    cta: 'Empezá gratis',
    href: '/onboarding',
    primary: false,
  },
  {
    name: 'Pro',
    price: '$29',
    note: 'por mes',
    features: [
      'Pedidos ilimitados',
      'Tarjetas + automatizaciones ilimitadas',
      'Multi-ubicación + multi-staff',
      'Pagos online (Stripe / MP / Wompi)',
      'Dominio propio + analítica avanzada',
      'WhatsApp Cloud API + email transaccional',
    ],
    cta: 'Probar Pro 14 días',
    href: '/onboarding?plan=pro',
    primary: true,
  },
  {
    name: 'Cadena',
    price: 'Custom',
    note: 'desde 5 sucursales',
    features: [
      'Todo lo de Pro',
      'Soporte dedicado + SLA',
      'White-label opcional',
      'Integración POS (Toast, Square, etc.)',
      'Onboarding asistido',
    ],
    cta: 'Contactanos',
    href: 'https://wa.me/573000000000?text=Quiero%20Clubify%20para%20mi%20cadena',
    primary: false,
  },
];

export default function Landing() {
  return (
    <main className="min-h-screen bg-bg">
      {/* ─────────── Header ─────────── */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-bg/80 border-b border-line">
        <div className="mx-auto max-w-6xl px-6 flex items-center justify-between py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-[10px] bg-gradient-to-br from-brand to-fuchsia-600 text-white flex items-center justify-center font-bold text-lg">
              C
            </div>
            <div className="font-bold text-lg tracking-tight">Clubify</div>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm text-mute">
            <a href="#features" className="hover:text-ink">Funciones</a>
            <a href="#how" className="hover:text-ink">Cómo funciona</a>
            <a href="#pricing" className="hover:text-ink">Precios</a>
            <Link href="/m/cafe-del-dia" className="hover:text-ink">Demo en vivo →</Link>
          </nav>
          <div className="flex gap-2">
            <Link className="btn-ghost text-sm" href="/login">
              Ingresar
            </Link>
            <Link className="btn-primary text-sm" href="/onboarding">
              <Icon name="spark" /> Empezar gratis
            </Link>
          </div>
        </div>
      </header>

      {/* ─────────── Hero ─────────── */}
      <section className="mx-auto max-w-6xl px-6 pt-16 pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <div className="inline-flex items-center gap-2 bg-brand-soft text-brand-700 text-xs font-semibold px-3 py-1.5 rounded-full mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
              Nueva versión v3 · Pagos online + dominio propio
            </div>
            <h1 className="text-5xl md:text-6xl font-bold leading-[1.05] tracking-tight">
              El{' '}
              <span className="bg-gradient-to-r from-brand via-fuchsia-500 to-pink-500 bg-clip-text text-transparent">
                sistema operativo
              </span>{' '}
              de tu negocio local.
            </h1>
            <p className="mt-6 text-lg text-mute max-w-lg leading-relaxed">
              Vendé, fidelizá y automatizá desde un solo lugar. Menú digital,
              pedidos a WhatsApp, tarjetas en Apple Wallet, automatizaciones — sin
              programar, sin contratar developer.
            </p>
            <div className="flex gap-3 mt-8">
              <Link className="btn-primary text-base px-5 py-3" href="/onboarding">
                <Icon name="spark" /> Empezar gratis
              </Link>
              <Link
                className="btn-ghost text-base px-5 py-3"
                href="/m/cafe-del-dia"
              >
                Ver demo en vivo →
              </Link>
            </div>
            <div className="flex items-center gap-5 mt-8 text-xs text-mute">
              <div className="flex items-center gap-1.5">
                <Icon name="check" size={14} /> Sin tarjeta
              </div>
              <div className="flex items-center gap-1.5">
                <Icon name="check" size={14} /> Setup 5 min
              </div>
              <div className="flex items-center gap-1.5">
                <Icon name="check" size={14} /> En español
              </div>
            </div>
          </div>

          {/* Wallet card mockup */}
          <div className="flex justify-center">
            <div
              className="pass max-w-[320px] w-full rotate-2 shadow-2xl"
              style={{
                background: 'linear-gradient(135deg,#5B5EEE,#8B5CF6,#C026D3)',
              }}
            >
              <div className="pass-head">
                <div className="pass-logo">
                  <span className="pass-logo-mark">C</span> Café del Día
                </div>
                <div className="pass-side">
                  <div className="pass-side-lbl">SELLOS</div>
                  <div className="pass-side-val">7/10</div>
                </div>
              </div>
              <div
                className="pass-strip h-20"
                style={{
                  background:
                    'linear-gradient(135deg,rgba(0,0,0,.15),rgba(0,0,0,.05))',
                }}
              >
                <div className="strip-stamps">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <div
                      key={i}
                      className="strip-stamp full"
                      style={{ color: '#5B5EEE' }}
                    >
                      ✓
                    </div>
                  ))}
                </div>
              </div>
              <div className="pass-fields">
                <div>
                  <div className="pf-lbl">TITULAR</div>
                  <div className="pf-val">RICARDO PÉREZ</div>
                </div>
                <div className="text-right">
                  <div className="pf-lbl">RECOMPENSA</div>
                  <div className="pf-val text-xs">1 café gratis</div>
                </div>
              </div>
              <div className="pass-bar">
                <div className="w-32 h-32 bg-ink/10 rounded grid place-items-center text-mute text-xs">
                  QR
                </div>
                <div className="pager">
                  <span className="pager-dot" />
                  <span className="pager-dot on" />
                  <span className="pager-dot" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── Features grid ─────────── */}
      <section id="features" className="bg-surface border-y border-line py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center mb-12">
            <div className="text-xs uppercase tracking-[0.18em] text-brand font-semibold mb-3">
              Funciones
            </div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              Todo lo que tu negocio necesita
            </h2>
            <p className="text-mute mt-3 max-w-xl mx-auto">
              Sin pagar 5 herramientas distintas. Una sola plataforma que reemplaza
              menu QR + tarjeta de puntos + CRM + pedidos.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="card card-pad hover:shadow-md transition">
                <div className="w-10 h-10 rounded-lg bg-brand-soft text-brand-700 flex items-center justify-center mb-3">
                  <Icon name={f.icon} />
                </div>
                <div className="font-semibold text-lg">{f.title}</div>
                <div className="text-mute text-sm mt-1.5 leading-relaxed">
                  {f.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── How it works ─────────── */}
      <section id="how" className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center mb-12">
            <div className="text-xs uppercase tracking-[0.18em] text-brand font-semibold mb-3">
              Cómo funciona
            </div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              De cero a vendiendo en 10 minutos
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {STEPS.map((s) => (
              <div key={s.n} className="relative">
                <div className="text-7xl font-bold text-brand-soft leading-none">
                  {s.n}
                </div>
                <div className="font-semibold text-lg mt-2">{s.title}</div>
                <div className="text-mute text-sm mt-1.5 leading-relaxed">
                  {s.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── Live demo CTA ─────────── */}
      <section className="bg-gradient-to-br from-brand via-indigo-600 to-fuchsia-600 py-16">
        <div className="mx-auto max-w-4xl px-6 text-center text-white">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            Probalo sin registrarte
          </h2>
          <p className="mt-3 text-white/80 max-w-xl mx-auto">
            Te dejamos un café-bar listo con productos, pedidos, automatizaciones
            y tarjetas. Hacé un pedido, escaneá el QR, mirá los reportes — todo
            real.
          </p>
          <div className="flex gap-3 justify-center mt-6 flex-wrap">
            <Link
              href="/m/cafe-del-dia"
              className="bg-white text-brand-700 font-semibold px-5 py-3 rounded-pill"
            >
              🛒 Storefront del cliente
            </Link>
            <Link
              href="/login"
              className="bg-white/10 hover:bg-white/20 text-white font-semibold px-5 py-3 rounded-pill border border-white/30"
            >
              📊 Panel del dueño →
            </Link>
          </div>
          <div className="mt-6 text-xs text-white/60">
            Login demo: <code className="bg-white/10 px-2 py-0.5 rounded">demo@clubify.local</code>{' '}
            / <code className="bg-white/10 px-2 py-0.5 rounded">Demo123!</code>
          </div>
        </div>
      </section>

      {/* ─────────── Pricing ─────────── */}
      <section id="pricing" className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center mb-12">
            <div className="text-xs uppercase tracking-[0.18em] text-brand font-semibold mb-3">
              Precios
            </div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              Empezá gratis. Pagá cuando crezcas.
            </h2>
            <p className="text-mute mt-3 max-w-xl mx-auto">
              Sin contratos. Cancelá cuando quieras. Migración asistida.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl mx-auto">
            {PRICING.map((p) => (
              <div
                key={p.name}
                className={`card card-pad relative ${
                  p.primary ? 'ring-2 ring-brand shadow-lg scale-[1.02]' : ''
                }`}
              >
                {p.primary && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand text-white text-xs font-semibold px-3 py-1 rounded-full">
                    Recomendado
                  </div>
                )}
                <div className="font-bold text-lg">{p.name}</div>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-4xl font-bold">{p.price}</span>
                  <span className="text-mute text-sm">/{p.note}</span>
                </div>
                <ul className="mt-5 space-y-2 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Icon name="check" size={14} className="text-ok mt-0.5 flex-none" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href={p.href}
                  className={`block text-center mt-6 px-5 py-2.5 rounded-pill font-semibold text-sm ${
                    p.primary
                      ? 'bg-brand text-white'
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

      {/* ─────────── Final CTA ─────────── */}
      <section className="border-t border-line py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            Tu negocio merece tecnología que vende
          </h2>
          <p className="text-mute mt-3 leading-relaxed">
            5 minutos para tu primer pedido. Sin tarjeta, sin compromiso. Y si
            no te sirve, te ayudamos a exportar todo y migrar.
          </p>
          <Link
            href="/onboarding"
            className="btn-primary text-base px-6 py-3 mt-6 inline-flex"
          >
            <Icon name="spark" /> Crear mi negocio gratis
          </Link>
        </div>
      </section>

      {/* ─────────── Footer ─────────── */}
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-sm">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-brand text-white flex items-center justify-center font-bold text-sm">
                  C
                </div>
                <span className="font-bold">Clubify</span>
              </div>
              <p className="text-mute text-xs leading-relaxed">
                El sistema operativo de tu negocio local.
              </p>
            </div>
            <div>
              <div className="font-semibold mb-2">Producto</div>
              <ul className="space-y-1.5 text-mute">
                <li><a href="#features" className="hover:text-ink">Funciones</a></li>
                <li><a href="#pricing" className="hover:text-ink">Precios</a></li>
                <li><Link href="/m/cafe-del-dia" className="hover:text-ink">Demo</Link></li>
              </ul>
            </div>
            <div>
              <div className="font-semibold mb-2">Crecé con nosotros</div>
              <ul className="space-y-1.5 text-mute">
                <li><Link href="/refer" className="hover:text-ink">Programa de referidos</Link></li>
                <li><Link href="/onboarding" className="hover:text-ink">Empezar gratis</Link></li>
                <li><Link href="/login" className="hover:text-ink">Ingresar</Link></li>
              </ul>
            </div>
            <div>
              <div className="font-semibold mb-2">Soporte</div>
              <ul className="space-y-1.5 text-mute">
                <li><a href="https://wa.me/573000000000" className="hover:text-ink">WhatsApp</a></li>
                <li><a href="mailto:hola@soyclubify.com" className="hover:text-ink">hola@soyclubify.com</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-line mt-8 pt-6 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-mute">
            <div>© {new Date().getFullYear()} Clubify · Hecho en LATAM</div>
            <div className="flex gap-4">
              <a href="#" className="hover:text-ink">Términos</a>
              <a href="#" className="hover:text-ink">Privacidad</a>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
