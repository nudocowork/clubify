import type { Metadata } from 'next';
import Link from 'next/link';

/**
 * Landing pública de SELLEA INFOLINKS (freemium) — vive en
 *   www.selleala.com/infolink
 * NO reemplaza la home de Sellea; es una ruta adicional (puerta de captación).
 * CTA "Crear mi Infolink gratis" → /i-registro/sellea (auto-registro FREE, 0
 * créditos). Al loguear, el usuario entra al panel de Sellea en vista limitada
 * (businessType=INFOLINK). Server component, branding Sellea fijo (coral/tinta/
 * crema del Manual de Identidad), sin llamadas al API.
 *
 * Ver [[project_sellea_infolinks_freemium_2026_08_19]].
 */
export const metadata: Metadata = {
  title: 'Sellea Infolinks · Todo lo que quieres compartir, en un solo link',
  description:
    'Crea tu Infolink gratis y reúne tus redes, WhatsApp, productos y enlaces en una sola página. Gratis para empezar, PRO para crecer.',
};

const SIGNUP = '/i-registro/sellea';

const FEATURES = [
  { emoji: '⚡', title: 'Listo en 2 minutos', desc: 'Elige plantilla, agrega tus botones y publica. Tu link queda vivo al instante.' },
  { emoji: '🎨', title: 'A tu manera', desc: 'Colores, formas de botón, iconos y plantillas para que se vea como tu marca.' },
  { emoji: '📈', title: 'Mide lo que importa', desc: 'Visitas, clics y qué botón funciona mejor. Con PRO, analítica avanzada.' },
];

const FREE_FEATURES = ['1 Infolink personalizado', 'Hasta 5 botones', 'Redes sociales + WhatsApp', 'Plantillas y colores básicos', 'Estadísticas esenciales'];
const PRO_FEATURES = ['Botones ilimitados', 'Sin publicidad de Sellea', 'Todas las plantillas y fondos', 'Colores personalizados', 'Analítica avanzada'];

