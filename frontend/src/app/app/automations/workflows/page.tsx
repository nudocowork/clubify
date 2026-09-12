'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { useTranslations } from 'next-intl';

// Fase B: constructor de workflows multipaso (secuencia con esperas). El motor
// (backend) inscribe al cliente cuando ocurre el disparador y un cron avanza los
// pasos: enviar → esperar N días/horas → enviar… Envío aislado por marca.

type StepType = 'SEND_SMS' | 'SEND_WHATSAPP' | 'SEND_PUSH' | 'WAIT';
type Step =
  | { type: 'SEND_SMS'; body: string }
  | { type: 'SEND_WHATSAPP'; body: string }
  | { type: 'SEND_PUSH'; title: string; body: string }
  | { type: 'WAIT'; unit: 'minutes' | 'hours' | 'days'; amount: number };

type Workflow = {
  id: string;
  name: string;
  description: string;
  triggerType: string;
  triggerDays?: number | null;
  steps: Step[];
  isActive: boolean;
  stats?: any;
};

// Solo los TIPOS. La etiqueta que se lee la pone el traductor: tenerla
// pegada aquí era lo que dejaba esta pantalla entera en español.
const TRIGGERS = [
  'PASS_CREATED',
  'STAMP_ADDED',
  'NEAR_REWARD',
  'REWARD_REDEEMED',
  'PASS_COMPLETED',
  'BIRTHDAY',
  'INACTIVITY',
  'ORDER_CREATED',
  'ORDER_CONFIRMED',
  'ORDER_DELIVERED',
  'ORDER_RATED',
  'GEO_ENTER',
] as const;

function emptyStep(type: StepType): Step {
  if (type === 'WAIT') return { type, unit: 'days', amount: 1 };
  if (type === 'SEND_PUSH') return { type, title: '', body: '' };
  return { type, body: '' } as Step;
}
/** Traduce un tipo de paso: SEND_SMS → «Enviar SMS». */
type Traductor = ReturnType<typeof useTranslations<'app_workflows'>>;
const etiquetaDePaso = (t: Traductor, tipo: StepType) =>
  t(`step${tipo.replace('SEND_', '')}` as any);

function stepSummary(t: Traductor, s: Step): string {
  if (s.type === 'WAIT') {
    const unidad = t(
      `unit${s.unit.charAt(0).toUpperCase()}${s.unit.slice(1)}` as any,
    );
    return t('waitSummary', { amount: s.amount, unit: unidad });
  }
  if (s.type === 'SEND_PUSH')
    return t('pushSummary', { title: s.title || t('noTitle') });
  return t('stepSummary', {
    step: etiquetaDePaso(t, s.type),
    body: (s.body || '').slice(0, 40) || t('emptyBody'),
  });
}

