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
      toast(e?.message || 'Error cargando vendedores', 'error');
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
      .catch((e) => toast(e?.message || 'Error cargando detalle', 'error'));
  }, [openId]);

  const filtered = rows
    ? rows.filter((r) => {
        const t = search.trim().toLowerCase();
        if (!t) return true;
        return (
          r.ownerName.toLowerCase().includes(t) ||
          r.ownerEmail.toLowerCase().includes(t) ||
          r.code.toLowerCase().includes(t) ||
          (r.parentEmbajadorName ?? '').toLowerCase().includes(t)
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
          Reportes <span className="page-crumb">/ Vendedores</span>
        </h1>
        <Link href="/admin/reports/ambassadors" className="btn-ghost text-sm">
          ← Embajadores
        </Link>
      </div>

      <p className="text-mute text-sm mb-4 max-w-prose">
        Producción agregada por vendedor: ventas realizadas y comisiones
        (acumulada, pagada, pendiente). Click en una fila para ver el detalle.
      </p>

      <input
        type="search"
        placeholder="Buscar por nombre, email, código o embajador…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="input mb-4 max-w-md"
      />

      {!sorted ? (
        <div className="h-64 bg-bg2 rounded animate-shimmer" />
      ) : sorted.length === 0 ? (
        <div className="card card-pad text-center text-mute">
          No hay vendedores que coincidan con tu búsqueda.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg2 text-mute text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left p-3">Vendedor</th>
                <th className="text-left p-3">Embajador</th>
                <th className="text-right p-3">%</th>
                <SortableTh label="Ventas" onClick={() => toggleSort('ventasRealizadas')} indicator={arrow('ventasRealizadas')} />
                <SortableTh label="Acumulada" onClick={() => toggleSort('comisionAcumuladaUsd')} indicator={arrow('comisionAcumuladaUsd')} />
                <SortableTh label="Pagada" onClick={() => toggleSort('comisionPagadaUsd')} indicator={arrow('comisionPagadaUsd')} />
                <SortableTh label="Pendiente" onClick={() => toggleSort('comisionPendienteUsd')} indicator={arrow('comisionPendienteUsd')} />
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
                      {!r.isActive && <span className="ml-2 badge-bad">Inactivo</span>}
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
                        Embajador: {detail.parentEmbajador.name} ({detail.parentEmbajador.code})
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpenId(null)}
                    className="btn-ghost text-sm"
                  >
                    Cerrar ✕
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                  <Stat label="Ventas" value={detail.totals.ventasRealizadas} />
                  <Stat label="Acumulada" value={usd(detail.totals.comisionAcumuladaUsd)} />
                  <Stat label="Pagada" value={usd(detail.totals.comisionPagadaUsd)} accent="ok" />
                  <Stat
                    label="Pendiente"
                    value={usd(detail.totals.comisionPendienteUsd)}
                    accent="warn"
                  />
                </div>

                {/* Sales */}
                <SectionTitle>Sales</SectionTitle>
                {detail.sales.length === 0 ? (
                  <div className="text-sm text-mute mb-4">Sin ventas todavía.</div>
                ) : (
                  <div className="card overflow-x-auto mb-4">
                    <table className="w-full text-xs">
                      <thead className="bg-bg2 text-mute uppercase">
                        <tr>
                          <th className="text-left p-2">Fecha</th>
                          <th className="text-left p-2">Tenant</th>
                          <th className="text-left p-2">Plan</th>
                          <th className="text-left p-2">Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.sales.map((s) => (
                          <tr key={s.referralUseId} className="border-t border-line">
                            <td className="p-2">{fmtDate(s.signedUpAt)}</td>
                            <td className="p-2">{s.brandName}</td>
                            <td className="p-2">
                              {s.planName ?? '—'}
                              {s.planPeriodicity && (
                                <span className="text-mute"> · {s.planPeriodicity}</span>
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
                <SectionTitle>Comisiones</SectionTitle>
                {detail.commissions.length === 0 ? (
                  <div className="text-sm text-mute">Sin comisiones todavía.</div>
                ) : (
                  <div className="card overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-bg2 text-mute uppercase">
                        <tr>
                          <th className="text-left p-2">Fecha</th>
                          <th className="text-left p-2">Tenant</th>
                          <th className="text-right p-2">Monto</th>
                          <th className="text-right p-2">Pagado</th>
                          <th className="text-left p-2">Estado</th>
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
