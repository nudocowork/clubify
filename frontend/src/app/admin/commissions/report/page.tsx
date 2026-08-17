'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type Afiliado = {
  id: string;
  code: string;
  ownerName: string;
  role: 'INFLUENCER' | 'AMBASSADOR' | 'VENDOR' | 'SOCIO';
  percent: number;
};

// Origen del cobro del negocio (de dónde sale la plata). Solo HOTMART /
// MARCA_BLANCA (alta con créditos) / MANUAL facturan; el resto se lista en 0.
type Cobro =
  | 'HOTMART'
  | 'MARCA_BLANCA'
  | 'MANUAL'
  | 'TRIAL'
  | 'CORTESIA'
  | 'SISTEMA'
  | 'SIN_COBRO';

type ReportRow = {
  tenantId: string;
  brandName: string;
  status: string;
  planName: string | null;
  planPeriodicity: string | null;
  currentPeriodEnd: string | null;
  cobro: Cobro;
  facturable: boolean;
  whiteLabelName: string | null;
  esOtraMarca: boolean;
  base: number;
  baseIsReal: boolean;
  afiliado: Afiliado | null;
  influencer: {
    id: string;
    code: string;
    ownerName: string;
    percent: number;
  } | null;
  comisionDirecta: number;
  comisionIndirecta: number;
  socioPercent: number;
  socio: number;
  totalComisiones: number;
  neto: number;
  registradas: number;
  registradasCount: number;
};

type ReportResp = {
  rows: ReportRow[];
  totals: {
    companies: number;
    companiesFacturables: number;
    companiesSinAfiliado: number;
    base: number;
    comisionDirecta: number;
    comisionIndirecta: number;
    comisiones: number;
    socio: number;
    neto: number;
    registradas: number;
  };
  indirectPercent: number;
  socioPercent: number;
};

const ROLE_LABEL_KEY: Record<string, string> = {
  INFLUENCER: 'roleInfluencer',
  AMBASSADOR: 'roleAmbassador',
  VENDOR: 'roleVendor',
  SOCIO: 'roleSocio',
};

const PERIOD_LABEL_KEY: Record<string, string> = {
  MENSUAL: 'periodMonthly',
  TRIMESTRAL: 'periodQuarterly',
  SEMESTRAL: 'periodSemiannual',
  ANUAL: 'periodAnnual',
};

const COBRO_LABEL_KEY: Record<string, string> = {
  HOTMART: 'cobroHotmart',
  MARCA_BLANCA: 'cobroBrandCredits',
  MANUAL: 'cobroManual',
  TRIAL: 'cobroTrial',
  CORTESIA: 'cobroComp',
  SISTEMA: 'cobroSystem',
  SIN_COBRO: 'cobroNone',
};

