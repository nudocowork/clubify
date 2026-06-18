'use client';
import { useState } from 'react';
import { SelleaLogo, SelleaMark } from './SelleaLogo';

/**
 * Landing de Sellea — réplica de la de Clubify con identidad Sellea.
 * Autocontenida (no usa i18n ni settings de Clubify). Los teléfonos son
 * mockups CSS. ⚠️ Logo = aproximación SVG; reemplazar por el oficial.
 */

const C = {
  coral: '#FF4D3D',
  coralDark: '#E63521',
  tinta: '#1A1033',
  crema: '#FFF6F0',
  gris: '#6B6478',
  line: '#efe7df',
};
const FONT = "'Poppins', sans-serif";

const NAV = ['Funciones', 'Precios', 'Casos de éxito', 'Recursos', 'Preguntas'];

const HERO_FEATURES = [
  ['wallet', 'Disponible Apple Wallet y Google Wallet'],
  ['stamp', 'Sellos automáticos al escanear'],
  ['pin', 'GeoPush a 300mts del local'],
  ['gift', 'Mensajes de cumpleaños'],
  ['reward', 'Recompensas configurables'],
  ['users', 'Base de datos de tus clientes'],
] as const;

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

const PLANS = [
  { id: 'mensual', name: 'Mensual', total: 68, perMonth: '68 USD / mes', save: null },
  { id: 'trimestral', name: 'Trimestral', total: 150, perMonth: '50 USD / mes', save: 'ahorras $4 USD' },
  { id: 'semestral', name: 'Semestral', total: 278, perMonth: '46.3 USD / mes', save: 'ahorras 130 USD' },
  { id: 'anual', name: 'Anual', total: 500, perMonth: '41.7 USD / mes', save: 'ahorras 316 USD', best: true },
];

const TRUST = [
  ['%', 'Sin costos de instalación'],
  ['chat', 'Soporte por WhatsApp'],
  ['pin', 'GeoPush incluido'],
  ['x', 'Cancela cuando quieras'],
  ['refresh', 'Actualizaciones incluidas'],
] as const;

const FAQS_LEFT = [
  ['¿Cuánto pago y en qué moneda?', 'Eliges entre 4 periodicidades (mensual, trimestral, semestral o anual) en USD. Mientras más tiempo contratas, menor es el costo por mes. El pago es seguro vía Hotmart.'],
  ['¿Mis clientes necesitan descargar una app?', 'No. La tarjeta de fidelización se guarda en Apple Wallet o Google Wallet, que ya vienen en el teléfono. Cero apps, cero fricción.'],
  ['¿Funciona para negocios con pocos clientes o recién abiertos?', 'Sí. Sellea está pensado justamente para hacer que tus primeros clientes vuelvan y se conviertan en recurrentes desde el día uno.'],
  ['¿Cómo se procesa el pago?', 'A través de Hotmart, con checkout seguro. Apenas pagas, creas tu cuenta en 1 minuto y tu programa queda activo al instante.'],
];
const FAQS_RIGHT = [
  ['¿Necesito Apple Developer Program para emitir tarjetas wallet?', 'No. Sellea emite las tarjetas por ti, tanto para Apple Wallet como para Google Wallet. Tú solo configuras tu marca y tus recompensas.'],
  ['¿Qué pasa con mis datos si decido cancelar?', 'Tus datos son tuyos. Puedes exportar tu base de clientes cuando quieras y cancelar sin permanencia desde tu panel.'],
  ['¿Hay costos extras?', 'No. El precio del plan incluye todo: tarjetas wallet, menús, InfoLinks, automatizaciones y soporte. Sin costos de instalación ni sorpresas.'],
  ['¿Funciona si no soy técnico?', 'Totalmente. La mayoría configura todo en una tarde sin saber código, y el soporte por WhatsApp te acompaña en cada paso.'],
];

const FOOTER_COLS = [
  ['Producto', ['Funciones', 'Precios', 'Integraciones', 'Roadmap']],
  ['Recursos', ['Blog', 'Centro de ayuda', 'Guías', 'Estado del sistema']],
  ['Empresa', ['Nosotros', 'Contacto', 'Términos y condiciones', 'Política de privacidad']],
  ['Legal', ['Términos', 'Privacidad', 'Cookies']],
] as const;

