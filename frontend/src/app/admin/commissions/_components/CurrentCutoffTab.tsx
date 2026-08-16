'use client';
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

// ─────────────────────────────────────────────────────────────────────────────
// PESTAÑA "CORTE ACTUAL"
// Responde sin aplicar ningún filtro la única pregunta del día: cuánto hay que
// pagar y a quién. La tabla va agrupada por PERSONA (que es a quien se le gira);
// el detalle comisión por comisión queda adentro como respaldo.
// ─────────────────────────────────────────────────────────────────────────────

export type CutoffCommission = {
  id: string;
  amount: number;
  date: string;
  availableAt: string;
  daysRemaining: number;
  businessName: string;
  planName: string | null;
  batchCode: string | null;
};

export type OpenBatch = {
  id: string;
  code: string;
  cutoffDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  totalUsd: number;
  commissionsCount: number;
  generatedAuto: boolean;
  createdAt: string;
  daysOpen: number;
  isStale: boolean;
};

export type CutoffPerson = {
  codeId: string;
  code: string;
  ownerName: string;
  ownerEmail: string;
  role: string;
  paymentMethod: 'BINANCE' | 'BANK' | null;
  profileStatus: 'APPROVED' | 'PENDING_REVIEW' | 'REJECTED' | 'NONE' | 'MISSING_USER';
  canTransfer: boolean;
  commissionsCount: number;
  totalUsd: number;
  commissions: CutoffCommission[];
};

export type CurrentCutoffResp = {
  today: string;
  holdDays: number;
  staleAfterDays: number;
  isPreview: boolean;
  openBatch: OpenBatch | null;
  openBatches: OpenBatch[];
  nextCutoff: { date: string; daysUntil: number };
  toPay: {
    amount: number;
    count: number;
    people: number;
    readyToTransfer: number;
    readyPeople: number;
    blockedByPaymentData: number;
    blockedPeople: number;
  };
  nextBatch: {
    amount: number;
    holdAmount: number;
    holdCount: number;
    holdPeopleCount: number;
    releasesAt: string | null;
    unbatchedAmount: number;
    unbatchedCount: number;
  };
  people: CutoffPerson[];
  holdPeople: CutoffPerson[];
};

function fmtUsd(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Bogota',
  });
}

/** Hoy en Bogotá como 'YYYY-MM-DD' — default de los <input type="date">. */
function todayInput() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

const ROLE_KEY: Record<string, string> = {
  INFLUENCER: 'roleInfluencer',
  AMBASSADOR: 'roleAmbassador',
  VENDOR: 'roleVendor',
  SOCIO: 'roleSocio',
};