const STATUS_FILTERS = ['', 'ACTIVE', 'TRIAL', 'SUSPENDED'] as const;
const STATUS_FILTER_KEY: Record<string, string> = {
  '': 'statusAll',
  ACTIVE: 'statusActive',
  TRIAL: 'statusTrial',
  SUSPENDED: 'statusSuspended',
};

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export default function CompanyReportPage() {
  const t = useTranslations('admin_commissions_report');
  const [data, setData] = useState<ReportResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  // FIX 2026-08-13: el reporte lista TODOS los negocios (antes solo los que
  // tenían afiliado + cobro Hotmart real). Filtro por estado, sin filtro = todos.
  const [status, setStatus] = useState('');
  const [onlyBillable, setOnlyBillable] = useState(false);
  // Filtro por período = fecha de REGISTRO del negocio (el backend ya soporta
  // from/to, anclado a Bogotá e inclusivo del "hasta"). Formato YYYY-MM-DD.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const qs = params.toString();
      setData(
        await api<ReportResp>(
          `/admin/commissions/company-report${qs ? `?${qs}` : ''}`,
        ),
      );
    } catch (e: any) {
      toast(e?.message ?? t('errorLoading'), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, from, to]);

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const base = onlyBillable ? all.filter((r) => r.facturable) : all;
    const term = q.trim().toLowerCase();
    if (!term) return base;
    return base.filter((r) =>
      `${r.brandName} ${r.afiliado?.ownerName ?? ''} ${r.afiliado?.code ?? ''} ${
        r.influencer?.ownerName ?? ''
      }`
        .toLowerCase()
        .includes(term),
    );
  }, [data, q, onlyBillable]);

  function exportCsv() {
    if (!rows.length) {
      toast(t('noRowsToExport'), 'info');
      return;
    }
    const headers = [
      t('csvCompany'),
      t('csvStatus'),
      t('csvCobro'),
      t('csvBrand'),
      t('csvPlan'),
      t('csvPeriodicity'),
      t('csvCustomerPayment'),
      t('csvBase'),
      t('csvAffiliate'),
      t('csvRole'),
      t('csvCode'),
      t('csvDirectPercent'),
      t('csvDirectCommission'),
      t('csvInfluencerIndirect'),
      t('csvIndirectPercent'),
      t('csvIndirectCommission'),
      t('csvPartnerPercent'),
      t('csvPartner'),
      t('csvCompanyNet'),
      t('csvRegisteredCommissions'),
      t('csvRegisteredCount'),
    ];
    const csvRows = rows.map((r) => [
      r.brandName,
      r.status,
      t(COBRO_LABEL_KEY[r.cobro] ?? 'cobroNone'),
      r.whiteLabelName ?? '',
      r.planName ?? '',
      r.planPeriodicity ?? '',
      r.base.toFixed(2),
      r.facturable
        ? r.baseIsReal
          ? t('baseReal')
          : t('baseApprox')
        : t('baseNotBillable'),
      r.afiliado?.ownerName ?? '',
      r.afiliado
        ? t(ROLE_LABEL_KEY[r.afiliado.role] ?? 'roleUnknown', {
            role: r.afiliado.role,
          })
        : '',
      r.afiliado?.code ?? '',
      (r.afiliado?.percent ?? 0).toFixed(2),
      r.comisionDirecta.toFixed(2),
      r.influencer?.ownerName ?? '',
      r.influencer ? r.influencer.percent.toFixed(2) : '',
      r.comisionIndirecta.toFixed(2),
      r.socioPercent.toFixed(2),
      r.socio.toFixed(2),
      r.neto.toFixed(2),
      r.registradas.toFixed(2),
      String(r.registradasCount),
    ]);
    const csv = [headers, ...csvRows]
      .map((row) =>
        row
          .map((v) => {
            const s = String(v ?? '');
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(','),
      )
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reporte-empresas-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const totals = data?.totals;

  return (
    <div className="max-w-7xl">
      <div className="page-head flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">
          {t('title')}{' '}
          <span className="page-crumb">{t('crumb')}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/commissions"
            className="text-sm px-3.5 py-2 rounded-pill border border-slate-300 bg-white text-slate-700 font-semibold hover:bg-slate-50 transition"
          >
            {t('backToCommissions')}
          </Link>
          <button
            onClick={exportCsv}
            className="text-sm px-3.5 py-2 rounded-pill bg-brand text-white font-semibold hover:opacity-90 transition"
          >
            {t('exportCsv')}
          </button>
        </div>
      </div>

      <p className="text-sm text-slate-500 mb-5 max-w-3xl">
        {t.rich('intro', {
          strong: (chunks) => <strong>{chunks}</strong>,
          em: (chunks) => <em>{chunks}</em>,
          indirect: data ? `+ ${data.indirectPercent}% ` : '',
          partner: data ? `${data.socioPercent}%` : '10%',
        })}
      </p>

      {/* KPIs totales */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <KpiCard
          label={t('kpiCompanies')}
          value={totals ? String(totals.companies) : '—'}
          tone="slate"
          sub={
            totals
              ? t('kpiCompaniesSub', {
                  billable: totals.companiesFacturables,
                  noAffiliate: totals.companiesSinAfiliado,
                })
              : undefined
          }
        />
        <KpiCard
          label={t('kpiCustomerPaymentPerCycle')}
          value={totals ? usd(totals.base) : '—'}
          tone="indigo"
        />
        <KpiCard
          label={t('kpiAffiliateCommissions')}
          value={totals ? usd(totals.comisiones) : '—'}
          tone="amber"
          sub={
            totals
              ? t('kpiCommissionsSub', {
                  direct: usd(totals.comisionDirecta),
                  indirect: usd(totals.comisionIndirecta),
                })
              : undefined
          }
        />
        <KpiCard
          label={t('kpiPartner', { percent: data?.socioPercent ?? 10 })}
          value={totals ? usd(totals.socio) : '—'}
          tone="violet"
        />
        <KpiCard
          label={t('kpiCompanyNet')}
          value={totals ? usd(totals.neto) : '—'}
          tone="emerald"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="w-full md:w-80 px-3.5 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-brand/30"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {t(STATUS_FILTER_KEY[s])}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={onlyBillable}
            onChange={(e) => setOnlyBillable(e.target.checked)}
            className="h-4 w-4"
          />
          {t('onlyBillable')}
        </label>
        {/* Filtro por período (fecha de registro del negocio). desde/hasta + mes. */}
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <span className="text-slate-500" title="Filtra por fecha de registro del negocio">
            Registro:
          </span>
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="Desde"
            className="px-2 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
          <span className="text-slate-400">→</span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            aria-label="Hasta"
            className="px-2 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
          <input
            type="month"
            title="Filtrar por mes"
            aria-label="Mes"
            onChange={(e) => {
              const m = e.target.value; // YYYY-MM
              if (!m) return;
              const [y, mm] = m.split('-').map(Number);
              const last = new Date(y, mm, 0).getDate(); // último día del mes
              setFrom(`${m}-01`);
              setTo(`${m}-${String(last).padStart(2, '0')}`);
            }}
            className="px-2 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
          {(from || to) && (
            <button
              type="button"
              onClick={() => {
                setFrom('');
                setTo('');
              }}
              className="text-xs text-slate-500 hover:text-slate-700 underline"
            >
              Limpiar
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-slate-400 py-10 text-center">
          {t('loading')}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-slate-400 py-10 text-center">
          {t('emptyNoRows')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm min-w-[1080px]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200 bg-slate-50">
                <th className="px-3 py-2.5">{t('thCompany')}</th>
                <th className="px-3 py-2.5">{t('thPlan')}</th>
                <th className="px-3 py-2.5 text-right">{t('thCustomerPayment')}</th>
                <th className="px-3 py-2.5">{t('thAffiliate')}</th>
                <th className="px-3 py-2.5 text-right">{t('thDirect')}</th>
                <th className="px-3 py-2.5 text-right">{t('thIndirect')}</th>
                <th className="px-3 py-2.5 text-right">
                  {t('thPartner', { percent: data?.socioPercent ?? 10 })}
                </th>
                <th className="px-3 py-2.5 text-right">{t('thCompanyNet')}</th>
                <th className="px-3 py-2.5 text-right">{t('thRegistered')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.tenantId}
                  className="border-b border-slate-100 hover:bg-slate-50/60"
                >
                  <td className="px-3 py-2.5">
                    <div className="font-semibold text-slate-800">
                      {r.brandName}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {r.status !== 'ACTIVE' && (
                        <span className="text-[11px] text-amber-600">
                          {r.status}
                        </span>
                      )}
                      <span
                        className={`text-[11px] ${
                          r.facturable ? 'text-slate-400' : 'text-slate-500'
                        }`}
                      >
                        {t(COBRO_LABEL_KEY[r.cobro] ?? 'cobroNone')}
                      </span>
                      {r.esOtraMarca && r.whiteLabelName && (
                        <span className="text-[11px] px-1.5 rounded bg-slate-100 text-slate-500">
                          {r.whiteLabelName}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">
                    {r.planPeriodicity
                      ? PERIOD_LABEL_KEY[r.planPeriodicity]
                        ? t(PERIOD_LABEL_KEY[r.planPeriodicity])
                        : r.planPeriodicity
                      : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-slate-800">
                    {r.facturable ? usd(r.base) : <span className="text-slate-300">—</span>}
                    {r.facturable && !r.baseIsReal && (
                      <span
                        className="block text-[10px] font-normal text-amber-500"
                        title={t('approxTitle')}
                      >
                        {t('approxBadge')}
                      </span>
                    )}
                    {!r.facturable && (
                      <span
                        className="block text-[10px] font-normal text-slate-400"
                        title={t('notBillableTitle')}
                      >
                        {t('notBillableBadge')}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {r.afiliado ? (
                      <>
                        <div className="text-slate-800">
                          {r.afiliado.ownerName}{' '}
                          <span className="text-slate-400">
                            ({r.afiliado.percent}%)
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {ROLE_LABEL_KEY[r.afiliado.role]
                            ? t(ROLE_LABEL_KEY[r.afiliado.role])
                            : r.afiliado.role}{' '}
                          · {r.afiliado.code}
                        </div>
                        {r.influencer && (
                          <div className="text-[11px] text-indigo-500">
                            {t('influencerIndir', {
                              name: r.influencer.ownerName,
                              percent: r.influencer.percent,
                            })}
                          </div>
                        )}
                      </>
                    ) : (
                      <Link
                        href="/admin/commissions"
                        className="text-[12px] text-amber-600 hover:underline"
                        title={t('noAffiliateTitle')}
                      >
                        {t('noAffiliate')}
                      </Link>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right text-amber-700">
                    {r.facturable ? usd(r.comisionDirecta) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right text-indigo-600">
                    {r.comisionIndirecta > 0 ? usd(r.comisionIndirecta) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right text-violet-600">
                    {r.facturable ? usd(r.socio) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-emerald-700">
                    {r.facturable ? usd(r.neto) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-500">
                    {usd(r.registradas)}
                    {r.registradasCount > 0 && (
                      <span className="text-[11px] text-slate-400">
                        {' '}
                        ({r.registradasCount})
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {totals && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-800">
                  <td className="px-3 py-2.5" colSpan={2}>
                    {t('totalCompanies', { count: totals.companies })}
                    <span className="block text-[11px] font-normal text-slate-400">
                      {t('kpiCompaniesSub', {
                        billable: totals.companiesFacturables,
                        noAffiliate: totals.companiesSinAfiliado,
                      })}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">{usd(totals.base)}</td>
                  <td className="px-3 py-2.5"></td>
                  <td className="px-3 py-2.5 text-right text-amber-700">
                    {usd(totals.comisionDirecta)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-indigo-600">
                    {usd(totals.comisionIndirecta)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-violet-600">
                    {usd(totals.socio)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-emerald-700">
                    {usd(totals.neto)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-500">
                    {usd(totals.registradas)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
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
