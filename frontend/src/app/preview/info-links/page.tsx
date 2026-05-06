/* eslint-disable @next/next/no-img-element */
// 5 estilos de InfoLink mobile inspirados en Beacons.ai. Mobile-first,
// modernos, con avatares grandes, bios, posts/products feed estilo Stories.
// El cliente elige el estilo al crear su InfoLink.

const MOCK = {
  brandName: 'Café del Día',
  handle: '@cafedeldia',
  bio: '☕ Café de especialidad · Bogotá · Eventos en mayo',
  avatar:
    'https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=400&h=400&fit=crop',
  hero:
    'https://images.unsplash.com/photo-1511920170033-f8396924c348?w=900&h=600&fit=crop',
  primary: '#C97B5F',
  links: [
    { label: '🎟 Reservar evento mayo', kind: 'feature' as const, sub: 'Cata de café · Sáb 18' },
    { label: '🥐 Pedir desayuno', kind: 'normal' as const, sub: '15% off antes de las 10am' },
    { label: '📍 Cómo llegar', kind: 'normal' as const, sub: 'Cra 13 #82-45, Chapinero' },
    { label: '💬 WhatsApp', kind: 'normal' as const, sub: 'Resp. en menos de 5 min' },
    { label: '📷 Instagram', kind: 'normal' as const, sub: '12.4K seguidores' },
  ],
  products: [
    {
      name: 'Plan mensual de café',
      price: 89000,
      img: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=400&h=400&fit=crop',
    },
    {
      name: 'Taller de barismo',
      price: 120000,
      img: 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=400&h=400&fit=crop',
    },
    {
      name: 'Café de origen 250g',
      price: 38000,
      img: 'https://images.unsplash.com/photo-1517256064527-09c73fc73e38?w=400&h=400&fit=crop',
    },
    {
      name: 'Brunch para 2',
      price: 65000,
      img: 'https://images.unsplash.com/photo-1567306226416-28f0efdc88ce?w=400&h=400&fit=crop',
    },
  ],
  posts: [
    {
      title: 'Catas de café · Mayo',
      excerpt: 'Tres sábados, tres orígenes. Reserva con mes de anticipación.',
      img: 'https://images.unsplash.com/photo-1561882468-9110e03e0f78?w=400&h=400&fit=crop',
    },
    {
      title: 'Nuevo menú de pastelería',
      excerpt: 'Todo horneado en casa, recetas francesas reinterpretadas.',
      img: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=400&h=400&fit=crop',
    },
  ],
};

const fmt = (n: number) =>
  '$' + n.toLocaleString('es-CO', { maximumFractionDigits: 0 });

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
      <div className="relative w-[320px] h-[640px] bg-black rounded-[44px] p-2 shadow-2xl">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-7 bg-black rounded-b-3xl z-10" />
        <div className="w-full h-full rounded-[36px] overflow-hidden relative">
          <div className="absolute top-0 left-0 right-0 h-7 px-6 flex items-center justify-between text-[11px] font-semibold z-20 text-black bg-white/80 backdrop-blur">
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

// =============================================================
//                     1. AURORA · Gradient mesh
// =============================================================
function AuroraMock() {
  return (
    <div
      className="min-h-full px-4 pt-6 pb-8 text-white relative overflow-hidden"
      style={{
        background:
          'radial-gradient(circle at 15% 0%, #FFB7C5 0%, transparent 40%), radial-gradient(circle at 85% 25%, #C97B5F 0%, transparent 40%), radial-gradient(circle at 50% 100%, #6B4226 0%, transparent 50%), linear-gradient(180deg, #2D1B4E 0%, #1A0E2E 100%)',
      }}
    >
      <div className="flex flex-col items-center text-center">
        <div
          className="w-24 h-24 rounded-full bg-cover bg-center ring-4 ring-white/30 shadow-2xl"
          style={{ backgroundImage: `url(${MOCK.avatar})` }}
        />
        <h1 className="text-xl font-bold mt-3">{MOCK.brandName}</h1>
        <div className="text-[11px] text-white/70">{MOCK.handle}</div>
        <p className="text-xs text-white/85 mt-2 max-w-[260px] leading-relaxed">
          {MOCK.bio}
        </p>
      </div>
      <div className="mt-5 space-y-2.5">
        {MOCK.links.map((l, i) => (
          <button
            key={i}
            className={`w-full px-4 py-3 rounded-2xl text-left backdrop-blur-md transition ${
              l.kind === 'feature'
                ? 'bg-white text-[#1A0E2E] shadow-xl'
                : 'bg-white/10 text-white border border-white/20'
            }`}
          >
            <div className="font-semibold text-sm">{l.label}</div>
            <div
              className={`text-[10px] mt-0.5 ${
                l.kind === 'feature' ? 'text-black/60' : 'text-white/60'
              }`}
            >
              {l.sub}
            </div>
          </button>
        ))}
      </div>
      <div className="mt-6 text-center text-[10px] text-white/50">
        Powered by Clubify
      </div>
    </div>
  );
}

