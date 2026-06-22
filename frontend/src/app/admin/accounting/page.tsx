'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type AccountType = 'ASSET' | 'LIABILITY' | 'INCOME' | 'EXPENSE';

type TrialRow = {
  account: string;
  name: string;
  type: AccountType;
  debit: number;
  credit: number;
  balance: number;
};

type LedgerLine = {
  account: string;
  accountName: string;
  debit: number;
  credit: number;
};

type LedgerEntry = {
  id: string;
  date: string;
  memo: string;
  sourceType:
    | 'REVENUE'
    | 'SOCIO_ACCRUAL'
    | 'COMMISSION_ACCRUAL'
    | 'COMMISSION_PAYOUT';
  tenantName: string | null;
  lines: LedgerLine[];
};

type Report = {
  summary: {
    ingresos: number;
    gastoComisiones: number;
    gastoSocio: number;
    comisionesPorPagar: number;
    socioPorPagar: number;
    pagos: number;
    resultado: number;
    socioPercent: number;
  };
  trialBalance: TrialRow[];
  totals: { totalDebit: number; totalCredit: number; balanced: boolean };
  ledger: LedgerEntry[];
  ledgerCount: number;
  truncated: boolean;
  periods: string[];
  periodKey: string | null;
};

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const SOURCE_LABEL_KEY: Record<string, string> = {
  REVENUE: 'sourceRevenue',
  SOCIO_ACCRUAL: 'sourceSocio',
  COMMISSION_ACCRUAL: 'sourceCommissionAccrual',
  COMMISSION_PAYOUT: 'sourceCommissionPayout',
};

const SOURCE_TONE: Record<string, string> = {
  REVENUE: 'bg-emerald-50 text-emerald-700',
  SOCIO_ACCRUAL: 'bg-violet-50 text-violet-700',
  COMMISSION_ACCRUAL: 'bg-amber-50 text-amber-700',
  COMMISSION_PAYOUT: 'bg-indigo-50 text-indigo-700',
};

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

const fmtPeriod = (p: string, t: (k: string) => string) => {
  const [y, m] = p.split('-');
  const months = [
    t('monthJan'), t('monthFeb'), t('monthMar'), t('monthApr'),
    t('monthMay'), t('monthJun'), t('monthJul'), t('monthAug'),
    t('monthSep'), t('monthOct'), t('monthNov'), t('monthDec'),
  ];
  return `${months[Number(m) - 1] ?? m} ${y}`;
};

