/* eslint-disable @next/next/no-img-element */
// 5 mockups de "GeoPush" para evaluar cuál usar en el FidelizacionBanner.
// Cada opción es un visual independiente — mismo estilo SaaS premium.
//
// Pinta los 5 en grid 2 cols (md+) sobre fondo neutro, con título +
// breve descripción de cada uno. El usuario elige uno y migramos a
// FidelizacionBanner.tsx.

'use client';

export default function GeopushPreviewPage() {
  return (
    <main className="min-h-screen bg-bg2/30 py-10 px-4">
      <style>{`
        @keyframes geo-pulse {
          0%   { transform: scale(0.4); opacity: 0.7; }
          100% { transform: scale(2.3); opacity: 0; }
        }
        @keyframes geo-dot {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.18); }
        }
        @keyframes push-cycle {
          0%   { opacity: 0; transform: translateY(-30px) scale(0.92); }
          8%   { opacity: 1; transform: translateY(0) scale(1); }
          70%  { opacity: 1; transform: translateY(0) scale(1); }
          85%  { opacity: 0; transform: translateY(-12px) scale(0.96); }
          100% { opacity: 0; transform: translateY(-30px) scale(0.92); }
        }
        @keyframes pill-glow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.5); }
          50%      { box-shadow: 0 0 0 14px rgba(34,197,94,0); }
        }
        @keyframes float-soft {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-6px); }
        }
        @keyframes approach {
          0%   { transform: translate(0, 0); opacity: 0; }
          15%  { opacity: 1; }
          100% { transform: translate(var(--dx), var(--dy)); opacity: 0.2; }
        }
        @keyframes shimmer {
          0%, 100% { opacity: 0.6; }
          50%      { opacity: 1; }
        }
      `}</style>

      <div className="max-w-7xl mx-auto">
        <div className="mb-10 text-center">
          <div className="inline-flex items-center gap-2 bg-white border border-line text-xs font-semibold px-3 py-1.5 rounded-full mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-brand" />
            Preview — elige un estilo
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            5 variantes de GeoPush
          </h1>
          <p className="text-mute mt-3 max-w-2xl mx-auto leading-relaxed">
            Cada opción reemplazaría los elementos GeoPush actuales en el
            bloque <code className="bg-bg2 px-1 rounded">Fidelización</code> de
            la landing. Dime el número y la dejo live.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {VARIANTS.map((v, i) => (
            <div
              key={v.title}
              className="bg-white rounded-2xl border border-line overflow-hidden shadow-sm"
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
              <div
                className="relative bg-bg2/40 h-[380px] flex items-center justify-center overflow-hidden"
                style={{
                  backgroundImage:
                    'radial-gradient(circle at 50% 50%, rgba(34,197,94,0.05) 0%, transparent 60%)',
                }}
              >
                <v.Render />
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

const VARIANTS = [
  {
    title: 'Push + Radar geofence (actual)',
    desc:
      'Notificación iOS arriba a la izquierda + mini mapa con anillos pulsantes a la derecha. Comunica el push y la geo en 2 elementos separados.',
    Render: V1PushPlusRadar,
  },
  {
    title: 'iPhone lockscreen completo',
    desc:
      'Pantalla bloqueada de iPhone (hora + fecha + notificación grande). Estilo realista, muestra cómo lo ve el cliente en su celular.',
    Render: V2Lockscreen,
  },
  {
    title: 'Dynamic Island (live activity)',
    desc:
      'Píldora flotante estilo Dynamic Island de iPhone 15. Compacta, moderna, muy on-trend.',
    Render: V3DynamicIsland,
  },
  {
    title: 'Mapa hero con clientes acercándose',
    desc:
      'Mapa grande protagonista — pin del negocio en el centro, varios clientes (puntos verdes) moviéndose hacia él. Sensación de tráfico real.',
    Render: V4MapHero,
  },
  {
    title: 'Push expandido con acciones',
    desc:
      'Notificación expandida estilo iOS Rich Notification con foto + botones de acción ("Voy" / "Más tarde"). Máxima interactividad visual.',
    Render: V5ExpandedPush,
  },
];

// ============================================================
// Opción 1 — Push + Radar (lo actual)
// ============================================================
function V1PushPlusRadar() {
  return (
    <div className="relative w-full h-full">
      {/* Push notification */}
      <div
        className="absolute top-8 left-6 w-[240px] bg-white/95 backdrop-blur-md rounded-2xl shadow-[0_20px_50px_-12px_rgba(0,0,0,0.4)] border border-black/5 p-3"
        style={{
          animation: 'push-cycle 8s ease-in-out infinite',
          transformOrigin: 'top center',
        }}
      >
        <div className="flex items-start gap-2.5">
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

      {/* Mini mapa geofence */}
      <div
        className="absolute bottom-8 right-6 w-[170px] bg-white rounded-2xl shadow-[0_20px_50px_-12px_rgba(0,0,0,0.4)] border border-black/5 overflow-hidden"
        style={{ animation: 'float-soft 5s ease-in-out 0.5s infinite' }}
      >
        <div className="px-3 py-2 flex items-center gap-1.5 border-b border-black/5">
          <span className="text-[11px]">📡</span>
          <span className="text-[10px] font-semibold text-black/80 uppercase tracking-wider">
            GeoPush activo
          </span>
        </div>
        <div
          className="relative h-[110px]"
          style={{
            background:
              'linear-gradient(135deg, #e8f5ec 0%, #d1eedb 100%)',
          }}
        >
          <div className="absolute inset-0">
            <div className="absolute left-0 right-0 top-[35%] h-[2px] bg-white/70" />
            <div className="absolute left-0 right-0 top-[70%] h-[1px] bg-white/50" />
            <div className="absolute top-0 bottom-0 left-[40%] w-[2px] bg-white/70" />
            <div className="absolute top-0 bottom-0 left-[75%] w-[1px] bg-white/50" />
          </div>
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="absolute inset-0 rounded-full"
                style={{
                  background:
                    'radial-gradient(circle, rgba(34,197,94,0.45) 0%, rgba(34,197,94,0) 70%)',
                  animation: `geo-pulse 2.6s ease-out ${i * 0.85}s infinite`,
                }}
              />
            ))}
            <div
              className="relative w-6 h-6 rounded-full bg-brand shadow-[0_3px_8px_rgba(34,197,94,0.6)] flex items-center justify-center text-white text-[11px] font-bold border-2 border-white"
              style={{ animation: 'geo-dot 2s ease-in-out infinite' }}
            >
              📍
            </div>
          </div>
          <div className="absolute left-1/2 bottom-1.5 -translate-x-1/2 bg-ink text-white text-[9px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap">
            Nudo Cowork
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Opción 2 — iPhone lockscreen completo
// ============================================================
function V2Lockscreen() {
  return (
    <div className="relative">
      <div
        className="relative bg-[#0a0a0a] rounded-[44px] p-[8px] shadow-[0_30px_70px_-15px_rgba(0,0,0,0.5),0_0_0_1.5px_#1f1f1f,0_0_0_3px_#000]"
        style={{ width: 240, height: 480 }}
      >
        <div className="absolute top-[8px] left-1/2 -translate-x-1/2 w-[90px] h-[24px] bg-black rounded-b-[16px] z-20" />
        <div
          className="w-full h-full rounded-[36px] overflow-hidden relative"
          style={{
            backgroundImage:
              'linear-gradient(180deg, #1a3a2e 0%, #2d6e54 50%, #15803d 100%)',
          }}
        >
          {/* Hora + fecha */}
          <div className="absolute top-12 inset-x-0 text-center text-white pointer-events-none">
            <div className="text-[11px] font-medium opacity-80">
              martes, 17 de mayo
            </div>
            <div className="text-[56px] font-light leading-none tracking-tight mt-1">
              9:42
            </div>
          </div>

          {/* Push notification */}
          <div
            className="absolute top-44 inset-x-3 bg-white/15 backdrop-blur-2xl rounded-[18px] p-3 border border-white/15 shadow-2xl"
            style={{
              animation: 'push-cycle 8s ease-in-out infinite',
              transformOrigin: 'top center',
            }}
          >
            <div className="flex items-start gap-2.5">
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
                  <div className="text-[11px] font-semibold text-white uppercase tracking-wider truncate">
                    Nudo Cowork
                  </div>
                  <div className="text-[9px] text-white/60 font-medium flex-none">
                    ahora
                  </div>
                </div>
                <div className="text-[12px] font-semibold text-white leading-tight mt-0.5">
                  📍 Estás cerca, ¡pasá por tu café!
                </div>
                <div className="text-[10px] text-white/75 leading-tight mt-0.5">
                  Te faltan 3 sellos para tu gratis.
                </div>
              </div>
            </div>
          </div>

          {/* Lockscreen bottom hint */}
          <div className="absolute bottom-3 inset-x-0 text-center text-white/50 text-[10px]">
            Deslizá para abrir
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Opción 3 — Dynamic Island
// ============================================================
function V3DynamicIsland() {
  return (
    <div className="relative w-full max-w-md">
      {/* Marco superior del iPhone (top bar) */}
      <div className="bg-[#0a0a0a] rounded-[36px] px-3 pt-3 pb-12 mx-auto w-[330px] shadow-[0_30px_70px_-15px_rgba(0,0,0,0.5),0_0_0_1.5px_#1f1f1f,0_0_0_3px_#000]">
        {/* Dynamic Island expanded */}
        <div
          className="bg-black text-white rounded-[28px] mx-auto px-4 py-3 flex items-center gap-3 shadow-2xl border border-white/10"
          style={{
            width: 280,
            animation: 'float-soft 4s ease-in-out infinite',
          }}
        >
          <div
            className="w-10 h-10 rounded-full flex-none flex items-center justify-center text-white shadow-md relative"
            style={{
              background:
                'linear-gradient(135deg, #15803d 0%, #22C55E 100%)',
            }}
          >
            <span className="text-[18px]">☕</span>
            {/* Pulse glow */}
            <span
              className="absolute inset-0 rounded-full"
              style={{ animation: 'pill-glow 2.4s ease-in-out infinite' }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-white/70 leading-none">
              Nudo Cowork
            </div>
            <div className="text-[13px] font-semibold leading-tight mt-0.5">
              📍 A 50 m, te esperamos
            </div>
          </div>
          <div className="flex-none text-right">
            <div className="text-[18px] font-bold leading-none text-brand">
              7
            </div>
            <div className="text-[8px] text-white/60 uppercase tracking-wider leading-none mt-0.5">
              sellos
            </div>
          </div>
        </div>

        {/* Status bar simulado */}
        <div className="mt-3 px-3 flex items-center justify-between text-white/60 text-[10px] font-semibold">
          <span>9:42</span>
          <span>📶 🔋</span>
        </div>
      </div>

      <div className="text-center text-[10px] text-mute mt-3">
        Dynamic Island · iPhone 15+
      </div>
    </div>
  );
}

// ============================================================
// Opción 4 — Mapa hero con clientes acercándose
// ============================================================
function V4MapHero() {
  // 5 clientes alrededor, moviéndose hacia el centro con delays distintos
  const customers = [
    { dx: -120, dy: -80, delay: 0 },
    { dx: 110, dy: -90, delay: 0.6 },
    { dx: -90, dy: 70, delay: 1.2 },
    { dx: 130, dy: 60, delay: 1.8 },
    { dx: 0, dy: -110, delay: 2.4 },
  ];
  return (
    <div className="relative w-[320px] h-[320px]">
      {/* Card del mapa */}
      <div className="absolute inset-0 bg-white rounded-2xl overflow-hidden shadow-[0_30px_70px_-15px_rgba(0,0,0,0.3)] border border-line">
        {/* Header */}
        <div className="absolute top-0 inset-x-0 z-10 bg-white/95 backdrop-blur px-4 py-2 flex items-center justify-between border-b border-line/60">
          <div className="flex items-center gap-2">
            <span className="text-[14px]">📡</span>
            <div>
              <div className="text-[11px] font-bold leading-tight">
                GeoPush activo
              </div>
              <div className="text-[9px] text-mute leading-none">
                5 clientes en 300 m
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-brand">
            <span
              className="w-1.5 h-1.5 rounded-full bg-brand"
              style={{ animation: 'shimmer 1.5s ease-in-out infinite' }}
            />
            EN VIVO
          </div>
        </div>

        {/* Mapa fake */}
        <div
          className="absolute inset-0 pt-12"
          style={{
            background:
              'linear-gradient(135deg, #e8f5ec 0%, #c4e9d2 100%)',
          }}
        >
          {/* Calles */}
          <div className="absolute inset-0">
            <div className="absolute left-0 right-0 top-[35%] h-[3px] bg-white/80" />
            <div className="absolute left-0 right-0 top-[60%] h-[2px] bg-white/60" />
            <div className="absolute left-0 right-0 top-[80%] h-[1px] bg-white/50" />
            <div className="absolute top-0 bottom-0 left-[30%] w-[3px] bg-white/80" />
            <div className="absolute top-0 bottom-0 left-[68%] w-[2px] bg-white/60" />
            <div
              className="absolute top-[20%] left-[10%] w-[40%] h-[40%] border-2 border-white/40 rounded-[6px]"
              style={{ background: 'rgba(255,255,255,0.2)' }}
            />
          </div>

          {/* Pin negocio centro */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center z-20">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="absolute inset-0 rounded-full"
                style={{
                  background:
                    'radial-gradient(circle, rgba(34,197,94,0.5) 0%, rgba(34,197,94,0) 70%)',
                  animation: `geo-pulse 2.8s ease-out ${i * 0.9}s infinite`,
                }}
              />
            ))}
            <div
              className="relative w-10 h-10 rounded-full bg-brand shadow-[0_4px_12px_rgba(34,197,94,0.7)] flex items-center justify-center text-white text-[16px] font-bold border-[3px] border-white"
              style={{ animation: 'geo-dot 2s ease-in-out infinite' }}
            >
              ☕
            </div>
          </div>

          {/* Etiqueta negocio */}
          <div className="absolute left-1/2 top-[calc(50%+34px)] -translate-x-1/2 bg-ink text-white text-[10px] font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap z-20 shadow-md">
            Nudo Cowork
          </div>

          {/* Clientes acercándose */}
          {customers.map((c, i) => (
            <div
              key={i}
              className="absolute left-1/2 top-1/2 w-3 h-3 rounded-full bg-brand-700 border-2 border-white shadow-md z-10"
              style={
                {
                  '--dx': `${-c.dx}px`,
                  '--dy': `${-c.dy}px`,
                  transform: `translate(${c.dx}px, ${c.dy}px)`,
                  animation: `approach 4s ease-in ${c.delay}s infinite`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Opción 5 — Push expandido con acciones
// ============================================================
function V5ExpandedPush() {
  return (
    <div
      className="w-[280px] bg-white rounded-[20px] shadow-[0_30px_70px_-15px_rgba(0,0,0,0.4)] border border-black/5 overflow-hidden"
      style={{ animation: 'float-soft 4s ease-in-out infinite' }}
    >
      {/* Header */}
      <div className="px-4 py-2.5 flex items-center gap-2.5 border-b border-line/40">
        <div
          className="w-8 h-8 rounded-[7px] flex-none flex items-center justify-center text-white shadow-sm"
          style={{
            background: 'linear-gradient(135deg, #15803d 0%, #22C55E 100%)',
          }}
        >
          <span className="text-[14px]">☕</span>
        </div>
        <div className="flex-1">
          <div className="text-[11px] font-bold text-black/90 uppercase tracking-wider">
            Nudo Cowork
          </div>
          <div className="text-[9px] text-black/50">ahora · 📍 a 80 m</div>
        </div>
      </div>

      {/* Body */}
      <div className="p-4">
        <div className="text-[14px] font-bold text-black leading-snug">
          ☕ ¡Hoy es 2x1 en cafés!
        </div>
        <div className="text-[12px] text-black/70 leading-snug mt-1">
          Estás a una cuadra. Pasá ahora y completa tu tarjeta —
          te faltan 3 sellos.
        </div>

        {/* Imagen hero */}
        <div className="mt-3 rounded-[10px] overflow-hidden h-[100px]">
          <img
            src="https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400&h=200&fit=crop"
            alt=""
            className="w-full h-full object-cover"
          />
        </div>

        {/* Progress bar de sellos */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] mb-1">
            <span className="text-black/70 font-semibold">Tu tarjeta</span>
            <span className="text-brand-700 font-bold">7 / 10</span>
          </div>
          <div className="h-1.5 rounded-full bg-bg2 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: '70%',
                background:
                  'linear-gradient(90deg, #15803d 0%, #22C55E 100%)',
                animation: 'shimmer 2s ease-in-out infinite',
              }}
            />
          </div>
        </div>
      </div>

      {/* Botones acción */}
      <div className="border-t border-line/60 grid grid-cols-2 divide-x divide-line/60">
        <button className="py-3 text-[12px] font-semibold text-mute hover:bg-bg2/40">
          Más tarde
        </button>
        <button className="py-3 text-[12px] font-semibold text-brand-700 hover:bg-brand-soft">
          Voy →
        </button>
      </div>
    </div>
  );
}
