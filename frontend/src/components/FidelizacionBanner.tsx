/* eslint-disable @next/next/no-img-element */
// Banner estilo HeroBanner pero enfocado en tarjetas de fidelización wallet.
// Lado izquierdo: título + copy + CTAs.
// Lado derecho: 2 iPhones tilted mostrando una WalletPass (Apple Wallet
// look-and-feel) con sellos animados que se van llenando, badges flotantes
// "Apple Wallet" y "Google Wallet".

import Link from 'next/link';

const TOTAL_STAMPS = 10;

function WalletPassPhone({
  width = 260,
  delayS = 0,
  variant = 'apple',
}: {
  width?: number;
  delayS?: number;
  variant?: 'apple' | 'google';
}) {
  const height = (width * 640) / 320;
  // Tarjeta wallet visual: header con logo, strip, grid de sellos, footer QR
  return (
    <div
      className="relative bg-[#0a0a0a] rounded-[40px] p-[8px] shadow-[0_30px_70px_-15px_rgba(0,0,0,0.4),0_0_0_1.5px_#1f1f1f,0_0_0_3px_#000]"
      style={{ width, height }}
    >
      <div className="absolute top-[8px] left-1/2 -translate-x-1/2 w-[90px] h-[24px] bg-black rounded-b-[16px] z-20" />
      <div
        className="w-full h-full rounded-[32px] overflow-hidden relative"
        style={{
          background:
            variant === 'apple'
              ? 'linear-gradient(180deg, #1a1a1a 0%, #2d2d2d 100%)'
              : 'linear-gradient(180deg, #f5f5f7 0%, #e8e8ed 100%)',
        }}
      >
        {/* Wallet header bar */}
        <div className="absolute top-0 inset-x-0 h-10 flex items-center justify-between px-4 z-10">
          <span
            className={`text-[10px] font-semibold ${
              variant === 'apple' ? 'text-white/70' : 'text-black/60'
            }`}
          >
            {variant === 'apple' ? 'Wallet' : 'Google Wallet'}
          </span>
          <span
            className={`text-[10px] font-semibold ${
              variant === 'apple' ? 'text-white/70' : 'text-black/60'
            }`}
          >
            Listo ✓
          </span>
        </div>

        {/* Wallet pass card */}
        <div
          className="absolute top-12 inset-x-3 rounded-2xl shadow-2xl overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #15803d 0%, #22C55E 100%)',
            height: '78%',
          }}
        >
          {/* Header logo + balance */}
          <div className="px-4 pt-3.5 flex items-start justify-between">
            <div>
              <div className="text-white/80 text-[8px] uppercase tracking-wider font-semibold">
                Nudo Cowork
              </div>
              <div className="text-white font-bold text-[14px] mt-0.5 leading-tight">
                Tarjeta de café
              </div>
            </div>
            <div className="bg-white/15 backdrop-blur rounded-md px-2 py-1">
              <div className="text-white/70 text-[7px] uppercase tracking-wider font-semibold leading-none">
                Sellos
              </div>
              <div className="text-white font-bold text-[14px] leading-none mt-0.5">
                <span
                  style={{ animation: `clb-stamp-count 6s ease-in-out ${delayS}s infinite` }}
                >
                  7
                </span>
                <span className="text-white/60 text-[10px]">/{TOTAL_STAMPS}</span>
              </div>
            </div>
          </div>

          {/* Strip — imagen hero */}
          <div className="mt-3 mx-3 h-[36px] rounded-md overflow-hidden">
            <img
              src="https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400&h=120&fit=crop"
              alt=""
              className="w-full h-full object-cover"
            />
          </div>

          {/* Grid de sellos 5+5 animado */}
          <div className="mt-3 px-3 grid grid-cols-5 gap-1.5">
            {Array.from({ length: TOTAL_STAMPS }).map((_, i) => (
              <div
                key={i}
                className="aspect-square rounded-full border border-white/40 flex items-center justify-center text-[10px]"
                style={{
                  background:
                    i < 7
                      ? 'rgba(255,255,255,0.95)'
                      : 'rgba(255,255,255,0.05)',
                  color: i < 7 ? '#15803d' : 'rgba(255,255,255,0.4)',
                  animation: `clb-stamp-fill 6s ease-in-out ${delayS + i * 0.15}s infinite`,
                }}
              >
                {i < 7 ? '★' : '·'}
              </div>
            ))}
          </div>

          {/* Footer fields */}
          <div className="absolute bottom-3 inset-x-3 flex items-end justify-between">
            <div>
              <div className="text-white/70 text-[7px] uppercase tracking-wider font-semibold leading-none">
                Titular
              </div>
              <div className="text-white text-[10px] font-semibold mt-0.5">
                María López
              </div>
            </div>
            <div className="bg-white/95 rounded p-1">
              {/* Barcode mock */}
              <div className="flex gap-[1px] h-[18px] w-[44px] items-end">
                {[3, 5, 2, 7, 3, 4, 6, 2, 5, 3, 7, 4].map((h, i) => (
                  <div
                    key={i}
                    className="bg-black flex-1"
                    style={{ height: `${50 + h * 6}%` }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FidelizacionBanner({
  waLink,
}: {
  waLink: string;
} = { waLink: 'https://wa.me/573000000000' }) {
  return (
    <>
      <style>{`
        @keyframes clb-stamp-fill {
          0%, 35% { opacity: 0.4; transform: scale(0.7); }
          50% { opacity: 1; transform: scale(1.15); }
          65%, 100% { opacity: 1; transform: scale(1); }
        }
        @keyframes clb-stamp-count {
          0%, 35% { opacity: 0.5; }
          50% { opacity: 1; transform: scale(1.2); }
          65%, 100% { opacity: 1; transform: scale(1); }
        }
        @keyframes clb-wallet-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        /* Push notification: slide-in desde arriba, queda 4s, fade-out, repite */
        @keyframes clb-push-cycle {
          0%   { opacity: 0; transform: translateY(-30px) scale(0.92); }
          8%   { opacity: 1; transform: translateY(0) scale(1); }
          70%  { opacity: 1; transform: translateY(0) scale(1); }
          85%  { opacity: 0; transform: translateY(-12px) scale(0.96); }
          100% { opacity: 0; transform: translateY(-30px) scale(0.92); }
        }
        /* Geofence radar: anillos pulsantes que se expanden */
        @keyframes clb-geo-pulse {
          0%   { transform: scale(0.4); opacity: 0.7; }
          100% { transform: scale(2.3); opacity: 0; }
        }
        @keyframes clb-geo-dot {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.18); }
        }
      `}</style>
      <section className="relative overflow-hidden bg-bg2/40 border-y border-line/80 py-12 sm:py-16 lg:py-20">
        <div className="mx-auto max-w-7xl px-5 sm:px-6 grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-10 items-center">
          {/* Columna izquierda */}
          <div className="text-center lg:text-left">
            <div className="inline-flex items-center gap-2 bg-white border border-line text-xs font-semibold px-3 py-1.5 rounded-full mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-brand" />
              Fidelización digital
            </div>
            <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05]">
              Tarjetas de fidelización en{' '}
              <span className="text-brand">Apple y Google Wallet</span>
            </h2>
            <p className="text-mute text-sm sm:text-base lg:text-lg mt-4 sm:mt-5 max-w-xl mx-auto lg:mx-0 leading-relaxed">
              Haz que tus clientes vuelvan más seguido con sellos, cupones y
              recompensas automáticas directamente en su celular. Cero apps,
              cero tarjetas plásticas perdidas.
            </p>
            <ul className="mt-6 grid sm:grid-cols-2 gap-2.5 max-w-xl mx-auto lg:mx-0 text-sm text-ink/80">
              {[
                '🍎 Apple Wallet nativo',
                '🤖 Google Wallet sincronizado',
                '⭐ Sellos automáticos al escanear',
                '🎁 Recompensas configurables',
                '🎂 Mensajes de cumpleaños',
                '📊 Dashboard con LTV por cliente',
              ].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-col sm:flex-row flex-wrap justify-center lg:justify-start gap-3 mt-7 sm:mt-8">
              <Link
                href="#precios"
                className="inline-flex items-center justify-center px-6 sm:px-7 py-3 sm:py-3.5 rounded-full bg-ink text-white font-semibold shadow-md hover:opacity-90 transition text-sm sm:text-base"
              >
                Ver plan y empezar
              </Link>
              <a
                href={waLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 px-6 sm:px-7 py-3 sm:py-3.5 rounded-full bg-white text-ink border-2 border-ink/90 font-semibold hover:bg-ink/5 transition text-sm sm:text-base"
              >
                Hablar con ventas
              </a>
            </div>
          </div>

          {/* Columna derecha: wallet phones tilted + badges */}
          <div className="relative h-[380px] sm:h-[440px] lg:h-[480px] mt-4 lg:mt-0 overflow-visible">
            {/* Phone trasero (Google Wallet, oculto mobile) */}
            <div
              className="absolute right-0 top-1/2 hidden sm:block"
              style={{
                transform: 'translateY(-45%) rotate(12deg) translateX(20px)',
                zIndex: 1,
              }}
            >
              <div className="hidden lg:block">
                <WalletPassPhone width={210} variant="google" delayS={1.5} />
              </div>
              <div className="block lg:hidden">
                <WalletPassPhone width={180} variant="google" delayS={1.5} />
              </div>
            </div>

            {/* Phone frontal (Apple Wallet) */}
            <div
              className="absolute left-1/2 top-1/2"
              style={{
                transform: 'translate(-50%, -50%) rotate(-6deg)',
                zIndex: 2,
              }}
            >
              <div className="hidden lg:block">
                <WalletPassPhone width={230} variant="apple" delayS={0} />
              </div>
              <div className="hidden sm:block lg:hidden">
                <WalletPassPhone width={200} variant="apple" delayS={0} />
              </div>
              <div className="block sm:hidden">
                <WalletPassPhone width={180} variant="apple" delayS={0} />
              </div>
            </div>

            {/* Badge Apple Wallet (arriba) */}
            <div
              className="absolute top-2 sm:top-6 right-2 sm:right-6 z-10 flex items-center gap-1.5 sm:gap-2 bg-ink text-white px-3 sm:px-4 py-2 sm:py-2.5 rounded-full shadow-2xl text-xs sm:text-sm font-semibold"
              style={{ animation: 'clb-wallet-float 4s ease-in-out infinite' }}
            >
              <span>🍎</span>
              Apple Wallet
            </div>

            {/* Badge Google Wallet (abajo izq) */}
            <div
              className="absolute bottom-4 sm:bottom-12 left-2 z-10 flex items-center gap-1.5 sm:gap-2 bg-ink text-white px-3 sm:px-4 py-2 sm:py-2.5 rounded-full shadow-2xl text-xs sm:text-sm font-semibold"
              style={{
                animation: 'clb-wallet-float 4s ease-in-out 1s infinite',
              }}
            >
              <span>🤖</span>
              Google Wallet
            </div>

            {/* Push notification GeoPush — estilo iOS, anima slide-in cíclico */}
            <div
              className="absolute top-12 sm:top-16 left-1 sm:left-4 z-20 w-[200px] sm:w-[240px] bg-white/95 backdrop-blur-md rounded-2xl shadow-[0_20px_50px_-12px_rgba(0,0,0,0.4)] border border-black/5 p-3"
              style={{
                animation: 'clb-push-cycle 8s ease-in-out infinite',
                transformOrigin: 'top center',
              }}
              role="img"
              aria-label="Notificación push de ejemplo de Nudo Cowork"
            >
              <div className="flex items-start gap-2.5">
                {/* Icono app */}
                <div
                  className="w-9 h-9 rounded-[8px] flex-none flex items-center justify-center text-white shadow-md"
                  style={{
                    background:
                      'linear-gradient(135deg, #15803d 0%, #22C55E 100%)',
                  }}
                >
                  <span className="text-[16px]">☕</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="text-[11px] font-semibold text-black/90 uppercase tracking-wider truncate">
                      Nudo Cowork
                    </div>
                    <div className="text-[9px] text-black/40 font-medium flex-none">
                      ahora
                    </div>
                  </div>
                  <div className="text-[12px] font-semibold text-black leading-tight mt-0.5">
                    📍 Estás cerca, ¡pasá por tu café!
                  </div>
                  <div className="text-[10px] text-black/60 leading-tight mt-0.5">
                    Te faltan 3 sellos para tu próximo gratis.
                  </div>
                </div>
              </div>
            </div>

            {/* Mini mapa geofence con pin pulsante (bottom-right) */}
            <div
              className="absolute bottom-2 sm:bottom-4 right-2 sm:right-4 z-20 w-[150px] sm:w-[170px] bg-white rounded-2xl shadow-[0_20px_50px_-12px_rgba(0,0,0,0.4)] border border-black/5 overflow-hidden"
              style={{
                animation: 'clb-wallet-float 5s ease-in-out 0.5s infinite',
              }}
              role="img"
              aria-label="Vista de geofence de Nudo Cowork"
            >
              {/* Header */}
              <div className="px-3 py-2 flex items-center gap-1.5 border-b border-black/5">
                <span className="text-[11px]">📡</span>
                <span className="text-[10px] font-semibold text-black/80 uppercase tracking-wider">
                  GeoPush activo
                </span>
              </div>
              {/* Mapa fake */}
              <div
                className="relative h-[100px] sm:h-[110px]"
                style={{
                  background:
                    'linear-gradient(135deg, #e8f5ec 0%, #d1eedb 100%)',
                }}
              >
                {/* Calles fake */}
                <div className="absolute inset-0">
                  <div className="absolute left-0 right-0 top-[35%] h-[2px] bg-white/70" />
                  <div className="absolute left-0 right-0 top-[70%] h-[1px] bg-white/50" />
                  <div className="absolute top-0 bottom-0 left-[40%] w-[2px] bg-white/70" />
                  <div className="absolute top-0 bottom-0 left-[75%] w-[1px] bg-white/50" />
                </div>
                {/* Geofence pulsante centrado */}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center">
                  {/* Anillo ondas (3 capas) */}
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="absolute inset-0 rounded-full"
                      style={{
                        background:
                          'radial-gradient(circle, rgba(34,197,94,0.45) 0%, rgba(34,197,94,0) 70%)',
                        animation: `clb-geo-pulse 2.6s ease-out ${i * 0.85}s infinite`,
                      }}
                    />
                  ))}
                  {/* Pin centro */}
                  <div
                    className="relative w-6 h-6 rounded-full bg-brand shadow-[0_3px_8px_rgba(34,197,94,0.6)] flex items-center justify-center text-white text-[11px] font-bold border-2 border-white"
                    style={{
                      animation:
                        'clb-geo-dot 2s ease-in-out infinite',
                    }}
                  >
                    📍
                  </div>
                </div>
                {/* Etiqueta tenant */}
                <div className="absolute left-1/2 bottom-1.5 -translate-x-1/2 bg-ink text-white text-[9px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap">
                  Nudo Cowork
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
