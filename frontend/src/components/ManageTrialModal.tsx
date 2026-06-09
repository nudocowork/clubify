'use client';
/**
 * Modal "Gestionar Trial" desde SuperAdmin → /admin/tenants → Acciones.
 * (2026-06-07)
 *
 * Permite al SuperAdmin sumar o restar días al trial de un negocio sin
 * pasar por la página de detalle. Muestra:
 *  - Estado actual (Activo / Trial / Suspendido / Vencido)
 *  - Días restantes y fecha de vencimiento
 *  - Quick buttons (+3, +5, +15, +30, +90 / -1, -3, -5, -10)
 *  - Input numérico libre (signed) + observación
 *
 * Validación: días != 0, |días| ≤ 3650. Si el resultado queda en el
 * pasado el backend marca el tenant como SUSPENDED. Si queda en el
 * futuro marca TRIAL (reactiva expirados).
 *
 * Toda llamada queda registrada en AuditLog y aparece en
 * /admin/tenants/[id] → sección "Historial de Trial".
 */
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type Tenant = {
  id: string;
  brandName: string;
  status: 'ACTIVE' | 'TRIAL' | 'SUSPENDED' | string;
  trialEndsAt: string | Date | null;
};

const QUICK_ADD = [3, 5, 15, 30, 90];
const QUICK_SUB = [1, 3, 5, 10];