export default function WorkflowsPage() {
  const t = useTranslations('app_workflows');
  const [list, setList] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Workflow | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setList(await api('/automations/workflows'));
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function newWorkflow() {
    setEditing({
      id: '',
      name: '',
      description: '',
      triggerType: 'PASS_CREATED',
      steps: [{ type: 'SEND_SMS', body: '' }],
      isActive: false,
    });
  }

  async function save() {
    if (!editing) return;
    if (!editing.name.trim()) {
      toast(t('needName'), 'error');
      return;
    }
    if (!editing.steps.length) {
      toast(t('needStep'), 'error');
      return;
    }
    setBusy(true);
    const payload = {
      name: editing.name.trim(),
      description: editing.description ?? '',
      triggerType: editing.triggerType,
      triggerDays: editing.triggerDays ?? undefined,
      steps: editing.steps,
      isActive: editing.isActive,
    };
    try {
      if (editing.id) {
        await api(`/automations/workflows/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await api('/automations/workflows', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      toast(t('saved'), 'success');
      setEditing(null);
      await load();
    } catch (e: any) {
      toast(e.message ?? t('saveError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(w: Workflow) {
    setBusy(true);
    try {
      await api(`/automations/workflows/${w.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !w.isActive }),
      });
      await load();
    } catch (e: any) {
      toast(e.message ?? 'Error', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(w: Workflow) {
    if (!window.confirm(t('confirmDelete', { name: w.name }))) return;
    setBusy(true);
    try {
      await api(`/automations/workflows/${w.id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      toast(e.message ?? 'Error', 'error');
    } finally {
      setBusy(false);
    }
  }

  // ---- edición de pasos ----
  function setStep(i: number, patch: Partial<Step>) {
    if (!editing) return;
    const steps = editing.steps.slice();
    steps[i] = { ...steps[i], ...patch } as Step;
    setEditing({ ...editing, steps });
  }
  function addStep(type: StepType) {
    if (!editing) return;
    setEditing({ ...editing, steps: [...editing.steps, emptyStep(type)] });
  }
  function removeStep(i: number) {
    if (!editing) return;
    setEditing({ ...editing, steps: editing.steps.filter((_, j) => j !== i) });
  }
  function moveStep(i: number, dir: -1 | 1) {
    if (!editing) return;
    const j = i + dir;
    if (j < 0 || j >= editing.steps.length) return;
    const steps = editing.steps.slice();
    [steps[i], steps[j]] = [steps[j], steps[i]];
    setEditing({ ...editing, steps });
  }

  const box = { border: '1px solid #eef0f2', borderRadius: 12, background: 'white' };

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div>
          <h1 className="text-xl font-bold m-0">{t('title')}</h1>
          <div className="text-xs" style={{ color: '#9aa4af' }}>
            {t('subtitle')} ·{' '}
            <Link href="/app/automations" style={{ color: '#0ea5e9' }}>
              {t('backToRules')}
            </Link>
          </div>
        </div>
        {!editing && (
          <button
            onClick={newWorkflow}
            className="text-sm font-semibold rounded-[9px] py-1.5 px-3"
            style={{ background: '#16a34a', color: 'white' }}
          >
            {t('new')}
          </button>
        )}
      </div>

      <div
        className="rounded-lg p-3 text-xs mb-4"
        style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af' }}
      >
        {t('help', { variable: '{{nombre}}' })}
      </div>

      {editing ? (
        <div className="p-3 space-y-3" style={box as any}>
          <div className="grid grid-cols-1 gap-2">
            <label className="text-xs font-semibold" style={{ color: '#475569' }}>
              {t('name')}
              <input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder={t('namePlaceholder')}
                className="w-full mt-1 text-sm rounded-[8px] p-2"
                style={{ border: '1px solid #e5e7eb' }}
              />
            </label>
            <label className="text-xs font-semibold" style={{ color: '#475569' }}>
              {t('trigger')}
              <select
                value={editing.triggerType}
                onChange={(e) =>
                  setEditing({ ...editing, triggerType: e.target.value })
                }
                className="w-full mt-1 text-sm rounded-[8px] p-2"
                style={{ border: '1px solid #e5e7eb' }}
              >
                {TRIGGERS.map((tr) => (
                  <option key={tr} value={tr}>
                    {t(`trigger_${tr}` as any)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6b7280' }}>
            {t('steps')}
          </div>
          <div className="space-y-2">
            {editing.steps.map((s, i) => (
              <div key={i} className="p-2.5 rounded-[10px]" style={{ border: '1px solid #eef0f2', background: '#fbfcfd' }}>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs font-bold" style={{ color: '#334155' }}>
                    {i + 1}. {etiquetaDePaso(t, s.type)}
                  </span>
                  <span className="flex items-center gap-2 text-[11px]">
                    <button onClick={() => moveStep(i, -1)} disabled={i === 0} style={{ color: '#64748b' }}>↑</button>
                    <button onClick={() => moveStep(i, 1)} disabled={i === editing.steps.length - 1} style={{ color: '#64748b' }}>↓</button>
                    <button onClick={() => removeStep(i)} style={{ color: '#b91c1c' }}>
                      {t('remove')}
                    </button>
                  </span>
                </div>
                {s.type === 'WAIT' ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      value={s.amount}
                      onChange={(e) => setStep(i, { amount: Math.max(1, Number(e.target.value) || 1) } as any)}
                      className="w-20 text-sm rounded-[8px] p-2"
                      style={{ border: '1px solid #e5e7eb' }}
                    />
                    <select
                      value={s.unit}
                      onChange={(e) => setStep(i, { unit: e.target.value } as any)}
                      className="text-sm rounded-[8px] p-2"
                      style={{ border: '1px solid #e5e7eb' }}
                    >
                      <option value="minutes">{t('unitMinutes')}</option>
                      <option value="hours">{t('unitHours')}</option>
                      <option value="days">{t('unitDays')}</option>
                    </select>
                  </div>
                ) : s.type === 'SEND_PUSH' ? (
                  <div className="space-y-1.5">
                    <input
                      value={s.title}
                      onChange={(e) => setStep(i, { title: e.target.value } as any)}
                      placeholder={t('pushTitlePlaceholder')}
                      className="w-full text-sm rounded-[8px] p-2"
                      style={{ border: '1px solid #e5e7eb' }}
                    />
                    <textarea
                      value={s.body}
                      onChange={(e) => setStep(i, { body: e.target.value } as any)}
                      placeholder={t('messagePlaceholder')}
                      rows={2}
                      className="w-full text-sm rounded-[8px] p-2"
                      style={{ border: '1px solid #e5e7eb', resize: 'vertical' }}
                    />
                  </div>
                ) : (
                  <textarea
                    value={(s as any).body}
                    onChange={(e) => setStep(i, { body: e.target.value } as any)}
                    placeholder={t('messageWithVarPlaceholder', {
                      variable: '{{nombre}}',
                    })}
                    rows={2}
                    className="w-full text-sm rounded-[8px] p-2"
                    style={{ border: '1px solid #e5e7eb', resize: 'vertical' }}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(['SEND_SMS', 'SEND_WHATSAPP', 'SEND_PUSH', 'WAIT'] as StepType[]).map((tp) => (
              <button
                key={tp}
                onClick={() => addStep(tp)}
                className="text-[11px] font-semibold rounded-[8px] py-1 px-2.5"
                style={{ border: '1px dashed #cbd5e1', color: '#334155', background: 'white' }}
              >
                + {etiquetaDePaso(t, tp)}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={save}
              disabled={busy}
              className="text-sm font-semibold rounded-[9px] py-2 px-4"
              style={{ background: '#16a34a', color: 'white' }}
            >
              {busy ? t('saving') : t('save')}
            </button>
            <label className="text-xs flex items-center gap-1.5" style={{ color: '#475569' }}>
              <input
                type="checkbox"
                checked={editing.isActive}
                onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
              />
              {t('active')}
            </label>
            <button
              onClick={() => setEditing(null)}
              className="text-sm rounded-[9px] py-2 px-4 ml-auto"
              style={{ border: '1px solid #e5e7eb', color: '#475569', background: 'white' }}
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : loading ? (
        <div className="text-sm" style={{ color: '#9aa4af' }}>{t('loading')}</div>
      ) : list.length === 0 ? (
        <div className="text-sm rounded-lg px-3 py-6 text-center" style={{ color: '#9aa4af', border: '1px dashed #e5e7eb' }}>
          {t('empty')}
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((w) => (
            <div key={w.id} className="p-3" style={box as any}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold" style={{ color: '#2b3a30' }}>
                    {w.name}
                  </div>
                  <div className="text-[11px]" style={{ color: '#9aa4af' }}>
                    {t('triggerLine', {
                      trigger: t(`trigger_${w.triggerType}` as any),
                      count: w.steps.length,
                    })}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-[6px]"
                    style={
                      w.isActive
                        ? { background: '#dcfce7', color: '#15803d' }
                        : { background: '#f3f4f6', color: '#6b7280' }
                    }
                  >
                    {w.isActive ? t('stateActive') : t('statePaused')}
                  </span>
                </div>
              </div>
              <div className="text-[11px] mt-1.5" style={{ color: '#64748b' }}>
                {w.steps.map((s, i) => (
                  <span key={i}>
                    {i > 0 && ' → '}
                    {stepSummary(t, s)}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={() => setEditing({ ...w, steps: w.steps ?? [] })}
                  disabled={busy}
                  className="text-xs font-semibold rounded-[8px] py-1.5 px-3"
                  style={{ border: '1px solid #cbd5e1', color: '#334155', background: 'white' }}
                >
                  {t('edit')}
                </button>
                <button
                  onClick={() => toggleActive(w)}
                  disabled={busy}
                  className="text-xs font-semibold rounded-[8px] py-1.5 px-3"
                  style={
                    w.isActive
                      ? { background: 'white', color: '#b45309', border: '1px solid #fde68a' }
                      : { background: '#0ea5e9', color: 'white' }
                  }
                >
                  {w.isActive ? t('pause') : t('activate')}
                </button>
                <button
                  onClick={() => remove(w)}
                  disabled={busy}
                  className="text-xs rounded-[8px] py-1.5 px-3 ml-auto"
                  style={{ color: '#b91c1c', border: '1px solid #fecaca', background: 'white' }}
                >
                  {t('delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
