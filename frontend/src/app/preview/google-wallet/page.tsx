/* eslint-disable @next/next/no-img-element */
// Mockups de 5 estilos visuales para el rediseño del Google Wallet pass.
// Cada variante simula la pantalla que ve el cliente en Google Wallet
// dentro de un marco de iPhone/Android genérico. Inspiración: el screenshot
// del usuario (fondo oscuro, título grande, stats en columnas, barcode
// con margen, estado en pill).
//
// Cuando el usuario elige una, el render real se aplica en
// backend/src/wallet/wallet.service.ts (generatePassHeroImage + generateStampsStrip).

'use client';

export default function GoogleWalletPreviewPage() {
  return (
    <main className="min-h-screen bg-bg2/40 py-10 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="mb-10 text-center">
          <div className="inline-flex items-center gap-2 bg-white border border-line text-xs font-semibold px-3 py-1.5 rounded-full mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-brand" />
            Preview rediseño — escogé un estilo
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            5 mockups Google Wallet
          </h1>
          <p className="text-mute mt-3 max-w-2xl mx-auto leading-relaxed">
            Mantenemos el marco de Google Wallet (header con logo y "Sellos
            1/10" arriba); rediseñamos la imagen hero y el strip de sellos
            con look premium dark. Apple Wallet NO se toca.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {VARIANTS.map((v, i) => (
            <div
              key={v.title}
              className="bg-white rounded-2xl border border-line overflow-hidden shadow-sm flex flex-col"
            >
              <div className="px-5 pt-5 pb-3 border-b border-line/60">
                <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
                  Opción {i + 1}
                </div>
                <h2 className="text-lg font-bold mt-1">{v.title}</h2>
                <p className="text-xs text-mute mt-1 leading-relaxed">
                  {v.desc}
                </p>
              </div>
              <div className="flex-1 p-6 bg-[#0a0a0a] flex items-center justify-center">
                <v.Render />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 text-center text-sm text-mute">
          Dime el número de la opción que más te guste y migro el generador
          real (sin tocar Apple Wallet).
        </div>
      </div>
    </main>
  );
}

const VARIANTS = [
  {
    title: 'Dark Premium · Stripe-like',
    desc:
      'Fondo negro puro + acento verde. Título grande, stats en 2 columnas, barcode con padding. Estilo Stripe/Linear.',
    Render: V1DarkPremium,
  },
  {
    title: 'Glassmorphism con hero foto',
    desc:
      'Foto del producto arriba (NudoCowork café) con overlay oscuro + tarjeta glass abajo con sellos. Look Instagram/Apple.',
    Render: V2Glassmorphism,
  },
  {
    title: 'Gradiente brand + grid sellos prominente',
    desc:
      'Mantiene el color de la marca pero con gradiente suave + grid 5×2 de sellos como protagonista. Más colorido.',
    Render: V3GradientBrand,
  },
  {
    title: 'Minimalista monocromo',
    desc:
      'Solo negro y blanco. Tipografía grande, mucho espacio en blanco. Estilo Apple/Notion.',
    Render: V4Minimalist,
  },
  {
    title: 'Card stack con sellos circular',
    desc:
      'Progreso de sellos como anillo circular grande (estilo Apple Watch rings). Stats arriba, anillo abajo.',
    Render: V5RingProgress,
  },
];

// ============================================================
// SIMULA el marco de Google Wallet (header oscuro con back + star + menu)
// ============================================================
function GoogleWalletFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-[320px] bg-[#1a1a1a] rounded-[28px] overflow-hidden shadow-2xl border border-white/5">
      {/* Top bar simulada */}
      <div className="px-4 py-3 flex items-center justify-between text-white">
        <button className="text-xl opacity-80">←</button>
        <div className="flex items-center gap-3 text-white/80">
          <span>☆</span>
          <span>⋮</span>
        </div>
      </div>
      {children}
    </div>
  );
}

// ============================================================
// Opción 1 — Dark Premium · Stripe-like
// ============================================================
function V1DarkPremium() {
  return (
    <GoogleWalletFrame>
      <div className="bg-[#0a0a0a] mx-3 mb-3 rounded-2xl overflow-hidden">
        {/* Hero image area */}
        <div
          className="p-5 pb-4"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 70% 0%, rgba(34,197,94,0.18), transparent 70%), #0a0a0a',
          }}
        >
          {/* Header logo + nombre */}
          <div className="flex items-center gap-2.5 mb-5">
            <div
              className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white shadow-sm border border-white/15"
              style={{
                background:
                  'linear-gradient(135deg, #15803d 0%, #22C55E 100%)',
              }}
            >
              <span className="text-[15px]">☕</span>
            </div>
            <div className="text-white font-semibold text-[14px]">
              NudoCowork
            </div>
          </div>

          {/* Title */}
          <div className="text-white font-bold text-[24px] leading-[1.1] tracking-tight mb-5">
            Recoge sellos para
            <br />
            obtener recompensas
          </div>

          {/* Stats 2 columnas */}
          <div className="grid grid-cols-2 gap-4 mb-5">
            <div>
              <div className="text-white/55 text-[10px] font-semibold leading-tight">
                Sella hasta obtener
                <br />
                tu recompensa
              </div>
              <div className="text-white font-bold text-[18px] mt-1.5">
                9 sellos
              </div>
            </div>
            <div className="text-right">
              <div className="text-white/55 text-[10px] font-semibold leading-tight">
                Recompensas
                <br />
                disponibles
              </div>
              <div className="text-white font-bold text-[18px] mt-1.5">
                0 premios
              </div>
            </div>
          </div>

          {/* Barcode */}
          <div className="bg-white rounded-xl p-2.5">
            <div className="flex gap-[1px] h-[42px] items-end">
              {[3, 5, 2, 7, 3, 6, 4, 2, 8, 3, 5, 6, 2, 7, 3, 4, 6, 2, 5, 3, 7, 4, 6, 2].map(
                (h, i) => (
                  <div
                    key={i}
                    className="bg-black flex-1"
                    style={{ height: `${30 + h * 8}%` }}
                  />
                ),
              )}
            </div>
            <div className="text-center text-[8px] font-mono text-black mt-1 tracking-wider">
              CLB-1JVCD1CW5M
            </div>
          </div>

          {/* Estado pill */}
          <div className="text-center mt-3">
            <span className="inline-flex items-center gap-1.5 bg-white/10 text-white/80 text-[10px] font-semibold px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-white/50" />
              La tarjeta está inactiva
            </span>
          </div>
        </div>

        {/* Strip de sellos */}
        <div
          className="px-4 py-4"
          style={{
            background:
              'linear-gradient(180deg, #181818 0%, #0f0f0f 100%)',
          }}
        >
          <div className="grid grid-cols-5 gap-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="aspect-square rounded-full flex items-center justify-center text-[14px] border"
                style={
                  i < 1
                    ? {
                        background:
                          'linear-gradient(135deg, #15803d 0%, #22C55E 100%)',
                        borderColor: '#22C55E',
                        color: '#fff',
                      }
                    : {
                        background: 'rgba(255,255,255,0.04)',
                        borderColor: 'rgba(255,255,255,0.12)',
                        color: 'rgba(255,255,255,0.25)',
                      }
                }
              >
                ☕
              </div>
            ))}
          </div>
        </div>
      </div>
    </GoogleWalletFrame>
  );
}

