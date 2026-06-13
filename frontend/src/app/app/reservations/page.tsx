'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import {
  Reservation,
  Location,
  Zone,
  Table,
  STATUS_META,
  LABEL_COLORS,
  todayISO,
  initials,
  avatarColor,
  channelMeta,
  reservationShift,
  fmtLongDate,
} from './_shared';

type DailyKpis = {
  date: string;
  reservations: { count: number; delta: number };
  pax: { expected: number };
  occupancy: { percent: number; peakHour: string | null };
  noShow: { count: number; percent: number };
};

export default function AgendaPage() {
  const [date, setDate] = useState(todayISO());
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [kpis, setKpis] = useState<DailyKpis | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [activeLocationId, setActiveLocationId] = useState<string>('');
  const [shift, setShift] = useState<'todos' | 'diurno' | 'tarde' | 'noche'>('todos');
  const [search, setSearch] = useState('');
  const [tables, setTables] = useState<Table[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);

  // Walk-in
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [walkIn, setWalkIn] = useState({ customerName: '', customerPhone: '', party: 2, tableId: '' });
  const [walkInBusy, setWalkInBusy] = useState(false);

  // Nueva reserva (modal)
  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState({
    customerName: '',
    customerPhone: '',
    party: 2,
    time: '21:00',
    notes: '',
    zoneId: '',
  });
  const [newBusy, setNewBusy] = useState(false);

  async function loadAll() {
    try {
      const locQs = activeLocationId ? `&locationId=${activeLocationId}` : '';
      const [res, kp, locs, zn, tb] = await Promise.all([
        api<Reservation[]>(`/reservations?date=${date}${locQs}`),
        api<DailyKpis>(`/reservations/daily-kpis?date=${date}${locQs}`),
        locations.length === 0 ? api<Location[]>('/locations').catch(() => []) : Promise.resolve(locations),
        api<Zone[]>(`/reservations/zones${activeLocationId ? `?locationId=${activeLocationId}` : ''}`),
        api<Table[]>(`/reservations/tables${activeLocationId ? `?locationId=${activeLocationId}` : ''}`),
      ]);
      setReservations(res);
      setKpis(kp);
      setZones(zn);
      setTables(tb);
      if (locations.length === 0) setLocations(locs);
    } catch (e: any) {
      toast(e.message || 'Error cargando agenda', 'error');
    }
  }
  useEffect(() => {
    loadAll();
  }, [date, activeLocationId]);

  const filtered = useMemo(() => {
    return reservations.filter((r) => {
      if (shift !== 'todos' && reservationShift(r.time) !== shift) return false;
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const hay =
          r.customerName.toLowerCase().includes(q) ||
          r.customerPhone.includes(q) ||
          (r.table?.number ?? '').toLowerCase().includes(q);
        if (!hay) return false;
      }
      return true;
    });
  }, [reservations, shift, search]);

  async function changeStatus(id: string, status: Reservation['status']) {
    try {
      await api(`/reservations/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      loadAll();
      toast(`Reserva marcada como ${STATUS_META[status].label.toLowerCase()}`, 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo actualizar', 'error');
    }
  }

  async function submitWalkIn(e: React.FormEvent) {
    e.preventDefault();
    if (!walkIn.customerName.trim()) {
      toast('Nombre requerido', 'error');
      return;
    }
    setWalkInBusy(true);
    try {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
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
      setWalkInBusy(false);
    }
  }

  async function submitNew(e: React.FormEvent) {
    e.preventDefault();
    if (!newForm.customerName.trim() || !newForm.customerPhone.trim()) {
      toast('Nombre y teléfono son obligatorios', 'error');
      return;
    }
    setNewBusy(true);
    try {
      await api('/reservations', {
        method: 'POST',
        body: JSON.stringify({
          ...newForm,
          date,
          channel: 'PHONE',
          status: 'CONFIRMED',
          zoneId: newForm.zoneId || null,
        }),
      });
      setNewForm({ customerName: '', customerPhone: '', party: 2, time: '21:00', notes: '', zoneId: '' });
      setNewOpen(false);
      loadAll();
      toast('Reserva creada', 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo crear', 'error');
    } finally {
      setNewBusy(false);
    }
  }

  const shiftCounts = useMemo(() => {
    const counts = { diurno: 0, tarde: 0, noche: 0 };
    reservations.forEach((r) => {
      counts[reservationShift(r.time)]++;
    });
    return counts;
  }, [reservations]);

  const whatsappCount = useMemo(
    () => reservations.filter((r) => ['WHATSAPP', 'WEB', 'QR'].includes(r.channel)).length,
    [reservations],
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="page-title m-0">
            Reservas <span className="page-crumb text-mute font-normal">/ {fmtLongDate(date)}</span>
          </h1>
          <p className="text-xs text-mute mt-1">Agenda y operación del servicio de hoy</p>
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
                <option key={loc.id} value={loc.id}>
                  📍 {loc.name}
                </option>
              ))}
            </select>
          )}
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar"
            className="input text-sm"
            style={{ width: 160 }}
          />
          <button
            onClick={() => setWalkInOpen(true)}
            className="text-sm font-semibold px-3 py-2 rounded-pill text-white"
            style={{ background: '#1d4ed8' }}
            title="Cliente sin reserva previa"
          >
            🚶 Walk-in
          </button>
          <button onClick={() => setNewOpen(true)} className="btn-primary text-sm">
            + Nueva reserva
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

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <KpiCard
          label="Reservas hoy"
          value={kpis?.reservations.count ?? 0}
          valueColor="#15803d"
          sub={
            kpis && kpis.reservations.delta !== 0
              ? `${kpis.reservations.delta > 0 ? '+' : ''}${kpis.reservations.delta} vs. ayer`
              : 'Sin cambio vs. ayer'
          }
          icon="📅"
        />
        <KpiCard
          label="Comensales"
          value={kpis?.pax.expected ?? 0}
          valueColor="#1d4ed8"
          sub="Pax esperados"
          icon="👥"
        />
        <KpiCard
          label="Ocupación"
          value={`${kpis?.occupancy.percent ?? 0}%`}
          valueColor="#b45309"
          sub={kpis?.occupancy.peakHour ? `Pico ${kpis.occupancy.peakHour}` : 'Sin picos calculados'}
          icon="📈"
        />
        <KpiCard
          label="Ausencias"
          value={kpis?.noShow.count ?? 0}
          valueColor="#dc2626"
          sub={`${kpis?.noShow.percent ?? 0}% del total`}
          icon="⏰"
        />
      </div>

      <div className="grid lg:grid-cols-[1fr_340px] gap-4">
        {/* Reservas del día */}
        <div className="card card-pad">
          <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
            <div>
              <div className="text-[10px] text-mute font-semibold tracking-[0.18em] uppercase">
                Reservas del día
              </div>
              <h2 className="text-lg font-bold m-0 mt-0.5">
                Agenda · {filtered.length} reserva{filtered.length === 1 ? '' : 's'}
              </h2>
            </div>
            <div className="flex gap-1 bg-bg2 p-1 rounded-lg text-xs">
              {([
                { v: 'todos' as const, label: 'Todos', count: reservations.length },
                { v: 'diurno' as const, label: 'Diurno', count: shiftCounts.diurno },
                { v: 'tarde' as const, label: 'Tarde', count: shiftCounts.tarde },
                { v: 'noche' as const, label: 'Noche', count: shiftCounts.noche },
              ]).map((s) => (
                <button
                  key={s.v}
                  onClick={() => setShift(s.v)}
                  className={`px-3 py-1.5 rounded-md font-semibold transition ${
                    shift === s.v ? 'bg-white text-ink shadow-sm' : 'text-mute hover:text-ink'
                  }`}
                >
                  {s.label}
                  {s.count > 0 && (
                    <span className="ml-1 opacity-60 text-[10px]">{s.count}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-mute py-10 text-center">
              {reservations.length === 0
                ? 'Sin reservas para este día. Las nuevas reservas del flujo público aparecerán aquí.'
                : 'Sin resultados con los filtros actuales.'}
            </p>
          ) : (
            <div className="hidden md:grid grid-cols-[80px_1fr_60px_120px_140px] gap-3 text-[10px] uppercase tracking-wider text-mute font-bold border-b border-line2 pb-2 mb-2">
              <span>Hora</span>
              <span>Cliente</span>
              <span className="text-center">Pax</span>
              <span>Mesa</span>
              <span className="text-right">Estado</span>
            </div>
          )}

          <div className="space-y-1">
            {filtered.map((r) => {
              const sm = STATUS_META[r.status];
              const ch = channelMeta(r.channel);
              const primaryLabel = r.labels?.[0];
              return (
                <div
                  key={r.id}
                  className="grid grid-cols-[80px_1fr_60px_120px_140px] gap-3 items-center p-2 rounded-lg hover:bg-bg2/60 transition"
                >
                  <div className="text-sm">
                    <div className="font-bold">{r.time}</div>
                    <div className="text-[10px] text-mute flex items-center gap-1">
                      <span>{ch.icon}</span>
                      <span className="truncate">{ch.label}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                      style={{ background: avatarColor(r.customerName) }}
                    >
                      {initials(r.customerName)}
                    </div>
                    <div className="min-w-0">
                      <Link
                        href={r.customer?.id ? `/app/customers/${r.customer.id}` : '#'}
                        className="text-sm font-semibold truncate hover:underline block"
                      >
                        {r.customerName}
                      </Link>
                      {primaryLabel && (
                        <span
                          className="inline-block text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5"
                          style={{
                            background: LABEL_COLORS[primaryLabel]?.bg ?? '#f3f4f6',
                            color: LABEL_COLORS[primaryLabel]?.fg ?? '#6b7280',
                          }}
                        >
                          {primaryLabel}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-sm text-center">{r.party} pax</div>
                  <div className="text-sm truncate">
                    {r.table?.number ? `Mesa ${r.table.number}` : (
                      <span className="text-mute italic">Sin asignar</span>
                    )}
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ background: sm.dot }}
                      />
                      <span style={{ color: sm.fg }}>{sm.label}</span>
                    </span>
                    <select
                      value={r.status}
                      onChange={(e) => changeStatus(r.id, e.target.value as Reservation['status'])}
                      className="text-[10px] border border-line rounded px-1.5 py-0.5 bg-white"
                      title="Cambiar estado"
                    >
                      {Object.entries(STATUS_META).map(([v, m]) => (
                        <option key={v} value={v}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Sidebar derecho: Aviso al negocio + Cómo se confirma */}
        <div className="space-y-3">
          <div
            className="rounded-2xl p-5 text-white"
            style={{ background: 'linear-gradient(155deg, #064e3b, #022c1f)' }}
          >
            <div className="text-[10px] font-bold tracking-[0.18em] uppercase opacity-80 flex items-center gap-1">
              💬 Aviso al negocio
            </div>
            <div className="font-semibold text-sm mt-2 opacity-95">Reservas avisadas hoy</div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-4xl font-extrabold">{whatsappCount}</span>
              <span className="text-sm opacity-80">por WhatsApp</span>
            </div>
            <p className="text-xs opacity-80 mt-2 leading-relaxed">
              El cliente <strong>no recibe SMS</strong> hasta que tu equipo confirma manualmente. El
              aviso con los datos llega a tu WhatsApp configurado.
            </p>
            <Link
              href="/app/settings"
              className="block mt-3 text-center bg-white/15 hover:bg-white/25 backdrop-blur rounded-lg py-2 text-sm font-semibold transition"
            >
              Configurar número receptor
            </Link>
          </div>

          <div className="card card-pad">
            <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-mute mb-3">
              Cómo se confirma
            </div>
            <ol className="space-y-3 text-sm">
              {[
                'El cliente reserva online desde la web de Clubify.',
                'Tu negocio recibe el aviso por WhatsApp y push con todos los datos.',
                'Tu equipo confirma y contacta al cliente manualmente.',
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-ok-soft text-ok-ink text-xs font-bold flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  <span className="text-sm leading-snug">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      {/* Modal Walk-in */}
      {walkInOpen && (
        <Modal title="🚶 Registrar walk-in" onClose={() => setWalkInOpen(false)}>
          <p className="text-xs text-mute mb-3">
            Cliente llegó sin reserva previa. Queda como <strong>SEATED</strong> al instante y
            recibe sello de fidelización si tiene teléfono.
          </p>
          <form onSubmit={submitWalkIn} className="space-y-2">
            <Input
              label="Nombre"
              required
              value={walkIn.customerName}
              onChange={(v) => setWalkIn({ ...walkIn, customerName: v })}
            />
            <Input
              label="Teléfono (opcional)"
              value={walkIn.customerPhone}
              onChange={(v) => setWalkIn({ ...walkIn, customerPhone: v })}
            />
            <div className="grid grid-cols-2 gap-2">
              <NumberInput
                label="Pax"
                min={1}
                max={20}
                value={walkIn.party}
                onChange={(v) => setWalkIn({ ...walkIn, party: v })}
              />
              <div>
                <label className="label">Mesa</label>
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
            </div>
            <button className="btn-primary w-full justify-center" disabled={walkInBusy}>
              {walkInBusy ? 'Sentando…' : 'Sentar walk-in'}
            </button>
          </form>
        </Modal>
      )}

      {/* Modal Nueva reserva */}
      {newOpen && (
        <Modal title="+ Nueva reserva" onClose={() => setNewOpen(false)}>
          <p className="text-xs text-mute mb-3">
            Carga manual desde el panel. Pasa al estado <strong>Confirmada</strong>.
          </p>
          <form onSubmit={submitNew} className="space-y-2">
            <Input
              label="Nombre"
              required
              value={newForm.customerName}
              onChange={(v) => setNewForm({ ...newForm, customerName: v })}
            />
            <Input
              label="Teléfono"
              required
              value={newForm.customerPhone}
              onChange={(v) => setNewForm({ ...newForm, customerPhone: v })}
              placeholder="+52 55 0000 0000"
            />
            <div className="grid grid-cols-2 gap-2">
              <NumberInput
                label="Pax"
                min={1}
                max={20}
                value={newForm.party}
                onChange={(v) => setNewForm({ ...newForm, party: v })}
              />
              <div>
                <label className="label">Hora</label>
                <input
                  type="time"
                  className="input"
                  value={newForm.time}
                  onChange={(e) => setNewForm({ ...newForm, time: e.target.value })}
                />
              </div>
            </div>
            {zones.length > 0 && (
              <div>
                <label className="label">Zona (opcional)</label>
                <select
                  className="input"
                  value={newForm.zoneId}
                  onChange={(e) => setNewForm({ ...newForm, zoneId: e.target.value })}
                >
                  <option value="">Asignación automática</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>{z.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="label">Notas (opcional)</label>
              <textarea
                className="input"
                rows={2}
                value={newForm.notes}
                onChange={(e) => setNewForm({ ...newForm, notes: e.target.value })}
              />
            </div>
            <button className="btn-primary w-full justify-center" disabled={newBusy}>
              {newBusy ? 'Creando…' : 'Crear reserva'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  valueColor,
  sub,
  icon,
}: {
  label: string;
  value: string | number;
  valueColor: string;
  sub: string;
  icon: string;
}) {
  return (
    <div className="card card-pad">
      <div className="flex items-start justify-between">
        <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-mute">{label}</div>
        <span className="text-base">{icon}</span>
      </div>
      <div className="text-3xl font-extrabold mt-2" style={{ color: valueColor }}>
        {value}
      </div>
      <div className="text-xs text-mute mt-1">{sub}</div>
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold m-0">{title}</h2>
          <button onClick={onClose} className="text-mute hover:text-ink text-lg leading-none">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
      />
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="number"
        className="input"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
