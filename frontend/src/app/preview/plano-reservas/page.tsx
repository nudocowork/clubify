'use client';
import { useState } from 'react';

// Mock data compartido
const ZONES = [
  { id: 'sa', name: 'Salón Principal', type: 'INDOOR', color: '#22C55E' },
  { id: 'te', name: 'Terraza', type: 'OUTDOOR', color: '#3b82f6' },
  { id: 'ba', name: 'Barra', type: 'BAR', color: '#f97316' },
  { id: 'vi', name: 'Privado / VIP', type: 'PRIVATE', color: '#8b5cf6' },
];

const TABLES = [
  { id: 't1', number: '1', seats: 2, zone: 'sa', state: 'sentada', shape: 'round' },
  { id: 't2', number: '2', seats: 2, zone: 'sa', state: 'libre', shape: 'round' },
  { id: 't3', number: '3', seats: 4, zone: 'sa', state: 'reservada', shape: 'round', customer: 'Carlos Ibáñez', time: '14:00' },
  { id: 't4', number: '4', seats: 4, zone: 'sa', state: 'libre', shape: 'round' },
  { id: 't5', number: '5', seats: 6, zone: 'sa', state: 'libre', shape: 'round' },
  { id: 't12', number: '12', seats: 4, zone: 'te', state: 'reservada', shape: 'round', customer: 'Laura Méndez', time: '13:30' },
  { id: 't13', number: '13', seats: 4, zone: 'te', state: 'sentada', shape: 'round' },
  { id: 't14', number: '14', seats: 2, zone: 'te', state: 'libre', shape: 'round' },
  { id: 't15', number: '15', seats: 6, zone: 'te', state: 'libre', shape: 'rect' },
  { id: 'b', number: 'Barra', seats: 6, zone: 'ba', state: 'libre', shape: 'bar' },
  { id: 't21', number: '21', seats: 8, zone: 'vi', state: 'bloqueada', shape: 'rect' },
  { id: 't22', number: '22', seats: 8, zone: 'vi', state: 'libre', shape: 'rect' },
  { id: 'vip', number: 'VIP', seats: 4, zone: 'vi', state: 'reservada', shape: 'round', customer: 'Grupo Torres', time: '21:30' },
];

const STATE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  libre: { bg: '#ffffff', border: '#cbd5e1', text: '#475569' },
  reservada: { bg: '#fef3c7', border: '#f59e0b', text: '#b45309' },
  sentada: { bg: '#22C55E', border: '#15803d', text: '#ffffff' },
  bloqueada: { bg: 'repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6 6px,#e9ebee 6px,#e9ebee 12px)', border: '#cbd5e1', text: '#94a3b8' },
};

