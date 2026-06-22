'use client';

/**
 * /admin/reports/ambassadors — Reporte global de embajadores.
 *
 * Lista cada embajador con sus métricas agregadas (ventas, facturación,
 * comisiones generadas, vendedores activos). Click en cualquier fila
 * abre el detalle in-page con el desglose por vendedor + lista de
 * tenants + timeline de comisiones.
 *
 * Solo SUPER_ADMIN. Ruta protegida en AppShell.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type AmbassadorRow = {
  id: string;
  code: string;
  ownerName: string;
  ownerEmail: string;
  ownerWhatsapp: string;
  isActive: boolean;
  parentInfluencerName: string | null;
  parentInfluencerCode: string | null;
  tenantsCount: number;
  ventasTotales: number;
  facturacionUsd: number;
  comisionGeneradaUsd: number;
  comisionPagadaUsd: number;
  comisionPendienteUsd: number;
  vendedoresActivos: number;
  vendedoresTotal: number;
  createdAt: string;
};

type AmbassadorDetail = {
  id: string;
  code: string;
  ownerName: string;
  ownerEmail: string;
  ownerWhatsapp: string;
  isActive: boolean;
  parent: { id: string; code: string; name: string } | null;
  totals: {
    ventasTotales: number;
    comisionGeneradaUsd: number;
    comisionPagadaUsd: number;
    comisionPendienteUsd: number;
    vendedoresActivos: number;
  };
  vendors: Array<{
    id: string;
    code: string;
    ownerName: string;
    commissionPercent: number;
    isActive: boolean;
    salesCount: number;
    comisionGeneradaUsd: number;
    comisionPagadaUsd: number;
    comisionPendienteUsd: number;
  }>;
  tenants: Array<{
    referralUseId: string;
    tenantId: string | null;
    brandName: string;
    tenantStatus: string;
    planName: string | null;
    planPriceMonthly: number;
    planPeriodicity: string | null;
    currentPeriodEnd: string | null;
    useStatus: string;
    signedUpAt: string;
    convertedAt: string | null;
  }>;
  timeline: Array<{
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

export default function AmbassadorsReportPage() {
  const t = useTranslations('admin_reports_ambassadors');
  const [rows, setRows] = useState<AmbassadorRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AmbassadorDetail | null>(null);
  const [search, setSearch] = useState('');
  // #20 (2026-06-16): ordenar por cualquier columna numérica (mayor↔menor).
  type SortKey =
    | 'ventasTotales'
    | 'facturacionUsd'
    | 'comisionGeneradaUsd'
    | 'comisionPagadaUsd'
    | 'comisionPendienteUsd';
  const [sortKey, setSortKey] = useState<SortKey>('comisionGeneradaUsd');
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
      const r = await api<AmbassadorRow[]>('/admin/reports/ambassadors');
      setRows(r);
    } catch (e: any) {
      toast(e?.message || t('errorLoadingAmbassadors'), 'error');
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
    api<AmbassadorDetail>(`/admin/reports/ambassadors/${openId}`)
      .then(setDetail)
      .catch((e) => toast(e?.message || t('errorLoadingDetail'), 'error'));
  }, [openId, t]);

  const filtered = rows
    ? rows.filter((r) => {
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return (
          r.ownerName.toLowerCase().includes(q) ||
          r.ownerEmail.toLowerCase().includes(q) ||
          r.code.toLowerCase().includes(q) ||
          (r.parentInfluencerName ?? '').toLowerCase().includes(q)
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
          {t('reportsCrumb')} <span className="page-crumb">{t('ambassadorsCrumb')}</span>
        </h1>
        <Link href="/admin/reports/vendors" className="btn-ghost text-sm">
          {t('viewVendors')}
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
                <th className="text-left p-3">{t('colAmbassador')}</th>
                <th className="text-left p-3">{t('colInfluencer')}</th>
                <SortableTh label={t('colSales')} onClick={() => toggleSort('ventasTotales')} indicator={arrow('ventasTotales')} />
                <SortableTh label={t('colBilling')} onClick={() => toggleSort('facturacionUsd')} indicator={arrow('facturacionUsd')} />
                <SortableTh label={t('colCommissionGenerated')} onClick={() => toggleSort('comisionGeneradaUsd')} indicator={arrow('comisionGeneradaUsd')} />
                <SortableTh label={t('colPaid')} onClick={() => toggleSort('comisionPagadaUsd')} indicator={arrow('comisionPagadaUsd')} />
                <SortableTh label={t('colPending')} onClick={() => toggleSort('comisionPendienteUsd')} indicator={arrow('comisionPendienteUsd')} />
                <th className="text-right p-3">{t('colVendors')}</th>
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
                    {r.parentInfluencerName ? (
                      <span className="text-sm">{r.parentInfluencerName}</span>
                    ) : (
                      <span className="text-mute text-xs">{t('company')}</span>
                    )}
                  </td>
                  <td className="p-3 text-right tabular-nums">{r.ventasTotales}</td>
                  <td className="p-3 text-right tabular-nums">{usd(r.facturacionUsd)}</td>
                  <td className="p-3 text-right tabular-nums font-medium">
                    {usd(r.comisionGeneradaUsd)}
                  </td>
                  <td className="p-3 text-right tabular-nums text-ok">
                    {usd(r.comisionPagadaUsd)}
                  </td>
                  <td className="p-3 text-right tabular-nums text-warn">
                    {usd(r.comisionPendienteUsd)}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {r.vendedoresActivos}
                    <span className="text-mute text-xs"> / {r.vendedoresTotal}</span>
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
                      {detail.code} · {detail.ownerEmail}
                    </div>
                    {detail.parent && (
                      <div className="text-xs text-mute mt-1">
                        {t('reportsTo', { name: detail.parent.name, code: detail.parent.code })}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpenId(null)}
                    className="btn-ghost text-sm"
                  >
                    {t('closeBtn')}
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                  <Stat label={t('statSales')} value={detail.totals.ventasTotales} />
                  <Stat label={t('statGenerated')} value={usd(detail.totals.comisionGeneradaUsd)} />
                  <Stat label={t('statPaid')} value={usd(detail.totals.comisionPagadaUsd)} accent="ok" />
                  <Stat
                    label={t('statPending')}
                    value={usd(detail.totals.comisionPendienteUsd)}
                    accent="warn"
                  />
                </div>

                {/* Producción por vendedor */}
                <SectionTitle>{t('sectionVendorProduction')}</SectionTitle>
                {detail.vendors.length === 0 ? (
                  <div className="text-sm text-mute mb-4">{t('noVendors')}</div>
                ) : (
                  <div className="card overflow-x-auto mb-4">
                    <table className="w-full text-xs">
                      <thead className="bg-bg2 text-mute uppercase">
                        <tr>
                          <th className="text-left p-2">{t('colVendor')}</th>
                          <th className="text-right p-2">%</th>
                          <th className="text-right p-2">{t('colSales')}</th>
                          <th className="text-right p-2">{t('statGenerated')}</th>
                          <th className="text-right p-2">{t('statPaid')}</th>
                          <th className="text-right p-2">{t('statPending')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.vendors.map((v) => (
                          <tr key={v.id} className="border-t border-line">
                            <td className="p-2">
                              <div className="font-medium">{v.ownerName}</div>
                              <div className="text-mute">{v.code}</div>
                            </td>
                            <td className="p-2 text-right tabular-nums">
                              {v.commissionPercent}%
                            </td>
                            <td className="p-2 text-right tabular-nums">{v.salesCount}</td>
                            <td className="p-2 text-right tabular-nums">
                              {usd(v.comisionGeneradaUsd)}
                            </td>
                            <td className="p-2 text-right tabular-nums text-ok">
                              {usd(v.comisionPagadaUsd)}
                            </td>
                            <td className="p-2 text-right tabular-nums text-warn">
                              {usd(v.comisionPendienteUsd)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Tenants */}
                <SectionTitle>{t('sectionTenants')}</SectionTitle>
                {detail.tenants.length === 0 ? (
                  <div className="text-sm text-mute mb-4">{t('noTenants')}</div>
                ) : (
                  <div className="card overflow-x-auto mb-4">
                    <table className="w-full text-xs">
                      <thead className="bg-bg2 text-mute uppercase">
                        <tr>
                          <th className="text-left p-2">{t('colTenant')}</th>
                          <th className="text-left p-2">{t('colPlan')}</th>
                          <th className="text-left p-2">{t('colPeriodicity')}</th>
                          <th className="text-left p-2">{t('colRenewal')}</th>
                          <th className="text-left p-2">{t('colStatus')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.tenants.map((tn) => (
                          <tr key={tn.referralUseId} className="border-t border-line">
                            <td className="p-2">{tn.brandName}</td>
                            <td className="p-2">{tn.planName ?? '—'}</td>
                            <td className="p-2">{tn.planPeriodicity ?? '—'}</td>
                            <td className="p-2">{fmtDate(tn.currentPeriodEnd)}</td>
                            <td className="p-2">{tn.tenantStatus}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Timeline */}
                <SectionTitle>{t('sectionTimeline')}</SectionTitle>
                {detail.timeline.length === 0 ? (
                  <div className="text-sm text-mute">{t('noMovements')}</div>
                ) : (
                  <div className="card overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-bg2 text-mute uppercase">
                        <tr>
                          <th className="text-left p-2">{t('colDate')}</th>
                          <th className="text-left p-2">{t('colTenant')}</th>
                          <th className="text-right p-2">{t('colAmount')}</th>
                          <th className="text-right p-2">{t('colPaid')}</th>
                          <th className="text-left p-2">{t('colStatus')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.timeline.map((c) => (
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
                                {c.paymentStatus === 'PAID'
                                  ? t('payStatusPaid')
                                  : c.paymentStatus === 'PARTIAL'
                                  ? t('payStatusPartial')
                                  : t('payStatusPending')}
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