function I({ name, color = C.coral, size = 16 }: { name: string; color?: string; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const paths: Record<string, JSX.Element> = {
    wallet: <><rect x="2" y="5" width="20" height="14" rx="3" /><path d="M16 12h4" /></>,
    stamp: <><circle cx="12" cy="8" r="4" /><path d="M6 21h12M8 21v-3a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3" /></>,
    pin: <><path d="M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
    gift: <><rect x="3" y="8" width="18" height="13" rx="2" /><path d="M3 12h18M12 8v13M12 8S9 3 6.5 5 12 8 12 8zM12 8s3-5 5.5-3S12 8 12 8z" /></>,
    reward: <><circle cx="12" cy="9" r="6" /><path d="M9 14l-2 7 5-3 5 3-2-7" /></>,
    users: <><circle cx="9" cy="8" r="3.5" /><path d="M2 21v-1.5A4.5 4.5 0 0 1 6.5 15h5A4.5 4.5 0 0 1 16 19.5V21M17 11a3 3 0 0 0 0-6M22 21v-1.5a4.5 4.5 0 0 0-3-4.2" /></>,
    chat: <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />,
    refresh: <><path d="M21 12a9 9 0 1 1-3-6.7L21 7" /><path d="M21 3v4h-4" /></>,
    x: <><circle cx="12" cy="12" r="9" /><path d="M15 9l-6 6M9 9l6 6" /></>,
    '%': <><path d="M19 5L5 19" /><circle cx="7.5" cy="7.5" r="2" /><circle cx="16.5" cy="16.5" r="2" /></>,
    check: <path d="M20 6 9 17l-5-5" />,
  };
  return <svg {...p}>{paths[name] ?? paths.check}</svg>;
}

/** Patrón de puntos coral decorativo (como en el mockup). */
function Dots({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden style={{ display: 'grid', gridTemplateColumns: 'repeat(6,6px)', gap: 8, opacity: 0.5 }}>
      {Array.from({ length: 36 }).map((_, i) => (
        <span key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: C.coral, opacity: 0.45 }} />
      ))}
    </div>
  );
}

/** Marco de teléfono genérico. */
function Phone({ children, w = 200, className = '', style = {} }: { children: React.ReactNode; w?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={className} style={{ width: w, borderRadius: 30, background: C.tinta, padding: 7, boxShadow: '0 28px 55px -22px rgba(26,16,51,.5)', ...style }}>
      <div style={{ borderRadius: 24, overflow: 'hidden', background: '#fff', position: 'relative' }}>
        <div style={{ position: 'absolute', top: 7, left: '50%', transform: 'translateX(-50%)', width: 56, height: 5, borderRadius: 3, background: 'rgba(255,255,255,.5)', zIndex: 2 }} />
        {children}
      </div>
    </div>
  );
}

/** Tarjeta wallet de sellos (café) para el hero. */
function WalletCardScreen({ provider }: { provider: 'apple' | 'google' }) {
  return (
    <div style={{ background: C.coral, color: '#fff', padding: '18px 14px 14px', minHeight: 300 }}>
      <div className="flex items-center justify-between text-[10px] font-semibold" style={{ opacity: 0.9 }}>
        <span>{provider === 'apple' ? ' Wallet' : 'Google'}</span>
        <span className="px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,.2)' }}>Listo</span>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center"><SelleaMark size={16} variant="dark" /></div>
        <div className="text-[11px] font-bold">NUDO COWORK</div>
        <div className="ml-auto text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,.18)' }}>7 / 10</div>
      </div>
      <div className="mt-3 text-[15px] font-extrabold">Tarjeta de café</div>
      <div className="mt-3 grid grid-cols-5 gap-1.5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="aspect-square rounded-full flex items-center justify-center" style={{ background: i < 7 ? '#fff' : 'rgba(255,255,255,.22)' }}>
            <span style={{ fontSize: 11, color: i < 7 ? C.coral : 'rgba(255,255,255,.5)' }}>★</span>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 text-[9px]" style={{ borderTop: '1px solid rgba(255,255,255,.25)' }}>
        <div style={{ opacity: 0.8 }}>TITULAR</div>
        <div className="font-bold text-[11px]">María López</div>
      </div>
      <div className="mt-3 h-7 rounded bg-white/95" style={{ backgroundImage: 'repeating-linear-gradient(90deg,#1A1033 0 2px,transparent 2px 4px)' }} />
    </div>
  );
}

