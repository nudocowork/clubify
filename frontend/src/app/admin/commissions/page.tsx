'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type PaymentStatus = 'PENDING' | 'PARTIAL' | 'PAID';
type RecipientRole = 'INFLUENCER' | 'AMBASSADOR' | 'VENDOR' | 'SOCIO';

type CommissionRow = {
  id: string;
  amount: number;
  amountPaid: number;
  outstanding: number;
  currency: string;
  paymentStatus: PaymentStatus;
  status: string;
  createdAt: string;
  availableAt: string;
  paidAt: string | null;
  notes: string | null;
  hotmartTransactionId: string | null;
  tenant: {
    id: string;
    brandName: string;
    planName: string | null;
    planPeriodicity: string | null;
    currentPeriodEnd: string | null;
  } | null;
  recipient: {
    id: string;
    code: string;
    ownerName: string;
    ownerEmail: string;
    role: RecipientRole;
  } | null;
  vendor: {
    id: string;
    code: string;
    ownerName: string;
  } | null;
};

type Bucket = 'pending_approval' | 'available' | 'paid' | 'rejected';

type BucketTotal = { count: number; amount: number };

type CommissionsResp = {
  items: CommissionRow[];
  totals: {
    count: number;
    totalAmount: number;
    totalPaid: number;
    totalOutstanding: number;
  };
  byBucket: {
    pendingApproval: BucketTotal;
    available: BucketTotal;
    paid: BucketTotal;
    rejected: BucketTotal;
  };
  holdDays: number;
};

// Badge del CICLO DE VIDA de la comisión (derivado de status + paymentStatus).
// status: PENDING (en hold) → APPROVED (disponible) → PAID. REJECTED = anulada.
function lifecycleBadge(
  status: string,
  paymentStatus: PaymentStatus,
): { label: string; cls: string } {
  if (status === 'REJECTED')
    return { label: 'Rechazada', cls: 'bg-red-100 text-red-700' };
  if (status === 'PAID' || paymentStatus === 'PAID')
    return { label: 'Pagada', cls: 'bg-emerald-100 text-emerald-700' };
  if (paymentStatus === 'PARTIAL')
    return { label: 'Pago parcial', cls: 'bg-blue-100 text-blue-700' };
  if (status === 'APPROVED')
    return { label: 'Disponible para pagar', cls: 'bg-indigo-100 text-indigo-700' };
  // PENDING (o RETAINED): todavía en período de hold.
  return { label: 'Pendiente por aprobar', cls: 'bg-amber-100 text-amber-700' };
}

const BUCKET_LABEL: Record<Bucket, string> = {
  pending_approval: 'Pendiente por aprobar',
  available: 'Disponible para pagar',
  paid: 'Pagadas',
  rejected: 'Rechazadas',
};

const ROLE_LABEL: Record<RecipientRole, string> = {
  INFLUENCER: 'Influencer',
  AMBASSADOR: 'Embajador',
  VENDOR: 'Vendedor',
  SOCIO: 'Socio',
};

const PERIODICITY_LABEL: Record<string, string> = {
  MENSUAL: 'Mensual',
  TRIMESTRAL: 'Trimestral',
  SEMESTRAL: 'Semestral',
  ANUAL: 'Anual',
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
  });
}

