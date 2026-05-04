/* eslint-disable @next/next/no-img-element */
// 5 mockups del menú mobile para que el usuario elija. No requiere auth.

const PRODUCTS = [
  {
    name: 'Café americano',
    desc: 'Espresso doble + agua filtrada caliente',
    price: 5000,
    img: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=400&h=400&fit=crop',
    tag: null,
  },
  {
    name: 'Cappuccino',
    desc: 'Espresso + leche vaporizada + espuma',
    price: 7000,
    img: 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=400&h=400&fit=crop',
    tag: 'NUEVO',
  },
  {
    name: 'Latte vainilla',
    desc: 'Espresso + leche vaporizada + jarabe natural',
    price: 8500,
    img: 'https://images.unsplash.com/photo-1561882468-9110e03e0f78?w=400&h=400&fit=crop',
    tag: null,
  },
  {
    name: 'Mocaccino',
    desc: 'Café + chocolate belga + crema batida',
    price: 9000,
    img: 'https://images.unsplash.com/photo-1517256064527-09c73fc73e38?w=400&h=400&fit=crop',
    tag: '⭐ Más vendido',
  },
];

const POSTRES = [
  {
    name: 'Cheesecake fresa',
    desc: 'Hecho en casa · 1 porción',
    price: 12000,
    img: 'https://images.unsplash.com/photo-1567306226416-28f0efdc88ce?w=400&h=400&fit=crop',
    tag: null,
  },
  {
    name: 'Brownie',
    desc: 'Con helado de vainilla',
    price: 10000,
    img: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?w=400&h=400&fit=crop',
    tag: null,
  },
  {
    name: 'Croissant almendras',
    desc: 'Hojaldre francés relleno',
    price: 8500,
    img: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=400&h=400&fit=crop',
    tag: null,
  },
];

const fmt = (n: number) =>
  '$' + n.toLocaleString('es-CO', { maximumFractionDigits: 0 });

const HERO =
  'https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=900&h=600&fit=crop';
const LOGO_BG =
  'linear-gradient(135deg, #C97B5F, #8B4513)';

