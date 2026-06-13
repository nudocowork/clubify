'use client';
import { useState } from 'react';

const STATE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  libre: { bg: '#ffffff', border: '#cbd5e1', text: '#475569' },
  reservada: { bg: '#fef3c7', border: '#f59e0b', text: '#b45309' },
  sentada: { bg: '#22C55E', border: '#15803d', text: '#ffffff' },
  bloqueada: {
    bg: 'repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6 6px,#e9ebee 6px,#e9ebee 12px)',
    border: '#cbd5e1',
    text: '#94a3b8',
  },
};

export default function PreviewPlanoV2() {
  const [active, setActive] = useState<1 | 2 | 3 | 4 | 5>(1);
  return (
    <main className="min-h-screen bg-bg2">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-extrabold m-0">Preview · Mapa fotorealista V2</h1>
          <p className="text-sm text-mute mt-1 max-w-2xl leading-relaxed">
            5 variantes refinadas a partir de la opción ③ del primer preview. Cada una resuelve un
            estilo distinto: premium pulido, 3D isométrico, foto real del salón, blueprint
            arquitectónico y editorial cálido.
          </p>
        </div>

        <div className="flex gap-2 flex-wrap mb-6">
          {[
            { n: 1 as const, label: '① Premium pulido' },
            { n: 2 as const, label: '② Isométrico 3D' },
            { n: 3 as const, label: '③ Foto real overlay' },
            { n: 4 as const, label: '④ Blueprint arquitectónico' },
            { n: 5 as const, label: '⑤ Editorial cálido' },
          ].map((b) => (
            <button
              key={b.n}
              onClick={() => setActive(b.n)}
              className={`text-sm font-semibold px-4 py-2 rounded-pill ${
                active === b.n ? 'bg-ink text-white' : 'bg-white border border-line text-mute'
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>

        {active === 1 && <PremiumPulido />}
        {active === 2 && <Isometrico />}
        {active === 3 && <FotoOverlay />}
        {active === 4 && <Blueprint />}
        {active === 5 && <EditorialCalido />}
      </div>
    </main>
  );
}

// ============================================================
// ① PREMIUM PULIDO
// Refinamiento: sombras suaves, paredes con grosor real, texturas
// sutiles, ventanas marcadas, puerta de entrada con flecha, plantas
// en terraza, paleta más sofisticada.
// ============================================================
function PremiumPulido() {
  return (
    <Wrapper title="① Premium pulido" desc="El mismo concepto del original pero refinado al detalle: paredes con grosor visible, sombras suaves bajo cada mesa, textura sutil del piso, ventanas marcadas en terraza, puerta principal con flecha. Estilo 'render arquitectónico' de gama alta.">
      <div className="card card-pad">
        <div
          className="relative rounded-2xl overflow-hidden mx-auto"
          style={{
            background: '#fafaf9',
            backgroundImage:
              'linear-gradient(45deg, #f1f5f4 25%, transparent 25%), linear-gradient(-45deg, #f1f5f4 25%, transparent 25%)',
            backgroundSize: '20px 20px',
            height: 580,
            maxWidth: 820,
            boxShadow: 'inset 0 0 80px rgba(0,0,0,0.04)',
          }}
        >
          {/* Salón principal */}
          <Wall x={40} y={40} w={400} h={250} label="SALÓN PRINCIPAL" />
          <CircleT cx={100} cy={100} r={22} state="sentada" label="1" seats={2} elevation />
          <CircleT cx={210} cy={100} r={22} state="libre" label="2" seats={2} elevation />
          <CircleT cx={320} cy={100} r={22} state="libre" label="6" seats={2} elevation />
          <CircleT cx={100} cy={210} r={26} state="reservada" label="3" seats={4} elevation />
          <CircleT cx={210} cy={210} r={26} state="libre" label="4" seats={4} elevation />
          <CircleT cx={350} cy={210} r={30} state="libre" label="5" seats={6} elevation />

          {/* Terraza con ventanas */}
          <Wall x={470} y={40} w={240} h={250} dashed label="TERRAZA · AIRE LIBRE" />
          {/* Ventanas en pared exterior */}
          {[80, 130, 180].map((x) => (
            <div key={x} className="absolute" style={{ left: x + 460, top: 38, width: 30, height: 4, background: '#94a3b8' }} />
          ))}
          {/* Plantas */}
          <div className="absolute" style={{ left: 478, top: 50, fontSize: 14 }}>🌿</div>
          <div className="absolute" style={{ left: 685, top: 50, fontSize: 14 }}>🌿</div>
          <div className="absolute" style={{ left: 478, top: 260, fontSize: 14 }}>🌿</div>
          <CircleT cx={520} cy={100} r={24} state="reservada" label="12" seats={4} elevation />
          <CircleT cx={620} cy={100} r={24} state="sentada" label="13" seats={4} elevation />
          <CircleT cx={520} cy={210} r={20} state="libre" label="14" seats={2} elevation />
          <RectT x={595} y={195} w={70} h={45} state="libre" label="15" seats={6} elevation />

          {/* Barra */}
          <Wall x={40} y={310} w={670} h={55} label="BARRA · 6 PUESTOS" subtle />
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full"
              style={{
                width: 18,
                height: 18,
                background: '#fff',
                border: '2px solid #94a3b8',
                top: 332,
                left: 80 + i * 105,
                boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
              }}
            />
          ))}

          {/* Privado / VIP */}
          <Wall x={40} y={385} w={670} h={155} label="PRIVADO · ZONA VIP" emphasis />
          <RectT x={80} y={420} w={140} h={70} state="bloqueada" label="21" seats={8} elevation />
          <RectT x={260} y={420} w={140} h={70} state="libre" label="22" seats={8} elevation />
          <CircleT cx={550} cy={465} r={26} state="reservada" label="VIP" seats={4} elevation crown />

          {/* Puerta de entrada */}
          <div className="absolute" style={{ bottom: 4, left: '50%', transform: 'translateX(-50%)' }}>
            <div className="flex items-center gap-1 bg-white px-3 py-1.5 rounded-full shadow-lg border border-line">
              <span className="text-xs font-bold tracking-wider text-ink">↑ ENTRADA</span>
            </div>
          </div>
        </div>
        <Legend />
      </div>
    </Wrapper>
  );
}

// ============================================================
// ② ISOMÉTRICO 3D
// Vista 3/4 con perspectiva. Las mesas tienen depth y sombra.
// Zonas con suelo coloreado en perspectiva.
// ============================================================
function Isometrico() {
  return (
    <Wrapper title="② Isométrico 3D" desc="Vista en perspectiva isométrica 30°. Las zonas son áreas con suelo coloreado en perspectiva. Las mesas tienen volumen y proyectan sombra. Vibe SimCity / Two Point Hospital.">
      <div className="card card-pad">
        <div className="relative rounded-2xl overflow-hidden mx-auto" style={{ background: '#0f172a', height: 580, maxWidth: 820 }}>
          <div style={{ transform: 'rotateX(55deg) rotateZ(-15deg)', transformStyle: 'preserve-3d', position: 'absolute', inset: 60 }}>
            {/* Salón floor */}
            <div className="absolute" style={{ left: 0, top: 0, width: 320, height: 200, background: 'linear-gradient(135deg, rgba(34,197,94,0.20), rgba(34,197,94,0.10))', border: '2px solid rgba(34,197,94,0.6)', borderRadius: 4 }}>
              <IsoTable x={40} y={40} state="sentada" label="1" seats={2} />
              <IsoTable x={140} y={40} state="libre" label="2" seats={2} />
              <IsoTable x={240} y={40} state="libre" label="6" seats={2} />
              <IsoTable x={40} y={140} state="reservada" label="3" seats={4} size="md" />
              <IsoTable x={140} y={140} state="libre" label="4" seats={4} size="md" />
              <IsoTable x={240} y={140} state="libre" label="5" seats={6} size="lg" />
            </div>
            {/* Terraza floor */}
            <div className="absolute" style={{ left: 360, top: 0, width: 200, height: 200, background: 'linear-gradient(135deg, rgba(59,130,246,0.20), rgba(59,130,246,0.10))', border: '2px solid rgba(59,130,246,0.6)', borderRadius: 4 }}>
              <IsoTable x={30} y={40} state="reservada" label="12" seats={4} size="md" />
              <IsoTable x={120} y={40} state="sentada" label="13" seats={4} size="md" />
              <IsoTable x={30} y={140} state="libre" label="14" seats={2} />
              <IsoTable x={120} y={140} state="libre" label="15" seats={6} size="lg" shape="rect" />
            </div>
            {/* VIP floor */}
            <div className="absolute" style={{ left: 0, top: 240, width: 560, height: 110, background: 'linear-gradient(135deg, rgba(139,92,246,0.20), rgba(139,92,246,0.10))', border: '2px solid rgba(139,92,246,0.6)', borderRadius: 4 }}>
              <IsoTable x={30} y={30} state="bloqueada" label="21" seats={8} size="xl" shape="rect" />
              <IsoTable x={210} y={30} state="libre" label="22" seats={8} size="xl" shape="rect" />
              <IsoTable x={420} y={30} state="reservada" label="VIP" seats={4} size="md" />
            </div>
          </div>
          {/* Labels flotantes (no rotados) */}
          <div className="absolute top-3 left-3 text-white/80 text-[10px] font-bold tracking-widest">VISTA ISOMÉTRICA · 30°</div>
          <div className="absolute bottom-3 right-3 text-white/60 text-[10px]">↻ Rotar · 🔍 Zoom</div>
        </div>
        <Legend dark />
      </div>
    </Wrapper>
  );
}

function IsoTable({
  x, y, state, label, seats, size = 'sm', shape = 'round',
}: {
  x: number; y: number; state: string; label: string; seats: number;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  shape?: 'round' | 'rect';
}) {
  const sizes = { sm: 40, md: 50, lg: 60, xl: 100 };
  const w = sizes[size];
  const h = size === 'xl' ? 50 : w;
  const s = STATE_COLORS[state];
  return (
    <div
      className="absolute flex flex-col items-center justify-center font-bold"
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        borderRadius: shape === 'round' ? '50%' : 6,
        background: s.bg,
        border: `2px solid ${s.border}`,
        color: s.text,
        boxShadow: '0 6px 0 rgba(0,0,0,0.25), 0 8px 16px rgba(0,0,0,0.3)',
        transform: 'translateZ(8px)',
      }}
    >
      <span className="text-[10px] leading-none">{label}</span>
      <span className="text-[8px] leading-none mt-0.5 opacity-80">{seats}p</span>
    </div>
  );
}

// ============================================================
// ③ FOTO REAL OVERLAY
// El negocio sube una foto top-down o render del salón. Las mesas
// se posicionan encima como círculos semi-transparentes.
// ============================================================
function FotoOverlay() {
  return (
    <Wrapper title="③ Foto real overlay" desc="El negocio sube una foto cenital o render del local. Las mesas aparecen como círculos sobre la imagen real. Al cliente se le muestra una visión auténtica del lugar; el staff ve la realidad del salón.">
      <div className="card card-pad">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-semibold">📷 Foto del salón: nudocowork-polanco-top.jpg</div>
          <button className="text-xs font-semibold px-3 py-1.5 rounded-md border border-line">
            Cambiar foto
          </button>
        </div>
        <div
          className="relative rounded-2xl overflow-hidden mx-auto"
          style={{
            height: 580,
            maxWidth: 820,
            background:
              'linear-gradient(180deg, #92400e 0%, #b45309 30%, #d97706 60%, #fbbf24 100%)',
          }}
        >
          {/* Simula textura de piso de madera */}
          <div
            className="absolute inset-0 opacity-50"
            style={{
              backgroundImage:
                'repeating-linear-gradient(0deg, transparent, transparent 30px, rgba(0,0,0,0.1) 30px, rgba(0,0,0,0.1) 31px), repeating-linear-gradient(90deg, transparent, transparent 80px, rgba(0,0,0,0.05) 80px, rgba(0,0,0,0.05) 81px)',
            }}
          />
          {/* Dim foto */}
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.15)' }} />

          {/* Mesas como overlays semi-transparentes con halo */}
          <Overlay cx={120} cy={100} state="sentada" label="1" seats={2} />
          <Overlay cx={250} cy={100} state="libre" label="2" seats={2} />
          <Overlay cx={120} cy={230} state="reservada" label="3" seats={4} customerName="Carlos I." />
          <Overlay cx={250} cy={230} state="libre" label="4" seats={4} />
          <Overlay cx={420} cy={150} state="reservada" label="12" seats={4} customerName="Laura M." />
          <Overlay cx={550} cy={150} state="sentada" label="13" seats={4} />
          <Overlay cx={420} cy={320} state="libre" label="14" seats={2} />
          <Overlay cx={680} cy={300} state="reservada" label="VIP" seats={4} customerName="Grupo Torres" />
          <Overlay cx={200} cy={430} state="libre" label="22" seats={8} big />
          <Overlay cx={450} cy={430} state="bloqueada" label="21" seats={8} big />

          <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold backdrop-blur" style={{ background: 'rgba(255,255,255,0.85)' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            EN VIVO · Sede Polanco
          </div>
        </div>
        <p className="text-[11px] text-mute mt-3 text-center">
          Mock con piso de madera generado. En real: el dueño sube foto top-down del local con upload.
        </p>
      </div>
    </Wrapper>
  );
}

function Overlay({
  cx, cy, state, label, seats, big, customerName,
}: {
  cx: number; cy: number; state: string; label: string; seats: number; big?: boolean; customerName?: string;
}) {
  const stateRing: Record<string, string> = {
    libre: 'rgba(255,255,255,0.85)',
    reservada: 'rgba(251,191,36,0.95)',
    sentada: 'rgba(34,197,94,0.95)',
    bloqueada: 'rgba(156,163,175,0.85)',
  };
  const size = big ? 80 : 56;
  return (
    <div className="absolute" style={{ left: cx - size / 2, top: cy - size / 2 }}>
      <div
        className="absolute inset-0 rounded-full animate-pulse"
        style={{
          background: stateRing[state],
          opacity: 0.3,
          filter: 'blur(8px)',
          transform: 'scale(1.4)',
        }}
      />
      <div
        className="relative flex flex-col items-center justify-center font-bold backdrop-blur"
        style={{
          width: size,
          height: size,
          borderRadius: big ? 12 : '50%',
          background: state === 'sentada' ? 'rgba(34,197,94,0.95)' : state === 'reservada' ? 'rgba(251,191,36,0.92)' : state === 'bloqueada' ? 'rgba(156,163,175,0.7)' : 'rgba(255,255,255,0.85)',
          border: `2px solid ${stateRing[state]}`,
          color: state === 'sentada' || state === 'reservada' ? 'white' : '#0f172a',
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        }}
      >
        <span className="text-sm leading-none">{label}</span>
        <span className="text-[9px] leading-none opacity-90 mt-0.5">{seats}p</span>
      </div>
      {customerName && (
        <div
          className="absolute left-1/2 -translate-x-1/2 mt-1 whitespace-nowrap px-2 py-0.5 rounded text-[10px] font-bold"
          style={{ top: '100%', background: 'rgba(0,0,0,0.7)', color: 'white' }}
        >
          {customerName}
        </div>
      )}
    </div>
  );
}

// ============================================================
// ④ BLUEPRINT ARQUITECTÓNICO
// Estilo plano técnico: líneas finas blanco sobre azul oscuro,
// cotas, escala, retícula. Como un blueprint de architect.
// ============================================================
function Blueprint() {
  return (
    <Wrapper title="④ Blueprint arquitectónico" desc="Estilo plano técnico clásico: trazos finos blancos sobre fondo azul Prussian, retícula de cotas, escala visible. Mesas como símbolos arquitectónicos. Vibe profesional / arquitecto / interior designer.">
      <div className="card card-pad">
        <div
          className="relative rounded-xl overflow-hidden mx-auto"
          style={{
            background: '#0c2e4a',
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
            height: 580,
            maxWidth: 820,
            fontFamily: 'monospace',
          }}
        >
          {/* Top scale ruler */}
          <div className="absolute top-2 left-12 right-12 flex justify-between text-white/40 text-[9px] font-mono">
            {Array.from({ length: 16 }).map((_, i) => (
              <span key={i}>{i * 0.5}m</span>
            ))}
          </div>
          {/* Left scale */}
          <div className="absolute left-2 top-12 bottom-12 flex flex-col justify-between text-white/40 text-[9px] font-mono items-end">
            {Array.from({ length: 11 }).map((_, i) => (
              <span key={i}>{i * 0.5}m</span>
            ))}
          </div>

          {/* Salón */}
          <BPWall x={50} y={50} w={380} h={220} label="SALÓN — A1" />
          <BPCircle cx={120} cy={110} r={20} state="sentada" label="01" seats={2} />
          <BPCircle cx={220} cy={110} r={20} state="libre" label="02" seats={2} />
          <BPCircle cx={320} cy={110} r={20} state="libre" label="06" seats={2} />
          <BPCircle cx={120} cy={210} r={26} state="reservada" label="03" seats={4} />
          <BPCircle cx={220} cy={210} r={26} state="libre" label="04" seats={4} />
          <BPCircle cx={340} cy={210} r={30} state="libre" label="05" seats={6} />

          {/* Terraza */}
          <BPWall x={460} y={50} w={210} h={220} label="TERRAZA — A2" dashed />
          <BPCircle cx={520} cy={110} r={24} state="reservada" label="12" seats={4} />
          <BPCircle cx={610} cy={110} r={24} state="sentada" label="13" seats={4} />
          <BPCircle cx={520} cy={210} r={18} state="libre" label="14" seats={2} />
          <BPRect x={585} y={195} w={60} h={35} state="libre" label="15" seats={6} />

          {/* Barra */}
          <BPWall x={50} y={290} w={620} h={55} label="BARRA · 6 PUESTOS" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="absolute rounded-full" style={{ width: 14, height: 14, border: '1.5px solid white', top: 312, left: 90 + i * 100 }} />
          ))}

          {/* Privado */}
          <BPWall x={50} y={365} w={620} h={160} label="PRIVADO — B1" />
          <BPRect x={90} y={400} w={140} h={70} state="bloqueada" label="21" seats={8} />
          <BPRect x={260} y={400} w={140} h={70} state="libre" label="22" seats={8} />
          <BPCircle cx={520} cy={445} r={26} state="reservada" label="VIP" seats={4} />

          {/* Cotas y notas */}
          <div className="absolute bottom-3 right-3 flex flex-col items-end gap-1 text-white/70 text-[10px] font-mono">
            <div>ESCALA 1:50</div>
            <div>15 mesas · 64 puestos</div>
            <div>Total: 28 m² salón</div>
          </div>
        </div>
        <Legend dark mono />
      </div>
    </Wrapper>
  );
}

function BPWall({ x, y, w, h, label, dashed }: { x: number; y: number; w: number; h: number; label: string; dashed?: boolean }) {
  return (
    <div
      className="absolute"
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        border: dashed ? '1px dashed white' : '2px solid white',
      }}
    >
      <div className="absolute -top-3 left-3 px-2 text-[10px] font-mono font-bold tracking-wider text-white" style={{ background: '#0c2e4a' }}>
        {label}
      </div>
    </div>
  );
}
function BPCircle({ cx, cy, r, state, label, seats }: { cx: number; cy: number; r: number; state: string; label: string; seats: number }) {
  const colorMap: Record<string, string> = {
    libre: '#ffffff',
    reservada: '#fbbf24',
    sentada: '#22C55E',
    bloqueada: '#9ca3af',
  };
  return (
    <div
      className="absolute flex flex-col items-center justify-center font-mono"
      style={{
        left: cx - r,
        top: cy - r,
        width: r * 2,
        height: r * 2,
        borderRadius: '50%',
        border: `1.5px solid ${colorMap[state]}`,
        background: state === 'sentada' ? 'rgba(34,197,94,0.25)' : state === 'reservada' ? 'rgba(251,191,36,0.20)' : state === 'bloqueada' ? 'rgba(156,163,175,0.20)' : 'transparent',
        color: colorMap[state],
      }}
    >
      <span className="text-[9px] leading-none font-bold">{label}</span>
      <span className="text-[7px] leading-none opacity-80">{seats}p</span>
    </div>
  );
}
function BPRect({ x, y, w, h, state, label, seats }: { x: number; y: number; w: number; h: number; state: string; label: string; seats: number }) {
  const colorMap: Record<string, string> = {
    libre: '#ffffff',
    reservada: '#fbbf24',
    sentada: '#22C55E',
    bloqueada: '#9ca3af',
  };
  return (
    <div
      className="absolute flex flex-col items-center justify-center font-mono"
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        border: `1.5px solid ${colorMap[state]}`,
        background: state === 'bloqueada' ? 'rgba(156,163,175,0.20)' : 'transparent',
        color: colorMap[state],
      }}
    >
      <span className="text-[10px] leading-none font-bold">{label}</span>
      <span className="text-[7px] leading-none opacity-80 mt-0.5">{seats}p</span>
    </div>
  );
}

// ============================================================
// ⑤ EDITORIAL CÁLIDO
// Vibe magazine de restaurante: paleta tierra, tipografía elegante,
// espaciado generoso, ilustraciones de plantas y elementos del local.
// ============================================================
function EditorialCalido() {
  return (
    <Wrapper title="⑤ Editorial cálido" desc="Estilo magazine gastronómico: paleta tierra (crema, oliva, terracota), tipografía editorial, ilustraciones de plantas/elementos del local. Vibe acogedor — ideal para restaurantes premium con identidad fuerte.">
      <div className="card card-pad" style={{ background: '#faf6ef' }}>
        <div className="text-center mb-4">
          <div className="text-[10px] font-bold tracking-[0.3em] uppercase" style={{ color: '#a16207' }}>SALA · NudoCowork · Polanco</div>
          <div className="text-2xl font-serif italic mt-1" style={{ color: '#422006' }}>El plano de hoy</div>
        </div>

        <div
          className="relative mx-auto rounded-3xl"
          style={{
            background: '#fefdf8',
            backgroundImage:
              'radial-gradient(circle at 10% 20%, rgba(164,98,30,0.04), transparent 30%), radial-gradient(circle at 90% 80%, rgba(101,76,52,0.05), transparent 35%)',
            height: 540,
            maxWidth: 820,
            border: '1px solid #e7e1d6',
          }}
        >
          {/* Salón */}
          <Section x={40} y={40} w={400} h={220} label="Salón Principal" color="#84cc16" decor="🌿" />
          <WarmTable cx={110} cy={110} r={22} state="sentada" label="1" seats={2} />
          <WarmTable cx={220} cy={110} r={22} state="libre" label="2" seats={2} />
          <WarmTable cx={330} cy={110} r={22} state="libre" label="6" seats={2} />
          <WarmTable cx={110} cy={210} r={28} state="reservada" label="3" seats={4} customer="Carlos Ibáñez" />
          <WarmTable cx={220} cy={210} r={28} state="libre" label="4" seats={4} />
          <WarmTable cx={355} cy={210} r={32} state="libre" label="5" seats={6} />

          {/* Terraza */}
          <Section x={470} y={40} w={210} h={220} label="Terraza" color="#0ea5e9" decor="🪴" />
          <WarmTable cx={530} cy={110} r={24} state="reservada" label="12" seats={4} customer="Laura M." />
          <WarmTable cx={620} cy={110} r={24} state="sentada" label="13" seats={4} />
          <WarmTable cx={530} cy={210} r={20} state="libre" label="14" seats={2} />
          <WarmRect x={600} y={195} w={65} h={40} state="libre" label="15" seats={6} />

          {/* Barra */}
          <Section x={40} y={280} w={640} h={55} label="Barra · 6 puestos" color="#c2410c" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="absolute" style={{ width: 18, height: 18, borderRadius: 9, background: '#fef3c7', border: '1.5px solid #c2410c', top: 302, left: 100 + i * 100 }} />
          ))}

          {/* VIP */}
          <Section x={40} y={355} w={640} h={160} label="Privado · VIP" color="#7c3aed" decor="✨" />
          <WarmRect x={90} y={395} w={140} h={70} state="bloqueada" label="21" seats={8} />
          <WarmRect x={260} y={395} w={140} h={70} state="libre" label="22" seats={8} />
          <WarmTable cx={520} cy={440} r={28} state="reservada" label="VIP" seats={4} customer="Grupo Torres" />
        </div>

        <div className="mt-4 grid grid-cols-4 gap-2 text-center" style={{ color: '#5c4a1a' }}>
          {[
            { label: 'Libre', value: 5, c: '#a3a3a3' },
            { label: 'Reservada', value: 3, c: '#ca8a04' },
            { label: 'Sentada', value: 4, c: '#65a30d' },
            { label: 'Bloqueada', value: 1, c: '#737373' },
          ].map((kv) => (
            <div key={kv.label} className="rounded-xl py-2" style={{ background: '#fefdf8', border: '1px solid #e7e1d6' }}>
              <div className="text-[10px] font-bold tracking-wider uppercase" style={{ color: kv.c }}>{kv.label}</div>
              <div className="text-xl font-serif" style={{ color: kv.c }}>{kv.value}</div>
            </div>
          ))}
        </div>
      </div>
    </Wrapper>
  );
}

function Section({ x, y, w, h, label, color, decor }: { x: number; y: number; w: number; h: number; label: string; color: string; decor?: string }) {
  return (
    <div
      className="absolute rounded-2xl"
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        background: 'rgba(255,255,255,0.5)',
        border: `1px dashed ${color}55`,
      }}
    >
      <div className="absolute -top-3 left-4 inline-flex items-center gap-1 px-3 py-0.5 rounded-full text-xs font-serif italic" style={{ background: '#fefdf8', border: `1px solid ${color}55`, color }}>
        {decor && <span>{decor}</span>}
        <span>{label}</span>
      </div>
    </div>
  );
}

function WarmTable({ cx, cy, r, state, label, seats, customer }: { cx: number; cy: number; r: number; state: string; label: string; seats: number; customer?: string }) {
  const stateConfig: Record<string, { bg: string; border: string; text: string }> = {
    libre: { bg: '#fefdf8', border: '#d6cdb8', text: '#78716c' },
    reservada: { bg: '#fef3c7', border: '#ca8a04', text: '#854d0e' },
    sentada: { bg: '#65a30d', border: '#3f6212', text: '#fefdf8' },
    bloqueada: { bg: 'repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6 4px,#e5e7eb 4px,#e5e7eb 8px)', border: '#9ca3af', text: '#6b7280' },
  };
  const s = stateConfig[state];
  return (
    <div
      className="absolute flex flex-col items-center justify-center font-serif"
      style={{
        left: cx - r,
        top: cy - r,
        width: r * 2,
        height: r * 2,
        borderRadius: '50%',
        background: s.bg,
        border: `2px solid ${s.border}`,
        color: s.text,
        boxShadow: '0 2px 4px rgba(0,0,0,0.06)',
      }}
    >
      <span className="text-sm leading-none italic">{label}</span>
      <span className="text-[9px] leading-none mt-0.5 opacity-80">{seats}p</span>
      {customer && (
        <div className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-sans italic mt-1" style={{ top: '100%', color: s.border }}>
          {customer}
        </div>
      )}
    </div>
  );
}

function WarmRect({ x, y, w, h, state, label, seats }: { x: number; y: number; w: number; h: number; state: string; label: string; seats: number }) {
  const stateConfig: Record<string, { bg: string; border: string; text: string }> = {
    libre: { bg: '#fefdf8', border: '#d6cdb8', text: '#78716c' },
    reservada: { bg: '#fef3c7', border: '#ca8a04', text: '#854d0e' },
    sentada: { bg: '#65a30d', border: '#3f6212', text: '#fefdf8' },
    bloqueada: { bg: 'repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6 4px,#e5e7eb 4px,#e5e7eb 8px)', border: '#9ca3af', text: '#6b7280' },
  };
  const s = stateConfig[state];
  return (
    <div
      className="absolute flex flex-col items-center justify-center font-serif"
      style={{ left: x, top: y, width: w, height: h, borderRadius: 8, background: s.bg, border: `2px solid ${s.border}`, color: s.text }}
    >
      <span className="text-sm leading-none italic">{label}</span>
      <span className="text-[9px] leading-none opacity-80 mt-0.5">{seats}p</span>
    </div>
  );
}

// ============================================================
// Helpers compartidos
// ============================================================

function Wrapper({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-bold m-0">{title}</h2>
        <p className="text-xs text-mute mt-1 leading-relaxed max-w-2xl">{desc}</p>
      </div>
      {children}
    </div>
  );
}

function Wall({
  x, y, w, h, label, dashed, subtle, emphasis,
}: {
  x: number; y: number; w: number; h: number; label: string;
  dashed?: boolean; subtle?: boolean; emphasis?: boolean;
}) {
  return (
    <div
      className="absolute"
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        background: subtle ? 'rgba(249,115,22,0.04)' : emphasis ? 'rgba(139,92,246,0.05)' : 'rgba(34,197,94,0.03)',
        border: dashed ? '2px dashed #0f172a' : '3px solid #0f172a',
        borderRadius: 4,
      }}
    >
      <div className="absolute -top-3 left-3 bg-white px-2 text-[10px] font-bold tracking-wider text-ink shadow-sm">
        {label}
      </div>
    </div>
  );
}

function CircleT({ cx, cy, r, state, label, seats, elevation, crown }: {
  cx: number; cy: number; r: number; state: string; label: string; seats: number;
  elevation?: boolean; crown?: boolean;
}) {
  const s = STATE_COLORS[state];
  return (
    <div
      className="absolute flex flex-col items-center justify-center font-bold"
      style={{
        left: cx - r,
        top: cy - r,
        width: r * 2,
        height: r * 2,
        borderRadius: '50%',
        background: s.bg,
        border: `2px solid ${s.border}`,
        color: s.text,
        boxShadow: elevation
          ? '0 2px 4px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.08)'
          : 'none',
      }}
    >
      {crown && <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs">👑</div>}
      <span className="text-[10px] leading-none">{label}</span>
      <span className="text-[8px] leading-none mt-0.5 opacity-80">{seats}p</span>
    </div>
  );
}

function RectT({ x, y, w, h, state, label, seats, elevation }: {
  x: number; y: number; w: number; h: number; state: string; label: string; seats: number;
  elevation?: boolean;
}) {
  const s = STATE_COLORS[state];
  return (
    <div
      className="absolute flex flex-col items-center justify-center font-bold"
      style={{
        left: x, top: y, width: w, height: h, background: s.bg,
        border: `2px solid ${s.border}`, borderRadius: 8, color: s.text,
        boxShadow: elevation ? '0 2px 4px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.08)' : 'none',
      }}
    >
      <span className="text-xs leading-none">{label}</span>
      <span className="text-[9px] leading-none opacity-80 mt-0.5">{seats}p</span>
    </div>
  );
}

function Legend({ dark, mono }: { dark?: boolean; mono?: boolean }) {
  const txt = dark ? 'text-white/70' : 'text-mute';
  return (
    <div className={`mt-4 pt-3 border-t ${dark ? 'border-white/20' : 'border-line2'} flex gap-4 text-[11px] ${txt} flex-wrap ${mono ? 'font-mono' : ''}`}>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded" style={{ background: dark ? 'transparent' : '#ffffff', border: '1.5px solid #cbd5e1' }} /> Libre
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded" style={{ background: dark ? 'rgba(251,191,36,0.20)' : '#fef3c7', border: '1.5px solid #f59e0b' }} /> Reservada
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded" style={{ background: dark ? 'rgba(34,197,94,0.25)' : '#22C55E', border: '1.5px solid #15803d' }} /> Sentada
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block w-3 h-3 rounded"
          style={{
            background: 'repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6 3px,#e9ebee 3px,#e9ebee 6px)',
            border: '1.5px solid #cbd5e1',
          }}
        />{' '}
        Bloqueada
      </span>
    </div>
  );
}