export default async function SelleaInfolinkLanding() {
  // Logo real de Sellea desde el endpoint público de marca (se mantiene
  // sincronizado con el branding; cache 1h). Fallback al monograma "S".
  const API = process.env.NEXT_PUBLIC_API_URL ?? 'https://api.soyclubify.com';
  let logoUrl: string | null = null;
  try {
    const r = await fetch(`${API}/api/auth/infolink-brand/sellea`, {
      next: { revalidate: 3600 },
    });
    if (r.ok) logoUrl = (await r.json())?.logoUrl ?? null;
  } catch {
    /* sin red → cae al monograma */
  }
  return (
    <div style={{ background: '#FFF6F0', color: '#1A1033', minHeight: '100dvh', fontFamily: 'Manrope, ui-sans-serif, system-ui, sans-serif' }}>
      <style>{`
        .sl-wrap{max-width:1140px;margin:0 auto;padding:0 22px}
        .sl-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-weight:700;border-radius:999px;transition:transform .15s,box-shadow .2s,background .15s;text-decoration:none}
        .sl-btn:active{transform:translateY(1px)}
        .sl-coral{background:#FF4D3D;color:#fff;box-shadow:0 12px 30px -10px rgba(255,77,61,.6)}
        .sl-coral:hover{background:#E63521}
        .sl-ghost{background:#fff;color:#1A1033;border:1.5px solid #EFE3DB}
        .sl-ghost:hover{background:#FFFBF7}
        .sl-feat:hover{transform:translateY(-3px);box-shadow:0 16px 40px -18px rgba(26,16,51,.25)}
        .sl-il-btn{display:flex;align-items:center;gap:10px;padding:12px 15px;border-radius:999px;font-weight:700;font-size:14px}
        @media(max-width:840px){.sl-hero{grid-template-columns:1fr!important;text-align:center}.sl-hero .sl-phone{margin:0 auto}}
      `}</style>

      {/* Nav */}
      <header style={{ position: 'sticky', top: 0, zIndex: 40, background: 'rgba(255,246,240,.85)', backdropFilter: 'blur(10px)', borderBottom: '1px solid #F5ECE5' }}>
        <div className="sl-wrap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 66 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 800, fontSize: 20 }}>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Sellea" style={{ height: 38, width: 'auto', objectFit: 'contain', display: 'block' }} />
            ) : (
              <>
                <span style={{ width: 32, height: 32, borderRadius: 9, background: '#FF4D3D', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 19, boxShadow: '0 8px 20px -6px rgba(255,77,61,.7)' }}>S</span>
                Sellea
              </>
            )}
          </div>
          <Link href={SIGNUP} className="sl-btn sl-coral" style={{ padding: '9px 18px', fontSize: 14 }}>Crear gratis</Link>
        </div>
      </header>

      {/* Hero */}
      <section style={{ position: 'relative', overflow: 'hidden' }}>
        <div className="sl-wrap sl-hero" style={{ display: 'grid', gridTemplateColumns: '1.05fr .95fr', gap: 40, alignItems: 'center', padding: '60px 22px 68px' }}>
          <div>
            <h1 style={{ fontSize: 'clamp(38px,5.6vw,62px)', lineHeight: 1.05, letterSpacing: '-.035em', fontWeight: 800, margin: 0 }}>
              Todo lo que quieres compartir, en <span style={{ color: '#FF4D3D' }}>un solo link.</span>
            </h1>
            <p style={{ fontSize: 19, color: '#372a5c', maxWidth: '33ch', marginTop: 22, lineHeight: 1.5 }}>
              Crea tu Infolink gratis y reúne tus redes sociales, WhatsApp, productos, servicios y enlaces importantes en una sola página.
            </p>
            <div style={{ display: 'flex', gap: 13, marginTop: 30, flexWrap: 'wrap', justifyContent: 'inherit' }}>
              <Link href={SIGNUP} className="sl-btn sl-coral" style={{ padding: '16px 28px', fontSize: 16.5 }}>Crear mi Infolink gratis →</Link>
              <Link href="/i/sellea/demo" className="sl-btn sl-ghost" style={{ padding: '16px 28px', fontSize: 16.5 }}>Ver ejemplo</Link>
            </div>
            <div style={{ marginTop: 24, color: '#6E6480', fontSize: 13.5, fontWeight: 600 }}>Gratis · sin tarjeta · listo en minutos</div>
          </div>
          <div className="sl-phone" style={{ width: 300, marginLeft: 'auto' }}>
            <PhoneMock />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="sl-wrap" style={{ padding: '56px 22px' }}>
        <div style={{ textAlign: 'center', maxWidth: 640, margin: '0 auto 38px' }}>
          <div style={{ fontSize: 11.5, letterSpacing: '.16em', textTransform: 'uppercase', color: '#E63521', fontWeight: 700 }}>Un link, todo tu mundo</div>
          <h2 style={{ fontSize: 'clamp(26px,3.4vw,38px)', fontWeight: 800, letterSpacing: '-.03em', marginTop: 10 }}>Simple de crear. Imposible de ignorar.</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 18 }}>
          {FEATURES.map((f) => (
            <div key={f.title} className="sl-feat" style={{ padding: 26, borderRadius: 18, background: '#fff', border: '1px solid #EFE3DB', transition: '.2s' }}>
              <div style={{ width: 46, height: 46, borderRadius: 13, background: '#FFECE7', display: 'grid', placeItems: 'center', fontSize: 22, marginBottom: 16 }}>{f.emoji}</div>
              <h3 style={{ fontSize: 19, fontWeight: 700, margin: 0 }}>{f.title}</h3>
              <p style={{ color: '#6E6480', fontSize: 14.5, marginTop: 7 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="sl-wrap" style={{ padding: '10px 22px 56px' }}>
        <div style={{ textAlign: 'center', marginBottom: 34 }}>
          <div style={{ fontSize: 11.5, letterSpacing: '.16em', textTransform: 'uppercase', color: '#E63521', fontWeight: 700 }}>Precios claros</div>
          <h2 style={{ fontSize: 'clamp(24px,3vw,34px)', fontWeight: 800, letterSpacing: '-.03em', marginTop: 10 }}>Empieza gratis. Crece con PRO.</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 20, maxWidth: 820, margin: '0 auto' }}>
          <PriceCard tier="GRATIS" amount="$0" note="para siempre" features={FREE_FEATURES} cta="Crear mi Infolink gratis" href={SIGNUP} pro={false} />
          <PriceCard tier="PRO" amount="$14.99" note="USD · al mes" features={PRO_FEATURES} cta="Empieza gratis y mejora" href={SIGNUP} pro />
        </div>
      </section>

      {/* CTA band */}
      <section className="sl-wrap" style={{ padding: '0 22px 56px' }}>
        <div style={{ background: '#1A1033', color: '#FFF6F0', borderRadius: 26, padding: 52, textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
          <h2 style={{ color: '#fff', fontSize: 'clamp(26px,3.4vw,36px)', fontWeight: 800, margin: 0 }}>Tu bio merece algo mejor que una lista de links.</h2>
          <p style={{ color: 'rgba(255,246,240,.72)', fontSize: 17, margin: '14px auto 26px', maxWidth: '52ch' }}>Crea tu Sellea Infolink gratis hoy y empieza a convertir seguidores en clientes.</p>
          <Link href={SIGNUP} className="sl-btn sl-coral" style={{ padding: '16px 28px', fontSize: 16.5 }}>Crear mi Infolink gratis →</Link>
        </div>
      </section>

      <footer className="sl-wrap" style={{ padding: '30px 22px 44px', color: '#6E6480', fontSize: 13.5, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 800 }}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Sellea" style={{ height: 28, width: 'auto', objectFit: 'contain', display: 'block' }} />
          ) : (
            <>
              <span style={{ width: 26, height: 26, borderRadius: 8, background: '#FF4D3D', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 15 }}>S</span> Sellea
            </>
          )}
        </div>
        <div>www.selleala.com/infolink · @selleala</div>
      </footer>
    </div>
  );
}

function PriceCard({ tier, amount, note, features, cta, href, pro }: { tier: string; amount: string; note: string; features: string[]; cta: string; href: string; pro: boolean }) {
  return (
    <div style={{ borderRadius: 26, padding: 30, border: pro ? 'none' : '1px solid #EFE3DB', background: pro ? '#1A1033' : '#fff', color: pro ? '#FFF6F0' : '#1A1033' }}>
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.05em', padding: '3px 11px', borderRadius: 999, background: pro ? 'linear-gradient(115deg,#2A1E4A,#FF4D3D)' : '#1A1033', color: '#fff' }}>{tier}</span>
      <div style={{ fontSize: 42, fontWeight: 800, margin: '10px 0 2px', letterSpacing: '-.03em' }}>{amount}</div>
      <div style={{ color: pro ? 'rgba(255,246,240,.6)' : '#6E6480', fontWeight: 600, marginBottom: 4 }}>{note}</div>
      <ul style={{ listStyle: 'none', padding: 0, margin: '18px 0 24px', display: 'flex', flexDirection: 'column', gap: 11 }}>
        {features.map((x) => (
          <li key={x} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14.5, fontWeight: 600, color: pro ? 'rgba(255,246,240,.9)' : '#1A1033' }}>
            <span style={{ color: '#FF4D3D', fontWeight: 800 }}>✓</span> {x}
          </li>
        ))}
      </ul>
      <Link href={href} className={`sl-btn ${pro ? 'sl-coral' : 'sl-ghost'}`} style={{ width: '100%', padding: '13px', fontSize: 15 }}>{cta}</Link>
    </div>
  );
}