// ============================================================
// Opción 2 — Glassmorphism con hero foto
// ============================================================
function V2Glassmorphism() {
  return (
    <GoogleWalletFrame>
      <div className="mx-3 mb-3 rounded-2xl overflow-hidden">
        {/* Hero con foto de café */}
        <div className="relative h-[180px] overflow-hidden">
          <img
            src="https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=600&h=360&fit=crop"
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.85) 100%)',
            }}
          />
          {/* Logo + nombre */}
          <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[13px] shadow-md border border-white/30"
                style={{
                  background:
                    'linear-gradient(135deg, #15803d 0%, #22C55E 100%)',
                }}
              >
                ☕
              </div>
              <div className="text-white font-semibold text-[12px]">
                NudoCowork
              </div>
            </div>
            <span className="bg-brand text-white text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full shadow-md">
              Activa
            </span>
          </div>
          {/* Title bottom */}
          <div className="absolute bottom-3 left-4 right-4 text-white">
            <div className="text-[10px] uppercase tracking-wider opacity-70 font-semibold">
              Tarjeta de café
            </div>
            <div className="font-bold text-[20px] leading-tight mt-0.5">
              Te faltan 9 sellos
              <br />
              para tu premio
            </div>
          </div>
        </div>

        {/* Glass card con sellos */}
        <div className="bg-[#0a0a0a] p-4">
          <div className="grid grid-cols-5 gap-1.5 mb-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="aspect-square rounded-full flex items-center justify-center text-[14px]"
                style={
                  i < 1
                    ? {
                        background: '#fff',
                        color: '#15803d',
                      }
                    : {
                        background: 'rgba(255,255,255,0.06)',
                        color: 'rgba(255,255,255,0.3)',
                        border: '1px dashed rgba(255,255,255,0.15)',
                      }
                }
              >
                ☕
              </div>
            ))}
          </div>
          {/* Barcode */}
          <div className="bg-white rounded-lg p-2">
            <div className="flex gap-[1px] h-[36px] items-end">
              {[3, 5, 2, 7, 3, 6, 4, 2, 8, 3, 5, 6, 2, 7, 3, 4, 6, 2, 5, 3, 7, 4].map(
                (h, i) => (
                  <div
                    key={i}
                    className="bg-black flex-1"
                    style={{ height: `${30 + h * 8}%` }}
                  />
                ),
              )}
            </div>
          </div>
        </div>
      </div>
    </GoogleWalletFrame>
  );
}

