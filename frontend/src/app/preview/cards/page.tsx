/* eslint-disable @next/next/no-img-element */
// 5 estilos visuales para mostrar las tarjetas de fidelización en /app/cards.
// Sin auth — público para que el cliente decida.

const CARDS = [
  { type: 'STAMPS', label: 'Sellos', name: 'Café del Día · 10 sellos', reward: '1 café gratis', stamped: 3, total: 10, passes: 248, color: '#22C55E', accent: '#4ADE80' },
  { type: 'COUPON', label: 'Cupón', name: 'Bienvenida 2x1', reward: 'Al primer pedido', passes: 156, color: '#10B981', accent: '#22C55E' },
];

const TYPE_EMOJI: Record<string, string> = {
  STAMPS: '☕',
  COUPON: '🎟',
};

function Section({
  num,
  title,
  best,
  pros,
  children,
}: {
  num: number;
  title: string;
  best: string;
  pros: string[];
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-line rounded-2xl p-6 shadow-sm">
      <header className="mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-brand text-white font-bold text-sm flex items-center justify-center">
              {num}
            </span>
            <h2 className="text-xl font-bold m-0">{title}</h2>
          </div>
          <p className="text-mute text-sm mt-1.5">
            <strong className="text-ink">Mejor para:</strong> {best}
          </p>
        </div>
        <ul className="text-[11px] text-mute space-y-0.5 max-w-xs">
          {pros.map((p) => (
            <li key={p}>✓ {p}</li>
          ))}
        </ul>
      </header>
      <div className="bg-bg2/40 rounded-xl p-5">{children}</div>
    </section>
  );
}

// =====================================================
// 1️⃣ ACTUAL (gradiente morado uniforme)
// =====================================================
function Option1Current() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {CARDS.slice(0, 6).map((c) => (
        <div key={c.type} className="bg-white rounded-xl border border-line overflow-hidden">
          <div className="rounded-xl m-3 p-4 text-white" style={{ background: `linear-gradient(135deg, #22C55E, #4ADE80)` }}>
            <div className="text-[10px] tracking-widest uppercase opacity-80">{c.type}</div>
            <div className="font-bold mt-1.5">{c.name}</div>
            <div className="text-xs opacity-90 mt-1">{c.reward}</div>
          </div>
          <div className="px-4 pb-3 flex items-center justify-between">
            <div className="text-xs text-mute">{c.label}</div>
            <a className="text-brand text-xs font-semibold">{c.passes} pases →</a>
          </div>
        </div>
      ))}
    </div>
  );
}

