'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PhoneInput } from '@/components/PhoneInput';
import { useTenantCountry } from '@/lib/useTenantCountry';
import { api } from '@/lib/api';
import { AcademyButton } from '@/components/AcademyButton';
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

function ZoneAddForm({
  onCreated,
  locationId,
  locations,
}: {
  onCreated: () => void;
  locationId?: string | null;
  locations: Location[];
}) {
  const t = useTranslations('app_reservations_reportes');
  const [name, setName] = useState('');
  const [type, setType] = useState('INDOOR');
  const [busy, setBusy] = useState(false);
  const multiSede = locations.length > 1;
  // R1: sede destino de la zona nueva. En multi-sede default a la sede activa o
  // la primera → nunca se crea una zona SIN sede (que quedaría fuera de todos
  // los planos por sede).
  const [zoneLoc, setZoneLoc] = useState<string>(
    locationId || (multiSede ? locations[0]?.id ?? '' : ''),
  );
  useEffect(() => {
    if (locationId) setZoneLoc(locationId);
  }, [locationId]);
  async function submit(e: React.FormEvent) {
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
      onCreated();
      toast(t('toastZoneCreated'), 'success');
    } catch (e: any) {
      toast(e.message || t('errorCouldNotCreate'), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex gap-1 mt-2 flex-wrap">
      <input
        className="input text-xs"
        placeholder={t('phNewZone')}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <select
        className="input text-xs"
        value={type}
        onChange={(e) => setType(e.target.value)}
        style={{ width: 100 }}
      >
        <option value="INDOOR">{t('zoneTypeIndoor')}</option>
        <option value="OUTDOOR">{t('zoneTypeOutdoor')}</option>
        <option value="BAR">{t('zoneTypeBar')}</option>
        <option value="PRIVATE">{t('zoneTypePrivate')}</option>
      </select>
      {multiSede && (
        <select
          className="input text-xs"
          value={zoneLoc}
          onChange={(e) => setZoneLoc(e.target.value)}
          style={{ width: 120 }}
          title={t('zoneSedeTitle')}
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      )}
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

const STATUS_META: Record<string, { labelKey: string; bg: string; fg: string }> = {
  PENDING: { labelKey: 'statusPending', bg: '#fff7ed', fg: '#b45309' },
  CONFIRMED: { labelKey: 'statusConfirmed', bg: '#ecfdf3', fg: '#15803d' },
  SEATED: { labelKey: 'statusSeated', bg: '#eff6ff', fg: '#1d4ed8' },
  COMPLETED: { labelKey: 'statusCompleted', bg: '#f3f4f6', fg: '#6b7280' },
  CANCELLED: { labelKey: 'statusCancelled', bg: '#f3f4f6', fg: '#6b7280' },
  NO_SHOW: { labelKey: 'statusNoShow', bg: '#fef2f2', fg: '#dc2626' },
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ReportesPage() {
  const t = useTranslations('app_reservations_reportes');
  const country = useTenantCountry();
  const [tab] = useState<'agenda' | 'plano' | 'metricas'>('metricas');
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
      toast(e.message || t('errorLoadingReservations'), 'error');
    }
  }

  useEffect(() => {
    loadAll();
  }, [date, activeLocationId]);

  const multiSede = locations.length > 1;

  // R1 (2026-08-01): default por sede. Multi-sede con TODO asignado → arranca en
  // la primera sede (plano independiente); si hay zonas sin sede → "Todas" para
  // asignarlas. Una sola vez.
  const didAutoSede = useRef(false);
  useEffect(() => {
    if (didAutoSede.current) return;
    if (locations.length <= 1 || activeLocationId || zones.length === 0) return;
    if (zones.some((z) => !z.locationId)) return;
    didAutoSede.current = true;
    setActiveLocationId(locations[0].id);
  }, [locations, zones, activeLocationId]);

  // R1: reasignar una zona a otra sede (el backend cascadea sus mesas).
  async function patchZoneLocation(zoneId: string, locId: string | null) {
    try {
      await api(`/reservations/zones/${zoneId}`, {
        method: 'PATCH',
        body: JSON.stringify({ locationId: locId }),
      });
      loadAll();
      toast(t('toastZoneMoved'), 'success');
    } catch (e: any) {
      toast(e.message || t('errorCouldNotUpdate'), 'error');
    }
  }

  const stats = useMemo(() => {
    const pax = reservations.reduce((s, r) => s + r.party, 0);
    const cancelled = reservations.filter((r) => r.status === 'CANCELLED' || r.status === 'NO_SHOW').length;
    return { count: reservations.length, pax, cancelled };
  }, [reservations]);

  async function changeStatus(id: string, status: Reservation['status']) {
    try {
      await api(`/reservations/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      loadAll();
      toast(t('toastReservationMarked', { status: t(STATUS_META[status].labelKey).toLowerCase() }), 'success');
    } catch (e: any) {
      toast(e.message || t('errorCouldNotUpdate'), 'error');
    }
  }

  async function submitReservation(e: React.FormEvent) {
    e.preventDefault();
    if (!form.customerName.trim() || !form.customerPhone.trim()) {
      toast(t('errorNamePhoneRequired'), 'error');
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
      toast(t('toastReservationCreated'), 'success');
    } catch (e: any) {
      toast(e.message || t('errorCouldNotCreate'), 'error');
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
      toast(t('errorNameRequired'), 'error');
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
          ? t('toastWalkInWithStamp')
          : t('toastWalkInNoPhone'),
        'success',
      );
    } catch (err: any) {
      toast(err.message || t('errorCouldNotRegister'), 'error');
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
      toast(err.message || t('errorCouldNotCreate'), 'error');
    }
  }

  async function patchTable(id: string, patch: Partial<Table>) {
    // Optimistic update
    setTables((prev) => prev.map((tbl) => (tbl.id === id ? { ...tbl, ...patch } : tbl)));
    try {
      await api(`/reservations/tables/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    } catch (e: any) {
      toast(e.message || t('errorCouldNotUpdate'), 'error');
      loadAll();
    }
  }

  async function toggleBlock(tbl: Table) {
    patchTable(tbl.id, { isBlocked: !tbl.isBlocked });
  }

  async function deleteTable(tbl: Table) {
    if (!confirm(t('confirmDeleteTable', { number: tbl.number }))) return;
    try {
      await api(`/reservations/tables/${tbl.id}`, { method: 'DELETE' });
      setSelectedTableId(null);
      loadAll();
      toast(t('toastTableDeleted'), 'success');
    } catch (e: any) {
      toast(e.message || t('errorCouldNotDelete'), 'error');
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
    const tbl = tables.find((x) => x.id === dragRef.current!.id);
    if (!tbl) return;
    const dims = tableDims(tbl);
    const rawX = e.clientX - rect.left - dragRef.current.offsetX;
    const rawY = e.clientY - rect.top - dragRef.current.offsetY;
    const maxX = rect.width - dims.w;
    const maxY = CANVAS_H - dims.h;
    const x = Math.min(maxX, Math.max(0, snap(rawX)));
    const y = Math.min(maxY, Math.max(0, snap(rawY)));
    setTables((prev) => prev.map((tt) => (tt.id === tbl.id ? { ...tt, posX: x, posY: y } : tt)));
  }
  function handlePointerUp(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const id = dragRef.current.id;
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    const tbl = tables.find((x) => x.id === id);
    if (!tbl) return;
    // Persist final position
    api(`/reservations/tables/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ posX: tbl.posX, posY: tbl.posY }),
    }).catch((err: any) => {
      toast(err.message || t('errorCouldNotSavePosition'), 'error');
      loadAll();
    });
  }

  const selectedTable = tables.find((tbl) => tbl.id === selectedTableId) || null;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">{t('pageTitle')} <span className="page-crumb">/ {date}</span></h1>
        <div className="flex gap-2 items-center flex-wrap">
          {locations.length > 1 && (
            <select
              value={activeLocationId}
              onChange={(e) => setActiveLocationId(e.target.value)}
              className="input text-sm"
              style={{ width: 'auto' }}
              title={t('filterByLocation')}
            >
              <option value="">📍 {t('allLocations')}</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  📍 {loc.name}
                </option>
              ))}
            </select>
          )}
          <AcademyButton moduleKey="reportes" />
          <button
            onClick={() => setWalkInOpen(true)}
            className="btn-primary text-sm"
            style={{ background: '#1d4ed8' }}
            title={t('walkInTooltip')}
          >
            🚶 {t('walkIn')}
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
            <h2 className="text-base font-semibold m-0">🚶 {t('walkInRegisterTitle')}</h2>
            <button onClick={() => setWalkInOpen(false)} className="text-mute hover:text-ink">
              ✕
            </button>
          </div>
          <p className="text-xs text-mute mb-3">
            {t.rich('walkInRegisterDesc', { strong: (chunks) => <strong>{chunks}</strong> })}
          </p>
          <form onSubmit={submitWalkIn} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
            <div>
              <label className="label">{t('fieldName')}</label>
              <input
                className="input"
                value={walkIn.customerName}
                onChange={(e) => setWalkIn({ ...walkIn, customerName: e.target.value })}
                placeholder="Juan Pérez"
                required
              />
            </div>
            <div>
              <label className="label">{t('fieldPhoneOptional')}</label>
              <input
                className="input"
                value={walkIn.customerPhone}
                onChange={(e) => setWalkIn({ ...walkIn, customerPhone: e.target.value })}
                placeholder="+52 55..."
              />
            </div>
            <div>
              <label className="label">{t('fieldPax')}</label>
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
              <label className="label">{t('fieldTableOptional')}</label>
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
            <button className="btn-primary text-sm justify-center" disabled={walkInSubmitting}>
              {walkInSubmitting ? t('seating') : t('seatWalkIn')}
            </button>
          </form>
        </div>
      )}

      {/* Tabs ocultos: la navegación se hace desde el sidebar */}
      <div className="hidden">
        {([
          { v: 'agenda' as const, label: `📅 ${t('tabAgenda')}`, count: stats.count },
          { v: 'plano' as const, label: `🪑 ${t('tabFloorPlan')}`, count: tables.length },
          { v: 'metricas' as const, label: `📊 ${t('tabMetrics')}`, count: null as number | null },
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
              <h2 className="text-base font-semibold m-0">{t('reservationsOfDay')}</h2>
              <div className="flex gap-3 text-xs text-mute">
                <span><strong className="text-ink">{stats.count}</strong> {t('reservationsLabel')}</span>
                <span><strong className="text-ink">{stats.pax}</strong> pax</span>
                <span><strong className="text-bad">{stats.cancelled}</strong> {t('absencesLabel')}</span>
              </div>
            </div>
            {reservations.length === 0 ? (
              <p className="text-sm text-mute py-6 text-center">
                {t('emptyDayReservations')}
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
                          {r.table?.number && ` · ${t('tableLabel', { number: r.table.number })}`}
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
                        {t(sm.labelKey)}
                      </span>
                      <select
                        value={r.status}
                        onChange={(e) => changeStatus(r.id, e.target.value as Reservation['status'])}
                        className="text-[11px] border border-line rounded px-2 py-1 bg-white"
                      >
                        {Object.entries(STATUS_META).map(([v, m]) => (
                          <option key={v} value={v}>{t(m.labelKey)}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <form onSubmit={submitReservation} className="card card-pad self-start">
            <h2 className="text-base font-semibold m-0">{t('newReservation')}</h2>
            <p className="text-xs text-mute mt-1">{t('manualLoadHint')}</p>
            <div className="mt-3 space-y-2">
              <div>
                <label className="label">{t('fieldName')}</label>
                <input
                  className="input"
                  value={form.customerName}
                  onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label">{t('fieldPhone')}</label>
                <PhoneInput
                  value={form.customerPhone}
                  onChange={(v) => setForm({ ...form, customerPhone: v })}
                  defaultCountry={country}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">{t('fieldPax')}</label>
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
                  <label className="label">{t('fieldTime')}</label>
                  <input
                    type="time"
                    className="input"
                    value={form.time}
                    onChange={(e) => setForm({ ...form, time: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="label">{t('fieldNotesOptional')}</label>
                <textarea
                  className="input"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
            </div>
            <button className="btn-primary mt-3 w-full justify-center" disabled={creating}>
              {creating ? t('creating') : t('createReservation')}
            </button>
          </form>
        </div>
      )}

      {tab === 'plano' && (
        <div className="grid lg:grid-cols-[1fr_300px] gap-4">
          <div className="card card-pad">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-base font-semibold m-0">{t('floorPlanTitle')}</h2>
                <p className="text-[11px] text-mute mt-0.5">
                  {t('floorPlanHint')}
                </p>
              </div>
              <button onClick={() => setShowAddTable((v) => !v)} className="btn-primary text-sm">
                <Icon name="plus" /> {t('tableWord')}
              </button>
            </div>

            {showAddTable && (
              <form onSubmit={createTable} className="mb-3 p-3 bg-bg2/60 rounded-lg border border-line grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
                <div>
                  <label className="label">{t('fieldNumberLabel')}</label>
                  <input
                    className="input"
                    value={newTable.number}
                    onChange={(e) => setNewTable({ ...newTable, number: e.target.value })}
                    placeholder="1 / VIP / Barra"
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
                <button className="btn-primary text-sm justify-center">{t('createWord')}</button>
              </form>
            )}

            {tables.length === 0 ? (
              <p className="text-sm text-mute py-10 text-center">
                {t('emptyNoTables')}
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
              {selectedTable ? t('tableLabel', { number: selectedTable.number }) : t('tableDetails')}
            </h2>
            {selectedTable ? (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="label">{t('fieldNumberLabel')}</label>
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
                  <label className="label">{t('fieldCapacityPax')}</label>
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
                  <label className="label">{t('fieldShape')}</label>
                  <select
                    className="input"
                    value={selectedTable.shape}
                    onChange={(e) => patchTable(selectedTable.id, { shape: e.target.value })}
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
                    value={selectedTable.zoneId ?? ''}
                    onChange={(e) => patchTable(selectedTable.id, { zoneId: e.target.value || null })}
                  >
                    <option value="">{t('noZone')}</option>
                    {zones.map((z) => (
                      <option key={z.id} value={z.id}>{z.name}</option>
                    ))}
                  </select>
                </div>
                <div className="text-xs">
                  {t('stateLabel')}{' '}
                  {selectedTable.isBlocked ? (
                    <span className="text-bad font-semibold">{t('stateBlocked')}</span>
                  ) : (
                    <span className="text-ok font-semibold">{t('stateAvailable')}</span>
                  )}
                </div>
                <button
                  onClick={() => toggleBlock(selectedTable)}
                  className="btn-ghost w-full justify-center text-sm"
                >
                  {selectedTable.isBlocked ? `▶ ${t('unblock')}` : `⏸ ${t('blockTable')}`}
                </button>
                <button
                  onClick={() => deleteTable(selectedTable)}
                  className="w-full justify-center text-sm py-2 rounded-lg border border-bad text-bad hover:bg-bad-soft"
                >
                  🗑 {t('deleteTable')}
                </button>
              </div>
            ) : (
              <p className="text-sm text-mute mt-2">
                {t('tapTableHint')}
              </p>
            )}

          </div>
          <div className="card card-pad">
            <h3 className="text-sm font-semibold m-0">{t('zonesTitle')}</h3>
            <p className="text-[11px] text-mute mt-0.5 mb-2">
              {t('zonesHint')}
            </p>
            {multiSede && zones.some((z) => !z.locationId) && (
              <div className="text-[11px] rounded-lg px-2 py-1.5 mb-2 leading-snug bg-bad-soft text-bad-ink">
                {t('assignZonesHint')}
              </div>
            )}
            {zones.length === 0 ? (
              <p className="text-xs text-mute italic">{t('noZonesYet')}</p>
            ) : (
              <ul className="space-y-1 mb-2">
                {zones.map((z) => (
                  <li key={z.id} className="flex items-center justify-between gap-2 text-xs py-1.5 px-2 bg-bg2/60 rounded">
                    <span className="font-semibold truncate flex items-center gap-1.5 min-w-0">
                      {z.name}
                      {multiSede && !z.locationId && (
                        <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-bad-soft text-bad-ink shrink-0">
                          {t('zoneSedeNone')}
                        </span>
                      )}
                    </span>
                    {multiSede ? (
                      <select
                        className="text-[10px] rounded border border-line bg-white px-1 py-0.5 max-w-[120px] shrink-0"
                        value={z.locationId ?? ''}
                        onChange={(e) => patchZoneLocation(z.id, e.target.value || null)}
                        title={t('zoneSedeTitle')}
                      >
                        <option value="">{t('zoneSedeNone')}</option>
                        {locations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-mute text-[10px]">{z.type}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <ZoneAddForm onCreated={loadAll} locationId={activeLocationId} locations={locations} />
          </div>
          </div>
        </div>
      )}

      {tab === 'metricas' && <MetricsTab />}
    </div>
  );
}

function MetricsTab() {
  const t = useTranslations('app_reservations_reportes');
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
    const toStr = to.toISOString().slice(0, 10);
    api<any>(`/reservations/stats?from=${f}&to=${toStr}`)
      .then(setStats)
      .catch((e: any) => setError(e.message || 'Error'));
  }, [range]);

  if (error) {
    return <p className="text-sm text-bad py-6 text-center">{error}</p>;
  }
  if (!stats) {
    return <p className="text-sm text-mute py-6 text-center">{t('loadingMetrics')}</p>;
  }

  const DOW_LABELS = [t('dowSun'), t('dowMon'), t('dowTue'), t('dowWed'), t('dowThu'), t('dowFri'), t('dowSat')];
  const maxDow = Math.max(1, ...Object.values<number>(stats.byDow));
  const maxZone = Math.max(1, ...stats.zoneBreakdown.map((z: any) => z.pax));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-mute">
          {t('rangeLabel')} <strong className="text-ink">{stats.range.from}</strong> →{' '}
          <strong className="text-ink">{stats.range.to}</strong> ({t('rangeDays', { days: stats.range.days })})
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
              {r === '7d' ? t('range7d') : r === '30d' ? t('range30d') : t('range90d')}
            </button>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card card-pad">
          <div className="text-xs text-mute font-bold">{t('kpiReservations')}</div>
          <div className="text-2xl font-extrabold mt-1">{stats.totals.reservations}</div>
          <div className="text-xs text-mute mt-1">{t('kpiPaxAvg', { pax: stats.totals.pax, avg: stats.totals.avgParty })}</div>
        </div>
        <div className="card card-pad">
          <div className="text-xs text-mute font-bold">{t('kpiCompletion')}</div>
          <div className="text-2xl font-extrabold mt-1 text-ok">{stats.rates.completionRate}%</div>
          <div className="text-xs text-mute mt-1">{t('kpiCompleted', { count: stats.totals.completed })}</div>
        </div>
        <div className="card card-pad">
          <div className="text-xs text-mute font-bold">{t('kpiNoShow')}</div>
          <div className={`text-2xl font-extrabold mt-1 ${stats.rates.noShowRate > 15 ? 'text-bad' : ''}`}>
            {stats.rates.noShowRate}%
          </div>
          <div className="text-xs text-mute mt-1">{t('kpiNoShowCount', { count: stats.totals.noShow })}</div>
        </div>
        <div className="card card-pad">
          <div className="text-xs text-mute font-bold">{t('kpiCancellations')}</div>
          <div className="text-2xl font-extrabold mt-1">{stats.rates.cancelRate}%</div>
          <div className="text-xs text-mute mt-1">{t('kpiCancelledCount', { count: stats.totals.cancelled })}</div>
        </div>
      </div>

      {/* Estado breakdown */}
      <div className="card card-pad">
        <h3 className="text-sm font-semibold m-0 mb-3">{t('reservationsStateTitle')}</h3>
        <div className="space-y-2">
          {[
            { label: t('statePending'), val: stats.totals.pending, color: '#b45309' },
            { label: t('stateConfirmed'), val: stats.totals.confirmed, color: '#1d4ed8' },
            { label: t('stateCompleted'), val: stats.totals.completed, color: '#15803d' },
            { label: t('stateCancelled'), val: stats.totals.cancelled, color: '#6b7280' },
            { label: t('stateAbsent'), val: stats.totals.noShow, color: '#dc2626' },
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
          <h3 className="text-sm font-semibold m-0 mb-3">{t('topHoursTitle')}</h3>
          {stats.topHours.length === 0 ? (
            <p className="text-xs text-mute italic">{t('noDataInRange')}</p>
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
          <h3 className="text-sm font-semibold m-0 mb-3">{t('paxByDow')}</h3>
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
          <h3 className="text-sm font-semibold m-0 mb-3">{t('topZones')}</h3>
          {stats.zoneBreakdown.length === 0 ? (
            <p className="text-xs text-mute italic">{t('noData')}</p>
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
          <h3 className="text-sm font-semibold m-0 mb-3">{t('channelTitle')}</h3>
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
