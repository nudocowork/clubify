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

function ZoneAddForm({ onCreated }: { onCreated: () => void }) {
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
        body: JSON.stringify({ name: name.trim(), type }),
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

type Zone = { id: string; name: string; slug: string; type: string };
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

export default function ReservationsPage() {
  const [tab, setTab] = useState<'agenda' | 'plano'>('agenda');
  const [date, setDate] = useState(todayISO());
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
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
      const [res, zn, tb] = await Promise.all([
        api<Reservation[]>(`/reservations?date=${date}`),
        api<Zone[]>(`/reservations/zones`),
        api<Table[]>(`/reservations/tables`),
      ]);
      setReservations(res);
      setZones(zn);
      setTables(tb);
    } catch (e: any) {
      toast(e.message || 'Error cargando reservas', 'error');
    }
  }

  useEffect(() => {
    loadAll();
  }, [date]);

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
        <div className="flex gap-2 items-center">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input text-sm"
            style={{ width: 'auto' }}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-bg2 p-1 rounded-lg mb-4 w-fit">
        {([
          { v: 'agenda' as const, label: '📅 Agenda', count: stats.count },
          { v: 'plano' as const, label: '🪑 Plano', count: tables.length },
        ]).map((tb) => {
          const active = tab === tb.v;
          return (
            <button
              key={tb.v}
              onClick={() => setTab(tb.v)}
              className={`text-sm font-semibold px-4 py-2 rounded-md transition flex items-center gap-2 ${
                active ? 'bg-white text-ink shadow-sm' : 'text-mute hover:text-ink'
              }`}
            >
              {tb.label}
              <span className="text-[10px] font-bold bg-bg2 text-mute px-1.5 py-0.5 rounded">
                {tb.count}
              </span>
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
            <ZoneAddForm onCreated={loadAll} />
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
