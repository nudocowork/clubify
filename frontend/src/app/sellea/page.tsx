import type { Metadata } from 'next';
import { SelleaLogo, SelleaMark } from '@/components/sellea/SelleaLogo';

/**
 * Landing de marketing de Sellea (marca blanca) — equivalente a la de Clubify
 * pero con la identidad de Sellea (manual v1.0). Autocontenida: paleta coral /
 * tinta / crema, tipografía Poppins, voz "Cada compra deja su sello".
 *
 * Preview: /sellea  ·  Producción futura: www.selleala.com (rewrite del host).
 * ⚠️ El logo es una aproximación SVG — reemplazar por el asset oficial.
 */

const C = {
  coral: '#FF4D3D',
  coralDark: '#E63521',
  tinta: '#1A1033',
  crema: '#FFF6F0',
  gris: '#6B6478',
  white: '#FFFFFF',
};

export const metadata: Metadata = {
  title: 'Sellea · Una marca para fidelizar',
  description:
    'Sistema de fidelización digital. Tarjetas de sellos en el wallet, pedidos por WhatsApp y automatizaciones para que tus clientes vuelvan. Cada compra deja su sello.',
};

const FONT = "'Poppins', sans-serif";

const PILLARS = [
  'Tarjetas de sellos',
  'Wallet Apple & Google',
  'Pedidos por WhatsApp',
  'Automatizaciones',
  'CRM de clientes',
];

const STATS = [
  { value: '+40%', label: 'Más clientes recurrentes' },
  { value: '0', label: 'Tarjetas de papel perdidas' },
  { value: '2 min', label: 'Para sellar una compra' },
  { value: '24/7', label: 'Tu programa funcionando solo' },
];

const FEATURES = [
  {
    title: 'Sellos en el wallet',
    desc: 'Tus clientes guardan su tarjeta de sellos en Apple Wallet y Google Wallet. Sin apps, sin plástico, siempre en el bolsillo.',
    icon: 'stamp',
  },
  {
    title: 'Cada compra suma',
    desc: 'Escaneás, sellás y el progreso se actualiza al instante en el teléfono del cliente. Cuando completa, redime su premio.',
    icon: 'check',
  },
  {
    title: 'Pedidos por WhatsApp',
    desc: 'Tu carta digital recibe pedidos que entran ordenados, suenan y los confirmás. Menos caos, más ventas.',
    icon: 'chat',
  },
  {
    title: 'Vuelve solo',
    desc: 'Automatizaciones que recuerdan, felicitan cumpleaños y reactivan clientes dormidos. El sistema trabaja por vos.',
    icon: 'spark',
  },
  {
    title: 'Conocé a tus clientes',
    desc: 'Un CRM simple con quién vuelve, cuánto gasta y cuándo. Decisiones con datos, no a ojo.',
    icon: 'users',
  },
  {
    title: 'Tu marca, no la nuestra',
    desc: 'Tu logo, tus colores, tu dominio. Tus clientes ven tu negocio en cada punto de contacto.',
    icon: 'brand',
  },
];

// Frases del "verbo Sellea" — la parte coral resaltada según el manual.
const VERBS = [
  { pre: '"¿Me ', coral: 'selleas', post: '?"' },
  { pre: '"Ya te ', coral: 'selleé', post: '."' },
  { pre: '"', coral: 'Selléala', post: '."' },
];

const TESTIMONIALS = [
  {
    quote:
      'Pasé de la tarjetita de cartón a sellos en el celular. Mis clientes vuelven más porque ven cuánto les falta para el premio.',
    name: 'Valentina R.',
    role: 'Café Aurora · Guadalajara',
    avatar: '☕',
  },
  {
    quote:
      'Lo configuré en una tarde sin saber nada de tecnología. Ahora cada compra deja su sello y la gente regresa sola.',
    name: 'Mateo G.',
    role: 'Birria El Patrón · Monterrey',
    avatar: '🌮',
  },
  {
    quote:
      'Los pedidos por WhatsApp dejaron de ser un desorden. Entran, suenan, los confirmo. Vendí más sin contratar a nadie.',
    name: 'Daniela P.',
    role: 'Postres Lila · CDMX',
    avatar: '🍰',
  },
];

