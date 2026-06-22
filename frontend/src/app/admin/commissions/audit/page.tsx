'use client';
/**
 * Auditoría de comisiones duplicadas (Bloque 3 Fase A — 2026-06-10).
 *
 * Read-only: muestra grupos de comisiones sospechosas para revisar
 * antes de aplicar el unique constraint en Fase B. NO modifica datos.
 *
 * Heurística (backend): mismo (referralUseId, recipientCodeId) +
 * createdAt dentro de ventana de 25 días + status ≠ REJECTED.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type AuditRow = {
  id: string;
  amount: number;
  status: string;
  externalTxId: string | null;
  hotmartTransactionId: string | null;
  createdAt: string;
  paidAt: string | null;
};

type AuditGroup = {
  referralUseId: string;
  tenant: { id: string; brandName: string; slug: string } | null;
  recipientCode: { code: string; slug: string; role: string } | null;
  size: number;
  totalAmount: number;
  commissions: AuditRow[];
};

type AuditResponse = {
  summary: {
    totalCommissions: number;
    totalDuplicateGroups: number;
    totalCommissionsInGroups: number;
    truncatedToFirst: number;
  };
  groups: AuditGroup[];
};

export default function CommissionsAuditPage() {
  const t = useTranslations('admin_commissions_audit');
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(100);

  async function load() {
    setLoading(true);
    try {
      const d = await api<AuditResponse>(
        `/admin/commissions/audit/duplicates?limit=${limit}`,
      );
      setData(d);
    } catch (e: any) {
      toast(e?.message ?? t('errorLoading'), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [limit]);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          {t('pageTitle')}{' '}
          <span className="page-crumb">{t('pageCrumb')}</span>
        </h1>
        <div className="flex gap-2 items-center">
          <label className="text-xs text-mute">{t('maxGroups')}</label>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="bg-white border border-line rounded-pill px-3 py-1.5 text-sm cursor-pointer"
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={250}>250</option>
            <option value={500}>500</option>
          </select>
          <button onClick={load} className="btn-ghost text-sm" disabled={loading}>
            {loading ? '…' : `↻ ${t('refresh')}`}
          </button>
        </div>
      </div>

      <div className="card card-pad mb-4 bg-amber-50 border-amber-200">
        <p className="text-sm text-amber-900 m-0 leading-relaxed">
          🔍{' '}
          {t.rich('readOnlyNote', {
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </p>
      </div>

      {/* Summary */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-4">
          <KpiCard
            label={t('kpiTotalCommissions')}
            value={data.summary.totalCommissions}
          />
          <KpiCard
            label={t('kpiSuspiciousGroups')}
            value={data.summary.totalDuplicateGroups}
            tone={data.summary.totalDuplicateGroups > 0 ? 'warn' : 'ok'}
          />
          <KpiCard
            label={t('kpiRowsInGroups')}
            value={data.summary.totalCommissionsInGroups}
            tone={data.summary.totalCommissionsInGroups > 0 ? 'warn' : 'ok'}
          />
          <KpiCard
            label={t('kpiShowing')}
            value={data.summary.truncatedToFirst}
            hint={t('kpiTopHint', { limit })}
          />
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-bg2 rounded animate-shimmer" />
          ))}
        </div>
      )}

      {data && !loading && data.groups.length === 0 && (
        <div className="card card-pad text-center py-10">
          <div className="text-4xl mb-2">✅</div>
          <div className="font-semibold">{t('emptyTitle')}</div>
          <div className="text-xs text-mute mt-1">
            {t('emptyDescription')}
          </div>
        </div>
      )}

      {data && !loading && data.groups.length > 0 && (
        <div className="space-y-3">
          {data.groups.map((g) => (
            <GroupCard
              key={`${g.referralUseId}-${g.recipientCode?.code}`}
              g={g}
              onChanged={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: 'ok' | 'warn';
}) {
  return (
    <div className="kpi">
      <div className="kpi-lbl">{label}</div>
      <div
        className={`kpi-val ${
          tone === 'warn' ? 'text-bad' : tone === 'ok' ? 'text-ok-ink' : ''
        }`}
      >
        {value.toLocaleString('es-CO')}
      </div>
      {hint && <div className="kpi-sub">{hint}</div>}
    </div>
  );
}

function GroupCard({
  g,
  onChanged,
}: {
  g: AuditGroup;
  onChanged: () => void;
}) {
  const t = useTranslations('admin_commissions_audit');
  // Selección de filas para mark-rejected (Fase B 2026-06-12).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Solo PENDING/APPROVED son seleccionables. PAID nunca se puede tocar.
  const selectable = g.commissions.filter(
    (c) => c.status === 'PENDING' || c.status === 'APPROVED',
  );
  const allSelectableIds = selectable.map((c) => c.id);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === allSelectableIds.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allSelectableIds));
    }
  }

  async function markRejected() {
    if (selected.size === 0) return;
    const reason = window.prompt(
      t('promptRejectReason'),
      t('promptRejectDefault'),
    );
    if (reason === null) return;
    if (
      !confirm(
        t('confirmMarkRejected', { count: selected.size }),
      )
    )
      return;
    setBusy(true);
    try {
      const res = await api<{
        updated: number;
        skippedPaid: number;
        skippedNotFound: number;
      }>('/admin/commissions/audit/mark-rejected', {
        method: 'POST',
        body: JSON.stringify({
          ids: Array.from(selected),
          reason: reason.trim() || undefined,
        }),
      });
      toast(
        t('toastMarkedRejected', { updated: res.updated }) +
          (res.skippedPaid > 0
            ? ' · ' + t('toastSkippedPaid', { count: res.skippedPaid })
            : ''),
        'success',
      );
      setSelected(new Set());
      onChanged();
    } catch (e: any) {
      toast(e?.message ?? t('errorMarkingRejected'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 bg-bg2 border-b border-line2 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-semibold text-sm">
            {g.tenant?.brandName ?? t('tenantDeleted')}{' '}
            <span className="text-mute font-normal">
              · {g.recipientCode?.role ?? '—'} {g.recipientCode?.code ?? t('legacyNull')}
            </span>
          </div>
          <div className="text-xs text-mute mt-0.5">
            {t('referralUse')}{' '}
            <code className="font-mono">{g.referralUseId.slice(0, 8)}</code>
            {g.tenant?.slug && (
              <>
                {' · '}
                <Link
                  href={`/admin/tenants/${g.tenant.id}`}
                  className="text-brand hover:underline"
                >
                  {t('viewTenant')} →
                </Link>
              </>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-mute uppercase tracking-wider font-semibold">
            {t('commissionsCount', { count: g.size })}
          </div>
          <div className="text-sm font-semibold text-bad">
            {t('totalLabel', {
              amount: g.totalAmount.toLocaleString('es-CO', { maximumFractionDigits: 2 }),
            })}
          </div>
        </div>
      </div>

      {/* Toolbar de bulk action (solo si hay seleccionables) */}
      {selectable.length > 0 && (
        <div className="px-4 py-2 bg-white border-b border-line2 flex items-center justify-between gap-2 flex-wrap text-xs">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={
                selected.size === allSelectableIds.length &&
                allSelectableIds.length > 0
              }
              onChange={toggleAll}
              disabled={busy}
            />
            <span className="text-mute">
              {t('selectAllPendingApproved', { count: allSelectableIds.length })}
            </span>
          </label>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={markRejected}
              disabled={busy}
              className="bg-bad text-white font-semibold text-xs px-3 py-1.5 rounded-md hover:bg-bad/90 disabled:opacity-50"
            >
              {busy
                ? t('marking')
                : `🗑 ${t('markAsRejected', { count: selected.size })}`}
            </button>
          )}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead className="bg-white border-b border-line2">
            <tr>
              <th className="px-3 py-2 w-8"></th>
              <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-mute font-semibold">
                {t('thId')}
              </th>
              <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-mute font-semibold">
                {t('thAmount')}
              </th>
              <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-mute font-semibold">
                {t('thStatus')}
              </th>
              <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-mute font-semibold">
                {t('thHotmartTx')}
              </th>
              <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-mute font-semibold">
                {t('thCreated')}
              </th>
              <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-mute font-semibold">
                {t('thPaid')}
              </th>
            </tr>
          </thead>
          <tbody>
            {g.commissions.map((c) => {
              const canSelect =
                c.status === 'PENDING' || c.status === 'APPROVED';
              return (
              <tr key={c.id} className={`border-b border-line2 last:border-0 ${selected.has(c.id) ? 'bg-bad-soft/30' : ''}`}>
                <td className="px-3 py-2 text-center">
                  {canSelect ? (
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      disabled={busy}
                    />
                  ) : (
                    <span className="text-mute2 text-xs" title={t('paidLockedTooltip')}>🔒</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-[11px]">
                  {c.id.slice(0, 8)}
                </td>
                <td className="px-3 py-2 font-medium">
                  ${c.amount.toLocaleString('es-CO', { maximumFractionDigits: 2 })}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`badge ${
                      c.status === 'PAID'
                        ? 'badge-ok'
                        : c.status === 'PENDING'
                          ? 'badge-warn'
                          : c.status === 'APPROVED'
                            ? 'badge-info'
                            : 'badge-bad'
                    }`}
                  >
                    {c.status}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-mute">
                  {c.hotmartTransactionId ?? c.externalTxId ?? '—'}
                </td>
                <td className="px-3 py-2 text-mute text-[11px]">
                  {new Date(c.createdAt).toLocaleString('es-CO', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
                <td className="px-3 py-2 text-mute text-[11px]">
                  {c.paidAt
                    ? new Date(c.paidAt).toLocaleDateString('es-CO', {
                        day: 'numeric',
                        month: 'short',
                      })
                    : '—'}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
