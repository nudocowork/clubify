'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PhoneInput } from '@/components/PhoneInput';
import { useTenantCountry } from '@/lib/useTenantCountry';
import Link from 'next/link';
import { api } from '@/lib/api';
import { AcademyButton } from '@/components/AcademyButton';
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

const STATUS_LABEL_KEY: Record<string, string> = {
  PENDING: 'statusPending',
  CONFIRMED: 'statusConfirmed',
  SEATED: 'statusSeated',
  COMPLETED: 'statusCompleted',
  CANCELLED: 'statusCancelled',
  NO_SHOW: 'statusNoShow',
};

const CHANNEL_LABEL_KEY: Record<string, string> = {
  WEB: 'channelWeb',
  WHATSAPP: 'channelWhatsapp',
  PHONE: 'channelPhone',
  QR: 'channelQr',
  IN_PERSON: 'channelInPerson',
};

type DailyKpis = {
  date: string;
  reservations: { count: number; delta: number };
  pax: { expected: number };
  occupancy: { percent: number; peakHour: string | null };
  noShow: { count: number; percent: number };
};

export default function AgendaPage() {
  const t = useTranslations('app_reservations');
  const country = useTenantCountry();
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
      toast(e.message || t('errorLoadingAgenda'), 'error');
    }
  }
  useEffect(() => {
    loadAll();
  }, [date, activeLocationId]);

  // R1 (2026-08-01): default por sede. Multi-sede con todas las zonas asignadas
  // → arranca en la primera sede (agenda por sede); si hay zonas sin sede →
  // queda en "Todas". Una sola vez.
  const didAutoSede = useRef(false);
  useEffect(() => {
    if (didAutoSede.current) return;
    if (locations.length <= 1 || activeLocationId || zones.length === 0) return;
    if (zones.some((z) => !z.locationId)) return;
    didAutoSede.current = true;
    setActiveLocationId(locations[0].id);
  }, [locations, zones, activeLocationId]);

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
      toast(t('toastReservationMarked', { status: t(STATUS_LABEL_KEY[status]).toLowerCase() }), 'success');
    } catch (e: any) {
      toast(e.message || t('errorCouldNotUpdate'), 'error');
    }
  }

  async function submitWalkIn(e: React.FormEvent) {
    e.preventDefault();
    if (!walkIn.customerName.trim()) {
      toast(t('errorNameRequired'), 'error');
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
          ? t('toastWalkInWithStamp')
          : t('toastWalkInNoPhone'),
        'success',
      );
    } catch (err: any) {
      toast(err.message || t('errorCouldNotRegister'), 'error');
    } finally {
      setWalkInBusy(false);
    }
  }

  async function submitNew(e: React.FormEvent) {
    e.preventDefault();
    if (!newForm.customerName.trim() || !newForm.customerPhone.trim()) {
      toast(t('errorNamePhoneRequired'), 'error');
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
      toast(t('toastReservationCreated'), 'success');
    } catch (e: any) {
      toast(e.message || t('errorCouldNotCreate'), 'error');
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

  // Contador "Aviso al negocio": PDF 2026-06-30. Antes contaba por CANAL
  // (WHATSAPP/WEB/QR), lo cual no reflejaba los avisos realmente enviados al
  // negocio. Ahora suma las reservas que SÍ dispararon el aviso (notifiedAt).
  const whatsappCount = useMemo(
    () => reservations.filter((r) => !!r.notifiedAt).length,
    [reservations],
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="page-title m-0">
            {t('pageTitle')} <span className="page-crumb text-mute font-normal">/ {fmtLongDate(date)}</span>
          </h1>
          <p className="text-xs text-mute mt-1">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-ok-soft text-ok-ink text-xs font-semibold">
            <span className="relative inline-block w-2 h-2">
              <span className="absolute inset-0 rounded-full bg-ok animate-ping opacity-75" />
              <span className="absolute inset-0 rounded-full bg-ok" />
            </span>
            {t('realTime')}
          </div>
          {locations.length > 1 && (
            <select
              value={activeLocationId}
              onChange={(e) => setActiveLocationId(e.target.value)}
              className="input text-sm"
              style={{ width: 'auto' }}
            >
              <option value="">📍 {t('allLocations')}</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  📍 {loc.name}
                </option>
              ))}
            </select>
          )}
          <AcademyButton moduleKey="agenda" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="input text-sm"
            style={{ width: 160 }}
          />
          <button
            onClick={() => setWalkInOpen(true)}
            className="text-sm font-semibold px-3 py-2 rounded-pill text-white"
            style={{ background: '#1d4ed8' }}
            title={t('walkInTooltip')}
          >
            🚶 {t('walkIn')}
          </button>
          <button onClick={() => setNewOpen(true)} className="btn-primary text-sm">
            {t('newReservationBtn')}
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
          label={t('kpiReservationsToday')}
          value={kpis?.reservations.count ?? 0}
          valueColor="#15803d"
          sub={
            kpis && kpis.reservations.delta !== 0
              ? t('kpiDeltaVsYesterday', {
                  delta: `${kpis.reservations.delta > 0 ? '+' : ''}${kpis.reservations.delta}`,
                })
              : t('kpiNoChangeVsYesterday')
          }
          icon="📅"
        />
        <KpiCard
          label={t('kpiDiners')}
          value={kpis?.pax.expected ?? 0}
          valueColor="#1d4ed8"
          sub={t('kpiExpectedPax')}
          icon="👥"
        />
        <KpiCard
          label={t('kpiOccupancy')}
          value={`${kpis?.occupancy.percent ?? 0}%`}
          valueColor="#b45309"
          sub={kpis?.occupancy.peakHour ? t('kpiPeak', { hour: kpis.occupancy.peakHour }) : t('kpiNoPeaks')}
          icon="📈"
        />
        <KpiCard
          label={t('kpiAbsences')}
          value={kpis?.noShow.count ?? 0}
          valueColor="#dc2626"
          sub={t('kpiPercentOfTotal', { percent: kpis?.noShow.percent ?? 0 })}
          icon="⏰"
        />
      </div>

      <div className="grid lg:grid-cols-[1fr_340px] gap-4">
        {/* Reservas del día */}
        <div className="card card-pad">
          <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
            <div>
              <div className="text-[10px] text-mute font-semibold tracking-[0.18em] uppercase">
                {t('reservationsOfDay')}
              </div>
              <h2 className="text-lg font-bold m-0 mt-0.5">
                {t('agendaCount', { count: filtered.length })}
              </h2>
            </div>
            <div className="flex gap-1 bg-bg2 p-1 rounded-lg text-xs">
              {([
                { v: 'todos' as const, label: t('shiftAll'), count: reservations.length },
                { v: 'diurno' as const, label: t('shiftDaytime'), count: shiftCounts.diurno },
                { v: 'tarde' as const, label: t('shiftAfternoon'), count: shiftCounts.tarde },
                { v: 'noche' as const, label: t('shiftNight'), count: shiftCounts.noche },
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
                ? t('emptyDayReservations')
                : t('emptyNoResults')}
            </p>
          ) : (
            <div className="hidden md:grid grid-cols-[80px_1fr_60px_120px_140px] gap-3 text-[10px] uppercase tracking-wider text-mute font-bold border-b border-line2 pb-2 mb-2">
              <span>{t('thTime')}</span>
              <span>{t('thCustomer')}</span>
              <span className="text-center">{t('thPax')}</span>
              <span>{t('thTable')}</span>
              <span className="text-right">{t('thStatus')}</span>
            </div>
          )}

          <div className="space-y-1">
            {filtered.map((r) => {
              const sm = STATUS_META[r.status];
              const ch = channelMeta(r.channel);
              const chLabel = CHANNEL_LABEL_KEY[r.channel] ? t(CHANNEL_LABEL_KEY[r.channel]) : ch.label;
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
                      <span className="truncate">{chLabel}</span>
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
                  <div className="text-sm text-center">{t('paxCount', { count: r.party })}</div>
                  <div className="text-sm truncate">
                    {r.table?.number ? t('tableLabel', { number: r.table.number }) : (
                      <span className="text-mute italic">{t('unassigned')}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ background: sm.dot }}
                      />
                      <span style={{ color: sm.fg }}>{t(STATUS_LABEL_KEY[r.status])}</span>
                    </span>
                    <select
                      value={r.status}
                      onChange={(e) => changeStatus(r.id, e.target.value as Reservation['status'])}
                      className="text-[10px] border border-line rounded px-1.5 py-0.5 bg-white"
                      title={t('changeStatus')}
                    >
                      {Object.keys(STATUS_META).map((v) => (
                        <option key={v} value={v}>{t(STATUS_LABEL_KEY[v])}</option>
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
              💬 {t('noticeTitle')}
            </div>
            <div className="font-semibold text-sm mt-2 opacity-95">{t('noticedReservationsToday')}</div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-4xl font-extrabold">{whatsappCount}</span>
              <span className="text-sm opacity-80">{t('byWhatsapp')}</span>
            </div>
            <p className="text-xs opacity-80 mt-2 leading-relaxed">
              {t.rich('noticeDesc', { strong: (chunks) => <strong>{chunks}</strong> })}
            </p>
            <Link
              href="/app/settings#reservas"
              className="block mt-3 text-center bg-white/15 hover:bg-white/25 backdrop-blur rounded-lg py-2 text-sm font-semibold transition"
            >
              {t('configureReceiverNumber')}
            </Link>
          </div>

          <div className="card card-pad">
            <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-mute mb-3">
              {t('howItConfirms')}
            </div>
            <ol className="space-y-3 text-sm">
              {[
                t('confirmStep1'),
                t('confirmStep2'),
                t('confirmStep3'),
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
        <Modal title={`🚶 ${t('walkInRegisterTitle')}`} onClose={() => setWalkInOpen(false)}>
          <p className="text-xs text-mute mb-3">
            {t.rich('walkInRegisterDesc', { strong: (chunks) => <strong>{chunks}</strong> })}
          </p>
          <form onSubmit={submitWalkIn} className="space-y-2">
            <Input
              label={t('fieldName')}
              required
              value={walkIn.customerName}
              onChange={(v) => setWalkIn({ ...walkIn, customerName: v })}
            />
            <Input
              label={t('fieldPhoneOptional')}
              value={walkIn.customerPhone}
              onChange={(v) => setWalkIn({ ...walkIn, customerPhone: v })}
            />
            <div className="grid grid-cols-2 gap-2">
              <NumberInput
                label={t('fieldPax')}
                min={1}
                max={20}
                value={walkIn.party}
                onChange={(v) => setWalkIn({ ...walkIn, party: v })}
              />
              <div>
                <label className="label">{t('fieldTable')}</label>
                <select
                  className="input"
                  value={walkIn.tableId}
                  onChange={(e) => setWalkIn({ ...walkIn, tableId: e.target.value })}
                >
                  <option value="">{t('unassigned')}</option>
                  {tables.filter((tbl) => !tbl.isBlocked).map((tbl) => (
                    <option key={tbl.id} value={tbl.id}>
                      {t('tableOption', { number: tbl.number, seats: tbl.seats })}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button className="btn-primary w-full justify-center" disabled={walkInBusy}>
              {walkInBusy ? t('seating') : t('seatWalkIn')}
            </button>
          </form>
        </Modal>
      )}

      {/* Modal Nueva reserva */}
      {newOpen && (
        <Modal title={t('newReservationTitle')} onClose={() => setNewOpen(false)}>
          <p className="text-xs text-mute mb-3">
            {t.rich('newReservationDesc', { strong: (chunks) => <strong>{chunks}</strong> })}
          </p>
          <form onSubmit={submitNew} className="space-y-2">
            <Input
              label={t('fieldName')}
              required
              value={newForm.customerName}
              onChange={(v) => setNewForm({ ...newForm, customerName: v })}
            />
            <div>
              <label className="label">{t('fieldPhone')}</label>
              <PhoneInput
                value={newForm.customerPhone}
                onChange={(v) => setNewForm({ ...newForm, customerPhone: v })}
                defaultCountry={country}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberInput
                label={t('fieldPax')}
                min={1}
                max={20}
                value={newForm.party}
                onChange={(v) => setNewForm({ ...newForm, party: v })}
              />
              <div>
                <label className="label">{t('fieldTime')}</label>
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
                <label className="label">{t('fieldZoneOptional')}</label>
                <select
                  className="input"
                  value={newForm.zoneId}
                  onChange={(e) => setNewForm({ ...newForm, zoneId: e.target.value })}
                >
                  <option value="">{t('autoAssignment')}</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>{z.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="label">{t('fieldNotesOptional')}</label>
              <textarea
                className="input"
                rows={2}
                value={newForm.notes}
                onChange={(e) => setNewForm({ ...newForm, notes: e.target.value })}
              />
            </div>
            <button className="btn-primary w-full justify-center" disabled={newBusy}>
              {newBusy ? t('creating') : t('createReservation')}
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
