'use client';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PhoneInput } from '@/components/PhoneInput';
import { useTenantCountry } from '@/lib/useTenantCountry';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

type Recurrence = 'DAILY' | 'WEEKLY' | 'MONTHLY';
type Reminder = {
  id: string;
  employeeId: string | null;
  employeeName: string;
  employeePhone: string;
  recurrence: Recurrence;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  timeOfDay: string;
  message: string;
  isActive: boolean;
  lastSentAt: string | null;
};
type Staff = { id: string; fullName: string; phone: string | null };

const DAY_KEYS = [
  'daySunday',
  'dayMonday',
  'dayTuesday',
  'dayWednesday',
  'dayThursday',
  'dayFriday',
  'daySaturday',
];

const RECURRENCE_LABEL_KEY: Record<Recurrence, string> = {
  DAILY: 'recurrenceDaily',
  WEEKLY: 'recurrenceWeekly',
  MONTHLY: 'recurrenceMonthly',
};

const empty = {
  employeeId: '',
  employeeName: '',
  employeePhone: '',
  recurrence: 'WEEKLY' as Recurrence,
  dayOfWeek: 1,
  dayOfMonth: 1,
  timeOfDay: '09:00',
  message: '',
};

export default function RemindersPage() {
  const t = useTranslations('app_admin_reminders');
  const country = useTenantCountry();
  const [list, setList] = useState<Reminder[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [form, setForm] = useState(empty);
  const [showSend, setShowSend] = useState(false);
  const [sendForm, setSendForm] = useState({ phone: '', message: '' });
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [rs, st] = await Promise.all([
        api<Reminder[]>('/admin/reminders'),
        api<Staff[]>('/tenants/me/staff').catch(() => []),
      ]);
      setList(rs);
      setStaff(st);
    } catch (e: any) {
      toast(e.message || t('errorLoading'), 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditing(null);
    setForm(empty);
    setShowForm(true);
  }
  function openEdit(r: Reminder) {
    setEditing(r);
    setForm({
      employeeId: r.employeeId ?? '',
      employeeName: r.employeeName,
      employeePhone: r.employeePhone,
      recurrence: r.recurrence,
      dayOfWeek: r.dayOfWeek ?? 1,
      dayOfMonth: r.dayOfMonth ?? 1,
      timeOfDay: r.timeOfDay,
      message: r.message,
    });
    setShowForm(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.employeeName.trim() || !form.employeePhone.trim() || !form.message.trim()) {
      toast(t('errorMissingRequired'), 'error');
      return;
    }
    setBusy(true);
    try {
      const payload: any = {
        employeeId: form.employeeId || null,
        employeeName: form.employeeName.trim(),
        employeePhone: form.employeePhone.trim(),
        recurrence: form.recurrence,
        timeOfDay: form.timeOfDay,
        message: form.message,
      };
      if (form.recurrence === 'WEEKLY') payload.dayOfWeek = form.dayOfWeek;
      if (form.recurrence === 'MONTHLY') payload.dayOfMonth = form.dayOfMonth;

      if (editing) {
        await api(`/admin/reminders/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        toast(t('toastUpdated'), 'success');
      } else {
        await api('/admin/reminders', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast(t('toastCreated'), 'success');
      }
      setShowForm(false);
      await load();
    } catch (e: any) {
      toast(e.message || t('errorSaving'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function togglePause(r: Reminder) {
    try {
      await api(`/admin/reminders/${r.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !r.isActive }),
      });
      toast(r.isActive ? t('toastPaused') : t('toastActivated'), 'success');
      await load();
    } catch (e: any) {
      toast(e.message || t('error'), 'error');
    }
  }

  async function remove(r: Reminder) {
    if (!confirm(t('confirmDelete', { name: r.employeeName }))) return;
    try {
      await api(`/admin/reminders/${r.id}`, { method: 'DELETE' });
      toast(t('toastDeleted'), 'success');
      await load();
    } catch (e: any) {
      toast(e.message || t('error'), 'error');
    }
  }

  async function sendOne(e: React.FormEvent) {
    e.preventDefault();
    if (!sendForm.phone.trim() || !sendForm.message.trim()) {
      toast(t('errorMissingData'), 'error');
      return;
    }
    setBusy(true);
    try {
      await api('/admin/reminders/send', {
        method: 'POST',
        body: JSON.stringify(sendForm),
      });
      toast(t('toastMessageSent'), 'success');
      setShowSend(false);
      setSendForm({ phone: '', message: '' });
    } catch (e: any) {
      toast(e.message || t('errorSending'), 'error');
    } finally {
      setBusy(false);
    }
  }

  const stats = useMemo(() => ({
    total: list.length,
    active: list.filter((r) => r.isActive).length,
    paused: list.filter((r) => !r.isActive).length,
  }), [list]);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          {t('title')} <span className="page-crumb">{t('subtitle')}</span>
        </h1>
        <div className="flex gap-2">
          <button className="btn" onClick={() => setShowSend(true)}>
            <Icon name="send" /> {t('sendMessage')}
          </button>
          <button className="btn-primary" onClick={openCreate}>
            <Icon name="plus" /> {t('newReminder')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Kpi label={t('kpiTotal')} value={stats.total} />
        <Kpi label={t('kpiActive')} value={stats.active} accent="ok" />
        <Kpi label={t('kpiPaused')} value={stats.paused} accent="warn" />
      </div>

      <div className="card overflow-hidden">
        <div className="grid grid-cols-[1.4fr_1.2fr_2fr_0.8fr_0.9fr_auto] gap-3 px-4 py-3 text-[11px] uppercase tracking-wider text-mute font-semibold border-b border-line">
          <div>{t('colTeam')}</div>
          <div>{t('colRecurrence')}</div>
          <div>{t('colMessage')}</div>
          <div>{t('colStatus')}</div>
          <div>{t('colLastSent')}</div>
          <div></div>
        </div>
        {loading && (
          <div className="p-6 text-center text-mute text-sm">{t('loading')}</div>
        )}
        {!loading && list.length === 0 && (
          <div className="p-12 text-center">
            <div className="text-5xl mb-3">📋</div>
            <div className="font-semibold">{t('emptyTitle')}</div>
            <div className="text-sm text-mute mt-1.5 max-w-md mx-auto">
              {t('emptyDesc')}
            </div>
            <button className="btn-primary mt-4" onClick={openCreate}>
              <Icon name="plus" /> {t('createFirst')}
            </button>
          </div>
        )}
        {!loading &&
          list.map((r) => (
            <div
              key={r.id}
              className="grid grid-cols-[1.4fr_1.2fr_2fr_0.8fr_0.9fr_auto] gap-3 px-4 py-3 border-b border-line items-center hover:bg-bg2/40 transition"
            >
              <div className="font-medium">{r.employeeName}</div>
              <div>
                <div className="inline-flex items-center gap-1.5">
                  <span className="badge-info text-[10px] uppercase">
                    {t(RECURRENCE_LABEL_KEY[r.recurrence])}
                  </span>
                  <span className="text-xs text-mute">
                    {r.recurrence === 'DAILY' && t('scheduleEveryDay')}
                    {r.recurrence === 'WEEKLY' &&
                      t('scheduleEveryWeekday', {
                        day: t(DAY_KEYS[r.dayOfWeek ?? 1]),
                      })}
                    {r.recurrence === 'MONTHLY' &&
                      t('scheduleDayOfMonth', { day: r.dayOfMonth ?? 1 })}
                  </span>
                </div>
                <div className="text-[11px] text-mute mt-0.5">
                  {t('atTime', { time: r.timeOfDay })}
                </div>
              </div>
              <div className="text-sm text-ink/85 line-clamp-2">{r.message}</div>
              <div>
                {r.isActive ? (
                  <span className="badge-ok">{t('statusActive')}</span>
                ) : (
                  <span className="badge-warn">{t('statusPaused')}</span>
                )}
              </div>
              <div className="text-xs text-mute">
                {r.lastSentAt
                  ? new Date(r.lastSentAt).toISOString().slice(0, 10)
                  : '—'}
              </div>
              <div className="flex items-center gap-2 text-mute">
                <button
                  type="button"
                  title={r.isActive ? t('pause') : t('activate')}
                  onClick={() => togglePause(r)}
                  className="hover:text-ink"
                >
                  {r.isActive ? '⏸' : '▶'}
                </button>
                <button
                  type="button"
                  title={t('edit')}
                  onClick={() => openEdit(r)}
                  className="hover:text-ink"
                >
                  <Icon name="edit" />
                </button>
                <button
                  type="button"
                  title={t('delete')}
                  onClick={() => remove(r)}
                  className="hover:text-red-500"
                >
                  <Icon name="trash" />
                </button>
              </div>
            </div>
          ))}
      </div>

      <p className="text-[11px] text-mute mt-4 leading-relaxed">
        {t('footerNote')}
      </p>

      {/* ─────────── Modal: crear / editar ─────────── */}
      {showForm && (
        <Modal title={editing ? t('editReminder') : t('newReminder')} onClose={() => setShowForm(false)}>
          <form onSubmit={save} className="space-y-4">
            <Field label={t('fieldTeamMember')}>
              <select
                className="input"
                value={form.employeeId}
                onChange={(e) => {
                  const id = e.target.value;
                  const s = staff.find((x) => x.id === id);
                  setForm((f) => ({
                    ...f,
                    employeeId: id,
                    employeeName: s?.fullName ?? f.employeeName,
                    employeePhone: s?.phone ?? f.employeePhone,
                  }));
                }}
              >
                <option value="">{t('optionOtherManual')}</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName} {s.phone ? `· ${s.phone}` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('fieldName')}>
                <input
                  className="input"
                  value={form.employeeName}
                  onChange={(e) => setForm({ ...form, employeeName: e.target.value })}
                />
              </Field>
              <Field label={t('fieldWhatsappSms')}>
                <PhoneInput
                  value={form.employeePhone}
                  onChange={(v) => setForm({ ...form, employeePhone: v })}
                  defaultCountry={country}
                />
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field label={t('fieldRecurrence')}>
                <select
                  className="input"
                  value={form.recurrence}
                  onChange={(e) => setForm({ ...form, recurrence: e.target.value as Recurrence })}
                >
                  <option value="DAILY">{t('recurrenceDaily')}</option>
                  <option value="WEEKLY">{t('recurrenceWeekly')}</option>
                  <option value="MONTHLY">{t('recurrenceMonthly')}</option>
                </select>
              </Field>

              {form.recurrence === 'WEEKLY' && (
                <Field label={t('fieldDay')}>
                  <select
                    className="input"
                    value={form.dayOfWeek}
                    onChange={(e) => setForm({ ...form, dayOfWeek: Number(e.target.value) })}
                  >
                    {DAY_KEYS.map((d, i) => <option key={i} value={i}>{t(d)}</option>)}
                  </select>
                </Field>
              )}
              {form.recurrence === 'MONTHLY' && (
                <Field label={t('fieldDayOfMonth')}>
                  <input
                    type="number"
                    min={1}
                    max={28}
                    className="input"
                    value={form.dayOfMonth}
                    onChange={(e) => setForm({ ...form, dayOfMonth: Number(e.target.value) })}
                  />
                </Field>
              )}
              <Field label={t('fieldTime')}>
                <input
                  type="time"
                  className="input"
                  value={form.timeOfDay}
                  onChange={(e) => setForm({ ...form, timeOfDay: e.target.value })}
                />
              </Field>
            </div>

            <Field label={t('fieldMessage')}>
              <textarea
                className="input min-h-[100px]"
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder={t('placeholderMessage')}
              />
            </Field>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn" onClick={() => setShowForm(false)}>
                {t('cancel')}
              </button>
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? t('saving') : editing ? t('save') : t('create')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ─────────── Modal: enviar one-off ─────────── */}
      {showSend && (
        <Modal title={t('sendMessage')} onClose={() => setShowSend(false)}>
          <form onSubmit={sendOne} className="space-y-4">
            <Field label={t('fieldPhoneWhatsapp')}>
              <PhoneInput
                value={sendForm.phone}
                onChange={(v) => setSendForm({ ...sendForm, phone: v })}
                defaultCountry={country}
              />
            </Field>
            <Field label={t('fieldMessage')}>
              <textarea
                className="input min-h-[120px]"
                value={sendForm.message}
                onChange={(e) => setSendForm({ ...sendForm, message: e.target.value })}
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn" onClick={() => setShowSend(false)}>
                {t('cancel')}
              </button>
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? t('sending') : t('sendNow')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider font-semibold text-mute mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function Kpi({ label, value, accent }: { label: string; value: number; accent?: 'ok' | 'warn' }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${accent === 'ok' ? 'text-ok' : accent === 'warn' ? 'text-amber-500' : ''}`}>
        {value}
      </div>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card rounded-2xl shadow-xl max-w-lg w-full p-5 max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-mute hover:text-ink text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
