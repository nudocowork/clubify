'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import {
  Location,
  Reservation,
  Table,
  Zone,
  fmtLongDate,
  todayISO,
  LABEL_COLORS,
} from '../_shared';

const GRID = 26;
const CANVAS_H = 560;

function snap(v: number) {
  return Math.max(0, Math.round(v / GRID) * GRID);
}

function tableDims(t: { shape: string; seats: number; width?: number | null; height?: number | null }) {
  const isRound = t.shape === 'ROUND';
  const w = t.width ?? (isRound ? (t.seats <= 2 ? 54 : t.seats <= 4 ? 66 : 80) : t.shape === 'BAR' ? 130 : 100);
  const h = t.height ?? (isRound ? w : t.shape === 'BAR' ? 50 : 60);
  return { w, h, isRound };
}

// Estilos de zona según tipo
const ZONE_BG: Record<string, { bg: string; border: string; label: string }> = {
  INDOOR: { bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.25)', label: '#15803d' },
  OUTDOOR: { bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.25)', label: '#1d4ed8' },
  BAR: { bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.25)', label: '#b45309' },
  PRIVATE: { bg: 'rgba(139,92,246,0.10)', border: 'rgba(139,92,246,0.30)', label: '#6d28d9' },
};

type MesaState = 'libre' | 'reservada' | 'sentada' | 'bloqueada';
const STATE_STYLES: Record<
  MesaState,
  { bg: string; border: string; text: string; pattern?: string }
> = {
  libre: { bg: '#ffffff', border: '#cbd5e1', text: '#475569' },
  reservada: { bg: '#fef3c7', border: '#f59e0b', text: '#b45309' },
  sentada: { bg: '#22C55E', border: '#15803d', text: '#ffffff' },
  bloqueada: {
    bg: 'repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6 6px,#e9ebee 6px,#e9ebee 12px)',
    border: '#cbd5e1',
    text: '#94a3b8',
  },
};

function reservationToTimestamp(r: Reservation): number {
  const [y, m, d] = r.date.split('T')[0].split('-').map(Number);
  const [h, min] = r.time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, h + 5, min, 0); // UTC-5 LATAM
}

function computeMesaState(
  table: Table,
  reservations: Reservation[],
  now: number,
): { state: MesaState; reservation: Reservation | null } {
  if (table.isBlocked) return { state: 'bloqueada', reservation: null };
  const linked = reservations.filter((r) => r.tableId === table.id);
  // Sentada ahora
  const seated = linked.find((r) => r.status === 'SEATED');
  if (seated) return { state: 'sentada', reservation: seated };
  // Confirmada próxima (dentro de 3h hacia adelante)
  const upcoming = linked
    .filter((r) => ['CONFIRMED', 'PENDING'].includes(r.status))
    .map((r) => ({ r, ts: reservationToTimestamp(r) }))
    .filter(({ ts }) => ts - now < 3 * 60 * 60 * 1000 && ts - now > -2 * 60 * 60 * 1000)
    .sort((a, b) => a.ts - b.ts);
  if (upcoming.length > 0) return { state: 'reservada', reservation: upcoming[0].r };
  return { state: 'libre', reservation: null };
}

