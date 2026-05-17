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

            {/* Badge Google Wallet (abajo) */}
            <div
              className="absolute bottom-4 sm:bottom-12 left-2 z-10 flex items-center gap-1.5 sm:gap-2 bg-ink text-white px-3 sm:px-4 py-2 sm:py-2.5 rounded-full shadow-2xl text-xs sm:text-sm font-semibold"
              style={{
                animation: 'clb-wallet-float 4s ease-in-out 1s infinite',
              }}
            >
              <span>🤖</span>
              Google Wallet
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
