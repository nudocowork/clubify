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

// 1. AURORA — gradient mesh, eventos
function ScreenAurora() {
  return (
    <div
      className="h-full p-3 pt-7 text-white"
      style={{
        background:
          'radial-gradient(circle at 20% 0%, #F472B6 0%, transparent 40%), radial-gradient(circle at 90% 30%, #818CF8 0%, transparent 50%), radial-gradient(circle at 50% 100%, #34D399 0%, transparent 50%), #1E1B4B',
      }}
    >
      <div className="text-center mt-2">
        <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur mx-auto mb-2 flex items-center justify-center text-xl">
          🍔
        </div>
        <div className="font-bold text-sm">Bananas Grill</div>
        <div className="text-[9px] opacity-80">Eventos · Promos · Carta</div>
      </div>
      <div className="space-y-2 mt-4">
        {['🎉 Eventos fin de semana', '🍽 Ver el menú', '📍 Cómo llegar', '⭐ Sumar puntos'].map((label) => (
          <div
            key={label}
            className="bg-white/15 backdrop-blur border border-white/30 rounded-xl py-2.5 text-center text-[10px] font-semibold"
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

// 2. NEON — dark + glow, promos nocturnas
function ScreenNeon() {
  return (
    <div className="h-full p-3 pt-7 text-white" style={{ background: '#0a0a0f' }}>
      <div className="text-center mt-2">
        <div
          className="w-12 h-12 rounded-full mx-auto mb-2 flex items-center justify-center text-xl"
          style={{
            background: 'linear-gradient(135deg, #F472B6, #FB923C)',
            boxShadow: '0 0 20px rgba(244,114,182,0.5)',
          }}
        >
          🌙
        </div>
        <div className="font-bold text-sm" style={{ textShadow: '0 0 8px #F472B6' }}>
          Nudo Cowork
        </div>
        <div className="text-[9px] text-pink-300">After Hours · Música · Drinks</div>
      </div>
      <div className="space-y-2 mt-4">
        {[
          { label: '🎟 Cover gratis Vie/Sáb', color: '#F472B6' },
          { label: '🍸 2x1 cocktails', color: '#A78BFA' },
          { label: '🎵 Playlist Spotify', color: '#34D399' },
          { label: '📸 Tag @nudocowork', color: '#FB923C' },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-xl py-2.5 text-center text-[10px] font-semibold"
            style={{
              background: 'rgba(0,0,0,0.5)',
              border: `1px solid ${item.color}`,
              boxShadow: `0 0 12px ${item.color}40`,
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

// 3. MINIMAL — blanco limpio, café
function ScreenMinimal() {
  return (
    <div className="h-full p-3 pt-7 bg-white text-ink">
      <div className="text-center mt-2">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-700 to-amber-900 mx-auto mb-2 flex items-center justify-center text-xl">
          ☕
        </div>
        <div className="font-bold text-sm">Café del Día</div>
        <div className="text-[9px] text-gray-500">Tu cafetería en Bogotá</div>
      </div>
      <div className="space-y-1.5 mt-4">
        {['🍽 Ver carta', '🚚 Pedir a domicilio', '⭐ Tarjeta de fidelización', '📍 Ubicación', 'ig @cafedeldia'].map(
          (label) => (
            <div
              key={label}
              className="bg-white border border-gray-200 rounded-xl py-2.5 text-center text-[10px] font-semibold text-gray-800 shadow-sm"
            >
              {label}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

const BENEFITS = [
  {
    icon: '🔗',
    title: 'Un link, todo lo importante',
    desc: 'Tu menú, redes, eventos y promos en una mini-página tipo Linktree.',
  },
  {
    icon: '🎨',
    title: '5 estilos pre-armados',
    desc: 'Aurora, Neon, Minimal, Stories, Shop. Cambialo cuando quieras.',
  },
  {
    icon: '📊',
    title: 'Métricas en vivo',
    desc: 'Cuántos vieron tu InfoLink, cuántos clickearon cada bloque.',
  },
];

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
              Tu mini-página{' '}
              <span className="text-brand">tipo Linktree</span>, lista en 2 minutos
            </h2>
            <p className="text-mute text-sm sm:text-base mt-4 max-w-xl mx-auto lg:mx-0 leading-relaxed">
              Compartí un solo link en tu bio de Instagram, WhatsApp y QR de
              mesa. Adentro: menú, eventos, promociones, ubicación, redes y
              tarjeta de fidelización — todo en un solo lugar.
            </p>

            <div className="space-y-3 mt-6 max-w-xl mx-auto lg:mx-0">
              {BENEFITS.map((b) => (
                <div
                  key={b.title}
                  className="flex items-start gap-3 text-left bg-white border border-line rounded-xl px-4 py-3"
                >
                  <span className="text-2xl shrink-0">{b.icon}</span>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm">{b.title}</div>
                    <div className="text-xs text-mute mt-0.5 leading-snug">
                      {b.desc}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-center lg:justify-start mt-6">
              <Link
                href="#precios"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-ink text-white font-semibold shadow-md hover:opacity-90 transition text-sm"
              >
                <span>✦</span>
                Crear mi InfoLink
              </Link>
            </div>
          </div>

          {/* Columna derecha: 3 iPhones tilted */}
          <div className="relative h-[420px] sm:h-[480px] lg:h-[520px]">
            {/* Phone izq (rotado -8°, atrás) */}
            <div
              className="absolute left-0 top-1/2 hidden sm:block"
              style={{
                transform: 'translateY(-50%) rotate(-8deg) translateX(-10px)',
                zIndex: 1,
                animation: 'clb-info-floaty 5s ease-in-out 0.6s infinite',
              }}
            >
              <div className="hidden lg:block">
                <Phone width={180}>
                  <ScreenAurora />
                </Phone>
              </div>
              <div className="block lg:hidden">
                <Phone width={150}>
                  <ScreenAurora />
                </Phone>
              </div>
            </div>

            {/* Phone centro (frontal, más grande) */}
            <div
              className="absolute left-1/2 top-1/2"
              style={{
                transform: 'translate(-50%, -50%)',
                zIndex: 3,
                animation: 'clb-info-floaty 5s ease-in-out 0s infinite',
              }}
            >
              <div className="hidden lg:block">
                <Phone width={210}>
                  <ScreenNeon />
                </Phone>
              </div>
              <div className="hidden sm:block lg:hidden">
                <Phone width={180}>
                  <ScreenNeon />
                </Phone>
              </div>
              <div className="block sm:hidden">
                <Phone width={170}>
                  <ScreenNeon />
                </Phone>
              </div>
            </div>

            {/* Phone der (rotado +8°, atrás) */}
            <div
              className="absolute right-0 top-1/2 hidden sm:block"
              style={{
                transform: 'translateY(-50%) rotate(8deg) translateX(10px)',
                zIndex: 2,
                animation: 'clb-info-floaty 5s ease-in-out 1.2s infinite',
              }}
            >
              <div className="hidden lg:block">
                <Phone width={180}>
                  <ScreenMinimal />
                </Phone>
              </div>
              <div className="block lg:hidden">
                <Phone width={150}>
                  <ScreenMinimal />
                </Phone>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
