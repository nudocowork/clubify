'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { fmtLongDate, todayISO, to12h } from '../_shared';

type EventStatus = 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';
type AttendeeStatus = 'CONFIRMED' | 'CHECKED_IN' | 'CANCELLED' | 'NO_SHOW';

type EventItem = {
  id: string;
  name: string;
  description: string | null;
  coverImageUrl: string | null;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
  price: string | null;
  priceCurrency: string;
  status: EventStatus;
  locationId: string | null;
  location?: { id: string; name: string } | null;
  _count?: { attendees: number };
};

type Attendee = {
  id: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  party: number;
  notes: string | null;
  status: AttendeeStatus;
  checkInAt: string | null;
};

type EventDetail = EventItem & {
  attendees: Attendee[];
  remaining: number;
  occupied: number;
};

const STATUS_META: Record<EventStatus, { label: string; bg: string; fg: string }> = {
  DRAFT: { label: 'Borrador', bg: '#f3f4f6', fg: '#6b7280' },
  PUBLISHED: { label: 'Publicado', bg: '#dcfce7', fg: '#15803d' },
  CANCELLED: { label: 'Cancelado', bg: '#fef2f2', fg: '#dc2626' },
  COMPLETED: { label: 'Realizado', bg: '#dbeafe', fg: '#1e40af' },
};

const ATTENDEE_STATUS_META: Record<AttendeeStatus, { label: string; bg: string; fg: string }> = {
  CONFIRMED: { label: 'Confirmado', bg: '#dcfce7', fg: '#15803d' },
  CHECKED_IN: { label: 'Asistió', bg: '#dbeafe', fg: '#1e40af' },
  CANCELLED: { label: 'Cancelado', bg: '#f3f4f6', fg: '#6b7280' },
  NO_SHOW: { label: 'Ausente', bg: '#fef2f2', fg: '#dc2626' },
};

export default function EventosPage() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [filter, setFilter] = useState<'todos' | 'proximos' | 'pasados'>('proximos');
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  async function load() {
    try {
      const data = await api<EventItem[]>('/reservation-events');
      setEvents(data);
    } catch (e: any) {
      toast(e.message || 'Error cargando eventos', 'error');
    }
  }
  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const today = todayISO();
    return events.filter((e) => {
      const eventDay = e.date.slice(0, 10);
      if (filter === 'proximos') return eventDay >= today && e.status !== 'CANCELLED';
      if (filter === 'pasados') return eventDay < today || e.status === 'COMPLETED';
      return true;
    });
  }, [events, filter]);

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="page-title m-0">
            Eventos{' '}
            <span className="page-crumb text-mute font-normal">/ {fmtLongDate(todayISO())}</span>
          </h1>
          <p className="text-xs text-mute mt-1">
            Catas, conciertos, cenas especiales y eventos privados con cupo controlado.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-ok-soft text-ok-ink text-xs font-semibold">
            <span className="relative inline-block w-2 h-2">
              <span className="absolute inset-0 rounded-full bg-ok animate-ping opacity-75" />
              <span className="absolute inset-0 rounded-full bg-ok" />
            </span>
            Tiempo real
          </div>
          <button onClick={() => setCreateOpen(true)} className="btn-primary text-sm">
            + Nuevo evento
          </button>
        </div>
      </div>

      <div className="flex gap-1 bg-bg2 p-1 rounded-lg mb-4 w-fit">
        {([
          { v: 'proximos' as const, label: 'Próximos' },
          { v: 'pasados' as const, label: 'Pasados' },
          { v: 'todos' as const, label: 'Todos' },
        ]).map((f) => (
          <button
            key={f.v}
            onClick={() => setFilter(f.v)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-md transition ${
              filter === f.v ? 'bg-white text-ink shadow-sm' : 'text-mute hover:text-ink'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card card-pad text-center py-12 max-w-2xl mx-auto">
          <div
            className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center text-2xl mb-4"
            style={{ background: 'rgba(34,197,94,0.15)' }}
          >
            ✨
          </div>
          <h2 className="text-lg font-bold m-0">
            {events.length === 0 ? 'Sin eventos todavía' : 'Sin eventos en este filtro'}
          </h2>
          <p className="text-sm text-mute mt-2 max-w-md mx-auto leading-relaxed">
            {events.length === 0
              ? 'Crea tu primer evento: cata, cena especial, concierto o evento privado. El módulo gestiona cupos, horarios y asistentes.'
              : 'Cambia el filtro para ver otros eventos.'}
          </p>
          {events.length === 0 && (
            <button onClick={() => setCreateOpen(true)} className="btn-primary mt-5 text-sm">
              + Crear primer evento
            </button>
          )}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((e) => (
            <EventCard key={e.id} event={e} onClick={() => setDetailId(e.id)} />
          ))}
        </div>
      )}

      {createOpen && (
        <EventFormModal
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            load();
          }}
        />
      )}

      {detailId && (
        <EventDetailModal
          eventId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => {
            load();
          }}
        />
      )}
    </div>
  );
}