// ============================================================
// Phone frame wrapper
// ============================================================
function Phone({
  num,
  title,
  pros,
  best,
  children,
}: {
  num: number;
  title: string;
  pros: string[];
  best: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center">
      <div className="mb-3 text-center">
        <div className="inline-flex items-center gap-2 mb-2">
          <span className="w-7 h-7 rounded-full bg-brand text-white font-bold text-sm flex items-center justify-center">
            {num}
          </span>
          <span className="text-lg font-bold text-ink">{title}</span>
        </div>
      </div>
      {/* iPhone frame */}
      <div className="relative w-[320px] h-[640px] bg-black rounded-[44px] p-2 shadow-2xl">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-7 bg-black rounded-b-3xl z-10" />
        <div className="w-full h-full bg-white rounded-[36px] overflow-hidden relative">
          {/* Status bar */}
          <div className="absolute top-0 left-0 right-0 h-7 px-6 flex items-center justify-between text-[11px] font-semibold z-20 bg-white">
            <span>11:42</span>
            <span>●●● 100%</span>
          </div>
          <div className="pt-7 h-full overflow-y-auto scrollbar-none">
            {children}
          </div>
        </div>
      </div>
      <div className="mt-4 max-w-[320px] text-xs text-mute text-center space-y-1">
        <div>
          <strong className="text-ink">Mejor para:</strong> {best}
        </div>
        <ul className="text-[11px] space-y-0.5 mt-1">
          {pros.map((p) => (
            <li key={p}>✓ {p}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ============================================================
// Option 1 — Lista clásica delivery
// ============================================================
function Option1() {
  const Item = ({ p }: { p: any }) => (
    <div className="flex gap-3 px-4 py-3 border-b border-gray-100">
      <img src={p.img} alt="" className="w-20 h-20 rounded-xl object-cover flex-none" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-semibold text-sm">{p.name}</div>
          {p.tag && (
            <span className="text-[9px] uppercase tracking-wider bg-brand/10 text-brand font-bold px-1.5 py-0.5 rounded">
              {p.tag}
            </span>
          )}
        </div>
        <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{p.desc}</div>
        <div className="flex items-center justify-between mt-1.5">
          <div className="font-bold text-sm">{fmt(p.price)}</div>
          <button className="w-7 h-7 rounded-full bg-brand text-white text-lg leading-none flex items-center justify-center">
            +
          </button>
        </div>
      </div>
    </div>
  );
  return (
    <>
      <div className="px-4 py-3 flex items-center gap-3 border-b border-gray-100">
        <div
          className="w-10 h-10 rounded-xl text-white font-bold flex items-center justify-center"
          style={{ background: LOGO_BG }}
        >
          C
        </div>
        <div>
          <div className="font-bold text-[15px]">Café del Día</div>
          <div className="text-[11px] text-gray-500">⭐ 4.8 · 30-40 min</div>
        </div>
        <div className="ml-auto relative">
          <span className="text-xl">🛒</span>
          <span className="absolute -top-1 -right-1 bg-brand text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
            2
          </span>
        </div>
      </div>
      <div className="sticky top-0 bg-white z-10 px-4 py-2 border-b border-gray-100 flex gap-4 overflow-x-auto text-xs font-semibold">
        <span className="text-brand border-b-2 border-brand pb-1">Bebidas</span>
        <span className="text-gray-400 pb-1">Postres</span>
        <span className="text-gray-400 pb-1">Sándwiches</span>
        <span className="text-gray-400 pb-1">Combos</span>
      </div>
      {PRODUCTS.map((p, i) => (
        <Item key={i} p={p} />
      ))}
    </>
  );
}

// ============================================================
// Option 2 — Grid Instagram
// ============================================================
function Option2() {
  const Card = ({ p }: { p: any }) => (
    <div>
      <div className="aspect-square rounded-2xl overflow-hidden relative">
        <img src={p.img} alt="" className="w-full h-full object-cover" />
        {p.tag && (
          <span className="absolute top-2 left-2 text-[9px] uppercase tracking-wider bg-white/95 text-ink font-bold px-1.5 py-0.5 rounded shadow-sm">
            {p.tag}
          </span>
        )}
        <button className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-brand text-white shadow-lg text-lg flex items-center justify-center">
          +
        </button>
      </div>
      <div className="mt-1.5 px-1">
        <div className="text-[12px] font-semibold leading-tight line-clamp-1">
          {p.name}
        </div>
        <div className="text-[13px] font-bold text-brand mt-0.5">
          {fmt(p.price)}
        </div>
      </div>
    </div>
  );
  return (
    <>
      <div className="px-4 pt-4 pb-3 flex items-center gap-3">
        <div
          className="w-14 h-14 rounded-2xl text-white font-bold text-2xl flex items-center justify-center shadow-lg"
          style={{ background: LOGO_BG }}
        >
          C
        </div>
        <div>
          <div className="font-bold text-lg">Café del Día</div>
          <div className="text-[11px] text-gray-500">📍 Bogotá · Abierto</div>
        </div>
      </div>
      <div className="px-4 mb-3">
        <button className="w-full text-left text-sm font-semibold flex items-center justify-between py-2 border-b-2 border-ink">
          <span>Bebidas</span>
          <span className="text-xs text-gray-400">▾</span>
        </button>
      </div>
      <div className="px-4 grid grid-cols-2 gap-3 pb-4">
        {PRODUCTS.map((p, i) => (
          <Card key={i} p={p} />
        ))}
      </div>
    </>
  );
}

// ============================================================
// Option 3 — Hero + carruseles horizontales
// ============================================================
function Option3() {
  const Card = ({ p }: { p: any }) => (
    <div className="w-[120px] flex-none">
      <div className="aspect-square rounded-xl overflow-hidden relative">
        <img src={p.img} alt="" className="w-full h-full object-cover" />
        {p.tag && (
          <span className="absolute top-1.5 left-1.5 text-[8px] uppercase tracking-wider bg-white/95 text-ink font-bold px-1 py-0.5 rounded">
            {p.tag}
          </span>
        )}
      </div>
      <div className="mt-1 px-0.5">
        <div className="text-[11px] font-semibold leading-tight line-clamp-1">
          {p.name}
        </div>
        <div className="text-[12px] font-bold text-brand">{fmt(p.price)}</div>
      </div>
    </div>
  );
  return (
    <>
      <div className="relative h-44">
        <img src={HERO} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
        <div className="absolute bottom-3 left-4 right-4 text-white">
          <div className="font-bold text-2xl">Café del Día</div>
          <div className="text-xs flex items-center gap-1.5 mt-1">
            <span className="bg-amber-400 text-amber-950 text-[9px] font-bold px-1.5 py-0.5 rounded">
              ★ DESTACADO
            </span>
          </div>
        </div>
      </div>
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="font-bold text-base">⭐ Recomendados</h2>
          <span className="text-[11px] text-brand font-semibold">Ver todo →</span>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4">
          {PRODUCTS.map((p, i) => (
            <Card key={i} p={p} />
          ))}
        </div>
      </div>
      <div className="px-4 pb-4">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="font-bold text-base">🍰 Postres</h2>
          <span className="text-[11px] text-brand font-semibold">Ver todo →</span>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4">
          {POSTRES.map((p, i) => (
            <Card key={i} p={p} />
          ))}
        </div>
      </div>
    </>
  );
}

// ============================================================
// Option 4 — Lista limpia sin fotos (elegante)
// ============================================================
function Option4() {
  const Item = ({ p, withDivider = true }: { p: any; withDivider?: boolean }) => (
    <div className={`px-6 py-4 ${withDivider ? 'border-b border-gray-100' : ''}`}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-serif text-[15px] font-semibold">{p.name}</div>
        <div className="font-mono text-[13px] tracking-tight">{fmt(p.price)}</div>
      </div>
      <div className="text-[11px] text-gray-500 mt-1 italic">{p.desc}</div>
      {p.tag && (
        <div className="text-[9px] uppercase tracking-wider text-brand font-bold mt-1">
          ▸ {p.tag}
        </div>
      )}
    </div>
  );
  return (
    <>
      <div className="px-6 pt-8 pb-6 text-center border-b-2 border-ink">
        <div className="font-serif text-2xl font-bold">Café del Día</div>
        <div className="text-[10px] tracking-[0.3em] uppercase text-gray-500 mt-1">
          Boutique · Bogotá
        </div>
      </div>
      <div className="px-6 pt-5 pb-2">
        <div className="text-[10px] tracking-[0.3em] uppercase font-semibold text-gray-400 mb-1">
          Bebidas
        </div>
        <div className="w-8 h-px bg-ink" />
      </div>
      {PRODUCTS.map((p, i) => (
        <Item key={i} p={p} />
      ))}
      <div className="px-6 pt-5 pb-2">
        <div className="text-[10px] tracking-[0.3em] uppercase font-semibold text-gray-400 mb-1">
          Postres
        </div>
        <div className="w-8 h-px bg-ink" />
      </div>
      {POSTRES.map((p, i) => (
        <Item key={i} p={p} />
      ))}
    </>
  );
}

// ============================================================
// Option 5 — Lista compacta + modal full-screen
// ============================================================
function Option5() {
  return (
    <>
      <div className="relative h-32">
        <img src={HERO} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="absolute bottom-3 left-4 text-white">
          <div className="font-bold text-lg">Café del Día</div>
        </div>
      </div>
      <div className="sticky top-0 bg-white z-10 px-4 py-2 border-b border-gray-100 flex gap-4 text-xs font-semibold">
        <span className="text-brand border-b-2 border-brand pb-1">Bebidas</span>
        <span className="text-gray-400 pb-1">Postres</span>
      </div>
      <div className="border-b border-gray-100 px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="font-semibold text-sm">Café americano</div>
          <div className="font-bold text-sm">$5.000</div>
        </div>
        <div className="text-[11px] text-gray-500 mt-0.5">
          Espresso doble + agua filtrada
        </div>
      </div>
      <div className="border-b border-gray-100 px-4 py-3 bg-brand/5 ring-2 ring-brand/30">
        <div className="flex items-baseline justify-between gap-2">
          <div className="font-semibold text-sm flex items-center gap-1.5">
            Cappuccino
            <span className="text-[8px] uppercase bg-brand text-white font-bold px-1 py-0.5 rounded">
              ✨
            </span>
          </div>
          <div className="font-bold text-sm">$7.000</div>
        </div>
        <div className="text-[11px] text-gray-500 mt-0.5">
          Espresso + leche vaporizada + espuma
        </div>
      </div>
      {/* Modal sheet animation overlay */}
      <div className="absolute inset-x-0 bottom-0 top-32 bg-white rounded-t-3xl shadow-2xl z-20 flex flex-col">
        <div className="w-12 h-1 bg-gray-300 rounded-full mx-auto mt-2" />
        <div className="px-4 mt-3 flex-1 overflow-y-auto">
          <img
            src={PRODUCTS[1].img}
            alt=""
            className="w-full h-32 rounded-2xl object-cover"
          />
          <div className="mt-3 flex items-baseline justify-between">
            <div className="font-bold text-base">Cappuccino</div>
            <div className="font-bold text-base">$7.000</div>
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            Espresso + leche vaporizada + espuma
          </div>
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-wider text-gray-400 font-bold mb-1.5">
              Tamaño
            </div>
            <div className="space-y-1.5">
              <label className="flex items-center justify-between text-xs px-3 py-2 border border-gray-200 rounded-lg">
                <span className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-gray-300" />
                  Pequeño
                </span>
                <span className="text-gray-400">Incluido</span>
              </label>
              <label className="flex items-center justify-between text-xs px-3 py-2 border-2 border-brand bg-brand/5 rounded-lg">
                <span className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 rounded-full border-4 border-brand" />
                  Grande
                </span>
                <span className="font-semibold">+ $3.000</span>
              </label>
            </div>
          </div>
          <div className="mt-3">
            <div className="text-[11px] uppercase tracking-wider text-gray-400 font-bold mb-1.5">
              Extras
            </div>
            <label className="flex items-center justify-between text-xs px-3 py-2 border border-gray-200 rounded-lg">
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded border border-gray-300" />
                Crema batida
              </span>
              <span className="font-semibold">+ $1.500</span>
            </label>
          </div>
        </div>
        <div className="border-t border-gray-100 px-4 py-3 flex items-center gap-2.5">
          <div className="flex items-center gap-2 border border-gray-300 rounded-full px-2 py-0.5">
            <button className="w-6 h-6 text-gray-400">−</button>
            <span className="text-sm font-bold w-3 text-center">1</span>
            <button className="w-6 h-6 text-brand">+</button>
          </div>
          <button className="flex-1 bg-ink text-white text-xs font-bold py-2.5 rounded-full">
            Agregar · $10.000
          </button>
        </div>
      </div>
    </>
  );
}

// ============================================================
// Page
// ============================================================
export default function MenusPreview() {
  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-[1400px] mx-auto">
        <header className="text-center mb-10">
          <div className="text-[11px] uppercase tracking-[0.2em] text-brand font-bold mb-2">
            Preview · Storefront mobile
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            5 maneras de ver el menú en el teléfono
          </h1>
          <p className="text-mute mt-2 text-sm max-w-2xl mx-auto">
            Cada negocio elige su estilo desde Mi sitio · Estilo del menú.
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-12 justify-items-center">
          <Phone
            num={1}
            title="Lista clásica"
            best="Restaurantes de delivery, comida rápida"
            pros={[
              'Familiar (Rappi, UberEats)',
              'Conversión alta',
              'Scan rápido',
            ]}
          >
            <Option1 />
          </Phone>

          <Phone
            num={2}
            title="Grid Instagram"
            best="Heladerías, panaderías, postres (donde la foto vende)"
            pros={[
              'Muy visual',
              'Aprovecha buenas fotos',
              'Estética boutique',
            ]}
          >
            <Option2 />
          </Phone>

          <Phone
            num={3}
            title="Hero + carruseles"
            best="Marcas premium con muchas categorías"
            pros={[
              'Premium, editorial',
              'Estilo Netflix',
              'Permite secciones tipo "Recomendados"',
            ]}
          >
            <Option3 />
          </Phone>

          <Phone
            num={4}
            title="Lista limpia (sin fotos)"
            best="Restaurantes finos, bares de autor, omakase"
            pros={[
              'Elegante, premium',
              'Carga ultra rápido',
              'No depende de fotos',
            ]}
          >
            <Option4 />
          </Phone>

          <Phone
            num={5}
            title="Compacta + modal"
            best="Menús con variantes/extras (estilo DoorDash actual)"
            pros={[
              'Lo mejor de los 2 mundos',
              'Maneja variantes/extras',
              'Mobile-native (sheet animado)',
            ]}
          >
            <Option5 />
          </Phone>
        </div>

        <div className="text-center mt-12 text-sm text-mute">
          <div className="inline-flex items-center gap-2 bg-white border border-line rounded-full px-4 py-2 shadow-sm">
            💡 Mi sugerencia:{' '}
            <strong className="text-ink">opción 5</strong>
            {' '}— ya tienes variantes y extras en el modelo
          </div>
        </div>
      </div>
    </main>
  );
}
