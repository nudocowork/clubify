'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

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

const TRIGGERS: { type: string; label: string }[] = [
  { type: 'PASS_CREATED', label: 'Se inscribe (nueva tarjeta)' },
  { type: 'STAMP_ADDED', label: 'Suma un sello' },
  { type: 'NEAR_REWARD', label: 'Cerca de la recompensa' },
  { type: 'REWARD_REDEEMED', label: 'Canjea recompensa' },
  { type: 'PASS_COMPLETED', label: 'Completa la tarjeta' },
  { type: 'BIRTHDAY', label: 'Cumpleaños' },
  { type: 'INACTIVITY', label: 'Inactividad' },
  { type: 'ORDER_CREATED', label: 'Crea un pedido' },
  { type: 'ORDER_CONFIRMED', label: 'Pedido confirmado' },
  { type: 'ORDER_DELIVERED', label: 'Pedido entregado' },
  { type: 'ORDER_RATED', label: 'Califica el pedido' },
  { type: 'GEO_ENTER', label: 'Entra a la zona (geo)' },
];
const triggerLabel = (t: string) =>
  TRIGGERS.find((x) => x.type === t)?.label ?? t;

const STEP_LABEL: Record<StepType, string> = {
  SEND_SMS: 'Enviar SMS',
  SEND_WHATSAPP: 'Enviar WhatsApp',
  SEND_PUSH: 'Enviar Push',
  WAIT: 'Esperar',
};
const UNIT_LABEL: Record<string, string> = {
  minutes: 'minutos',
  hours: 'horas',
  days: 'días',
};

function emptyStep(type: StepType): Step {
  if (type === 'WAIT') return { type, unit: 'days', amount: 1 };
  if (type === 'SEND_PUSH') return { type, title: '', body: '' };
  return { type, body: '' } as Step;
}
function stepSummary(s: Step): string {
  if (s.type === 'WAIT')
    return `Esperar ${s.amount} ${UNIT_LABEL[s.unit] ?? s.unit}`;
  if (s.type === 'SEND_PUSH') return `Push: ${s.title || '(sin título)'}`;
  return `${STEP_LABEL[s.type]}: ${(s.body || '').slice(0, 40) || '(vacío)'}`;
}