// ============================================================
// Opción 3 — Gradiente brand + sellos prominente
// ============================================================
function V3GradientBrand() {
  return (
    <GoogleWalletFrame>
      <div
        className="mx-3 mb-3 rounded-2xl overflow-hidden"
        style={{
          background:
            'linear-gradient(135deg, #15803d 0%, #22C55E 60%, #16a34a 100%)',
        }}
      >
        <div className="p-5">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-white/95 flex items-center justify-center text-[14px]">
                ☕
              </div>
              <div className="text-white font-semibold text-[13px]">
                NudoCowork
              </div>
            </div>
            <div className="bg-black/30 backdrop-blur text-white text-[10px] font-bold rounded-full px-2.5 py-1">
              1/10
            </div>
          </div>

          {/* Mensaje */}
          <div className="text-white font-bold text-[19px] leading-tight mb-1">
            Tarjeta de café
          </div>
          <div className="text-white/75 text-[11px] mb-4">
            Cada compra suma un sello. Al llegar a 10, café gratis.
          </div>

          {/* Grid sellos PROTAGONISTA */}
          <div className="bg-white/10 backdrop-blur rounded-2xl p-4 mb-4 border border-white/20">
            <div className="grid grid-cols-5 gap-2.5">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-square rounded-full flex items-center justify-center text-[16px] border-2"
                  style={
                    i < 1
                      ? {
                          background: '#fff',
                          borderColor: '#fff',
                          color: '#15803d',
                          boxShadow: '0 4px 12px rgba(255,255,255,0.4)',
                        }
                      : {
                          background: 'transparent',
                          borderColor: 'rgba(255,255,255,0.35)',
                          color: 'rgba(255,255,255,0.45)',
                        }
                  }
                >
                  ☕
                </div>
              ))}
            </div>
          </div>

          {/* Barcode */}
          <div className="bg-white rounded-xl p-2">
            <div className="flex gap-[1px] h-[40px] items-end">
              {[3, 5, 2, 7, 3, 6, 4, 2, 8, 3, 5, 6, 2, 7, 3, 4, 6, 2, 5, 3, 7, 4, 6, 2].map(
                (h, i) => (
                  <div
                    key={i}
                    className="bg-black flex-1"
                    style={{ height: `${30 + h * 8}%` }}
                  />
                ),
              )}
            </div>
          </div>
        </div>
      </div>
    </GoogleWalletFrame>
  );
}