/** Pantalla de menú digital. */
function MenuScreen() {
  const items = [
    ['Nudo Pepper', '$ 30.000'],
    ['Nudo Chicken', '$ 38.000'],
    ['Matcha Latte', '$ 18.000'],
    ['Americano', '$ 6.000'],
    ['Capuccino', '$ 10.000'],
  ];
  return (
    <div style={{ background: '#fff', minHeight: 300, padding: '16px 12px 12px' }}>
      <div className="flex gap-2 text-[10px] font-semibold" style={{ color: C.gris }}>
        {['Cárnes', 'Pollo', 'Pastas', 'Sopas'].map((c, i) => (
          <span key={c} style={{ color: i === 0 ? C.coral : C.gris, fontWeight: i === 0 ? 700 : 500 }}>{c}</span>
        ))}
      </div>
      <div className="mt-3 space-y-2.5">
        {items.map(([n, p]) => (
          <div key={n} className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg" style={{ background: C.crema, border: `1px solid ${C.line}` }} />
            <div className="flex-1">
              <div className="text-[11px] font-bold" style={{ color: C.tinta }}>{n}</div>
              <div className="text-[10px]" style={{ color: C.coral, fontWeight: 700 }}>{p}</div>
            </div>
            <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[13px] font-bold" style={{ background: C.coral }}>+</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Pantalla InfoLink (link en bio). */
function InfoLinkScreen({ name }: { name: string }) {
  return (
    <div style={{ background: `linear-gradient(180deg, ${C.coral}, ${C.coralDark})`, color: '#fff', minHeight: 300, padding: '22px 16px' }} className="text-center">
      <div className="text-[13px] font-extrabold tracking-wide">{name}</div>
      <div className="mt-1 text-[9px]" style={{ opacity: 0.85 }}>Únete a nuestro programa de fidelización</div>
      <div className="mt-4 mx-auto w-16 h-16 rounded-lg bg-white/95" style={{ backgroundImage: 'repeating-linear-gradient(45deg,#1A1033 0 3px,transparent 3px 6px)' }} />
      <div className="mt-4 space-y-2">
        {['Ver menú', 'Promociones', 'Ubicación'].map((b) => (
          <div key={b} className="text-[10px] font-semibold py-1.5 rounded-full bg-white/15">{b}</div>
        ))}
      </div>
    </div>
  );
}

/** Badge "● label" coral. */
function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-[12px] font-bold px-3 py-1.5 rounded-full" style={{ color: C.coralDark, background: '#fff', border: `1px solid ${C.coral}33` }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.coral }} /> {children}
    </span>
  );
}

/** Pill oscuro (badge flotante sobre teléfonos). */
function FloatPill({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <span className="absolute text-[11px] font-bold px-3 py-1.5 rounded-full text-white whitespace-nowrap" style={{ background: C.tinta, boxShadow: '0 8px 20px -6px rgba(26,16,51,.5)', ...style }}>
      {children}
    </span>
  );
}

export function SelleaLanding() {
  const [plan, setPlan] = useState('anual');
  const [faq, setFaq] = useState<string | null>(null);
  const selected = PLANS.find((p) => p.id === plan)!;

  const ctaPrimary = (label: string) => (
    <a href="#precios" className="font-bold px-6 py-3.5 rounded-full text-white transition active:scale-95" style={{ background: `linear-gradient(180deg, ${C.coral}, ${C.coralDark})` }}>{label}</a>
  );
  const ctaSecondary = (label: string) => (
    <a href="https://wa.me/" className="font-bold px-6 py-3.5 rounded-full transition active:scale-95" style={{ background: '#fff', color: C.tinta, border: `1px solid ${C.line}` }}>{label}</a>
  );

  return (
    <div style={{ fontFamily: FONT, background: C.crema, color: C.tinta }}>
      {/* Nav */}
      <header className="sticky top-0 z-50" style={{ background: 'rgba(255,246,240,.88)', backdropFilter: 'blur(10px)', borderBottom: `1px solid ${C.line}` }}>
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <SelleaLogo size={28} />
          <nav className="hidden lg:flex items-center gap-7 text-[14px] font-semibold" style={{ color: C.tinta }}>
            {NAV.map((n) => <a key={n} href="#" className="hover:opacity-60 transition">{n}</a>)}
          </nav>
          <div className="flex items-center gap-3">
            <a href="https://app.soyclubify.com/login" className="hidden sm:block text-[14px] font-semibold" style={{ color: C.tinta }}>Iniciar sesión</a>
            <a href="#precios" className="text-[14px] font-bold px-4 py-2 rounded-full text-white active:scale-95 transition" style={{ background: C.coral }}>Comenzar gratis</a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden" style={{ background: C.crema }}>
        <div className="max-w-6xl mx-auto px-5 py-16 md:py-20 grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <Badge>Fidelización digital</Badge>
            <h1 className="mt-5 font-extrabold leading-[1.02]" style={{ fontSize: 'clamp(38px, 5.4vw, 60px)', letterSpacing: '-1.5px' }}>
              Tarjetas de<br />fidelización en{' '}
              <span style={{ color: C.coral }}>Apple y Google Wallet</span>
            </h1>
            <p className="mt-5 text-[17px] max-w-md" style={{ color: C.gris }}>
              Haz que tus clientes vuelvan más seguido con sellos, cupones y
              recompensas automáticas directamente en su celular. Cero apps, cero
              tarjetas plásticas perdidas.
            </p>
            <div className="mt-6 grid sm:grid-cols-2 gap-x-6 gap-y-2.5">
              {HERO_FEATURES.map(([ic, t]) => (
                <div key={t} className="flex items-center gap-2.5 text-[13.5px]" style={{ color: C.tinta }}>
                  <I name={ic} size={16} /> {t}
                </div>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              {ctaPrimary('Ver plan y empezar')}
              {ctaSecondary('Agendar una Demo')}
            </div>
          </div>

          {/* Teléfonos wallet */}
          <div className="relative flex justify-center lg:justify-end min-h-[380px]">
            <Dots className="absolute right-0 top-6 hidden md:grid" />
            <FloatPill style={{ top: 4, right: 8, display: 'inline-flex', alignItems: 'center', gap: 6 }}> Apple Wallet</FloatPill>
            <FloatPill style={{ bottom: 70, left: 0 }}>Google Wallet</FloatPill>
            <div className="absolute left-2 top-16 z-20 hidden sm:block rounded-2xl bg-white p-3 shadow-xl" style={{ width: 180, border: `1px solid ${C.line}` }}>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: C.crema }}><SelleaMark size={14} /></div>
                <div className="text-[10px] font-bold">NUDO COWORK</div>
                <div className="ml-auto text-[9px]" style={{ color: C.gris }}>ahora</div>
              </div>
              <div className="mt-1.5 text-[11px] font-bold" style={{ color: C.tinta }}>⭐ Estás cerca, pasa por tu café!</div>
              <div className="text-[10px]" style={{ color: C.gris }}>Te faltan 2 sellos para tu próxima gratis.</div>
            </div>
            <div className="flex items-end gap-3">
              <Phone w={186} style={{ transform: 'rotate(-3deg)' }}><WalletCardScreen provider="apple" /></Phone>
              <Phone w={170} style={{ transform: 'translateY(-18px) rotate(2deg)' }}><WalletCardScreen provider="google" /></Phone>
            </div>
          </div>
        </div>
      </section>

      {/* Sección Menús IA */}
      <ProductSection
        badge="Menú digital"
        title={<>Menús digitales con <span style={{ color: C.coral }}>inteligencia artificial</span></>}
        text="Tu menú vive en el iPhone de tu cliente. Foto + variantes + traducción automática + rotación de los más vendidos. Cero imprenta, cero fricción."
        ctas={<>{ctaPrimary('Ver plan y empezar')}{ctaSecondary('Agendar una Demo')}</>}
        phones={
          <div className="relative flex justify-center min-h-[360px] items-center">
            <Dots className="absolute right-0 top-4 hidden md:grid" />
            <FloatPill style={{ top: 0, right: 20 }}>Multilenguaje</FloatPill>
            <FloatPill style={{ bottom: 40, left: 10 }}>Rotación de productos</FloatPill>
            <div className="flex items-center gap-3">
              <Phone w={172} style={{ transform: 'rotate(-2deg)' }}><MenuScreen /></Phone>
              <Phone w={172} style={{ transform: 'translateY(-16px) rotate(2deg)' }}><MenuScreen /></Phone>
            </div>
          </div>
        }
      />

      {/* Sección InfoLinks */}
      <ProductSection
        badge="Infolinks"
        title={<>Tu InfoLink se crea en <span style={{ color: C.coral }}>menos de 2 minutos</span></>}
        text="Comparte el link en tu bio de Instagram, WhatsApp o QR de mesa. Adentro: menú, eventos, promociones, ubicación, redes y tarjeta de fidelización — todo en un solo lugar."
        ctas={ctaPrimary('Ver planes y comenzar')}
        phones={
          <div className="relative flex flex-col items-center min-h-[360px] justify-center">
            <Dots className="absolute right-0 top-4 hidden md:grid" />
            <div className="flex items-end gap-3">
              <Phone w={168} style={{ transform: 'rotate(-2deg)' }}><InfoLinkScreen name="NUDO" /></Phone>
              <Phone w={168} style={{ transform: 'translateY(-14px) rotate(2deg)' }}><InfoLinkScreen name="MOTILART" /></Phone>
            </div>
            <div className="mt-4 flex gap-8 text-[12px] font-semibold">
              <span style={{ color: C.tinta }}>Nudo Cowork · <a href="#" style={{ color: C.coral }}>Ver ejemplo →</a></span>
              <span style={{ color: C.tinta }}>Motilart · <a href="#" style={{ color: C.coral }}>Ver ejemplo →</a></span>
            </div>
          </div>
        }
      />

      {/* Testimonios */}
      <section className="py-20" style={{ background: C.crema, borderTop: `1px solid ${C.line}` }}>
        <div className="max-w-6xl mx-auto px-5">
          <div className="text-center text-[12px] font-bold uppercase tracking-wider mb-8" style={{ color: C.coral }}>Lo que dicen nuestros clientes</div>
          <div className="grid md:grid-cols-3 gap-5">
            {TESTIMONIALS.map((t) => (
              <div key={t.name} className="rounded-2xl p-6 bg-white" style={{ border: `1px solid ${C.line}` }}>
                <div className="text-[15px]" style={{ color: C.coral }}>★★★★★</div>
                <p className="mt-3 text-[14.5px] leading-relaxed" style={{ color: C.tinta }}>"{t.quote}"</p>
                <div className="mt-5 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-lg" style={{ background: C.crema }}>{t.avatar}</div>
                  <div>
                    <div className="font-bold text-[13px]">{t.name}</div>
                    <div className="text-[12px]" style={{ color: C.gris }}>{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="precios" className="py-20" style={{ background: '#fff', borderTop: `1px solid ${C.line}` }}>
        <div className="max-w-5xl mx-auto px-5">
          <div className="text-center">
            <div className="text-[12px] font-bold uppercase tracking-wider" style={{ color: C.coral }}>Precios</div>
            <h2 className="mt-2 font-extrabold" style={{ fontSize: 'clamp(28px, 4vw, 42px)', letterSpacing: '-1px' }}>Precios claros · sin sorpresas</h2>
            <p className="mt-3 text-[15px] max-w-2xl mx-auto" style={{ color: C.gris }}>
              Elige la periodicidad que más te convenga. Mientras más tiempo, más ahorras.
              Activa tu cuenta en minutos y empieza a vender — cancela cuando quieras desde tu panel.
            </p>
          </div>

          <div className="mt-10 rounded-3xl p-5 md:p-7 grid lg:grid-cols-[1.4fr_1fr] gap-6" style={{ background: C.crema, border: `1px solid ${C.line}` }}>
            <div>
              <div className="font-bold text-lg">Elige tu plan</div>
              <div className="text-[12px] mb-3" style={{ color: C.gris }}>Pago seguro · activación inmediata</div>
              <div className="space-y-2.5">
                {PLANS.map((p) => {
                  const active = p.id === plan;
                  return (
                    <button key={p.id} onClick={() => setPlan(p.id)} className="w-full text-left rounded-2xl px-4 py-3.5 flex items-center gap-3 transition" style={{ background: '#fff', border: `1.5px solid ${active ? C.coral : C.line}`, boxShadow: active ? `0 0 0 3px ${C.coral}22` : 'none' }}>
                      <span className="w-4 h-4 rounded-full flex-none" style={{ border: `2px solid ${active ? C.coral : '#cfc7d2'}`, background: active ? C.coral : '#fff', boxShadow: active ? `inset 0 0 0 2.5px #fff` : 'none' }} />
                      <span className="flex-1">
                        <span className="font-bold flex items-center gap-2">{p.name}{p.best && <span className="text-[10px] font-extrabold px-2 py-0.5 rounded text-white" style={{ background: C.coral }}>MEJOR PRECIO</span>}</span>
                        <span className="text-[12px]" style={{ color: C.gris }}>{p.perMonth}{p.save && <span style={{ color: C.coral }}> · {p.save}</span>}</span>
                      </span>
                      <span className="font-extrabold text-[17px]">{p.total} USD</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col justify-center">
              <div className="text-[13px]" style={{ color: C.gris }}>Total hoy</div>
              <div className="text-4xl font-extrabold mt-1" style={{ letterSpacing: '-1px' }}>{selected.total} USD</div>
              <a href="https://app.soyclubify.com/signup" className="mt-4 text-center font-bold py-3.5 rounded-full text-white active:scale-95 transition" style={{ background: `linear-gradient(180deg, ${C.coral}, ${C.coralDark})` }}>Continuar al pago →</a>
              <div className="text-[12px] mt-3" style={{ color: C.gris }}>Pago seguro con Hotmart. Apenas pagas, creas tu cuenta en 1 minuto.</div>
            </div>
          </div>

          {/* Trust row */}
          <div className="mt-8 flex flex-wrap justify-center gap-x-7 gap-y-3 text-[13px]" style={{ color: C.gris }}>
            {TRUST.map(([ic, t]) => <span key={t} className="flex items-center gap-2"><I name={ic} size={15} /> {t}</span>)}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20" style={{ background: C.crema, borderTop: `1px solid ${C.line}` }}>
        <div className="max-w-5xl mx-auto px-5">
          <div className="text-center text-[12px] font-bold uppercase tracking-wider mb-8" style={{ color: C.coral }}>Preguntas frecuentes</div>
          <div className="grid md:grid-cols-2 gap-4">
            {[FAQS_LEFT, FAQS_RIGHT].map((col, ci) => (
              <div key={ci} className="space-y-3">
                {col.map(([q, a]) => {
                  const open = faq === q;
                  return (
                    <div key={q} className="rounded-2xl bg-white overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
                      <button onClick={() => setFaq(open ? null : q)} className="w-full text-left px-5 py-4 flex items-center justify-between gap-3">
                        <span className="text-[14px] font-semibold" style={{ color: C.tinta }}>{q}</span>
                        <span style={{ color: C.coral, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>⌄</span>
                      </button>
                      {open && <div className="px-5 pb-4 text-[13.5px] leading-relaxed" style={{ color: C.gris }}>{a}</div>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="text-center mt-7 text-[14px]" style={{ color: C.gris }}>
            ¿Otra pregunta? <a href="https://wa.me/" className="font-bold" style={{ color: C.coral }}>Escríbenos por WhatsApp</a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ background: C.tinta, color: '#c9c3d4' }}>
        <div className="max-w-6xl mx-auto px-5 py-14">
          <div className="grid md:grid-cols-[1.4fr_repeat(4,1fr)] gap-8">
            <div>
              <SelleaLogo size={30} variant="dark" />
              <p className="mt-3 text-[13px]">Cada compra deja su sello.</p>
              <div className="mt-4 flex gap-2.5">
                {['◎', '✆', '✉'].map((s, i) => (
                  <span key={i} className="w-8 h-8 rounded-full flex items-center justify-center text-sm" style={{ background: 'rgba(255,255,255,.08)' }}>{s}</span>
                ))}
              </div>
            </div>
            {FOOTER_COLS.map(([title, links]) => (
              <div key={title}>
                <div className="text-[13px] font-bold text-white mb-3">{title}</div>
                <div className="space-y-2">
                  {links.map((l) => <a key={l} href="#" className="block text-[13px] hover:text-white transition">{l}</a>)}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-12 pt-6 flex flex-wrap justify-between gap-2 text-[12.5px]" style={{ borderTop: '1px solid rgba(255,255,255,.08)' }}>
            <span>© {new Date().getFullYear()} Sellea. Todos los derechos reservados.</span>
            <span>www.selleala.com · @selleala</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** Sección de producto: texto a la izquierda, teléfonos a la derecha (alterna). */
function ProductSection({ badge, title, text, ctas, phones }: { badge: string; title: React.ReactNode; text: string; ctas: React.ReactNode; phones: React.ReactNode }) {
  return (
    <section className="py-16 md:py-20" style={{ background: C.crema, borderTop: `1px solid ${C.line}` }}>
      <div className="max-w-6xl mx-auto px-5 grid lg:grid-cols-2 gap-10 items-center">
        <div>
          <Badge>{badge}</Badge>
          <h2 className="mt-4 font-extrabold leading-[1.08]" style={{ fontSize: 'clamp(28px, 4vw, 40px)', letterSpacing: '-1px' }}>{title}</h2>
          <p className="mt-4 text-[16px] max-w-md" style={{ color: C.gris }}>{text}</p>
          <div className="mt-7 flex flex-wrap gap-3">{ctas}</div>
        </div>
        {phones}
      </div>
    </section>
  );
}
