'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PhoneInput } from '@/components/PhoneInput';
import { useTenantCountry } from '@/lib/useTenantCountry';
import { api } from '@/lib/api';
import { AcademyButton } from '@/components/AcademyButton';
import { toast } from '@/components/Toast';
import { uploadCoverImage } from '@/lib/menu/upload-cover-image';
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

const STATUS_META: Record<EventStatus, { labelKey: string; bg: string; fg: string }> = {
  DRAFT: { labelKey: 'statusDraft', bg: '#f3f4f6', fg: '#6b7280' },
  PUBLISHED: { labelKey: 'statusPublished', bg: '#dcfce7', fg: '#15803d' },
  CANCELLED: { labelKey: 'statusCancelled', bg: '#fef2f2', fg: '#dc2626' },
  COMPLETED: { labelKey: 'statusCompleted', bg: '#dbeafe', fg: '#1e40af' },
};

const ATTENDEE_STATUS_META: Record<AttendeeStatus, { labelKey: string; bg: string; fg: string }> = {
  CONFIRMED: { labelKey: 'attendeeConfirmed', bg: '#dcfce7', fg: '#15803d' },
  CHECKED_IN: { labelKey: 'attendeeCheckedIn', bg: '#dbeafe', fg: '#1e40af' },
  CANCELLED: { labelKey: 'attendeeCancelled', bg: '#f3f4f6', fg: '#6b7280' },
  NO_SHOW: { labelKey: 'attendeeNoShow', bg: '#fef2f2', fg: '#dc2626' },
};

