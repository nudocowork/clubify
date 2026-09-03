import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { FadeIn } from '@/components/FadeIn';
import { HeroTrio } from '@/components/HeroTrio';

/**
 * Landing de FIDELITY = página de venta de MARCAS BLANCAS.
 * Vende la OPORTUNIDAD de marca blanca: que un emprendedor/agencia lance su
 * propia plataforma de fidelización + CRM con su marca, dominio y precios sobre
 * nuestra tecnología. NO vende el producto al negocio final (eso es /fideliso).
 *
 * Ubicación: landing pública de soyfidelity.com — el middleware reescribe la
 * raíz del host (antes → /en-construccion, ahora → /fidelity). El master admin
 * sigue en soyfidelity.com/login. Preview: soyclubify.com/fidelity.
 *
 * ESTILO — clon de wazzap.mx: tema claro y jugetón, VERDE #22C55E como color de
 * energía (= verde nativo de la plataforma, sin override), cajas verdes tipo
 * "marcador" detrás de palabras clave del titular, mascota redonda tipo blob,
 * bandas verdes a sangre completa, tarjetas redondeadas ~16px, botones pill,
 * tipografía extrabold, emojis y micro-animaciones (float/blob/hover-lift).
 * Respeta prefers-reduced-motion. Server component SIN llamadas al API.
 *
 * Para cambiar el acento verde por el azul Fidelity, basta con recolorear los
 * tokens `brand` (hoy verde nativo). CTA principal: "Agenda una demo" (Calendly,
 * placeholder). Precios: a cotización. Contactos y demo en el bloque CONTACT.
 */
export const metadata: Metadata = {
  title: 'Fidelity · Lanza tu propia plataforma de fidelización y CRM (marca blanca)',
  description:
    'Crea tu propia plataforma SaaS de fidelización, tienda, CRM, automatizaciones y domicilios — con tu marca, tu dominio y tus precios. Tú te quedas con el ingreso recurrente; nosotros ponemos la tecnología.',
};

// ─── CONTACTO / CTA — EDITA AQUÍ. Reemplaza demoUrl por tu Calendly real. ───
const CONTACT = {
  demoUrl: 'https://calendly.com/fidelity/demo', // TODO: enlace real de Calendly
  whatsapp:
    'https://wa.me/?text=' +
    encodeURIComponent('Hola Fidelity, quiero lanzar mi propia marca blanca'),
  email: 'mailto:hola@soyfidelity.com',
  instagram: 'https://www.instagram.com/soyfidelity',
};

const INTEGRATIONS = [
  'Apple Wallet', 'Google Wallet', 'Stripe', 'Hotmart', 'WhatsApp',
  'SMS', 'Google Maps', 'Instagram', 'PDF417', 'Web Push',
];

const STATS = [
  { value: '+150', label: 'Negocios activos en la plataforma' },
  { value: '+30K', label: 'Clientes con tarjeta en su Wallet' },
  { value: '100%', label: 'Tu marca — 0 menciones nuestras' },
  { value: '~10 días', label: 'Para salir al mercado con tu marca' },
];

const FEATURES = [
  { emoji: '💳', title: 'Tarjetas en Apple & Google Wallet', desc: 'Sellos, puntos y niveles que viven en el teléfono del cliente. Push por geolocalización.' },
  { emoji: '🛍️', title: 'Tienda y menús con IA', desc: 'Storefront por negocio, menús digitales, pedidos por WhatsApp y links tipo bio.' },
  { emoji: '🧑‍🤝‍🧑', title: 'CRM de clientes', desc: 'Cumpleaños, historial, segmentación y recompra. Tus negocios saben quién vuelve.' },
  { emoji: '⚡', title: 'Automatizaciones SMS y WhatsApp', desc: 'Constructor visual de flujos: recordatorios, campañas y respuestas automáticas.' },
  { emoji: '🛵', title: 'Red de domicilios', desc: 'Repartos con seguimiento en vivo, chat a 3 vías y comisiones por entrega.' },
  { emoji: '📅', title: 'Reservas', desc: 'Mesas y zonas, confirmaciones automáticas y avisos al negocio.' },
  { emoji: '📈', title: 'Referidos y comisiones', desc: 'Afiliados multinivel: vendedores, embajadores e influencers con comisiones automáticas.' },
  { emoji: '🎛️', title: 'Panel maestro', desc: 'Administra todos tus negocios, cobros, métricas y facturación en un solo lugar.' },
];