export default function AdminCommissionsPage() {
  const [data, setData] = useState<CommissionsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [bucket, setBucket] = useState<'' | Bucket>('');
  const [role, setRole] = useState<'' | RecipientRole>('');
  const [tenantId, setTenantId] = useState('');
  const [codeId, setCodeId] = useState('');
  const [paying, setPaying] = useState<CommissionRow | null>(null);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (bucket) params.set('bucket', bucket);
      if (role) params.set('role', role);
      if (tenantId) params.set('tenantId', tenantId);
      if (codeId) params.set('codeId', codeId);
      const url = `/admin/commissions${params.toString() ? `?${params}` : ''}`;
      setData(await api<CommissionsResp>(url));
    } catch (e: any) {
      toast(e?.message ?? 'Error cargando comisiones', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, bucket, role, tenantId, codeId]);

  // Opciones únicas para dropdowns derivadas del dataset actual.
  const tenantOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of data?.items ?? []) {
      if (it.tenant) map.set(it.tenant.id, it.tenant.brandName);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const embajadorOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of data?.items ?? []) {
      if (it.recipient && it.recipient.role === 'AMBASSADOR') {
        map.set(it.recipient.id, it.recipient.ownerName);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  function exportCsv() {
    if (!data?.items.length) {
      toast('Sin filas para exportar', 'info');
      return;
    }
    const headers = [
      'Fecha',
      'Negocio',
      'Plan',
      'Periodicidad',
      'Próx. renovación',
      'Recipient',
      'Rol',
      'Email',
      'Código',
      'Monto',
      'Pagado',
      'Pendiente',
      'Estado',
      'Hotmart TX',
    ];
    const rows = data.items.map((c) => [
      fmtDate(c.createdAt),
      c.tenant?.brandName ?? '',
      c.tenant?.planName ?? '',
      c.tenant?.planPeriodicity ?? '',
      fmtDate(c.tenant?.currentPeriodEnd ?? null),
      c.recipient?.ownerName ?? '',
      c.recipient ? ROLE_LABEL[c.recipient.role] ?? c.recipient.role : '',
      c.recipient?.ownerEmail ?? '',
      c.recipient?.code ?? '',
      c.amount.toFixed(2),
      c.amountPaid.toFixed(2),
      c.outstanding.toFixed(2),
      lifecycleBadge(c.status, c.paymentStatus).label,
      c.hotmartTransactionId ?? '',
    ]);
    const csv = [headers, ...rows]
      .map((r) =>
        r
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
    a.download = `comisiones-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="max-w-7xl">
      <div className="page-head flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">
          Comisiones <span className="page-crumb">/ Panel contable</span>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/commissions/report"
            className="text-sm px-3.5 py-2 rounded-pill border border-slate-300 bg-white text-slate-700 font-semibold hover:bg-slate-50 transition"
          >
            📊 Reporte por empresa
          </Link>
          <Link
            href="/admin/commissions/payments"
            className="text-sm px-3.5 py-2 rounded-pill bg-brand text-white font-semibold hover:opacity-90 transition"
          >
            Vista por persona pendientes
          </Link>
        </div>
      </div>

      {/* Buckets del ciclo de vida — clickeables para filtrar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {(
          [
            {
              key: 'pending_approval' as Bucket,
              label: `Pendiente por aprobar`,
              hint: `en hold ${data?.holdDays ?? 30} días`,
              total: data?.byBucket.pendingApproval,
              ring: 'ring-amber-400',
              dot: 'bg-amber-400',
            },
            {
              key: 'available' as Bucket,
              label: 'Disponible para pagar',
              hint: 'aprobadas, listas',
              total: data?.byBucket.available,
              ring: 'ring-indigo-400',
              dot: 'bg-indigo-500',
            },
            {
              key: 'paid' as Bucket,
              label: 'Pagadas',
              hint: 'liquidadas',
              total: data?.byBucket.paid,
              ring: 'ring-emerald-400',
              dot: 'bg-emerald-500',
            },
            {
              key: 'rejected' as Bucket,
              label: 'Rechazadas',
              hint: 'anuladas',
              total: data?.byBucket.rejected,
              ring: 'ring-red-400',
              dot: 'bg-red-400',
            },
          ] as const
        ).map((b) => {
          const active = bucket === b.key;
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => setBucket(active ? '' : b.key)}
              className={`card card-pad text-left transition select-none active:scale-[0.98] [-webkit-tap-highlight-color:transparent] ${
                active ? `ring-2 ${b.ring}` : 'hover:bg-bg2/50'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${b.dot}`} />
                <span className="text-[11px] uppercase tracking-wide text-mute font-semibold">
                  {b.label}
                </span>
              </div>
              <div className="text-xl font-bold mt-1">
                {fmtUsd(b.total?.amount ?? 0)}
              </div>
              <div className="text-[11px] text-mute mt-0.5">
                {b.total?.count ?? 0} {(b.total?.count ?? 0) === 1 ? 'comisión' : 'comisiones'} · {b.hint}
              </div>
            </button>
          );
        })}
      </div>
      {bucket && (
        <div className="text-xs text-mute mb-3 -mt-2">
          Filtrando por <b>{BUCKET_LABEL[bucket]}</b> ·{' '}
          <button
            type="button"
            onClick={() => setBucket('')}
            className="text-brand font-semibold underline"
          >
            ver todas las activas
          </button>
        </div>
      )}

      {/* Filtros */}
      <div className="card card-pad mb-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Desde</label>
          <input
            type="date"
            className="input"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Hasta</label>
          <input
            type="date"
            className="input"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Estado</label>
          <select
            className="input"
            value={bucket}
            onChange={(e) => setBucket(e.target.value as any)}
          >
            <option value="">Todas las activas</option>
            <option value="pending_approval">Pendiente por aprobar</option>
            <option value="available">Disponible para pagar</option>
            <option value="paid">Pagadas</option>
            <option value="rejected">Rechazadas</option>
          </select>
        </div>
        <div>
          <label className="label">Rol recipient</label>
          <select
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value as any)}
          >
            <option value="">Todos</option>
            <option value="INFLUENCER">Influencer</option>
            <option value="AMBASSADOR">Embajador</option>
            <option value="VENDOR">Vendedor</option>
            <option value="SOCIO">Socio</option>
          </select>
        </div>
        <div>
          <label className="label">Negocio</label>
          <select
            className="input"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
          >
            <option value="">Todos</option>
            {tenantOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Embajador</label>
          <select
            className="input"
            value={codeId}
            onChange={(e) => setCodeId(e.target.value)}
          >
            <option value="">Todos</option>
            {embajadorOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => {
              setDateFrom('');
              setDateTo('');
              setBucket('');
              setRole('');
              setTenantId('');
              setCodeId('');
            }}
            className="text-xs text-mute hover:text-ink underline"
          >
            Limpiar filtros
          </button>
          <button
            onClick={exportCsv}
            className="text-sm px-3 py-1.5 rounded-md border border-line2 bg-bg2 hover:bg-bg3 transition"
          >
            ⬇ Exportar CSV
          </button>
        </div>
      </div>

      {/* Tabla */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 font-semibold">Fecha</th>
                <th className="px-4 py-3 font-semibold">Negocio</th>
                <th className="px-4 py-3 font-semibold">Plan</th>
                <th className="px-4 py-3 font-semibold">Recipient</th>
                <th className="px-4 py-3 font-semibold text-right">Monto</th>
                <th className="px-4 py-3 font-semibold text-right">Pagado</th>
                <th className="px-4 py-3 font-semibold text-right">Pendiente</th>
                <th className="px-4 py-3 font-semibold">Estado</th>
                <th className="px-4 py-3 font-semibold">Próx. renovación</th>
                <th className="px-4 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-mute">
                    Cargando…
                  </td>
                </tr>
              )}
              {!loading && (data?.items.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-mute">
                    <div className="text-3xl mb-2">💸</div>
                    Sin comisiones con estos filtros.
                  </td>
                </tr>
              )}
              {!loading &&
                (data?.items ?? []).map((c) => {
                  const badge = lifecycleBadge(c.status, c.paymentStatus);
                  const inHold = c.status === 'PENDING';
                  return (
                    <tr
                      key={c.id}
                      className="border-t border-line2 hover:bg-bg2/40"
                    >
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        {fmtDate(c.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">
                          {c.tenant?.brandName ?? '—'}
                        </div>
                        {c.hotmartTransactionId && (
                          <div className="text-[10px] text-mute font-mono">
                            tx · {c.hotmartTransactionId.slice(0, 12)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div>{c.tenant?.planName ?? '—'}</div>
                        {c.tenant?.planPeriodicity && (
                          <div className="text-mute">
                            {PERIODICITY_LABEL[c.tenant.planPeriodicity] ??
                              c.tenant.planPeriodicity}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {c.recipient ? (
                          <>
                            <div className="font-medium text-xs">
                              {c.recipient.ownerName}
                            </div>
                            <div className="text-[10px] text-mute">
                              {ROLE_LABEL[c.recipient.role] ?? c.recipient.role}
                              {' · '}
                              <span className="font-mono">
                                {c.recipient.code}
                              </span>
                            </div>
                          </>
                        ) : (
                          <span className="text-mute text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">
                        {fmtUsd(c.amount)}
                      </td>
                      <td className="px-4 py-3 text-right text-ok">
                        {fmtUsd(c.amountPaid)}
                      </td>
                      <td className="px-4 py-3 text-right text-amber-700 font-medium">
                        {fmtUsd(c.outstanding)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                        {inHold && (
                          <div className="text-[10px] text-mute mt-1 whitespace-nowrap">
                            disponible el {fmtDate(c.availableAt)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-mute whitespace-nowrap">
                        {fmtDate(c.tenant?.currentPeriodEnd ?? null)}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {c.paymentStatus !== 'PAID' ? (
                          <button
                            onClick={() => setPaying(c)}
                            className="text-xs px-2.5 py-1 rounded-md bg-brand/10 text-brand font-semibold hover:bg-brand/20 transition select-none active:scale-[0.97] [-webkit-tap-highlight-color:transparent]"
                          >
                            Marcar pagado
                          </button>
                        ) : (
                          <span className="text-xs text-ok">
                            ✓ {fmtDate(c.paidAt)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
            {data && data.items.length > 0 && (
              <tfoot className="bg-bg2">
                <tr className="border-t-2 border-line2 font-semibold">
                  <td colSpan={4} className="px-4 py-3 text-right text-xs">
                    TOTAL ({data.totals.count} filas)
                  </td>
                  <td className="px-4 py-3 text-right">
                    {fmtUsd(data.totals.totalAmount)}
                  </td>
                  <td className="px-4 py-3 text-right text-ok">
                    {fmtUsd(data.totals.totalPaid)}
                  </td>
                  <td className="px-4 py-3 text-right text-amber-700">
                    {fmtUsd(data.totals.totalOutstanding)}
                  </td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {paying && (
        <PayCommissionModal
          item={paying}
          onClose={() => setPaying(null)}
          onSaved={() => {
            setPaying(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function PayCommissionModal({
  item,
  onClose,
  onSaved,
}: {
  item: CommissionRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(item.outstanding.toFixed(2));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    const n = parseFloat(amount);
    if (!Number.isFinite(n) || n <= 0) {
      toast('Monto inválido', 'error');
      return;
    }
    if (n > item.outstanding + 0.001) {
      toast(
        `El monto excede el saldo pendiente (${fmtUsd(item.outstanding)})`,
        'error',
      );
      return;
    }
    setSaving(true);
    try {
      await api(`/admin/commissions/${item.id}/pay`, {
        method: 'PATCH',
        body: JSON.stringify({ amount: n, note: note.trim() || undefined }),
      });
      toast(
        n >= item.outstanding - 0.001
          ? 'Comisión marcada como pagada'
          : 'Pago parcial registrado',
        'success',
      );
      onSaved();
    } catch (e: any) {
      toast(e?.message ?? 'Error al registrar pago', 'error');
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
        className="bg-bg1 rounded-xl max-w-md w-full p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-4">Marcar comisión como pagada</h2>

        <div className="bg-bg2 rounded-lg p-3 mb-4 text-sm">
          <div className="flex justify-between mb-1">
            <span className="text-mute">Recipient</span>
            <span className="font-medium">{item.recipient?.ownerName ?? '—'}</span>
          </div>
          <div className="flex justify-between mb-1">
            <span className="text-mute">Negocio</span>
            <span className="font-medium">{item.tenant?.brandName ?? '—'}</span>
          </div>
          <div className="flex justify-between mb-1">
            <span className="text-mute">Monto total</span>
            <span className="font-semibold">{fmtUsd(item.amount)}</span>
          </div>
          <div className="flex justify-between mb-1">
            <span className="text-mute">Ya pagado</span>
            <span className="text-ok">{fmtUsd(item.amountPaid)}</span>
          </div>
          <div className="flex justify-between border-t border-line2 pt-2 mt-2">
            <span className="text-mute font-semibold">Pendiente</span>
            <span className="text-amber-700 font-bold">
              {fmtUsd(item.outstanding)}
            </span>
          </div>
        </div>

        <div className="mb-3">
          <label className="label">Cantidad pagada (USD)</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            max={item.outstanding.toFixed(2)}
            className="input w-full"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
          <div className="text-[11px] text-mute mt-1">
            Si pagas menos que el pendiente, queda como "Parcial".
          </div>
        </div>

        <div className="mb-4">
          <label className="label">Referencia / nota (opcional)</label>
          <input
            type="text"
            placeholder="ej: Wise tx 4f3a, Nequi, transferencia BBVA"
            className="input w-full"
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
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="text-sm px-4 py-2 rounded-md bg-brand text-white font-semibold hover:opacity-90 transition disabled:opacity-50 select-none active:scale-[0.97] [-webkit-tap-highlight-color:transparent]"
          >
            {saving ? 'Guardando…' : 'Confirmar pago'}
          </button>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: number | string;
  accent: 'ok' | 'warn' | 'bad' | 'brand';
  hint?: string;
}) {
  const color =
    accent === 'ok'
      ? 'text-ok'
      : accent === 'warn'
      ? 'text-amber-600'
      : accent === 'bad'
      ? 'text-bad'
      : 'text-brand';
  return (
    <div className="card card-pad">
      <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
        {label}
      </div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
      {hint && <div className="text-[10px] text-mute mt-1">{hint}</div>}
    </div>
  );
}
