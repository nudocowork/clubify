'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

// Fase 2 (PDF245 P7): panel del negocio para Reservas de Servicios (citas).
// Gestiona servicios, horarios/excepciones y la agenda de citas. Llama a
// /service-reservations/* (backend Fase 1).

type Service = {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number | null;
  isActive: boolean;
  sortOrder: number;
};
type Avail = { id?: string; weekday: number; startMin: number; endMin: number };
type Exception = {
  id: string;
  date: string;
  closed: boolean;
  startMin: number | null;
  endMin: number | null;
};
type Appt = {
  id: string;
  serviceId: string;
  customerName: string;
  customerPhone: string;
  startAt: string;
  endAt: string;
  status: string;
  notes: string | null;
  service?: { name: string; durationMin: number };
};
type Slot = { startAt: string; label: string };

const WEEKDAYS = [
  { n: 1, label: 'Lunes' },
  { n: 2, label: 'Martes' },
  { n: 3, label: 'Miércoles' },
  { n: 4, label: 'Jueves' },
  { n: 5, label: 'Viernes' },
  { n: 6, label: 'Sábado' },
  { n: 0, label: 'Domingo' },
];
const APPT_STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  pending: { label: 'Pendiente', bg: '#fef9c3', fg: '#a16207' },
  confirmed: { label: 'Confirmada', bg: '#dbeafe', fg: '#1d4ed8' },
  completed: { label: 'Completada', bg: '#dcfce7', fg: '#15803d' },
  cancelled: { label: 'Cancelada', bg: '#fee2e2', fg: '#b91c1c' },
  no_show: { label: 'No asistió', bg: '#f3f4f6', fg: '#6b7280' },
};

const inp =
  'w-full rounded-[10px] px-3 py-2 text-sm outline-none border border-[#dfe3e8] focus:border-[#0ea5e9] bg-white';
const minToHhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const hhmmToMin = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
const fmtPrice = (c: number | null) =>
  c == null ? '—' : `$${(c / 100).toFixed(2)}`;
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function ServiciosPage() {
  const [tab, setTab] = useState<'servicios' | 'horarios' | 'agenda'>('servicios');
  const [services, setServices] = useState<Service[]>([]);
  const [availability, setAvailability] = useState<Avail[]>([]);
  const [timezone, setTimezone] = useState('America/Bogota');
  const [slug, setSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadConfig = useCallback(async () => {
    try {
      const c = await api<{
        timezone: string;
        slug: string | null;
        services: Service[];
        availability: Avail[];
      }>('/service-reservations/config');
      setServices(c?.services ?? []);
      setAvailability(c?.availability ?? []);
      setTimezone(c?.timezone ?? 'America/Bogota');
      setSlug(c?.slug ?? null);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold m-0 mb-1">Reservas de servicios</h1>
      <p className="text-xs mb-3" style={{ color: '#9aa4af' }}>
        Configura tus servicios y horarios, y gestiona la agenda de citas.
      </p>
      {slug && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-[10px] px-3 py-2 mb-4 text-xs"
          style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af' }}
        >
          <span>🔗 Link para tus clientes:</span>
          <code className="font-mono">{`${typeof window !== 'undefined' ? window.location.origin : ''}/cita/${slug}`}</code>
          <button
            onClick={() => {
              navigator.clipboard
                ?.writeText(`${window.location.origin}/cita/${slug}`)
                .then(() => toast('Link copiado', 'success'))
                .catch(() => null);
            }}
            className="ml-auto font-semibold"
            style={{ color: '#1d4ed8' }}
          >
            Copiar
          </button>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        {(
          [
            ['servicios', 'Servicios'],
            ['horarios', 'Horarios'],
            ['agenda', 'Agenda'],
          ] as [typeof tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className="text-sm font-semibold rounded-full px-4 py-1.5"
            style={
              tab === k
                ? { background: '#0ea5e9', color: 'white' }
                : { background: 'white', color: '#475569', border: '1px solid #e2e8f0' }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm" style={{ color: '#9aa4af' }}>Cargando…</div>
      ) : tab === 'servicios' ? (
        <ServicesTab services={services} onChange={loadConfig} />
      ) : tab === 'horarios' ? (
        <ScheduleTab availability={availability} onSaved={loadConfig} />
      ) : (
        <AgendaTab services={services} timezone={timezone} />
      )}
    </div>
  );
}

// ───────────────────── Tab: Servicios ─────────────────────
function ServicesTab({
  services,
  onChange,
}: {
  services: Service[];
  onChange: () => void;
}) {
  const [name, setName] = useState('');
  const [duration, setDuration] = useState('30');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!name.trim()) {
      toast('Ponle un nombre al servicio', 'error');
      return;
    }
    setBusy(true);
    try {
      await api('/service-reservations/services', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          durationMin: Number(duration) || 30,
          priceCents: price.trim() === '' ? null : Math.round(Number(price) * 100),
        }),
      });
      setName('');
      setDuration('30');
      setPrice('');
      toast('Servicio creado', 'success');
      onChange();
    } catch (e: any) {
      toast(e.message ?? 'Error al crear', 'error');
    } finally {
      setBusy(false);
    }
  }
  async function toggle(s: Service) {
    try {
      await api(`/service-reservations/services/${s.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !s.isActive }),
      });
      onChange();
    } catch (e: any) {
      toast(e.message ?? 'Error', 'error');
    }
  }
  async function remove(s: Service) {
    if (!confirm(`¿Borrar el servicio "${s.name}"?`)) return;
    try {
      await api(`/service-reservations/services/${s.id}`, { method: 'DELETE' });
      onChange();
    } catch (e: any) {
      toast(e.message ?? 'Error', 'error');
    }
  }

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-[12px]" style={{ background: 'white', border: '1px solid #e7e9ec' }}>
        <div className="text-xs font-bold uppercase mb-2" style={{ color: '#6b7280' }}>
          Nuevo servicio
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          <input className={inp + ' sm:col-span-2'} placeholder="Nombre (ej. Corte de cabello)" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={inp} type="number" min={5} placeholder="Min" value={duration} onChange={(e) => setDuration(e.target.value)} title="Duración en minutos" />
          <input className={inp} type="number" step="0.01" placeholder="Precio $" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <button onClick={add} disabled={busy} className="mt-2 text-sm font-semibold text-white rounded-[10px] py-2 px-4" style={{ background: '#16a34a', opacity: busy ? 0.6 : 1 }}>
          {busy ? '…' : '+ Agregar servicio'}
        </button>
      </div>

      {services.length === 0 ? (
        <div className="text-sm rounded-lg px-3 py-6 text-center" style={{ color: '#9aa4af', border: '1px dashed #e5e7eb' }}>
          Aún no tienes servicios. Crea el primero arriba.
        </div>
      ) : (
        <div className="space-y-1.5">
          {services.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 p-3 rounded-[12px]" style={{ background: 'white', border: '1px solid #e7e9ec', opacity: s.isActive ? 1 : 0.6 }}>
              <div className="min-w-0">
                <div className="text-sm font-semibold" style={{ color: '#16241c' }}>{s.name}</div>
                <div className="text-[12px]" style={{ color: '#6b7785' }}>
                  ⏱️ {s.durationMin} min · {fmtPrice(s.priceCents)}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0 text-[11px] font-semibold">
                <button onClick={() => toggle(s)} style={{ color: '#0ea5e9' }}>{s.isActive ? 'Desactivar' : 'Activar'}</button>
                <button onClick={() => remove(s)} style={{ color: '#b91c1c' }}>Borrar</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────── Tab: Horarios ─────────────────────
function ScheduleTab({
  availability,
  onSaved,
}: {
  availability: Avail[];
  onSaved: () => void;
}) {
  // Estado local agrupado por día.
  const [rows, setRows] = useState<Avail[]>(availability);
  const [saving, setSaving] = useState(false);
  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [excDate, setExcDate] = useState(todayStr());

  useEffect(() => setRows(availability), [availability]);
  const loadExc = useCallback(async () => {
    try {
      setExceptions((await api<Exception[]>('/service-reservations/exceptions')) ?? []);
    } catch {
      /* noop */
    }
  }, []);
  useEffect(() => {
    loadExc();
  }, [loadExc]);

  const byDay = useMemo(() => {
    const m: Record<number, Avail[]> = {};
    for (const w of WEEKDAYS) m[w.n] = [];
    for (const r of rows) (m[r.weekday] ??= []).push(r);
    return m;
  }, [rows]);

  function addWindow(weekday: number) {
    setRows((p) => [...p, { weekday, startMin: 540, endMin: 1080 }]);
  }
  function updateWindow(idx: number, patch: Partial<Avail>) {
    setRows((p) => p.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function removeWindow(target: Avail) {
    setRows((p) => p.filter((r) => r !== target));
  }
  async function save() {
    const bad = rows.find((r) => r.endMin <= r.startMin);
    if (bad) {
      toast('Revisa los horarios: la hora de fin debe ser mayor a la de inicio', 'error');
      return;
    }
    setSaving(true);
    try {
      await api('/service-reservations/availability', {
        method: 'PUT',
        body: JSON.stringify({
          rows: rows.map((r) => ({ weekday: r.weekday, startMin: r.startMin, endMin: r.endMin })),
        }),
      });
      toast('Horarios guardados', 'success');
      onSaved();
    } catch (e: any) {
      toast(e.message ?? 'Error al guardar', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function addException(closed: boolean) {
    try {
      await api('/service-reservations/exceptions', {
        method: 'POST',
        body: JSON.stringify({ date: excDate, closed }),
      });
      toast('Excepción guardada', 'success');
      loadExc();
    } catch (e: any) {
      toast(e.message ?? 'Error', 'error');
    }
  }
  async function removeException(id: string) {
    try {
      await api(`/service-reservations/exceptions/${id}`, { method: 'DELETE' });
      loadExc();
    } catch (e: any) {
      toast(e.message ?? 'Error', 'error');
    }
  }

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-[12px]" style={{ background: 'white', border: '1px solid #e7e9ec' }}>
        <div className="text-xs font-bold uppercase mb-2" style={{ color: '#6b7280' }}>
          Horario semanal
        </div>
        <div className="space-y-2">
          {WEEKDAYS.map((w) => (
            <div key={w.n} className="flex flex-wrap items-center gap-2">
              <div className="w-24 text-sm font-semibold" style={{ color: '#334155' }}>{w.label}</div>
              <div className="flex flex-wrap items-center gap-2 flex-1">
                {byDay[w.n].length === 0 && (
                  <span className="text-[12px]" style={{ color: '#9aa4af' }}>Cerrado</span>
                )}
                {rows.map((r, idx) =>
                  r.weekday === w.n ? (
                    <span key={idx} className="inline-flex items-center gap-1">
                      <input type="time" className="rounded-[8px] border border-[#dfe3e8] px-2 py-1 text-sm" value={minToHhmm(r.startMin)} onChange={(e) => updateWindow(idx, { startMin: hhmmToMin(e.target.value) })} />
                      <span style={{ color: '#9aa4af' }}>–</span>
                      <input type="time" className="rounded-[8px] border border-[#dfe3e8] px-2 py-1 text-sm" value={minToHhmm(r.endMin)} onChange={(e) => updateWindow(idx, { endMin: hhmmToMin(e.target.value) })} />
                      <button onClick={() => removeWindow(r)} className="text-[13px]" style={{ color: '#b91c1c' }} title="Quitar franja">×</button>
                    </span>
                  ) : null,
                )}
                <button onClick={() => addWindow(w.n)} className="text-[12px] font-semibold" style={{ color: '#0ea5e9' }}>+ franja</button>
              </div>
            </div>
          ))}
        </div>
        <button onClick={save} disabled={saving} className="mt-3 text-sm font-semibold text-white rounded-[10px] py-2 px-4" style={{ background: '#16a34a', opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Guardando…' : 'Guardar horarios'}
        </button>
      </div>

      <div className="p-3 rounded-[12px]" style={{ background: 'white', border: '1px solid #e7e9ec' }}>
        <div className="text-xs font-bold uppercase mb-2" style={{ color: '#6b7280' }}>
          Días cerrados / excepciones
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" className="rounded-[8px] border border-[#dfe3e8] px-2 py-1.5 text-sm" value={excDate} onChange={(e) => setExcDate(e.target.value)} />
          <button onClick={() => addException(true)} className="text-sm font-semibold rounded-[10px] py-1.5 px-3" style={{ background: '#fef2f2', color: '#ef4444' }}>
            Marcar cerrado
          </button>
        </div>
        {exceptions.length > 0 && (
          <div className="mt-2 space-y-1">
            {exceptions.map((x) => (
              <div key={x.id} className="flex items-center justify-between text-[13px] px-2 py-1 rounded" style={{ background: '#f8fafc' }}>
                <span>{x.date?.slice(0, 10)} · {x.closed ? 'Cerrado' : `${minToHhmm(x.startMin ?? 0)}–${minToHhmm(x.endMin ?? 0)}`}</span>
                <button onClick={() => removeException(x.id)} style={{ color: '#b91c1c' }} className="text-[11px] font-semibold">Quitar</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────── Tab: Agenda ─────────────────────
function AgendaTab({
  services,
  timezone,
}: {
  services: Service[];
  timezone: string;
}) {
  const [date, setDate] = useState(todayStr());
  const [appts, setAppts] = useState<Appt[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const fmtTime = (iso: string) =>
    new Intl.DateTimeFormat('es-CO', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAppts(
        (await api<Appt[]>(
          `/service-reservations/appointments?from=${date}&to=${date}`,
        )) ?? [],
      );
    } catch {
      setAppts([]);
    } finally {
      setLoading(false);
    }
  }, [date]);
  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(id: string, status: string) {
    try {
      await api(`/service-reservations/appointments/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      load();
    } catch (e: any) {
      toast(e.message ?? 'Error', 'error');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input type="date" className="rounded-[8px] border border-[#dfe3e8] px-2 py-1.5 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
        <button onClick={() => setShowNew(true)} disabled={services.length === 0} className="ml-auto text-sm font-semibold text-white rounded-[10px] py-1.5 px-3" style={{ background: '#16a34a', opacity: services.length === 0 ? 0.5 : 1 }} title={services.length === 0 ? 'Crea un servicio primero' : 'Agendar una cita'}>
          + Nueva cita
        </button>
      </div>

      {loading ? (
        <div className="text-sm" style={{ color: '#9aa4af' }}>Cargando…</div>
      ) : appts.length === 0 ? (
        <div className="text-sm rounded-lg px-3 py-6 text-center" style={{ color: '#9aa4af', border: '1px dashed #e5e7eb' }}>
          No hay citas para este día.
        </div>
      ) : (
        <div className="space-y-1.5">
          {appts.map((a) => {
            const st = APPT_STATUS[a.status] ?? APPT_STATUS.confirmed;
            const done = a.status === 'cancelled' || a.status === 'no_show' || a.status === 'completed';
            return (
              <div key={a.id} className="p-3 rounded-[12px]" style={{ background: 'white', border: '1px solid #e7e9ec', opacity: a.status === 'cancelled' ? 0.6 : 1 }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold" style={{ color: '#16241c' }}>
                      {fmtTime(a.startAt)}–{fmtTime(a.endAt)} · {a.service?.name ?? 'Servicio'}
                    </div>
                    <div className="text-[12.5px]" style={{ color: '#6b7785' }}>
                      {a.customerName} · {a.customerPhone}
                    </div>
                    {a.notes && <div className="text-[11px] mt-0.5" style={{ color: '#9aa4af' }}>{a.notes}</div>}
                  </div>
                  <span className="text-[10px] font-bold px-2 py-1 rounded-full shrink-0" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
                </div>
                {!done && (
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold">
                    {a.status !== 'confirmed' && (
                      <button onClick={() => setStatus(a.id, 'confirmed')} style={{ color: '#1d4ed8' }}>Confirmar</button>
                    )}
                    <button onClick={() => setStatus(a.id, 'completed')} style={{ color: '#15803d' }}>Completar</button>
                    <button onClick={() => setStatus(a.id, 'no_show')} style={{ color: '#6b7280' }}>No asistió</button>
                    <button onClick={() => { if (confirm('¿Cancelar esta cita?')) setStatus(a.id, 'cancelled'); }} style={{ color: '#b91c1c' }} className="ml-auto">Cancelar</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showNew && (
        <NewAppointmentModal
          services={services.filter((s) => s.isActive)}
          defaultDate={date}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function NewAppointmentModal({
  services,
  defaultDate,
  onClose,
  onCreated,
}: {
  services: Service[];
  defaultDate: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [date, setDate] = useState(defaultDate);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slot, setSlot] = useState('');
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  const loadSlots = useCallback(async () => {
    if (!serviceId || !date) return;
    setLoadingSlots(true);
    setSlot('');
    try {
      const r = await api<{ slots: Slot[] }>(
        `/service-reservations/slots?serviceId=${serviceId}&date=${date}`,
      );
      setSlots(r?.slots ?? []);
    } catch {
      setSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  }, [serviceId, date]);
  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  async function create() {
    if (!serviceId || !slot) {
      toast('Elige servicio y horario', 'error');
      return;
    }
    if (!name.trim() || phone.trim().length < 6) {
      toast('Nombre y teléfono del cliente', 'error');
      return;
    }
    setBusy(true);
    try {
      await api('/service-reservations/appointments', {
        method: 'POST',
        body: JSON.stringify({
          serviceId,
          startAt: slot,
          customerName: name.trim(),
          customerPhone: phone.trim(),
        }),
      });
      toast('Cita agendada', 'success');
      onCreated();
    } catch (e: any) {
      toast(e.message ?? 'Error al agendar', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="bg-white rounded-2xl p-4 w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="font-semibold text-sm mb-3">Nueva cita</div>
        <label className="block text-[11px] font-semibold mb-1" style={{ color: '#64748b' }}>Servicio</label>
        <select className={inp + ' mb-2'} value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          {services.map((s) => (
            <option key={s.id} value={s.id}>{s.name} ({s.durationMin} min)</option>
          ))}
        </select>
        <label className="block text-[11px] font-semibold mb-1" style={{ color: '#64748b' }}>Fecha</label>
        <input type="date" className={inp + ' mb-2'} value={date} onChange={(e) => setDate(e.target.value)} />
        <label className="block text-[11px] font-semibold mb-1" style={{ color: '#64748b' }}>Horario</label>
        {loadingSlots ? (
          <div className="text-[12px] mb-2" style={{ color: '#9aa4af' }}>Buscando horarios…</div>
        ) : slots.length === 0 ? (
          <div className="text-[12px] mb-2" style={{ color: '#a16207' }}>Sin horarios disponibles ese día.</div>
        ) : (
          <div className="flex flex-wrap gap-1.5 mb-2 max-h-32 overflow-auto">
            {slots.map((s) => (
              <button key={s.startAt} onClick={() => setSlot(s.startAt)} className="text-[12px] font-semibold rounded-[8px] px-2 py-1" style={slot === s.startAt ? { background: '#0ea5e9', color: 'white' } : { background: '#f1f5f9', color: '#334155' }}>
                {s.label}
              </button>
            ))}
          </div>
        )}
        <input className={inp + ' mb-2'} placeholder="Nombre del cliente" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={inp + ' mb-3'} placeholder="Teléfono" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 text-sm font-semibold rounded-[10px] py-2" style={{ border: '1px solid #e5e7eb', color: '#475569' }}>Cancelar</button>
          <button onClick={create} disabled={busy || !slot} className="flex-1 text-sm font-semibold text-white rounded-[10px] py-2" style={{ background: '#16a34a', opacity: busy || !slot ? 0.6 : 1 }}>
            {busy ? '…' : 'Agendar'}
          </button>
        </div>
      </div>
    </div>
  );
}
