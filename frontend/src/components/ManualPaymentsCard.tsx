'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { periodLabel, type PlanPeriodicity } from '@/lib/plan-format';

// =====================================================
// Pagos por fuera (Nequi / efectivo / transferencia)
// =====================================================
// Muchos negocios pagan fuera de las pasarelas y ninguna confirma esos
// pagos: hay que registrarlos a mano. Esta tarjeta concentra ese flujo en
// la ficha del negocio: el flag "paga por fuera" (apaga la suspensión
// automática), el registro del pago (que activa y corre el ciclo según la
// periodicidad REAL del plan, no 30 días fijos) y el historial.

type ManualPaymentMethod = 'NEQUI' | 'EFECTIVO' | 'TRANSFERENCIA' | 'OTRO';

const METHOD_LABEL: Record<ManualPaymentMethod, string> = {
  NEQUI: 'Nequi',
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  OTRO: 'Otro',
};

type ManualPaymentRow = {
  id: string;
  method: ManualPaymentMethod;
  /** Decimal de Prisma → llega como STRING en JSON (o null). Convertir
   *  con Number() antes de formatear; .toFixed() directo revienta. */
  amount: string | null;
  currency: string | null;
  reference: string | null;
  note: string | null;
  paidAt: string;
  periodStart: string;
  periodEnd: string;
};