export function ManageTrialModal({
  tenant,
  onClose,
  onSaved,
}: {
  tenant: Tenant;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [days, setDays] = useState<number>(0);
  const [observation, setObservation] = useState('');
  const [busy, setBusy] = useState(false);

  const now = Date.now();
  const endTs = tenant.trialEndsAt
    ? new Date(tenant.trialEndsAt as any).getTime()
    : null;
  const currentDaysLeft =
    endTs != null
      ? Math.max(0, Math.ceil((endTs - now) / (24 * 60 * 60 * 1000)))
      : null;
  const isExpired = endTs != null && endTs <= now;

  const projected = useMemo(() => {
    if (!days || !Number.isFinite(days)) return null;
    // Mismo cálculo que backend: base = trialEndsAt si futuro, sino HOY.
    const base = endTs && endTs > now ? endTs : now;
    const newEnd = new Date(base + days * 24 * 60 * 60 * 1000);
    const newDaysLeft = Math.max(
      0,
      Math.ceil((newEnd.getTime() - now) / (24 * 60 * 60 * 1000)),
    );
    const willSuspend = newEnd.getTime() <= now;
    return { newEnd, newDaysLeft, willSuspend };
  }, [days, endTs, now]);

  function setQuick(delta: number) {
    setDays((d) => d + delta);
  }

  async function handleConfirm() {
    if (!days) {
      toast('Indica una cantidad de días distinta de 0', 'error');
      return;
    }
    if (Math.abs(days) > 3650) {
      toast('Máximo ±3650 días', 'error');
      return;
    }
    setBusy(true);
    try {
      await api(`/tenants/${tenant.id}/adjust-trial`, {
        method: 'POST',
        body: JSON.stringify({
          days,
          observation: observation.trim() || undefined,
        }),
      });
      toast(
        days > 0
          ? `Trial extendido ${days} día${days === 1 ? '' : 's'}`
          : `Trial descontado ${Math.abs(days)} día${days === -1 ? '' : 's'}`,
        'success',
      );
      onSaved();
    } catch (e: any) {
      toast(e.message || 'No se pudo modificar el trial', 'error');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md overflow-hidden shadow-2xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-line2 flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-brand-soft flex items-center justify-center text-brand shrink-0 text-lg">
            ⏱
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-base">Gestionar Trial</div>
            <div className="text-xs text-mute mt-0.5">{tenant.brandName}</div>
          </div>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          {/* Guard 2026-06-08: si el tenant es ACTIVE el backend rechaza
              cualquier modificación de trial (podría romper su billing
              Hotmart). Mostramos warning y bloqueamos el form. */}
          {tenant.status === 'ACTIVE' && (
            <div className="bg-bad-soft border border-bad/30 rounded-lg p-3 mb-4 text-sm text-bad">
              <div className="font-semibold mb-1">⚠️ Cliente pagante</div>
              <div className="text-xs leading-snug">
                Este negocio tiene una suscripción activa. Modificar el trial
                podría romper su facturación. Si necesitás cambiar el plan o
                cancelar, hacelo desde el panel del tenant (Billing card).
              </div>
            </div>
          )}

          {/* Estado actual */}
          <div className="bg-bg2 rounded-lg p-3 mb-4">
            <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
              Estado actual
            </div>
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <span
                className={`badge ${
                  tenant.status === 'ACTIVE'
                    ? 'badge-ok'
                    : tenant.status === 'TRIAL'
                      ? 'badge-warn'
                      : 'badge-bad'
                }`}
              >
                {tenant.status === 'ACTIVE'
                  ? 'Activo'
                  : tenant.status === 'TRIAL'
                    ? 'Trial'
                    : 'Suspendido'}
              </span>
              {currentDaysLeft !== null ? (
                <>
                  <span className="text-ink font-medium">
                    {isExpired ? 'Vencido' : `${currentDaysLeft} día${currentDaysLeft === 1 ? '' : 's'}`}
                  </span>
                  {tenant.trialEndsAt && (
                    <span className="text-xs text-mute">
                      ({new Date(tenant.trialEndsAt as any).toLocaleDateString('es-CO', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })})
                    </span>
                  )}
                </>
              ) : (
                <span className="text-mute text-xs">Sin fecha de trial</span>
              )}
            </div>
          </div>

          {/* Quick add */}
          <div className="mb-3">
            <label className="block text-xs text-mute font-semibold uppercase tracking-wider mb-1.5">
              Agregar días
            </label>
            <div className="flex gap-1.5 flex-wrap">
              {QUICK_ADD.map((d) => (
                <button
                  key={`add-${d}`}
                  type="button"
                  onClick={() => setQuick(d)}
                  className="text-xs px-3 py-1.5 rounded-full bg-brand-soft text-brand font-semibold hover:bg-brand/20 transition"
                  disabled={busy}
                >
                  +{d}
                </button>
              ))}
            </div>
          </div>

          {/* Quick sub */}
          <div className="mb-3">
            <label className="block text-xs text-mute font-semibold uppercase tracking-wider mb-1.5">
              Descontar días
            </label>
            <div className="flex gap-1.5 flex-wrap">
              {QUICK_SUB.map((d) => (
                <button
                  key={`sub-${d}`}
                  type="button"
                  onClick={() => setQuick(-d)}
                  className="text-xs px-3 py-1.5 rounded-full bg-bad-soft text-bad font-semibold hover:bg-bad/20 transition"
                  disabled={busy}
                >
                  −{d}
                </button>
              ))}
            </div>
          </div>

          {/* Input libre */}
          <div className="mb-3">
            <label className="block text-xs text-mute font-semibold uppercase tracking-wider mb-1.5">
              O escribe cualquier cantidad
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={days || ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setDays(v === '' || v === '-' ? 0 : Number(v));
                }}
                className="w-full bg-white border border-line2 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-brand"
                placeholder="Ej: +15 o -3"
                disabled={busy}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setDays(0)}
                className="text-xs text-mute hover:text-ink px-2 py-1"
                disabled={busy || !days}
              >
                Limpiar
              </button>
            </div>
          </div>

          {/* Observación */}
          <div className="mb-3">
            <label className="block text-xs text-mute font-semibold uppercase tracking-wider mb-1.5">
              Observación (opcional)
            </label>
            <input
              type="text"
              value={observation}
              onChange={(e) => setObservation(e.target.value)}
              maxLength={200}
              className="w-full bg-white border border-line2 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-brand"
              placeholder="Ej: cliente pidió 15 días extra por feria"
              disabled={busy}
            />
          </div>

          {/* Preview del resultado */}
          {projected && (
            <div
              className={`rounded-lg p-3 text-sm ${
                projected.willSuspend
                  ? 'bg-bad-soft text-bad border border-bad/30'
                  : 'bg-ok-soft text-ok-ink border border-ok/30'
              }`}
            >
              <div className="font-semibold mb-1">
                {projected.willSuspend
                  ? '⚠️ El negocio quedará SUSPENDIDO'
                  : `✓ ${projected.newDaysLeft} día${projected.newDaysLeft === 1 ? '' : 's'} de trial`}
              </div>
              <div className="text-xs opacity-80">
                Nuevo vencimiento:{' '}
                {projected.newEnd.toLocaleDateString('es-CO', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-line2 flex flex-col-reverse sm:flex-row items-stretch sm:items-center sm:justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn-ghost text-sm disabled:opacity-50 justify-center min-h-[44px]"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy || !days || tenant.status === 'ACTIVE'}
            className="text-sm font-semibold px-4 py-2 rounded-md bg-brand text-white hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] cursor-pointer touch-manipulation select-none active:scale-[0.97] transition-transform duration-150"
          >
            {busy ? 'Aplicando…' : 'Aplicar cambios'}
          </button>
        </div>
      </div>
    </div>
  );
}
