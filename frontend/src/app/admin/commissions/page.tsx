'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { AffiliatePickerSearch } from '@/components/AffiliatePickerSearch';
import {
  BusinessFilterPicker,
  type BusinessOption,
} from '@/components/BusinessFilterPicker';
import { planDisplayName, type PlanPeriodicity } from '@/lib/plan-format';
import CurrentCutoffTab from './_components/CurrentCutoffTab';
import BatchHistoryTab from './_components/BatchHistoryTab';

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
  // PDF Soft(9) C3: fecha "de negocio" (registro para la 1ª, cobro real para
  // recompras). Se usa como columna FECHA.
  commissionDate: string;
  // Raw: si !=null, la FECHA está CONGELADA (curada/editada a mano). Si null,
  // viene de la heurística. Editable desde la celda FECHA.
  businessDate?: string | null;
  availableAt: string;
  daysRemaining: number;
  nextPayoutDate: string;
  paidAt: string | null;
  // Respaldo del paidAt anterior al corte (auditoría).
  paidAtLegacy?: string | null;
  // Lote de corte que liquidó esta comisión (brief PASO 5).
  payoutBatch?: {
    code: string;
    // null si el corte sigue ABIERTO (todavía sin transferencia real).
    paymentDate: string | null;
    cutoffDate: string;
    kind: string;
  } | null;
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

// Brief PASO 5: sobre qué fecha operan el filtro y la columna FECHA.
type DateType = 'purchase' | 'payment' | 'batch';

type BatchOption = {
  id: string;
  code: string;
  cutoffDate: string;
  // null mientras el corte esté ABIERTO (todavía no salió la transferencia).
  paymentDate: string | null;
  status: 'OPEN' | 'CLOSED';
  kind: string;
  totalUsd: number;
  currency: string;
  commissionsCount: number;
};

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
// Estados del spec 2026-06-15: Bloqueada · Disponible · Lista para pagar ·
// Pagada · Retenida · Cancelada (derivados de status + paymentStatus).
function lifecycleBadge(
  status: string,
  paymentStatus: PaymentStatus,
): { key: string; cls: string } {
  if (status === 'REJECTED')
    return { key: 'lifecycleCancelled', cls: 'bg-red-100 text-red-700' };
  if (status === 'RETAINED')
    return { key: 'lifecycleRetained', cls: 'bg-slate-200 text-slate-700' };
  if (status === 'PAID' || paymentStatus === 'PAID')
    return { key: 'lifecyclePaid', cls: 'bg-emerald-100 text-emerald-700' };
  if (paymentStatus === 'PARTIAL')
    return { key: 'lifecyclePartial', cls: 'bg-blue-100 text-blue-700' };
  if (status === 'APPROVED')
    return { key: 'lifecycleAvailable', cls: 'bg-indigo-100 text-indigo-700' };
  // PENDING: todavía dentro del bloqueo de 15 días.
  return { key: 'lifecycleBlocked', cls: 'bg-amber-100 text-amber-700' };
}

const BUCKET_LABEL_KEY: Record<Bucket, string> = {
  pending_approval: 'bucketPendingApproval',
  available: 'bucketAvailable',
  paid: 'bucketPaid',
  rejected: 'bucketRejected',
};

