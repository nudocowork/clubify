/* eslint-disable @next/next/no-img-element */
// Trío de iPhones para el hero del landing — composición "Abanico clásico":
// centro = métricas (frontal, más grande), izq = menú carrusel rotado -12°,
// der = wallet instalada rotado +12°. Animación float vertical desfasada.
//
// Patrón anti-bug: outer div lleva el transform (posición/rotación) y un
// wrapper <Float> interno solo anima translateY — así no se pisan transforms.

function Phone({
  width = 280,
  children,
}: {
  width?: number;
  children: React.ReactNode;
}) {
  const height = (width * 640) / 320;
  return (
    <div
      className="relative bg-[#0a0a0a] rounded-[40px] p-[8px] shadow-[0_30px_70px_-15px_rgba(0,0,0,0.4),0_0_0_1.5px_#1f1f1f,0_0_0_3px_#000]"
      style={{ width, height }}
    >
      <div className="absolute top-[8px] left-1/2 -translate-x-1/2 w-[90px] h-[24px] bg-black rounded-b-[16px] z-20" />
      <div className="w-full h-full bg-white rounded-[32px] overflow-hidden relative">
        <div className="absolute top-0 left-0 right-0 h-[28px] z-10 flex items-center justify-between px-6 text-[10px] font-semibold text-ink pointer-events-none bg-white">
          <span>11:42</span>
          <span>●●● 100%</span>
        </div>
        <div className="pt-[28px] h-full overflow-hidden">{children}</div>
        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-[90px] h-[4px] bg-black rounded-full opacity-90" />
      </div>
    </div>
  );
}

function Float({
  delay = 0,
  amplitude = 12,
  duration = 5,
  children,
}: {
  delay?: number;
  amplitude?: number;
  duration?: number;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        animation: `clb-floaty ${duration}s ease-in-out ${delay}s infinite`,
        ['--amp' as any]: `${amplitude}px`,
      }}
    >
      {children}
    </div>
  );
}

