/* eslint-disable @next/next/no-img-element */
// Banner promocional del feature InfoLinks: trío de iPhones tilted con
// 3 mockups de mini-páginas (estilo Linktree) + descripción + beneficios.

import Link from 'next/link';

function Phone({
  width = 220,
  children,
}: {
  width?: number;
  children: React.ReactNode;
}) {
  const height = (width * 640) / 320;
  return (
    <div
      className="relative bg-[#0a0a0a] rounded-[36px] p-[7px] shadow-[0_30px_70px_-15px_rgba(0,0,0,0.4),0_0_0_1.5px_#1f1f1f,0_0_0_3px_#000]"
      style={{ width, height }}
    >
      <div className="absolute top-[7px] left-1/2 -translate-x-1/2 w-[80px] h-[20px] bg-black rounded-b-[14px] z-20" />
      <div className="w-full h-full rounded-[28px] overflow-hidden relative">
        {children}
      </div>
    </div>
  );
}

// ─── Mockups de InfoLinks ───
// Ambos representan negocios REALES creados con Clubify (Nudo Cowork
// y Motilart). El botón "Ver ejemplo" debajo de cada phone abre el
// infolink público.

// 1. NUDO COWORK — coworking + eventos, gradient mesh aurora
function ScreenNudoCowork() {
  return (
    <div
      className="h-full p-3 pt-7 text-white"
      style={{
        background:
          'radial-gradient(circle at 20% 0%, #A78BFA 0%, transparent 45%), radial-gradient(circle at 90% 25%, #F472B6 0%, transparent 50%), radial-gradient(circle at 50% 100%, #60A5FA 0%, transparent 55%), #1A1145',
      }}
    >
      <div className="text-center mt-2">
        <div className="w-12 h-12 rounded-2xl bg-white/15 backdrop-blur mx-auto mb-2 flex items-center justify-center text-xl ring-2 ring-white/20">
          🌐
        </div>
        <div className="font-bold text-sm tracking-tight">Nudo Cowork</div>
        <div className="text-[9px] opacity-80">Espacios · Eventos · Comunidad</div>
      </div>
      <div className="space-y-2 mt-4">
        {[
          '📅 Reservar sala',
          '🎉 Eventos del mes',
          '☕ Carta del café',
          '💼 Membresías',
          '📍 Cómo llegar',
        ].map((label) => (
          <div
            key={label}
            className="bg-white/15 backdrop-blur border border-white/25 rounded-xl py-2 text-center text-[10px] font-semibold"
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

// 2. MOTILART — taller / customización de motos
function ScreenMotilart() {
  return (
    <div
      className="h-full p-3 pt-7 text-white"
      style={{
        background:
          'radial-gradient(circle at 50% 0%, #F97316 0%, transparent 35%), linear-gradient(180deg, #18181b 0%, #0a0a0a 100%)',
      }}
    >
      <div className="text-center mt-2">
        <div
          className="w-12 h-12 rounded-2xl mx-auto mb-2 flex items-center justify-center text-xl"
          style={{
            background: 'linear-gradient(135deg, #F97316, #FACC15)',
            boxShadow: '0 0 20px rgba(249,115,22,0.6)',
          }}
        >
          🏍
        </div>
        <div
          className="font-bold text-sm tracking-tight"
          style={{ color: '#FACC15' }}
        >
          Motilart
        </div>
        <div className="text-[9px] text-orange-200/80">
          Taller · Customización · Repuestos
        </div>
      </div>
      <div className="space-y-2 mt-4">
        {[
          { label: '🛠 Agendar servicio', color: '#F97316' },
          { label: '🎨 Galería de trabajos', color: '#FACC15' },
          { label: '📦 Catálogo repuestos', color: '#FB7185' },
          { label: '📍 Llegar al taller', color: '#34D399' },
          { label: '📲 WhatsApp', color: '#22D3EE' },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-xl py-2 text-center text-[10px] font-semibold"
            style={{
              background: 'rgba(0,0,0,0.55)',
              border: `1px solid ${item.color}`,
              boxShadow: `0 0 10px ${item.color}40`,
              color: item.color,
            }}
          >
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export function InfoLinksBanner() {
  return (
    <>
      <style>{`
        @keyframes clb-info-floaty {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
      `}</style>
      <section className="relative overflow-hidden bg-bg2/40 border-y border-line/80 py-12 sm:py-16 lg:py-20">
        <div className="mx-auto max-w-7xl px-5 sm:px-6 grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-10 lg:gap-12 items-center">
          {/* Columna izquierda: descripción + beneficios + CTA */}
          <div className="text-center lg:text-left">
            <div className="text-xs uppercase tracking-[0.18em] text-brand font-semibold mb-3">
              InfoLinks
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-[1.05]">
              Tu InfoLink se crea en{' '}
              <span className="text-brand">menos de 2 minutos</span>
            </h2>
            <p className="text-mute text-sm sm:text-base mt-4 max-w-xl mx-auto lg:mx-0 leading-relaxed">
              Comparte el link en tu bio de Instagram, WhatsApp y QR de mesa.
              Adentro: menú, eventos, promociones, ubicación, redes y tarjeta
              de fidelización — todo en un solo lugar.
            </p>

            <div className="flex justify-center lg:justify-start mt-6 sm:mt-8">
              <Link
                href="#precios"
                className="inline-flex items-center justify-center px-6 sm:px-7 py-3 sm:py-3.5 rounded-full bg-ink text-white font-semibold shadow-md hover:opacity-90 transition text-sm sm:text-base"
              >
                Ver planes y comenzar
              </Link>
            </div>
          </div>

          {/* Columna derecha: 2 iPhones tilted con infolinks reales
              (Nudo Cowork + Motilart). Cada phone va dentro de una
              columna que incluye un botón "Ver ejemplo" debajo que
              abre el infolink público real en nueva pestaña. */}
          <div className="relative flex items-end justify-center gap-2 sm:gap-4 lg:gap-6">
            {/* Nudo Cowork */}
            <InfolinkCard
              rotate={-8}
              floatDelay={0}
              brandName="Nudo Cowork"
              demoHref="https://soyclubify.com/i/nudo-cowork"
            >
              <ScreenNudoCowork />
            </InfolinkCard>

            {/* Motilart */}
            <InfolinkCard
              rotate={8}
              floatDelay={1}
              brandName="Motilart"
              demoHref="https://soyclubify.com/i/motilart"
            >
              <ScreenMotilart />
            </InfolinkCard>
          </div>
        </div>
      </section>
    </>
  );
}

/** Card que envuelve un iPhone tilted + label "Ver ejemplo" debajo.
 *  Mantiene el ratio del phone responsivo (200/170/140 según breakpoint). */
function InfolinkCard({
  rotate,
  floatDelay,
  brandName,
  demoHref,
  children,
}: {
  rotate: number;
  floatDelay: number;
  brandName: string;
  demoHref: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative"
        style={{ transform: `rotate(${rotate}deg)`, zIndex: 1 }}
      >
        <div style={{ animation: `clb-info-floaty 4s ease-in-out ${floatDelay}s infinite` }}>
          <div className="hidden lg:block">
            <Phone width={200}>{children}</Phone>
          </div>
          <div className="hidden sm:block lg:hidden">
            <Phone width={170}>{children}</Phone>
          </div>
          <div className="block sm:hidden">
            <Phone width={140}>{children}</Phone>
          </div>
        </div>
      </div>

      <a
        href={demoHref}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-ink hover:text-brand transition"
        title={`Abrir el infolink real de ${brandName}`}
      >
        <span className="text-mute font-medium">{brandName}</span>
        <span className="text-brand">· Ver ejemplo →</span>
      </a>
    </div>
  );
}