const WHY = [
  { emoji: '🏷️', title: 'Tu marca, no la nuestra', desc: 'Logo, colores, dominio propio y correos con tu identidad. Cero menciones nuestras: tus clientes solo ven TU marca.' },
  { emoji: '💰', title: 'Ingresos recurrentes', desc: 'Tú fijas los precios y cobras la suscripción mensual a cada negocio. El margen y la relación son tuyos.' },
  { emoji: '💳', title: 'Tu propia pasarela', desc: 'Conecta Stripe o Hotmart con tus llaves. El dinero entra directo a tu cuenta — nosotros no tocamos tus cobros.' },
  { emoji: '🛠️', title: 'Sin desarrollo ni mantenimiento', desc: 'No construyes ni mantienes nada. Nosotros operamos la infraestructura, actualizaciones y soporte por detrás.' },
];

const STEPS = [
  { title: 'Agendamos una demo', desc: 'Vemos la plataforma juntos y definimos tu marca: nombre, logo, colores y dominio.' },
  { title: 'Configuramos tu plataforma', desc: 'Dejamos lista tu instancia con tu identidad, conectada a tu dominio y a tu pasarela.' },
  { title: 'Cargas o vendes negocios', desc: 'Sumas comercios a tu red — tú o tu equipo de afiliados con el sistema de comisiones.' },
  { title: 'Cobras recurrente', desc: 'Facturas suscripciones mes a mes con tu marca. Nosotros mantenemos la tecnología 24/7.' },
];

const BRANDS = ['Clubify', 'Sellea', 'Fideliso', 'Fidelity'];

const COMPARE: { label: string; fidelity: string; own: string }[] = [
  { label: 'Tiempo para salir al mercado', fidelity: '~10 días', own: '6–12 meses' },
  { label: 'Costo de desarrollo', fidelity: '$0', own: '$50k+' },
  { label: 'Wallet + tienda + CRM + domicilios', fidelity: 'Todo incluido', own: 'Construir cada módulo' },
  { label: 'Servidores y mantenimiento', fidelity: 'Los operamos nosotros', own: 'Tu equipo técnico' },
  { label: 'Actualizaciones y nuevas funciones', fidelity: 'Automáticas', own: 'Las haces tú' },
  { label: 'Soporte técnico', fidelity: 'Incluido', own: 'Por tu cuenta' },
];

const PLANS = [
  { name: 'Starter', emoji: '🚀', tagline: 'Lanza tu marca', highlight: false, features: ['Tu marca, logo y colores', 'Dominio propio (tumarca.com)', 'Plataforma completa: Wallet, tienda, CRM', 'Hasta cierto número de negocios', 'Soporte por chat'] },
  { name: 'Pro', emoji: '⭐', tagline: 'Escala tu red', highlight: true, features: ['Todo lo de Starter', 'Negocios ilimitados', 'Tu propia pasarela (Stripe / Hotmart)', 'Sistema de referidos y comisiones', 'Automatizaciones SMS y WhatsApp', 'Soporte prioritario'] },
  { name: 'Enterprise', emoji: '🏢', tagline: 'Marca a medida', highlight: false, features: ['Todo lo de Pro', 'Personalización avanzada', 'Onboarding dedicado', 'Acompañamiento comercial', 'SLA prioritario'] },
];

const FAQS = [
  { q: '¿Qué es exactamente una marca blanca?', a: 'Es tu propia plataforma SaaS de fidelización y CRM funcionando bajo tu marca. Tú la vendes a negocios como si fuera tuya; nosotros ponemos y mantenemos la tecnología por detrás. Tus clientes nunca ven quién está detrás.' },
  { q: '¿Los negocios verán "Fidelity" o "Clubify" en algún lado?', a: 'No. La plataforma sale 100% con tu marca: tu logo, tus colores, tu dominio y tus correos. Está diseñada para que no haya ninguna fuga de nuestra marca hacia tus clientes.' },
  { q: '¿Puedo poner mis propios precios?', a: 'Sí. Tú defines cuánto cobras a cada negocio y con qué periodicidad. El margen es tuyo. Nosotros te cobramos por la plataforma, no por lo que tú factures.' },
  { q: '¿Quién cobra a los negocios?', a: 'Tú, con tu propia pasarela de pago (Stripe o Hotmart con tus llaves). El dinero entra directo a tu cuenta — nosotros no intermediamos tus cobros.' },
  { q: '¿Necesito saber programar?', a: 'No. No construyes ni mantienes nada técnico. Nosotros operamos servidores, actualizaciones y soporte. Tú te enfocas en tu marca y en vender.' },
  { q: '¿Cuánto tarda en estar lista mi marca?', a: 'Normalmente alrededor de 10 días desde que definimos tu identidad y dominio. En la demo te damos un plazo concreto según tu caso.' },
  { q: '¿Puedo tener mi propio equipo de vendedores?', a: 'Sí. La plataforma incluye un sistema de referidos y comisiones multinivel (vendedores, embajadores, influencers) para que armes tu propia fuerza comercial.' },
];

