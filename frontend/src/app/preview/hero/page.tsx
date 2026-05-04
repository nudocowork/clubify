/* eslint-disable @next/next/no-img-element */
// 5 mockups del hero principal del landing. El usuario elige cuál usamos.

const ORDERS = [
  { code: 'A4F2', name: 'Camila R.', status: 'Listo', tone: 'bg-ok' },
  { code: 'A4F1', name: 'Daniel M.', status: 'Cocina', tone: 'bg-brand' },
  { code: 'A4F0', name: 'Lucia G.', status: 'Listo', tone: 'bg-ok' },
];

// ============================================================
// PHONE FRAME (con notch real, status bar, home indicator)
// ============================================================
function Phone({
  width = 320,
  height = 640,
  children,
  className = '',
  style = {},
}: {
  width?: number;
  height?: number;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`relative bg-[#0a0a0a] rounded-[44px] p-[10px] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45),0_0_0_1.5px_#1f1f1f,0_0_0_3px_#000] ${className}`}
      style={{ width, height, ...style }}
    >
      <div className="absolute top-[10px] left-1/2 -translate-x-1/2 w-[110px] h-[28px] bg-black rounded-b-[18px] z-20" />
      <div className="w-full h-full bg-white rounded-[36px] overflow-hidden relative">
        <div className="absolute top-0 left-0 right-0 h-[34px] z-10 flex items-center justify-between px-7 text-[12px] font-semibold text-ink pointer-events-none bg-white">
          <span>11:42</span>
          <span>●●● 100%</span>
        </div>
        <div className="pt-[34px] h-full overflow-hidden">{children}</div>
        <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-[110px] h-[5px] bg-black rounded-full opacity-90" />
      </div>
    </div>
  );
}