// ---------- Screens ----------
const PRODS = [
  { name: 'Café americano', price: '$5.000', img: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=200&h=200&fit=crop' },
  { name: 'Cappuccino', price: '$7.000', img: 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=200&h=200&fit=crop' },
  { name: 'Latte', price: '$8.500', img: 'https://images.unsplash.com/photo-1561882468-9110e03e0f78?w=200&h=200&fit=crop' },
];
const POSTRES = [
  { name: 'Cheesecake', price: '$12K', img: 'https://images.unsplash.com/photo-1567306226416-28f0efdc88ce?w=200&h=200&fit=crop' },
  { name: 'Brownie', price: '$10K', img: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?w=200&h=200&fit=crop' },
];

function ScreenMenuCarousel() {
  return (
    <div>
      <div className="relative h-24" style={{ background: 'linear-gradient(135deg, #C97B5F, #6B3E2A)' }}>
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
        <div className="absolute bottom-2 left-3 right-3 text-white">
          <div className="font-bold text-sm">Café del Día</div>
          <div className="text-[9px] opacity-85">⭐ 4.8 · Bogotá</div>
        </div>
      </div>
      <div className="px-3 pt-2.5">
        <div className="flex items-baseline justify-between mb-1.5">
          <h2 className="font-bold text-xs">⭐ Recomendados</h2>
          <span className="text-[9px] text-brand font-semibold">Ver →</span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-3 px-3">
          {PRODS.map((p) => (
            <div key={p.name} className="w-[80px] flex-none">
              <div className="aspect-square rounded-md overflow-hidden">
                <img src={p.img} alt="" className="w-full h-full object-cover" />
              </div>
              <div className="text-[9px] font-semibold leading-tight line-clamp-1 mt-0.5">{p.name}</div>
              <div className="text-[9px] font-bold text-brand">{p.price}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="px-3 mt-2">
        <div className="flex items-baseline justify-between mb-1.5">
          <h2 className="font-bold text-xs">🍰 Postres</h2>
          <span className="text-[9px] text-brand font-semibold">Ver →</span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-3 px-3">
          {POSTRES.map((p) => (
            <div key={p.name} className="w-[80px] flex-none">
              <div className="aspect-square rounded-md overflow-hidden">
                <img src={p.img} alt="" className="w-full h-full object-cover" />
              </div>
              <div className="text-[9px] font-semibold leading-tight line-clamp-1 mt-0.5">{p.name}</div>
              <div className="text-[9px] font-bold text-brand">{p.price}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ScreenWalletInstalled() {
  return (
    <div className="bg-[#f2f2f7] h-full">
      <div className="px-4 pt-3 pb-2 flex items-center justify-between">
        <button className="text-[10px] text-blue-500 font-medium">OK</button>
        <button className="text-[10px] text-blue-500">⋯</button>
      </div>
      <div className="px-4">
        <div className="text-[20px] font-bold tracking-tight">Wallet</div>
      </div>
      <div className="px-3 mt-3 relative">
        <div className="absolute left-3 right-3 h-12 rounded-2xl shadow-md" style={{ background: '#3B82F6', top: 0 }}>
          <div className="px-3 py-2 text-white text-[9px] font-semibold">💳 Visa Débito</div>
        </div>
        <div
          className="relative rounded-2xl shadow-2xl text-white p-3 mt-7"
          style={{ background: 'linear-gradient(135deg,#6366F1,#818CF8,#4F46E5)' }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <div className="w-5 h-5 rounded bg-white/20 flex items-center justify-center font-bold text-[9px]">C</div>
              <div className="font-semibold text-[11px]">Café del Día</div>
            </div>
            <div className="text-right">
              <div className="text-[7px] uppercase tracking-widest opacity-75">Sellos</div>
              <div className="font-bold text-xs">7/10</div>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-0.5 mt-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <div
                key={i}
                className="aspect-square rounded-full bg-white text-brand flex items-center justify-center text-[8px] font-bold"
              >
                ✓
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1 mt-2 text-[7px]">
            <div>
              <div className="opacity-75 uppercase">Titular</div>
              <div className="font-semibold">RICARDO PÉREZ</div>
            </div>
            <div className="text-right">
              <div className="opacity-75 uppercase">Premio</div>
              <div className="font-semibold">1 café gratis</div>
            </div>
          </div>
          <div className="bg-white rounded px-2 py-1.5 mt-2 flex items-center justify-center gap-[1.5px]">
            {Array.from({ length: 18 }).map((_, i) => (
              <div key={i} className="bg-ink" style={{ width: i % 3 === 0 ? 2 : 1.5, height: 16 }} />
            ))}
          </div>
          <div className="text-center text-[7px] tracking-widest mt-0.5 text-white/80">CDD-RP-7847</div>
        </div>
        <div className="text-center text-[9px] text-mute mt-3">Toca tu pase para usarlo</div>
      </div>
    </div>
  );
}

function ScreenMetrics() {
  return (
    <div className="px-3 pb-3 pt-1">
      <div className="text-[9px] uppercase tracking-wider text-mute font-semibold">Esta semana</div>
      <div className="text-base font-bold mt-0.5">Café del Día</div>

      <div className="bg-gradient-to-br from-brand-400 to-brand-700 rounded-2xl p-3 text-white mt-2.5">
        <div className="text-[9px] uppercase tracking-wider opacity-90">Ingresos 7d</div>
        <div className="text-2xl font-black mt-0.5">$3.4M</div>
        <div className="text-[10px] opacity-90 flex items-center gap-1 mt-1">
          <span>↑ 18%</span>
          <span className="opacity-70">vs semana anterior</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5 mt-2">
        <div className="bg-bg2 rounded-lg p-1.5">
          <div className="text-[8px] uppercase text-mute font-semibold">Pedidos</div>
          <div className="text-sm font-bold">142</div>
        </div>
        <div className="bg-bg2 rounded-lg p-1.5">
          <div className="text-[8px] uppercase text-mute font-semibold">Ticket</div>
          <div className="text-sm font-bold">$24K</div>
        </div>
        <div className="bg-bg2 rounded-lg p-1.5">
          <div className="text-[8px] uppercase text-mute font-semibold">Sellos</div>
          <div className="text-sm font-bold">87</div>
        </div>
      </div>

      <div className="bg-bg2/50 rounded-lg p-2.5 mt-2">
        <div className="text-[9px] uppercase tracking-wider text-mute font-semibold mb-1.5">Pedidos por día</div>
        <svg viewBox="0 0 140 50" className="w-full h-12">
          <defs>
            <linearGradient id="herotrio-grad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#6366F1" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#6366F1" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0,40 L20,32 L40,35 L60,22 L80,28 L100,15 L120,18 L140,8 L140,50 L0,50 Z"
            fill="url(#herotrio-grad)"
          />
          <polyline
            fill="none"
            stroke="#6366F1"
            strokeWidth="2"
            points="0,40 20,32 40,35 60,22 80,28 100,15 120,18 140,8"
          />
          {[40, 32, 35, 22, 28, 15, 18, 8].map((y, i) => (
            <circle key={i} cx={i * 20} cy={y} r="2" fill="#6366F1" />
          ))}
        </svg>
        <div className="flex justify-between text-[7px] text-mute mt-1 px-0.5">
          {['L', 'M', 'M', 'J', 'V', 'S', 'D', 'L'].map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
      </div>

      <div className="text-[9px] uppercase tracking-wider text-mute font-semibold mt-2 mb-1">Más vendidos</div>
      <div className="space-y-1">
        {[
          { name: 'Cappuccino', n: 42, pct: 90 },
          { name: 'Café americano', n: 36, pct: 78 },
          { name: 'Latte vainilla', n: 28, pct: 60 },
        ].map((p) => (
          <div key={p.name} className="flex items-center gap-1.5 text-[10px]">
            <div className="flex-1 bg-bg2 rounded-full h-3 overflow-hidden relative">
              <div className="absolute inset-y-0 left-0 bg-brand rounded-full" style={{ width: `${p.pct}%` }} />
              <span className="absolute inset-0 px-1.5 flex items-center text-[8px] font-semibold text-white">
                {p.name}
              </span>
            </div>
            <span className="font-bold w-6 text-right">{p.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// HeroTrio público
// ============================================================
export function HeroTrio() {
  return (
    <>
      <style>{`
        @keyframes clb-floaty {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(calc(var(--amp, 12px) * -1)); }
        }
      `}</style>
      <div className="relative h-[640px] w-full flex items-center justify-center pointer-events-none">
        {/* Atrás-izq: menú con carruseles, rotado -12° */}
        <div
          className="absolute"
          style={{
            transform: 'translateX(-200px) translateY(30px) rotate(-12deg)',
            zIndex: 1,
          }}
        >
          <Float delay={0} amplitude={10}>
            <Phone width={230}>
              <ScreenMenuCarousel />
            </Phone>
          </Float>
        </div>

        {/* Centro: métricas (frontal, más grande) */}
        <div className="absolute z-10">
          <Float delay={0.4} amplitude={14}>
            <Phone width={280}>
              <ScreenMetrics />
            </Phone>
          </Float>
        </div>

        {/* Atrás-der: wallet instalada, rotado +12° */}
        <div
          className="absolute"
          style={{
            transform: 'translateX(200px) translateY(30px) rotate(12deg)',
            zIndex: 1,
          }}
        >
          <Float delay={0.8} amplitude={10}>
            <Phone width={230}>
              <ScreenWalletInstalled />
            </Phone>
          </Float>
        </div>
      </div>
    </>
  );
}