const ROLE_LABEL_KEY: Record<RecipientRole, string> = {
  INFLUENCER: 'roleInfluencer',
  AMBASSADOR: 'roleAmbassador',
  VENDOR: 'roleVendor',
  SOCIO: 'roleSocio',
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

// ISO → 'YYYY-MM-DD' en zona Bogotá (para el <input type="date"> del editor de
// FECHA). Igual a como se muestra/guarda para que el día no se corra.
function toDateInputValue(d: string | null | undefined): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

// PDF Soft(9): fila de un negocio SIN afiliado → asignar manualmente.
function UnattributedRow({
  row,
  onDone,
}: {
  row: { tenantId: string; brandName: string; createdAt: string };
  onDone: () => void;
}) {
  const [codeId, setCodeId] = useState('');
  const [saving, setSaving] = useState(false);
  async function assign() {
    if (!codeId) {
      toast('Elegí un afiliado', 'info');
      return;
    }
    setSaving(true);
    try {
      await api(`/admin/commissions/${row.tenantId}/assign-affiliate`, {
        method: 'POST',
        body: JSON.stringify({ codeId }),
      });
      toast('Afiliado asignado ✓', 'success');
      onDone();
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo asignar', 'error');
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line2 bg-white px-3 py-2">
      <div className="min-w-[140px] flex-1">
        <div className="text-sm font-medium">{row.brandName}</div>
        <div className="text-[10px] text-mute">{fmtDate(row.createdAt)}</div>
      </div>
      <div className="min-w-[220px] flex-1">
        <AffiliatePickerSearch value={codeId} onChange={setCodeId} />
      </div>
      <button
        onClick={assign}
        disabled={saving || !codeId}
        className="text-sm px-3 py-1.5 rounded-md bg-brand text-white disabled:opacity-50"
      >
        {saving ? '…' : 'Asignar'}
      </button>
    </div>
  );
}

// PDF Soft(9): negocios que pagan Hotmart pero SIN afiliado → asignación manual.
function UnattributedPanel() {
  const [rows, setRows] = useState<
    Array<{ tenantId: string; brandName: string; createdAt: string }>
  >([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    api<Array<{ tenantId: string; brandName: string; createdAt: string }>>(
      '/admin/commissions/unattributed',
    )
      .then((r) => setRows(r ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoaded(true));
  }, []);
  if (!loaded || rows.length === 0) return null;
  return (
    <div className="card card-pad mb-4 border border-amber-200 bg-amber-50/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="font-semibold text-amber-800">
          ⚠️ Negocios sin afiliado ({rows.length})
        </span>
        <span className="text-xs text-amber-700">
          {open ? '▲ ocultar' : '▼ asignar'}
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-mute">
            Pagan suscripción Hotmart pero no tienen embajador/influencer
            atribuido. Asignalos manualmente para que su comisión se genere en el
            próximo cobro.
          </p>
          {rows.map((r) => (
            <UnattributedRow
              key={r.tenantId}
              row={r}
              onDone={() =>
                setRows((x) => x.filter((y) => y.tenantId !== r.tenantId))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

type Tab = 'cutoff' | 'history' | 'advanced';

/**
 * Shell de /admin/commissions. Abre SIEMPRE en la vista ESTÁNDAR ("Detalle
 * avanzado": la tabla de comisiones con sus filtros) — 2026-08-16, pedido del
 * dueño. Desde las pestañas el usuario cambia a "Corte actual" (cortes
 * automáticos) o "Historial" cuando lo desee. Auditoría, contabilidad, reporte
 * por empresa y vista por persona quedan en el menú "⋯ Más".
 */
export default function AdminCommissionsPage() {
  const t = useTranslations('admin_commissions');
  const [tab, setTab] = useState<Tab>('advanced');
  const [moreOpen, setMoreOpen] = useState(false);

  const TABS: Array<{ key: Tab; label: string }> = [
    { key: 'advanced', label: t('navAdvancedDetail') },
    { key: 'cutoff', label: t('tabCurrentCutoff') },
    { key: 'history', label: t('tabHistory') },
  ];

  return (
    <div className="max-w-7xl">
      <div className="page-head flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">
          {t('pageTitle')} <span className="page-crumb">{t('pageCrumb')}</span>
        </h1>

        <div className="relative z-50">
          <button
            onClick={() => setMoreOpen((o) => !o)}
            className="text-sm px-3.5 py-2 rounded-pill border border-slate-300 bg-white text-slate-700 font-semibold hover:bg-slate-50 transition"
          >
            ⋯ {t('navMore')}
          </button>
          {moreOpen && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setMoreOpen(false)}
              />
              <div className="absolute right-0 top-full mt-1 z-40 w-64 rounded-lg border border-line2 bg-surface shadow-lg py-1">
                <button
                  onClick={() => {
                    setTab('advanced');
                    setMoreOpen(false);
                  }}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-bg2 transition"
                >
                  🔎 {t('navAdvancedDetail')}
                </button>
                <Link
                  href="/admin/commissions/payments"
                  className="block px-4 py-2 text-sm hover:bg-bg2 transition"
                  onClick={() => setMoreOpen(false)}
                >
                  👤 {t('navViewByPerson')}
                </Link>
                <Link
                  href="/admin/accounting"
                  className="block px-4 py-2 text-sm hover:bg-bg2 transition"
                  onClick={() => setMoreOpen(false)}
                >
                  🧮 {t('navAccounting')}
                </Link>
                <Link
                  href="/admin/commissions/report"
                  className="block px-4 py-2 text-sm hover:bg-bg2 transition"
                  onClick={() => setMoreOpen(false)}
                >
                  📊 {t('navReportByCompany')}
                </Link>
                <Link
                  href="/admin/payouts"
                  className="block px-4 py-2 text-sm hover:bg-bg2 transition"
                  onClick={() => setMoreOpen(false)}
                >
                  🏦 {t('navPayouts')}
                </Link>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 mb-4 border-b border-line2">
        {TABS.map((x) => (
          <button
            key={x.key}
            onClick={() => setTab(x.key)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition ${
              tab === x.key
                ? 'border-brand text-brand'
                : 'border-transparent text-mute hover:text-ink'
            }`}
          >
            {x.label}
          </button>
        ))}
      </div>

      {tab === 'cutoff' && <CurrentCutoffTab />}
      {tab === 'history' && <BatchHistoryTab />}
      {tab === 'advanced' && <AdvancedCommissionsView />}
    </div>
  );
}

/**
 * VISTA AVANZADA (antes era la pantalla entera). Sigue completa —buckets,
 * 6 filtros, tabla de 11 columnas, auditoría—, pero ya no es lo primero que se
 * ve: vive detrás de "⋯ Más → Detalle avanzado". La pregunta diaria ("cuánto
 * pago y a quién") la responde la pestaña "Corte actual" sin filtros.
 */
function AdvancedCommissionsView() {
  const t = useTranslations('admin_commissions');
  const [data, setData] = useState<CommissionsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // Brief PASO 5: tipo de fecha activo (compra por defecto = la columna FECHA
  // histórica) + lote seleccionado (cuando dateType==='batch').
  const [dateType, setDateType] = useState<DateType>('purchase');
  const [batchCode, setBatchCode] = useState('');
  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [bucket, setBucket] = useState<'' | Bucket>('');
  const [role, setRole] = useState<'' | RecipientRole>('');
  const [tenantId, setTenantId] = useState('');
  const [codeId, setCodeId] = useState('');
  const [paying, setPaying] = useState<CommissionRow | null>(null);
  // PDF Soft(9) C5: lista COMPLETA de negocios con comisiones para el filtro
  // buscable (no solo los de las filas cargadas). Se carga una vez al montar.
  const [businesses, setBusinesses] = useState<BusinessOption[]>([]);
  // Filtros avanzados colapsados por defecto (solo se ve el de estado).
  const [showFilters, setShowFilters] = useState(false);
  const activeFilterCount =
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0) +
    (batchCode ? 1 : 0) +
    (role ? 1 : 0) +
    (tenantId ? 1 : 0) +
    (codeId ? 1 : 0);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('dateType', dateType);
      if (dateType === 'batch') {
        if (batchCode) params.set('batchCode', batchCode);
      } else {
        if (dateFrom) params.set('dateFrom', dateFrom);
        if (dateTo) params.set('dateTo', dateTo);
      }
      if (bucket) params.set('bucket', bucket);
      if (role) params.set('role', role);
      if (tenantId) params.set('tenantId', tenantId);
      if (codeId) params.set('codeId', codeId);
      const url = `/admin/commissions${params.toString() ? `?${params}` : ''}`;
      setData(await api<CommissionsResp>(url));
    } catch (e: any) {
      toast(e?.message ?? t('errorLoading'), 'error');
    } finally {
      setLoading(false);
    }
  }

  // Guarda la FECHA de negocio editada a mano (businessDate). value '' → null
  // (revierte a la heurística). Recarga para reflejar el valor congelado.
  async function saveBusinessDate(id: string, value: string) {
    setSavingDate(true);
    try {
      await api(`/admin/commissions/${id}/business-date`, {
        method: 'PATCH',
        body: JSON.stringify({ businessDate: value || null }),
      });
      setEditDate(null);
      await load();
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo guardar la fecha', 'error');
    } finally {
      setSavingDate(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, dateType, batchCode, bucket, role, tenantId, codeId]);

  // Lista completa de negocios (una sola vez) para el filtro buscable.
  useEffect(() => {
    api<BusinessOption[]>('/admin/commissions/businesses')
      .then(setBusinesses)
      .catch(() => setBusinesses([]));
  }, []);

  // Lotes de corte para el selector de "Lote" (brief PASO 5).
  useEffect(() => {
    api<BatchOption[]>('/admin/commissions/payout-batches')
      .then((b) => setBatches(b ?? []))
      .catch(() => setBatches([]));
  }, []);

  // Habilitar manual: adelanta el desbloqueo de una comisión en hold.
  const [enabling, setEnabling] = useState<string | null>(null);
  // Edición inline de la FECHA de negocio (businessDate) por comisión.
  const [editDate, setEditDate] = useState<{ id: string; value: string } | null>(null);
  const [savingDate, setSavingDate] = useState(false);
  async function enableCommission(c: CommissionRow) {
    if (
      !confirm(
        t('confirmEnable', { amount: fmtUsd(c.amount), days: c.daysRemaining }),
      )
    )
      return;
    const reason = window.prompt(t('promptReason')) ?? undefined;
    setEnabling(c.id);
    try {
      await api(`/admin/commissions/${c.id}/enable`, {
        method: 'PATCH',
        body: JSON.stringify({ reason }),
      });
      toast(t('toastEnabled'), 'success');
      load();
    } catch (e: any) {
      toast(e?.message ?? t('errorCouldNotEnable'), 'error');
    } finally {
      setEnabling(null);
    }
  }


  function exportCsv() {
    if (!data?.items.length) {
      toast(t('noRowsToExport'), 'info');
      return;
    }
    const headers = [
      t('csvDate'),
      t('csvBusiness'),
      t('csvPlan'),
      t('csvPeriodicity'),
      t('csvNextRenewal'),
      t('csvRecipient'),
      t('csvRole'),
      t('csvEmail'),
      t('csvCode'),
      t('csvAmount'),
      t('csvPaid'),
      t('csvOutstanding'),
      t('csvStatus'),
      t('csvHotmartTx'),
      t('csvEnabledDate'),
      t('csvPaidDate'),
    ];
    const rows = data.items.map((c) => [
      fmtDate(c.commissionDate ?? c.createdAt),
      c.tenant?.brandName ?? '',
      c.tenant?.planName ?? '',
      c.tenant?.planPeriodicity ?? '',
      fmtDate(c.tenant?.currentPeriodEnd ?? null),
      c.recipient?.ownerName ?? '',
      c.recipient
        ? ROLE_LABEL_KEY[c.recipient.role]
          ? t(ROLE_LABEL_KEY[c.recipient.role])
          : c.recipient.role
        : '',
      c.recipient?.ownerEmail ?? '',
      c.recipient?.code ?? '',
      c.amount.toFixed(2),
      c.amountPaid.toFixed(2),
      c.outstanding.toFixed(2),
      t(lifecycleBadge(c.status, c.paymentStatus).key),
      c.hotmartTransactionId ?? '',
      c.availableAt ? fmtDate(c.availableAt) : '',
      c.paidAt ? fmtDate(c.paidAt) : '',
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
    <div>
      {/* #11 (2026-06-16): auditoría avanzada — recalcula desde la fuente y
          reporta montos incorrectos / duplicados / fantasmas. */}
      <CommissionAuditPanel />

      {/* Buckets del ciclo de vida — clickeables para filtrar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {(
          [
            {
              key: 'pending_approval' as Bucket,
              label: t('bucketPendingApproval'),
              hint: t('bucketHintOnHold', { days: data?.holdDays ?? 30 }),
              total: data?.byBucket.pendingApproval,
              ring: 'ring-amber-400',
              dot: 'bg-amber-400',
            },
            {
              key: 'available' as Bucket,
              label: t('bucketAvailable'),
              hint: t('bucketHintReady'),
              total: data?.byBucket.available,
              ring: 'ring-indigo-400',
              dot: 'bg-indigo-500',
            },
            {
              key: 'paid' as Bucket,
              label: t('bucketPaid'),
              hint: t('bucketHintSettled'),
              total: data?.byBucket.paid,
              ring: 'ring-emerald-400',
              dot: 'bg-emerald-500',
            },
            {
              key: 'rejected' as Bucket,
              label: t('bucketRejected'),
              hint: t('bucketHintVoided'),
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
                {t('commissionsCount', { count: b.total?.count ?? 0 })} · {b.hint}
              </div>
            </button>
          );
        })}
      </div>
      {bucket && (
        <div className="text-xs text-mute mb-3 -mt-2">
          {t.rich('filteringBy', {
            label: t(BUCKET_LABEL_KEY[bucket]),
            b: (chunks) => <b>{chunks}</b>,
          })}{' '}
          ·{' '}
          <button
            type="button"
            onClick={() => setBucket('')}
            className="text-brand font-semibold underline"
          >
            {t('viewAllActive')}
          </button>
        </div>
      )}

      {/* Filtros. Por defecto solo se ve el de ESTADO; el resto (fechas, rol,
          negocio, afiliado) vive detrás del botón "Filtros" para que la
          pantalla no arranque con seis controles pidiendo decisiones. */}
      <div className="card card-pad mb-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">{t('filterStatus')}</label>
            <select
              className="input"
              value={bucket}
              onChange={(e) => setBucket(e.target.value as any)}
            >
              <option value="">{t('filterAllActive')}</option>
              <option value="pending_approval">{t('bucketPendingApproval')}</option>
              <option value="available">{t('bucketAvailable')}</option>
              <option value="paid">{t('bucketPaid')}</option>
              <option value="rejected">{t('bucketRejected')}</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((s) => !s)}
            className={`text-sm px-3.5 py-2 rounded-pill border font-semibold transition ${
              activeFilterCount > 0
                ? 'border-brand text-brand bg-brand/5'
                : 'border-line2 bg-bg2 hover:bg-bg3'
            }`}
          >
            {showFilters ? '▲' : '▼'} {t('filtersToggle')}
            {activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => {
                setDateFrom('');
                setDateTo('');
                setDateType('purchase');
                setBatchCode('');
                setBucket('');
                setRole('');
                setTenantId('');
                setCodeId('');
              }}
              className="text-xs text-mute hover:text-ink underline"
            >
              {t('clearFilters')}
            </button>
            <button
              onClick={exportCsv}
              className="text-sm px-3 py-1.5 rounded-md border border-line2 bg-bg2 hover:bg-bg3 transition"
            >
              ⬇ {t('exportCsv')}
            </button>
          </div>
        </div>

        {showFilters && (
          <div className="flex flex-wrap items-end gap-3 mt-3 pt-3 border-t border-line2">
        {/* Brief PASO 5: TIPO de fecha. Filtro y columna FECHA operan sobre el
            mismo campo — la etiqueta deja claro cuál está activo. */}
        <div>
          <label className="label">{t('dateTypeLabel')}</label>
          <select
            className="input"
            value={dateType}
            onChange={(e) => setDateType(e.target.value as DateType)}
            title={
              dateType === 'purchase'
                ? t('dateTypePurchaseHint')
                : dateType === 'payment'
                  ? t('dateTypePaymentHint')
                  : t('dateTypeBatchHint')
            }
          >
            <option value="purchase">{t('dateTypePurchase')}</option>
            <option value="payment">{t('dateTypePayment')}</option>
            <option value="batch">{t('dateTypeBatch')}</option>
          </select>
        </div>
        {dateType === 'batch' ? (
          <div>
            <label className="label">{t('filterBatch')}</label>
            <select
              className="input"
              value={batchCode}
              onChange={(e) => setBatchCode(e.target.value)}
            >
              <option value="">{t('filterAllBatches')}</option>
              {batches.map((b) => (
                <option key={b.id} value={b.code}>
                  {b.code} · {fmtUsd(b.totalUsd)} · {b.commissionsCount}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <>
            <div>
              <label className="label">{t('filterFrom')}</label>
              <input
                type="date"
                className="input"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="label">{t('filterTo')}</label>
              <input
                type="date"
                className="input"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </>
        )}
        <div>
          <label className="label">{t('filterRole')}</label>
          <select
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value as any)}
          >
            <option value="">{t('filterAll')}</option>
            <option value="INFLUENCER">{t('roleInfluencer')}</option>
            <option value="AMBASSADOR">{t('roleAmbassador')}</option>
            <option value="VENDOR">{t('roleVendor')}</option>
            <option value="SOCIO">{t('roleSocio')}</option>
          </select>
        </div>
        <div>
          <label className="label">{t('filterBusiness')}</label>
          <BusinessFilterPicker
            businesses={businesses}
            value={tenantId}
            onChange={setTenantId}
            allLabel={t('filterAll')}
            placeholder={t('filterBusiness')}
          />
        </div>
        <div>
          <label className="label">{t('filterAmbassador')}</label>
          <AffiliatePickerSearch value={codeId} onChange={setCodeId} />
        </div>
        {/* Brief PASO 5: deja explícito sobre qué fecha se está filtrando. */}
        <div className="w-full text-xs text-mute border-t border-line2 pt-2">
          {t.rich('activeDateType', {
            label:
              dateType === 'purchase'
                ? `${t('dateTypePurchase')} — ${t('dateTypePurchaseHint')}`
                : dateType === 'payment'
                  ? `${t('dateTypePayment')} — ${t('dateTypePaymentHint')}`
                  : `${t('dateTypeBatch')} — ${t('dateTypeBatchHint')}`,
            b: (chunks) => <b className="text-ink">{chunks}</b>,
          })}
        </div>
          </div>
        )}
      </div>

      {/* PDF Soft(9): negocios que pagan sin afiliado → asignación manual. */}
      <UnattributedPanel />

      {/* Tabla */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 font-semibold">
                  {dateType === 'payment'
                    ? t('dateTypePayment')
                    : dateType === 'batch'
                      ? t('dateTypeBatch')
                      : t('dateTypePurchase')}
                </th>
                <th className="px-4 py-3 font-semibold">{t('thBusiness')}</th>
                <th className="px-4 py-3 font-semibold">{t('thPlan')}</th>
                <th className="px-4 py-3 font-semibold">{t('thRecipient')}</th>
                <th className="px-4 py-3 font-semibold text-right">{t('thAmount')}</th>
                <th className="px-4 py-3 font-semibold text-right">{t('thPaid')}</th>
                <th className="px-4 py-3 font-semibold text-right">{t('thOutstanding')}</th>
                <th className="px-4 py-3 font-semibold">{t('thStatus')}</th>
                <th className="px-4 py-3 font-semibold text-center">{t('thDaysLeft')}</th>
                <th className="px-4 py-3 font-semibold">{t('thPaidDate')}</th>
                <th className="px-4 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-mute">
                    {t('loading')}
                  </td>
                </tr>
              )}
              {!loading && (data?.items.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-mute">
                    <div className="text-3xl mb-2">💸</div>
                    {t('emptyNoCommissions')}
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
                        {/* Brief PASO 5: la celda muestra la fecha del tipo
                            activo. Solo la fecha de COMPRA (businessDate) es
                            editable a mano; pago/lote son de solo lectura. */}
                        {dateType === 'payment' ? (
                          c.paidAt ? (
                            <span title={c.payoutBatch?.code ?? undefined}>
                              {fmtDate(c.paidAt)}
                            </span>
                          ) : (
                            <span className="text-mute">—</span>
                          )
                        ) : dateType === 'batch' ? (
                          c.payoutBatch ? (
                            <span
                              className="font-mono text-[11px]"
                              title={`${t('dateTypePayment')}: ${fmtDate(c.payoutBatch.paymentDate)}`}
                            >
                              {c.payoutBatch.code}
                            </span>
                          ) : (
                            <span className="text-mute">—</span>
                          )
                        ) : editDate?.id === c.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="date"
                              className="input py-1 px-1.5 text-xs w-[140px]"
                              value={editDate.value}
                              onChange={(e) =>
                                setEditDate({ id: c.id, value: e.target.value })
                              }
                              autoFocus
                            />
                            <button
                              type="button"
                              className="text-ok hover:opacity-80 px-1 font-bold"
                              disabled={savingDate}
                              onClick={() => saveBusinessDate(c.id, editDate.value)}
                              title="Guardar fecha"
                            >
                              ✓
                            </button>
                            <button
                              type="button"
                              className="text-mute hover:text-ink px-1"
                              disabled={savingDate}
                              onClick={() => setEditDate(null)}
                              title="Cancelar"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="group inline-flex items-center gap-1 hover:text-brand"
                            onClick={() =>
                              setEditDate({
                                id: c.id,
                                value: toDateInputValue(
                                  c.commissionDate ?? c.createdAt,
                                ),
                              })
                            }
                            title={
                              c.businessDate
                                ? 'Fecha fijada a mano — clic para editar'
                                : 'Fecha por heurística — clic para fijar la real'
                            }
                          >
                            {c.businessDate && (
                              <span
                                className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block flex-none"
                                aria-hidden
                              />
                            )}
                            {fmtDate(c.commissionDate ?? c.createdAt)}
                            <span className="opacity-0 group-hover:opacity-60 text-[10px]">
                              ✎
                            </span>
                          </button>
                        )}
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
                        {/* PDF Soft(10): plan unificado por periodicidad. */}
                        <div>
                          {planDisplayName(
                            c.tenant?.planName,
                            (c.tenant?.planPeriodicity as PlanPeriodicity | null) ??
                              null,
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {c.recipient ? (
                          <>
                            <div className="font-medium text-xs">
                              {c.recipient.ownerName}
                            </div>
                            <div className="text-[10px] text-mute">
                              {ROLE_LABEL_KEY[c.recipient.role]
                                ? t(ROLE_LABEL_KEY[c.recipient.role])
                                : c.recipient.role}
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
                          {t(badge.key)}
                        </span>
                        {inHold && (
                          <div className="text-[10px] text-mute mt-1 whitespace-nowrap">
                            {t('availableOn', { date: fmtDate(c.availableAt) })}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        {inHold ? (
                          <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700">
                            {c.daysRemaining}d
                          </span>
                        ) : c.status === 'REJECTED' ? (
                          <span className="text-mute text-xs">—</span>
                        ) : (
                          // PDF Soft(9) C1: ya habilitada (APPROVED/PAID/RETAINED) →
                          // mostramos la FECHA en que se habilitó (availableAt) en vez
                          // de "—", para poder auditar pagos pasados (revisar en agosto
                          // comisiones de mayo/junio).
                          <span className="text-[11px] text-mute" title={t('thDaysLeft')}>
                            {fmtDate(c.availableAt)}
                          </span>
                        )}
                      </td>
                      {/* PDF Soft(9) C4: FECHA DE PAGO — día real en que se pagó la
                          comisión (paidAt). Para llevar registro de efectividad de pagos. */}
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        {c.paidAt ? (
                          <span className="text-emerald-600 font-medium">
                            ✓ {fmtDate(c.paidAt)}
                          </span>
                        ) : (
                          <span className="text-mute">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <RowActions
                          c={c}
                          inHold={inHold}
                          enabling={enabling === c.id}
                          onEnable={() => enableCommission(c)}
                          onPay={() => setPaying(c)}
                        />
                      </td>
                    </tr>
                  );
                })}
            </tbody>
            {data && data.items.length > 0 && (
              <tfoot className="bg-bg2">
                <tr className="border-t-2 border-line2 font-semibold">
                  <td colSpan={4} className="px-4 py-3 text-right text-xs">
                    {t('totalRows', { count: data.totals.count })}
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
  const t = useTranslations('admin_commissions');
  const [amount, setAmount] = useState(item.outstanding.toFixed(2));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    const n = parseFloat(amount);
    if (!Number.isFinite(n) || n <= 0) {
      toast(t('invalidAmount'), 'error');
      return;
    }
    if (n > item.outstanding + 0.001) {
      toast(
        t('amountExceedsOutstanding', { amount: fmtUsd(item.outstanding) }),
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
          ? t('toastMarkedPaid')
          : t('toastPartialPayment'),
        'success',
      );
      onSaved();
    } catch (e: any) {
      toast(e?.message ?? t('errorRegisteringPayment'), 'error');
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
        <h2 className="text-lg font-bold mb-4">{t('modalPayTitle')}</h2>

        <div className="bg-bg2 rounded-lg p-3 mb-4 text-sm">
          <div className="flex justify-between mb-1">
            <span className="text-mute">{t('modalRecipient')}</span>
            <span className="font-medium">{item.recipient?.ownerName ?? '—'}</span>
          </div>
          <div className="flex justify-between mb-1">
            <span className="text-mute">{t('modalBusiness')}</span>
            <span className="font-medium">{item.tenant?.brandName ?? '—'}</span>
          </div>
          <div className="flex justify-between mb-1">
            <span className="text-mute">{t('modalTotalAmount')}</span>
            <span className="font-semibold">{fmtUsd(item.amount)}</span>
          </div>
          <div className="flex justify-between mb-1">
            <span className="text-mute">{t('modalAlreadyPaid')}</span>
            <span className="text-ok">{fmtUsd(item.amountPaid)}</span>
          </div>
          <div className="flex justify-between border-t border-line2 pt-2 mt-2">
            <span className="text-mute font-semibold">{t('modalOutstanding')}</span>
            <span className="text-amber-700 font-bold">
              {fmtUsd(item.outstanding)}
            </span>
          </div>
        </div>

        <div className="mb-3">
          <label className="label">{t('modalAmountPaidUsd')}</label>
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
            {t('partialHint')}
          </div>
        </div>

        <div className="mb-4">
          <label className="label">{t('modalReferenceNote')}</label>
          <input
            type="text"
            placeholder={t('phReferenceNote')}
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
            {t('btnCancel')}
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="text-sm px-4 py-2 rounded-md bg-brand text-white font-semibold hover:opacity-90 transition disabled:opacity-50 select-none active:scale-[0.97] [-webkit-tap-highlight-color:transparent]"
          >
            {saving ? t('saving') : t('btnConfirmPayment')}
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

/**
 * #8 (2026-06-16): menú desplegable de acciones por fila (reemplaza los
 * botones inline "🔓 Habilitar" + "Marcar pagado"). Botón ⋯ que abre un
 * dropdown con las acciones disponibles según el estado de la comisión.
 */
function RowActions({
  c,
  inHold,
  enabling,
  onEnable,
  onPay,
}: {
  c: CommissionRow;
  inHold: boolean;
  enabling: boolean;
  onEnable: () => void;
  onPay: () => void;
}) {
  const t = useTranslations('admin_commissions');
  const [open, setOpen] = useState(false);
  const canPay = c.paymentStatus !== 'PAID' && c.status !== 'REJECTED';
  const hasActions = inHold || canPay;

  if (!hasActions) {
    return c.paymentStatus === 'PAID' ? (
      <span className="text-xs text-ok">✓ {fmtDate(c.paidAt)}</span>
    ) : (
      <span className="text-mute text-xs">—</span>
    );
  }

  return (
    <div className="relative inline-block text-left">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={enabling}
        className="text-base px-2.5 py-1 rounded-md bg-bg2 text-ink font-semibold hover:bg-line transition select-none active:scale-[0.97] [-webkit-tap-highlight-color:transparent] disabled:opacity-50"
        title={t('actions')}
        aria-label={t('actions')}
      >
        {enabling ? '…' : '⋯'}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-line bg-white shadow-lg py-1 text-left">
            {inHold && (
              <button
                onClick={() => {
                  setOpen(false);
                  onEnable();
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-bg2 flex items-center gap-2"
                title={t('enableNowTooltip')}
              >
                🔓 {t('enableNow')}
              </button>
            )}
            {canPay && (
              <button
                onClick={() => {
                  setOpen(false);
                  onPay();
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-bg2 flex items-center gap-2 text-brand"
              >
                💵 {t('markPaid')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ===================================================================
// #11 (2026-06-16): Auditoría avanzada de comisiones
// ===================================================================
type AuditFinding = {
  type: 'WRONG_AMOUNT' | 'DUPLICATE' | 'PHANTOM';
  reason?: string;
  tenant: string | null;
  recipient: string;
  role: string | null;
  status?: string;
  periodKey: string | null;
  actual: number;
  expected?: number;
  commissionId: string;
};
type AuditResult = {
  summary: {
    auditedTenants: number;
    liveCommissions: number;
    wrongAmount: number;
    duplicates: number;
    phantom: number;
    deltaUsd: number;
  };
  findings: AuditFinding[];
};

const AUDIT_BADGE: Record<AuditFinding['type'], { key: string; cls: string }> =
  {
    WRONG_AMOUNT: { key: 'auditWrongAmount', cls: 'bg-amber-100 text-amber-700' },
    DUPLICATE: { key: 'auditDuplicate', cls: 'bg-red-100 text-red-700' },
    PHANTOM: { key: 'auditPhantom', cls: 'bg-slate-200 text-slate-700' },
  };

function CommissionAuditPanel() {
  const t = useTranslations('admin_commissions');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [open, setOpen] = useState(false);
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [applyingAll, setApplyingAll] = useState(false);

  async function run() {
    setLoading(true);
    try {
      const res = await api<AuditResult>('/referrals/audit/commissions');
      setResult(res ?? null);
      setOpen(true);
    } catch (e: unknown) {
      toast((e as Error)?.message || t('errorAuditing'), 'error');
    } finally {
      setLoading(false);
    }
  }

  // PDF 752 #2.2: corrige UNA comisión al monto esperado (acción explícita).
  async function recalcOne(commissionId: string) {
    setFixingId(commissionId);
    try {
      await api(`/referrals/audit/commissions/${commissionId}/recalc`, {
        method: 'POST',
      });
      toast(t('auditFixed'), 'success');
      // Re-corre el arqueo para reflejar el estado actualizado.
      const res = await api<AuditResult>('/referrals/audit/commissions');
      setResult(res ?? null);
    } catch (e: unknown) {
      toast((e as Error)?.message || t('auditFixError'), 'error');
    } finally {
      setFixingId(null);
    }
  }

  // 2026-07-17: rechaza un hallazgo DUPLICATE/PHANTOM. En DUPLICATE conserva la
  // del cobro real (con hotmartTransactionId) y rechaza las fantasma.
  async function rejectOne(commissionId: string, type: 'DUPLICATE' | 'PHANTOM') {
    setFixingId(commissionId);
    try {
      const r = await api<{ rejected: number }>(
        `/referrals/audit/commissions/${commissionId}/reject`,
        { method: 'POST', body: JSON.stringify({ type }) },
      );
      toast(`Rechazadas: ${r?.rejected ?? 0}`, 'success');
      const res = await api<AuditResult>('/referrals/audit/commissions');
      setResult(res ?? null);
    } catch (e: unknown) {
      toast((e as Error)?.message || 'No se pudo rechazar', 'error');
    } finally {
      setFixingId(null);
    }
  }

  // 2026-07-17: "Corregir todo" — aplica la corrección adecuada a cada hallazgo.
  async function applyAll() {
    if (
      !window.confirm(
        '¿Corregir TODOS los hallazgos? Recalcula montos, rechaza fantasmas y deduplica (nunca toca comisiones pagadas). Todo queda en el log de auditoría.',
      )
    )
      return;
    setApplyingAll(true);
    try {
      const r = await api<{
        fixedAmounts: number;
        rejectedDuplicate: number;
        rejectedPhantom: number;
        skipped: number;
      }>('/referrals/audit/commissions/apply-all', { method: 'POST' });
      toast(
        `Corregidos: ${r.fixedAmounts} montos · ${r.rejectedDuplicate + r.rejectedPhantom} rechazadas${r.skipped ? ` · ${r.skipped} omitidas` : ''}`,
        'success',
      );
      const res = await api<AuditResult>('/referrals/audit/commissions');
      setResult(res ?? null);
    } catch (e: unknown) {
      toast((e as Error)?.message || 'No se pudo corregir todo', 'error');
    } finally {
      setApplyingAll(false);
    }
  }

  const s = result?.summary;
  const clean =
    s && s.wrongAmount === 0 && s.duplicates === 0 && s.phantom === 0;
  const findings = result?.findings ?? [];

  return (
    <div className="card card-pad mb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold">🔍 {t('auditTitle')}</div>
          <div className="text-xs text-mute">
            {t('auditDescription')}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {result && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="text-sm px-3 py-2 rounded-pill border border-slate-300 bg-white text-slate-700 font-semibold hover:bg-slate-50 transition"
            >
              {open ? t('hide') : t('viewResults')}
            </button>
          )}
          {result && !clean && (
            <button
              type="button"
              onClick={applyAll}
              disabled={applyingAll}
              className="text-sm px-3.5 py-2 rounded-pill bg-red-600 text-white font-semibold hover:opacity-90 transition disabled:opacity-50"
              title="Recalcula montos, rechaza fantasmas y deduplica (nunca toca pagadas)"
            >
              {applyingAll ? 'Corrigiendo…' : '🛠 Corregir todo'}
            </button>
          )}
          <button
            type="button"
            onClick={run}
            disabled={loading}
            className="text-sm px-3.5 py-2 rounded-pill bg-brand text-white font-semibold hover:opacity-90 transition disabled:opacity-50"
          >
            {loading ? t('auditing') : t('runAudit')}
          </button>
        </div>
      </div>

      {result && open && s && (
        <div className="mt-4">
          <div className="flex flex-wrap gap-2 text-xs mb-3">
            <span className="px-2.5 py-1 rounded-pill bg-bg2 text-mute">
              {t('auditSummaryTenants', {
                tenants: s.auditedTenants,
                live: s.liveCommissions,
              })}
            </span>
            <span className="px-2.5 py-1 rounded-pill bg-amber-100 text-amber-700">
              {t('auditSummaryWrongAmount', { count: s.wrongAmount })}
            </span>
            <span className="px-2.5 py-1 rounded-pill bg-red-100 text-red-700">
              {t('auditSummaryDuplicates', { count: s.duplicates })}
            </span>
            <span className="px-2.5 py-1 rounded-pill bg-slate-200 text-slate-700">
              {t('auditSummaryPhantom', { count: s.phantom })}
            </span>
            <span className="px-2.5 py-1 rounded-pill bg-bg2 text-mute">
              {t('auditSummaryDelta', { delta: s.deltaUsd.toFixed(2) })}
            </span>
          </div>

          {clean ? (
            <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">
              ✅ {t('auditClean')}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead className="bg-bg2 text-mute text-xs">
                  <tr>
                    <th className="text-left px-3 py-2">{t('auditThType')}</th>
                    <th className="text-left px-3 py-2">{t('auditThBusiness')}</th>
                    <th className="text-left px-3 py-2">{t('auditThRecipient')}</th>
                    <th className="text-left px-3 py-2">{t('auditThPeriod')}</th>
                    <th className="text-right px-3 py-2">{t('auditThActual')}</th>
                    <th className="text-right px-3 py-2">{t('auditThExpected')}</th>
                    <th className="text-right px-3 py-2">{t('auditThAction')}</th>
                  </tr>
                </thead>
                <tbody>
                  {findings.map((f) => {
                    const badge = AUDIT_BADGE[f.type];
                    return (
                      <tr key={f.commissionId} className="border-t border-line">
                        <td className="px-3 py-2">
                          <span
                            className={`px-2 py-0.5 rounded-pill text-xs font-semibold ${badge.cls}`}
                          >
                            {t(badge.key)}
                          </span>
                          {f.reason && (
                            <span className="text-mute text-xs"> · {f.reason}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">{f.tenant ?? '—'}</td>
                        <td className="px-3 py-2">
                          {f.recipient}
                          {f.role && (
                            <span className="text-mute text-xs"> · {f.role}</span>
                          )}
                          {f.status && (
                            <span className="text-mute text-xs"> · {f.status}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-mute">
                          {f.periodKey ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          ${f.actual.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {f.expected !== undefined
                            ? `$${f.expected.toFixed(2)}`
                            : '—'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {f.type === 'WRONG_AMOUNT' &&
                          f.expected !== undefined ? (
                            <button
                              type="button"
                              onClick={() => recalcOne(f.commissionId)}
                              disabled={fixingId === f.commissionId}
                              className="text-xs px-2.5 py-1 rounded-pill bg-brand text-white font-semibold hover:opacity-90 transition disabled:opacity-50"
                              title={t('auditFixTitle', {
                                expected: f.expected.toFixed(2),
                              })}
                            >
                              {fixingId === f.commissionId
                                ? t('auditFixing')
                                : t('auditFix')}
                            </button>
                          ) : f.type === 'DUPLICATE' || f.type === 'PHANTOM' ? (
                            <button
                              type="button"
                              onClick={() =>
                                rejectOne(
                                  f.commissionId,
                                  f.type as 'DUPLICATE' | 'PHANTOM',
                                )
                              }
                              disabled={fixingId === f.commissionId}
                              className="text-xs px-2.5 py-1 rounded-pill bg-red-600 text-white font-semibold hover:opacity-90 transition disabled:opacity-50"
                              title={
                                f.type === 'DUPLICATE'
                                  ? 'Conserva la del cobro real y rechaza la fantasma'
                                  : 'Rechaza esta comisión fantasma'
                              }
                            >
                              {fixingId === f.commissionId ? '…' : 'Rechazar'}
                            </button>
                          ) : (
                            <span className="text-mute">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
