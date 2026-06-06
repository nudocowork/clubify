'use client';
/**
 * Modal para crear/editar excepción de comisión por cliente (item 6 sprint).
 * SUPER_ADMIN only. Sobrescribe el % de la cadena de afiliados solo para
 * ese tenant. Si hay comisiones PAID, alerta antes de guardar.
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

export type AttributionLevel = {
  codeId: string;
  code: string;
  ownerName: string;
  role: 'INFLUENCER' | 'AMBASSADOR' | 'VENDOR' | string;
  defaultPercent: number;
};

export type ExistingException = {
  id: string;
  recipientCodeId: string;
  customPercent: number;
  reason: string | null;
  isActive: boolean;
};

const ROLE_LABEL: Record<string, string> = {
  INFLUENCER: 'Influencer',
  AMBASSADOR: 'Embajador',
  VENDOR: 'Vendedor',
};

export function CommissionExceptionModal({
  tenantId,
  brandName,
  attributions,
  exceptions,
  onClose,
  onSaved,
}: {
  tenantId: string;
  brandName: string;
  attributions: AttributionLevel[];
  exceptions: ExistingException[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // Default: la atribución con MAYOR % por defecto (= el directo más
  // grande). Si el tenant ya tiene excepción para algún nivel, lo
  // preseleccionamos en ese nivel para que la edición sea natural.
  const initialLevel =
    exceptions.find((e) => e.isActive)
      ? attributions.find(
          (a) => a.codeId === exceptions.find((e) => e.isActive)!.recipientCodeId,
        ) ?? attributions[0]
      : [...attributions].sort((a, b) => b.defaultPercent - a.defaultPercent)[0];

  const [recipientCodeId, setRecipientCodeId] = useState<string>(
    initialLevel?.codeId ?? '',
  );
  const existingForLevel = (id: string) =>
    exceptions.find((e) => e.recipientCodeId === id) ?? null;
  const currentExisting = existingForLevel(recipientCodeId);

  const [customPercent, setCustomPercent] = useState<string>(
    currentExisting
      ? String(currentExisting.customPercent)
      : initialLevel
      ? String(initialLevel.defaultPercent)
      : '',
  );
  const [reason, setReason] = useState<string>(currentExisting?.reason ?? '');
  const [isActive, setIsActive] = useState<boolean>(
    currentExisting?.isActive ?? true,
  );
  const [busy, setBusy] = useState(false);
  const [hasPaidWarning, setHasPaidWarning] = useState<{
    count: number;
  } | null>(null);

  function onLevelChange(codeId: string) {
    setRecipientCodeId(codeId);
    const existing = existingForLevel(codeId);
    const level = attributions.find((a) => a.codeId === codeId);
    if (existing) {
      setCustomPercent(String(existing.customPercent));
      setReason(existing.reason ?? '');
      setIsActive(existing.isActive);
    } else {
      setCustomPercent(level ? String(level.defaultPercent) : '');
      setReason('');
      setIsActive(true);
    }
    setHasPaidWarning(null);
  }

  const pctNum = Number(customPercent);
  const pctValid =
    customPercent !== '' &&
    Number.isFinite(pctNum) &&
    pctNum >= 0.01 &&
    pctNum <= 100;

  async function save() {
    if (!pctValid || !recipientCodeId || busy) return;
    setBusy(true);
    try {
      const res = await api<{
        exception: { id: string };
        hasPaidCommissions: boolean;
        paidCommissionCount: number;
      }>('/admin/commission-exceptions', {
        method: 'POST',
        body: JSON.stringify({
          tenantId,
          recipientCodeId,
          customPercent: pctNum,
          reason: reason.trim() || undefined,
          isActive,
        }),
      });
      if (res.hasPaidCommissions && !hasPaidWarning) {
        setHasPaidWarning({ count: res.paidCommissionCount });
        // No cerramos — el admin ve la confirmación de que el cambio
        // aplica solo a futuras + PENDING.
      }
      toast('Excepción guardada', 'success');
      onSaved();
      if (!res.hasPaidCommissions) {
        onClose();
      }
    } catch (e: any) {
      toast(e.message ?? 'No se pudo guardar', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (attributions.length === 0) {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4">
        <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
          <div className="px-5 py-4 border-b border-line2 font-semibold">
            Excepción de comisión
          </div>
          <div className="px-5 py-6 text-sm text-mute">
            Este cliente no tiene ninguna atribución activa. No se puede
            configurar una excepción aún.
          </div>
          <div className="px-5 py-3 border-t border-line2 flex justify-end">
            <button onClick={onClose} className="btn-ghost text-sm">
              Cerrar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in slide-in-from-bottom-2 duration-300">
        <div className="px-5 py-4 border-b border-line2">
          <div className="font-semibold text-base">
            Editar comisión personalizada
          </div>
          <div className="text-xs text-mute mt-0.5 truncate">
            Cliente: {brandName}
          </div>
        </div>

        <div className="px-5 py-4 space-y-4">
          {hasPaidWarning && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 leading-relaxed">
              ⚠️ Este cliente ya tiene{' '}
              <strong>{hasPaidWarning.count}</strong> comisión(es) pagadas
              en este nivel. El cambio aplica solo a comisiones futuras o
              pendientes — las ya pagadas no se modifican.
            </div>
          )}

          <div>
            <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-2">
              Nivel de la cadena
            </div>
            <div className="space-y-1.5">
              {attributions.map((a) => {
                const existing = existingForLevel(a.codeId);
                return (
                  <label
                    key={a.codeId}
                    className={`flex items-center gap-2 border rounded-md px-3 py-2 cursor-pointer text-sm ${
                      recipientCodeId === a.codeId
                        ? 'border-brand bg-brand-soft'
                        : 'border-line2 hover:bg-bg2/40'
                    }`}
                  >
                    <input
                      type="radio"
                      name="level"
                      checked={recipientCodeId === a.codeId}
                      onChange={() => onLevelChange(a.codeId)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {ROLE_LABEL[a.role] ?? a.role} · {a.ownerName}
                      </div>
                      <div className="text-xs text-mute">
                        Código <span className="font-mono">{a.code}</span> ·{' '}
                        % normal: {a.defaultPercent}
                        {existing && existing.isActive && (
                          <span className="ml-2 inline-block text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                            Excepción {existing.customPercent}%
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-mute font-semibold block mb-1.5">
              Porcentaje personalizado
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.01"
                min={0.01}
                max={100}
                value={customPercent}
                onChange={(e) => setCustomPercent(e.target.value)}
                className="input flex-1"
                placeholder="20"
              />
              <span className="text-sm text-mute">%</span>
            </div>
            {!pctValid && customPercent !== '' && (
              <div className="text-xs text-bad mt-1">
                Debe estar entre 0.01 y 100
              </div>
            )}
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-mute font-semibold block mb-1.5">
              Motivo de la excepción (opcional)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 500))}
              maxLength={500}
              rows={2}
              placeholder="Ej: Acuerdo comercial individual cerrado por X"
              className="input w-full resize-none"
            />
            <div className="text-[10px] text-mute text-right mt-0.5">
              {reason.length}/500
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <span>Excepción activa</span>
          </label>
        </div>

        <div className="px-5 py-3 border-t border-line2 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="btn-ghost text-sm">
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={!pctValid || busy}
            className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export type HistoryRow = {
  id: string;
  previousPercent: number | null;
  newPercent: number;
  previousActive: boolean | null;
  newActive: boolean;
  reason: string | null;
  changedBy: { id: string; fullName: string; email: string } | null;
  changedAt: string;
};

export function CommissionExceptionHistoryDrawer({
  exceptionId,
  onClose,
}: {
  exceptionId: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api<{ items: HistoryRow[] }>(
          `/admin/commission-exceptions/${exceptionId}/history`,
        );
        setItems(res.items);
      } catch (e: any) {
        setError(e.message ?? 'No se pudo cargar el historial');
      }
    })();
  }, [exceptionId]);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex justify-end">
      <div className="bg-white w-full max-w-md h-full overflow-y-auto shadow-2xl animate-in slide-in-from-right duration-300">
        <div className="px-5 py-4 border-b border-line2 flex items-center justify-between">
          <div className="font-semibold">Historial de la excepción</div>
          <button onClick={onClose} className="text-mute hover:text-ink">
            ×
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 text-sm">
          {error && <div className="text-bad text-xs">{error}</div>}
          {!items && !error && <div className="text-mute text-xs">Cargando…</div>}
          {items && items.length === 0 && (
            <div className="text-mute text-xs">Sin cambios registrados aún.</div>
          )}
          {items?.map((h) => (
            <div key={h.id} className="border border-line2 rounded-md p-3">
              <div className="text-xs text-mute">
                {new Date(h.changedAt).toLocaleString('es-CO')}
              </div>
              <div className="mt-1">
                {h.previousPercent === null ? (
                  <span>
                    Creada con <strong>{h.newPercent}%</strong>{' '}
                    {h.newActive ? '(activa)' : '(inactiva)'}
                  </span>
                ) : (
                  <span>
                    {h.previousPercent}% → <strong>{h.newPercent}%</strong>
                    {h.previousActive !== h.newActive && (
                      <span className="ml-2 text-xs text-mute">
                        {h.newActive ? '(activada)' : '(desactivada)'}
                      </span>
                    )}
                  </span>
                )}
              </div>
              {h.reason && (
                <div className="text-xs text-mute mt-1 italic">"{h.reason}"</div>
              )}
              {h.changedBy && (
                <div className="text-[10px] text-mute mt-1">
                  por {h.changedBy.fullName} ({h.changedBy.email})
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