export default function EventosPage() {
  const t = useTranslations('app_reservations_eventos');
  const [events, setEvents] = useState<EventItem[]>([]);
  const [filter, setFilter] = useState<'todos' | 'proximos' | 'pasados'>('proximos');
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  async function load() {
    try {
      const data = await api<EventItem[]>('/reservation-events');
      setEvents(data);
    } catch (e: any) {
      toast(e.message || t('errorLoadingEvents'), 'error');
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
            {t('pageTitle')}{' '}
            <span className="page-crumb text-mute font-normal">/ {fmtLongDate(todayISO())}</span>
          </h1>
          <p className="text-xs text-mute mt-1">
            {t('subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-ok-soft text-ok-ink text-xs font-semibold">
            <span className="relative inline-block w-2 h-2">
              <span className="absolute inset-0 rounded-full bg-ok animate-ping opacity-75" />
              <span className="absolute inset-0 rounded-full bg-ok" />
            </span>
            {t('realTime')}
          </div>
          <button onClick={() => setCreateOpen(true)} className="btn-primary text-sm">
            {t('newEvent')}
          </button>
          <AcademyButton moduleKey="eventos" />
        </div>
      </div>

      <div className="flex gap-1 bg-bg2 p-1 rounded-lg mb-4 w-fit">
        {([
          { v: 'proximos' as const, label: t('filterUpcoming') },
          { v: 'pasados' as const, label: t('filterPast') },
          { v: 'todos' as const, label: t('filterAll') },
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
            {events.length === 0 ? t('emptyNoEvents') : t('emptyNoEventsInFilter')}
          </h2>
          <p className="text-sm text-mute mt-2 max-w-md mx-auto leading-relaxed">
            {events.length === 0
              ? t('emptyNoEventsHint')
              : t('emptyChangeFilterHint')}
          </p>
          {events.length === 0 && (
            <button onClick={() => setCreateOpen(true)} className="btn-primary mt-5 text-sm">
              {t('createFirstEvent')}
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
  const t = useTranslations('app_reservations_eventos');
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
            {t(status.labelKey)}
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
              {t('attendeesCount', { count: attendeeCount, capacity: event.capacity })}
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
  const t = useTranslations('app_reservations_eventos');
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
      toast(t('errorNameRequired'), 'error');
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
      toast(initial ? t('toastEventUpdated') : t('toastEventCreated'), 'success');
      onSaved();
    } catch (err: any) {
      toast(err.message || t('errorCouldNotSave'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={initial ? t('editEvent') : t('newEvent')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-2">
        <Input
          label={t('fieldName')}
          required
          value={form.name}
          onChange={(v) => setForm({ ...form, name: v })}
          placeholder={t('fieldNamePlaceholder')}
        />
        <div>
          <label className="label">{t('fieldDescription')}</label>
          <textarea
            className="input"
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder={t('fieldDescriptionPlaceholder')}
          />
        </div>
        <CoverImagePicker
          value={form.coverImageUrl}
          onChange={(url) => setForm({ ...form, coverImageUrl: url })}
        />
        <div>
          <label className="label">{t('fieldDate')}</label>
          <input
            type="date"
            className="input"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">{t('fieldStart')}</label>
            <input
              type="time"
              className="input"
              value={form.startTime}
              onChange={(e) => setForm({ ...form, startTime: e.target.value })}
            />
          </div>
          <div>
            <label className="label">{t('fieldEnd')}</label>
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
            <label className="label">{t('fieldCapacity')}</label>
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
            <label className="label">{t('fieldPriceOptional')}</label>
            <input
              type="number"
              className="input"
              min={0}
              step="0.01"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              placeholder={t('fieldPricePlaceholder')}
            />
          </div>
          <div>
            <label className="label">{t('fieldCurrency')}</label>
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
          <label className="label">{t('fieldStatus')}</label>
          <select
            className="input"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as EventStatus })}
          >
            <option value="DRAFT">{t('statusDraftHidden')}</option>
            <option value="PUBLISHED">{t('statusPublishedVisible')}</option>
            <option value="CANCELLED">{t('statusCancelled')}</option>
            <option value="COMPLETED">{t('statusCompleted')}</option>
          </select>
        </div>
        <button className="btn-primary w-full justify-center mt-3" disabled={busy}>
          {busy ? t('saving') : initial ? t('saveChanges') : t('createEvent')}
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
  const t = useTranslations('app_reservations_eventos');
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [addAttendeeOpen, setAddAttendeeOpen] = useState(false);

  async function load() {
    try {
      const data = await api<EventDetail>(`/reservation-events/${eventId}`);
      setEvent(data);
    } catch (e: any) {
      toast(e.message || t('errorGeneric'), 'error');
      onClose();
    }
  }
  useEffect(() => {
    load();
  }, [eventId]);

  async function deleteEvent() {
    if (!event) return;
    if (!confirm(t('confirmDeleteEvent', { name: event.name }))) return;
    try {
      await api(`/reservation-events/${event.id}`, { method: 'DELETE' });
      toast(t('toastEventDeleted'), 'success');
      onChanged();
      onClose();
    } catch (e: any) {
      toast(e.message || t('errorCouldNotDelete'), 'error');
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
      toast(e.message || t('errorGeneric'), 'error');
    }
  }

  async function removeAttendee(attendeeId: string) {
    if (!confirm(t('confirmRemoveAttendee'))) return;
    try {
      await api(`/reservation-events/attendees/${attendeeId}`, { method: 'DELETE' });
      load();
      onChanged();
      toast(t('toastAttendeeRemoved'), 'success');
    } catch (e: any) {
      toast(e.message || t('errorGeneric'), 'error');
    }
  }

  if (!event) {
    return (
      <Modal title={t('loadingTitle')} onClose={onClose} wide>
        <div className="py-8 text-center text-mute text-sm">{t('loadingEvent')}</div>
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
              {t(status.labelKey)}
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
                {t('attendeesCountPct', { count: event.occupied, capacity: event.capacity, pct })}
              </span>
              <span className="text-mute">
                {t('spotsAvailable', { count: event.remaining })}
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
              {t('addAttendee')}
            </button>
            <button onClick={() => setEditOpen(true)} className="btn-ghost text-sm">
              ✏️ {t('editEventBtn')}
            </button>
            <button
              onClick={deleteEvent}
              className="text-sm font-semibold px-3 py-2 rounded-pill text-bad border border-bad"
            >
              🗑 {t('delete')}
            </button>
          </div>

          <div>
            <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-mute mb-2">
              {t('attendeesTitle', { count: event.attendees.length })}
            </div>
            {event.attendees.length === 0 ? (
              <p className="text-sm text-mute italic text-center py-4">{t('noAttendeesYet')}</p>
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
                          {a.customerPhone} · {t('peopleCount', { count: a.party })}
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
                        {t(sm.labelKey)}
                      </span>
                      <select
                        value={a.status}
                        onChange={(e) => changeAttendeeStatus(a.id, e.target.value as AttendeeStatus)}
                        className="text-[10px] border border-line rounded px-1.5 py-0.5 bg-white"
                      >
                        {Object.entries(ATTENDEE_STATUS_META).map(([v, m]) => (
                          <option key={v} value={v}>{t(m.labelKey)}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => removeAttendee(a.id)}
                        className="text-mute hover:text-bad text-base leading-none shrink-0"
                        title={t('remove')}
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
  const t = useTranslations('app_reservations_eventos');
  const country = useTenantCountry();
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
      toast(t('errorNamePhoneRequired'), 'error');
      return;
    }
    setBusy(true);
    try {
      await api(`/reservation-events/${eventId}/attendees`, {
        method: 'POST',
        body: JSON.stringify(form),
      });
      toast(t('toastAttendeeAdded'), 'success');
      onAdded();
    } catch (e: any) {
      toast(e.message || t('errorCouldNotAdd'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t('addAttendeeTitle')} onClose={onClose}>
      <p className="text-xs text-mute mb-3">{t('spotsAvailable', { count: remaining })}</p>
      <form onSubmit={submit} className="space-y-2">
        <Input
          label={t('fieldName')}
          required
          value={form.customerName}
          onChange={(v) => setForm({ ...form, customerName: v })}
        />
        <div>
          <label className="label">{t('fieldPhone')}</label>
          <PhoneInput
            value={form.customerPhone}
            onChange={(v) => setForm({ ...form, customerPhone: v })}
            defaultCountry={country}
          />
        </div>
        <Input
          label={t('fieldEmailOptional')}
          value={form.customerEmail}
          onChange={(v) => setForm({ ...form, customerEmail: v })}
        />
        <div>
          <label className="label">{t('fieldPartySize')}</label>
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
          <label className="label">{t('fieldNotesOptional')}</label>
          <textarea
            className="input"
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder={t('fieldNotesPlaceholder')}
          />
        </div>
        <button className="btn-primary w-full justify-center mt-3" disabled={busy}>
          {busy ? t('adding') : t('addAttendee')}
        </button>
      </form>
    </Modal>
  );
}

// =================================================================
// Helpers
// =================================================================

function CoverImagePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (url: string) => void;
}) {
  const t = useTranslations('app_reservations_eventos');
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File | null | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadCoverImage(file, 'reservations/events');
      onChange(url);
      toast(t('toastImageUploaded'), 'success');
    } catch (e: any) {
      toast(e.message || t('errorCouldNotUploadImage'), 'error');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    handleFile(e.dataTransfer.files?.[0]);
  }

  return (
    <div>
      <label className="label">{t('coverImage')}</label>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {value ? (
        <div className="relative rounded-xl overflow-hidden border border-line">
          <div
            className="bg-cover bg-center"
            style={{ backgroundImage: `url(${value})`, height: 140 }}
          />
          <div className="absolute inset-x-0 bottom-0 flex gap-1.5 p-2 bg-gradient-to-t from-black/60 to-transparent">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="text-[11px] font-semibold px-2.5 py-1 rounded bg-white text-ink"
            >
              {uploading ? t('uploading') : `🔄 ${t('change')}`}
            </button>
            <button
              type="button"
              onClick={() => onChange('')}
              className="text-[11px] font-semibold px-2.5 py-1 rounded bg-white/90 text-bad"
            >
              {t('remove')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          disabled={uploading}
          className="w-full rounded-xl border-2 border-dashed border-line bg-bg2/40 hover:bg-bg2 transition py-8 px-4 text-center"
        >
          {uploading ? (
            <div className="text-sm text-mute">{t('uploadingImage')}</div>
          ) : (
            <>
              <div className="text-2xl mb-1">🖼️</div>
              <div className="text-sm font-semibold">
                {t('clickOrDragImage')}
              </div>
              <div className="text-[11px] text-mute mt-0.5">
                {t('imageFormatsHint')}
              </div>
            </>
          )}
        </button>
      )}
    </div>
  );
}

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