function EventCard({ event, onClick }: { event: EventItem; onClick: () => void }) {
  const status = STATUS_META[event.status];
  const dateStr = event.date.slice(0, 10);
  const attendeeCount = event._count?.attendees ?? 0;
  const pct = Math.min(100, Math.round((attendeeCount / event.capacity) * 100));
  return (
    <button
      onClick={onClick}
      className="card card-pad text-left hover:shadow-md transition relative overflow-hidden"
    >
      {event.coverImageUrl ? (
        <div
          className="absolute top-0 left-0 right-0 h-24 bg-cover bg-center"
          style={{ backgroundImage: `url(${event.coverImageUrl})` }}
        />
      ) : (
        <div
          className="absolute top-0 left-0 right-0 h-24"
          style={{
            background: 'linear-gradient(135deg, #064e3b, #0c4a6e)',
          }}
        />
      )}
      <div className="relative pt-20">
        <div className="flex items-center justify-between">
          <span
            className="inline-block text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider"
            style={{ background: status.bg, color: status.fg }}
          >
            {status.label}
          </span>
          {event.price && (
            <span className="text-sm font-bold text-ink">
              ${Number(event.price).toLocaleString()} {event.priceCurrency}
            </span>
          )}
        </div>
        <h3 className="font-bold text-base mt-2 truncate">{event.name}</h3>
        <div className="text-xs text-mute mt-1">
          📅 {dateStr} · {to12h(event.startTime)} – {to12h(event.endTime)}
        </div>
        {event.location && (
          <div className="text-xs text-mute mt-0.5">📍 {event.location.name}</div>
        )}
        {event.description && (
          <p className="text-xs text-mute mt-2 line-clamp-2 leading-snug">{event.description}</p>
        )}

        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-mute mb-1">
            <span>
              {attendeeCount} / {event.capacity} asistentes
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 bg-bg2 rounded overflow-hidden">
            <div
              className="h-full transition-all"
              style={{
                width: `${pct}%`,
                background: pct >= 90 ? '#dc2626' : pct >= 60 ? '#f59e0b' : '#22C55E',
              }}
            />
          </div>
        </div>
      </div>
    </button>
  );
}