export default function CurrentCutoffTab() {
  const t = useTranslations('admin_commissions');
  const [data, setData] = useState<CurrentCutoffResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showHold, setShowHold] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  // Corte que se está cerrando (puede haber más de uno abierto a la vez).
  const [closing, setClosing] = useState<OpenBatch | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<CurrentCutoffResp>('/admin/commissions/current-cutoff');
      setData(res);
      setSelected(new Set());
    } catch (e: any) {
      toast(e?.message ?? t('errorLoading'), 'error');
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const people = data?.people ?? [];
  const allIds = useMemo(
    () => people.flatMap((p) => p.commissions.map((c) => c.id)),
    [people],
  );
  const selectedRows = useMemo(() => {
    const out: Array<{ person: CutoffPerson; c: CutoffCommission }> = [];
    for (const p of people) {
      for (const c of p.commissions) if (selected.has(c.id)) out.push({ person: p, c });
    }
    return out;
  }, [people, selected]);
  const selectedTotal = selectedRows.reduce((s, r) => s + r.c.amount, 0);
  const selectedPeople = new Set(selectedRows.map((r) => r.person.codeId)).size;

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePerson(p: CutoffPerson) {
    const ids = p.commissions.map((c) => c.id);
    const allOn = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === allIds.length ? new Set() : new Set(allIds),
    );
  }

  function toggleExpand(codeId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(codeId)) next.delete(codeId);
      else next.add(codeId);
      return next;
    });
  }

  if (loading && !data) {
    return <div className="card card-pad text-center text-mute">{t('loading')}</div>;
  }
  if (!data) return null;

  const batch = data.openBatch;
  const openBatches = data.openBatches ?? [];

  return (
    <div className="pb-24">
      {/* Alerta por corte estancado: exactamente lo que habría evitado el caso
          del 31/07 (transferido por banco, nunca registrado). Una por corte:
          si quedaron dos abiertos, ninguno se esconde detrás del otro. */}
      {openBatches
        .filter((b) => b.isStale)
        .map((b) => (
          <div
            key={b.id}
            className="card card-pad mb-4 border-2 border-amber-400 bg-amber-50"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-bold text-amber-900">
                  ⚠️ {t('cutoffStaleTitle', { code: b.code, days: b.daysOpen })}
                </div>
                <div className="text-sm text-amber-800 mt-0.5">
                  {t('cutoffStaleBody', { amount: fmtUsd(b.totalUsd) })}
                </div>
              </div>
              <button
                onClick={() => setClosing(b)}
                className="text-sm px-4 py-2 rounded-pill bg-amber-600 text-white font-semibold hover:opacity-90 transition"
              >
                {t('cutoffCloseCta')}
              </button>
            </div>
          </div>
        ))}

      {/* Tres números y nada más. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div className="card card-pad">
          <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
            {t('kpiToPayTitle')}
          </div>
          <div className="text-3xl font-bold mt-1 text-brand">
            {fmtUsd(data.toPay.amount)}
          </div>
          <div className="text-[11px] text-mute mt-1">
            {batch
              ? t('kpiToPayHint', {
                  code: batch.code,
                  count: data.toPay.count,
                  people: data.toPay.people,
                })
              : t('kpiToPayPreview', {
                  count: data.toPay.count,
                  people: data.toPay.people,
                })}
          </div>
        </div>

        <div className="card card-pad">
          <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
            {t('kpiNextBatchTitle')}
          </div>
          <div className="text-3xl font-bold mt-1 text-amber-600">
            {fmtUsd(data.nextBatch.amount)}
          </div>
          <div className="text-[11px] text-mute mt-1">
            {t('kpiNextBatchHold', {
              amount: fmtUsd(data.nextBatch.holdAmount),
              count: data.nextBatch.holdCount,
              date: fmtDate(data.nextBatch.releasesAt),
            })}
            {data.nextBatch.unbatchedCount > 0 && (
              <>
                {' · '}
                {t('kpiNextBatchUnbatched', {
                  amount: fmtUsd(data.nextBatch.unbatchedAmount),
                  count: data.nextBatch.unbatchedCount,
                })}
              </>
            )}
          </div>
        </div>

        <div className="card card-pad">
          <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
            {t('kpiNextCutoffTitle')}
          </div>
          <div className="text-3xl font-bold mt-1">
            {fmtDate(`${data.nextCutoff.date}T12:00:00Z`)}
          </div>
          <div className="text-[11px] text-mute mt-1">
            {data.nextCutoff.daysUntil === 0
              ? t('kpiNextCutoffToday')
              : t('kpiNextCutoffDays', { days: data.nextCutoff.daysUntil })}
          </div>
        </div>
      </div>

      {/* Listo para transferir vs frenado por datos de pago. La distinción que
          hoy se pierde entre "$166.80 disponibles" y "0 personas listas". */}
      <div className="flex flex-wrap items-center gap-2 mb-4 text-sm">
        <span className="px-3 py-1.5 rounded-pill bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold">
          ✓ {t('readyToTransfer', {
            amount: fmtUsd(data.toPay.readyToTransfer),
            people: data.toPay.readyPeople,
          })}
        </span>
        {data.toPay.blockedPeople > 0 && (
          <>
            <span className="px-3 py-1.5 rounded-pill bg-red-50 text-red-800 border border-red-200 font-semibold">
              ⛔ {t('blockedNoPaymentData', {
                amount: fmtUsd(data.toPay.blockedByPaymentData),
                people: data.toPay.blockedPeople,
              })}
            </span>
            <Link
              href="/admin/payouts"
              className="text-brand font-semibold underline underline-offset-2"
            >
              {t('completePaymentData')} →
            </Link>
          </>
        )}
        {batch && (
          <span className="ml-auto text-xs text-mute">
            {t('batchOpenSince', {
              days: batch.daysOpen,
              date: fmtDate(batch.cutoffDate),
            })}
          </span>
        )}
      </div>

      {/* Tabla agrupada por persona */}
      <div className="card overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-line2 bg-bg2">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              className="w-4 h-4 accent-current"
              checked={allIds.length > 0 && selected.size === allIds.length}
              onChange={toggleAll}
              disabled={allIds.length === 0}
              aria-label={t('selectAll')}
            />
            <span className="text-[11px] uppercase tracking-wider text-mute font-semibold">
              {batch ? batch.code : t('previewNextCutoff')}
            </span>
            {data.isPreview && (
              <span className="text-[10px] px-2 py-0.5 rounded-pill bg-slate-200 text-slate-700 font-semibold">
                {t('previewBadge')}
              </span>
            )}
            {openBatches.length > 1 && (
              <span className="text-[10px] px-2 py-0.5 rounded-pill bg-amber-100 text-amber-800 font-semibold">
                {t('multipleOpenBatches', { count: openBatches.length })}
              </span>
            )}
          </div>
          {/* Un botón de cierre POR corte abierto: con dos abiertos, cada uno
              se cierra con su propia fecha de transferencia. */}
          <div className="flex flex-wrap items-center gap-2">
            {openBatches.map((b) => (
              <button
                key={b.id}
                onClick={() => setClosing(b)}
                className="text-sm px-3.5 py-1.5 rounded-pill bg-brand text-white font-semibold hover:opacity-90 transition"
              >
                {openBatches.length > 1
                  ? t('closeSpecificBatch', {
                      code: b.code,
                      amount: fmtUsd(b.totalUsd),
                    })
                  : t('cutoffCloseCta')}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 w-10"></th>
                <th className="px-4 py-3 font-semibold">{t('thPerson')}</th>
                <th className="px-4 py-3 font-semibold">{t('thRole')}</th>
                <th className="px-4 py-3 font-semibold">{t('thPaymentMethod')}</th>
                <th className="px-4 py-3 font-semibold text-center">
                  {t('thCommissions')}
                </th>
                <th className="px-4 py-3 font-semibold text-right">{t('thTotal')}</th>
                <th className="px-4 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line2">
              {people.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-mute">
                    {t('cutoffEmpty')}
                  </td>
                </tr>
              )}
              {people.map((p) => {
                const ids = p.commissions.map((c) => c.id);
                const allOn = ids.every((id) => selected.has(id));
                const someOn = !allOn && ids.some((id) => selected.has(id));
                const isOpen = expanded.has(p.codeId);
                return (
                  <Fragment key={p.codeId}>
                    <tr className="hover:bg-bg2/40">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          className="w-4 h-4"
                          checked={allOn}
                          ref={(el) => {
                            if (el) el.indeterminate = someOn;
                          }}
                          onChange={() => togglePerson(p)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold">{p.ownerName}</div>
                        <div className="text-[11px] text-mute">
                          {p.code} · {p.ownerEmail}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {t(ROLE_KEY[p.role] ?? 'roleInfluencer')}
                      </td>
                      <td className="px-4 py-3">
                        {p.canTransfer ? (
                          <span className="text-xs px-2 py-0.5 rounded-pill bg-emerald-100 text-emerald-800 font-semibold">
                            {p.paymentMethod === 'BANK'
                              ? t('methodBank')
                              : t('methodBinance')}
                          </span>
                        ) : (
                          <Link
                            href="/admin/payouts"
                            className="text-xs px-2 py-0.5 rounded-pill bg-red-100 text-red-800 font-semibold hover:opacity-80"
                            title={t('profileStatusHint')}
                          >
                            {p.profileStatus === 'MISSING_USER'
                              ? t('profileMissingUser')
                              : p.profileStatus === 'PENDING_REVIEW'
                                ? t('profilePendingReview')
                                : p.profileStatus === 'REJECTED'
                                  ? t('profileRejected')
                                  : t('profileNone')}
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">{p.commissionsCount}</td>
                      <td className="px-4 py-3 text-right font-bold">
                        {fmtUsd(p.totalUsd)}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleExpand(p.codeId)}
                          className="text-mute hover:text-ink"
                          aria-label={t('toggleDetail')}
                        >
                          {isOpen ? '▲' : '▼'}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-bg2/40">
                        <td></td>
                        <td colSpan={6} className="px-4 py-3">
                          <table className="w-full text-xs">
                            <thead className="text-mute uppercase tracking-wider text-[10px]">
                              <tr>
                                <th className="py-1 w-8"></th>
                                <th className="py-1 text-left font-semibold">
                                  {t('thBusiness')}
                                </th>
                                <th className="py-1 text-left font-semibold">
                                  {t('thPlan')}
                                </th>
                                <th className="py-1 text-left font-semibold">
                                  {t('dateTypePurchase')}
                                </th>
                                <th className="py-1 text-right font-semibold">
                                  {t('thAmount')}
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {p.commissions.map((c) => (
                                <tr key={c.id}>
                                  <td className="py-1">
                                    <input
                                      type="checkbox"
                                      className="w-3.5 h-3.5"
                                      checked={selected.has(c.id)}
                                      onChange={() => toggleOne(c.id)}
                                    />
                                  </td>
                                  <td className="py-1">
                                    {c.businessName}
                                    {openBatches.length > 1 && c.batchCode && (
                                      <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">
                                        {c.batchCode}
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-1 text-mute">
                                    {c.planName ?? '—'}
                                  </td>
                                  <td className="py-1 text-mute">{fmtDate(c.date)}</td>
                                  <td className="py-1 text-right font-semibold">
                                    {fmtUsd(c.amount)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* En hold: se ven, no se seleccionan. */}
      {data.holdPeople.length > 0 && (
        <div className="card card-pad mt-4">
          <button
            onClick={() => setShowHold((s) => !s)}
            className="flex w-full items-center justify-between text-left"
          >
            <span className="font-semibold text-amber-800">
              🔒 {t('holdSectionTitle', {
                amount: fmtUsd(data.nextBatch.holdAmount),
                count: data.nextBatch.holdCount,
                days: data.holdDays,
              })}
            </span>
            <span className="text-xs text-mute">
              {showHold ? t('hide') : t('show')}
            </span>
          </button>
          {showHold && (
            <div className="mt-3 space-y-2">
              {data.holdPeople.map((p) => (
                <div key={p.codeId} className="rounded-lg border border-line2 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold">{p.ownerName}</span>
                    <span className="font-bold text-amber-700">
                      {fmtUsd(p.totalUsd)}
                    </span>
                  </div>
                  <table className="w-full text-xs mt-2">
                    <tbody>
                      {p.commissions.map((c) => (
                        <tr key={c.id}>
                          <td className="py-1 w-8">
                            <input
                              type="checkbox"
                              className="w-3.5 h-3.5 cursor-not-allowed"
                              disabled
                              title={t('holdCheckboxTooltip', {
                                days: c.daysRemaining,
                                date: fmtDate(c.availableAt),
                              })}
                            />
                          </td>
                          <td className="py-1">{c.businessName}</td>
                          <td className="py-1 text-mute">
                            {t('holdReleasesOn', {
                              date: fmtDate(c.availableAt),
                              days: c.daysRemaining,
                            })}
                          </td>
                          <td className="py-1 text-right">{fmtUsd(c.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Barra flotante con el total en vivo */}
      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-line2 bg-surface/95 backdrop-blur px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <b>{t('selectedCount', { count: selected.size })}</b>
              <span className="text-mute"> · </span>
              <b className="text-brand text-lg">{fmtUsd(selectedTotal)}</b>
              <span className="text-mute">
                {' '}
                · {t('selectedPeople', { people: selectedPeople })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelected(new Set())}
                className="text-sm px-3 py-2 rounded-md bg-bg2 hover:bg-bg3 transition"
              >
                {t('clearSelection')}
              </button>
              <button
                onClick={() => setPayOpen(true)}
                className="text-sm px-4 py-2 rounded-md bg-brand text-white font-semibold hover:opacity-90 transition"
              >
                {t('markAsPaid')}
              </button>
            </div>
          </div>
        </div>
      )}

      {payOpen && (
        <BulkPayModal
          count={selected.size}
          people={selectedPeople}
          total={selectedTotal}
          ids={Array.from(selected)}
          onClose={() => setPayOpen(false)}
          onSaved={() => {
            setPayOpen(false);
            void load();
          }}
        />
      )}

      {closing && (
        <CloseBatchModal
          batch={closing}
          total={closing.totalUsd}
          count={closing.commissionsCount}
          people={
            new Set(
              people
                .filter((p) =>
                  p.commissions.some((c) => c.batchCode === closing.code),
                )
                .map((p) => p.codeId),
            ).size
          }
          onClose={() => setClosing(null)}
          onSaved={() => {
            setClosing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

// ── Modales ─────────────────────────────────────────────────────────────────

function BulkPayModal({
  count,
  people,
  total,
  ids,
  onClose,
  onSaved,
}: {
  count: number;
  people: number;
  total: number;
  ids: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('admin_commissions');
  const [paymentDate, setPaymentDate] = useState(todayInput());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!paymentDate) {
      toast(t('errorPaymentDateRequired'), 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await api<{ paidCount: number; totalPaid: number }>(
        '/admin/commissions/pay-bulk',
        {
          method: 'POST',
          body: JSON.stringify({
            commissionIds: ids,
            paymentDate,
            note: note.trim() || undefined,
          }),
        },
      );
      toast(
        t('toastBulkPaid', {
          count: res?.paidCount ?? count,
          amount: fmtUsd(res?.totalPaid ?? total),
        }),
        'success',
      );
      onSaved();
    } catch (e: any) {
      toast(e?.message ?? t('errorMarkingPayments'), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-xl max-w-md w-full p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-4">{t('bulkPayTitle')}</h2>

        <div className="bg-bg2 rounded-lg p-3 mb-4 text-sm">
          <div className="flex justify-between mb-1">
            <span className="text-mute">{t('bulkPayTotal')}</span>
            <span className="font-bold text-lg text-brand">{fmtUsd(total)}</span>
          </div>
          <div className="flex justify-between mb-1">
            <span className="text-mute">{t('bulkPayCount')}</span>
            <span className="font-medium">{count}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-mute">{t('bulkPayPeople')}</span>
            <span className="font-medium">{people}</span>
          </div>
        </div>

        <div className="mb-3">
          <label className="label">{t('realTransferDate')}</label>
          <input
            type="date"
            className="input w-full"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
            autoFocus
          />
          <div className="text-[11px] text-mute mt-1">{t('realTransferDateHint')}</div>
        </div>

        <div className="mb-4">
          <label className="label">{t('modalReferenceNote')}</label>
          <input
            type="text"
            className="input w-full"
            placeholder={t('phReferenceNote')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={saving}
            className="text-sm px-4 py-2 rounded-md bg-bg2 hover:bg-bg3 transition"
          >
            {t('btnCancel')}
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="text-sm px-4 py-2 rounded-md bg-brand text-white font-semibold hover:opacity-90 transition disabled:opacity-50"
          >
            {saving ? t('saving') : t('markAsPaid')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CloseBatchModal({
  batch,
  total,
  count,
  people,
  onClose,
  onSaved,
}: {
  batch: { id: string; code: string };
  total: number;
  count: number;
  people: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('admin_commissions');
  const [paymentDate, setPaymentDate] = useState(todayInput());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!paymentDate) {
      toast(t('errorPaymentDateRequired'), 'error');
      return;
    }
    setSaving(true);
    try {
      await api(`/admin/commissions/payout-batches/${batch.id}/close`, {
        method: 'POST',
        body: JSON.stringify({
          paymentDate,
          reference: reference.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      toast(t('toastBatchClosed', { code: batch.code }), 'success');
      onSaved();
    } catch (e: any) {
      toast(e?.message ?? t('errorClosingBatch'), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-xl max-w-md w-full p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-1">
          {t('closeBatchTitle', { code: batch.code })}
        </h2>
        <p className="text-xs text-mute mb-4">{t('closeBatchSubtitle')}</p>

        <div className="bg-bg2 rounded-lg p-3 mb-4 text-sm">
          <div className="flex justify-between mb-1">
            <span className="text-mute">{t('bulkPayTotal')}</span>
            <span className="font-bold text-lg text-brand">{fmtUsd(total)}</span>
          </div>
          <div className="flex justify-between mb-1">
            <span className="text-mute">{t('bulkPayCount')}</span>
            <span className="font-medium">{count}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-mute">{t('bulkPayPeople')}</span>
            <span className="font-medium">{people}</span>
          </div>
        </div>

        <div className="mb-3">
          <label className="label">{t('realTransferDate')}</label>
          <input
            type="date"
            className="input w-full"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
            autoFocus
          />
          <div className="text-[11px] text-mute mt-1">{t('realTransferDateHint')}</div>
        </div>

        <div className="mb-3">
          <label className="label">{t('batchReference')}</label>
          <input
            type="text"
            className="input w-full"
            placeholder={t('phBatchReference')}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>

        <div className="mb-4">
          <label className="label">{t('batchNotes')}</label>
          <input
            type="text"
            className="input w-full"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={saving}
            className="text-sm px-4 py-2 rounded-md bg-bg2 hover:bg-bg3 transition"
          >
            {t('btnCancel')}
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="text-sm px-4 py-2 rounded-md bg-brand text-white font-semibold hover:opacity-90 transition disabled:opacity-50"
          >
            {saving ? t('saving') : t('confirmCloseBatch')}
          </button>
        </div>
      </div>
    </div>
  );
}