// ============================================================
// Opción 4 — Minimalista monocromo
// ============================================================
function V4Minimalist() {
  return (
    <GoogleWalletFrame>
      <div className="bg-white mx-3 mb-3 rounded-2xl overflow-hidden">
        <div className="p-6">
          {/* Header simple */}
          <div className="flex items-center gap-2 mb-8">
            <div className="w-6 h-6 rounded-full bg-black flex items-center justify-center text-white text-[10px]">
              N
            </div>
            <div className="text-black/60 font-semibold text-[11px] uppercase tracking-widest">
              NudoCowork
            </div>
          </div>

          {/* Número GIGANTE */}
          <div className="text-black font-bold text-[88px] leading-none tracking-tighter mb-1">
            1
            <span className="text-black/25 text-[44px] align-top ml-1">
              /10
            </span>
          </div>
          <div className="text-black/60 text-[12px] mb-8">
            sellos acumulados
          </div>

          {/* Dots minimalistas */}
          <div className="flex gap-1.5 mb-8 flex-wrap">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="w-2.5 h-2.5 rounded-full"
                style={{
                  background: i < 1 ? '#000' : '#e5e5e5',
                }}
              />
            ))}
          </div>

          {/* Barcode minimal */}
          <div className="border-t border-black/10 pt-4">
            <div className="flex gap-[1px] h-[40px] items-end">
              {[3, 5, 2, 7, 3, 6, 4, 2, 8, 3, 5, 6, 2, 7, 3, 4, 6, 2, 5, 3, 7, 4, 6, 2].map(
                (h, i) => (
                  <div
                    key={i}
                    className="bg-black flex-1"
                    style={{ height: `${30 + h * 8}%` }}
                  />
                ),
              )}
            </div>
            <div className="text-center text-[9px] font-mono text-black/50 mt-2 tracking-widest">
              CLB-1JVCD1CW5M
            </div>
          </div>
        </div>
      </div>
    </GoogleWalletFrame>
  );
}

// ============================================================
// Opción 5 — Ring progress (estilo Apple Watch)
// ============================================================
function V5RingProgress() {
  const progress = 10; // % 1/10
  return (
    <GoogleWalletFrame>
      <div className="bg-[#0a0a0a] mx-3 mb-3 rounded-2xl overflow-hidden">
        <div className="p-5">
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[13px]"
                style={{
                  background:
                    'linear-gradient(135deg, #15803d 0%, #22C55E 100%)',
                }}
              >
                ☕
              </div>
              <div>
                <div className="text-white font-semibold text-[13px] leading-tight">
                  NudoCowork
                </div>
                <div className="text-white/50 text-[9px] leading-tight">
                  Tarjeta de café
                </div>
              </div>
            </div>
            <span className="bg-brand/20 text-brand text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border border-brand/40">
              Activa
            </span>
          </div>

          {/* Ring de progreso */}
          <div className="flex items-center justify-center my-5">
            <div className="relative w-[180px] h-[180px]">
              <svg
                viewBox="0 0 180 180"
                className="absolute inset-0 -rotate-90"
              >
                <circle
                  cx="90"
                  cy="90"
                  r="80"
                  fill="none"
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth="12"
                />
                <circle
                  cx="90"
                  cy="90"
                  r="80"
                  fill="none"
                  stroke="url(#ringGrad)"
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 80}
                  strokeDashoffset={2 * Math.PI * 80 * (1 - progress / 100)}
                />
                <defs>
                  <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#22C55E" />
                    <stop offset="1" stopColor="#15803d" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-white font-bold text-[44px] leading-none">
                  1
                </div>
                <div className="text-white/50 text-[10px] uppercase tracking-widest mt-1">
                  de 10 sellos
                </div>
                <div className="text-brand text-[10px] font-semibold mt-2">
                  9 para premio
                </div>
              </div>
            </div>
          </div>

          {/* Barcode */}
          <div className="bg-white rounded-xl p-2">
            <div className="flex gap-[1px] h-[40px] items-end">
              {[3, 5, 2, 7, 3, 6, 4, 2, 8, 3, 5, 6, 2, 7, 3, 4, 6, 2, 5, 3, 7, 4, 6, 2].map(
                (h, i) => (
                  <div
                    key={i}
                    className="bg-black flex-1"
                    style={{ height: `${30 + h * 8}%` }}
                  />
                ),
              )}
            </div>
          </div>
        </div>
      </div>
    </GoogleWalletFrame>
  );
}
