/* eslint-disable @next/next/no-img-element */
// Banner promocional estilo Cluvi: gran título a la izquierda + 2 CTAs +
// par de iPhones tilted con menú animado (scroll vertical infinito) y
// 2 badges flotantes ("Multilenguaje", "Rotación de productos").

import Link from 'next/link';

const MENU_ITEMS = [
  { name: 'Yakimeshi de Lomo', price: '$ 52.700', img: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200&h=200&fit=crop' },
  { name: 'Yakimeshi Mixto', price: '$ 52.700', img: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=200&h=200&fit=crop' },
  { name: 'Yakimeshi Tradicional', price: '$ 41.300', img: 'https://images.unsplash.com/photo-1552566626-52f8b828add9?w=200&h=200&fit=crop' },
  { name: 'Hamburguesa Clásica', price: '$ 38.900', img: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=200&h=200&fit=crop' },
  { name: 'Pizza Margherita', price: '$ 45.500', img: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=200&h=200&fit=crop' },
  { name: 'Ensalada César', price: '$ 28.000', img: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200&h=200&fit=crop' },
];

function MenuPhone({
  width = 260,
  background = '#FAFAF5',
  delayS = 0,
}: {
  width?: number;
  background?: string;
  delayS?: number;
}) {
  const height = (width * 640) / 320;
  // Duplicamos los items 2x para que el scroll loop sea seamless
  const loopItems = [...MENU_ITEMS, ...MENU_ITEMS];
  return (
    <div
      className="relative bg-[#0a0a0a] rounded-[40px] p-[8px] shadow-[0_30px_70px_-15px_rgba(0,0,0,0.4),0_0_0_1.5px_#1f1f1f,0_0_0_3px_#000]"
      style={{ width, height }}
    >
      <div className="absolute top-[8px] left-1/2 -translate-x-1/2 w-[90px] h-[24px] bg-black rounded-b-[16px] z-20" />
      <div
        className="w-full h-full rounded-[32px] overflow-hidden relative"
        style={{ background }}
      >
        {/* Header sticky */}
        <div className="absolute top-0 inset-x-0 h-9 bg-black flex items-center justify-center z-10 px-3">
          <div className="text-[11px] font-bold tracking-tight text-white">cluvi</div>
        </div>
        {/* Tabs */}
        <div className="absolute top-9 inset-x-0 h-7 bg-black/95 z-10 flex items-center gap-3 px-3 text-[9px]">
          <span className="text-white font-semibold">Cárnes</span>
          <span className="text-white/60">Pollo</span>
          <span className="text-white/60">Pastas</span>
          <span className="text-white/60">Sopas</span>
        </div>
        {/* Lista con auto-scroll */}
        <div className="pt-16 px-2 h-full overflow-hidden">
          <div
            style={{
              animation: `clb-menu-scroll 18s linear ${delayS}s infinite`,
            }}
          >
            {loopItems.map((p, i) => (
              <div
                key={i}
                className="bg-white rounded-xl shadow-sm flex items-center gap-2 p-1.5 mb-1.5"
              >
                <img
                  src={p.img}
                  alt=""
                  className="w-12 h-12 rounded-lg object-cover flex-none"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-semibold leading-tight line-clamp-1">
                    {p.name}
                  </div>
                  <div className="text-[9px] text-gray-500 mt-0.5">{p.price}</div>
                </div>
                <span className="bg-yellow-400 text-black text-[8px] font-bold rounded-full px-1.5 py-0.5">
                  ●
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function HeroBanner({
  waLink,
  mailLink,
  igLink,
}: {
  waLink: string;
  mailLink?: string | null;
  igLink?: string | null;
} = { waLink: 'https://wa.me/573000000000', mailLink: null, igLink: null }) {
  return (
    <>
      <style>{`
        @keyframes clb-menu-scroll {
          0% { transform: translateY(0); }
          100% { transform: translateY(-50%); }
        }
        @keyframes clb-badge-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
      `}</style>
      <section className="relative overflow-hidden bg-white py-6 sm:py-8 lg:py-10">
        <div className="mx-auto max-w-7xl px-5 sm:px-6 grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-10 items-center">
          {/* Columna izquierda: título + CTAs */}
          <div className="text-center lg:text-left">
            <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05]">
              Menús digitales con{' '}
              <span className="text-brand">inteligencia artificial</span>
            </h2>
            <p className="text-mute text-sm sm:text-base lg:text-lg mt-4 sm:mt-5 max-w-xl mx-auto lg:mx-0 leading-relaxed">
              Tu menú vive en el iPhone de tu cliente. Foto + variantes +
              traducción automática + rotación de los más vendidos. Cero
              imprenta, cero fricción.
            </p>
            <div className="flex flex-col sm:flex-row flex-wrap justify-center lg:justify-start gap-3 mt-6 sm:mt-8">
              <Link
                href="#precios"
                className="inline-flex items-center justify-center px-6 sm:px-7 py-3 sm:py-3.5 rounded-full bg-ink text-white font-semibold shadow-md hover:opacity-90 transition text-sm sm:text-base"
              >
                Ver planes y empezar
              </Link>
              <a
                href={waLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 px-6 sm:px-7 py-3 sm:py-3.5 rounded-full bg-white text-ink border-2 border-ink/90 font-semibold hover:bg-ink/5 transition text-sm sm:text-base"
              >
                Hablar con ventas
              </a>
              {igLink && (
                <a
                  href={igLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-5 sm:px-6 py-3 sm:py-3.5 rounded-full text-white font-semibold shadow-md hover:opacity-90 transition text-sm sm:text-base"
                  style={{
                    background:
                      'linear-gradient(135deg, #F58529, #DD2A7B, #8134AF, #515BD4)',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                  </svg>
                  Instagram
                </a>
              )}
              {mailLink && (
                <a
                  href={mailLink}
                  className="inline-flex items-center justify-center gap-2 px-5 sm:px-6 py-3 sm:py-3.5 rounded-full bg-bg2 text-ink font-semibold hover:bg-line transition text-sm sm:text-base"
                >
                  ✉️ Email
                </a>
              )}
            </div>
          </div>

          {/* Columna derecha: iPhones tilted + badges flotantes
              Mobile: 1 iPhone centrado más chico
              Tablet+: 2 iPhones overlapping con badges */}
          <div className="relative h-[340px] sm:h-[400px] lg:h-[440px] mt-2 lg:mt-0 overflow-visible">
            {/* iPhone trasero (oculto en mobile, visible sm+) */}
            <div
              className="absolute right-0 top-1/2 hidden sm:block"
              style={{
                transform: 'translateY(-45%) rotate(12deg) translateX(20px)',
                zIndex: 1,
              }}
            >
              <div className="hidden lg:block">
                <MenuPhone width={200} background="#0a0a0a" delayS={0.6} />
              </div>
              <div className="block lg:hidden">
                <MenuPhone width={170} background="#0a0a0a" delayS={0.6} />
              </div>
            </div>

            {/* iPhone frontal (siempre visible) */}
            <div
              className="absolute left-1/2 top-1/2"
              style={{
                transform: 'translate(-50%, -50%) rotate(-6deg)',
                zIndex: 2,
              }}
            >
              {/* tres tamaños responsivos sin custom CSS */}
              <div className="hidden lg:block">
                <MenuPhone width={220} background="#FAFAF5" delayS={0} />
              </div>
              <div className="hidden sm:block lg:hidden">
                <MenuPhone width={190} background="#FAFAF5" delayS={0} />
              </div>
              <div className="block sm:hidden">
                <MenuPhone width={170} background="#FAFAF5" delayS={0} />
              </div>
            </div>

            {/* Badge: Multilenguaje (arriba derecha) — un poco más chico en mobile */}
            <div
              className="absolute top-2 sm:top-6 right-2 sm:right-6 z-10 flex items-center gap-1.5 sm:gap-2 bg-ink text-white px-3 sm:px-4 py-2 sm:py-2.5 rounded-full shadow-2xl text-xs sm:text-sm font-semibold"
              style={{ animation: 'clb-badge-float 4s ease-in-out infinite' }}
            >
              <span>🌐</span>
              Multilenguaje
            </div>

            {/* Badge: Rotación de productos (abajo izq) */}
            <div
              className="absolute bottom-4 sm:bottom-12 left-2 z-10 flex items-center gap-1.5 sm:gap-2 bg-ink text-white px-3 sm:px-4 py-2 sm:py-2.5 rounded-full shadow-2xl text-xs sm:text-sm font-semibold"
              style={{
                animation: 'clb-badge-float 4s ease-in-out 1s infinite',
              }}
            >
              <span>🍽</span>
              Rotación de productos
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
