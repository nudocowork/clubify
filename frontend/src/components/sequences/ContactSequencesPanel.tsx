'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { STEP_KIND_META, type StepKind } from './types';

type EnrollmentStatus =
  | 'ACTIVE'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELED'
  | 'FAILED';

type Execution = {
  id: string;
  stepKind: StepKind;
  status: string; // OK | FAILED | SKIPPED
  message: string | null;
  error: string | null;
  executedAt: string;
};

type Enrollment = {
  id: string;
  sequenceId: string;
  status: EnrollmentStatus;
  triggerKind: string;
  nextRunAt: string | null;
  lastError: string | null;
  enrolledAt: string;
  completedAt: string | null;
  sequence: { id: string; name: string };
  currentStep: { id: string; order: number; kind: StepKind } | null;
  executions: Execution[];
};

type AvailableSequence = {
  id: string;
  name: string;
  isActive: boolean;
};

const STATUS_META: Record<EnrollmentStatus, { label: string; color: string }> = {
  ACTIVE: { label: 'En curso', color: 'text-good' },
  PAUSED: { label: 'Pausada', color: 'text-warn' },
  COMPLETED: { label: 'Completada', color: 'text-mute' },
  CANCELED: { label: 'Cancelada', color: 'text-mute' },
  FAILED: { label: 'Falló', color: 'text-bad' },
};

/**
 * Panel de secuencias para mostrar en el ContactDrawer (F6).
 * Muestra los enrollments del contacto + permite pause/resume/cancel
 * + permite inscribir manualmente en otra secuencia.
 */