export default function PreviewPlanoReservas() {
  const [active, setActive] = useState<1 | 2 | 3 | 4 | 5>(1);
  return (
    <main className="min-h-screen bg-bg2">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-extrabold m-0">Preview · 5 opciones para Plano de Reservas</h1>
          <p className="text-sm text-mute mt-1">
            Cinco direcciones visuales distintas para{' '}
            <code className="text-xs bg-bg2 px-1.5 py-0.5 rounded">/app/reservations/plano</code>.
            Elige la que más te guste y la implemento.
          </p>
        </div>

        <div className="flex gap-2 flex-wrap mb-6">
          {[
            { n: 1 as const, label: '① Clásico Zonas refinado' },
            { n: 2 as const, label: '② Timeline por turnos' },
            { n: 3 as const, label: '③ Mapa fotorealista' },
            { n: 4 as const, label: '④ Pantalla TV / Host' },
            { n: 5 as const, label: '⑤ Cards densas' },
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

        {active === 1 && <Option1 />}
        {active === 2 && <Option2 />}
        {active === 3 && <Option3 />}
        {active === 4 && <Option4 />}
        {active === 5 && <Option5 />}
      </div>
    </main>
  );
}

// ============================================================
// OPCIÓN 1 — Clásico Zonas refinado (lo que hay, pulido)
// ============================================================
function Option1() {
  return (
    <Wrapper title="① Clásico Zonas refinado" desc="Lo que ya implementaste, con bordes y badges más finos. Zonas grandes, mesas circulares grandes, sidebar contextual.">
      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <div className="card card-pad">
          <div className="flex gap-1.5 mb-3">
            {['Todas', ...ZONES.map((z) => z.name)].map((l) => (
              <span key={l} className={`text-xs px-3 py-1.5 rounded-full font-semibold ${l === 'Todas' ? 'bg-ink text-white' : 'bg-white border border-line text-mute'}`}>{l}</span>
            ))}
          </div>
          <div className="space-y-3">
            {ZONES.map((z) => {
              const zTables = TABLES.filter((t) => t.zone === z.id);
              return (
                <div key={z.id} className="rounded-2xl p-4" style={{ background: `${z.color}10`, border: `1px solid ${z.color}40` }}>
                  <div className="text-[10px] font-bold tracking-[0.18em] uppercase mb-3" style={{ color: z.color }}>
                    {z.name} · {zTables.length} mesas
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {zTables.map((t) => {
                      const s = STATE_COLORS[t.state];
                      const isRound = t.shape === 'round';
                      const isBar = t.shape === 'bar';
                      const size = isRound ? (t.seats <= 2 ? 56 : t.seats <= 4 ? 64 : 80) : 0;
                      return (
                        <div key={t.id} className="font-bold inline-flex flex-col items-center justify-center" style={{
                          width: isRound ? size : isBar ? 130 : 100,
                          height: isRound ? size : isBar ? 48 : 60,
                          borderRadius: isRound ? '50%' : 12,
                          background: s.bg,
                          border: `2px solid ${s.border}`,
                          color: s.text,
                        }}>
                          <span className="text-sm leading-none">{t.number}</span>
                          <span className="text-[10px] leading-none mt-0.5 opacity-90">{t.seats}p</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <Legend />
        </div>
        <SelectedSidebar table={TABLES[2]} />
      </div>
    </Wrapper>
  );
}

// ============================================================
// OPCIÓN 2 — Timeline por turnos (eje horizontal de tiempo)
// ============================================================
function Option2() {
  const SLOTS = ['13:00', '13:30', '14:00', '14:30', '20:30', '21:00', '21:30', '22:00'];
  const RESERVATIONS = [
    { tableId: 't1', slot: '13:00', span: 2, customer: 'Sofía R.', state: 'sentada' },
    { tableId: 't3', slot: '14:00', span: 2, customer: 'Carlos I.', state: 'reservada' },
    { tableId: 't12', slot: '13:30', span: 2, customer: 'Laura M.', state: 'reservada' },
    { tableId: 'vip', slot: '21:30', span: 2, customer: 'Grupo Torres', state: 'reservada' },
    { tableId: 't13', slot: '21:00', span: 2, customer: 'Diana Q.', state: 'sentada' },
  ];
  return (
    <Wrapper title="② Timeline por turnos" desc="Eje horizontal con las horas del día. Cada fila es una mesa. Los bloques son reservas con su duración. Ideal para servicios con turnos cerrados (cenas con reservas que se solapan).">
      <div className="card card-pad">
        <div className="overflow-x-auto">
          <div className="grid" style={{ gridTemplateColumns: `120px repeat(${SLOTS.length}, minmax(70px, 1fr))`, minWidth: 700 }}>
            <div className="text-[10px] font-bold uppercase tracking-wider text-mute border-b border-line2 pb-2" />
            {SLOTS.map((s) => (
              <div key={s} className="text-[10px] font-bold text-center text-mute border-b border-line2 pb-2">{s}</div>
            ))}
            {TABLES.map((t) => {
              const zone = ZONES.find((z) => z.id === t.zone);
              return (
                <div key={t.id} className="contents">
                  <div className="text-xs font-semibold py-3 border-b border-line2 truncate">
                    <span style={{ color: zone?.color }}>●</span> Mesa {t.number}
                    <span className="text-mute text-[10px] ml-1">{t.seats}p</span>
                  </div>
                  {SLOTS.map((s) => {
                    const r = RESERVATIONS.find((x) => x.tableId === t.id && x.slot === s);
                    if (r) {
                      const bg = r.state === 'sentada' ? '#22C55E' : '#f59e0b';
                      return (
                        <div key={s} className="border-b border-line2 py-1 px-0.5 relative">
                          <div className="rounded-md p-1.5 text-white text-[10px] font-semibold" style={{ background: bg, gridColumn: `span ${r.span}` }}>
                            <div className="truncate">{r.customer}</div>
                            <div className="opacity-80">{s}</div>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={s} className="border-b border-line2 border-r border-r-line2/60 hover:bg-bg2/50 cursor-pointer transition" />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-3 flex justify-between items-center text-[11px] text-mute">
          <div>Toca un slot vacío para crear reserva al instante.</div>
          <div className="flex gap-3">
            <span><span className="inline-block w-3 h-3 rounded mr-1" style={{ background: '#22C55E' }} /> Sentada</span>
            <span><span className="inline-block w-3 h-3 rounded mr-1" style={{ background: '#f59e0b' }} /> Reservada</span>
          </div>
        </div>
      </div>
    </Wrapper>
  );
}

// ============================================================
// OPCIÓN 3 — Mapa fotorealista (top-down con proporciones reales)
// ============================================================
function Option3() {
  return (
    <Wrapper title="③ Mapa fotorealista" desc="Vista cenital con dimensiones reales del local. Las zonas son áreas con paredes. Las mesas tienen tamaño proporcional. Ideal para visualizar capacidad y flujo del salón como en planos de arquitecto.">
      <div className="grid lg:grid-cols-[1fr_280px] gap-4">
        <div className="card card-pad">
          <div className="relative rounded-xl overflow-hidden" style={{ background: '#f8fafc', height: 540, border: '2px solid #1e293b' }}>
            {/* Salón principal */}
            <div className="absolute" style={{ top: 30, left: 30, width: 360, height: 240, background: 'rgba(34,197,94,0.04)', border: '3px solid #0f172a' }}>
              <div className="absolute -top-3 left-3 bg-white px-2 text-[10px] font-bold tracking-wider">SALÓN</div>
              <CircleTable cx={70} cy={60} seats={2} state="sentada" label="1" />
              <CircleTable cx={170} cy={60} seats={2} state="libre" label="2" />
              <CircleTable cx={270} cy={60} seats={2} state="libre" label="6" />
              <CircleTable cx={70} cy={160} seats={4} state="reservada" label="3" />
              <CircleTable cx={170} cy={160} seats={4} state="libre" label="4" />
              <CircleTable cx={270} cy={160} seats={6} state="libre" label="5" />
            </div>
            {/* Terraza */}
            <div className="absolute" style={{ top: 30, right: 30, width: 200, height: 240, background: 'rgba(59,130,246,0.06)', border: '2px dashed #1e293b' }}>
              <div className="absolute -top-3 left-3 bg-white px-2 text-[10px] font-bold tracking-wider">TERRAZA</div>
              <CircleTable cx={60} cy={60} seats={4} state="reservada" label="12" />
              <CircleTable cx={140} cy={60} seats={4} state="sentada" label="13" />
              <CircleTable cx={60} cy={160} seats={2} state="libre" label="14" />
              <RectTable x={100} y={140} w={70} h={40} state="libre" label="15" seats={6} />
            </div>
            {/* Barra */}
            <div className="absolute" style={{ top: 290, left: 30, right: 30, height: 50, background: 'rgba(249,115,22,0.06)', border: '2px solid #0f172a' }}>
              <div className="absolute -top-3 left-3 bg-white px-2 text-[10px] font-bold tracking-wider">BARRA · 6 ASIENTOS</div>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="absolute" style={{
                  width: 16, height: 16, borderRadius: 8, background: '#fff', border: '2px solid #cbd5e1',
                  top: 18, left: 30 + i * 60,
                }} />
              ))}
            </div>
            {/* Privado VIP */}
            <div className="absolute" style={{ bottom: 30, left: 30, right: 30, height: 130, background: 'rgba(139,92,246,0.06)', border: '2px solid #0f172a' }}>
              <div className="absolute -top-3 left-3 bg-white px-2 text-[10px] font-bold tracking-wider">PRIVADO / VIP</div>
              <RectTable x={40} y={30} w={120} h={60} state="bloqueada" label="21" seats={8} />
              <RectTable x={200} y={30} w={120} h={60} state="libre" label="22" seats={8} />
              <CircleTable cx={420} cy={60} seats={4} state="reservada" label="VIP" />
            </div>
            {/* Entrada */}
            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-bold tracking-wider text-mute bg-white px-2">↑ ENTRADA</div>
          </div>
          <Legend />
        </div>
        <SelectedSidebar table={TABLES[2]} compact />
      </div>
    </Wrapper>
  );
}

// ============================================================
// OPCIÓN 4 — Pantalla TV / Host (mode kiosko, tipografía grande)
// ============================================================
function Option4() {
  return (
    <Wrapper title="④ Pantalla TV / Host" desc="Diseño para colgar una tablet o TV en la estación del host. Tipografía grande, contraste alto, sin chrome adicional. Refresh automático. Se ve a 2-3m de distancia.">
      <div className="rounded-2xl overflow-hidden" style={{ background: '#0f172a', minHeight: 600 }}>
        <div className="px-6 py-4 flex items-center justify-between border-b border-white/10">
          <div>
            <div className="text-white text-2xl font-extrabold">Sábado 13 · 21:14</div>
            <div className="text-white/60 text-sm">NudoCowork · Polanco</div>
          </div>
          <div className="text-right">
            <div className="text-white/60 text-[10px] uppercase tracking-wider font-bold">Servicio noche</div>
            <div className="text-white text-3xl font-extrabold">8/14</div>
            <div className="text-white/60 text-[10px]">mesas ocupadas</div>
          </div>
        </div>
        <div className="p-6 grid grid-cols-4 gap-3">
          {TABLES.slice(0, 12).map((t) => {
            const s = STATE_COLORS[t.state];
            const bgMap: Record<string, string> = {
              libre: '#1e293b',
              reservada: '#92400e',
              sentada: '#166534',
              bloqueada: '#374151',
            };
            const colorMap: Record<string, string> = {
              libre: '#94a3b8',
              reservada: '#fbbf24',
              sentada: '#86efac',
              bloqueada: '#9ca3af',
            };
            return (
              <div key={t.id} className="rounded-xl p-4" style={{ background: bgMap[t.state], border: `2px solid ${colorMap[t.state]}40` }}>
                <div className="flex items-start justify-between">
                  <div className="text-white text-2xl font-extrabold leading-none">{t.number}</div>
                  <div className="text-[10px] font-bold tracking-wider px-2 py-1 rounded" style={{ background: colorMap[t.state] + '20', color: colorMap[t.state] }}>
                    {t.state.toUpperCase()}
                  </div>
                </div>
                <div className="text-white/60 text-xs mt-1">{t.seats} pax</div>
                {t.customer && (
                  <div className="mt-3 pt-3 border-t border-white/10">
                    <div className="text-white text-sm font-semibold truncate">{t.customer}</div>
                    <div className="text-white/60 text-xs">{t.time}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="px-6 py-4 border-t border-white/10 flex items-center justify-between text-white/60 text-xs">
          <div>↻ Auto-refresh cada 30s</div>
          <div className="flex gap-4">
            <span>⚪ Libre 5</span>
            <span>🟡 Reservada 3</span>
            <span>🟢 Sentada 4</span>
            <span>⏸ Bloqueada 1</span>
          </div>
        </div>
      </div>
    </Wrapper>
  );
}

// ============================================================
// OPCIÓN 5 — Cards densas (lista vertical / mobile-first)
// ============================================================
function Option5() {
  return (
    <Wrapper title="⑤ Cards densas" desc="Lista vertical de mesas, cada una como card con toda su info: número, capacidad, estado, cliente actual, próxima reserva, acciones. Mobile-first. Ideal para staff con celular.">
      <div className="grid md:grid-cols-2 gap-3">
        {TABLES.map((t) => {
          const zone = ZONES.find((z) => z.id === t.zone);
          const s = STATE_COLORS[t.state];
          const stateLabel = { libre: 'Libre', reservada: 'Reservada', sentada: 'Sentada', bloqueada: 'Bloqueada' }[t.state];
          return (
            <div key={t.id} className="card card-pad flex items-stretch gap-3">
              <div
                className="w-16 shrink-0 rounded-xl flex flex-col items-center justify-center text-center"
                style={{ background: s.bg, color: s.text, border: `2px solid ${s.border}` }}
              >
                <div className="text-2xl font-extrabold leading-none">{t.number}</div>
                <div className="text-[10px] mt-1 opacity-80">{t.seats}p</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: zone?.color }}>{zone?.name}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: s.bg, color: s.text, border: `1px solid ${s.border}` }}>
                    {stateLabel}
                  </span>
                </div>
                {t.customer ? (
                  <>
                    <div className="text-sm font-semibold mt-1 truncate">{t.customer}</div>
                    <div className="text-[11px] text-mute">{t.time} · {t.seats} pax</div>
                    <div className="flex gap-1.5 mt-2">
                      {t.state === 'reservada' && (
                        <button className="text-[11px] font-semibold px-2.5 py-1 rounded-md text-white" style={{ background: '#1d4ed8' }}>
                          🪑 Sentar
                        </button>
                      )}
                      {t.state === 'sentada' && (
                        <button className="text-[11px] font-semibold px-2.5 py-1 rounded-md text-white" style={{ background: '#15803d' }}>
                          ✓ Liberar
                        </button>
                      )}
                      <button className="text-[11px] font-semibold px-2.5 py-1 rounded-md border border-line">⋯</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-sm text-mute mt-1 italic">
                      {t.state === 'bloqueada' ? 'Mesa fuera de servicio' : 'Disponible'}
                    </div>
                    <div className="flex gap-1.5 mt-2">
                      <button className="text-[11px] font-semibold px-2.5 py-1 rounded-md border border-line">+ Asignar cliente</button>
                      <button className="text-[11px] font-semibold px-2.5 py-1 rounded-md border border-line">
                        {t.state === 'bloqueada' ? '▶ Liberar' : '⏸ Bloquear'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Wrapper>
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

function CircleTable({ cx, cy, seats, state, label }: { cx: number; cy: number; seats: number; state: string; label: string }) {
  const s = STATE_COLORS[state];
  const r = seats <= 2 ? 16 : seats <= 4 ? 20 : 24;
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
      }}
    >
      <span className="text-[10px] leading-none">{label}</span>
      <span className="text-[8px] leading-none opacity-80">{seats}p</span>
    </div>
  );
}

function RectTable({ x, y, w, h, state, label, seats }: { x: number; y: number; w: number; h: number; state: string; label: string; seats: number }) {
  const s = STATE_COLORS[state];
  return (
    <div
      className="absolute flex flex-col items-center justify-center font-bold"
      style={{ left: x, top: y, width: w, height: h, background: s.bg, border: `2px solid ${s.border}`, borderRadius: 8, color: s.text }}
    >
      <span className="text-xs leading-none">{label}</span>
      <span className="text-[10px] leading-none opacity-80 mt-0.5">{seats}p</span>
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-4 pt-3 border-t border-line2 flex gap-4 text-[11px] text-mute flex-wrap">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded" style={{ background: '#ffffff', border: '1.5px solid #cbd5e1' }} /> Libre
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded" style={{ background: '#fef3c7', border: '1.5px solid #f59e0b' }} /> Reservada
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded" style={{ background: '#22C55E', border: '1.5px solid #15803d' }} /> Sentada
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded" style={{ background: 'repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6 3px,#e9ebee 3px,#e9ebee 6px)', border: '1.5px solid #cbd5e1' }} /> Bloqueada
      </span>
    </div>
  );
}

function SelectedSidebar({ table, compact }: { table: any; compact?: boolean }) {
  return (
    <div className="card card-pad self-start" style={{ background: '#fffbeb', border: '2px solid #f59e0b' }}>
      <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded inline-block" style={{ background: '#fef3c7', color: '#b45309' }}>
        Reservada
      </span>
      <div className="mt-2">
        <div className="text-2xl font-extrabold m-0">Mesa {table.number}</div>
        <div className="text-xs text-mute mt-0.5">Capacidad · {table.seats} personas</div>
      </div>
      <div className="mt-4 p-3 rounded-xl bg-bg2/60">
        <div className="text-sm font-semibold">{table.customer}</div>
        <div className="text-[11px] text-mute">{table.time} · 3 pax · VIP</div>
      </div>
      <div className="mt-4 space-y-2">
        <button className="w-full py-2.5 rounded-lg font-semibold text-white text-sm" style={{ background: '#1d4ed8' }}>🪑 Sentar cliente</button>
        <button className="w-full py-2.5 rounded-lg font-semibold text-sm border border-line">⏸ Bloquear mesa</button>
      </div>
      {!compact && (
        <div className="mt-4 pt-3 border-t border-line2">
          <div className="text-[10px] font-bold tracking-wider uppercase text-mute">Asignación inteligente</div>
          <button className="mt-2 w-full text-left px-3 py-2 rounded-lg text-xs bg-bg2/40 text-mute italic" disabled>
            ✨ Próximamente
          </button>
        </div>
      )}
    </div>
  );
}