// =============================================================
//                     2. MINIMAL · Bio profile
// =============================================================
function MinimalMock() {
  return (
    <div className="min-h-full bg-white px-5 pt-6 pb-8">
      <div className="flex flex-col items-center text-center">
        <div
          className="w-20 h-20 rounded-full bg-cover bg-center"
          style={{ backgroundImage: `url(${MOCK.avatar})` }}
        />
        <h1 className="text-base font-semibold mt-2.5 text-ink">
          {MOCK.brandName}
        </h1>
        <div className="text-[11px] text-mute">{MOCK.handle}</div>
        <p className="text-xs text-mute mt-2 leading-relaxed max-w-[240px]">
          {MOCK.bio}
        </p>
        <div className="flex gap-2 mt-3">
          {['📷', '💬', '📍', '✉️'].map((e) => (
            <button
              key={e}
              className="w-9 h-9 rounded-full bg-bg2 flex items-center justify-center text-sm hover:bg-line transition"
            >
              {e}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-6 space-y-2">
        {MOCK.links.map((l, i) => (
          <button
            key={i}
            className={`w-full px-4 py-3 rounded-xl border text-sm text-left transition ${
              l.kind === 'feature'
                ? 'border-transparent text-white font-semibold'
                : 'border-line text-ink hover:bg-bg2/40'
            }`}
            style={
              l.kind === 'feature'
                ? { background: MOCK.primary }
                : undefined
            }
          >
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// =============================================================
//                     3. SHOP · Productos
// =============================================================
function ShopMock() {
  return (
    <div className="min-h-full bg-[#FAFAFA] pb-8">
      <div
        className="h-32 bg-cover bg-center relative"
        style={{ backgroundImage: `url(${MOCK.hero})` }}
      >
        <div className="absolute inset-0 bg-black/20" />
      </div>
      <div className="-mt-10 px-4">
        <div
          className="w-20 h-20 rounded-2xl ring-4 ring-white shadow-md bg-cover bg-center mx-auto"
          style={{ backgroundImage: `url(${MOCK.avatar})` }}
        />
        <div className="text-center mt-2">
          <h1 className="text-base font-bold text-ink">{MOCK.brandName}</h1>
          <p className="text-[11px] text-mute mt-0.5 px-2">{MOCK.bio}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-4">
          {MOCK.products.map((p, i) => (
            <button
              key={i}
              className="text-left bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-md transition"
            >
              <div
                className="aspect-square bg-cover bg-center"
                style={{ backgroundImage: `url(${p.img})` }}
              />
              <div className="p-2">
                <div className="text-[11px] font-semibold leading-tight line-clamp-2">
                  {p.name}
                </div>
                <div
                  className="text-[11px] font-bold mt-1"
                  style={{ color: MOCK.primary }}
                >
                  {fmt(p.price)}
                </div>
              </div>
            </button>
          ))}
        </div>
        <button
          className="w-full mt-4 py-3 rounded-full text-white text-sm font-semibold shadow-md"
          style={{ background: MOCK.primary }}
        >
          💬 Pedir por WhatsApp
        </button>
      </div>
    </div>
  );
}

// =============================================================
//                     4. STORIES · Posts feed
// =============================================================
function StoriesMock() {
  return (
    <div className="min-h-full bg-white">
      <div className="px-4 pt-5 pb-3 border-b border-line2">
        <div className="flex items-center gap-3">
          <div
            className="w-14 h-14 rounded-full bg-cover bg-center flex-none ring-2 ring-pink-400"
            style={{ backgroundImage: `url(${MOCK.avatar})` }}
          />
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm">{MOCK.brandName}</div>
            <div className="text-[11px] text-mute">{MOCK.handle}</div>
          </div>
          <button
            className="text-[11px] font-semibold px-3 py-1.5 rounded-full text-white"
            style={{ background: MOCK.primary }}
          >
            Seguir
          </button>
        </div>
        <p className="text-xs mt-2 leading-relaxed">{MOCK.bio}</p>
      </div>

      {/* Stories row */}
      <div className="px-3 py-3 flex gap-3 overflow-x-auto scrollbar-none border-b border-line2">
        {['Eventos', 'Menú', 'Combos', 'Reseñas', 'Tienda'].map((s, i) => (
          <div
            key={s}
            className="flex flex-col items-center gap-1 flex-none"
          >
            <div
              className="w-12 h-12 rounded-full p-0.5"
              style={{
                background:
                  'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)',
              }}
            >
              <div
                className="w-full h-full rounded-full bg-cover bg-center bg-white p-0.5"
                style={{
                  backgroundImage: `url(${MOCK.products[i % MOCK.products.length].img})`,
                }}
              />
            </div>
            <div className="text-[9px] text-ink">{s}</div>
          </div>
        ))}
      </div>

      {/* Posts feed */}
      <div className="divide-y divide-line2">
        {MOCK.posts.map((p, i) => (
          <div key={i} className="p-3 flex gap-3">
            <div
              className="w-20 h-20 rounded-lg bg-cover bg-center flex-none"
              style={{ backgroundImage: `url(${p.img})` }}
            />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm leading-tight">
                {p.title}
              </div>
              <div className="text-[11px] text-mute mt-1 leading-relaxed line-clamp-2">
                {p.excerpt}
              </div>
              <button
                className="mt-1.5 text-[11px] font-semibold"
                style={{ color: MOCK.primary }}
              >
                Ver más →
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================
//                     5. NEON · Dark accent
// =============================================================
function NeonMock() {
  return (
    <div
      className="min-h-full px-4 pt-6 pb-8 text-white"
      style={{
        background:
          'radial-gradient(ellipse at top, #1a1a2e 0%, #0f0f1e 100%)',
      }}
    >
      <div className="flex flex-col items-center text-center">
        <div
          className="w-24 h-24 rounded-full bg-cover bg-center"
          style={{
            backgroundImage: `url(${MOCK.avatar})`,
            boxShadow: '0 0 40px #00FFA3, 0 0 80px #00FFA340',
          }}
        />
        <h1
          className="text-2xl font-black mt-3 tracking-tight"
          style={{
            color: '#00FFA3',
            textShadow: '0 0 20px #00FFA380',
          }}
        >
          {MOCK.brandName.toUpperCase()}
        </h1>
        <div className="text-[10px] uppercase tracking-[0.3em] text-white/50">
          {MOCK.handle}
        </div>
        <p className="text-xs text-white/70 mt-3 max-w-[240px] leading-relaxed">
          {MOCK.bio}
        </p>
      </div>
      <div className="mt-5 space-y-2">
        {MOCK.links.map((l, i) => (
          <button
            key={i}
            className={`w-full px-4 py-3 text-left transition ${
              l.kind === 'feature'
                ? 'bg-[#00FFA3] text-black font-bold'
                : 'border border-[#00FFA340] text-white hover:border-[#00FFA3] hover:bg-[#00FFA310]'
            }`}
            style={{
              clipPath:
                'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
            }}
          >
            <div className="text-sm">{l.label}</div>
            <div
              className={`text-[10px] mt-0.5 ${
                l.kind === 'feature' ? 'text-black/60' : 'text-white/40'
              }`}
            >
              {l.sub}
            </div>
          </button>
        ))}
      </div>
      <div className="mt-6 text-center text-[10px] text-[#00FFA350] uppercase tracking-[0.3em]">
        ━━ clubify ━━
      </div>
    </div>
  );
}

// =============================================================
//                          PAGE
// =============================================================
export default function InfoLinksPreview() {
  return (
    <div className="min-h-screen bg-bg p-6 sm:p-10">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-center">
          Estilos de InfoLink
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-10 mt-10 justify-items-center">
          <Phone
            num={1}
            title="Aurora"
            best="Marca creativa, eventos, lanzamientos."
            pros={[
              'Fondo gradient mesh + glassmorphism',
              'Avatar grande tipo bio',
              'Botones con título + subtítulo',
            ]}
          >
            <AuroraMock />
          </Phone>
          <Phone
            num={2}
            title="Minimal"
            best="Profesionales y boutiques sobrias."
            pros={[
              'Blanco limpio, foco en la info',
              'Avatar circular + iconos sociales',
              '1 botón principal en color brand',
            ]}
          >
            <MinimalMock />
          </Phone>
          <Phone
            num={3}
            title="Shop"
            best="Vender productos / servicios desde el bio."
            pros={[
              'Hero + grid 2×2 de productos con precio',
              'Card con avatar destacado',
              'CTA grande para WhatsApp',
            ]}
          >
            <ShopMock />
          </Phone>
          <Phone
            num={4}
            title="Stories"
            best="Marcas IG-first con feed de contenido."
            pros={[
              'Header tipo perfil IG + Seguir',
              'Stories scrollables',
              'Feed de posts/eventos con foto',
            ]}
          >
            <StoriesMock />
          </Phone>
          <Phone
            num={5}
            title="Neon"
            best="Bares, eventos nocturnos, marcas streetwear."
            pros={[
              'Fondo oscuro + glow neón',
              'Tipografía bold mayúscula',
              'Botones con corte angular tech',
            ]}
          >
            <NeonMock />
          </Phone>
        </div>

      </div>
    </div>
  );
}
