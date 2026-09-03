'use client';

/**
 * /admin/reports/vendors — Reporte global de vendedores.
 *
 * Lista cada vendedor con ventas realizadas y comisiones (acumulada,
 * pagada, pendiente). Click abre detalle con lista de sales y todas
 * las commissions.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { planDisplayName, type PlanPeriodicity } from '@/lib/plan-format';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type VendorRow = {
  id: string;
  code: string;
  ownerName: string;
  ownerEmail: string;
  ownerWhatsapp: string;
  commissionPercent: number;
  isActive: boolean;
  parentEmbajadorName: string | null;
  parentEmbajadorCode: string | null;
  ventasRealizadas: number;
  tenantsCount: number;
  comisionAcumuladaUsd: number;
  comisionPagadaUsd: number;
  comisionPendienteUsd: number;
  createdAt: string;
};

type VendorDetail = {
  id: string;
  code: string;
  ownerName: string;
  ownerEmail: string;
  ownerWhatsapp: string;
  commissionPercent: number;
  isActive: boolean;
  parentEmbajador: { id: string; code: string; name: string } | null;
  totals: {
    ventasRealizadas: number;
    comisionAcumuladaUsd: number;
    comisionPagadaUsd: number;
    comisionPendienteUsd: number;
  };
  sales: Array<{
    referralUseId: string;
    tenantId: string | null;
    brandName: string;
    tenantStatus: string;
    planName: string | null;
    planPeriodicity: string | null;
    planPriceMonthly: number;
    currentPeriodEnd: string | null;
    useStatus: string;
    signedUpAt: string;
    convertedAt: string | null;
  }>;
  commissions: Array<{
    id: string;
    amount: number;
    amountPaid: number;
    status: string;
    paymentStatus: string;
    hotmartTransactionId: string | null;
    createdAt: string;
    tenantBrand: string | null;
  }>;
};

const usd = (n: number) => `$${Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function VendorsReportPage() {
  const t = useTranslations('admin_reports_vendors');
  const [rows, setRows] = useState<VendorRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VendorDetail | null>(null);
  const [search, setSearch] = useState('');
  // #20 (2026-06-16): ordenar por columna numérica (mayor↔menor).
  type SortKey =
    | 'ventasRealizadas'
    | 'comisionAcumuladaUsd'
    | 'comisionPagadaUsd'
    | 'comisionPendienteUsd';
  const [sortKey, setSortKey] = useState<SortKey>('comisionAcumuladaUsd');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else {
      setSortKey(k);
      setSortDir('desc');
    }
  }
  const arrow = (k: SortKey) => (k === sortKey ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '');

  async function loadList() {
    try {
      const r = await api<VendorRow[]>('/admin/reports/vendors');
      setRows(r);
    } catch (e: any) {
      toast(e?.message || t('errorLoadingVendors'), 'error');
    }
  }

  useEffect(() => {
    loadList();
  }, []);

  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    api<VendorDetail>(`/admin/reports/vendors/${openId}`)
      .then(setDetail)
      .catch((e) => toast(e?.message || t('errorLoadingDetail'), 'error'));
  }, [openId]);

  const filtered = rows
    ? rows.filter((r) => {
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return (
          r.ownerName.toLowerCase().includes(q) ||
          r.ownerEmail.toLowerCase().includes(q) ||
          r.code.toLowerCase().includes(q) ||
          (r.parentEmbajadorName ?? '').toLowerCase().includes(q)
        );
      })
    : null;

  const sorted = filtered
    ? [...filtered].sort((a, b) => {
        const d = (a[sortKey] as number) - (b[sortKey] as number);
        return sortDir === 'asc' ? d : -d;
      })
    : null;

  return (
    <div className="max-w-7xl">
      <div className="page-head">
        <h1 className="page-title">
          {t('pageTitle')} <span className="page-crumb">{t('pageCrumb')}</span>
        </h1>
        <Link href="/admin/reports/ambassadors" className="btn-ghost text-sm">
          ← {t('navAmbassadors')}
        </Link>
      </div>

      <p className="text-mute text-sm mb-4 max-w-prose">
        {t('intro')}
      </p>

      <input
        type="search"
        placeholder={t('searchPlaceholder')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="input mb-4 max-w-md"
      />

      {!sorted ? (
        <div className="h-64 bg-bg2 rounded animate-shimmer" />
      ) : sorted.length === 0 ? (
        <div className="card card-pad text-center text-mute">
          {t('emptyNoMatch')}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg2 text-mute text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left p-3">{t('thVendor')}</th>
                <th className="text-left p-3">{t('thAmbassador')}</th>
                <th className="text-right p-3">%</th>
                <SortableTh label={t('thSales')} onClick={() => toggleSort('ventasRealizadas')} indicator={arrow('ventasRealizadas')} />
                <SortableTh label={t('thAccrued')} onClick={() => toggleSort('comisionAcumuladaUsd')} indicator={arrow('comisionAcumuladaUsd')} />
                <SortableTh label={t('thPaid')} onClick={() => toggleSort('comisionPagadaUsd')} indicator={arrow('comisionPagadaUsd')} />
                <SortableTh label={t('thPending')} onClick={() => toggleSort('comisionPendienteUsd')} indicator={arrow('comisionPendienteUsd')} />
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-line hover:bg-bg2/40 cursor-pointer select-none active:scale-[0.997] transition-transform duration-150 [-webkit-tap-highlight-color:transparent]"
                  onClick={() => setOpenId(r.id)}
                >
                  <td className="p-3">
                    <div className="font-medium">{r.ownerName}</div>
                    <div className="text-xs text-mute">
                      {r.code} · {r.ownerEmail}
                      {!r.isActive && <span className="ml-2 badge-bad">{t('inactive')}</span>}
                    </div>
                  </td>
                  <td className="p-3">
                    {r.parentEmbajadorName ? (
                      <span className="text-sm">{r.parentEmbajadorName}</span>
                    ) : (
                      <span className="text-mute text-xs">—</span>
                    )}
                  </td>
                  <td className="p-3 text-right tabular-nums">{r.commissionPercent}%</td>
                  <td className="p-3 text-right tabular-nums">{r.ventasRealizadas}</td>
                  <td className="p-3 text-right tabular-nums font-medium">
                    {usd(r.comisionAcumuladaUsd)}
                  </td>
                  <td className="p-3 text-right tabular-nums text-ok">
                    {usd(r.comisionPagadaUsd)}
                  </td>
                  <td className="p-3 text-right tabular-nums text-warn">
                    {usd(r.comisionPendienteUsd)}
                  </td>
                  <td className="p-3 text-right text-mute">→</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail drawer */}
      {openId && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-start justify-end"
          onClick={() => setOpenId(null)}
        >
          <div
            className="bg-bg w-full max-w-2xl h-full overflow-y-auto p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {!detail ? (
              <div className="h-64 bg-bg2 rounded animate-shimmer" />
            ) : (
              <>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-semibold">{detail.ownerName}</h2>
                    <div className="text-sm text-mute">
                      {detail.code} · {detail.ownerEmail} · {detail.commissionPercent}%
                    </div>
                    {detail.parentEmbajador && (
                      <div className="text-xs text-mute mt-1">
                        {t('ambassadorLabel', {
                          name: detail.parentEmbajador.name,
                          code: detail.parentEmbajador.code,
                        })}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpenId(null)}
                    className="btn-ghost text-sm"
                  >
                    {t('close')} ✕
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                  <Stat label={t('statSales')} value={detail.totals.ventasRealizadas} />
                  <Stat label={t('statAccrued')} value={usd(detail.totals.comisionAcumuladaUsd)} />
                  <Stat label={t('statPaid')} value={usd(detail.totals.comisionPagadaUsd)} accent="ok" />
                  <Stat
                    label={t('statPending')}
                    value={usd(detail.totals.comisionPendienteUsd)}
                    accent="warn"
                  />
                </div>

                {/* Sales */}
                <SectionTitle>{t('sectionSales')}</SectionTitle>
                {detail.sales.length === 0 ? (
                  <div className="text-sm text-mute mb-4">{t('emptySales')}</div>
                ) : (
                  <div className="card overflow-x-auto mb-4">
                    <table className="w-full text-xs">
                      <thead className="bg-bg2 text-mute uppercase">
                        <tr>
                          <th className="text-left p-2">{t('thDate')}</th>
                          <th className="text-left p-2">{t('thTenant')}</th>
                          <th className="text-left p-2">{t('thPlan')}</th>
                          <th className="text-left p-2">{t('thStatus')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.sales.map((s) => (
                          <tr key={s.referralUseId} className="border-t border-line">
                            <td className="p-2">{fmtDate(s.signedUpAt)}</td>
                            <td className="p-2">{s.brandName}</td>
                            <td className="p-2">
                              {planDisplayName(
                                s.planName,
                                (s.planPeriodicity as PlanPeriodicity | null) ?? null,
                              )}
                            </td>
                            <td className="p-2">{s.tenantStatus}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Commissions */}
                <SectionTitle>{t('sectionCommissions')}</SectionTitle>
                {detail.commissions.length === 0 ? (
                  <div className="text-sm text-mute">{t('emptyCommissions')}</div>
                ) : (
                  <div className="card overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-bg2 text-mute uppercase">
                        <tr>
                          <th className="text-left p-2">{t('thDate')}</th>
                          <th className="text-left p-2">{t('thTenant')}</th>
                          <th className="text-right p-2">{t('thAmount')}</th>
                          <th className="text-right p-2">{t('thPaidCol')}</th>
                          <th className="text-left p-2">{t('thStatus')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.commissions.map((c) => (
                          <tr key={c.id} className="border-t border-line">
                            <td className="p-2">{fmtDate(c.createdAt)}</td>
                            <td className="p-2">{c.tenantBrand ?? '—'}</td>
                            <td className="p-2 text-right tabular-nums">{usd(c.amount)}</td>
                            <td className="p-2 text-right tabular-nums text-ok">
                              {usd(c.amountPaid)}
                            </td>
                            <td className="p-2">
                              <span
                                className={
                                  c.paymentStatus === 'PAID'
                                    ? 'badge-ok'
                                    : c.paymentStatus === 'PARTIAL'
                                    ? 'badge-warn'
                                    : 'badge-mute'
                                }
                              >
                                {c.paymentStatus}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  accent?: 'ok' | 'warn' | 'bad';
}) {
  const tone =
    accent === 'ok'
      ? 'text-ok'
      : accent === 'warn'
      ? 'text-warn'
      : accent === 'bad'
      ? 'text-bad'
      : 'text-ink';
  return (
    <div className="card card-pad">
      <div className="text-xs text-mute uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-2 mt-2">
      {children}
    </div>
  );
}

// #20: header de columna ordenable (click alterna desc/asc).
function SortableTh({
  label,
  onClick,
  indicator,
}: {
  label: string;
  onClick: () => void;
  indicator: string;
}) {
  return (
    <th
      className="text-right p-3 cursor-pointer select-none hover:text-ink whitespace-nowrap"
      onClick={onClick}
    >
      {label}
      <span className="text-brand">{indicator}</span>
    </th>
  );
}