function FeatureIcon({ name }: { name: string }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: C.coral,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'check':
      return (
        <svg {...common}>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      );
    case 'chat':
      return (
        <svg {...common}>
          <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
        </svg>
      );
    case 'spark':
      return (
        <svg {...common}>
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
        </svg>
      );
    case 'users':
      return (
        <svg {...common}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'brand':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="3.5" fill={C.coral} stroke="none" />
        </svg>
      );
    case 'stamp':
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="9" r="5" />
          <circle cx="12" cy="9" r="2" fill={C.coral} stroke="none" />
          <path d="M5 21h14M7 21v-2.5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2V21" />
        </svg>
      );
  }
}

export default function SelleaLanding() {
  return (
    <div style={{ fontFamily: FONT, background: C.white, color: C.tinta }}>
      {/* ─────────── Nav ─────────── */}
      <header
        className="sticky top-0 z-50"
        style={{ background: 'rgba(255,255,255,.85)', backdropFilter: 'blur(10px)', borderBottom: `1px solid #eee6df` }}
      >
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <SelleaLogo size={30} />
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium" style={{ color: C.gris }}>
            <a href="#como" className="hover:opacity-70 transition">Cómo funciona</a>
            <a href="#beneficios" className="hover:opacity-70 transition">Beneficios</a>
            <a href="#clientes" className="hover:opacity-70 transition">Clientes</a>
          </nav>
          <a
            href="#empezar"
            className="text-sm font-bold px-4 py-2 rounded-full text-white transition active:scale-95"
            style={{ background: C.coral }}
          >
            Empieza ahora
          </a>
        </div>
      </header>

      {/* ─────────── Hero ─────────── */}
      <section className="relative overflow-hidden" style={{ background: C.crema }}>
        <div
          aria-hidden
          className="absolute pointer-events-none"
          style={{
            top: -180, right: -160, width: 520, height: 520, borderRadius: '50%',
            border: `1px solid ${C.coral}22`,
          }}
        />
        <div className="max-w-6xl mx-auto px-5 py-20 md:py-28 grid lg:grid-cols-2 gap-12 items-center relative">
          <div>
            <span
              className="inline-flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded-full mb-5"
              style={{ background: '#fff', color: C.coralDark, border: `1px solid ${C.coral}33` }}
            >
              ● Sistema de fidelización digital
            </span>
            <h1
              className="font-extrabold leading-[1.03]"
              style={{ fontSize: 'clamp(40px, 6vw, 64px)', letterSpacing: '-1.5px' }}
            >
              Una marca<br />para <span style={{ color: C.coral }}>fidelizar.</span>
            </h1>
            <p className="mt-5 text-lg max-w-md" style={{ color: C.gris }}>
              Tarjetas de sellos en el wallet, pedidos por WhatsApp y
              automatizaciones para que tus clientes vuelvan. Cada compra deja su
              sello.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {PILLARS.map((p) => (
                <span
                  key={p}
                  className="text-[13px] font-medium px-3 py-1.5 rounded-full"
                  style={{ background: '#fff', color: C.tinta, border: '1px solid #eee6df' }}
                >
                  {p}
                </span>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap gap-3" id="empezar">
              <a
                href="https://wa.me/"
                className="font-bold px-6 py-3.5 rounded-full text-white transition active:scale-95"
                style={{ background: `linear-gradient(180deg, ${C.coral}, ${C.coralDark})` }}
              >
                Empieza ahora
              </a>
              <a
                href="#como"
                className="font-bold px-6 py-3.5 rounded-full transition active:scale-95"
                style={{ background: '#fff', color: C.tinta, border: '1px solid #e3dad2' }}
              >
                Ver cómo funciona
              </a>
            </div>
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[13px]" style={{ color: C.gris }}>
              <span>✓ Activación inmediata</span>
              <span>✓ Sin permanencia</span>
              <span>✓ Soporte en español</span>
            </div>
          </div>

          {/* Visual: tarjeta de sellos estilo wallet */}
          <div className="relative flex justify-center lg:justify-end">
            <WalletCard />
          </div>
        </div>
      </section>

      {/* ─────────── Stats ─────────── */}
      <section style={{ background: C.white, borderBottom: '1px solid #f0e9e2' }}>
        <div className="max-w-6xl mx-auto px-5 py-12 grid grid-cols-2 md:grid-cols-4 gap-6">
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-3xl md:text-4xl font-extrabold" style={{ color: C.coral, letterSpacing: '-1px' }}>
                {s.value}
              </div>
              <div className="text-[13px] mt-1" style={{ color: C.gris }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ─────────── Features ─────────── */}
      <section id="beneficios" className="py-20 md:py-28" style={{ background: C.white }}>
        <div className="max-w-6xl mx-auto px-5">
          <div className="max-w-2xl">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: C.coral }}>
              Beneficios
            </span>
            <h2 className="mt-2 font-extrabold leading-[1.1]" style={{ fontSize: 'clamp(28px, 4vw, 44px)', letterSpacing: '-1px' }}>
              Todo para que tus clientes vuelvan.
            </h2>
            <p className="mt-3 text-lg" style={{ color: C.gris }}>
              Fideliza con inteligencia. Sellea reúne sellos, pedidos y
              automatizaciones en un solo lugar — con tu marca al frente.
            </p>
          </div>
          <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-3xl p-6 transition hover:-translate-y-0.5"
                style={{ background: C.crema, border: '1px solid #f0e7df' }}
              >
                <div
                  className="w-11 h-11 rounded-2xl flex items-center justify-center mb-4"
                  style={{ background: '#fff', border: `1px solid ${C.coral}22` }}
                >
                  <FeatureIcon name={f.icon} />
                </div>
                <h3 className="font-bold text-lg" style={{ color: C.tinta }}>{f.title}</h3>
                <p className="mt-1.5 text-[14.5px] leading-relaxed" style={{ color: C.gris }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── El verbo Sellea (band oscura) ─────────── */}
      <section id="como" className="py-20 md:py-28" style={{ background: C.tinta, color: C.white }}>
        <div className="max-w-6xl mx-auto px-5 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: C.coral }}>
              El verbo Sellea
            </span>
            <h2 className="mt-3 font-extrabold leading-[1.05]" style={{ fontSize: 'clamp(34px, 5vw, 56px)', letterSpacing: '-1.5px' }}>
              {VERBS.map((v, i) => (
                <span key={i} className="block">
                  {v.pre}
                  <span style={{ color: C.coral }}>{v.coral}</span>
                  {v.post}
                </span>
              ))}
            </h2>
            <p className="mt-5 text-lg max-w-md" style={{ color: '#c9c3d4' }}>
              El nombre funciona como verbo: cercano, memorable y propio. Así de
              natural es fidelizar con Sellea — cada compra deja su sello.
            </p>
          </div>

          {/* Pasos */}
          <div className="space-y-4">
            {[
              { n: '1', t: 'El cliente compra', d: 'Escaneás su tarjeta wallet o se la creás al instante.' },
              { n: '2', t: 'Sellás la compra', d: 'El sello se suma y aparece al toque en su teléfono.' },
              { n: '3', t: 'Vuelve por su premio', d: 'Cuando completa, redime. Y el ciclo arranca de nuevo.' },
            ].map((s) => (
              <div
                key={s.n}
                className="flex items-start gap-4 rounded-2xl p-5"
                style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)' }}
              >
                <div
                  className="w-9 h-9 rounded-full flex-none flex items-center justify-center font-extrabold"
                  style={{ background: C.coral, color: '#fff' }}
                >
                  {s.n}
                </div>
                <div>
                  <div className="font-bold">{s.t}</div>
                  <div className="text-[14.5px] mt-0.5" style={{ color: '#c9c3d4' }}>{s.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── Testimonios ─────────── */}
      <section id="clientes" className="py-20 md:py-28" style={{ background: C.crema }}>
        <div className="max-w-6xl mx-auto px-5">
          <div className="text-center max-w-2xl mx-auto">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: C.coral }}>
              Clientes
            </span>
            <h2 className="mt-2 font-extrabold leading-[1.1]" style={{ fontSize: 'clamp(28px, 4vw, 44px)', letterSpacing: '-1px' }}>
              Negocios que ya sellean.
            </h2>
          </div>
          <div className="mt-12 grid md:grid-cols-3 gap-5">
            {TESTIMONIALS.map((t) => (
              <div key={t.name} className="rounded-3xl p-6" style={{ background: '#fff', border: '1px solid #f0e7df' }}>
                <p className="text-[15px] leading-relaxed" style={{ color: C.tinta }}>"{t.quote}"</p>
                <div className="mt-5 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl" style={{ background: C.crema }}>
                    {t.avatar}
                  </div>
                  <div>
                    <div className="font-bold text-sm" style={{ color: C.tinta }}>{t.name}</div>
                    <div className="text-[12.5px]" style={{ color: C.gris }}>{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── CTA final ─────────── */}
      <section className="py-20 md:py-24" style={{ background: C.white }}>
        <div className="max-w-5xl mx-auto px-5">
          <div
            className="rounded-[32px] px-8 py-14 md:py-16 text-center relative overflow-hidden"
            style={{ background: C.tinta, color: C.white }}
          >
            <div className="flex justify-center mb-6">
              <SelleaMark size={56} variant="dark" />
            </div>
            <h2 className="font-extrabold leading-[1.08]" style={{ fontSize: 'clamp(30px, 4.5vw, 48px)', letterSpacing: '-1.5px' }}>
              Cada compra deja su <span style={{ color: C.coral }}>sello.</span>
            </h2>
            <p className="mt-4 text-lg max-w-xl mx-auto" style={{ color: '#c9c3d4' }}>
              Empieza hoy y haz que tus clientes vuelvan. Sin permanencia,
              activación inmediata y soporte en español.
            </p>
            <div className="mt-8 flex flex-wrap gap-3 justify-center">
              <a
                href="https://wa.me/"
                className="font-bold px-7 py-3.5 rounded-full text-white transition active:scale-95"
                style={{ background: `linear-gradient(180deg, ${C.coral}, ${C.coralDark})` }}
              >
                Empieza ahora
              </a>
              <a
                href="https://www.selleala.com"
                className="font-bold px-7 py-3.5 rounded-full transition active:scale-95"
                style={{ background: 'rgba(255,255,255,.08)', color: '#fff', border: '1px solid rgba(255,255,255,.18)' }}
              >
                Agendar una demo
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── Footer ─────────── */}
      <footer style={{ background: C.tinta, color: '#c9c3d4', borderTop: '1px solid rgba(255,255,255,.06)' }}>
        <div className="max-w-6xl mx-auto px-5 py-14">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
            <div>
              <SelleaLogo size={32} variant="dark" />
              <p className="mt-3 text-sm max-w-xs">Cada compra deja su sello.</p>
            </div>
            <div className="flex flex-wrap gap-x-10 gap-y-3 text-sm">
              <a href="https://www.selleala.com" className="hover:text-white transition">www.selleala.com</a>
              <a href="https://instagram.com/selleala" className="hover:text-white transition">@selleala</a>
              <a href="mailto:hola@selleala.com" className="hover:text-white transition">hola@selleala.com</a>
            </div>
          </div>
          <div className="mt-10 pt-6 text-[12.5px] flex flex-wrap justify-between gap-2" style={{ borderTop: '1px solid rgba(255,255,255,.06)' }}>
            <span>© {new Date().getFullYear()} Sellea. Todos los derechos reservados.</span>
            <span>Sistema de fidelización digital.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** Mock de tarjeta de sellos estilo wallet para el hero. */
function WalletCard() {
  return (
    <div
      className="w-[300px] rounded-[26px] p-6 shadow-2xl"
      style={{ background: C.tinta, color: C.white, boxShadow: '0 30px 60px -20px rgba(26,16,51,.45)' }}
    >
      <div className="flex items-center justify-between">
        <SelleaMark size={30} variant="dark" />
        <span className="text-[11px] font-semibold px-2 py-1 rounded-full" style={{ background: 'rgba(255,255,255,.1)' }}>
          Tarjeta de sellos
        </span>
      </div>
      <div className="mt-6">
        <div className="text-[13px]" style={{ color: '#c9c3d4' }}>Tu progreso</div>
        <div className="text-2xl font-extrabold mt-0.5">8 de 10 sellos</div>
      </div>
      <div className="mt-4 grid grid-cols-5 gap-2.5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="aspect-square rounded-full flex items-center justify-center"
            style={{
              background: i < 8 ? C.coral : 'rgba(255,255,255,.07)',
              border: i < 8 ? 'none' : '1px solid rgba(255,255,255,.14)',
            }}
          >
            {i < 8 && (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            )}
          </div>
        ))}
      </div>
      <div className="mt-5 text-[13px] rounded-xl px-3 py-2.5 text-center font-semibold" style={{ background: 'rgba(255,77,61,.14)', color: '#ffb3aa' }}>
        ¡Te faltan 2 para tu premio! 🎉
      </div>
    </div>
  );
}