export default function PlanoPage() {
  const [mode, setMode] = useState<'operacion' | 'editor'>('operacion');
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [activeLocationId, setActiveLocationId] = useState<string>('');
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [zoneFilter, setZoneFilter] = useState<string>('todas');

  async function loadAll() {
    try {
      const locQs = activeLocationId ? `?locationId=${activeLocationId}` : '';
      const [zn, tb, locs, res] = await Promise.all([
        api<Zone[]>(`/reservations/zones${locQs}`),
        api<Table[]>(`/reservations/tables${locQs}`),
        locations.length === 0 ? api<Location[]>('/locations').catch(() => []) : Promise.resolve(locations),
        api<Reservation[]>(`/reservations?date=${todayISO()}${activeLocationId ? `&locationId=${activeLocationId}` : ''}`),
      ]);
      setZones(zn);
      setTables(tb);
      setReservations(res);
      if (locations.length === 0) setLocations(locs);
    } catch (e: any) {
      toast(e.message || 'Error cargando plano', 'error');
    }
  }

  useEffect(() => {
    loadAll();
  }, [activeLocationId]);

  const now = Date.now();

  // Mesa states map
  const mesaStates = useMemo(() => {
    const m = new Map<string, { state: MesaState; reservation: Reservation | null }>();
    tables.forEach((t) => m.set(t.id, computeMesaState(t, reservations, now)));
    return m;
  }, [tables, reservations, now]);

  // Counts agregados
  const counts = useMemo(() => {
    const c = { libre: 0, reservada: 0, sentada: 0, bloqueada: 0 };
    mesaStates.forEach((v) => c[v.state]++);
    return c;
  }, [mesaStates]);

  // Zonas filtradas
  const visibleZones = useMemo(() => {
    if (zoneFilter === 'todas') return zones;
    return zones.filter((z) => z.id === zoneFilter || z.type.toLowerCase() === zoneFilter);
  }, [zones, zoneFilter]);

  // Tablas sin zona (huérfanas)
  const orphanTables = useMemo(() => tables.filter((t) => !t.zoneId), [tables]);

  const selectedTable = tables.find((t) => t.id === selectedTableId) || null;
  const selectedState = selectedTable ? mesaStates.get(selectedTable.id) : null;
  const selectedZone = selectedTable?.zoneId ? zones.find((z) => z.id === selectedTable.zoneId) : null;

  // Actions
  async function setReservationStatus(reservationId: string, status: Reservation['status']) {
    try {
      await api(`/reservations/${reservationId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      loadAll();
    } catch (e: any) {
      toast(e.message || 'No se pudo actualizar', 'error');
    }
  }

  async function toggleBlock(t: Table) {
    try {
      await api(`/reservations/tables/${t.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isBlocked: !t.isBlocked }),
      });
      loadAll();
    } catch (e: any) {
      toast(e.message || 'No se pudo actualizar', 'error');
    }
  }

  // === Editor mode (drag + add tables/zones) ===
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const [newTable, setNewTable] = useState({
    number: '',
    seats: 4,
    shape: 'ROUND' as 'ROUND' | 'RECT' | 'BAR',
    zoneId: '',
  });
  const [showAddTable, setShowAddTable] = useState(false);

  async function createTable(e: React.FormEvent) {
    e.preventDefault();
    if (!newTable.number.trim()) {
      toast('Número de mesa requerido', 'error');
      return;
    }
    try {
      await api('/reservations/tables', {
        method: 'POST',
        body: JSON.stringify({
          number: newTable.number.trim(),
          seats: Math.max(1, Math.min(40, newTable.seats)),
          shape: newTable.shape,
          zoneId: newTable.zoneId || null,
          locationId: activeLocationId || null,
          posX: 60,
          posY: 60,
        }),
      });
      setNewTable({ number: '', seats: 4, shape: 'ROUND', zoneId: '' });
      setShowAddTable(false);
      loadAll();
      toast('Mesa creada', 'success');
    } catch (err: any) {
      toast(err.message || 'No se pudo crear', 'error');
    }
  }

  async function patchTable(id: string, patch: Partial<Table>) {
    setTables((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    try {
      await api(`/reservations/tables/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    } catch (e: any) {
      toast(e.message || 'No se pudo actualizar', 'error');
      loadAll();
    }
  }

  async function deleteTable(t: Table) {
    if (!confirm(`Eliminar mesa "${t.number}"?`)) return;
    try {
      await api(`/reservations/tables/${t.id}`, { method: 'DELETE' });
      setSelectedTableId(null);
      loadAll();
    } catch (e: any) {
      toast(e.message || 'No se pudo eliminar', 'error');
    }
  }

  function handlePointerDown(e: React.PointerEvent, t: Table) {
    if (mode !== 'editor') return;
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const offsetX = e.clientX - rect.left - t.posX;
    const offsetY = e.clientY - rect.top - t.posY;
    dragRef.current = { id: t.id, offsetX, offsetY };
    setSelectedTableId(t.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const t = tables.find((x) => x.id === dragRef.current!.id);
    if (!t) return;
    const dims = tableDims(t);
    const rawX = e.clientX - rect.left - dragRef.current.offsetX;
    const rawY = e.clientY - rect.top - dragRef.current.offsetY;
    const maxX = rect.width - dims.w;
    const maxY = CANVAS_H - dims.h;
    const x = Math.min(maxX, Math.max(0, snap(rawX)));
    const y = Math.min(maxY, Math.max(0, snap(rawY)));
    setTables((prev) => prev.map((tt) => (tt.id === t.id ? { ...tt, posX: x, posY: y } : tt)));
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const id = dragRef.current.id;
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    const t = tables.find((x) => x.id === id);
    if (!t) return;
    api(`/reservations/tables/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ posX: t.posX, posY: t.posY }),
    }).catch((err: any) => {
      toast(err.message || 'No se pudo guardar la posición', 'error');
      loadAll();
    });
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="page-title m-0">
            Plano de mesas{' '}
            <span className="page-crumb text-mute font-normal">/ {fmtLongDate(todayISO())}</span>
          </h1>
          <p className="text-xs text-mute mt-1">
            Distribución en tiempo real
            {locations.length > 0 && activeLocationId
              ? ` · ${locations.find((l) => l.id === activeLocationId)?.name ?? ''}`
              : locations.length === 1
              ? ` · ${locations[0].name}`
              : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-ok-soft text-ok-ink text-xs font-semibold">
            <span className="relative inline-block w-2 h-2">
              <span className="absolute inset-0 rounded-full bg-ok animate-ping opacity-75" />
              <span className="absolute inset-0 rounded-full bg-ok" />
            </span>
            Tiempo real
          </div>
          {locations.length > 1 && (
            <select
              value={activeLocationId}
              onChange={(e) => setActiveLocationId(e.target.value)}
              className="input text-sm"
              style={{ width: 'auto' }}
            >
              <option value="">📍 Todas las sedes</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>📍 {loc.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Toolbar: filtros + mode toggle */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex gap-1.5 text-xs flex-wrap">
          <FilterChip
            label="Todas"
            active={zoneFilter === 'todas'}
            onClick={() => setZoneFilter('todas')}
          />
          {zones.map((z) => (
            <FilterChip
              key={z.id}
              label={z.name}
              active={zoneFilter === z.id}
              onClick={() => setZoneFilter(z.id)}
            />
          ))}
        </div>
        <div className="flex gap-1 bg-bg2 p-1 rounded-lg text-xs">
          <button
            onClick={() => setMode('operacion')}
            className={`px-3 py-1.5 rounded-md font-semibold transition flex items-center gap-1.5 ${
              mode === 'operacion' ? 'bg-white text-ink shadow-sm' : 'text-mute hover:text-ink'
            }`}
          >
            🗂 Operación
          </button>
          <button
            onClick={() => setMode('editor')}
            className={`px-3 py-1.5 rounded-md font-semibold transition flex items-center gap-1.5 ${
              mode === 'editor' ? 'bg-white text-ink shadow-sm' : 'text-mute hover:text-ink'
            }`}
          >
            ⚙ Editor
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        {/* Main canvas */}
        <div className="card card-pad">
          {mode === 'operacion' ? (
            <OperationView
              zones={visibleZones}
              orphanTables={orphanTables}
              tables={tables}
              mesaStates={mesaStates}
              selectedId={selectedTableId}
              onSelect={setSelectedTableId}
            />
          ) : (
            <EditorView
              canvasRef={canvasRef}
              tables={tables}
              selectedId={selectedTableId}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onAddOpen={() => setShowAddTable(true)}
              showAddTable={showAddTable}
              newTable={newTable}
              setNewTable={setNewTable}
              onSubmitNew={createTable}
              zones={zones}
              setShowAddTable={setShowAddTable}
            />
          )}

          {/* Legend bottom */}
          {mode === 'operacion' && (
            <div className="mt-4 pt-3 border-t border-line2 flex items-center justify-between text-xs flex-wrap gap-3">
              <div className="flex gap-3 flex-wrap">
                <Legend dot={STATE_STYLES.libre.bg} border={STATE_STYLES.libre.border} label={`Libre · ${counts.libre}`} />
                <Legend dot={STATE_STYLES.reservada.bg} border={STATE_STYLES.reservada.border} label={`Reservada · ${counts.reservada}`} />
                <Legend dot={STATE_STYLES.sentada.bg} border={STATE_STYLES.sentada.border} label={`Sentada · ${counts.sentada}`} />
                <Legend dot="#f3f4f6" border={STATE_STYLES.bloqueada.border} label={`Bloqueada · ${counts.bloqueada}`} stripes />
              </div>
            </div>
          )}
        </div>

        {/* Sidebar derecho */}
        <div className="space-y-3">
          {mode === 'operacion' ? (
            <OperationSidebar
              table={selectedTable}
              state={selectedState}
              zone={selectedZone}
              onSentar={(rid) => setReservationStatus(rid, 'SEATED')}
              onLiberar={(rid) => setReservationStatus(rid, 'COMPLETED')}
              onBloquear={() => selectedTable && toggleBlock(selectedTable)}
            />
          ) : (
            <EditorSidebar
              table={selectedTable}
              zones={zones}
              onPatch={(patch) => selectedTable && patchTable(selectedTable.id, patch)}
              onToggleBlock={() => selectedTable && toggleBlock(selectedTable)}
              onDelete={() => selectedTable && deleteTable(selectedTable)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ============ Operation View ============

function OperationView({
  zones,
  orphanTables,
  tables,
  mesaStates,
  selectedId,
  onSelect,
}: {
  zones: Zone[];
  orphanTables: Table[];
  tables: Table[];
  mesaStates: Map<string, { state: MesaState; reservation: Reservation | null }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (zones.length === 0 && orphanTables.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-mute">
          Sin mesas configuradas todavía. Pasa al modo <strong>Editor</strong> para crear zonas y
          mesas.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {zones.map((zone) => {
        const zoneTables = tables.filter((t) => t.zoneId === zone.id);
        const style = ZONE_BG[zone.type] ?? ZONE_BG.INDOOR;
        return (
          <div
            key={zone.id}
            className="rounded-2xl p-4"
            style={{ background: style.bg, border: `1px solid ${style.border}` }}
          >
            <div
              className="text-[10px] font-bold tracking-[0.18em] uppercase mb-3"
              style={{ color: style.label }}
            >
              {zone.name}
              <span className="ml-2 opacity-60">· {zoneTables.length} mesa{zoneTables.length === 1 ? '' : 's'}</span>
            </div>
            {zoneTables.length === 0 ? (
              <p className="text-xs text-mute italic">Sin mesas en esta zona.</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {zoneTables.map((t) => (
                  <MesaCircle
                    key={t.id}
                    table={t}
                    state={mesaStates.get(t.id)?.state ?? 'libre'}
                    selected={t.id === selectedId}
                    onClick={() => onSelect(t.id)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
      {orphanTables.length > 0 && (
        <div className="rounded-2xl p-4 bg-bg2/40 border border-line">
          <div className="text-[10px] font-bold tracking-[0.18em] uppercase mb-3 text-mute">
            Sin zona · {orphanTables.length} mesa{orphanTables.length === 1 ? '' : 's'}
          </div>
          <div className="flex flex-wrap gap-3">
            {orphanTables.map((t) => (
              <MesaCircle
                key={t.id}
                table={t}
                state={mesaStates.get(t.id)?.state ?? 'libre'}
                selected={t.id === selectedId}
                onClick={() => onSelect(t.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MesaCircle({
  table,
  state,
  selected,
  onClick,
}: {
  table: Table;
  state: MesaState;
  selected: boolean;
  onClick: () => void;
}) {
  const style = STATE_STYLES[state];
  const isRound = table.shape === 'ROUND';
  const isBar = table.shape === 'BAR';
  const size = isRound ? (table.seats <= 2 ? 56 : table.seats <= 4 ? 64 : 80) : 0;
  return (
    <button
      onClick={onClick}
      className="relative inline-flex flex-col items-center justify-center font-bold transition shrink-0"
      style={{
        width: isRound ? size : isBar ? 130 : 100,
        height: isRound ? size : isBar ? 48 : 60,
        borderRadius: isRound ? '50%' : 12,
        background: style.bg,
        border: `2px solid ${selected ? '#0f172a' : style.border}`,
        boxShadow: selected ? '0 0 0 3px rgba(15,23,42,0.15)' : 'none',
        color: style.text,
      }}
      title={`Mesa ${table.number} · ${state}`}
    >
      <span className="text-sm leading-none">{table.number}</span>
      <span className="text-[10px] leading-none mt-0.5 opacity-90">{table.seats}p</span>
    </button>
  );
}

// ============ Operation Sidebar ============

function OperationSidebar({
  table,
  state,
  zone,
  onSentar,
  onLiberar,
  onBloquear,
}: {
  table: Table | null;
  state: { state: MesaState; reservation: Reservation | null } | null | undefined;
  zone: Zone | null | undefined;
  onSentar: (rid: string) => void;
  onLiberar: (rid: string) => void;
  onBloquear: () => void;
}) {
  if (!table) {
    return (
      <div className="card card-pad text-center py-8">
        <div className="text-3xl mb-2 opacity-60">👆</div>
        <p className="text-sm text-mute leading-snug">
          Toca una mesa en el plano para ver su estado y las acciones disponibles.
        </p>
      </div>
    );
  }

  const meta = state ?? { state: 'libre' as MesaState, reservation: null };
  const stateMeta: Record<MesaState, { label: string; bg: string; fg: string }> = {
    libre: { label: 'Libre', bg: '#f1f5f9', fg: '#475569' },
    reservada: { label: 'Reservada', bg: '#fef3c7', fg: '#b45309' },
    sentada: { label: 'Sentada', bg: '#dcfce7', fg: '#15803d' },
    bloqueada: { label: 'Bloqueada', bg: '#f3f4f6', fg: '#6b7280' },
  };
  const sm = stateMeta[meta.state];

  return (
    <div
      className="rounded-2xl border-2 card-pad"
      style={{
        background: meta.state === 'reservada' ? '#fffbeb' : '#ffffff',
        borderColor:
          meta.state === 'sentada'
            ? '#22C55E'
            : meta.state === 'reservada'
            ? '#f59e0b'
            : '#e2e8f0',
      }}
    >
      <div className="flex items-center justify-between">
        <span
          className="inline-flex items-center text-[10px] font-bold tracking-[0.18em] uppercase px-2 py-0.5 rounded"
          style={{ background: sm.bg, color: sm.fg }}
        >
          {sm.label}
        </span>
        {zone && <span className="text-[10px] text-mute">{zone.name}</span>}
      </div>
      <div className="mt-2">
        <div className="text-2xl font-extrabold m-0">Mesa {table.number}</div>
        <div className="text-xs text-mute mt-0.5">Capacidad · {table.seats} personas</div>
      </div>

      {meta.reservation && (
        <div className="mt-4 p-3 rounded-xl bg-bg2/60">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-ink text-white flex items-center justify-center text-xs font-bold shrink-0">
              {meta.reservation.customerName
                .split(' ')
                .slice(0, 2)
                .map((p) => p[0])
                .join('')
                .toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <Link
                href={meta.reservation.customer?.id ? `/app/customers/${meta.reservation.customer.id}` : '#'}
                className="text-sm font-semibold truncate block hover:underline"
              >
                {meta.reservation.customerName}
              </Link>
              <div className="text-[11px] text-mute">
                {meta.reservation.time} · {meta.reservation.party} pax
              </div>
            </div>
          </div>
          {meta.reservation.labels && meta.reservation.labels.length > 0 && (
            <div className="flex gap-1 mt-2 flex-wrap">
              {meta.reservation.labels.map((lbl) => (
                <span
                  key={lbl}
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                  style={{
                    background: LABEL_COLORS[lbl]?.bg ?? '#f3f4f6',
                    color: LABEL_COLORS[lbl]?.fg ?? '#6b7280',
                  }}
                >
                  {lbl}
                </span>
              ))}
            </div>
          )}
          {meta.reservation.notes && (
            <div className="text-[11px] text-mute italic mt-2 leading-snug">
              📝 {meta.reservation.notes}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 space-y-2">
        {meta.state === 'reservada' && meta.reservation && (
          <button
            onClick={() => onSentar(meta.reservation!.id)}
            className="w-full py-2.5 rounded-lg font-semibold text-white text-sm"
            style={{ background: '#1d4ed8' }}
          >
            🪑 Sentar cliente
          </button>
        )}
        {meta.state === 'sentada' && meta.reservation && (
          <button
            onClick={() => onLiberar(meta.reservation!.id)}
            className="w-full py-2.5 rounded-lg font-semibold text-white text-sm"
            style={{ background: '#15803d' }}
          >
            ✓ Liberar mesa
          </button>
        )}
        <button
          onClick={onBloquear}
          className="w-full py-2.5 rounded-lg font-semibold text-sm border border-line"
        >
          {table.isBlocked ? '▶ Desbloquear mesa' : '⏸ Bloquear mesa'}
        </button>
      </div>

      <div className="mt-4 pt-3 border-t border-line2">
        <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-mute">
          Asignación inteligente
        </div>
        <button
          className="mt-2 w-full text-left px-3 py-2 rounded-lg text-xs bg-bg2/40 text-mute italic cursor-not-allowed"
          disabled
          title="Próximamente — sugiere automáticamente la mejor mesa para una reserva"
        >
          ✨ Próximamente — sugerir mesa óptima
        </button>
      </div>
    </div>
  );
}

// ============ Editor View ============

function EditorView({
  canvasRef,
  tables,
  selectedId,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onAddOpen,
  showAddTable,
  newTable,
  setNewTable,
  onSubmitNew,
  zones,
  setShowAddTable,
}: {
  canvasRef: React.RefObject<HTMLDivElement>;
  tables: Table[];
  selectedId: string | null;
  onPointerDown: (e: React.PointerEvent, t: Table) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onAddOpen: () => void;
  showAddTable: boolean;
  newTable: { number: string; seats: number; shape: 'ROUND' | 'RECT' | 'BAR'; zoneId: string };
  setNewTable: (v: typeof newTable) => void;
  onSubmitNew: (e: React.FormEvent) => void;
  zones: Zone[];
  setShowAddTable: (v: boolean) => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold m-0">Editor de plano</h2>
          <p className="text-[11px] text-mute mt-0.5">
            Arrastra mesas para reorganizar. Los cambios se guardan al soltar.
          </p>
        </div>
        <button onClick={onAddOpen} className="btn-primary text-sm">
          + Mesa
        </button>
      </div>

      {showAddTable && (
        <form
          onSubmit={onSubmitNew}
          className="mb-3 p-3 bg-bg2/60 rounded-lg border border-line grid grid-cols-2 md:grid-cols-5 gap-2 items-end"
        >
          <div>
            <label className="label">Número</label>
            <input
              className="input"
              value={newTable.number}
              onChange={(e) => setNewTable({ ...newTable, number: e.target.value })}
              placeholder="1 / VIP / Barra"
              required
            />
          </div>
          <div>
            <label className="label">Capacidad</label>
            <input
              type="number"
              className="input"
              min={1}
              max={40}
              value={newTable.seats}
              onChange={(e) => setNewTable({ ...newTable, seats: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="label">Forma</label>
            <select
              className="input"
              value={newTable.shape}
              onChange={(e) => setNewTable({ ...newTable, shape: e.target.value as any })}
            >
              <option value="ROUND">Redonda</option>
              <option value="RECT">Rectangular</option>
              <option value="BAR">Barra</option>
            </select>
          </div>
          <div>
            <label className="label">Zona</label>
            <select
              className="input"
              value={newTable.zoneId}
              onChange={(e) => setNewTable({ ...newTable, zoneId: e.target.value })}
            >
              <option value="">Sin zona</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-1.5">
            <button className="btn-primary text-sm justify-center flex-1">Crear</button>
            <button
              type="button"
              onClick={() => setShowAddTable(false)}
              className="btn-ghost text-sm px-3"
            >
              ✕
            </button>
          </div>
        </form>
      )}

      <div
        ref={canvasRef}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="relative bg-bg2/40 border border-line rounded-lg overflow-hidden touch-none"
        style={{
          height: CANVAS_H,
          backgroundImage:
            'linear-gradient(#eef1f3 1px, transparent 1px), linear-gradient(90deg, #eef1f3 1px, transparent 1px)',
          backgroundSize: `${GRID}px ${GRID}px`,
        }}
      >
        {tables.map((t) => {
          const { w, h, isRound } = tableDims(t);
          const sel = t.id === selectedId;
          return (
            <div
              key={t.id}
              onPointerDown={(e) => onPointerDown(e, t)}
              style={{
                position: 'absolute',
                left: t.posX,
                top: t.posY,
                width: w,
                height: h,
                borderRadius: isRound ? '50%' : 12,
                background: t.isBlocked
                  ? 'repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6 6px,#e9ebee 6px,#e9ebee 12px)'
                  : '#fff',
                border: sel ? '2px solid #22C55E' : '1.5px solid #cdeed9',
                boxShadow: sel ? '0 0 0 3px rgba(34,197,94,.2)' : '0 1px 3px rgba(0,0,0,.06)',
                cursor: 'grab',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: t.isBlocked ? '#9ca3af' : '#15803d',
                userSelect: 'none',
                touchAction: 'none',
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 800 }}>{t.number}</span>
              <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.8 }}>{t.seats}p</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ============ Editor Sidebar ============

function EditorSidebar({
  table,
  zones,
  onPatch,
  onToggleBlock,
  onDelete,
}: {
  table: Table | null;
  zones: Zone[];
  onPatch: (patch: Partial<Table>) => void;
  onToggleBlock: () => void;
  onDelete: () => void;
}) {
  if (!table) {
    return (
      <div className="card card-pad text-center py-8">
        <p className="text-sm text-mute leading-snug">
          Selecciona una mesa del plano para editar sus datos o arrástrala para reposicionarla.
        </p>
      </div>
    );
  }
  return (
    <div className="card card-pad">
      <h2 className="text-base font-semibold m-0">Mesa {table.number}</h2>
      <div className="mt-3 space-y-3">
        <div>
          <label className="label">Número / etiqueta</label>
          <input
            className="input"
            defaultValue={table.number}
            key={table.id}
            onBlur={(e) => {
              if (e.target.value.trim() && e.target.value !== table.number) {
                onPatch({ number: e.target.value.trim() });
              }
            }}
          />
        </div>
        <div>
          <label className="label">Capacidad</label>
          <input
            type="number"
            className="input"
            min={1}
            max={40}
            value={table.seats}
            onChange={(e) => onPatch({ seats: Math.max(1, Math.min(40, Number(e.target.value) || 1)) })}
          />
        </div>
        <div>
          <label className="label">Forma</label>
          <select className="input" value={table.shape} onChange={(e) => onPatch({ shape: e.target.value })}>
            <option value="ROUND">Redonda</option>
            <option value="RECT">Rectangular</option>
            <option value="BAR">Barra</option>
          </select>
        </div>
        <div>
          <label className="label">Zona</label>
          <select
            className="input"
            value={table.zoneId ?? ''}
            onChange={(e) => onPatch({ zoneId: e.target.value || null })}
          >
            <option value="">Sin zona</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>{z.name}</option>
            ))}
          </select>
        </div>
        <button
          onClick={onToggleBlock}
          className="w-full py-2 rounded-lg text-sm border border-line"
        >
          {table.isBlocked ? '▶ Desbloquear' : '⏸ Bloquear'}
        </button>
        <button
          onClick={onDelete}
          className="w-full py-2 rounded-lg text-sm border border-bad text-bad"
        >
          🗑 Eliminar mesa
        </button>
      </div>
    </div>
  );
}

// ============ Small helpers ============

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full font-semibold transition ${
        active ? 'bg-ink text-white' : 'bg-white border border-line text-mute hover:text-ink'
      }`}
    >
      {label}
    </button>
  );
}

function Legend({
  dot,
  border,
  label,
  stripes,
}: {
  dot: string;
  border: string;
  label: string;
  stripes?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-mute">
      <span
        className="inline-block w-3 h-3 rounded"
        style={{
          background: stripes
            ? 'repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6 3px,#e9ebee 3px,#e9ebee 6px)'
            : dot,
          border: `1.5px solid ${border}`,
        }}
      />
      {label}
    </span>
  );
}