// ============================================================
// SCREEN: Mini dashboard
// ============================================================
function ScreenDashboard() {
  return (
    <div className="px-4 pb-4 pt-2">
      <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">Dashboard</div>
      <div className="text-base font-bold mt-0.5">Café del Día</div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <div className="bg-brand-soft rounded-lg p-2.5">
          <div className="text-[9px] uppercase tracking-wider text-brand-700 font-semibold">Hoy</div>
          <div className="text-lg font-bold mt-0.5">24 pedidos</div>
        </div>
        <div className="bg-ok-soft rounded-lg p-2.5">
          <div className="text-[9px] uppercase tracking-wider text-ok font-semibold">Ingresos</div>
          <div className="text-lg font-bold mt-0.5">$430K</div>
        </div>
      </div>
      <div className="bg-bg2 rounded-lg p-3 mt-2">
        <div className="text-[9px] uppercase tracking-wider text-mute font-semibold mb-1">Últimos 7 días</div>
        <svg viewBox="0 0 100 30" className="w-full h-8">
          <polyline fill="none" stroke="#22C55E" strokeWidth="2" points="0,22 14,18 28,20 42,12 56,15 70,8 84,10 100,5" />
        </svg>
      </div>
      <div className="text-[9px] uppercase tracking-wider text-mute font-semibold mt-3 mb-1">Pedidos en curso</div>
      <div className="space-y-1.5">
        {ORDERS.map((o) => (
          <div key={o.code} className="flex items-center justify-between text-[11px] bg-bg2/60 rounded px-2 py-1.5">
            <span className="font-mono text-mute">#{o.code}</span>
            <span className="font-medium">{o.name}</span>
            <span className={`${o.tone} text-white text-[9px] font-semibold px-1.5 py-0.5 rounded-full`}>
              {o.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// SCREEN: Menu de cliente
// ============================================================
function ScreenMenu() {
  return (
    <div>
      <div className="relative h-32">
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(135deg, #C97B5F, #6B3E2A)' }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="absolute bottom-3 left-4 right-4 text-white">
          <div className="font-bold text-lg">Café del Día</div>
          <div className="text-[11px] opacity-85">⭐ 4.8 · Bogotá</div>
        </div>
      </div>
      <div className="px-4 pt-3">
        <div className="flex gap-3 text-xs font-semibold mb-2">
          <span className="text-brand border-b-2 border-brand pb-1">Bebidas</span>
          <span className="text-mute pb-1">Postres</span>
          <span className="text-mute pb-1">Sándwiches</span>
        </div>
        <div className="space-y-2">
          {[
            { name: 'Café americano', price: '$5.000', emoji: '☕' },
            { name: 'Cappuccino', price: '$7.000', emoji: '☕' },
            { name: 'Mocaccino', price: '$9.000', emoji: '🍫' },
          ].map((p) => (
            <div key={p.name} className="flex items-center gap-2.5 bg-bg2/40 rounded-lg p-2">
              <div className="w-12 h-12 rounded-md bg-bg2 flex items-center justify-center text-xl">
                {p.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[13px]">{p.name}</div>
                <div className="text-[11px] text-mute">Espresso doble + …</div>
              </div>
              <div className="text-sm font-bold">{p.price}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SCREEN: Wallet pass dentro del iPhone
// ============================================================
function ScreenWalletInside() {
  return (
    <div className="px-4 pt-4">
      <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-2">
        Wallet
      </div>
      <div
        className="rounded-2xl p-4 text-white shadow-lg"
        style={{ background: 'linear-gradient(135deg,#22C55E,#4ADE80,#15803D)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="w-7 h-7 rounded-md bg-white/20 flex items-center justify-center font-bold text-[11px]">
              C
            </div>
            <div className="font-semibold text-sm">Café del Día</div>
          </div>
          <div className="text-right">
            <div className="text-[8px] uppercase tracking-widest opacity-75">Sellos</div>
            <div className="font-bold">7/10</div>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1.5 mt-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className={`w-full aspect-square rounded-full flex items-center justify-center text-[10px] font-bold ${
                i < 7 ? 'bg-white text-brand' : 'border-2 border-white/40'
              }`}
            >
              {i < 7 ? '✓' : ''}
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[9px]">
          <div>
            <div className="opacity-75 uppercase tracking-wider">Titular</div>
            <div className="font-semibold mt-0.5">RICARDO PÉREZ</div>
          </div>
          <div className="text-right">
            <div className="opacity-75 uppercase tracking-wider">Premio</div>
            <div className="font-semibold mt-0.5">1 café gratis</div>
          </div>
        </div>
        {/* Barcode */}
        <div className="bg-white rounded-md px-3 py-2 mt-3 flex items-center justify-center gap-[2px]">
          {Array.from({ length: 22 }).map((_, i) => (
            <div
              key={i}
              className="bg-ink"
              style={{ width: i % 3 === 0 ? 3 : 2, height: 24 }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 1️⃣ ACTUAL
// ============================================================
function Hero1Current() {
  return (
    <div className="relative h-[680px] flex items-center justify-center">
      <Phone>
        <ScreenDashboard />
      </Phone>
      {/* Wallet card overlay */}
      <div
        className="absolute bottom-2 left-0 w-[260px] rotate-[-8deg] rounded-2xl shadow-2xl text-white p-4"
        style={{ background: 'linear-gradient(135deg,#22C55E,#4ADE80,#15803D)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-6 rounded bg-white/20 flex items-center justify-center font-bold text-[10px]">C</div>
            <div className="font-semibold text-sm">Café del Día</div>
          </div>
          <div className="text-right">
            <div className="text-[8px] uppercase tracking-widest opacity-75">Sellos</div>
            <div className="font-bold">7/10</div>
          </div>
        </div>
        <div className="flex gap-1 mt-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="w-6 h-6 rounded-full bg-white text-brand flex items-center justify-center text-[10px] font-bold">✓</div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 text-[9px]">
          <div>
            <div className="opacity-75 uppercase">TITULAR</div>
            <div className="font-semibold">RICARDO PÉREZ</div>
          </div>
          <div className="text-right">
            <div className="opacity-75 uppercase">PREMIO</div>
            <div className="font-semibold">1 café gratis</div>
          </div>
        </div>
      </div>
      {/* Notification top right */}
      <div className="absolute top-2 right-0 bg-white rounded-2xl shadow-xl p-3 flex items-center gap-2.5 max-w-[220px] border border-line">
        <div className="w-8 h-8 rounded-lg bg-ok-soft text-ok flex items-center justify-center text-sm">🔔</div>
        <div className="text-[11px] leading-tight">
          <div className="font-semibold">Nuevo pedido #A4F3</div>
          <div className="text-mute">Sofía L. · 2 items</div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 2️⃣ TRIO EN ABANICO (3 iPhones cascaded)
// ============================================================
function Hero2Trio() {
  return (
    <div className="relative h-[680px] flex items-center justify-center">
      {/* Back: Menu */}
      <div className="absolute" style={{ transform: 'translateX(-110px) translateY(40px) rotate(-10deg) scale(0.85)', zIndex: 1 }}>
        <Phone>
          <ScreenMenu />
        </Phone>
      </div>
      {/* Back: Wallet */}
      <div className="absolute" style={{ transform: 'translateX(110px) translateY(40px) rotate(10deg) scale(0.85)', zIndex: 1 }}>
        <Phone>
          <ScreenWalletInside />
        </Phone>
      </div>
      {/* Front: Dashboard */}
      <div className="relative z-10 shadow-[0_50px_100px_-20px_rgba(91,94,238,0.45)]">
        <Phone>
          <ScreenDashboard />
        </Phone>
      </div>
    </div>
  );
}

// ============================================================
// 3️⃣ TARJETA + iPHONE LADO A LADO (limpio, sin rotación)
// ============================================================
function Hero3SideBySide() {
  return (
    <div className="relative h-[680px] flex items-center justify-center gap-8">
      {/* Wallet pass real grande a la izq */}
      <div
        className="rounded-[20px] shadow-2xl text-white relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg,#22C55E,#4ADE80,#15803D)',
          width: 280,
          aspectRatio: '1.586/1',
        }}
      >
        <div
          className="absolute inset-0 opacity-30"
          style={{ background: 'linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.4) 50%, transparent 70%)' }}
        />
        <div className="absolute inset-0 p-5 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] opacity-90">CLUBIFY</div>
              <div className="text-[9px] tracking-[0.2em] opacity-70 mt-0.5">SELLOS</div>
            </div>
            <div className="w-9 h-7 rounded bg-gradient-to-br from-amber-300 via-amber-500 to-amber-700 shadow-inner" />
          </div>
          <div>
            <div className="font-bold text-lg">Café del Día</div>
            <div className="text-xs opacity-85">7/10 · 1 café gratis</div>
          </div>
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[9px] uppercase opacity-70">TITULAR</div>
              <div className="font-mono text-sm tracking-widest">RICARDO PÉREZ</div>
            </div>
            <div className="text-base">☕</div>
          </div>
        </div>
      </div>
      <Phone>
        <ScreenDashboard />
      </Phone>
    </div>
  );
}

// ============================================================
// 4️⃣ ACTIVITY STREAM (varias notificaciones flotando)
// ============================================================
function Hero4Activity() {
  const NOTIFS = [
    { emoji: '🔔', tone: 'bg-ok-soft text-ok', title: 'Nuevo pedido #A4F3', sub: 'Sofía L. · 2 items', pos: 'top-2 -right-6' },
    { emoji: '✨', tone: 'bg-brand-soft text-brand-700', title: '+3 sellos otorgados', sub: 'Ricardo P. · llegó al premio', pos: 'top-32 -left-12' },
    { emoji: '💰', tone: 'bg-amber-100 text-amber-800', title: '$45.000 cobrados', sub: 'Pedido #A4F2 entregado', pos: 'bottom-44 -right-10' },
    { emoji: '👤', tone: 'bg-pink-100 text-pink-800', title: 'Cliente nuevo', sub: 'Lucia G. · primera vez', pos: 'bottom-12 -left-6' },
  ];
  return (
    <div className="relative h-[680px] flex items-center justify-center">
      <Phone>
        <ScreenDashboard />
      </Phone>
      {NOTIFS.map((n, i) => (
        <div
          key={i}
          className={`absolute ${n.pos} bg-white rounded-2xl shadow-xl p-3 flex items-center gap-2.5 max-w-[220px] border border-line`}
        >
          <div className={`w-8 h-8 rounded-lg ${n.tone} flex items-center justify-center text-sm flex-none`}>
            {n.emoji}
          </div>
          <div className="text-[11px] leading-tight">
            <div className="font-semibold">{n.title}</div>
            <div className="text-mute">{n.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// 5️⃣ SPLIT: cliente + dueño
// ============================================================
function Hero5Split() {
  return (
    <div className="relative h-[680px] flex items-center justify-center gap-6">
      {/* Cliente: storefront */}
      <div className="relative">
        <div className="absolute -top-3 -left-3 bg-pink-500 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full shadow z-30">
          👤 Tu cliente ve
        </div>
        <Phone width={290} height={580}>
          <ScreenMenu />
        </Phone>
      </div>
      {/* Dueño: dashboard */}
      <div className="relative">
        <div className="absolute -top-3 -right-3 bg-brand text-white text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full shadow z-30">
          💼 Tú ves
        </div>
        <Phone width={290} height={580}>
          <ScreenDashboard />
        </Phone>
      </div>
    </div>
  );
}

// ============================================================
// PAGE
// ============================================================
function Section({ num, title, desc, best, children }: { num: number; title: string; desc: string; best: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-line rounded-2xl p-6 shadow-sm overflow-hidden">
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-brand text-white font-bold text-sm flex items-center justify-center">
              {num}
            </span>
            <h2 className="text-xl font-bold m-0">{title}</h2>
          </div>
          <p className="text-mute text-sm mt-1.5 max-w-md">{desc}</p>
        </div>
        <div className="text-[11px] text-mute max-w-[260px]">
          <strong className="text-ink">Mejor para:</strong> {best}
        </div>
      </header>
      <div className="bg-gradient-to-br from-bg2/50 to-bg2/20 rounded-xl p-6 flex justify-center min-h-[700px]">
        {children}
      </div>
    </section>
  );
}

export default function HeroPreview() {
  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-5xl mx-auto">
        <header className="text-center mb-10">
          <div className="text-[11px] uppercase tracking-[0.2em] text-brand font-bold mb-2">
            Preview · Hero del landing
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            5 maneras de mostrar el producto en el hero
          </h1>
          <p className="text-mute mt-2 text-sm">Dime el número que prefieras y lo aplico al landing principal.</p>
        </header>

        <div className="space-y-6">
          <Section num={1} title="Actual" desc="Lo que tienes hoy. iPhone con tarjeta inclinada y notificación arriba." best="comparar contra los demás">
            <Hero1Current />
          </Section>
          <Section num={2} title="Trío en abanico" desc="3 iPhones mostrando 3 vistas del producto: dashboard al frente, menú cliente atrás-izq, wallet atrás-der." best="comunicar variedad de pantallas/casos de uso">
            <Hero2Trio />
          </Section>
          <Section num={3} title="Tarjeta + iPhone lado a lado" desc="Wallet card grande con efecto holograma a la izq, iPhone limpio a la derecha. Sin rotación, muy ordenado." best="marcas premium con foco en branding">
            <Hero3SideBySide />
          </Section>
          <Section num={4} title="Activity stream" desc="iPhone al centro con 4 notificaciones de eventos reales flotando alrededor: pedido, sellos, cobro, cliente nuevo." best="comunicar 'la app vive 24/7'">
            <Hero4Activity />
          </Section>
          <Section num={5} title="Split: cliente + dueño" desc="2 iPhones lado a lado. Izq: lo que ve tu cliente. Der: lo que ves tú. Comunica el modelo B2B2C." best="explicar producto en 1 imagen">
            <Hero5Split />
          </Section>
        </div>

        <div className="text-center mt-10 text-sm text-mute">
          <div className="inline-flex items-center gap-2 bg-white border border-line rounded-full px-4 py-2 shadow-sm">
            💡 Mi sugerencia: <strong className="text-ink">opción 5</strong> (split cliente + dueño) — explica el producto en 1 segundo
          </div>
        </div>
      </div>
    </main>
  );
}
