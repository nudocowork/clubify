'use client';
import { useEffect, useMemo, useState } from 'react';
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

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const RECURRENCE_LABEL: Record<Recurrence, string> = {
  DAILY: 'Diario',
  WEEKLY: 'Semanal',
  MONTHLY: 'Mensual',
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
      toast(e.message || 'Error cargando', 'error');
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
      toast('Faltan datos obligatorios', 'error');
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
        toast('Recordatorio actualizado', 'success');
      } else {
        await api('/admin/reminders', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast('Recordatorio creado', 'success');
      }
      setShowForm(false);
      await load();
    } catch (e: any) {
      toast(e.message || 'Error guardando', 'error');
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
      toast(r.isActive ? 'Pausado' : 'Activado', 'success');
      await load();
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
    }
  }

  async function remove(r: Reminder) {
    if (!confirm(`¿Eliminar el recordatorio de ${r.employeeName}?`)) return;
    try {
      await api(`/admin/reminders/${r.id}`, { method: 'DELETE' });
      toast('Eliminado', 'success');
      await load();
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
    }
  }

  async function sendOne(e: React.FormEvent) {
    e.preventDefault();
    if (!sendForm.phone.trim() || !sendForm.message.trim()) {
      toast('Faltan datos', 'error');
      return;
    }
    setBusy(true);
    try {
      await api('/admin/reminders/send', {
        method: 'POST',
        body: JSON.stringify(sendForm),
      });
      toast('Mensaje enviado', 'success');
      setShowSend(false);
      setSendForm({ phone: '', message: '' });
    } catch (e: any) {
      toast(e.message || 'Error enviando', 'error');
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
          Recordatorios <span className="page-crumb">/ Mensajes recurrentes a empleados</span>
        </h1>
        <div className="flex gap-2">
          <button className="btn" onClick={() => setShowSend(true)}>
            <Icon name="send" /> Enviar mensaje
          </button>
          <button className="btn-primary" onClick={openCreate}>
            <Icon name="plus" /> Nuevo recordatorio
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Kpi label="Total" value={stats.total} />
        <Kpi label="Activos" value={stats.active} accent="ok" />
        <Kpi label="Pausados" value={stats.paused} accent="warn" />
      </div>

      <div className="card overflow-hidden">
        <div className="grid grid-cols-[1.4fr_1.2fr_2fr_0.8fr_0.9fr_auto] gap-3 px-4 py-3 text-[11px] uppercase tracking-wider text-mute font-semibold border-b border-line">
          <div>Empleado</div>
          <div>Recurrencia</div>
          <div>Mensaje</div>
          <div>Estado</div>
          <div>Último envío</div>
          <div></div>
        </div>
        {loading && (
          <div className="p-6 text-center text-mute text-sm">Cargando…</div>
        )}
        {!loading && list.length === 0 && (
          <div className="p-12 text-center">
            <div className="text-5xl mb-3">📋</div>
            <div className="font-semibold">No hay recordatorios todavía</div>
            <div className="text-sm text-mute mt-1.5 max-w-md mx-auto">
              Programa mensajes que se envían automáticamente a tus empleados
              por WhatsApp diaria, semanal o mensualmente.
            </div>
            <button className="btn-primary mt-4" onClick={openCreate}>
              <Icon name="plus" /> Crear el primero
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
                    {RECURRENCE_LABEL[r.recurrence]}
                  </span>
                  <span className="text-xs text-mute">
                    {r.recurrence === 'DAILY' && 'Cada día'}
                    {r.recurrence === 'WEEKLY' &&
                      `Cada ${DAYS[r.dayOfWeek ?? 1]}`}
                    {r.recurrence === 'MONTHLY' &&
                      `Día ${r.dayOfMonth} del mes`}
                  </span>
                </div>
                <div className="text-[11px] text-mute mt-0.5">
                  a las {r.timeOfDay}
                </div>
              </div>
              <div className="text-sm text-ink/85 line-clamp-2">{r.message}</div>
              <div>
                {r.isActive ? (
                  <span className="badge-ok">Activo</span>
                ) : (
                  <span className="badge-warn">Pausado</span>
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
                  title={r.isActive ? 'Pausar' : 'Activar'}
                  onClick={() => togglePause(r)}
                  className="hover:text-ink"
                >
                  {r.isActive ? '⏸' : '▶'}
                </button>
                <button
                  type="button"
                  title="Editar"
                  onClick={() => openEdit(r)}
                  className="hover:text-ink"
                >
                  <Icon name="edit" />
                </button>
                <button
                  type="button"
                  title="Eliminar"
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
        Los recordatorios activos se envían automáticamente una vez al día
        por nuestro cron. Diarios → todos los días. Semanales → el día de
        la semana elegido. Mensuales → el día del mes elegido (1–28). El
        SMS sale por Grow Business al WhatsApp del empleado.
      </p>

      {/* ─────────── Modal: crear / editar ─────────── */}
      {showForm && (
        <Modal title={editing ? 'Editar recordatorio' : 'Nuevo recordatorio'} onClose={() => setShowForm(false)}>
          <form onSubmit={save} className="space-y-4">
            <Field label="Empleado">
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
                <option value="">— Otro / manual —</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName} {s.phone ? `· ${s.phone}` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nombre">
                <input
                  className="input"
                  value={form.employeeName}
                  onChange={(e) => setForm({ ...form, employeeName: e.target.value })}
                />
              </Field>
              <Field label="WhatsApp / SMS">
                <input
                  className="input"
                  placeholder="+57 300 000 0000"
                  value={form.employeePhone}
                  onChange={(e) => setForm({ ...form, employeePhone: e.target.value })}
                />
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Recurrencia">
                <select
                  className="input"
                  value={form.recurrence}
                  onChange={(e) => setForm({ ...form, recurrence: e.target.value as Recurrence })}
                >
                  <option value="DAILY">Diario</option>
                  <option value="WEEKLY">Semanal</option>
                  <option value="MONTHLY">Mensual</option>
                </select>
              </Field>

              {form.recurrence === 'WEEKLY' && (
                <Field label="Día">
                  <select
                    className="input"
                    value={form.dayOfWeek}
                    onChange={(e) => setForm({ ...form, dayOfWeek: Number(e.target.value) })}
                  >
                    {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </select>
                </Field>
              )}
              {form.recurrence === 'MONTHLY' && (
                <Field label="Día del mes (1-28)">
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
              <Field label="Hora">
                <input
                  type="time"
                  className="input"
                  value={form.timeOfDay}
                  onChange={(e) => setForm({ ...form, timeOfDay: e.target.value })}
                />
              </Field>
            </div>

            <Field label="Mensaje">
              <textarea
                className="input min-h-[100px]"
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder="Hola [nombre], no olvides…"
              />
            </Field>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn" onClick={() => setShowForm(false)}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? 'Guardando…' : editing ? 'Guardar' : 'Crear'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ─────────── Modal: enviar one-off ─────────── */}
      {showSend && (
        <Modal title="Enviar mensaje" onClose={() => setShowSend(false)}>
          <form onSubmit={sendOne} className="space-y-4">
            <Field label="Teléfono / WhatsApp">
              <input
                className="input"
                placeholder="+57 300 000 0000"
                value={sendForm.phone}
                onChange={(e) => setSendForm({ ...sendForm, phone: e.target.value })}
              />
            </Field>
            <Field label="Mensaje">
              <textarea
                className="input min-h-[120px]"
                value={sendForm.message}
                onChange={(e) => setSendForm({ ...sendForm, message: e.target.value })}
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn" onClick={() => setShowSend(false)}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? 'Enviando…' : 'Enviar ahora'}
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