// Animaciones estilo wazzap (float, blob, hover-lift). Sin override de color:
// la marca usa el VERDE nativo #22C55E de los tokens `brand`.
const FDY_CSS = `
.fdy-float{animation:fdyFloat 4s ease-in-out infinite}
.fdy-float-2{animation:fdyFloat 5.5s ease-in-out infinite}
.fdy-float-3{animation:fdyFloat 4.8s ease-in-out infinite}
.fdy-blob{animation:fdyBlob 16s ease-in-out infinite}
.fdy-lift{transition:transform .25s ease,box-shadow .25s ease}
.fdy-lift:hover{transform:translateY(-6px);box-shadow:0 20px 44px -20px rgba(34,197,94,.45)}
@keyframes fdyFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}}
@keyframes fdyBlob{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(24px,-18px) scale(1.08)}66%{transform:translate(-18px,12px) scale(.94)}}
@media (prefers-reduced-motion: reduce){.fdy-float,.fdy-float-2,.fdy-float-3,.fdy-blob{animation:none!important}}
`;

// Mascota tipo wazzap: blob redondo verde y amistoso.
function Mascot({ className = '', size = 200 }: { className?: string; size?: number }) {
  return (
    <svg className={className} width={size} height={size * 1.09} viewBox="0 0 220 240" fill="none" aria-hidden role="img">
      <ellipse cx="110" cy="230" rx="72" ry="10" fill="#0f172a" opacity="0.08" />
      <rect x="24" y="34" width="172" height="176" rx="76" fill="#22C55E" />
      <rect x="24" y="34" width="172" height="176" rx="76" fill="url(#fdyBelly)" opacity="0.35" />
      <ellipse cx="60" cy="150" rx="12" ry="9" fill="#fca5a5" opacity="0.75" />
      <ellipse cx="160" cy="150" rx="12" ry="9" fill="#fca5a5" opacity="0.75" />
      <circle cx="82" cy="112" r="27" fill="#fff" />
      <circle cx="138" cy="112" r="27" fill="#fff" />
      <circle cx="88" cy="116" r="12" fill="#0f172a" />
      <circle cx="144" cy="116" r="12" fill="#0f172a" />
      <circle cx="84" cy="110" r="4" fill="#fff" />
      <circle cx="140" cy="110" r="4" fill="#fff" />
      <path d="M92 158 q18 20 36 0" stroke="#0f172a" strokeWidth="6" fill="none" strokeLinecap="round" />
      {/* tarjeta de fidelidad en la mano */}
      <g transform="rotate(-12 168 186)">
        <rect x="146" y="168" width="52" height="34" rx="7" fill="#fff" stroke="#15803D" strokeWidth="3" />
        <path d="M172 174 l3 6 6 .8 -4.5 4.4 1 6.3 -5.5-3 -5.5 3 1-6.3 -4.5-4.4 6-.8z" fill="#22C55E" />
      </g>
      <defs>
        <linearGradient id="fdyBelly" x1="0" y1="34" x2="0" y2="210" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// Palabra resaltada tipo "marcador" verde (firma visual de wazzap).
function Mark({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`relative inline-block bg-brand text-white rounded-xl px-3 py-0.5 -rotate-1 shadow-sm ${className}`}>
      {children}
    </span>
  );
}

function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-extrabold tracking-tight ${className}`}>
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-xl bg-brand text-white text-sm">★</span>
      <span className="text-ink">Fidelity</span>
    </span>
  );
}

const btnPrimary = 'inline-flex items-center justify-center bg-brand text-white font-bold rounded-pill shadow-lg hover:-translate-y-0.5 transition';
const btnGhost = 'inline-flex items-center justify-center bg-white border-2 border-line text-ink font-bold rounded-pill hover:border-ink/30 hover:-translate-y-0.5 transition';

export default function FidelityLandingPage() {
  return (
    <main className="min-h-screen bg-white text-ink overflow-x-hidden">
      <style dangerouslySetInnerHTML={{ __html: FDY_CSS }} />

      {/* ─────────── Header ─────────── */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-white/85 border-b border-line/80">
        <div className="mx-auto max-w-7xl px-6 flex items-center justify-between h-16">
          <Link href="/" aria-label="Fidelity"><Wordmark className="text-xl" /></Link>
          <nav className="hidden lg:flex items-center gap-8 text-[14px] font-semibold text-mute">
            <a href="#plataforma" className="hover:text-ink">Plataforma</a>
            <a href="#comparativa" className="hover:text-ink">Vs. hacerlo solo</a>
            <a href="#como-funciona" className="hover:text-ink">Cómo funciona</a>
            <a href="#planes" className="hover:text-ink">Planes</a>
            <a href="#faq" className="hover:text-ink">Preguntas</a>
          </nav>
          <div className="flex gap-2 items-center">
            <Link className="hidden sm:inline-flex text-sm font-medium text-mute hover:text-ink" href="/login">Iniciar sesión</Link>
            <a className={`${btnPrimary} text-sm px-4 py-2.5`} href={CONTACT.demoUrl} target="_blank" rel="noreferrer">Agenda una demo</a>
          </div>
        </div>
      </header>

      {/* ─────────── Hero ─────────── */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="fdy-blob absolute -top-24 -left-24 w-[38rem] h-[38rem] rounded-full opacity-60" style={{ background: 'radial-gradient(circle, rgba(34,197,94,0.22), transparent 65%)' }} />
          <div className="fdy-blob absolute top-0 -right-24 w-[34rem] h-[34rem] rounded-full opacity-50" style={{ background: 'radial-gradient(circle, rgba(74,222,128,0.20), transparent 65%)', animationDelay: '3s' }} />
        </div>

        <div className="mx-auto max-w-6xl px-6 pt-14 pb-8">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-10 items-center">
            {/* Texto */}
            <div className="text-center lg:text-left">
              <div className="inline-flex items-center gap-2 bg-brand-soft text-brand-700 border border-brand/20 text-xs font-bold px-3.5 py-1.5 rounded-full mb-6">
                🚀 Programa de marca blanca · SaaS listo para vender
              </div>
              <h1 className="text-[38px] md:text-[52px] lg:text-[58px] font-extrabold leading-[1.05] tracking-tight">
                Lanza tu propia plataforma de fidelización y CRM con{' '}
                <Mark>tu marca</Mark>.
              </h1>
              <p className="mt-6 text-lg lg:text-xl text-mute max-w-xl mx-auto lg:mx-0 leading-relaxed">
                Tarjetas en Wallet, tienda, CRM, automatizaciones y domicilios —
                todo bajo tu nombre y tu dominio. Tú te quedas con el ingreso
                recurrente; nosotros ponemos la tecnología. 💳
              </p>
              <div className="flex gap-3 mt-8 flex-wrap justify-center lg:justify-start">
                <a className={`${btnPrimary} text-base px-7 py-4`} href={CONTACT.demoUrl} target="_blank" rel="noreferrer">Agenda una demo →</a>
                <a className={`${btnGhost} text-base px-7 py-4`} href="#plataforma">Ver la plataforma</a>
              </div>
              <div className="flex items-center gap-5 mt-7 text-xs text-mute flex-wrap justify-center lg:justify-start">
                <div className="flex items-center gap-1.5"><Icon name="check" size={14} className="text-ok" /> Sin desarrollo</div>
                <div className="flex items-center gap-1.5"><Icon name="check" size={14} className="text-ok" /> Listo en ~10 días</div>
                <div className="flex items-center gap-1.5"><Icon name="check" size={14} className="text-ok" /> 100% tu marca</div>
              </div>
            </div>

            {/* Mascota + pills flotantes */}
            <div className="relative flex justify-center items-center min-h-[300px]">
              <div className="fdy-float"><Mascot size={230} /></div>
              <div className="fdy-float-2 absolute left-0 top-6 flex items-center gap-2 bg-white border border-line shadow-lg rounded-2xl px-3.5 py-2.5 text-sm font-bold">💳 Pago recibido</div>
              <div className="fdy-float-3 absolute right-0 top-20 flex items-center gap-2 bg-white border border-line shadow-lg rounded-2xl px-3.5 py-2.5 text-sm font-bold">⭐ +1 sello</div>
              <div className="fdy-float absolute left-2 bottom-4 flex items-center gap-2 bg-white border border-line shadow-lg rounded-2xl px-3.5 py-2.5 text-sm font-bold" style={{ animationDelay: '1.2s' }}>🧑‍🤝‍🧑 Nuevo cliente</div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── Integraciones (marquee) ─────────── */}
      <section className="border-y border-line/80 bg-bg2/50 py-8 overflow-hidden">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center text-[11px] uppercase tracking-[0.18em] text-mute font-bold mb-5">Se conecta con lo que ya usas</div>
        </div>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 w-24 z-10" style={{ background: 'linear-gradient(to right, #eef0f3, transparent)' }} />
          <div className="absolute inset-y-0 right-0 w-24 z-10" style={{ background: 'linear-gradient(to left, #eef0f3, transparent)' }} />
          <div className="flex gap-10 animate-marquee whitespace-nowrap">
            {[...INTEGRATIONS, ...INTEGRATIONS, ...INTEGRATIONS].map((l, i) => (
              <span key={`${l}-${i}`} className="text-mute font-extrabold opacity-70 hover:opacity-100 hover:text-brand transition text-sm flex-none">{l}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── El modelo (banda VERDE a sangre) ─────────── */}
      <section className="bg-brand text-white py-20 relative overflow-hidden">
        <div className="fdy-blob absolute -top-16 -right-10 w-72 h-72 rounded-full opacity-20" style={{ background: 'radial-gradient(circle, #fff, transparent 60%)' }} />
        <div className="mx-auto max-w-7xl px-6 relative">
          <div className="text-center mb-12 max-w-2xl mx-auto">
            <div className="text-xs uppercase tracking-[0.18em] font-bold mb-3 text-white/80">El modelo</div>
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight leading-[1.1]">Tú pones la marca. Nosotros la tecnología.</h2>
            <p className="mt-4 text-lg text-white/90">Un negocio de software recurrente, sin construir software.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              { emoji: '🏷️', title: 'Tu marca', desc: 'Nombre, logo, colores y dominio propios. Tus clientes solo ven tu identidad.' },
              { emoji: '⚙️', title: 'Nuestra tecnología', desc: 'Plataforma completa, servidores, actualizaciones y soporte técnico por detrás.' },
              { emoji: '💵', title: 'Tú cobras', desc: 'Fijas tus precios y facturas suscripción recurrente con tu propia pasarela.' },
            ].map((c, i) => (
              <FadeIn key={c.title} delay={i * 100} className="fdy-lift bg-white text-ink rounded-3xl p-8 text-center">
                <div className="text-4xl mb-4">{c.emoji}</div>
                <div className="font-extrabold text-xl mb-1.5">{c.title}</div>
                <p className="text-sm text-mute leading-relaxed">{c.desc}</p>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── Stats ─────────── */}
      <section className="py-16">
        <div className="mx-auto max-w-7xl px-6 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {STATS.map((s, i) => (
            <FadeIn key={s.label} delay={i * 90}>
              <div className="text-4xl md:text-5xl font-extrabold tracking-tight text-brand">{s.value}</div>
              <div className="text-xs text-mute mt-1.5 leading-snug">{s.label}</div>
            </FadeIn>
          ))}
        </div>
      </section>

      {/* ─────────── Plataforma / Features ─────────── */}
      <section id="plataforma" className="py-24 bg-bg2/50 border-y border-line/80">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center mb-12 max-w-2xl mx-auto">
            <div className="text-xs uppercase tracking-[0.18em] text-brand font-bold mb-3">La plataforma</div>
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight leading-[1.1]">Todo lo que tu marca puede <Mark>vender</Mark></h2>
            <p className="text-mute mt-5 text-lg">Un solo producto con todo incluido. Cada negocio de tu red obtiene estas herramientas — con tu marca.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {FEATURES.map((f, i) => (
              <FadeIn key={f.title} delay={(i % 4) * 80} className="fdy-lift bg-white rounded-3xl p-6 border border-line">
                <div className="w-14 h-14 rounded-2xl bg-brand-soft flex items-center justify-center mb-4 text-2xl">{f.emoji}</div>
                <div className="font-extrabold text-[15px] mb-1.5">{f.title}</div>
                <p className="text-[13px] text-mute leading-relaxed">{f.desc}</p>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── Producto por dentro (HeroTrio) ─────────── */}
      <section className="py-24">
        <div className="mx-auto max-w-6xl px-6 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-brand font-bold mb-3">Así se ve por dentro</div>
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight leading-[1.1]">Una plataforma pulida, lista para tus clientes</h2>
            <p className="text-mute mt-5 text-lg leading-relaxed">El mismo producto que ya usan miles de clientes finales — con tu marca encima. Wallet, tienda, CRM y automatizaciones, todo integrado.</p>
            <ul className="mt-6 space-y-3">
              {['Tarjetas en Apple & Google Wallet', 'Tienda y menús con IA', 'CRM, automatizaciones y domicilios', 'Panel maestro para toda tu red'].map((b) => (
                <li key={b} className="flex items-center gap-2.5 font-semibold"><Icon name="check" size={18} className="text-ok shrink-0" /> {b}</li>
              ))}
            </ul>
            <a className={`${btnPrimary} text-base px-7 py-4 mt-8`} href={CONTACT.demoUrl} target="_blank" rel="noreferrer">Agenda una demo</a>
          </div>
          <div className="relative flex justify-center">
            <HeroTrio />
          </div>
        </div>
      </section>

      {/* ─────────── Comparativa build-vs-buy ─────────── */}
      <section id="comparativa" className="py-24 bg-bg2/50 border-y border-line/80">
        <div className="mx-auto max-w-4xl px-6">
          <div className="text-center mb-12 max-w-2xl mx-auto">
            <div className="text-xs uppercase tracking-[0.18em] text-brand font-bold mb-3">Comprar vs. construir</div>
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight leading-[1.1]">Lanza en días, no en meses</h2>
            <p className="text-mute mt-5 text-lg">Lo que tardarías construyendo tu propio software — ya está resuelto.</p>
          </div>
          <div className="overflow-hidden rounded-3xl border border-line bg-white shadow-sm">
            <div className="grid grid-cols-[1.4fr_1fr_1fr] text-sm">
              <div className="p-4 md:p-5 font-bold text-mute bg-bg2/60 border-b border-line">Aspecto</div>
              <div className="p-4 md:p-5 font-extrabold text-center bg-brand text-white border-b border-brand">Con Fidelity</div>
              <div className="p-4 md:p-5 font-bold text-center text-mute bg-bg2/60 border-b border-line">Por tu cuenta</div>
              {COMPARE.map((row, i) => {
                const b = i < COMPARE.length - 1 ? 'border-b border-line' : '';
                return (
                  <div key={row.label} className="contents">
                    <div className={`p-4 md:p-5 font-medium ${b}`}>{row.label}</div>
                    <div className={`p-4 md:p-5 text-center bg-brand-soft/50 ${b}`}>
                      <div className="inline-flex items-center gap-1.5 font-bold text-ink">
                        <Icon name="check" size={16} className="text-ok shrink-0" /> {row.fidelity}
                      </div>
                    </div>
                    <div className={`p-4 md:p-5 text-center text-mute ${b}`}>
                      <span className="inline-flex items-center gap-1.5"><span className="text-bad/70 shrink-0 text-base leading-none">✕</span> {row.own}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── Cómo funciona ─────────── */}
      <section id="como-funciona" className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center mb-12 max-w-2xl mx-auto">
            <div className="text-xs uppercase tracking-[0.18em] text-brand font-bold mb-3">Cómo funciona</div>
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight leading-[1.1]">De la idea al mercado en 4 pasos</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            {STEPS.map((s, i) => (
              <FadeIn key={s.title} delay={i * 90} className="fdy-lift relative bg-white rounded-3xl p-7 border border-line">
                <div className="w-12 h-12 rounded-2xl bg-brand text-white text-xl font-extrabold flex items-center justify-center mb-4">{i + 1}</div>
                <div className="font-extrabold text-[15px] mb-1.5">{s.title}</div>
                <p className="text-[13px] text-mute leading-relaxed">{s.desc}</p>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── Por qué ─────────── */}
      <section className="py-24 bg-bg2/50 border-y border-line/80">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center mb-12 max-w-2xl mx-auto">
            <div className="text-xs uppercase tracking-[0.18em] text-brand font-bold mb-3">Por qué con Fidelity</div>
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight leading-[1.1]">Un negocio, de verdad, <Mark>tuyo</Mark></h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {WHY.map((w, i) => (
              <FadeIn key={w.title} delay={(i % 2) * 100} className="fdy-lift bg-white rounded-3xl p-7 border border-line flex gap-5">
                <div className="text-3xl shrink-0">{w.emoji}</div>
                <div>
                  <div className="font-extrabold text-lg mb-1.5">{w.title}</div>
                  <p className="text-sm text-mute leading-relaxed">{w.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── Marcas que ya operan ─────────── */}
      <section className="py-16">
        <div className="mx-auto max-w-7xl px-6 text-center">
          <div className="text-xs uppercase tracking-[0.18em] text-brand font-bold mb-6">Marcas que ya operan sobre nuestra tecnología</div>
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
            {BRANDS.map((b) => (<span key={b} className="text-xl md:text-2xl font-extrabold text-ink/70 hover:text-brand transition">{b}</span>))}
          </div>
        </div>
      </section>

      {/* ─────────── Planes ─────────── */}
      <section id="planes" className="py-24 bg-bg2/50 border-y border-line/80">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center mb-12 max-w-2xl mx-auto">
            <div className="text-xs uppercase tracking-[0.18em] text-brand font-bold mb-3">Planes</div>
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight leading-[1.1]">Elige tu punto de partida</h2>
            <p className="text-mute mt-5 text-lg">Armamos el plan a tu medida en la demo. Cada marca es distinta — por eso cotizamos según tu alcance.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
            {PLANS.map((p) => (
              <div key={p.name} className={`fdy-lift rounded-3xl bg-white flex flex-col overflow-hidden border ${p.highlight ? 'border-brand shadow-lg md:-mt-3 ring-2 ring-brand/20' : 'border-line'}`}>
                <div className={`h-1.5 w-full ${p.highlight ? 'bg-brand' : 'bg-line'}`} />
                <div className="p-7 flex flex-col flex-1">
                  {p.highlight && <div className="self-start mb-3 text-[11px] font-bold uppercase tracking-wide bg-brand text-white px-2.5 py-1 rounded-full">Más elegido</div>}
                  <div className="text-3xl mb-2">{p.emoji}</div>
                  <div className="font-extrabold text-xl">{p.name}</div>
                  <div className="text-sm text-mute mb-5">{p.tagline}</div>
                  <ul className="space-y-2.5 flex-1">
                    {p.features.map((f) => (<li key={f} className="flex items-start gap-2 text-sm"><Icon name="check" size={16} className="text-ok shrink-0 mt-0.5" /><span className="text-ink/80">{f}</span></li>))}
                  </ul>
                  <a href={CONTACT.demoUrl} target="_blank" rel="noreferrer" className={`mt-6 w-full text-sm px-5 py-3.5 ${p.highlight ? btnPrimary : 'inline-flex items-center justify-center bg-ink text-white font-bold rounded-pill hover:bg-ink/90 transition'}`}>Agenda una demo</a>
                </div>
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-mute mt-6">Precios a cotización según tu alcance. Sin costos de desarrollo — pagas por la plataforma, no por lo que factures.</p>
        </div>
      </section>

      {/* ─────────── FAQ ─────────── */}
      <section id="faq" className="py-24">
        <div className="mx-auto max-w-3xl px-6">
          <div className="text-center mb-10">
            <div className="text-xs uppercase tracking-[0.18em] text-brand font-bold mb-3">Preguntas frecuentes</div>
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight">Lo que casi todos preguntan</h2>
          </div>
          <div className="space-y-3">
            {FAQS.map((item) => (
              <details key={item.q} className="group bg-white rounded-2xl border border-line transition hover:border-brand/40">
                <summary className="cursor-pointer px-5 py-4 list-none flex justify-between items-center font-bold text-sm">
                  <span>{item.q}</span>
                  <span className="text-mute group-open:rotate-180 transition text-xs">▼</span>
                </summary>
                <div className="px-5 pb-5 text-sm text-mute leading-relaxed -mt-1">{item.a}</div>
              </details>
            ))}
          </div>
          <div className="text-center text-xs text-mute mt-6">¿Otra pregunta? <a href={CONTACT.whatsapp} target="_blank" rel="noreferrer" className="text-brand font-bold hover:underline">Escríbenos por WhatsApp</a></div>
        </div>
      </section>

      {/* ─────────── CTA final (banda verde con mascota) ─────────── */}
      <section className="py-16">
        <div className="mx-auto max-w-5xl px-6">
          <div className="relative overflow-hidden rounded-[2.5rem] bg-brand px-8 py-16 text-center text-white shadow-xl">
            <div className="fdy-blob absolute -top-16 -left-10 w-72 h-72 rounded-full opacity-20" style={{ background: 'radial-gradient(circle, #fff, transparent 60%)' }} />
            <div className="fdy-blob absolute -bottom-20 -right-6 w-80 h-80 rounded-full opacity-15" style={{ background: 'radial-gradient(circle, #fff, transparent 60%)', animationDelay: '4s' }} />
            <div className="relative">
              <div className="fdy-float mx-auto mb-4 w-max"><Mascot size={96} /></div>
              <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight leading-tight">¿Listo para lanzar tu propia plataforma? 🚀</h2>
              <p className="mt-4 text-white/90 text-lg max-w-2xl mx-auto">Agenda una demo de 30 minutos. Te mostramos la plataforma, resolvemos tus dudas y te damos un plan a tu medida.</p>
              <div className="mt-8 flex gap-3 justify-center flex-wrap">
                <a href={CONTACT.demoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center bg-white text-brand-700 font-extrabold text-base px-7 py-4 rounded-pill hover:-translate-y-0.5 transition shadow-md">Agenda una demo</a>
                <a href={CONTACT.whatsapp} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 border-2 border-white/50 text-white font-bold text-base px-7 py-4 rounded-pill hover:bg-white/10 transition">💬 WhatsApp</a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── Footer ─────────── */}
      <footer className="border-t border-line bg-white">
        <div className="mx-auto max-w-7xl px-6 py-14">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-sm">
            <div className="col-span-2">
              <Wordmark className="text-xl" />
              <p className="text-mute text-sm leading-relaxed max-w-xs mt-3">Lanza tu propia plataforma de fidelización, tienda y CRM en marca blanca. Tu marca, tu dominio, tus precios — sobre una tecnología probada en LATAM y USA.</p>
              <div className="flex gap-2 mt-4 flex-wrap">
                <a href={CONTACT.demoUrl} target="_blank" rel="noreferrer" className="text-xs bg-brand-soft text-brand-700 font-bold px-3 py-1.5 rounded-pill hover:-translate-y-0.5 transition">📅 Agenda una demo</a>
                <a href={CONTACT.whatsapp} target="_blank" rel="noreferrer" className="text-xs bg-bg2 text-ink px-3 py-1.5 rounded-pill hover:bg-line">💬 WhatsApp</a>
                <a href={CONTACT.email} className="text-xs bg-bg2 text-ink px-3 py-1.5 rounded-pill hover:bg-line">✉ Email</a>
              </div>
            </div>
            <div>
              <div className="font-bold mb-3 text-[13px]">Plataforma</div>
              <ul className="space-y-2 text-mute">
                <li><a href="#plataforma" className="hover:text-ink">Qué incluye</a></li>
                <li><a href="#comparativa" className="hover:text-ink">Vs. hacerlo solo</a></li>
                <li><a href="#como-funciona" className="hover:text-ink">Cómo funciona</a></li>
                <li><a href="#planes" className="hover:text-ink">Planes</a></li>
              </ul>
            </div>
            <div>
              <div className="font-bold mb-3 text-[13px]">Empieza</div>
              <ul className="space-y-2 text-mute">
                <li><a href={CONTACT.demoUrl} target="_blank" rel="noreferrer" className="hover:text-ink">Agenda una demo</a></li>
                <li><Link href="/login" className="hover:text-ink">Iniciar sesión</Link></li>
                <li><a href={CONTACT.instagram} target="_blank" rel="noreferrer" className="hover:text-ink">Instagram</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-line mt-10 pt-6 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-mute">
            <div>© 2026 Fidelity</div>
            <div>soyfidelity.com</div>
          </div>
        </div>
      </footer>
    </main>
  );
}
