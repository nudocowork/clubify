'use client';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { CloseBatchModal, cutoffLabelFromCode } from './CurrentCutoffTab';

// ─────────────────────────────────────────────────────────────────────────────
// PESTAÑA "HISTORIAL DE CORTES"
// Serie completa de cortes (incluidos los de $0: un mes sin corte se lee como
// un corte perdido). Al abrir uno se ve su contenido y se exporta el CSV que
// se le manda a la contadora.
// ─────────────────────────────────────────────────────────────────────────────

type BatchRow = {
  id: string;
  code: string;
  cutoffDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  paymentDate: string | null;
  kind: string;
  status: 'OPEN' | 'CLOSED';
  totalUsd: number;
  commissionsCount: number;
  reference: string | null;
  generatedAuto: boolean;
  closedAt: string | null;
  closedBy: { id: string; name: string; email: string } | null;
  daysOpen: number;
  isStale: boolean;
};

type BatchDetail = BatchRow & {
  notes: string | null;
  commissions: Array<{
    id: string;
    amount: number;
    amountPaid: number;
    status: string;
    paymentStatus: string;
    date: string;
    paidAt: string | null;
    businessName: string;
    planName: string | null;
    recipient: {
      id: string;
      code: string;
      ownerName: string;
      ownerEmail: string;
      role: string;
    } | null;
  }>;
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

function ymd(d: string | null | undefined) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

export default function BatchHistoryTab() {
  const t = useTranslations('admin_commissions');
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BatchDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [closing, setClosing] = useState<BatchDetail | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<BatchRow[]>('/admin/commissions/payout-batches');
      setRows(res ?? []);
    } catch (e: any) {
      toast(e?.message ?? t('errorLoading'), 'error');
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = useCallback(
    async (id: string) => {
      if (openId === id) {
        setOpenId(null);
        setDetail(null);
        return;
      }
      setOpenId(id);
      setDetail(null);
      setDetailLoading(true);
      try {
        const res = await api<BatchDetail>(`/admin/commissions/payout-batches/${id}`);
        setDetail(res);
      } catch (e: any) {
        toast(e?.message ?? t('errorLoading'), 'error');
      } finally {
        setDetailLoading(false);
      }
    },
    [openId, t],
  );

  function exportCsv(d: BatchDetail) {
    const headers = [
      t('csvDate'),
      t('csvBusiness'),
      t('csvPlan'),
      t('csvRecipient'),
      t('csvRole'),
      t('csvEmail'),
      t('csvCode'),
      t('csvAmount'),
      t('csvPaid'),
      t('csvStatus'),
      t('csvPaidDate'),
    ];
    const lines = d.commissions.map((c) =>
      [
        ymd(c.date),
        c.businessName,
        c.planName ?? '',
        c.recipient?.ownerName ?? '',
        c.recipient?.role ?? '',
        c.recipient?.ownerEmail ?? '',
        c.recipient?.code ?? '',
        c.amount.toFixed(2),
        c.amountPaid.toFixed(2),
        c.status,
        ymd(c.paidAt),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    // Cabecera del corte arriba del detalle: la contadora abre el archivo y ve
    // de qué corte se trata sin tener que preguntarlo.
    const head = [
      `"${d.code}"`,
      `"${t('thCutoffDate')}: ${ymd(d.cutoffDate)}"`,
      `"${t('thPaymentDate')}: ${ymd(d.paymentDate) || '—'}"`,
      `"${t('thStatus')}: ${d.status === 'OPEN' ? t('batchOpen') : t('batchClosed')}"`,
      `"${t('thTotal')}: ${d.totalUsd.toFixed(2)}"`,
    ].join('\n');

    const csv = `${head}\n\n${headers.join(',')}\n${lines.join('\n')}`;
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${d.code}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function reopen(d: BatchDetail) {
    if (!window.confirm(t('confirmReopen', { code: d.code }))) return;
    const reason = window.prompt(t('promptReopenReason')) ?? undefined;
    try {
      await api(`/admin/commissions/payout-batches/${d.id}/reopen`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      toast(t('toastBatchReopened', { code: d.code }), 'success');
      setOpenId(null);
      setDetail(null);
      void load();
    } catch (e: any) {
      toast(e?.message ?? t('errorReopeningBatch'), 'error');
    }
  }

  if (loading) {
    return <div className="card card-pad text-center text-mute">{t('loading')}</div>;
  }

  return (
    <div>
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 font-semibold">{t('thBatchCode')}</th>
                <th className="px-4 py-3 font-semibold">{t('thCutoffDate')}</th>
                <th className="px-4 py-3 font-semibold">{t('thStatus')}</th>
                <th className="px-4 py-3 font-semibold">{t('thPaymentDate')}</th>
                <th className="px-4 py-3 font-semibold text-center">
                  {t('thCommissions')}
                </th>
                <th className="px-4 py-3 font-semibold text-right">{t('thTotal')}</th>
                <th className="px-4 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line2">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-mute">
                    {t('historyEmpty')}
                  </td>
                </tr>
              )}
              {rows.map((b) => (
                <tr
                  key={b.id}
                  className={`hover:bg-bg2/40 cursor-pointer ${
                    openId === b.id ? 'bg-bg2/60' : ''
                  }`}
                  onClick={() => void openDetail(b.id)}
                >
                  <td className="px-4 py-3">
                    <div className="font-semibold">{cutoffLabelFromCode(b.code)}</div>
                    <div className="text-[10px] text-mute font-mono">{b.code}</div>
                    {b.generatedAuto && (
                      <div className="text-[10px] text-mute">{t('batchAuto')}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">{fmtDate(b.cutoffDate)}</td>
                  <td className="px-4 py-3">
                    {b.status === 'OPEN' ? (
                      <span
                        className={`text-xs px-2 py-0.5 rounded-pill font-semibold ${
                          b.isStale
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {b.isStale
                          ? `⚠️ ${t('batchOpenDays', { days: b.daysOpen })}`
                          : t('batchOpen')}
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-pill bg-emerald-100 text-emerald-800 font-semibold">
                        {t('batchClosed')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{fmtDate(b.paymentDate)}</td>
                  <td className="px-4 py-3 text-center">{b.commissionsCount}</td>
                  <td className="px-4 py-3 text-right font-bold">
                    {fmtUsd(b.totalUsd)}
                  </td>
                  <td className="px-4 py-3 text-mute">
                    {openId === b.id ? '▲' : '▼'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {openId && (
        <div className="card card-pad mt-4">
          {detailLoading && <div className="text-center text-mute">{t('loading')}</div>}
          {detail && (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-lg font-bold">{detail.code}</h3>
                  <div className="text-xs text-mute mt-0.5">
                    {t('batchPeriod', {
                      from: fmtDate(detail.periodStart ?? detail.cutoffDate),
                      to: fmtDate(detail.periodEnd ?? detail.cutoffDate),
                    })}
                  </div>
                  {detail.closedBy && (
                    <div className="text-xs text-mute mt-0.5">
                      {t('batchClosedBy', {
                        name: detail.closedBy.name,
                        date: fmtDate(detail.closedAt),
                      })}
                      {detail.reference ? ` · ${detail.reference}` : ''}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => exportCsv(detail)}
                    className="text-sm px-3.5 py-2 rounded-pill border border-line2 bg-bg2 hover:bg-bg3 transition font-semibold"
                  >
                    ⬇ {t('exportCsv')}
                  </button>
                  {detail.status === 'OPEN' && (
                    <button
                      onClick={() => setClosing(detail)}
                      className="text-sm px-3.5 py-2 rounded-pill bg-brand text-white font-semibold hover:opacity-90 transition"
                    >
                      {t('cutoffCloseCta')}
                    </button>
                  )}
                  {detail.status === 'CLOSED' && (
                    <button
                      onClick={() => void reopen(detail)}
                      className="text-sm px-3.5 py-2 rounded-pill border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 transition font-semibold"
                    >
                      {t('reopenBatch')}
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-mute uppercase tracking-wider text-[10px] border-b border-line2">
                    <tr>
                      <th className="py-2 text-left font-semibold">
                        {t('dateTypePurchase')}
                      </th>
                      <th className="py-2 text-left font-semibold">{t('thBusiness')}</th>
                      <th className="py-2 text-left font-semibold">{t('thPlan')}</th>
                      <th className="py-2 text-left font-semibold">{t('thRecipient')}</th>
                      <th className="py-2 text-right font-semibold">{t('thAmount')}</th>
                      <th className="py-2 text-left font-semibold">{t('thPaidDate')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line2">
                    {detail.commissions.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-mute">
                          {t('batchEmptyZero')}
                        </td>
                      </tr>
                    )}
                    {detail.commissions.map((c) => (
                      <tr key={c.id}>
                        <td className="py-2">{fmtDate(c.date)}</td>
                        <td className="py-2">{c.businessName}</td>
                        <td className="py-2 text-mute">{c.planName ?? '—'}</td>
                        <td className="py-2">{c.recipient?.ownerName ?? '—'}</td>
                        <td className="py-2 text-right font-semibold">
                          {fmtUsd(c.amount)}
                        </td>
                        <td className="py-2 text-mute">{fmtDate(c.paidAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {closing && (
        <CloseBatchModal
          batch={closing}
          total={closing.totalUsd}
          count={closing.commissionsCount}
          people={
            new Set(
              closing.commissions.map((c) => c.recipient?.id).filter(Boolean),
            ).size
          }
          onClose={() => setClosing(null)}
          onSaved={() => {
            setClosing(null);
            setOpenId(null);
            setDetail(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