export default function AccountingPage() {
  const t = useTranslations('admin_accounting');
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('');

  async function load() {
    setLoading(true);
    try {
      const url = `/admin/accounting/report${
        period ? `?periodKey=${period}` : ''
      }`;
      setData(await api<Report>(url));
    } catch (e: any) {
      toast(e?.message ?? t('toastLoadError'), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const s = data?.summary;

  const periodOptions = useMemo(() => data?.periods ?? [], [data]);

  function exportCsv() {
    if (!data?.ledger.length) {
      toast(t('toastNothingToExport'), 'info');
      return;
    }
    const headers = [
      t('csvDate'),
      t('csvType'),
      t('csvMemo'),
      t('csvBusiness'),
      t('csvAccount'),
      t('csvAccountName'),
      t('csvDebit'),
      t('csvCredit'),
    ];
    const rows: string[][] = [];
    for (const e of data.ledger) {
      for (const l of e.lines) {
        rows.push([
          fmtDate(e.date),
          SOURCE_LABEL_KEY[e.sourceType]
            ? t(SOURCE_LABEL_KEY[e.sourceType])
            : e.sourceType,
          e.memo,
          e.tenantName ?? '',
          l.account,
          l.accountName,
          l.debit ? l.debit.toFixed(2) : '',
          l.credit ? l.credit.toFixed(2) : '',
        ]);
      }
    }
    const csv = [headers, ...rows]
      .map((r) =>
        r
          .map((v) => {
            const str = String(v ?? '');
            return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
          })
          .join(','),
      )
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `asientos-${period || 'todo'}-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="max-w-7xl">
      <div className="page-head flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">
          {t('title')}{' '}
          <span className="page-crumb">{t('crumb')}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="text-sm px-3 py-2 rounded-pill border border-slate-300 bg-white"
          >
            <option value="">{t('allHistory')}</option>
            {periodOptions.map((p) => (
              <option key={p} value={p}>
                {fmtPeriod(p, t)}
              </option>
            ))}
          </select>
          <Link
            href="/admin/commissions/report"
            className="text-sm px-3.5 py-2 rounded-pill border border-slate-300 bg-white text-slate-700 font-semibold hover:bg-slate-50 transition"
          >
            {t('reportByCompany')}
          </Link>
          <button
            onClick={exportCsv}
            className="text-sm px-3.5 py-2 rounded-pill bg-brand text-white font-semibold hover:opacity-90 transition"
          >
            {t('exportCsv')}
          </button>
        </div>
      </div>

      {/* Estado del balance */}
      {data && (
        <div
          className={`mb-5 rounded-xl px-4 py-3 text-sm flex items-center gap-2 ${
            data.totals.balanced
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {data.totals.balanced ? '✓' : '⚠️'}
          <span>
            {data.totals.balanced
              ? t('balanced', { total: usd(data.totals.totalDebit) })
              : t('unbalanced', {
                  debit: usd(data.totals.totalDebit),
                  credit: usd(data.totals.totalCredit),
                })}
          </span>
        </div>
      )}

      {/* Resumen */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <KpiCard label={t('kpiSubscriptionIncome')} value={s ? usd(s.ingresos) : '—'} tone="emerald" />
        <KpiCard label={t('kpiCommissionExpense')} value={s ? usd(s.gastoComisiones) : '—'} tone="amber" />
        <KpiCard label={t('kpiSocio', { percent: s?.socioPercent ?? 10 })} value={s ? usd(s.gastoSocio) : '—'} tone="violet" />
        <KpiCard label={t('kpiNetResult')} value={s ? usd(s.resultado) : '—'} tone="indigo" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard label={t('kpiCommissionsPayable')} value={s ? usd(s.comisionesPorPagar) : '—'} tone="slate" sub={t('subBalanceAccount', { account: 2000 })} />
        <KpiCard label={t('kpiSocioPayable')} value={s ? usd(s.socioPorPagar) : '—'} tone="slate" sub={t('subBalanceAccount', { account: 2100 })} />
        <KpiCard label={t('kpiPaymentsSettled')} value={s ? usd(s.pagos) : '—'} tone="slate" sub={t('subDebitsTo', { account: 2000 })} />
        <KpiCard label={t('kpiEntries')} value={data ? String(data.ledgerCount) : '—'} tone="slate" />
      </div>

      {loading ? (
        <div className="text-sm text-slate-400 py-10 text-center">{t('loading')}</div>
      ) : !data || data.ledger.length === 0 ? (
        <div className="text-sm text-slate-400 py-10 text-center">
          {t('emptyLedger')}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Balance de comprobación */}
          <div className="lg:col-span-1">
            <h2 className="text-sm font-semibold text-slate-700 mb-2">
              {t('trialBalanceTitle')}
            </h2>
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 bg-slate-50 border-b border-slate-200">
                    <th className="px-3 py-2">{t('thAccount')}</th>
                    <th className="px-3 py-2 text-right">{t('thDebit')}</th>
                    <th className="px-3 py-2 text-right">{t('thCredit')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.trialBalance.map((r) => (
                    <tr key={r.account} className="border-b border-slate-100">
                      <td className="px-3 py-2">
                        <div className="text-slate-700">{r.name}</div>
                        <div className="text-[11px] text-slate-400">
                          {r.account}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">
                        {r.debit ? usd(r.debit) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">
                        {r.credit ? usd(r.credit) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-800">
                    <td className="px-3 py-2">{t('totals')}</td>
                    <td className="px-3 py-2 text-right">
                      {usd(data.totals.totalDebit)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {usd(data.totals.totalCredit)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Libro de asientos */}
          <div className="lg:col-span-2">
            <h2 className="text-sm font-semibold text-slate-700 mb-2">
              {t('ledgerTitle')}{' '}
              {data.truncated && (
                <span className="text-[11px] font-normal text-amber-500">
                  {t('ledgerTruncated', { shown: 500, total: data.ledgerCount })}
                </span>
              )}
            </h2>
            <div className="space-y-2">
              {data.ledger.map((e) => (
                <div
                  key={e.id}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        SOURCE_TONE[e.sourceType] ?? 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {SOURCE_LABEL_KEY[e.sourceType]
                        ? t(SOURCE_LABEL_KEY[e.sourceType])
                        : e.sourceType}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {fmtDate(e.date)}
                    </span>
                  </div>
                  <div className="text-[13px] text-slate-600 mb-1.5">
                    {e.memo}
                  </div>
                  <div className="space-y-0.5">
                    {e.lines.map((l, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between text-[12px]"
                      >
                        <span
                          className={
                            l.debit ? 'text-slate-700' : 'text-slate-500 pl-4'
                          }
                        >
                          {l.account} · {l.accountName}
                        </span>
                        <span
                          className={
                            l.debit
                              ? 'text-slate-800 font-medium'
                              : 'text-slate-500'
                          }
                        >
                          {l.debit
                            ? t('drAmount', { amount: usd(l.debit) })
                            : t('crAmount', { amount: usd(l.credit) })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: 'slate' | 'indigo' | 'amber' | 'violet' | 'emerald';
}) {
  const toneMap: Record<string, string> = {
    slate: 'text-slate-700',
    indigo: 'text-indigo-600',
    amber: 'text-amber-600',
    violet: 'text-violet-600',
    emerald: 'text-emerald-600',
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className={`text-lg font-bold ${toneMap[tone]}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}