function EventFormModal({
  onClose,
  onSaved,
  initial,
}: {
  onClose: () => void;
  onSaved: () => void;
  initial?: EventItem;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    coverImageUrl: initial?.coverImageUrl ?? '',
    date: initial?.date?.slice(0, 10) ?? todayISO(),
    startTime: initial?.startTime ?? '20:00',
    endTime: initial?.endTime ?? '23:00',
    capacity: initial?.capacity ?? 30,
    price: initial?.price ?? '',
    priceCurrency: initial?.priceCurrency ?? 'MXN',
    status: (initial?.status ?? 'PUBLISHED') as EventStatus,
  });
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast('Nombre requerido', 'error');
      return;
    }
    setBusy(true);
    try {
      const body: any = {
        ...form,
        capacity: Number(form.capacity),
        price: form.price ? Number(form.price) : null,
      };
      if (initial) {
        await api(`/reservation-events/${initial.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      } else {
        await api('/reservation-events', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }
      toast(initial ? 'Evento actualizado' : 'Evento creado', 'success');
      onSaved();
    } catch (err: any) {
      toast(err.message || 'No se pudo guardar', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={initial ? 'Editar evento' : '+ Nuevo evento'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-2">
        <Input
          label="Nombre"
          required
          value={form.name}
          onChange={(v) => setForm({ ...form, name: v })}
          placeholder="Cata de vinos · Noche de jazz · Cena maridaje"
        />
        <div>
          <label className="label">Descripción</label>
          <textarea
            className="input"
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Información del evento que verán los clientes"
          />
        </div>
        <Input
          label="Imagen de portada (URL)"
          value={form.coverImageUrl}
          onChange={(v) => setForm({ ...form, coverImageUrl: v })}
          placeholder="https://..."
        />
        <div>
          <label className="label">Fecha</label>
          <input
            type="date"
            className="input"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Inicio</label>
            <input
              type="time"
              className="input"
              value={form.startTime}
              onChange={(e) => setForm({ ...form, startTime: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Fin</label>
            <input
              type="time"
              className="input"
              value={form.endTime}
              onChange={(e) => setForm({ ...form, endTime: e.target.value })}
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="label">Cupo</label>
            <input
              type="number"
              className="input"
              min={1}
              max={10000}
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: e.target.value as any })}
            />
          </div>
          <div>
            <label className="label">Precio (opcional)</label>
            <input
              type="number"
              className="input"
              min={0}
              step="0.01"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              placeholder="0 = gratis"
            />
          </div>
          <div>
            <label className="label">Moneda</label>
            <select
              className="input"
              value={form.priceCurrency}
              onChange={(e) => setForm({ ...form, priceCurrency: e.target.value })}
            >
              <option value="MXN">MXN</option>
              <option value="COP">COP</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">Estado</label>
          <select
            className="input"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as EventStatus })}
          >
            <option value="DRAFT">Borrador (oculto)</option>
            <option value="PUBLISHED">Publicado (visible)</option>
            <option value="CANCELLED">Cancelado</option>
            <option value="COMPLETED">Realizado</option>
          </select>
        </div>
        <button className="btn-primary w-full justify-center mt-3" disabled={busy}>
          {busy ? 'Guardando…' : initial ? 'Guardar cambios' : 'Crear evento'}
        </button>
      </form>
    </Modal>
  );
}

function EventDetailModal({
  eventId,
  onClose,
  onChanged,
}: {
  eventId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [addAttendeeOpen, setAddAttendeeOpen] = useState(false);

  async function load() {
    try {
      const data = await api<EventDetail>(`/reservation-events/${eventId}`);
      setEvent(data);
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
      onClose();
    }
  }
  useEffect(() => {
    load();
  }, [eventId]);

  async function deleteEvent() {
    if (!event) return;
    if (!confirm(`¿Eliminar evento "${event.name}"? También se borran sus asistentes.`)) return;
    try {
      await api(`/reservation-events/${event.id}`, { method: 'DELETE' });
      toast('Evento eliminado', 'success');
      onChanged();
      onClose();
    } catch (e: any) {
      toast(e.message || 'No se pudo eliminar', 'error');
    }
  }

  async function changeAttendeeStatus(attendeeId: string, status: AttendeeStatus) {
    try {
      await api(`/reservation-events/attendees/${attendeeId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      load();
      onChanged();
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
    }
  }

  async function removeAttendee(attendeeId: string) {
    if (!confirm('¿Quitar este asistente?')) return;
    try {
      await api(`/reservation-events/attendees/${attendeeId}`, { method: 'DELETE' });
      load();
      onChanged();
      toast('Asistente quitado', 'success');
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
    }
  }

  if (!event) {
    return (
      <Modal title="Cargando…" onClose={onClose} wide>
        <div className="py-8 text-center text-mute text-sm">Cargando evento…</div>
      </Modal>
    );
  }

  const status = STATUS_META[event.status];
  const pct = Math.min(100, Math.round((event.occupied / event.capacity) * 100));

  return (
    <>
      <Modal title={event.name} onClose={onClose} wide>
        <div className="space-y-4">
          {event.coverImageUrl && (
            <div
              className="rounded-xl overflow-hidden bg-cover bg-center"
              style={{ backgroundImage: `url(${event.coverImageUrl})`, height: 160 }}
            />
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider"
              style={{ background: status.bg, color: status.fg }}
            >
              {status.label}
            </span>
            <span className="text-xs text-mute">
              📅 {event.date.slice(0, 10)} · {to12h(event.startTime)} – {to12h(event.endTime)}
            </span>
            {event.price && (
              <span className="text-xs font-semibold">
                💰 ${Number(event.price).toLocaleString()} {event.priceCurrency}
              </span>
            )}
          </div>
          {event.description && (
            <p className="text-sm text-mute leading-relaxed">{event.description}</p>
          )}

          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-semibold">
                {event.occupied} / {event.capacity} asistentes ({pct}%)
              </span>
              <span className="text-mute">
                {event.remaining} cupos disponibles
              </span>
            </div>
            <div className="h-2 bg-bg2 rounded overflow-hidden">
              <div
                className="h-full transition-all"
                style={{
                  width: `${pct}%`,
                  background: pct >= 90 ? '#dc2626' : pct >= 60 ? '#f59e0b' : '#22C55E',
                }}
              />
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setAddAttendeeOpen(true)}
              className="btn-primary text-sm"
              disabled={event.remaining === 0}
            >
              + Agregar asistente
            </button>
            <button onClick={() => setEditOpen(true)} className="btn-ghost text-sm">
              ✏️ Editar evento
            </button>
            <button
              onClick={deleteEvent}
              className="text-sm font-semibold px-3 py-2 rounded-pill text-bad border border-bad"
            >
              🗑 Eliminar
            </button>
          </div>

          <div>
            <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-mute mb-2">
              Asistentes ({event.attendees.length})
            </div>
            {event.attendees.length === 0 ? (
              <p className="text-sm text-mute italic text-center py-4">Sin asistentes todavía.</p>
            ) : (
              <div className="space-y-1.5">
                {event.attendees.map((a) => {
                  const sm = ATTENDEE_STATUS_META[a.status];
                  return (
                    <div
                      key={a.id}
                      className="flex items-center gap-3 p-2.5 rounded-lg bg-bg2/40"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{a.customerName}</div>
                        <div className="text-[11px] text-mute">
                          {a.customerPhone} · {a.party} {a.party === 1 ? 'persona' : 'personas'}
                        </div>
                        {a.notes && (
                          <div className="text-[11px] text-mute italic mt-0.5 line-clamp-1">
                            📝 {a.notes}
                          </div>
                        )}
                      </div>
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded shrink-0"
                        style={{ background: sm.bg, color: sm.fg }}
                      >
                        {sm.label}
                      </span>
                      <select
                        value={a.status}
                        onChange={(e) => changeAttendeeStatus(a.id, e.target.value as AttendeeStatus)}
                        className="text-[10px] border border-line rounded px-1.5 py-0.5 bg-white"
                      >
                        {Object.entries(ATTENDEE_STATUS_META).map(([v, m]) => (
                          <option key={v} value={v}>{m.label}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => removeAttendee(a.id)}
                        className="text-mute hover:text-bad text-base leading-none shrink-0"
                        title="Quitar"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {editOpen && (
        <EventFormModal
          initial={event}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            load();
            onChanged();
          }}
        />
      )}

      {addAttendeeOpen && (
        <AddAttendeeModal
          eventId={event.id}
          remaining={event.remaining}
          onClose={() => setAddAttendeeOpen(false)}
          onAdded={() => {
            setAddAttendeeOpen(false);
            load();
            onChanged();
          }}
        />
      )}
    </>
  );
}

function AddAttendeeModal({
  eventId,
  remaining,
  onClose,
  onAdded,
}: {
  eventId: string;
  remaining: number;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [form, setForm] = useState({
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    party: 1,
    notes: '',
  });
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.customerName.trim() || !form.customerPhone.trim()) {
      toast('Nombre y teléfono son obligatorios', 'error');
      return;
    }
    setBusy(true);
    try {
      await api(`/reservation-events/${eventId}/attendees`, {
        method: 'POST',
        body: JSON.stringify(form),
      });
      toast('Asistente agregado', 'success');
      onAdded();
    } catch (e: any) {
      toast(e.message || 'No se pudo agregar', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="+ Agregar asistente" onClose={onClose}>
      <p className="text-xs text-mute mb-3">{remaining} cupos disponibles</p>
      <form onSubmit={submit} className="space-y-2">
        <Input
          label="Nombre"
          required
          value={form.customerName}
          onChange={(v) => setForm({ ...form, customerName: v })}
        />
        <Input
          label="Teléfono"
          required
          value={form.customerPhone}
          onChange={(v) => setForm({ ...form, customerPhone: v })}
          placeholder="+52 55 0000 0000"
        />
        <Input
          label="Email (opcional)"
          value={form.customerEmail}
          onChange={(v) => setForm({ ...form, customerEmail: v })}
        />
        <div>
          <label className="label">Cantidad de personas</label>
          <input
            type="number"
            className="input"
            min={1}
            max={50}
            value={form.party}
            onChange={(e) => setForm({ ...form, party: Number(e.target.value) })}
          />
        </div>
        <div>
          <label className="label">Notas (opcional)</label>
          <textarea
            className="input"
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Alergias, accesibilidad, etc."
          />
        </div>
        <button className="btn-primary w-full justify-center mt-3" disabled={busy}>
          {busy ? 'Agregando…' : 'Agregar asistente'}
        </button>
      </form>
    </Modal>
  );
}

// =================================================================
// Helpers
// =================================================================

function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className={`bg-white rounded-2xl shadow-2xl w-full p-5 my-8 ${wide ? 'max-w-2xl' : 'max-w-md'}`}
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