/** Teléfono estático con un Infolink atractivo (branding Sellea). */
function PhoneMock() {
  const btns = [
    { e: '🛒', t: 'Hacer mi pedido', solid: true },
    { e: '💬', t: 'WhatsApp directo' },
    { e: '▶️', t: 'Mis clases online' },
    { e: '📍', t: 'Cómo llegar' },
  ];
  return (
    <div style={{ width: 300, background: '#1A1033', borderRadius: 42, padding: 10, boxShadow: '0 30px 70px -20px rgba(26,16,51,.5)' }}>
      <div style={{ borderRadius: 33, overflow: 'hidden', height: 600, background: 'linear-gradient(180deg,#241848,#140C28)', color: '#FFF6F0', padding: '46px 20px 26px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <div style={{ width: 82, height: 82, borderRadius: '50%', background: '#FF4D3D', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 32, fontWeight: 800 }}>V</div>
        <div style={{ fontWeight: 800, fontSize: 20, marginTop: 13 }}>Valentina · Cakes</div>
        <div style={{ fontFamily: 'monospace', fontSize: 12, opacity: .65, marginTop: 3 }}>selleala.com/i/valecakes</div>
        <div style={{ fontSize: 13, opacity: .8, marginTop: 10, maxWidth: '24ch' }}>Pastelería artesanal 🍰 Pedidos y clases · CDMX</div>
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
          {btns.map((b, i) => (
            <div key={i} className="sl-il-btn" style={{ background: b.solid ? '#FF4D3D' : 'rgba(255,255,255,.1)', color: '#fff', justifyContent: 'center' }}>
              <span>{b.e}</span> {b.t}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 'auto', paddingTop: 22, fontSize: 11.5, opacity: .6 }}>✦ Creado con Sellea</div>
      </div>
    </div>
  );
}