export function ContactSequencesPanel({ contactId }: { contactId: string }) {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [available, setAvailable] = useState<AvailableSequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showEnrollMenu, setShowEnrollMenu] = useState(false);

  useEffect(() => {
    load();
    api<AvailableSequence[]>('/crm/sequences')
      .then((list) => setAvailable(list.filter((s) => s.isActive)))
      .catch(() => null);
  }, [contactId]);

  async function load() {
    setLoading(true);
    try {
      const data = await api<Enrollment[]>(
        `/crm/sequences/enrollments/by-contact/${contactId}`,
      );
      setEnrollments(data);
    } catch (e: any) {
      toast(e.message ?? 'No se pudieron cargar secuencias', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function pause(id: string) {
    setBusyId(id);
    try {
      await api(`/crm/sequences/enrollments/${id}/pause`, { method: 'POST' });
      load();
    } catch (e: any) {
      toast(e.message ?? 'No se pudo pausar', 'error');
    } finally {
      setBusyId(null);
    }
  }
  async function resume(id: string) {
    setBusyId(id);
    try {
      await api(`/crm/sequences/enrollments/${id}/resume`, { method: 'POST' });
      load();
    } catch (e: any) {
      toast(e.message ?? 'No se pudo reanudar', 'error');
    } finally {
      setBusyId(null);
    }
  }
  async function cancel(id: string) {
    if (!confirm('Cancelar esta secuencia? El contacto deja de recibir mensajes.')) return;
    setBusyId(id);
    try {
      await api(`/crm/sequences/enrollments/${id}/cancel`, { method: 'POST' });
      load();
    } catch (e: any) {
      toast(e.message ?? 'No se pudo cancelar', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function enroll(sequenceId: string) {
    setShowEnrollMenu(false);
    try {
      await api(`/crm/sequences/${sequenceId}/enroll`, {
        method: 'POST',
        body: JSON.stringify({ contactId }),
      });
      toast('Contacto inscrito en la secuencia', 'success');
      load();
    } catch (e: any) {
      toast(e.message ?? 'No se pudo inscribir', 'error');
    }
  }

  return (
    <div className="border-t border-line pt-3 mt-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase tracking-wider text-mute font-semibold">
          🤖 Secuencias
        </div>
        <div className="relative">
          <button
            className="btn-ghost text-xs"
            onClick={() => setShowEnrollMenu(!showEnrollMenu)}
            disabled={available.length === 0}
          >
            + Inscribir
          </button>
          {showEnrollMenu && available.length > 0 && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setShowEnrollMenu(false)}
              />
              <div className="absolute right-0 top-full mt-1 z-40 rounded-input border border-line bg-bg shadow-lg w-56 py-1">
                {available.map((seq) => (
                  <button
                    key={seq.id}
                    className="w-full text-left px-3 py-2 hover:bg-bg2 text-sm"
                    onClick={() => enroll(seq.id)}
                  >
                    {seq.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-xs text-mute italic py-1">Cargando…</div>
      ) : enrollments.length === 0 ? (
        <div className="text-xs text-mute italic">
          Sin secuencias activas en este contacto.
        </div>
      ) : (
        <ul className="space-y-2">
          {enrollments.map((e) => (
            <EnrollmentItem
              key={e.id}
              enrollment={e}
              busy={busyId === e.id}
              onPause={() => pause(e.id)}
              onResume={() => resume(e.id)}
              onCancel={() => cancel(e.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function EnrollmentItem({
  enrollment,
  busy,
  onPause,
  onResume,
  onCancel,
}: {
  enrollment: Enrollment;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = STATUS_META[enrollment.status];
  const currentMeta = enrollment.currentStep
    ? STEP_KIND_META[enrollment.currentStep.kind]
    : null;

  return (
    <li className="rounded-input border border-line bg-bg2/30 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm truncate">
            {enrollment.sequence.name}
          </div>
          <div className="text-xs flex items-center gap-2 mt-0.5">
            <span className={`font-medium ${meta.color}`}>{meta.label}</span>
            {currentMeta && enrollment.status === 'ACTIVE' && (
              <span className="text-mute">
                · ahora en: {currentMeta.emoji} {currentMeta.label}
              </span>
            )}
          </div>
          {enrollment.lastError && (
            <div className="text-xs text-bad mt-1 line-clamp-2">
              ⚠️ {enrollment.lastError}
            </div>
          )}
        </div>
        <div className="flex gap-1 flex-shrink-0">
          {enrollment.status === 'ACTIVE' && (
            <button
              className="btn-ghost text-xs"
              onClick={onPause}
              disabled={busy}
              title="Pausar"
            >
              ⏸️
            </button>
          )}
          {enrollment.status === 'PAUSED' && (
            <button
              className="btn-ghost text-xs"
              onClick={onResume}
              disabled={busy}
              title="Reanudar"
            >
              ▶️
            </button>
          )}
          {(enrollment.status === 'ACTIVE' ||
            enrollment.status === 'PAUSED' ||
            enrollment.status === 'FAILED') && (
            <button
              className="btn-danger text-xs"
              onClick={onCancel}
              disabled={busy}
              title="Cancelar"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {enrollment.executions.length > 0 && (
        <button
          type="button"
          className="text-xs text-brand hover:underline mt-2"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? 'Ocultar pasos ejecutados'
            : `Ver ${enrollment.executions.length} paso${enrollment.executions.length === 1 ? '' : 's'} ejecutado${enrollment.executions.length === 1 ? '' : 's'}`}
        </button>
      )}

      {expanded && enrollment.executions.length > 0 && (
        <ul className="mt-2 space-y-1.5 border-l-2 border-line ml-2 pl-3">
          {enrollment.executions.map((ex) => {
            const exMeta = STEP_KIND_META[ex.stepKind];
            const okIcon =
              ex.status === 'OK' ? '✓' : ex.status === 'FAILED' ? '✗' : '◌';
            return (
              <li key={ex.id} className="text-xs">
                <div className="flex items-start gap-2">
                  <span
                    className={
                      ex.status === 'OK'
                        ? 'text-good'
                        : ex.status === 'FAILED'
                          ? 'text-bad'
                          : 'text-mute'
                    }
                  >
                    {okIcon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div>
                      {exMeta.emoji} {exMeta.label}
                    </div>
                    {ex.message && (
                      <div className="text-mute text-[10px] mt-0.5 line-clamp-2">
                        {ex.message}
                      </div>
                    )}
                    {ex.error && (
                      <div className="text-bad text-[10px] mt-0.5">
                        {ex.error}
                      </div>
                    )}
                    <div className="text-[10px] text-mute/70">
                      {new Date(ex.executedAt).toLocaleString('es-CO')}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
