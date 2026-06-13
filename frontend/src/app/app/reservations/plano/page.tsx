'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

const GRID = 26;
const CANVAS_H = 520;
function snap(v: number) {
  return Math.max(0, Math.round(v / GRID) * GRID);
}
function tableDims(t: { shape: string; seats: number; width?: number | null; height?: number | null }) {
  const isRound = t.shape === 'ROUND';
  const w = t.width ?? (isRound ? (t.seats <= 2 ? 54 : t.seats <= 4 ? 66 : 80) : t.shape === 'BAR' ? 130 : 100);
  const h = t.height ?? (isRound ? w : t.shape === 'BAR' ? 50 : 60);
  return { w, h, isRound };
}

function ZoneAddForm({ onCreated, locationId }: { onCreated: () => void; locationId?: string | null }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('INDOOR');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api('/reservations/zones', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), type, locationId: locationId || null }),
      });
      setName('');
      onCreated();
      toast('Zona creada', 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo crear', 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex gap-1 mt-2">
      <input
        className="input text-xs"
        placeholder="Nueva zona"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <select
        className="input text-xs"
        value={type}
        onChange={(e) => setType(e.target.value)}
        style={{ width: 100 }}
      >
        <option value="INDOOR">Indoor</option>
        <option value="OUTDOOR">Terraza</option>
        <option value="BAR">Barra</option>
        <option value="PRIVATE">Privado</option>
      </select>
      <button className="btn-primary text-xs px-3" disabled={busy}>+</button>
    </form>
  );
}

type Location = { id: string; name: string };

type Zone = { id: string; name: string; slug: string; type: string; locationId?: string | null };
type Table = {
  id: string;
  number: string;
  seats: number;
  shape: string;
  posX: number;
  posY: number;
  width?: number | null;
  height?: number | null;
  isBlocked: boolean;
  zoneId?: string | null;
  zone?: { name: string } | null;
};
type Reservation = {
  id: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  party: number;
  date: string;
  time: string;
  notes?: string | null;
  status: 'PENDING' | 'CONFIRMED' | 'SEATED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  channel: string;
  table?: { number: string } | null;
  zone?: { name: string } | null;
  customer?: { id: string; fullName: string; tags: string[] } | null;
};

const STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
  PENDING: { label: 'Pendiente', bg: '#fff7ed', fg: '#b45309' },
  CONFIRMED: { label: 'Confirmada', bg: '#ecfdf3', fg: '#15803d' },
  SEATED: { label: 'Sentada', bg: '#eff6ff', fg: '#1d4ed8' },
  COMPLETED: { label: 'Completada', bg: '#f3f4f6', fg: '#6b7280' },
  CANCELLED: { label: 'Cancelada', bg: '#f3f4f6', fg: '#6b7280' },
  NO_SHOW: { label: 'Ausente', bg: '#fef2f2', fg: '#dc2626' },
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function PlanoPage() {
  const [tab] = useState<'agenda' | 'plano' | 'metricas'>('plano');
  const setTab = (_: any) => {};
  const [date, setDate] = useState(todayISO());
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [activeLocationId, setActiveLocationId] = useState<string>(''); // '' = todas
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    customerName: '',
    customerPhone: '',
    party: 2,
    time: '21:00',
    notes: '',
  });

  async function loadAll() {
    try {
      const locQs = activeLocationId ? `&locationId=${activeLocationId}` : '';
      const [res, zn, tb, locs] = await Promise.all([
        api<Reservation[]>(`/reservations?date=${date}${locQs}`),
        api<Zone[]>(`/reservations/zones${activeLocationId ? `?locationId=${activeLocationId}` : ''}`),
        api<Table[]>(`/reservations/tables${activeLocationId ? `?locationId=${activeLocationId}` : ''}`),
        locations.length === 0
          ? api<Location[]>('/locations').catch(() => [])
          : Promise.resolve(locations),
      ]);
      setReservations(res);
      setZones(zn);
      setTables(tb);
      if (locations.length === 0) setLocations(locs);
    } catch (e: any) {
      toast(e.message || 'Error cargando reservas', 'error');
    }
  }

  useEffect(() => {
    loadAll();
  }, [date, activeLocationId]);

  const stats = useMemo(() => {
    const pax = reservations.reduce((s, r) => s + r.party, 0);
    const cancelled = reservations.filter((r) => r.status === 'CANCELLED' || r.status === 'NO_SHOW').length;
    return { count: reservations.length, pax, cancelled };
  }, [reservations]);

  async function changeStatus(id: string, status: Reservation['status']) {
    try {
      await api(`/reservations/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      loadAll();
      toast(`Reserva marcada como ${STATUS_META[status].label.toLowerCase()}`, 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo actualizar', 'error');
    }
  }

  async function submitReservation(e: React.FormEvent) {
    e.preventDefault();
    if (!form.customerName.trim() || !form.customerPhone.trim()) {
      toast('Nombre y teléfono son obligatorios', 'error');
      return;
    }
    setCreating(true);
    try {
      await api('/reservations', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          date,
          channel: 'PHONE',
          status: 'CONFIRMED',
        }),
      });
      setForm({ customerName: '', customerPhone: '', party: 2, time: '21:00', notes: '' });
      loadAll();
      toast('Reserva creada', 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo crear', 'error');
    } finally {
      setCreating(false);
    }
  }

  // ---------- Walk-in: cliente arrived, sin reserva previa ----------
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [walkIn, setWalkIn] = useState({ customerName: '', customerPhone: '', party: 2, tableId: '' });
  const [walkInSubmitting, setWalkInSubmitting] = useState(false);

  async function submitWalkIn(e: React.FormEvent) {
    e.preventDefault();
    if (!walkIn.customerName.trim()) {
      toast('Nombre requerido', 'error');
      return;
    }
    setWalkInSubmitting(true);
    try {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      // force=true para saltar la validación de capacidad — walk-in
      // siempre debería poder sentarse aunque haya overbooking nominal
      // (el negocio ya decidió que sí).
      await api('/reservations?force=true', {
        method: 'POST',
        body: JSON.stringify({
          customerName: walkIn.customerName.trim(),
          customerPhone: walkIn.customerPhone.trim() || `walkin-${Date.now()}`,
          party: walkIn.party,
          date: todayISO(),
          time: hhmm,
          channel: 'IN_PERSON',
          status: 'SEATED',
          tableId: walkIn.tableId || null,
        }),
      });
      const hadPhone = walkIn.customerPhone.trim().length > 0;
      setWalkIn({ customerName: '', customerPhone: '', party: 2, tableId: '' });
      setWalkInOpen(false);
      loadAll();
      toast(
        hadPhone
          ? 'Walk-in registrado · sello asignado al cliente'
          : 'Walk-in registrado (sin teléfono → no se le pudo asignar sello)',
        'success',
      );
    } catch (err: any) {
      toast(err.message || 'No se pudo registrar', 'error');
    } finally {
      setWalkInSubmitting(false);
    }
  }

  // ---------- Plano: drag + create + edit ----------
  const canvasRef = useRef<HTMLDivElement>(null);
  const [newTable, setNewTable] = useState({ number: '', seats: 4, shape: 'ROUND' as 'ROUND' | 'RECT' | 'BAR', zoneId: '' });
  const [showAddTable, setShowAddTable] = useState(false);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);

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
    // Optimistic update
    setTables((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    try {
      await api(`/reservations/tables/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    } catch (e: any) {
      toast(e.message || 'No se pudo actualizar', 'error');
      loadAll();
    }
  }

  async function toggleBlock(t: Table) {
    patchTable(t.id, { isBlocked: !t.isBlocked });
  }

  async function deleteTable(t: Table) {
    if (!confirm(`Eliminar mesa "${t.number}"? Las reservas asociadas no se borran.`)) return;
    try {
      await api(`/reservations/tables/${t.id}`, { method: 'DELETE' });
      setSelectedTableId(null);
      loadAll();
      toast('Mesa eliminada', 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo eliminar', 'error');
    }
  }

  function handlePointerDown(e: React.PointerEvent, t: Table) {
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
    // Persist final position
    api(`/reservations/tables/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ posX: t.posX, posY: t.posY }),
    }).catch((err: any) => {
      toast(err.message || 'No se pudo guardar la posición', 'error');
      loadAll();
    });
  }

  const selectedTable = tables.find((t) => t.id === selectedTableId) || null;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Reservas <span className="page-crumb">/ {date}</span></h1>
        <div className="flex gap-2 items-center flex-wrap">
          {locations.length > 1 && (
            <select
              value={activeLocationId}
              onChange={(e) => setActiveLocationId(e.target.value)}
              className="input text-sm"
              style={{ width: 'auto' }}
              title="Filtrar por sede"
            >
              <option value="">📍 Todas las sedes</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  📍 {loc.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => setWalkInOpen(true)}
            className="btn-primary text-sm"
            style={{ background: '#1d4ed8' }}
            title="Cliente que llegó sin reserva previa"
          >
            🚶 Walk-in
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input text-sm"
            style={{ width: 'auto' }}
          />
        </div>
      </div>

      {walkInOpen && (
        <div className="card card-pad mb-4 border-2" style={{ borderColor: '#1d4ed8' }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold m-0">🚶 Registrar walk-in</h2>
            <button onClick={() => setWalkInOpen(false)} className="text-mute hover:text-ink">
              ✕
            </button>
          </div>
          <p className="text-xs text-mute mb-3">
            Cliente llegó sin reserva previa. Queda marcado como{' '}
            <strong>SEATED</strong> al toque y recibe sello de fidelización
            automáticamente.
          </p>
          <form onSubmit={submitWalkIn} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
            <div>
              <label className="label">Nombre</label>
              <input
                className="input"
                value={walkIn.customerName}
                onChange={(e) => setWalkIn({ ...walkIn, customerName: e.target.value })}
                placeholder="Juan Pérez"
                required
              />
            </div>
            <div>
              <label className="label">Teléfono (opcional)</label>
              <input
                className="input"
                value={walkIn.customerPhone}
                onChange={(e) => setWalkIn({ ...walkIn, customerPhone: e.target.value })}
                placeholder="+52 55..."
              />
            </div>
            <div>
              <label className="label">Pax</label>
              <input
                type="number"
                min={1}
                max={20}
                className="input"
                value={walkIn.party}
                onChange={(e) => setWalkIn({ ...walkIn, party: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className="label">Mesa (opcional)</label>
              <select
                className="input"
                value={walkIn.tableId}
                onChange={(e) => setWalkIn({ ...walkIn, tableId: e.target.value })}
              >
                <option value="">Sin asignar</option>
                {tables.filter((t) => !t.isBlocked).map((t) => (
                  <option key={t.id} value={t.id}>
                    Mesa {t.number} · {t.seats}p
                  </option>
                ))}
              </select>
            </div>
            <button className="btn-primary text-sm justify-center" disabled={walkInSubmitting}>
              {walkInSubmitting ? 'Sentando…' : 'Sentar walk-in'}
            </button>
          </form>
        </div>
      )}

      {/* Tabs ocultos: la navegación se hace desde el sidebar */}
      <div className="hidden">
        {([
          { v: 'agenda' as const, label: '📅 Agenda', count: stats.count },
          { v: 'plano' as const, label: '🪑 Plano', count: tables.length },
          { v: 'metricas' as const, label: '📊 Métricas', count: null as number | null },
        ]).map((tb) => {
          const active = tab === tb.v;
          return (
            <button
              key={tb.v}
              onClick={() => setTab(tb.v)}
              className={`${active ? '' : ''}`}
            >
              {tb.label}
            </button>
          );
        })}
      </div>

      {tab === 'agenda' && (
        <div className="grid lg:grid-cols-[1fr_320px] gap-4">
          <div className="card card-pad">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold m-0">Reservas del día</h2>
              <div className="flex gap-3 text-xs text-mute">
                <span><strong className="text-ink">{stats.count}</strong> reservas</span>
                <span><strong className="text-ink">{stats.pax}</strong> pax</span>
                <span><strong className="text-bad">{stats.cancelled}</strong> ausencias</span>
              </div>
            </div>
            {reservations.length === 0 ? (
              <p className="text-sm text-mute py-6 text-center">
                Sin reservas para este día. Las nuevas reservas del flujo público aparecerán aquí.
              </p>
            ) : (
              <div className="space-y-2">
                {reservations.map((r) => {
                  const sm = STATUS_META[r.status];
                  return (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 p-3 rounded-lg border border-line bg-white"
                    >
                      <div className="w-14 text-center shrink-0">
                        <div className="text-sm font-bold">{r.time}</div>
                        <div className="text-[10px] text-mute">{r.channel}</div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{r.customerName}</div>
                        <div className="text-xs text-mute">
                          {r.party} pax · {r.customerPhone}
                          {r.table?.number && ` · Mesa ${r.table.number}`}
                          {r.zone?.name && ` · ${r.zone.name}`}
                        </div>
                        {r.notes && (
                          <div className="text-[11px] text-mute mt-1 italic line-clamp-1">{r.notes}</div>
                        )}
                      </div>
                      <span
                        className="text-[11px] font-bold px-2 py-1 rounded"
                        style={{ background: sm.bg, color: sm.fg }}
                      >
                        {sm.label}
                      </span>
                      <select
                        value={r.status}
                        onChange={(e) => changeStatus(r.id, e.target.value as Reservation['status'])}
                        className="text-[11px] border border-line rounded px-2 py-1 bg-white"
                      >
                        {Object.entries(STATUS_META).map(([v, m]) => (
                          <option key={v} value={v}>{m.label}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <form onSubmit={submitReservation} className="card card-pad self-start">
            <h2 className="text-base font-semibold m-0">Nueva reserva</h2>
            <p className="text-xs text-mute mt-1">Carga manual desde el panel.</p>
            <div className="mt-3 space-y-2">
              <div>
                <label className="label">Nombre</label>
                <input
                  className="input"
                  value={form.customerName}
                  onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label">Teléfono</label>
                <input
                  className="input"
                  value={form.customerPhone}
                  onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
                  required
                  placeholder="+52 55 0000 0000"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">Pax</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    className="input"
                    value={form.party}
                    onChange={(e) => setForm({ ...form, party: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="label">Hora</label>
                  <input
                    type="time"
                    className="input"
                    value={form.time}
                    onChange={(e) => setForm({ ...form, time: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="label">Notas (opcional)</label>
                <textarea
                  className="input"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
            </div>
            <button className="btn-primary mt-3 w-full justify-center" disabled={creating}>
              {creating ? 'Creando…' : 'Crear reserva'}
            </button>
          </form>
        </div>
      )}

      {tab === 'plano' && (
        <div className="grid lg:grid-cols-[1fr_300px] gap-4">
          <div className="card card-pad">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-base font-semibold m-0">Plano de mesas</h2>
                <p className="text-[11px] text-mute mt-0.5">
                  Arrastrá las mesas para reorganizar el plano. Los cambios se guardan al soltar.
                </p>
              </div>
              <button onClick={() => setShowAddTable((v) => !v)} className="btn-primary text-sm">
                <Icon name="plus" /> Mesa
              </button>
            </div>

            {showAddTable && (
              <form onSubmit={createTable} className="mb-3 p-3 bg-bg2/60 rounded-lg border border-line grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
                <div>
                  <label className="label">Número/etiqueta</label>
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
                <button className="btn-primary text-sm justify-center">Crear</button>
              </form>
            )}

            {tables.length === 0 ? (
              <p className="text-sm text-mute py-10 text-center">
                Aún no hay mesas. Creá la primera con el botón de arriba.
              </p>
            ) : (
              <div
                ref={canvasRef}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                className="relative bg-bg2/40 border border-line rounded-lg overflow-hidden touch-none"
                style={{
                  height: CANVAS_H,
                  backgroundImage: 'linear-gradient(#eef1f3 1px, transparent 1px), linear-gradient(90deg, #eef1f3 1px, transparent 1px)',
                  backgroundSize: `${GRID}px ${GRID}px`,
                }}
              >
                {tables.map((t) => {
                  const { w, h, isRound } = tableDims(t);
                  const sel = t.id === selectedTableId;
                  return (
                    <div
                      key={t.id}
                      onPointerDown={(e) => handlePointerDown(e, t)}
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
            )}
          </div>

          <div className="space-y-4 self-start">
          <div className="card card-pad">
            <h2 className="text-base font-semibold m-0">
              {selectedTable ? `Mesa ${selectedTable.number}` : 'Detalles de mesa'}
            </h2>
            {selectedTable ? (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="label">Número/etiqueta</label>
                  <input
                    className="input"
                    defaultValue={selectedTable.number}
                    key={selectedTable.id}
                    onBlur={(e) => {
                      if (e.target.value.trim() && e.target.value !== selectedTable.number) {
                        patchTable(selectedTable.id, { number: e.target.value.trim() });
                      }
                    }}
                  />
                </div>
                <div>
                  <label className="label">Capacidad (pax)</label>
                  <input
                    type="number"
                    className="input"
                    min={1}
                    max={40}
                    value={selectedTable.seats}
                    onChange={(e) => patchTable(selectedTable.id, { seats: Math.max(1, Math.min(40, Number(e.target.value) || 1)) })}
                  />
                </div>
                <div>
                  <label className="label">Forma</label>
                  <select
                    className="input"
                    value={selectedTable.shape}
                    onChange={(e) => patchTable(selectedTable.id, { shape: e.target.value })}
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
                    value={selectedTable.zoneId ?? ''}
                    onChange={(e) => patchTable(selectedTable.id, { zoneId: e.target.value || null })}
                  >
                    <option value="">Sin zona</option>
                    {zones.map((z) => (
                      <option key={z.id} value={z.id}>{z.name}</option>
                    ))}
                  </select>
                </div>
                <div className="text-xs">
                  Estado:{' '}
                  {selectedTable.isBlocked ? (
                    <span className="text-bad font-semibold">Bloqueada</span>
                  ) : (
                    <span className="text-ok font-semibold">Disponible</span>
                  )}
                </div>
                <button
                  onClick={() => toggleBlock(selectedTable)}
                  className="btn-ghost w-full justify-center text-sm"
                >
                  {selectedTable.isBlocked ? '▶ Desbloquear' : '⏸ Bloquear mesa'}
                </button>
                <button
                  onClick={() => deleteTable(selectedTable)}
                  className="w-full justify-center text-sm py-2 rounded-lg border border-bad text-bad hover:bg-bad-soft"
                >
                  🗑 Eliminar mesa
                </button>
              </div>
            ) : (
              <p className="text-sm text-mute mt-2">
                Tocá una mesa para ver sus detalles o arrastrala para reposicionarla.
              </p>
            )}

          </div>
          <div className="card card-pad">
            <h3 className="text-sm font-semibold m-0">Zonas</h3>
            <p className="text-[11px] text-mute mt-0.5 mb-2">
              Salón, Terraza, Barra, VIP... el cliente puede elegir al reservar.
            </p>
            {zones.length === 0 ? (
              <p className="text-xs text-mute italic">Sin zonas todavía.</p>
            ) : (
              <ul className="space-y-1 mb-2">
                {zones.map((z) => (
                  <li key={z.id} className="flex items-center justify-between text-xs py-1.5 px-2 bg-bg2/60 rounded">
                    <span className="font-semibold">{z.name}</span>
                    <span className="text-mute text-[10px]">{z.type}</span>
                  </li>
                ))}
              </ul>
            )}
            <ZoneAddForm onCreated={loadAll} locationId={activeLocationId} />
          </div>
          </div>
        </div>
      )}

      {tab === 'metricas' && <MetricsTab />}
    </div>
  );
}

function MetricsTab() {
  const [stats, setStats] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<'7d' | '30d' | '90d'>('30d');

  useEffect(() => {
    const now = new Date();
    const daysBack = range === '7d' ? 7 : range === '30d' ? 30 : 90;
    const from = new Date(now);
    from.setDate(from.getDate() - daysBack);
    const to = new Date(now);
    to.setDate(to.getDate() + 7); // incluye próximos 7 días
    const f = from.toISOString().slice(0, 10);
    const t = to.toISOString().slice(0, 10);
    api<any>(`/reservations/stats?from=${f}&to=${t}`)
      .then(setStats)
      .catch((e: any) => setError(e.message || 'Error'));
  }, [range]);

  if (error) {
    return <p className="text-sm text-bad py-6 text-center">{error}</p>;
  }
  if (!stats) {
    return <p className="text-sm text-mute py-6 text-center">Cargando métricas…</p>;
  }

  const DOW_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const maxDow = Math.max(1, ...Object.values<number>(stats.byDow));
  const maxZone = Math.max(1, ...stats.zoneBreakdown.map((z: any) => z.pax));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-mute">
          Rango: <strong className="text-ink">{stats.range.from}</strong> →{' '}
          <strong className="text-ink">{stats.range.to}</strong> ({stats.range.days} días)
        </div>
        <div className="flex gap-1 bg-bg2 p-1 rounded-lg">
          {(['7d', '30d', '90d'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-md ${
                range === r ? 'bg-white text-ink shadow-sm' : 'text-mute'
              }`}
            >
              {r === '7d' ? '7 días' : r === '30d' ? '30 días' : '90 días'}
            </button>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card card-pad">
          <div className="text-xs text-mute font-bold">RESERVAS</div>
          <div className="text-2xl font-extrabold mt-1">{stats.totals.reservations}</div>
          <div className="text-xs text-mute mt-1">{stats.totals.pax} pax · {stats.totals.avgParty} prom</div>
        </div>
        <div className="card card-pad">
          <div className="text-xs text-mute font-bold">COMPLETION</div>
          <div className="text-2xl font-extrabold mt-1 text-ok">{stats.rates.completionRate}%</div>
          <div className="text-xs text-mute mt-1">{stats.totals.completed} completadas</div>
        </div>
        <div className="card card-pad">
          <div className="text-xs text-mute font-bold">NO-SHOW</div>
          <div className={`text-2xl font-extrabold mt-1 ${stats.rates.noShowRate > 15 ? 'text-bad' : ''}`}>
            {stats.rates.noShowRate}%
          </div>
          <div className="text-xs text-mute mt-1">{stats.totals.noShow} ausentes</div>
        </div>
        <div className="card card-pad">
          <div className="text-xs text-mute font-bold">CANCELACIONES</div>
          <div className="text-2xl font-extrabold mt-1">{stats.rates.cancelRate}%</div>
          <div className="text-xs text-mute mt-1">{stats.totals.cancelled} canceladas</div>
        </div>
      </div>

      {/* Estado breakdown */}
      <div className="card card-pad">
        <h3 className="text-sm font-semibold m-0 mb-3">Estado de las reservas</h3>
        <div className="space-y-2">
          {[
            { label: 'Pendientes', val: stats.totals.pending, color: '#b45309' },
            { label: 'Confirmadas', val: stats.totals.confirmed, color: '#1d4ed8' },
            { label: 'Completadas', val: stats.totals.completed, color: '#15803d' },
            { label: 'Canceladas', val: stats.totals.cancelled, color: '#6b7280' },
            { label: 'Ausentes', val: stats.totals.noShow, color: '#dc2626' },
          ].map((s) => {
            const pct = stats.totals.reservations > 0
              ? Math.round((s.val / stats.totals.reservations) * 100)
              : 0;
            return (
              <div key={s.label} className="flex items-center gap-3">
                <div className="text-xs font-semibold w-24">{s.label}</div>
                <div className="flex-1 h-5 bg-bg2 rounded overflow-hidden">
                  <div
                    className="h-full transition-all"
                    style={{ width: `${pct}%`, background: s.color }}
                  />
                </div>
                <div className="text-xs text-mute w-16 text-right">
                  {s.val} ({pct}%)
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Top horarios */}
        <div className="card card-pad">
          <h3 className="text-sm font-semibold m-0 mb-3">Horarios más solicitados</h3>
          {stats.topHours.length === 0 ? (
            <p className="text-xs text-mute italic">Sin datos en este rango</p>
          ) : (
            <div className="space-y-2">
              {stats.topHours.map((h: any) => {
                const max = stats.topHours[0].pax;
                const pct = Math.round((h.pax / max) * 100);
                return (
                  <div key={h.hour} className="flex items-center gap-3">
                    <div className="text-sm font-semibold w-14">{h.hour}</div>
                    <div className="flex-1 h-4 bg-bg2 rounded overflow-hidden">
                      <div className="h-full bg-ok" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="text-xs text-mute w-12 text-right">{h.pax} pax</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Día de la semana */}
        <div className="card card-pad">
          <h3 className="text-sm font-semibold m-0 mb-3">Pax por día de la semana</h3>
          <div className="grid grid-cols-7 gap-1 items-end h-32 mt-2">
            {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
              const pax = stats.byDow[dow] || 0;
              const h = Math.round((pax / maxDow) * 100);
              return (
                <div key={dow} className="flex flex-col items-center gap-1 h-full justify-end">
                  <div className="text-[10px] font-bold text-mute">{pax}</div>
                  <div
                    className="w-full bg-ok rounded-t transition-all"
                    style={{ height: `${Math.max(2, h)}%` }}
                  />
                  <div className="text-[10px] font-bold text-mute">{DOW_LABELS[dow]}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Zonas y canales */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card card-pad">
          <h3 className="text-sm font-semibold m-0 mb-3">Top zonas</h3>
          {stats.zoneBreakdown.length === 0 ? (
            <p className="text-xs text-mute italic">Sin datos</p>
          ) : (
            <div className="space-y-2">
              {stats.zoneBreakdown.map((z: any) => {
                const pct = Math.round((z.pax / maxZone) * 100);
                return (
                  <div key={z.name} className="flex items-center gap-3">
                    <div className="text-sm font-semibold w-24 truncate">{z.name}</div>
                    <div className="flex-1 h-4 bg-bg2 rounded overflow-hidden">
                      <div className="h-full bg-info" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="text-xs text-mute w-16 text-right">
                      {z.pax} pax
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card card-pad">
          <h3 className="text-sm font-semibold m-0 mb-3">Canal de origen</h3>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(stats.byChannel).map(([ch, n]) => (
              <div key={ch} className="p-3 rounded-lg bg-bg2/60 text-center">
                <div className="text-xs text-mute font-bold">{ch}</div>
                <div className="text-lg font-extrabold">{n as number}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
