'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { AcademyButton } from '@/components/AcademyButton';
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
  const t = useTranslations('app_reservations_plano');
  const [mode, setMode] = useState<'operacion' | 'editor'>('operacion');
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [activeLocationId, setActiveLocationId] = useState<string>('');
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
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
      toast(e.message || t('errorLoadingPlan'), 'error');
    }
  }

  useEffect(() => {
    loadAll();
  }, [activeLocationId]);

  // R1 (2026-08-01): default inteligente por sede. Si el negocio es multi-sede y
  // TODAS las zonas ya están asignadas a una sede, arrancamos en la primera sede
  // (plano independiente). Si hay zonas sin sede, nos quedamos en "Todas" para
  // que el negocio las asigne primero (evita ver un plano vacío). Una sola vez.
  const didAutoSede = useRef(false);
  useEffect(() => {
    if (didAutoSede.current) return;
    if (locations.length <= 1 || activeLocationId || zones.length === 0) return;
    if (zones.some((z) => !z.locationId)) return; // hay zonas sin sede → quedate en Todas
    didAutoSede.current = true;
    setActiveLocationId(locations[0].id);
  }, [locations, zones, activeLocationId]);

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

  // Mesas visibles según el filtro de zona. En 'todas' = todas; con una zona
  // elegida = SOLO las mesas de esa zona (antes se mostraban todas las mesas
  // aunque la zona estuviera filtrada → se veían los 2 pisos a la vez).
  const visibleZoneIds = useMemo(
    () => new Set(visibleZones.map((z) => z.id)),
    [visibleZones],
  );
  const visibleTables = useMemo(
    () =>
      zoneFilter === 'todas'
        ? tables
        : tables.filter((t) => t.zoneId && visibleZoneIds.has(t.zoneId)),
    [tables, zoneFilter, visibleZoneIds],
  );
  // Huérfanas solo en 'todas' (no pertenecen a ninguna zona específica).
  const visibleOrphanTables = zoneFilter === 'todas' ? orphanTables : [];

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
      toast(e.message || t('errorUpdate'), 'error');
    }
  }

  async function toggleBlock(tbl: Table) {
    try {
      await api(`/reservations/tables/${tbl.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isBlocked: !tbl.isBlocked }),
      });
      loadAll();
    } catch (e: any) {
      toast(e.message || t('errorUpdate'), 'error');
    }
  }

  // === Editor mode (drag + add tables/zones) ===
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const zoneDragRef = useRef<{
    id: string;
    kind: 'move' | 'resize';
    startPointerX: number;
    startPointerY: number;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);
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
      toast(t('errorTableNumberRequired'), 'error');
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
      toast(t('toastTableCreated'), 'success');
    } catch (err: any) {
      toast(err.message || t('errorCreate'), 'error');
    }
  }

  async function patchTable(id: string, patch: Partial<Table>) {
    setTables((prev) => prev.map((tbl) => (tbl.id === id ? { ...tbl, ...patch } : tbl)));
    try {
      await api(`/reservations/tables/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      // Si se movió de sede, recargamos: la mesa sale de la vista actual
      // (filtrada por sede) y se refrescan las zonas de la sede.
      if ('locationId' in patch) {
        setSelectedTableId(null);
        loadAll();
      }
    } catch (e: any) {
      toast(e.message || t('errorUpdate'), 'error');
      loadAll();
    }
  }

  async function deleteTable(tbl: Table) {
    if (!confirm(t('confirmDeleteTable', { number: tbl.number }))) return;
    try {
      await api(`/reservations/tables/${tbl.id}`, { method: 'DELETE' });
      setSelectedTableId(null);
      loadAll();
    } catch (e: any) {
      toast(e.message || t('errorDelete'), 'error');
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

  // === Drag/resize de ZONAS (modo editor) ===
  // Inicia el arrastre (mover por el cuerpo) o el redimensionado (esquina).
  // Si la zona aún no tiene geometría explícita, parte de la caja auto o el
  // default → al soltar queda fija y deja de depender de las mesas.
  function handleZonePointerDown(
    e: React.PointerEvent,
    zone: Zone,
    kind: 'move' | 'resize',
  ) {
    if (mode !== 'editor' || !canvasRef.current) return;
    e.stopPropagation();
    const g = zoneGeometry(zone, tables) ?? ZONE_DEFAULT_BOX;
    zoneDragRef.current = {
      id: zone.id,
      kind,
      startPointerX: e.clientX,
      startPointerY: e.clientY,
      startX: g.x,
      startY: g.y,
      startW: g.w,
      startH: g.h,
    };
    setSelectedZoneId(zone.id);
    setSelectedTableId(null);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent) {
    // Zona primero (su drag tiene prioridad si está activo).
    if (zoneDragRef.current && canvasRef.current) {
      const d = zoneDragRef.current;
      const rect = canvasRef.current.getBoundingClientRect();
      const dx = e.clientX - d.startPointerX;
      const dy = e.clientY - d.startPointerY;
      if (d.kind === 'move') {
        const x = Math.min(rect.width - d.startW, Math.max(0, snap(d.startX + dx)));
        const y = Math.min(CANVAS_H - d.startH, Math.max(0, snap(d.startY + dy)));
        setZones((prev) =>
          prev.map((z) =>
            z.id === d.id
              ? { ...z, posX: x, posY: y, width: d.startW, height: d.startH }
              : z,
          ),
        );
      } else {
        const w = Math.min(rect.width - d.startX, Math.max(ZONE_MIN, snap(d.startW + dx)));
        const h = Math.min(CANVAS_H - d.startY, Math.max(ZONE_MIN, snap(d.startH + dy)));
        setZones((prev) =>
          prev.map((z) =>
            z.id === d.id
              ? { ...z, posX: d.startX, posY: d.startY, width: w, height: h }
              : z,
          ),
        );
      }
      return;
    }
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
    if (zoneDragRef.current) {
      const id = zoneDragRef.current.id;
      zoneDragRef.current = null;
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      const z = zones.find((x) => x.id === id);
      if (!z) return;
      api(`/reservations/zones/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          posX: z.posX,
          posY: z.posY,
          width: z.width,
          height: z.height,
        }),
      }).catch((err: any) => {
        toast(err.message || t('errorSavePosition'), 'error');
        loadAll();
      });
      return;
    }
    if (!dragRef.current) return;
    const id = dragRef.current.id;
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    const tbl = tables.find((x) => x.id === id);
    if (!tbl) return;
    api(`/reservations/tables/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ posX: tbl.posX, posY: tbl.posY }),
    }).catch((err: any) => {
      toast(err.message || t('errorSavePosition'), 'error');
      loadAll();
    });
  }

  // Devuelve una zona a modo "auto" (recuadro derivado de las mesas).
  async function resetZoneGeometry(zoneId: string) {
    setZones((prev) =>
      prev.map((z) =>
        z.id === zoneId
          ? { ...z, posX: null, posY: null, width: null, height: null }
          : z,
      ),
    );
    try {
      await api(`/reservations/zones/${zoneId}`, {
        method: 'PATCH',
        body: JSON.stringify({ posX: null, posY: null, width: null, height: null }),
      });
    } catch (e: any) {
      toast(e.message || t('errorUpdate'), 'error');
      loadAll();
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="page-title m-0">
            {t('pageTitle')}{' '}
            <span className="page-crumb text-mute font-normal">/ {fmtLongDate(todayISO())}</span>
          </h1>
          <p className="text-xs text-mute mt-1">
            {t('realtimeLayout')}
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
            {t('realtimeBadge')}
          </div>
          {locations.length > 1 && (
            <select
              value={activeLocationId}
              onChange={(e) => setActiveLocationId(e.target.value)}
              className="input text-sm"
              style={{ width: 'auto' }}
            >
              <option value="">{t('allLocations')}</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>📍 {loc.name}</option>
              ))}
            </select>
          )}
          <AcademyButton moduleKey="plano" />
        </div>
      </div>

      {/* Toolbar: filtros + mode toggle */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex gap-1.5 text-xs flex-wrap">
          <FilterChip
            label={t('filterAll')}
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
            🗂 {t('modeOperation')}
          </button>
          <button
            onClick={() => setMode('editor')}
            className={`px-3 py-1.5 rounded-md font-semibold transition flex items-center gap-1.5 ${
              mode === 'editor' ? 'bg-white text-ink shadow-sm' : 'text-mute hover:text-ink'
            }`}
          >
            ⚙ {t('modeEditor')}
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        {/* Main canvas */}
        <div className="card card-pad">
          {mode === 'operacion' ? (
            <OperationView
              zones={visibleZones}
              orphanTables={visibleOrphanTables}
              tables={visibleTables}
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
              selectedZoneId={selectedZoneId}
              onZonePointerDown={handleZonePointerDown}
              onZoneReset={resetZoneGeometry}
            />
          )}

          {/* Legend bottom */}
          {mode === 'operacion' && (
            <div className="mt-4 pt-3 border-t border-line2 flex items-center justify-between text-xs flex-wrap gap-3">
              <div className="flex gap-3 flex-wrap">
                <Legend dot={STATE_STYLES.libre.bg} border={STATE_STYLES.libre.border} label={t('legendFree', { count: counts.libre })} />
                <Legend dot={STATE_STYLES.reservada.bg} border={STATE_STYLES.reservada.border} label={t('legendReserved', { count: counts.reservada })} />
                <Legend dot={STATE_STYLES.sentada.bg} border={STATE_STYLES.sentada.border} label={t('legendSeated', { count: counts.sentada })} />
                <Legend dot="#f3f4f6" border={STATE_STYLES.bloqueada.border} label={t('legendBlocked', { count: counts.bloqueada })} stripes />
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
            <>
              <EditorSidebar
                table={selectedTable}
                zones={zones}
                locations={locations}
                onPatch={(patch) => selectedTable && patchTable(selectedTable.id, patch)}
                onToggleBlock={() => selectedTable && toggleBlock(selectedTable)}
                onDelete={() => selectedTable && deleteTable(selectedTable)}
              />
              <ZoneManagerCard
                zones={zones}
                locations={locations}
                locationId={activeLocationId}
                onChanged={loadAll}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ Operation View ============

// ============ Operation View — Premium Pulido (mapa fotorealista) ============
// Renderiza un plano cenital con paredes, sombras, ventanas en zonas
// outdoor, plantas decorativas, puerta de entrada. Cada zona se dibuja
// como una "habitación" con bounding box computado a partir de las
// posiciones de las mesas. Las mesas usan posX/posY del DB para
// posicionamiento absoluto.

const PREMIUM_CANVAS_H = 580;
const ZONE_PADDING = 36;

/** Bounding box de una zona = mín/máx de las mesas dentro + padding. */
function computeZoneBox(tablesInZone: Table[]) {
  if (tablesInZone.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of tablesInZone) {
    const dims = tableDims(t);
    if (t.posX < minX) minX = t.posX;
    if (t.posY < minY) minY = t.posY;
    if (t.posX + dims.w > maxX) maxX = t.posX + dims.w;
    if (t.posY + dims.h > maxY) maxY = t.posY + dims.h;
  }
  return {
    x: Math.max(0, minX - ZONE_PADDING),
    y: Math.max(0, minY - ZONE_PADDING),
    w: maxX - minX + ZONE_PADDING * 2,
    h: maxY - minY + ZONE_PADDING * 2,
  };
}

/**
 * Recuadro de una zona: usa la geometría EXPLÍCITA si el dueño la fijó
 * (posX/posY/width/height en la zona), o la deriva de las mesas (auto).
 * Devuelve null si no hay geometría explícita ni mesas para calcularla.
 */
function zoneGeometry(
  zone: Zone,
  allTables: Table[],
): { x: number; y: number; w: number; h: number } | null {
  if (
    zone.posX != null &&
    zone.posY != null &&
    zone.width != null &&
    zone.height != null
  ) {
    return { x: zone.posX, y: zone.posY, w: zone.width, h: zone.height };
  }
  return computeZoneBox(allTables.filter((t) => t.zoneId === zone.id));
}

/** Default cuando una zona aún no tiene geometría ni mesas (placeholder editor). */
const ZONE_DEFAULT_BOX = { x: 40, y: 40, w: 182, h: 130 };
/** Tamaño mínimo de zona al redimensionar. */
const ZONE_MIN = 78;

const ZONE_WALL_STYLE: Record<string, { bg: string; border: string; dashed: boolean; emphasis: boolean; label: string }> = {
  INDOOR: {
    bg: 'rgba(34,197,94,0.04)',
    border: '#0f172a',
    dashed: false,
    emphasis: false,
    label: '#0f172a',
  },
  OUTDOOR: {
    bg: 'rgba(59,130,246,0.05)',
    border: '#0f172a',
    dashed: true, // dashed = exterior
    emphasis: false,
    label: '#0f172a',
  },
  BAR: {
    bg: 'rgba(249,115,22,0.04)',
    border: '#0f172a',
    dashed: false,
    emphasis: false,
    label: '#0f172a',
  },
  PRIVATE: {
    bg: 'rgba(139,92,246,0.06)',
    border: '#0f172a',
    dashed: false,
    emphasis: true,
    label: '#0f172a',
  },
};

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
  const t = useTranslations('app_reservations_plano');
  const STATE_LABEL_KEY: Record<MesaState, string> = {
    libre: 'stateFree',
    reservada: 'stateReserved',
    sentada: 'stateSeated',
    bloqueada: 'stateBlocked',
  };
  if (zones.length === 0 && orphanTables.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-mute">
          {t.rich('emptyNoTables', { strong: (chunks) => <strong>{chunks}</strong> })}
        </p>
      </div>
    );
  }

  // Detectar si las mesas no fueron acomodadas (todas en posición
  // default ~60,60). Avisar al user que vaya al editor.
  const stackedAtDefault = tables.length > 1 && tables.every((t) => t.posX < 80 && t.posY < 80);

  return (
    <div>
      {stackedAtDefault && (
        <div className="mb-3 rounded-lg p-3 text-xs flex items-start gap-2" style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}>
          <span className="shrink-0">💡</span>
          <div className="leading-snug">
            {t.rich('stackedWarning', { strong: (chunks) => <strong>{chunks}</strong> })}
          </div>
        </div>
      )}
      <div
        className="relative rounded-2xl overflow-hidden mx-auto"
        style={{
          background: '#fafaf9',
          backgroundImage:
            'linear-gradient(45deg, #f1f5f4 25%, transparent 25%), linear-gradient(-45deg, #f1f5f4 25%, transparent 25%)',
          backgroundSize: '20px 20px',
          height: PREMIUM_CANVAS_H,
          boxShadow: 'inset 0 0 80px rgba(0,0,0,0.04)',
        }}
      >
        {/* Paredes y plantas/ventanas de cada zona */}
        {zones.map((zone) => {
          // Geometría explícita (si el dueño la fijó) o derivada de las mesas.
          const box = zoneGeometry(zone, tables);
          if (!box) return null;
          const wallStyle = ZONE_WALL_STYLE[zone.type] ?? ZONE_WALL_STYLE.INDOOR;
          const isOutdoor = zone.type === 'OUTDOOR';
          return (
            <div key={zone.id}>
              {/* Wall + bg */}
              <div
                className="absolute"
                style={{
                  left: box.x,
                  top: box.y,
                  width: box.w,
                  height: box.h,
                  background: wallStyle.bg,
                  border: wallStyle.dashed ? `2px dashed ${wallStyle.border}` : `3px solid ${wallStyle.border}`,
                  borderRadius: 4,
                }}
              />
              {/* Etiqueta de zona */}
              <div
                className="absolute bg-white px-2 text-[10px] font-bold tracking-wider shadow-sm whitespace-nowrap"
                style={{
                  left: box.x + 12,
                  top: box.y - 9,
                  color: wallStyle.label,
                }}
              >
                {zone.name.toUpperCase()}
              </div>
              {/* Ventanas en pared exterior (sólo OUTDOOR) */}
              {isOutdoor &&
                Array.from({ length: Math.max(2, Math.floor(box.w / 80)) }).map((_, i, arr) => (
                  <div
                    key={`win-${i}`}
                    className="absolute"
                    style={{
                      left: box.x + (box.w / (arr.length + 1)) * (i + 1) - 15,
                      top: box.y - 2,
                      width: 30,
                      height: 4,
                      background: '#94a3b8',
                    }}
                  />
                ))}
              {/* Plantas decorativas en OUTDOOR */}
              {isOutdoor && (
                <>
                  <div className="absolute" style={{ left: box.x + 8, top: box.y + 10, fontSize: 14, pointerEvents: 'none' }}>
                    🌿
                  </div>
                  <div
                    className="absolute"
                    style={{
                      left: box.x + box.w - 22,
                      top: box.y + box.h - 24,
                      fontSize: 14,
                      pointerEvents: 'none',
                    }}
                  >
                    🌿
                  </div>
                </>
              )}
              {/* Corona para PRIVATE/VIP */}
              {wallStyle.emphasis && (
                <div
                  className="absolute"
                  style={{
                    left: box.x + box.w - 28,
                    top: box.y + 8,
                    fontSize: 14,
                    pointerEvents: 'none',
                  }}
                >
                  👑
                </div>
              )}
            </div>
          );
        })}

        {/* Mesas — encima de las paredes */}
        {tables.map((tbl) => {
          const dims = tableDims(tbl);
          const meta = mesaStates.get(tbl.id);
          const state = meta?.state ?? 'libre';
          const style = STATE_STYLES[state];
          const isRound = dims.isRound;
          const selected = tbl.id === selectedId;
          return (
            <button
              key={tbl.id}
              onClick={() => onSelect(tbl.id)}
              className="absolute flex flex-col items-center justify-center font-bold transition"
              style={{
                left: tbl.posX,
                top: tbl.posY,
                width: dims.w,
                height: dims.h,
                borderRadius: isRound ? '50%' : 12,
                background: style.bg,
                border: `2px solid ${selected ? '#0f172a' : style.border}`,
                color: style.text,
                boxShadow: selected
                  ? '0 0 0 3px rgba(15,23,42,0.15), 0 4px 12px rgba(0,0,0,0.12)'
                  : '0 2px 4px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.08)',
                cursor: 'pointer',
                userSelect: 'none',
              }}
              title={t('tableTitleTooltip', { number: tbl.number, state: t(STATE_LABEL_KEY[state]) })}
            >
              <span className="text-sm leading-none">{tbl.number}</span>
              <span className="text-[10px] leading-none mt-0.5 opacity-90">{tbl.seats}p</span>
            </button>
          );
        })}

        {/* Puerta de entrada */}
        <div className="absolute" style={{ bottom: 8, left: '50%', transform: 'translateX(-50%)' }}>
          <div className="flex items-center gap-1 bg-white px-3 py-1.5 rounded-full shadow-lg border border-line">
            <span className="text-xs font-bold tracking-wider text-ink">{t('entrance')}</span>
          </div>
        </div>
      </div>
    </div>
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
  const t = useTranslations('app_reservations_plano');
  if (!table) {
    return (
      <div className="card card-pad text-center py-8">
        <div className="text-3xl mb-2 opacity-60">👆</div>
        <p className="text-sm text-mute leading-snug">
          {t('sidebarEmptyOperation')}
        </p>
      </div>
    );
  }

  const meta = state ?? { state: 'libre' as MesaState, reservation: null };
  const stateMeta: Record<MesaState, { label: string; bg: string; fg: string }> = {
    libre: { label: t('stateFree'), bg: '#f1f5f9', fg: '#475569' },
    reservada: { label: t('stateReserved'), bg: '#fef3c7', fg: '#b45309' },
    sentada: { label: t('stateSeated'), bg: '#dcfce7', fg: '#15803d' },
    bloqueada: { label: t('stateBlocked'), bg: '#f3f4f6', fg: '#6b7280' },
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
        <div className="text-2xl font-extrabold m-0">{t('tableName', { number: table.number })}</div>
        <div className="text-xs text-mute mt-0.5">{t('capacityPeople', { seats: table.seats })}</div>
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
                {t('reservationTimeParty', { time: meta.reservation.time, party: meta.reservation.party })}
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
            🪑 {t('seatCustomer')}
          </button>
        )}
        {meta.state === 'sentada' && meta.reservation && (
          <button
            onClick={() => onLiberar(meta.reservation!.id)}
            className="w-full py-2.5 rounded-lg font-semibold text-white text-sm"
            style={{ background: '#15803d' }}
          >
            ✓ {t('freeTable')}
          </button>
        )}
        <button
          onClick={onBloquear}
          className="w-full py-2.5 rounded-lg font-semibold text-sm border border-line"
        >
          {table.isBlocked ? t('unblockTable') : t('blockTable')}
        </button>
      </div>

      <div className="mt-4 pt-3 border-t border-line2">
        <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-mute">
          {t('smartAssignment')}
        </div>
        <button
          className="mt-2 w-full text-left px-3 py-2 rounded-lg text-xs bg-bg2/40 text-mute italic cursor-not-allowed"
          disabled
          title={t('smartAssignmentTooltip')}
        >
          {t('smartAssignmentSoon')}
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
  selectedZoneId,
  onZonePointerDown,
  onZoneReset,
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
  selectedZoneId: string | null;
  onZonePointerDown: (e: React.PointerEvent, zone: Zone, kind: 'move' | 'resize') => void;
  onZoneReset: (zoneId: string) => void;
}) {
  const t = useTranslations('app_reservations_plano');
  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold m-0">{t('editorTitle')}</h2>
          <p className="text-[11px] text-mute mt-0.5">
            {t('editorHint')}
          </p>
        </div>
        <button onClick={onAddOpen} className="btn-primary text-sm">
          {t('addTable')}
        </button>
      </div>

      {showAddTable && (
        <form
          onSubmit={onSubmitNew}
          className="mb-3 p-3 bg-bg2/60 rounded-lg border border-line grid grid-cols-2 md:grid-cols-5 gap-2 items-end"
        >
          <div>
            <label className="label">{t('fieldNumber')}</label>
            <input
              className="input"
              value={newTable.number}
              onChange={(e) => setNewTable({ ...newTable, number: e.target.value })}
              placeholder={t('fieldNumberPlaceholder')}
              required
            />
          </div>
          <div>
            <label className="label">{t('fieldCapacity')}</label>
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
            <label className="label">{t('fieldShape')}</label>
            <select
              className="input"
              value={newTable.shape}
              onChange={(e) => setNewTable({ ...newTable, shape: e.target.value as any })}
            >
              <option value="ROUND">{t('shapeRound')}</option>
              <option value="RECT">{t('shapeRect')}</option>
              <option value="BAR">{t('shapeBar')}</option>
            </select>
          </div>
          <div>
            <label className="label">{t('fieldZone')}</label>
            <select
              className="input"
              value={newTable.zoneId}
              onChange={(e) => setNewTable({ ...newTable, zoneId: e.target.value })}
            >
              <option value="">{t('noZone')}</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-1.5">
            <button className="btn-primary text-sm justify-center flex-1">{t('create')}</button>
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
        {/* Zonas (recuadros) — detrás de las mesas. Arrastra el cuerpo para
            mover y la esquina para redimensionar. El ↺ vuelve a modo auto. */}
        {zones.map((zone) => {
          const g = zoneGeometry(zone, tables) ?? ZONE_DEFAULT_BOX;
          const ws = ZONE_WALL_STYLE[zone.type] ?? ZONE_WALL_STYLE.INDOOR;
          const sel = zone.id === selectedZoneId;
          const explicit = zone.posX != null && zone.width != null;
          return (
            <div
              key={`zone-${zone.id}`}
              onPointerDown={(e) => onZonePointerDown(e, zone, 'move')}
              style={{
                position: 'absolute',
                left: g.x,
                top: g.y,
                width: g.w,
                height: g.h,
                background: ws.bg,
                border: `2px ${ws.dashed ? 'dashed' : 'solid'} ${sel ? '#0f172a' : ws.border}`,
                borderRadius: 6,
                cursor: 'move',
                touchAction: 'none',
                boxShadow: sel ? '0 0 0 3px rgba(15,23,42,.12)' : undefined,
              }}
            >
              <div
                className="absolute bg-white px-1.5 py-0.5 text-[10px] font-bold tracking-wider shadow-sm whitespace-nowrap flex items-center gap-1 rounded"
                style={{ left: 6, top: -11, color: ws.label }}
              >
                {zone.name.toUpperCase()}
                {explicit && (
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onZoneReset(zone.id);
                    }}
                    title={t('zoneResetTitle')}
                    className="text-[11px] leading-none text-mute hover:text-ink"
                  >
                    ↺
                  </button>
                )}
              </div>
              <div
                onPointerDown={(e) => onZonePointerDown(e, zone, 'resize')}
                title={t('zoneResizeTitle')}
                style={{
                  position: 'absolute',
                  right: -1,
                  bottom: -1,
                  width: 16,
                  height: 16,
                  cursor: 'nwse-resize',
                  background: sel ? '#0f172a' : ws.border,
                  borderRadius: '4px 0 5px 0',
                  touchAction: 'none',
                }}
              />
            </div>
          );
        })}

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
  locations,
  onPatch,
  onToggleBlock,
  onDelete,
}: {
  table: Table | null;
  zones: Zone[];
  locations: Location[];
  onPatch: (patch: Partial<Table>) => void;
  onToggleBlock: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('app_reservations_plano');
  if (!table) {
    return (
      <div className="card card-pad text-center py-8">
        <p className="text-sm text-mute leading-snug">
          {t('sidebarEmptyEditor')}
        </p>
      </div>
    );
  }
  return (
    <div className="card card-pad">
      <h2 className="text-base font-semibold m-0">{t('tableName', { number: table.number })}</h2>
      <div className="mt-3 space-y-3">
        <div>
          <label className="label">{t('fieldNumberLabel')}</label>
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
          <label className="label">{t('fieldCapacity')}</label>
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
          <label className="label">{t('fieldShape')}</label>
          <select className="input" value={table.shape} onChange={(e) => onPatch({ shape: e.target.value })}>
            <option value="ROUND">{t('shapeRound')}</option>
            <option value="RECT">{t('shapeRect')}</option>
            <option value="BAR">{t('shapeBar')}</option>
          </select>
        </div>
        {locations.length > 1 && (
          <div>
            <label className="label">{t('fieldLocation')}</label>
            <select
              className="input"
              value={table.locationId ?? ''}
              // Al cambiar de sede, limpiamos la zona (las zonas son por sede).
              onChange={(e) =>
                onPatch({ locationId: e.target.value || null, zoneId: null })
              }
            >
              <option value="">{t('allLocations')}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label">{t('fieldZone')}</label>
          <select
            className="input"
            value={table.zoneId ?? ''}
            onChange={(e) => onPatch({ zoneId: e.target.value || null })}
          >
            <option value="">{t('noZone')}</option>
            {zones
              .filter((z) => !table.locationId || !z.locationId || z.locationId === table.locationId)
              .map((z) => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
          </select>
        </div>
        <button
          onClick={onToggleBlock}
          className="w-full py-2 rounded-lg text-sm border border-line"
        >
          {table.isBlocked ? t('unblock') : t('block')}
        </button>
        <button
          onClick={onDelete}
          className="w-full py-2 rounded-lg text-sm border border-bad text-bad"
        >
          🗑 {t('deleteTable')}
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

// ============ Zone Manager (Editor mode only) ============

const ZONE_TYPES = [
  { value: 'INDOOR', labelKey: 'zoneTypeIndoor' },
  { value: 'OUTDOOR', labelKey: 'zoneTypeOutdoor' },
  { value: 'BAR', labelKey: 'zoneTypeBar' },
  { value: 'PRIVATE', labelKey: 'zoneTypePrivate' },
] as const;

function ZoneManagerCard({
  zones,
  locations,
  locationId,
  onChanged,
}: {
  zones: Zone[];
  locations: Location[];
  locationId: string | null;
  onChanged: () => void;
}) {
  const t = useTranslations('app_reservations_plano');
  const [name, setName] = useState('');
  const [type, setType] = useState<'INDOOR' | 'OUTDOOR' | 'BAR' | 'PRIVATE'>('INDOOR');
  const [busy, setBusy] = useState(false);
  const multiSede = locations.length > 1;
  // R1: sede destino de la zona nueva. En multi-sede default a la sede activa o
  // la primera → no se crean zonas SIN sede.
  const [zoneLoc, setZoneLoc] = useState<string>(
    locationId || (multiSede ? locations[0]?.id ?? '' : ''),
  );
  useEffect(() => {
    if (locationId) setZoneLoc(locationId);
  }, [locationId]);

  // R1 (2026-08-01): reasignar una zona a otra sede. El backend cascadea las
  // mesas de la zona a la misma sede. Esto hace los planos independientes por
  // sede (antes todas las zonas quedaban sin sede = mezcladas).
  async function patchZoneLocation(zoneId: string, locId: string | null) {
    try {
      await api(`/reservations/zones/${zoneId}`, {
        method: 'PATCH',
        body: JSON.stringify({ locationId: locId }),
      });
      onChanged();
      toast(t('toastZoneMoved'), 'success');
    } catch (e: any) {
      toast(e.message || t('errorUpdate'), 'error');
    }
  }

  async function createZone(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api('/reservations/zones', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          type,
          locationId: (multiSede ? zoneLoc : locationId) || null,
        }),
      });
      setName('');
      onChanged();
      toast(t('toastZoneCreated'), 'success');
    } catch (e: any) {
      toast(e.message || t('errorCreate'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeZone(zoneId: string) {
    if (!confirm(t('confirmDeleteZone'))) return;
    try {
      await api(`/reservations/zones/${zoneId}`, { method: 'DELETE' });
      onChanged();
      toast(t('toastZoneDeleted'), 'success');
    } catch (e: any) {
      toast(e.message || t('errorDelete'), 'error');
    }
  }

  return (
    <div className="card card-pad">
      <h3 className="text-sm font-semibold m-0">{t('zonesTitle')}</h3>
      <p className="text-[11px] text-mute mt-0.5 mb-2 leading-snug">
        {t('zonesHint')}
      </p>
      {multiSede && zones.some((z) => !z.locationId) && (
        <div className="text-[11px] rounded-lg px-2 py-1.5 mb-2 leading-snug bg-bad-soft text-bad-ink">
          {t('assignZonesHint')}
        </div>
      )}

      {zones.length === 0 ? (
        <p className="text-xs text-mute italic mb-2">{t('noZonesYet')}</p>
      ) : (
        <ul className="space-y-1 mb-3">
          {zones.map((z) => {
            const tStyle = ZONE_BG[z.type] ?? ZONE_BG.INDOOR;
            return (
              <li
                key={z.id}
                className="flex items-center justify-between text-xs py-1.5 px-2 rounded"
                style={{ background: tStyle.bg, border: `1px solid ${tStyle.border}` }}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
                    style={{ background: tStyle.label, color: 'white' }}
                  >
                    {(() => {
                      const zt = ZONE_TYPES.find((zoneType) => zoneType.value === z.type);
                      return zt ? t(zt.labelKey) : z.type;
                    })()}
                  </span>
                  <span className="font-semibold truncate">{z.name}</span>
                  {multiSede && !z.locationId && (
                    <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-bad-soft text-bad-ink shrink-0">
                      {t('zoneSedeNone')}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  {multiSede && (
                    <select
                      className="text-[10px] rounded border border-line bg-white px-1 py-0.5 max-w-[110px]"
                      value={z.locationId ?? ''}
                      onChange={(e) => patchZoneLocation(z.id, e.target.value || null)}
                      title={t('zoneSedeTitle')}
                    >
                      <option value="">{t('zoneSedeNone')}</option>
                      {locations.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    onClick={() => removeZone(z.id)}
                    className="text-mute hover:text-bad text-base leading-none px-1"
                    title={t('deleteZone')}
                  >
                    ×
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={createZone} className="flex gap-1 flex-wrap">
        <input
          className="input text-xs flex-1"
          placeholder={t('newZonePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className="input text-xs"
          value={type}
          onChange={(e) => setType(e.target.value as any)}
          style={{ width: 100 }}
        >
          {ZONE_TYPES.map((zoneType) => (
            <option key={zoneType.value} value={zoneType.value}>
              {t(zoneType.labelKey)}
            </option>
          ))}
        </select>
        {multiSede && (
          <select
            className="input text-xs"
            value={zoneLoc}
            onChange={(e) => setZoneLoc(e.target.value)}
            style={{ width: 120 }}
            title={t('zoneSedeTitle')}
          >
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        )}
        <button className="btn-primary text-xs px-3" disabled={busy || !name.trim()}>
          +
        </button>
      </form>
    </div>
  );
}
