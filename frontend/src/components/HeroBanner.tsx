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

export function HeroBanner() {
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
      <section className="relative overflow-hidden bg-white py-14 md:py-20">
        <div className="mx-auto max-w-7xl px-6 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Columna izquierda: título + CTAs */}
          <div>
            <h2 className="text-4xl md:text-6xl font-bold tracking-tight leading-[1.05]">
              Menús digitales con{' '}
              <span className="text-brand">inteligencia artificial</span>
            </h2>
            <p className="text-mute text-base md:text-lg mt-5 max-w-xl leading-relaxed">
              Tu menú vive en el iPhone de tu cliente. Foto + variantes +
              traducción automática + rotación de los más vendidos. Cero
              imprenta, cero fricción.
            </p>
            <div className="flex flex-wrap gap-3 mt-8">
              <a
                href="https://wa.me/573001234567?text=Hola%2C%20quiero%20mi%20men%C3%BA%20digital"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-[#25D366] text-white font-semibold shadow-md hover:opacity-90 transition"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448L.057 24z" />
                </svg>
                WhatsApp Comercial
              </a>
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-brand text-white font-semibold shadow-md hover:opacity-90 transition"
              >
                Obtén tu menú
              </Link>
            </div>
          </div>

          {/* Columna derecha: 2 iPhones tilted + badges flotantes */}
          <div className="relative h-[480px] md:h-[560px] hidden md:block">
            {/* iPhone trasero (tilted derecha, más al fondo) */}
            <div
              className="absolute right-0 top-1/2"
              style={{
                transform: 'translateY(-45%) rotate(12deg) translateX(40px)',
                zIndex: 1,
              }}
            >
              <MenuPhone width={240} background="#0a0a0a" delayS={0.6} />
            </div>
            {/* iPhone frontal (tilted izq) */}
            <div
              className="absolute left-1/2 top-1/2"
              style={{
                transform: 'translate(-60%, -50%) rotate(-8deg)',
                zIndex: 2,
              }}
            >
              <MenuPhone width={260} background="#FAFAF5" delayS={0} />
            </div>

            {/* Badge flotante: Multilenguaje (arriba derecha) */}
            <div
              className="absolute top-6 right-6 z-10 flex items-center gap-2 bg-ink text-white px-4 py-2.5 rounded-full shadow-2xl text-sm font-semibold"
              style={{ animation: 'clb-badge-float 4s ease-in-out infinite' }}
            >
              <span>🌐</span>
              Multilenguaje
            </div>

            {/* Badge flotante: Rotación de productos (centro izq) */}
            <div
              className="absolute bottom-12 left-2 z-10 flex items-center gap-2 bg-ink text-white px-4 py-2.5 rounded-full shadow-2xl text-sm font-semibold"
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
