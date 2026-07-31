'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createPortal } from 'react-dom';
import { api, getUser, startImpersonation } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { DuplicateBusinessModal } from '@/components/DuplicateBusinessModal';
import { ManageTrialModal } from '@/components/ManageTrialModal';
import { periodLabel, planDisplayName, type PlanPeriodicity } from '@/lib/plan-format';

function avatarClass(seed: string) {
  const sum = seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return `avatar-${(sum % 7) + 1}`;
}
function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

// Sellea (solo): vencimiento del servicio del negocio para verlo en el listado
// sin entrar a cada perfil. Activos → currentPeriodEnd; trials → trialEndsAt.
// Colorea rojo si ya venció, ámbar si vence en ≤7 días.
function expiryInfo(tn: any): { label: string; cls: string } {
  const iso = tn?.currentPeriodEnd ?? tn?.trialEndsAt ?? null;
  if (!iso) return { label: '—', cls: 'text-mute2' };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { label: '—', cls: 'text-mute2' };
  const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
  return {
    label: d.toLocaleDateString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }),
    cls:
      days < 0
        ? 'text-bad font-medium'
        : days <= 7
          ? 'text-warn font-medium'
          : 'text-ink',
  };
}

type StatusFilter = 'ALL' | 'ACTIVE' | 'TRIAL' | 'SUSPENDED';
type PlanFilter = 'ALL' | 'ELITE';
type PeriodFilter = 'ALL' | 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';

// Aplana un tenant a una bolsa de tokens lowercase para búsqueda
// multi-keyword AND. Tomamos solo los campos que SÍ devuelve /tenants
// (brandName/email/phone/whatsappPhone/status/plan/periodicidad).
// Los campos de atribución (influencer/embajador/vendor/campaña) no
// vienen en el response actual — si en el futuro se agregan acá los
// recogemos automático sin tocar la UI.
function searchHaystack(t: any): string {
  const parts = [
    t.brandName,
    t.name,
    t.email,
    t.phone,
    t.whatsappPhone,
    t.slug,
    t.city,
    t.country,
    t.status,
    t.plan?.name,
    t.planPeriodicity,
    // Tipo de negocio para que "infolink" / "completo" matcheen en la búsqueda.
    t.businessType,
    t.businessType === 'INFOLINK' ? 'solo infolink' : 'negocio completo',
    t.attributionInfluencer?.ownerName,
    t.attributionAmbassador?.ownerName,
    t.attributionVendor?.ownerName,
    t.attributionCampaign?.name,
    // Concatenado plan+periodicidad para que "elite trimestral" matchee
    // como una sola frase aunque vengan de campos distintos.
    t.plan?.name && t.planPeriodicity
      ? `${t.plan.name} ${t.planPeriodicity}`
      : null,
  ];
  return parts.filter(Boolean).join(' ').toLowerCase();
}

