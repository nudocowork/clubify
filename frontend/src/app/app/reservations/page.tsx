'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

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

  async function createTable() {
    const number = prompt('Número o etiqueta de la mesa (ej: 1, 12, VIP, Barra)');
    if (!number) return;
    const seatsStr = prompt('Capacidad (personas)', '4');
    const seats = Math.max(1, Math.min(40, Number(seatsStr) || 4));
    try {
      await api('/reservations/tables', {
        method: 'POST',
        body: JSON.stringify({ number, seats, posX: 60, posY: 60 }),
      });
      loadAll();
      toast('Mesa creada', 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo crear', 'error');
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
        <div className="grid lg:grid-cols-[1fr_280px] gap-4">
          <div className="card card-pad">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold m-0">Plano de mesas</h2>
              <button onClick={createTable} className="btn-primary text-sm">
                <Icon name="plus" /> Mesa
              </button>
            </div>
            {tables.length === 0 ? (
              <p className="text-sm text-mute py-10 text-center">
                Aún no hay mesas. Creá la primera con el botón de arriba.
              </p>
            ) : (
              <div
                className="relative bg-bg2/40 border border-line rounded-lg"
                style={{ height: 480, backgroundImage: 'linear-gradient(#eef1f3 1px, transparent 1px), linear-gradient(90deg, #eef1f3 1px, transparent 1px)', backgroundSize: '26px 26px' }}
              >
                {tables.map((t) => {
                  const isRound = t.shape === 'ROUND';
                  const w = t.width ?? (isRound ? (t.seats <= 2 ? 54 : t.seats <= 4 ? 66 : 80) : 100);
                  const h = t.height ?? (isRound ? w : 60);
                  const sel = t.id === selectedTableId;
                  return (
                    <div
                      key={t.id}
                      onClick={() => setSelectedTableId(t.id)}
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
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: t.isBlocked ? '#9ca3af' : '#15803d',
                        userSelect: 'none',
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
          <div className="card card-pad self-start">
            <h2 className="text-base font-semibold m-0">
              {selectedTable ? `Mesa ${selectedTable.number}` : 'Detalles de mesa'}
            </h2>
            {selectedTable ? (
              <div className="mt-3 space-y-3">
                <div className="text-sm">
                  <span className="text-mute">Capacidad:</span> <strong>{selectedTable.seats} pax</strong>
                </div>
                <div className="text-sm">
                  <span className="text-mute">Zona:</span> {selectedTable.zone?.name ?? '—'}
                </div>
                <div className="text-sm">
                  <span className="text-mute">Estado:</span>{' '}
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
              </div>
            ) : (
              <p className="text-sm text-mute mt-2">
                Tocá una mesa para ver sus detalles.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