// =====================================================
// 2️⃣ COLORES POR TIPO + ICONO grande
// =====================================================
function Option2Colored() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {CARDS.slice(0, 6).map((c) => (
        <div
          key={c.type}
          className="rounded-2xl p-5 text-white relative overflow-hidden cursor-pointer hover:scale-[1.02] transition"
          style={{ background: `linear-gradient(135deg, ${c.color}, ${c.accent})` }}
        >
          <div className="absolute -right-4 -top-4 text-9xl opacity-10 select-none">
            {TYPE_EMOJI[c.type]}
          </div>
          <div className="relative">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-bold opacity-90">
              <span className="text-base">{TYPE_EMOJI[c.type]}</span>
              {c.label}
            </div>
            <div className="font-bold text-lg mt-2 leading-tight">{c.name}</div>
            <div className="text-sm opacity-85 mt-1">{c.reward}</div>
            <div className="mt-5 flex items-end justify-between">
              <div>
                <div className="text-3xl font-black">{c.passes}</div>
                <div className="text-[10px] uppercase tracking-wider opacity-80">pases activos</div>
              </div>
              <div className="text-xs opacity-90 underline">Ver →</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// =====================================================
// 3️⃣ APPLE WALLET PASS (looks like real wallet)
// =====================================================
function Option3Wallet() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
      {CARDS.slice(0, 4).map((c) => (
        <div key={c.type} className="cursor-pointer hover:translate-y-[-3px] transition">
          <div
            className="rounded-2xl shadow-xl overflow-hidden text-white"
            style={{
              background: `linear-gradient(155deg, ${c.color}, ${c.accent})`,
              aspectRatio: '1.586/1',
            }}
          >
            <div className="p-5 h-full flex flex-col justify-between">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[9px] uppercase tracking-[0.3em] opacity-75">{c.label}</div>
                  <div className="font-semibold mt-1 text-sm">{c.name}</div>
                </div>
                <div className="w-9 h-9 rounded-lg bg-white/20 backdrop-blur flex items-center justify-center text-lg">
                  {TYPE_EMOJI[c.type]}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-[0.2em] opacity-75">Recompensa</div>
                <div className="font-bold text-sm">{c.reward}</div>
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-[9px] uppercase tracking-[0.2em] opacity-75">Activos</div>
                  <div className="text-2xl font-bold leading-none">{c.passes}</div>
                </div>
                {/* fake barcode */}
                <div className="flex gap-[2px]">
                  {Array.from({ length: 14 }).map((_, i) => (
                    <div key={i} className="bg-white/95" style={{ width: i % 3 === 0 ? 3 : 2, height: 22 }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// =====================================================
// 4️⃣ LISTA COMPACTA (table-like, info densa)
// =====================================================
function Option4List() {
  return (
    <div className="bg-white rounded-xl border border-line overflow-hidden">
      <div className="grid grid-cols-12 px-4 py-2.5 bg-bg2/60 text-[11px] uppercase tracking-wider font-semibold text-mute border-b border-line">
        <div className="col-span-5">Tarjeta</div>
        <div className="col-span-2">Tipo</div>
        <div className="col-span-3">Recompensa</div>
        <div className="col-span-2 text-right">Pases</div>
      </div>
      {CARDS.map((c) => (
        <div
          key={c.type}
          className="grid grid-cols-12 px-4 py-3 items-center border-b border-line last:border-b-0 hover:bg-bg2/30 cursor-pointer"
        >
          <div className="col-span-5 flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-lg text-white flex items-center justify-center text-base shadow-sm"
              style={{ background: `linear-gradient(135deg, ${c.color}, ${c.accent})` }}
            >
              {TYPE_EMOJI[c.type]}
            </div>
            <div>
              <div className="font-semibold text-sm">{c.name}</div>
              <div className="text-[11px] text-mute mt-0.5">Activa · creada hace 2 días</div>
            </div>
          </div>
          <div className="col-span-2">
            <span
              className="text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded"
              style={{ background: `${c.color}15`, color: c.color }}
            >
              {c.label}
            </span>
          </div>
          <div className="col-span-3 text-sm text-ink">{c.reward}</div>
          <div className="col-span-2 text-right">
            <div className="font-bold">{c.passes}</div>
            <div className="text-[10px] text-mute">activos</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// =====================================================
// 5️⃣ "FÍSICA" — credit card aspect + chip + foil
// =====================================================
function Option5Physical() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-3xl mx-auto">
      {CARDS.slice(0, 4).map((c) => (
        <div key={c.type} className="cursor-pointer group">
          <div
            className="rounded-2xl shadow-2xl text-white overflow-hidden relative"
            style={{
              background: `linear-gradient(135deg, ${c.color} 0%, ${c.accent} 60%, ${c.color} 100%)`,
              aspectRatio: '1.586/1',
            }}
          >
            {/* Reflejo holográfico */}
            <div
              className="absolute inset-0 opacity-30 group-hover:opacity-50 transition"
              style={{
                background:
                  'linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.4) 50%, transparent 70%)',
              }}
            />
            <div className="absolute inset-0 p-6 flex flex-col justify-between">
              {/* Top: brand + chip */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.3em] opacity-90">CLUBIFY</div>
                  <div className="text-[9px] tracking-[0.2em] opacity-70 mt-0.5">{c.label.toUpperCase()}</div>
                </div>
                {/* Chip */}
                <div className="w-10 h-7 rounded bg-gradient-to-br from-amber-300 via-amber-500 to-amber-700 shadow-inner relative">
                  <div className="absolute inset-1 border border-amber-200/50 rounded-sm grid grid-cols-2 grid-rows-2 gap-px">
                    <div className="bg-amber-300/30" />
                    <div className="bg-amber-300/30" />
                    <div className="bg-amber-300/30" />
                    <div className="bg-amber-300/30" />
                  </div>
                </div>
              </div>

              {/* Middle: name */}
              <div>
                <div className="font-bold text-xl tracking-tight">{c.name}</div>
                <div className="text-xs opacity-85 mt-0.5">{c.reward}</div>
              </div>

              {/* Bottom: passes + valid */}
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-[9px] uppercase tracking-[0.2em] opacity-70">Pases activos</div>
                  <div className="font-mono text-base tracking-widest">{c.passes.toString().padStart(4, '0')}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-[0.2em] opacity-70">Tipo</div>
                  <div className="text-base">{TYPE_EMOJI[c.type]}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// =====================================================
// PAGE
// =====================================================
export default function CardsPreview() {
  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4 sm:px-6">
      <div className="max-w-6xl mx-auto">
        <header className="text-center mb-10">
          <div className="text-[11px] uppercase tracking-[0.2em] text-brand font-bold mb-2">
            Preview · Listado de tarjetas
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            5 maneras de mostrar tus tarjetas de fidelización
          </h1>
          <p className="text-mute mt-2 text-sm max-w-2xl mx-auto">
            Mismo data (6 tipos), 5 layouts distintos. Dime el número que prefieras.
          </p>
        </header>

        <div className="space-y-6">
          <Section
            num={1}
            title="Actual — gradiente uniforme"
            best="comparar contra los demás"
            pros={['Ya está implementado', 'Cards iguales / consistentes', 'Tipografía clara']}
          >
            <Option1Current />
          </Section>

          <Section
            num={2}
            title="Colores por tipo + icono grande"
            best="negocios con muchos tipos de tarjeta"
            pros={['Distinguible al instante', 'Stats grandes (X pases activos)', 'Icono ambient + temático por tipo']}
          >
            <Option2Colored />
          </Section>

          <Section
            num={3}
            title="Apple Wallet realista"
            best="dar sensación premium / Apple-style"
            pros={['Aspect ratio de tarjeta de crédito', 'Barcode real al lado', 'Se ve "como en el iPhone"']}
          >
            <Option3Wallet />
          </Section>

          <Section
            num={4}
            title="Lista compacta tipo tabla"
            best="negocios con 10+ tarjetas (admin power-user)"
            pros={['Información densa', 'Comparación lado a lado', 'Scan vertical rápido']}
          >
            <Option4List />
          </Section>

          <Section
            num={5}
            title="Tarjeta física con chip + holograma"
            best="branding premium, marketing visual"
            pros={['Sensación tangible (chip dorado)', 'Reflejo holográfico al hover', 'Muy "instagramable"']}
          >
            <Option5Physical />
          </Section>
        </div>

        <div className="text-center mt-10 text-sm text-mute">
          <div className="inline-flex items-center gap-2 bg-white border border-line rounded-full px-4 py-2 shadow-sm">
            💡 Mi sugerencia: <strong className="text-ink">opción 2</strong> (color por tipo + stats grandes — diferencia visual instantánea sin perder info)
          </div>
        </div>
      </div>
    </main>
  );
}