type ManualPaymentsData = {
  tenantId: string;
  brandName: string;
  status: string;
  manualPayment: boolean;
  planPeriodicity: PlanPeriodicity;
  currentPeriodEnd: string | null;
  suggestedAmount: number | null;
  suggestedCurrency: string;
  payments: ManualPaymentRow[];
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function fmtAmount(amount: string | number | null, currency: string | null) {
  if (amount == null) return '—';
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('es-CO', { maximumFractionDigits: 2 })} ${currency ?? 'USD'}`;
}

function monthsForPeriod(p: PlanPeriodicity | null | undefined): number {
  switch (p) {
    case 'TRIMESTRAL':
      return 3;
    case 'SEMESTRAL':
      return 6;
    case 'ANUAL':
      return 12;
    default:
      return 1;
  }
}

/** Suma meses acotando el día al último del mes destino (31-ene + 1 mes =
 *  28-feb, no 3-mar). Espejo de `addPlanPeriod` del backend — si difieren,
 *  la vista previa del modal mentiría sobre la fecha real de cobertura. */
function addMonthsClamped(from: Date, months: number): Date {
  const d = new Date(from);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

/** Vista previa del ciclo que cubrirá el pago. Espejo de
 *  `resolveManualPaymentPeriod` del backend: **arranca en la FECHA DE PAGO**.
 *  Si el negocio pagó su trimestral el 4 de julio, queda cubierto hasta el 4 de
 *  octubre.
 *
 *  Antes esto encadenaba desde `currentPeriodEnd` y la fecha escrita no se
 *  usaba: el recuadro anunciaba una cobertura que no tenía nada que ver con lo
 *  que el usuario acababa de teclear. `acorta` avisa si el pago deja al negocio
 *  cubierto MENOS de lo que ya estaba — se advierte, no se corrige solo. */
function projectCoverage(
  paidAt: string,
  currentPeriodEnd: string | null,
  periodicity: PlanPeriodicity,
): { start: Date; end: Date; acorta: boolean } {
  const pagado = paidAt ? new Date(paidAt) : new Date();
  const start = isNaN(pagado.getTime()) ? new Date() : pagado;
  const end = addMonthsClamped(start, monthsForPeriod(periodicity));
  const cpe = currentPeriodEnd ? new Date(currentPeriodEnd) : null;
  const acorta = !!cpe && !isNaN(cpe.getTime()) && end.getTime() < cpe.getTime();
  return { start, end, acorta };
}

function todayLocalISO(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

export function ManualPaymentsCard({
  tenantId,
  onChange,
}: {
  tenantId: string;
  /** Recarga el tenant padre (registrar un pago cambia status/ciclo). */
  onChange: () => void;
}) {
  const [data, setData] = useState<ManualPaymentsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingMode, setSavingMode] = useState(false);
  const [showModal, setShowModal] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const d = await api<ManualPaymentsData>(`/tenants/${tenantId}/manual-payments`);
      setData(d);
    } catch (e: any) {
      // Error visible con reintento — NUNCA un "Cargando…" eterno ni un
      // vacío falso que se lea como "no hay pagos".
      setError(e?.message || 'No se pudo cargar la información de pagos manuales');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, [tenantId]);

  async function toggleMode() {
    if (!data || savingMode) return;
    const enabled = !data.manualPayment;
    const question = enabled
      ? `¿Marcar «${data.brandName}» como "paga por fuera"?\n\nEl sistema NO lo suspenderá solo cuando venza su ciclo: quedará en la lista "Pagos por fuera" para que registres el pago o lo desconectes a mano.`
      : `¿Quitar "paga por fuera" a «${data.brandName}»?\n\nVuelve al cobro normal: si su ciclo vence sin pago confirmado, el sistema podrá suspenderlo automáticamente.`;
    if (!confirm(question)) return;
    setSavingMode(true);
    try {
      const res = await api<{ id: string; manualPayment: boolean }>(
        `/tenants/${tenantId}/manual-payment-mode`,
        { method: 'PATCH', body: JSON.stringify({ enabled }) },
      );
      setData((d) => (d ? { ...d, manualPayment: res.manualPayment } : d));
      toast(
        res.manualPayment
          ? 'Marcado como "paga por fuera": no se suspenderá solo, revísalo en Pagos por fuera'
          : 'Vuelve al cobro automático',
        'success',
      );
      onChange();
    } catch (e: any) {
      toast(e?.message || 'No se pudo cambiar el modo de pago', 'error');
    } finally {
      setSavingMode(false);
    }
  }

  return (
    <div className="card card-pad md:col-span-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-base font-semibold m-0">
          Pagos por fuera (Nequi, efectivo, transferencia)
        </h2>
        {data && (
          <button
            type="button"
            className="btn-primary text-sm"
            onClick={() => setShowModal(true)}
          >
            Registrar pago manual
          </button>
        )}
      </div>

      {loading && (
        <div className="mt-3 space-y-2">
          <div className="h-10 bg-bg2 rounded animate-shimmer" />
          <div className="h-24 bg-bg2 rounded animate-shimmer" />
        </div>
      )}

      {!loading && error && (
        <div className="mt-3 rounded-lg bg-bad-soft border border-bad/30 px-3 py-3 text-sm text-bad-ink">
          <div>{error}</div>
          <button type="button" className="btn-ghost text-sm mt-2" onClick={load}>
            Reintentar
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Interruptor "paga por fuera" — la consecuencia se explica ANTES
              de activarlo, no después. */}
          <div className="mt-3 flex items-start gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={data.manualPayment}
              aria-label='Paga por fuera (Nequi, efectivo, transferencia)'
              disabled={savingMode}
              onClick={toggleMode}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition mt-0.5 disabled:opacity-60 ${
                data.manualPayment ? 'bg-brand' : 'bg-mute2'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition ${
                  data.manualPayment ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <div className="min-w-0">
              <div className="text-sm font-semibold">
                Paga por fuera (Nequi, efectivo, transferencia)
                {savingMode && (
                  <span className="ml-2 text-xs text-mute font-normal">Guardando…</span>
                )}
              </div>
              <p className="text-xs text-mute leading-snug mt-0.5">
                Con esto activo, el sistema <strong>no suspenderá este negocio solo</strong>{' '}
                cuando venza su ciclo (nadie confirma sus pagos automáticamente). En su
                lugar aparecerá en la lista <strong>Pagos por fuera</strong> para que
                registres el pago o lo desconectes a mano. Los recordatorios de cobro
                siguen saliendo normal.
              </p>
            </div>
          </div>

          {/* Contexto del ciclo: lo que más se confunde es cuánto corre cada
              pago — el plan manda (trimestral = 3 meses, anual = 12). */}
          <div className="mt-3 rounded-lg bg-bg2 px-3 py-2 text-sm flex flex-wrap gap-x-4 gap-y-1">
            <span>
              Plan <strong>{periodLabel(data.planPeriodicity)}</strong>{' '}
              <span className="text-mute">
                (cada pago cubre {monthsForPeriod(data.planPeriodicity)}{' '}
                {monthsForPeriod(data.planPeriodicity) === 1 ? 'mes' : 'meses'})
              </span>
            </span>
            <span>
              {data.currentPeriodEnd ? (
                new Date(data.currentPeriodEnd).getTime() > Date.now() ? (
                  <>
                    Cubierto hasta el{' '}
                    <strong className="text-ok-ink">{fmtDate(data.currentPeriodEnd)}</strong>
                  </>
                ) : (
                  <>
                    Ciclo vencido desde el{' '}
                    <strong className="text-bad">{fmtDate(data.currentPeriodEnd)}</strong>
                  </>
                )
              ) : (
                <span className="text-mute">Sin ciclo de cobro iniciado</span>
              )}
            </span>
          </div>

          {/* Historial */}
          <h3 className="text-sm font-semibold mt-4 mb-2">Historial de pagos manuales</h3>
          {data.payments.length === 0 ? (
            <p className="text-sm text-mute">
              Aún no hay pagos manuales registrados para este negocio.
            </p>
          ) : (
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full text-[13px] min-w-[620px]">
                <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Fecha de pago</th>
                    <th className="px-3 py-2 font-semibold">Método</th>
                    <th className="px-3 py-2 font-semibold text-right">Importe</th>
                    <th className="px-3 py-2 font-semibold">Referencia</th>
                    <th className="px-3 py-2 font-semibold">Ciclo cubierto</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={p.id} className="border-t border-line2 align-top">
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(p.paidAt)}</td>
                      <td className="px-3 py-2">{METHOD_LABEL[p.method] ?? p.method}</td>
                      <td className="px-3 py-2 text-right font-medium whitespace-nowrap">
                        {fmtAmount(p.amount, p.currency)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-mono text-xs">{p.reference || '—'}</div>
                        {p.note && (
                          <div className="text-[11px] text-mute mt-0.5 max-w-[220px] whitespace-pre-wrap">
                            {p.note}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {fmtDate(p.periodStart)} → {fmtDate(p.periodEnd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {showModal && data && (
        <RegisterManualPaymentModal
          tenantId={tenantId}
          data={data}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false);
            load();
            onChange();
          }}
        />
      )}
    </div>
  );
}

function RegisterManualPaymentModal({
  tenantId,
  data,
  onClose,
  onSaved,
}: {
  tenantId: string;
  data: ManualPaymentsData;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = todayLocalISO();
  const [method, setMethod] = useState<ManualPaymentMethod>('NEQUI');
  const [amount, setAmount] = useState(
    data.suggestedAmount != null ? String(data.suggestedAmount) : '',
  );
  const [currency, setCurrency] = useState(data.suggestedCurrency || 'USD');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [paidAt, setPaidAt] = useState(today);
  const [saving, setSaving] = useState(false);

  // Se recalcula con la fecha del formulario: el recuadro tiene que responder
  // a lo que el usuario acaba de escribir, no a hoy.
  const proj = projectCoverage(paidAt, data.currentPeriodEnd, data.planPeriodicity);
  const months = monthsForPeriod(data.planPeriodicity);

  async function submit() {
    if (saving) return;
    if (paidAt > today) {
      toast('La fecha de pago no puede ser futura', 'error');
      return;
    }
    const amountNum = amount.trim() === '' ? null : Number(amount);
    if (amountNum != null && (!Number.isFinite(amountNum) || amountNum < 0)) {
      toast('El importe no es válido', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await api<{
        payment: ManualPaymentRow;
        tenant: { id: string; status: string; currentPeriodEnd: string | null };
      }>(`/tenants/${tenantId}/manual-payments`, {
        method: 'POST',
        body: JSON.stringify({
          method,
          ...(amountNum != null ? { amount: amountNum } : {}),
          currency: currency || 'USD',
          ...(reference.trim() ? { reference: reference.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          // Hoy → instante real. Fecha pasada → mediodía UTC: a medianoche
          // UTC, América (UTC-5) la mostraría como el día ANTERIOR.
          paidAt:
            paidAt === today
              ? new Date().toISOString()
              : `${paidAt}T12:00:00.000Z`,
        }),
      });
      toast(
        `Pago registrado. «${data.brandName}» queda activo hasta el ${fmtDate(
          res.tenant.currentPeriodEnd,
        )}.`,
        'success',
      );
      onSaved();
    } catch (e: any) {
      // El 403 de "marca sin créditos" trae un mensaje útil del backend:
      // se muestra tal cual, no es un error del sistema.
      toast(e?.message || 'No se pudo registrar el pago', 'error');
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center sm:p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md shadow-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-line2">
          <div className="font-semibold text-base">Registrar pago manual</div>
          <div className="text-xs text-mute mt-0.5">{data.brandName}</div>
        </div>

        <div className="px-5 py-4 space-y-3">
          {/* Lo que va a pasar, ANTES de confirmar: periodicidad + fecha final.
              Es donde más se equivocan: un trimestral corre 3 meses, no 30 días. */}
          <div className="rounded-lg bg-brand-soft/50 border border-brand/30 px-3 py-2.5 text-sm leading-snug">
            <div>
              Plan <strong>{periodLabel(data.planPeriodicity)}</strong>: este pago cubre{' '}
              <strong>
                {months} {months === 1 ? 'mes' : 'meses'}
              </strong>
              .
            </div>
            <div className="mt-1">
              Desde el <strong>{fmtDate(proj.start.toISOString())}</strong> quedará
              cubierto hasta el <strong>{fmtDate(proj.end.toISOString())}</strong>.
            </div>
            {proj.acorta && data.currentPeriodEnd && (
              <div className="text-xs mt-1.5 text-warn">
                ⚠ Hoy figura cubierto hasta el {fmtDate(data.currentPeriodEnd)}. Con
                esta fecha de pago la cobertura queda más corta. Si el pago es de
                un ciclo posterior, corrige la fecha.
              </div>
            )}
          </div>

          <div>
            <label className="label">Método de pago</label>
            <select
              className="input"
              value={method}
              onChange={(e) => setMethod(e.target.value as ManualPaymentMethod)}
            >
              <option value="NEQUI">Nequi</option>
              <option value="EFECTIVO">Efectivo</option>
              <option value="TRANSFERENCIA">Transferencia</option>
              <option value="OTRO">Otro</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Importe</label>
              <input
                className="input"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={
                  data.suggestedAmount != null ? String(data.suggestedAmount) : 'Opcional'
                }
              />
            </div>
            <div>
              <label className="label">Moneda</label>
              <select
                className="input"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option value="USD">USD</option>
                <option value="COP">COP</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label">Fecha de pago</label>
            <input
              className="input"
              type="date"
              value={paidAt}
              max={today}
              onChange={(e) => setPaidAt(e.target.value)}
            />
            <p className="text-[11px] text-mute mt-1">
              Cuándo pagó realmente el cliente. No puede ser una fecha futura.
            </p>
          </div>

          <div>
            <label className="label">Referencia (opcional)</label>
            <input
              className="input"
              value={reference}
              maxLength={120}
              onChange={(e) => setReference(e.target.value)}
              placeholder="N.º de comprobante Nequi, transferencia…"
            />
          </div>

          <div>
            <label className="label">Nota (opcional)</label>
            <textarea
              className="input min-h-[64px] resize-y"
              value={note}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ej: pagó la mitad en efectivo, saldo la otra semana…"
            />
          </div>
        </div>

        <div className="px-5 py-3 border-t border-line2 flex flex-col-reverse sm:flex-row items-stretch sm:items-center sm:justify-end gap-2">
          <button
            type="button"
            className="btn-ghost text-sm justify-center min-h-[44px] disabled:opacity-50"
            disabled={saving}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn-primary text-sm justify-center min-h-[44px] disabled:opacity-60"
            disabled={saving}
            onClick={submit}
          >
            {saving ? 'Guardando…' : 'Registrar pago'}
          </button>
        </div>
      </div>
    </div>
  );
}