export default function TenantsPage() {
  const t = useTranslations('admin_tenants');
  const router = useRouter();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [planFilter, setPlanFilter] = useState<PlanFilter>('ALL');
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('ALL');
  const [searchRaw, setSearchRaw] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [duplicateTarget, setDuplicateTarget] = useState<any | null>(null);
  const [showRanking, setShowRanking] = useState(false); // #11
  const [trialTarget, setTrialTarget] = useState<any | null>(null);
  const me = getUser();
  const isMarketing = me?.role === 'MARKETING';
  // Solo Sellea: reemplaza las columnas Pedidos/Revenue 30d (sin uso para esa
  // marca) por el VENCIMIENTO del servicio. El panel /admin está aislado por
  // marca, así que todas las filas comparten whiteLabelSlug.
  const isSellea = list.some((x: any) => x?.whiteLabelSlug === 'sellea');

  // Debounce 150ms para evitar re-renders por keystroke en listas grandes.
  useEffect(() => {
    const id = setTimeout(() => setSearchDebounced(searchRaw.trim()), 150);
    return () => clearTimeout(id);
  }, [searchRaw]);

  async function enterTenant(tn: any) {
    if (enteringId) return;
    setEnteringId(tn.id);
    try {
      const res = await api(`/tenants/${tn.id}/impersonate`, { method: 'POST' });
      startImpersonation({
        accessToken: res.accessToken,
        user: res.user,
        tenant: {
          id: res.tenant.id,
          brandName: res.tenant.brandName,
          // Seed anti-flash del panel /app (branding de la marca blanca).
          primaryColor: res.tenant.primaryColor ?? undefined,
          slug: res.tenant.slug,
          whiteLabelSlug: res.tenant.whiteLabelSlug ?? null,
          whiteLabelName: res.tenant.whiteLabelName ?? null,
          logoUrl: res.tenant.logoUrl ?? null,
          iconUrl: res.tenant.iconUrl ?? null,
        },
      });
      toast(t('toastEntering', { name: res.tenant.brandName }), 'success');
      router.push('/app');
    } catch (e: any) {
      toast(e.message || t('toastEnterError'), 'error');
      setEnteringId(null);
    }
  }

  async function load() {
    setLoading(true);
    try {
      setList(await api('/tenants'));
    } catch (e: any) {
      toast(e.message || t('toastLoadError'), 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function setStatus(id: string, status: string) {
    try {
      await api(`/tenants/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      toast(
        status === 'ACTIVE' ? t('toastReactivated') : t('toastSuspended'),
        'success',
      );
      load();
    } catch (e: any) {
      toast(e.message || t('toastStatusError'), 'error');
    }
  }

  // Genera y dispara la descarga de un JSON con los datos del tenant que
  // tenemos en memoria (sin pegarle al backend de nuevo). Útil para
  // auditorías rápidas, soporte y handover.
  function downloadTenant(tn: any) {
    try {
      const safeName = (tn.brandName || tn.slug || 'negocio')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      const date = new Date().toISOString().slice(0, 10);
      const blob = new Blob([JSON.stringify(tn, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tenant-${safeName}-${date}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast(t('toastDownloadReady'), 'success');
    } catch (e: any) {
      toast(e.message || t('toastDownloadError'), 'error');
    }
  }

  /**
   * Bloque 5 (2026-06-12): eliminar con opción "conservar historial".
   * keepHistory=true (default seguro) → soft delete. Las relaciones se
   * preservan (Order/Commission/ReferralUse) y el tenant desaparece de
   * los listados. keepHistory=false → hard delete con cascade.
   */
  async function deleteTenant(tn: any, opts: { keepHistory: boolean }) {
    try {
      await api(`/tenants/${tn.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ keepHistory: opts.keepHistory }),
      });
      toast(
        opts.keepHistory
          ? t('toastDeletedKept', { name: tn.brandName })
          : t('toastDeleted', { name: tn.brandName }),
        'success',
      );
      setDeleteTarget(null);
      load();
    } catch (e: any) {
      toast(e.message || t('toastDeleteError'), 'error');
    }
  }

  const visible = useMemo(() => {
    const keywords = searchDebounced
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return list.filter((tn) => {
      if (statusFilter !== 'ALL' && tn.status !== statusFilter) return false;
      if (planFilter !== 'ALL') {
        const name = (tn.plan?.name ?? '').toString().toUpperCase();
        if (name !== planFilter) return false;
      }
      if (periodFilter !== 'ALL') {
        // Sin periodicidad explícita el backend la trata como MENSUAL
        // (ver periodLabel) — replicamos esa convención al filtrar.
        const p = (tn.planPeriodicity ?? 'MENSUAL').toString().toUpperCase();
        if (p !== periodFilter) return false;
      }
      if (keywords.length === 0) return true;
      const hay = searchHaystack(tn);
      return keywords.every((k) => hay.includes(k));
    });
  }, [list, statusFilter, planFilter, periodFilter, searchDebounced]);

  const hasActiveFilters =
    statusFilter !== 'ALL' ||
    planFilter !== 'ALL' ||
    periodFilter !== 'ALL' ||
    searchDebounced.length > 0;

  function clearFilters() {
    setStatusFilter('ALL');
    setPlanFilter('ALL');
    setPeriodFilter('ALL');
    setSearchRaw('');
    setSearchDebounced('');
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          {t('title')}{' '}
          <span className="page-crumb">
            {t('crumbRecords', { count: list.length })}
          </span>
        </h1>
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setShowRanking(true)}
          >
            🏆 {t('ranking')}
          </button>
          {!isMarketing && (
            <Link className="btn-primary" href="/admin/tenants/new">
              <Icon name="plus" /> {t('newBusiness')}
            </Link>
          )}
        </div>
      </div>

      {showRanking && <PassesRankingModal onClose={() => setShowRanking(false)} />}

      <div className="mb-3.5 flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex items-center gap-2 flex-1 bg-bg2 rounded-pill px-4 py-2.5">
          <Icon name="search" size={16} className="text-mute shrink-0" />
          <input
            type="search"
            value={searchRaw}
            onChange={(e) => setSearchRaw(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-mute2"
          />
          {searchRaw && (
            <button
              type="button"
              onClick={() => setSearchRaw('')}
              className="text-mute hover:text-ink text-lg leading-none shrink-0"
              aria-label={t('clearSearch')}
            >
              ×
            </button>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="bg-white border border-line rounded-pill px-3 py-2 text-sm cursor-pointer hover:bg-bg2"
          >
            <option value="ALL">{t('statusAll')}</option>
            <option value="ACTIVE">{t('statusActive')}</option>
            <option value="TRIAL">{t('statusTrial')}</option>
            <option value="SUSPENDED">{t('statusSuspended')}</option>
          </select>
          <select
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value as PlanFilter)}
            className="bg-white border border-line rounded-pill px-3 py-2 text-sm cursor-pointer hover:bg-bg2"
          >
            <option value="ALL">{t('planAll')}</option>
            <option value="ELITE">Elite</option>
          </select>
          <select
            value={periodFilter}
            onChange={(e) => setPeriodFilter(e.target.value as PeriodFilter)}
            className="bg-white border border-line rounded-pill px-3 py-2 text-sm cursor-pointer hover:bg-bg2"
          >
            <option value="ALL">{t('periodAll')}</option>
            <option value="MENSUAL">{t('periodMonthly')}</option>
            <option value="TRIMESTRAL">{t('periodQuarterly')}</option>
            <option value="SEMESTRAL">{t('periodSemiannual')}</option>
            <option value="ANUAL">{t('periodAnnual')}</option>
          </select>
        </div>
      </div>

      {hasActiveFilters && (
        <div className="mb-3 flex items-center gap-3 text-xs text-mute">
          <span>
            {t.rich('filteredCount', {
              count: visible.length,
              strong: (chunks) => (
                <strong className="text-ink">{chunks}</strong>
              ),
            })}
          </span>
          <button
            type="button"
            onClick={clearFilters}
            className="text-brand hover:underline"
          >
            {t('clearFilters')}
          </button>
        </div>
      )}

      <div className="card overflow-visible p-0">
       <div className="overflow-x-auto overflow-y-visible">
        <table className="w-full text-[13.5px] min-w-[760px]">
          <thead className="bg-bg2">
            <tr>
              {(isSellea
                ? [t('thBusiness'), 'Tipo', t('thPlan'), t('thStatus'), t('thTrial'), t('thExpires'), t('thCustomers'), t('thGroup'), '']
                : [t('thBusiness'), 'Tipo', t('thPlan'), t('thStatus'), t('thTrial'), t('thOrders30'), t('thRevenue30'), t('thCustomers'), t('thGroup'), '']
              ).map((h, i) => (
                  <th
                    key={`${h}-${i}`}
                    className="text-left px-4 py-3.5 text-[11px] uppercase tracking-[0.1em] text-mute font-semibold"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-t border-line2">
                  <td colSpan={isSellea ? 9 : 10} className="px-4 py-3.5">
                    <div className="h-6 bg-bg2 rounded animate-shimmer" />
                  </td>
                </tr>
              ))}
            {!loading && visible.length === 0 && (
              <tr>
                <td className="px-4 py-12 text-center" colSpan={isSellea ? 9 : 10}>
                  <div className="text-3xl mb-1">🏢</div>
                  <div className="font-semibold">
                    {hasActiveFilters
                      ? t('emptyFilteredTitle')
                      : t('emptyTitle')}
                  </div>
                  <div className="text-mute text-xs mt-1">
                    {hasActiveFilters
                      ? t('emptyFilteredHint')
                      : t('emptyHint')}
                  </div>
                </td>
              </tr>
            )}
            {visible.map((tn) => {
              const canEnter =
                !isMarketing && tn.status !== 'SUSPENDED' && enteringId !== tn.id;
              const stop = (e: React.MouseEvent) => e.stopPropagation();
              return (
              <tr
                key={tn.id}
                onClick={() => canEnter && enterTenant(tn)}
                className={`border-t border-line2 transition group ${
                  canEnter
                    ? 'hover:bg-brand-soft/40 cursor-pointer'
                    : 'opacity-70'
                }`}
                title={
                  isMarketing
                    ? t('rowTitleReadOnly')
                    : tn.status === 'SUSPENDED'
                      ? t('rowTitleReactivate')
                      : t('rowTitleEnter', { name: tn.brandName })
                }
              >
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`avatar w-8 h-8 text-xs ${avatarClass(tn.brandName)}`}
                    >
                      {initials(tn.brandName)}
                    </span>
                    <div>
                      <div className="font-medium group-hover:text-brand transition">
                        {tn.brandName}
                      </div>
                      <div className="text-mute text-xs">{tn.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  {tn.businessType === 'INFOLINK' ? (
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      style={{ background: 'rgba(37,99,235,.12)', color: '#2563eb' }}
                    >
                      Solo InfoLink
                    </span>
                  ) : (
                    <span className="text-[11px] text-mute">Completo</span>
                  )}
                </td>
                <td className="px-4 py-3.5">
                  <div className="font-medium">
                    {planDisplayName(
                      tn.plan?.name,
                      tn.planPeriodicity as PlanPeriodicity | null,
                    )}
                  </div>
                  <div className="text-[11px] text-mute">
                    {periodLabel(tn.planPeriodicity as PlanPeriodicity | null)}
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <span
                    className={`badge ${
                      tn.status === 'ACTIVE'
                        ? 'badge-ok'
                        : tn.status === 'TRIAL'
                        ? 'badge-warn'
                        : 'badge-bad'
                    }`}
                  >
                    {tn.status === 'ACTIVE'
                      ? t('badgeActive')
                      : tn.status === 'TRIAL'
                      ? t('badgeTrial')
                      : t('badgeSuspended')}
                  </span>
                </td>
                <td className="px-4 py-3.5">
                  {tn.daysLeftInTrial !== null ? (
                    <span
                      className={
                        tn.daysLeftInTrial <= 2
                          ? 'text-bad font-medium'
                          : tn.daysLeftInTrial <= 5
                          ? 'text-warn font-medium'
                          : 'text-mute'
                      }
                    >
                      {t('daysShort', { count: tn.daysLeftInTrial })}
                    </span>
                  ) : (
                    <span className="text-mute2">—</span>
                  )}
                </td>
                {isSellea ? (
                  (() => {
                    const exp = expiryInfo(tn);
                    return (
                      <td className={`px-4 py-3.5 font-medium ${exp.cls}`}>
                        {exp.label}
                      </td>
                    );
                  })()
                ) : (
                  <>
                    <td className="px-4 py-3.5 font-medium">{tn.orders30 ?? 0}</td>
                    <td className="px-4 py-3.5 font-medium">
                      {(tn.revenue30 ?? 0).toLocaleString('es-CO', {
                        style: 'currency',
                        currency: tn.currency ?? 'COP',
                        maximumFractionDigits: 0,
                      })}
                    </td>
                  </>
                )}
                <td className="px-4 py-3.5">{tn._count?.customers ?? 0}</td>
                <td className="px-4 py-3.5">
                  {tn.businessGroup?.name ? (
                    <span
                      className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-pill bg-bg2 text-ink2"
                      title={t('businessGroupTitle')}
                    >
                      {tn.businessGroup.name}
                    </span>
                  ) : (
                    <span className="text-mute2 text-xs">{t('noGroup')}</span>
                  )}
                </td>
                <td
                  className="px-4 py-3.5 text-right whitespace-nowrap"
                  onClick={stop}
                >
                  <ActionsMenu
                    canEnter={canEnter}
                    canManage={!isMarketing}
                    isEntering={enteringId === tn.id}
                    status={tn.status}
                    onEnter={() => enterTenant(tn)}
                    onView={() => router.push(`/admin/tenants/${tn.id}`)}
                    onDownload={() => downloadTenant(tn)}
                    onToggleStatus={() =>
                      setStatus(tn.id, tn.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE')
                    }
                    onManageTrial={() => setTrialTarget(tn)}
                    onDuplicate={() => setDuplicateTarget(tn)}
                    onDelete={() => setDeleteTarget(tn)}
                  />
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
       </div>
      </div>

      {duplicateTarget && (
        <DuplicateBusinessModal
          source={{
            id: duplicateTarget.id,
            brandName: duplicateTarget.brandName,
            slug: duplicateTarget.slug,
          }}
          onClose={() => setDuplicateTarget(null)}
        />
      )}

      {trialTarget && (
        <ManageTrialModal
          tenant={{
            id: trialTarget.id,
            brandName: trialTarget.brandName,
            status: trialTarget.status,
            trialEndsAt: trialTarget.trialEndsAt,
          }}
          onClose={() => setTrialTarget(null)}
          onSaved={() => {
            setTrialTarget(null);
            load();
          }}
        />
      )}

      {deleteTarget && (
        <DeleteTenantModal
          tenant={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={(opts) => deleteTenant(deleteTarget, opts)}
        />
      )}
    </div>
  );
}

/**
 * #11 (2026-06-16): ranking de negocios por pases emitidos (mayor a menor,
 * con botón para invertir). Modal sobre la lista de negocios.
 */
function PassesRankingModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations('admin_tenants');
  const [order, setOrder] = useState<'desc' | 'asc'>('desc');
  const [rows, setRows] = useState<
    { id: string; brandName: string; status: string; passCount: number }[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api<typeof rows>(`/tenants/ranking?order=${order}`)
      .then((r) => setRows(r ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [order]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-line">
          <h3 className="text-lg font-bold">🏆 {t('rankingTitle')}</h3>
          <button
            onClick={onClose}
            className="text-mute hover:text-ink text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="px-4 py-2 border-b border-line flex items-center justify-between">
          <span className="text-xs text-mute">
            {t('rankingCount', { count: rows.length })} ·{' '}
            {order === 'desc'
              ? t('rankingOrderDesc')
              : t('rankingOrderAsc')}
          </span>
          <button
            className="btn-ghost text-xs"
            onClick={() => setOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
          >
            ⇅ {t('rankingInvert')}
          </button>
        </div>
        <div className="overflow-y-auto p-2">
          {loading ? (
            <div className="text-center text-mute text-sm py-8">{t('loading')}</div>
          ) : rows.length === 0 ? (
            <div className="text-center text-mute text-sm py-8">{t('noData')}</div>
          ) : (
            <div className="divide-y divide-line">
              {rows.map((r, i) => (
                <Link
                  key={r.id}
                  href={`/admin/tenants/${r.id}`}
                  className="flex items-center gap-3 px-2 py-2.5 hover:bg-bg2 rounded-lg"
                >
                  <div className="w-7 text-center font-bold">
                    {order === 'desc' && i < 3
                      ? ['🥇', '🥈', '🥉'][i]
                      : `${i + 1}`}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{r.brandName}</div>
                    <div className="text-[11px] text-mute">{r.status}</div>
                  </div>
                  <div className="font-bold text-brand whitespace-nowrap">
                    {t('passesCount', { count: r.passCount })}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Menú de acciones por tenant. Reemplaza la columna de botones independientes
 * (Entrar/Ver/Suspender) por un solo botón "⋮ Acciones" que despliega un
 * dropdown estilo SaaS. Cierre por click fuera, click en item, o Escape.
 */
function ActionsMenu({
  canEnter,
  canManage,
  isEntering,
  status,
  onEnter,
  onView,
  onDownload,
  onToggleStatus,
  onManageTrial,
  onDuplicate,
  onDelete,
}: {
  canEnter: boolean;
  canManage: boolean;
  isEntering: boolean;
  status: string;
  onEnter: () => void;
  onView: () => void;
  onDownload: () => void;
  onToggleStatus: () => void;
  onManageTrial: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('admin_tenants');
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 224,
  });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Calcular posición del menú alineado al botón cada vez que abre o
  // hay scroll/resize. Fix 2026-06-07: el contenedor padre tiene
  // overflow-x-auto que clipea position:absolute. Portal + fixed lo evita.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    function update() {
      const rect = btnRef.current!.getBoundingClientRect();
      const menuW = 240;
      // Alinear a la derecha del botón; clamp dentro del viewport.
      const left = Math.max(8, rect.right - menuW);
      // #9 (2026-06-16): para el ÚLTIMO negocio el menú se abría hacia abajo
      // y se salía del viewport (se veía incompleto). Si no hay espacio
      // abajo y sí arriba, lo abrimos hacia arriba; y siempre clampeamos
      // dentro de la pantalla.
      const menuH = menuRef.current?.offsetHeight ?? 320;
      const spaceBelow = window.innerHeight - rect.bottom;
      let top =
        spaceBelow < menuH + 12 && rect.top > menuH + 12
          ? rect.top - menuH - 6
          : rect.bottom + 6;
      top = Math.max(8, Math.min(top, window.innerHeight - menuH - 8));
      setPos({ top, left, width: menuW });
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function run(fn: () => void) {
    return () => {
      setOpen(false);
      fn();
    };
  }

  const menu = open && mounted ? (
    <div
      ref={menuRef}
      role="menu"
      className="fixed bg-white border border-line2 rounded-lg shadow-xl py-1 text-left text-sm overflow-y-auto"
      style={{
        top: pos.top,
        left: pos.left,
        width: pos.width,
        maxHeight: 'calc(100vh - 16px)',
        zIndex: 9999,
      }}
    >
      <MenuItem icon="📥" label={t('actionDownload')} onClick={run(onDownload)} />
      {canEnter && (
        <MenuItem icon="🏢" label={t('actionEnter')} onClick={run(onEnter)} />
      )}
      <MenuItem icon="👁" label={t('actionView')} onClick={run(onView)} />
      {canManage && (
        <MenuItem
          icon={status === 'ACTIVE' ? '⏸' : '▶'}
          label={status === 'ACTIVE' ? t('actionSuspend') : t('actionActivate')}
          onClick={run(onToggleStatus)}
        />
      )}
      {canManage && (
        <MenuItem
          icon="⏱"
          label={t('actionManageTrial')}
          onClick={run(onManageTrial)}
        />
      )}
      {canManage && (
        <>
          <div className="my-1 border-t border-line2" />
          <MenuItem
            icon="📋"
            label={t('actionDuplicate')}
            onClick={run(onDuplicate)}
          />
          <MenuItem
            icon="🗑️"
            label={t('actionDelete')}
            danger
            onClick={run(onDelete)}
          />
        </>
      )}
    </div>
  ) : null;

  return (
    <div className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn-ghost text-xs px-3 py-1.5 min-h-0"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {isEntering ? t('actionsEntering') : t('actionsMenu')}
      </button>
      {menu && createPortal(menu, document.body)}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-bg2 transition ${
        danger ? 'text-bad' : 'text-ink'
      }`}
    >
      <span className="w-5 text-center text-base leading-none">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// =====================================================
// DeleteTenantModal — Bloque 5 (2026-06-12)
// 3 opciones: Cancelar / Conservar historial / Eliminar todo
// =====================================================
function DeleteTenantModal({
  tenant,
  onClose,
  onConfirm,
}: {
  tenant: { id: string; brandName: string };
  onClose: () => void;
  onConfirm: (opts: { keepHistory: boolean }) => Promise<void> | void;
}) {
  const t = useTranslations('admin_tenants');
  const [mode, setMode] = useState<'choose' | 'confirmHard'>('choose');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  async function runSoft() {
    setBusy(true);
    try {
      await onConfirm({ keepHistory: true });
    } finally {
      setBusy(false);
    }
  }

  async function runHard() {
    if (confirmText.trim() !== '123') return;
    setBusy(true);
    try {
      await onConfirm({ keepHistory: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
        <div className="px-5 py-4 border-b border-line2 flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-bad-soft flex items-center justify-center text-bad shrink-0">
            🗑
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-base">{t('deleteTitle')}</div>
            <div className="text-xs text-mute mt-0.5">{tenant.brandName}</div>
          </div>
        </div>

        {mode === 'choose' && (
          <div className="px-5 py-4 space-y-3">
            <p className="text-sm text-ink">
              {t('deleteChoosePrompt')}
            </p>

            {/* Opción 1: Conservar historial (recomendada) */}
            <button
              type="button"
              onClick={runSoft}
              disabled={busy}
              className="w-full text-left rounded-lg border-2 border-brand bg-brand-soft/40 hover:bg-brand-soft/60 transition p-3 disabled:opacity-60"
            >
              <div className="flex items-start gap-2">
                <div className="text-lg">📚</div>
                <div className="flex-1">
                  <div className="font-semibold text-sm">
                    {t('deleteKeepTitle')}{' '}
                    <span className="text-[10px] uppercase tracking-wider bg-brand text-white px-1.5 py-0.5 rounded ml-1">
                      {t('deleteRecommended')}
                    </span>
                  </div>
                  <div className="text-xs text-mute mt-0.5 leading-snug">
                    {t('deleteKeepDesc')}
                  </div>
                </div>
              </div>
            </button>

            {/* Opción 2: Eliminar todo (peligrosa) */}
            <button
              type="button"
              onClick={() => setMode('confirmHard')}
              disabled={busy}
              className="w-full text-left rounded-lg border border-bad/30 bg-bad-soft/30 hover:bg-bad-soft/50 transition p-3 disabled:opacity-60"
            >
              <div className="flex items-start gap-2">
                <div className="text-lg">⚠️</div>
                <div className="flex-1">
                  <div className="font-semibold text-sm text-bad">
                    {t('deleteAllTitle')}
                  </div>
                  <div className="text-xs text-mute mt-0.5 leading-snug">
                    {t('deleteAllDesc')}
                  </div>
                </div>
              </div>
            </button>
          </div>
        )}

        {mode === 'confirmHard' && (
          <div className="px-5 py-4 space-y-3">
            <p className="text-sm text-ink">
              {t.rich('deleteHardWarning', {
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
            <p className="text-xs text-mute leading-relaxed">
              {t('deleteHardDetail')}
            </p>
            <div>
              <label className="block text-xs text-mute mb-1.5">
                {t.rich('deleteHardTypeLabel', {
                  token: (chunks) => (
                    <span className="font-mono font-semibold text-ink bg-bg2 px-1.5 py-0.5 rounded">
                      {chunks}
                    </span>
                  ),
                })}
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoFocus
                autoComplete="off"
                className="w-full bg-white border border-line2 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-bad"
                placeholder="123"
              />
            </div>
          </div>
        )}

        <div className="px-5 py-3 border-t border-line2 flex flex-col-reverse sm:flex-row items-stretch sm:items-center sm:justify-end gap-2">
          {mode === 'confirmHard' && (
            <button
              type="button"
              onClick={() => {
                setMode('choose');
                setConfirmText('');
              }}
              disabled={busy}
              className="btn-ghost text-sm min-h-[44px] disabled:opacity-50"
            >
              {t('back')}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn-ghost text-sm justify-center min-h-[44px] disabled:opacity-50"
          >
            {t('cancel')}
          </button>
          {mode === 'confirmHard' && (
            <button
              type="button"
              onClick={runHard}
              disabled={busy || confirmText.trim() !== '123'}
              className="text-sm font-semibold px-4 py-2 rounded-md bg-bad text-white hover:bg-bad/90 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
            >
              {busy ? t('deleting') : t('deleteAllConfirm')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