export default function WorkflowsPage() {
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
      toast('Ponle un nombre al workflow', 'error');
      return;
    }
    if (!editing.steps.length) {
      toast('Agrega al menos un paso', 'error');
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
      toast('Workflow guardado', 'success');
      setEditing(null);
      await load();
    } catch (e: any) {
      toast(e.message ?? 'Error al guardar', 'error');
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
    if (!window.confirm(`¿Borrar el workflow "${w.name}"?`)) return;
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
          <h1 className="text-xl font-bold m-0">Workflows</h1>
          <div className="text-xs" style={{ color: '#9aa4af' }}>
            Secuencias multipaso con esperas ·{' '}
            <Link href="/app/automations" style={{ color: '#0ea5e9' }}>
              ← volver a reglas simples
            </Link>
          </div>
        </div>
        {!editing && (
          <button
            onClick={newWorkflow}
            className="text-sm font-semibold rounded-[9px] py-1.5 px-3"
            style={{ background: '#16a34a', color: 'white' }}
          >
            + Nuevo workflow
          </button>
        )}
      </div>

      <div
        className="rounded-lg p-3 text-xs mb-4"
        style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af' }}
      >
        Un workflow inscribe al cliente cuando ocurre el disparador y ejecuta los
        pasos en orden: enviar un mensaje, <b>esperar</b> días/horas, enviar otro…
        Usa <code>{'{{nombre}}'}</code> para el nombre del cliente. El SMS/WhatsApp
        sale de la cuenta de tu negocio o de tu marca (aislado). Actívalo cuando
        esté listo.
      </div>

      {editing ? (
        <div className="p-3 space-y-3" style={box as any}>
          <div className="grid grid-cols-1 gap-2">
            <label className="text-xs font-semibold" style={{ color: '#475569' }}>
              Nombre
              <input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="Ej. Bienvenida en 3 toques"
                className="w-full mt-1 text-sm rounded-[8px] p-2"
                style={{ border: '1px solid #e5e7eb' }}
              />
            </label>
            <label className="text-xs font-semibold" style={{ color: '#475569' }}>
              Disparador
              <select
                value={editing.triggerType}
                onChange={(e) =>
                  setEditing({ ...editing, triggerType: e.target.value })
                }
                className="w-full mt-1 text-sm rounded-[8px] p-2"
                style={{ border: '1px solid #e5e7eb' }}
              >
                {TRIGGERS.map((tr) => (
                  <option key={tr.type} value={tr.type}>
                    {tr.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="text-xs font-bold uppercase tracking-wide" style={{ color: '#6b7280' }}>
            Pasos
          </div>
          <div className="space-y-2">
            {editing.steps.map((s, i) => (
              <div key={i} className="p-2.5 rounded-[10px]" style={{ border: '1px solid #eef0f2', background: '#fbfcfd' }}>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs font-bold" style={{ color: '#334155' }}>
                    {i + 1}. {STEP_LABEL[s.type]}
                  </span>
                  <span className="flex items-center gap-2 text-[11px]">
                    <button onClick={() => moveStep(i, -1)} disabled={i === 0} style={{ color: '#64748b' }}>↑</button>
                    <button onClick={() => moveStep(i, 1)} disabled={i === editing.steps.length - 1} style={{ color: '#64748b' }}>↓</button>
                    <button onClick={() => removeStep(i)} style={{ color: '#b91c1c' }}>quitar</button>
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
                      <option value="minutes">minutos</option>
                      <option value="hours">horas</option>
                      <option value="days">días</option>
                    </select>
                  </div>
                ) : s.type === 'SEND_PUSH' ? (
                  <div className="space-y-1.5">
                    <input
                      value={s.title}
                      onChange={(e) => setStep(i, { title: e.target.value } as any)}
                      placeholder="Título del push"
                      className="w-full text-sm rounded-[8px] p-2"
                      style={{ border: '1px solid #e5e7eb' }}
                    />
                    <textarea
                      value={s.body}
                      onChange={(e) => setStep(i, { body: e.target.value } as any)}
                      placeholder="Mensaje…"
                      rows={2}
                      className="w-full text-sm rounded-[8px] p-2"
                      style={{ border: '1px solid #e5e7eb', resize: 'vertical' }}
                    />
                  </div>
                ) : (
                  <textarea
                    value={(s as any).body}
                    onChange={(e) => setStep(i, { body: e.target.value } as any)}
                    placeholder="Mensaje… (usa {{nombre}})"
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
                + {STEP_LABEL[tp]}
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
              {busy ? 'Guardando…' : 'Guardar'}
            </button>
            <label className="text-xs flex items-center gap-1.5" style={{ color: '#475569' }}>
              <input
                type="checkbox"
                checked={editing.isActive}
                onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
              />
              Activo
            </label>
            <button
              onClick={() => setEditing(null)}
              className="text-sm rounded-[9px] py-2 px-4 ml-auto"
              style={{ border: '1px solid #e5e7eb', color: '#475569', background: 'white' }}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : loading ? (
        <div className="text-sm" style={{ color: '#9aa4af' }}>Cargando…</div>
      ) : list.length === 0 ? (
        <div className="text-sm rounded-lg px-3 py-6 text-center" style={{ color: '#9aa4af', border: '1px dashed #e5e7eb' }}>
          Aún no tienes workflows. Crea el primero con “+ Nuevo workflow”.
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
                    Disparador: {triggerLabel(w.triggerType)} · {w.steps.length} paso(s)
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
                    {w.isActive ? 'Activo' : 'Pausado'}
                  </span>
                </div>
              </div>
              <div className="text-[11px] mt-1.5" style={{ color: '#64748b' }}>
                {w.steps.map((s, i) => (
                  <span key={i}>
                    {i > 0 && ' → '}
                    {stepSummary(s)}
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
                  Editar
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
                  {w.isActive ? 'Pausar' : 'Activar'}
                </button>
                <button
                  onClick={() => remove(w)}
                  disabled={busy}
                  className="text-xs rounded-[8px] py-1.5 px-3 ml-auto"
                  style={{ color: '#b91c1c', border: '1px solid #fecaca', background: 'white' }}
                >
                  Borrar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
