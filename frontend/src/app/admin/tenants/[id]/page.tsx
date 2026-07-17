'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, getUser, startImpersonation } from '@/lib/api';
import { GrowBusinessCard } from '@/components/GrowBusinessCard';
import { ReferralAssignmentCard } from '@/components/ReferralAssignmentCard';
import { DeliveryAlertsCard } from '@/components/DeliveryAlertsCard';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import {
  formatPlanLabel,
  periodCadence,
  periodLabel,
  periodTotalUsd,
  planDisplayName,
  type PlanPeriodicity,
} from '@/lib/plan-format';
import { fetchBrandPlansByHost, type LandingPlan } from '@/lib/landing-plans';

// Precio del ciclo respetando los planes de la MARCA (Sellea: 80/799), con
// fallback al map genérico de Clubify (periodTotalUsd) solo si la marca no
// tiene ese plan configurado. Aísla el precio mostrado por marca.
const PERIOD_TO_BRAND_PLAN: Record<PlanPeriodicity, string> = {
  MENSUAL: 'mensual',
  TRIMESTRAL: 'trimestral',
  SEMESTRAL: 'semestral',
  ANUAL: 'anual',
};

export default function TenantDetail() {
  const tr = useTranslations('admin_tenants_id');
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [t, setT] = useState<any>(null);
  const [extraLocations, setExtraLocations] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);
  const [actioning, setActioning] = useState(false);
  // Bloque 3 (2026-06-12): editar brandName desde el admin. Patch
  // /tenants/:id soporta el campo desde antes — solo faltaba la UI.
  const [brandEditing, setBrandEditing] = useState(false);
  const [brandDraft, setBrandDraft] = useState('');
  const [brandSaving, setBrandSaving] = useState(false);
  // PDF 925: editar info del negocio (email/WhatsApp/slug) desde el detalle.
  const [infoEditing, setInfoEditing] = useState(false);
  const [infoDraft, setInfoDraft] = useState({ email: '', whatsappPhone: '', slug: '', customDomain: '' });
  const [infoSaving, setInfoSaving] = useState(false);
  // PDF123: dominio personalizado del negocio (vive en Storefront.customDomain).
  const [sfDomain, setSfDomain] = useState<string | null>(null);
  // Planes de la marca (por host) para mostrar el precio real (Sellea 80/799).
  const [brandPlans, setBrandPlans] = useState<LandingPlan[] | null>(null);
  // MARKETING ve la página pero sin acciones de billing/status — esos
  // endpoints son SUPER_ADMIN only y mostrarían "Permisos insuficientes"
  // al click. Esconderlos limpia UX en lugar de fallar fuerte.
  //
  // M5 (2026-06-04): MARKETING SÍ puede impersonar tenants (entrar al
  // panel como dueño) — el rol se usa para implementadores que
  // configuran cuentas. Por eso el botón "Entrar al negocio" gateamos
  // con `canImpersonate` en vez de `isSuperAdmin`.
  const me = getUser();
  const isSuperAdmin = me?.role === 'SUPER_ADMIN';
  const canImpersonate = isSuperAdmin || me?.role === 'MARKETING';

  async function load() {
    try {
      const data = await api<any>(`/tenants/${id}`);
      setT(data);
      setExtraLocations(data.maxLocationsOverride ?? '');
      // Dominio personalizado (SUPER_ADMIN puede leerlo por tenantId). Opcional.
      try {
        const sf = await api<{ customDomain: string | null }>(
          `/storefront?tenantId=${id}`,
        );
        setSfDomain(sf?.customDomain ?? null);
      } catch {
        /* storefront opcional — no bloquea la vista */
      }
    } catch (e: any) {
      toast(e.message || tr('errorLoadingTenant'), 'error');
    }
  }
  useEffect(() => {
    load();
  }, [id]);

  // Precios reales de la marca (por host). Clubify/dev → null (usa map genérico).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    fetchBrandPlansByHost(window.location.host)
      .then(setBrandPlans)
      .catch(() => setBrandPlans(null));
  }, []);

  async function saveBrandName() {
    const trimmed = brandDraft.trim();
    if (!trimmed) {
      toast(tr('nameCannotBeEmpty'), 'error');
      return;
    }
    if (trimmed.length > 80) {
      toast(tr('max80Chars'), 'error');
      return;
    }
    if (trimmed === t?.brandName) {
      setBrandEditing(false);
      return;
    }
    setBrandSaving(true);
    try {
      await api(`/tenants/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ brandName: trimmed }),
      });
      toast(tr('nameUpdated'), 'success');
      setBrandEditing(false);
      await load();
    } catch (e: any) {
      toast(e.message || tr('couldNotUpdate'), 'error');
    } finally {
      setBrandSaving(false);
    }
  }

  // Componente del selector de modo de reparto está al final del archivo.

  // PDF 925: slug "amigable" derivado del nombre del negocio (cliente).
  function slugifyClient(s: string): string {
    return (
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 40) || ''
    );
  }

  function startInfoEdit() {
    setInfoDraft({
      email: t?.email ?? '',
      whatsappPhone: t?.whatsappPhone ?? '',
      slug: t?.slug ?? '',
      customDomain: sfDomain ?? '',
    });
    setInfoEditing(true);
  }

  async function saveInfo() {
    const payload: Record<string, string> = {};
    const email = infoDraft.email.trim();
    const whatsappPhone = infoDraft.whatsappPhone.trim();
    const slug = infoDraft.slug.trim();
    if (email && email !== (t?.email ?? '')) payload.email = email;
    if (whatsappPhone !== (t?.whatsappPhone ?? '')) payload.whatsappPhone = whatsappPhone;
    if (slug && slug !== (t?.slug ?? '')) payload.slug = slug;
    // Dominio personalizado → Storefront.customDomain (PDF123). Se guarda por el
    // endpoint de storefront con ?tenantId (SUPER_ADMIN puede cross-tenant).
    const domain = infoDraft.customDomain.trim().toLowerCase();
    const domainChanged = domain !== (sfDomain ?? '');
    if (Object.keys(payload).length === 0 && !domainChanged) {
      setInfoEditing(false);
      return;
    }
    setInfoSaving(true);
    try {
      if (Object.keys(payload).length > 0) {
        await api(`/tenants/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      }
      if (domainChanged) {
        await api(`/storefront?tenantId=${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ customDomain: domain || null }),
        });
      }
      toast(tr('infoUpdated'), 'success');
      setInfoEditing(false);
      await load();
    } catch (e: any) {
      toast(e.message || tr('couldNotUpdate'), 'error');
    } finally {
      setInfoSaving(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      await api(`/tenants/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          maxLocationsOverride: extraLocations === '' ? null : Number(extraLocations),
        }),
      });
      await load();
      toast(tr('changesSaved'), 'success');
    } catch (e: any) {
      toast(e.message || tr('couldNotSave'), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(status: string) {
    if (
      status === 'SUSPENDED' &&
      !confirm(tr('confirmSuspend', { name: t?.brandName ?? tr('thisBusiness') }))
    ) {
      return;
    }
    setActioning(true);
    try {
      await api(`/tenants/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await load();
      toast(
        status === 'ACTIVE'
          ? tr('businessActivated')
          : status === 'SUSPENDED'
          ? tr('businessSuspended')
          : tr('statusUpdated'),
        'success',
      );
    } catch (e: any) {
      toast(e.message || tr('couldNotChangeStatus'), 'error');
    } finally {
      setActioning(false);
    }
  }

  async function extendTrial(days: number) {
    setActioning(true);
    try {
      await api(`/tenants/${id}/extend-trial`, {
        method: 'POST',
        body: JSON.stringify({ days }),
      });
      await load();
      toast(tr('trialExtended', { days }), 'success');
    } catch (e: any) {
      toast(e.message || tr('couldNotExtendTrial'), 'error');
    } finally {
      setActioning(false);
    }
  }

  /**
   * Convierte el tenant a cliente pagante (ACTIVE + currentPeriodEnd
   * +30d + sin trialEndsAt). Útil cuando paga por fuera de Hotmart.
   * Automáticamente dispara backfill de comisión si tiene asignación
   * a INFLUENCER/AMBASSADOR.
   */
  async function convertToPaying() {
    if (
      !confirm(tr('confirmConvertToPaying', { name: t?.brandName ?? tr('thisBusiness') }))
    ) {
      return;
    }
    setActioning(true);
    try {
      await api(`/tenants/${id}/convert-to-paying`, {
        method: 'POST',
        body: JSON.stringify({ periodDays: 30 }),
      });
      await load();
      toast(tr('businessConvertedToPaying'), 'success');
    } catch (e: any) {
      toast(e.message || tr('couldNotConvert'), 'error');
    } finally {
      setActioning(false);
    }
  }

  if (!t) {
    return (
      <div className="space-y-3">
        <div className="h-10 bg-bg2 rounded animate-shimmer" />
        <div className="h-32 bg-bg2 rounded animate-shimmer" />
        <div className="h-48 bg-bg2 rounded animate-shimmer" />
      </div>
    );
  }

  const daysLeft = t.trialEndsAt
    ? Math.max(
        0,
        Math.ceil((new Date(t.trialEndsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
      )
    : null;

  return (
    <div className="max-w-4xl">
      <div className="page-head">
        {brandEditing ? (
          <div className="flex items-center gap-2 flex-wrap">
            <input
              autoFocus
              className="input text-2xl font-bold"
              style={{ minWidth: 260 }}
              value={brandDraft}
              maxLength={80}
              onChange={(e) => setBrandDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveBrandName();
                if (e.key === 'Escape') setBrandEditing(false);
              }}
            />
            <button
              type="button"
              className="btn-primary text-sm"
              disabled={brandSaving}
              onClick={saveBrandName}
            >
              {brandSaving ? tr('saving') : tr('save')}
            </button>
            <button
              type="button"
              className="btn-ghost text-sm"
              disabled={brandSaving}
              onClick={() => setBrandEditing(false)}
            >
              {tr('cancel')}
            </button>
          </div>
        ) : (
          <h1 className="page-title flex items-center gap-2">
            {t.brandName} <span className="page-crumb">{tr('crumbBusinesses')}</span>
            {isSuperAdmin && (
              <button
                type="button"
                className="text-mute hover:text-ink"
                title={tr('editBusinessName')}
                onClick={() => {
                  setBrandDraft(t.brandName ?? '');
                  setBrandEditing(true);
                }}
              >
                <Icon name="edit" size={16} />
              </button>
            )}
          </h1>
        )}
        <button className="btn-ghost" onClick={() => router.push('/admin/tenants')}>
          ← {tr('back')}
        </button>
      </div>

      {/* Estado y trial */}
      <div className="card card-pad mb-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wider text-mute font-semibold">
              {tr('currentStatus')}
            </div>
            <div className="mt-2 flex items-center gap-3 flex-wrap">
              <span
                className={`badge ${
                  t.status === 'ACTIVE'
                    ? 'badge-ok'
                    : t.status === 'TRIAL'
                    ? 'badge-warn'
                    : 'badge-bad'
                }`}
              >
                {t.status}
              </span>
              {daysLeft !== null && (
                <span className="text-sm text-mute">
                  {tr('trialLabel')} <strong className="text-ink">{tr('daysRemaining', { days: daysLeft })}</strong>
                  {t.trialEndsAt && (
                    <>
                      {' '}
                      ({tr('expires')}{' '}
                      {new Date(t.trialEndsAt).toLocaleDateString('es-CO', {
                        day: 'numeric',
                        month: 'short',
                      })}
                      )
                    </>
                  )}
                </span>
              )}
              {t.suspendedAt && (
                <span className="text-xs text-bad">
                  {tr('suspendedOn')}{' '}
                  {new Date(t.suspendedAt).toLocaleDateString('es-CO', {
                    day: 'numeric',
                    month: 'short',
                  })}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canImpersonate && (
              <button
                className="btn-primary text-sm"
                disabled={actioning || t.status === 'SUSPENDED'}
                onClick={async () => {
                  setActioning(true);
                  try {
                    const res = await api(`/tenants/${id}/impersonate`, { method: 'POST' });
                    startImpersonation({
                      accessToken: res.accessToken,
                      user: res.user,
                      tenant: {
                        id: res.tenant.id,
                        brandName: res.tenant.brandName,
                        // Seed anti-flash del panel /app: branding de la marca
                        // blanca del negocio (color/logo/nombre) → el panel
                        // pinta la identidad real desde el primer frame.
                        primaryColor: res.tenant.primaryColor ?? undefined,
                        slug: res.tenant.slug,
                        whiteLabelSlug: res.tenant.whiteLabelSlug ?? null,
                        whiteLabelName: res.tenant.whiteLabelName ?? null,
                        logoUrl: res.tenant.logoUrl ?? null,
                        iconUrl: res.tenant.iconUrl ?? null,
                      },
                    });
                    toast(tr('enteringBusiness', { name: res.tenant.brandName }), 'success');
                    router.push('/app');
                  } catch (e: any) {
                    toast(e.message || tr('couldNotEnter'), 'error');
                    setActioning(false);
                  }
                }}
                title={t.status === 'SUSPENDED' ? tr('reactivateToEnter') : tr('enterAsOwner')}
              >
                <Icon name="arrow-right" /> {tr('enterBusiness')}
              </button>
            )}
            {isSuperAdmin && t.status === 'TRIAL' && (
              <>
                {/* PDF 752 #5: los negocios de MARCA BLANCA no reciben prueba/trial.
                    Se activan con créditos (Marcar pagado/activo). Solo Clubify
                    (o marca ilimitada/sin gate) ve los botones de +días. */}
                {!t.brandCredits?.isWhiteLabel && (
                  <>
                    <button
                      className="btn-ghost text-sm"
                      disabled={actioning}
                      onClick={() => extendTrial(7)}
                    >
                      {tr('plus7Days')}
                    </button>
                    <button
                      className="btn-ghost text-sm"
                      disabled={actioning}
                      onClick={() => extendTrial(30)}
                    >
                      {tr('plus30Days')}
                    </button>
                  </>
                )}
                <button
                  className="btn-primary text-sm"
                  disabled={
                    actioning ||
                    (t.brandCredits?.isWhiteLabel && !t.brandCredits?.canActivate)
                  }
                  onClick={convertToPaying}
                  title={
                    t.brandCredits?.isWhiteLabel && !t.brandCredits?.canActivate
                      ? tr('needCreditsToActivate')
                      : t.brandCredits?.isWhiteLabel
                        ? tr('markAsPaidConsumesCredit')
                        : tr('markAsPaidTitle')
                  }
                >
                  {tr('markAsPaid')}
                </button>
              </>
            )}
            {/* Reactivar suspendido con +14 días = trial: solo Clubify. Para
                marca blanca, la reactivación va por "Marcar como activo" (crédito). */}
            {isSuperAdmin &&
              t.status === 'SUSPENDED' &&
              !t.brandCredits?.isWhiteLabel && (
                <button
                  className="btn-primary text-sm"
                  disabled={actioning}
                  onClick={() => extendTrial(14)}
                >
                  {tr('reactivatePlus14')}
                </button>
              )}
            {isSuperAdmin && (t.status === 'ACTIVE' ? (
              <button
                className="btn-ghost text-sm text-bad"
                disabled={actioning}
                onClick={() => setStatus('SUSPENDED')}
              >
                {tr('suspend')}
              </button>
            ) : (
              <button
                className="btn-primary text-sm"
                disabled={
                  actioning ||
                  (t.brandCredits?.isWhiteLabel && !t.brandCredits?.canActivate)
                }
                onClick={() => setStatus('ACTIVE')}
                title={
                  t.brandCredits?.isWhiteLabel && !t.brandCredits?.canActivate
                    ? tr('needCreditsToActivate')
                    : t.brandCredits?.isWhiteLabel
                      ? tr('markAsActiveConsumesCredit')
                      : undefined
                }
              >
                {tr('markAsActive')}
              </button>
            ))}
            {/* Demo lock toggle — convierte el tenant en cuenta demo de
                solo-lectura. Cualquier no-SUPER_ADMIN que entre solo puede
                ver/navegar. Útil para que los embajadores muestren a prospects. */}
            {isSuperAdmin && (<button
              className={`text-sm ${t.isLocked ? 'btn-primary' : 'btn-ghost'}`}
              disabled={actioning}
              onClick={async () => {
                const wantLock = !t.isLocked;
                if (wantLock) {
                  if (!confirm(tr('confirmDemoLock')))
                    return;
                }
                setActioning(true);
                try {
                  await api(`/tenants/${id}/lock`, {
                    method: 'PATCH',
                    body: JSON.stringify({ locked: wantLock }),
                  });
                  toast(
                    wantLock ? tr('accountLockedAsDemo') : tr('demoUnlocked'),
                    'success',
                  );
                  await load();
                } catch (e: any) {
                  toast(e.message || tr('couldNotChangeLock'), 'error');
                } finally {
                  setActioning(false);
                }
              }}
              title={
                t.isLocked
                  ? tr('unlockDemoTitle')
                  : tr('lockDemoTitle')
              }
            >
              {t.isLocked ? tr('unlockDemo') : tr('lockAsDemo')}
            </button>)}
          </div>
        </div>
        {t.isLocked && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 mt-3 text-xs text-amber-900">
            <strong>{tr('demoModeActiveTitle')}</strong> {tr('demoModeActiveBody')}
          </div>
        )}
      </div>

      {/* Historial de Trial — audit log de adjust-trial. Solo SUPER_ADMIN
          ve esto (el endpoint detrás también lo gatea). */}
      {isSuperAdmin && <TrialHistoryCard tenantId={t.id} />}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-4">
        <div className="kpi">
          <div className="kpi-lbl">{tr('kpiPlan')}</div>
          <div className="kpi-val text-brand">
            {planDisplayName(
              t.plan?.name,
              t.planPeriodicity as PlanPeriodicity | null,
            )}
          </div>
          <div className="kpi-sub">
            🗓️ {periodLabel(t.planPeriodicity as PlanPeriodicity | null)} ·{' '}
            {(() => {
              const period = (t.planPeriodicity as PlanPeriodicity | null) ?? 'MENSUAL';
              // Precio REAL de la marca (Sellea 80/799) si está configurado;
              // sino el map genérico de Clubify.
              const brandPrice = brandPlans?.find(
                (p) => p.id === PERIOD_TO_BRAND_PLAN[period],
              )?.price;
              return brandPrice && brandPrice > 0
                ? brandPrice
                : periodTotalUsd(period, Number(t.plan?.priceMonthly ?? 0));
            })()}{' '}
            USD{periodCadence(t.planPeriodicity as PlanPeriodicity | null)}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-lbl">{tr('kpiCards')}</div>
          <div className="kpi-val">{t._count?.cards ?? 0}</div>
        </div>
        <div className="kpi">
          <div className="kpi-lbl">{tr('kpiCustomers')}</div>
          <div className="kpi-val">{t._count?.customers ?? 0}</div>
        </div>
        <div className="kpi">
          <div className="kpi-lbl">{tr('kpiPasses')}</div>
          <div className="kpi-val">{t._count?.passes ?? 0}</div>
        </div>
      </div>

      {/* Info */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card card-pad">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold m-0">{tr('information')}</h2>
            {isSuperAdmin && !infoEditing && (
              <button
                className="text-xs text-brand hover:underline"
                onClick={startInfoEdit}
              >
                ✏️ {tr('infoEdit')}
              </button>
            )}
          </div>

          {!infoEditing ? (
            <>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-mute">{tr('email')}</dt>
                  <dd className="font-medium">{t.email}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-mute">{tr('whatsapp')}</dt>
                  <dd className="font-medium">{t.whatsappPhone || '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-mute">{tr('slug')}</dt>
                  <dd className="font-mono text-xs">{t.slug}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-mute">Dominio</dt>
                  <dd className="font-medium">
                    {sfDomain ? (
                      <a
                        href={`https://${sfDomain}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand hover:underline font-mono text-xs"
                      >
                        {sfDomain}
                      </a>
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-mute">{tr('created')}</dt>
                  <dd className="font-medium">
                    {new Date(t.createdAt).toLocaleDateString('es-CO', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 pt-3 border-t border-line">
                <Link
                  href={`/m/${t.slug}`}
                  target="_blank"
                  className="text-sm text-brand hover:underline"
                >
                  {tr('openStorefront')}
                </Link>
              </div>
            </>
          ) : (
            <div className="mt-3 space-y-3 text-sm">
              <div>
                <label className="label">{tr('email')}</label>
                <input
                  className="input"
                  type="email"
                  value={infoDraft.email}
                  onChange={(e) =>
                    setInfoDraft((d) => ({ ...d, email: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="label">{tr('whatsapp')}</label>
                <input
                  className="input"
                  value={infoDraft.whatsappPhone}
                  placeholder="+57 300 000 0000"
                  onChange={(e) =>
                    setInfoDraft((d) => ({ ...d, whatsappPhone: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="label flex items-center justify-between">
                  <span>{tr('slug')}</span>
                  <button
                    type="button"
                    className="text-[11px] text-brand hover:underline font-normal"
                    onClick={() =>
                      setInfoDraft((d) => ({
                        ...d,
                        slug: slugifyClient(t.brandName || ''),
                      }))
                    }
                  >
                    {tr('slugFromName')}
                  </button>
                </label>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-mute whitespace-nowrap">/m/</span>
                  <input
                    className="input font-mono text-xs"
                    value={infoDraft.slug}
                    onChange={(e) =>
                      setInfoDraft((d) => ({
                        ...d,
                        slug: slugifyClient(e.target.value),
                      }))
                    }
                  />
                </div>
                <p className="text-[11px] text-mute mt-1 leading-snug">
                  {tr('slugHint')}
                </p>
              </div>
              <div>
                <label className="label">Dominio personalizado</label>
                <input
                  className="input font-mono text-xs"
                  value={infoDraft.customDomain}
                  placeholder="birrialeon.com"
                  onChange={(e) =>
                    setInfoDraft((d) => ({ ...d, customDomain: e.target.value }))
                  }
                />
                <p className="text-[11px] text-mute mt-1 leading-snug">
                  Dominio propio del negocio (ej: birrialeon.com). Debe apuntar por
                  DNS a Vercel y agregarse al proyecto. Vacío = usa el enlace /m/ por
                  defecto.
                </p>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  className="btn-primary text-sm"
                  disabled={infoSaving}
                  onClick={saveInfo}
                >
                  {infoSaving ? tr('saving') : tr('save')}
                </button>
                <button
                  className="btn-ghost text-sm"
                  disabled={infoSaving}
                  onClick={() => setInfoEditing(false)}
                >
                  {tr('cancel')}
                </button>
              </div>
            </div>
          )}
        </div>

        <PlanCurrentCard tenant={t} isSuperAdmin={isSuperAdmin} onChange={load} />

        {isSuperAdmin && (
          <div className="card card-pad">
            <h2 className="text-base font-semibold m-0">{tr('locationsOverride')}</h2>
            <p className="mt-1 text-sm text-mute">
              {tr.rich('planAllowsLocations', {
                count: t.plan?.maxLocations,
                strong: (chunks) => <strong className="text-ink">{chunks}</strong>,
              })}
            </p>
            <div className="mt-4 flex items-end gap-3">
              <div className="flex-1">
                <label className="label">{tr('override')}</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  placeholder={tr('defaultPlaceholder', { count: t.plan?.maxLocations })}
                  value={extraLocations}
                  onChange={(e) =>
                    setExtraLocations(e.target.value === '' ? '' : Number(e.target.value))
                  }
                />
              </div>
              <button className="btn-primary" disabled={saving} onClick={save}>
                {saving ? tr('saving') : tr('save')}
              </button>
            </div>
          </div>
        )}

        {/* HOTFIX 2026-06-05 (bug N): estos 3 cards consumen endpoints
            que el backend gatea como SUPER_ADMIN-only. Antes se mostraban
            a MARKETING y al click recibía 403 — UX rota. Ahora se gatean
            con isSuperAdmin como el resto de cards admin. */}
        {/* PDF 2026-06-30: el card de Grow Business · SMS solo aparece si la
            marca del negocio tiene el módulo GROW_BUSINESS_SMS habilitado
            (Módulos en Master Admin). enabledModules null = Clubify (todo on). */}
        {isSuperAdmin &&
          (t.enabledModules
            ? t.enabledModules.includes('GROW_BUSINESS_SMS')
            : true) && (
            <GrowBusinessCard tenantId={t.id} planName={t.plan?.name ?? null} />
          )}

        {/* Panels de referidos: solo si la marca del negocio tiene el módulo
            REFERRALS habilitado. enabledModules null = Clubify (todo on). */}
        {isSuperAdmin &&
          (t.enabledModules
            ? t.enabledModules.includes('REFERRALS')
            : true) && (
            <>
              <ReferralAssignmentCard tenantId={t.id} />
              {/* PDF 925 #2: el modo de reparto solo aplica si hay un vendedor
                  en la cadena (define cómo se le paga). Sin vendedor, se oculta. */}
              {t.hasVendor && <CommissionModeCard tenant={t} onSaved={load} />}
            </>
          )}

        {/* #23 (2026-06-16): las secciones avanzadas se agrupan en acordeones
            colapsados para reducir el scroll. Info/Plan/Referidos quedan
            visibles arriba; el resto se despliega bajo demanda. */}
        {isSuperAdmin && (
          <CollapsibleSection title={tr('sectionAlerts')} className="md:col-span-2">
            <ReviewAlertsAccountCard tenant={t} onSaved={load} />
            <BillingAlertsAccountCard tenant={t} onSaved={load} />
            <DeliveryAlertsAccountCard tenant={t} onSaved={load} />
            {/* #14 (2026-06-17): config completa de alertas SMS de domicilio
                (activar / teléfonos / eventos), movida desde /app/settings. */}
            <DeliveryAlertsCard
              tenant={t}
              savePath={`/tenants/${t.id}`}
              testPath={`/tenants/${t.id}/delivery-alerts/test`}
              onSaved={load}
            />
            <ReviewAlertsLogsCard tenantId={t.id} />
            <BillingNotificationsCard tenant={t} />
            <WhatsappMessagingCard tenant={t} onSaved={load} />
          </CollapsibleSection>
        )}

        {isSuperAdmin && (
          <CollapsibleSection title={tr('sectionBilling')} className="md:col-span-2">
            <BillingCard tenant={t} onChange={load} />
            {/* Simulador Hotmart (QA): Hotmart es SOLO de Clubify. En negocios de
                marcas blancas (Stripe/manual) no aplica y solo confunde → se
                oculta. El ciclo de suscripción de esas marcas se gestiona desde
                Master Admin → Marcas → Automatizaciones. */}
            {!t.brandCredits?.isWhiteLabel && (
              <HotmartSimulatorCard tenant={t} onChange={load} />
            )}
          </CollapsibleSection>
        )}

        {isSuperAdmin && (
          <CollapsibleSection title={tr('sectionIntegrations')} className="md:col-span-2">
            <AcademyTogglesCard tenant={t} onSaved={load} />
            <WalletsGlobalRefreshCard tenantId={t.id} />
          </CollapsibleSection>
        )}
      </div>
    </div>
  );
}

/**
 * Selector "Modo de reparto de comisión" (Fase 3/12 overhaul comisiones).
 * Define si la comisión del vendedor SALE del upline (no sube el costo) o es
 * un costo ADICIONAL de la empresa. Muestra un ejemplo numérico en vivo.
 * El modo se congela en cada comisión al generarla (no altera históricos).
 */
function CommissionModeCard({
  tenant,
  onSaved,
}: {
  tenant: any;
  onSaved: () => void;
}) {
  type Mode = 'DISCOUNT_FROM_INFLUENCER' | 'ADDITIONAL_COMPANY_COMMISSION';
  const initial: Mode =
    tenant?.commissionDistributionMode === 'ADDITIONAL_COMPANY_COMMISSION'
      ? 'ADDITIONAL_COMPANY_COMMISSION'
      : 'DISCOUNT_FROM_INFLUENCER';
  const [mode, setMode] = useState<Mode>(initial);
  const [saving, setSaving] = useState(false);
  const dirty = mode !== initial;

  // Ejemplo ilustrativo en vivo (base 150, upline 25%, vendedor 10%).
  const base = 150;
  const uplinePct = 25;
  const vendorPct = 10;
  const additional = mode === 'ADDITIONAL_COMPANY_COMMISSION';
  const uplineEffective = additional ? uplinePct : uplinePct - vendorPct;
  const totalPct = additional ? uplinePct + vendorPct : uplinePct;
  const money = (pct: number) => `$${((base * pct) / 100).toFixed(2)}`;

  async function save() {
    setSaving(true);
    try {
      await api(`/tenants/${tenant.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ commissionDistributionMode: mode }),
      });
      toast('Modo de reparto guardado', 'success');
      onSaved();
    } catch (e: any) {
      toast(e?.message || 'No se pudo guardar', 'error');
    } finally {
      setSaving(false);
    }
  }

  const opt = (
    value: Mode,
    title: string,
    desc: string,
  ) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      className={`text-left rounded-lg border-2 p-3 transition ${
        mode === value
          ? 'border-brand bg-brand-soft'
          : 'border-line hover:border-brand/40'
      }`}
    >
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-[11px] text-mute mt-1 leading-snug">{desc}</div>
    </button>
  );

  return (
    <div className="card card-pad">
      <h3 className="text-base font-semibold m-0">Modo de reparto de comisión</h3>
      <p className="text-xs text-mute mt-1 leading-relaxed">
        Define cómo se paga al vendedor cuando hay uno en la cadena. El modo se
        congela en cada comisión al generarla — cambiarlo no altera comisiones
        ya creadas, solo las futuras.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
        {opt(
          'DISCOUNT_FROM_INFLUENCER',
          'Descontar del upline',
          'El vendedor se paga con parte de la comisión del influencer/embajador. El costo total NO sube.',
        )}
        {opt(
          'ADDITIONAL_COMPANY_COMMISSION',
          'Comisión adicional empresa',
          'El vendedor es un costo adicional que asume la empresa. El upline mantiene su % completo y el total sube.',
        )}
      </div>

      {/* Ejemplo numérico en vivo */}
      <div className="mt-3 rounded-lg bg-bg2/60 border border-line p-3 text-sm">
        <div className="text-[11px] uppercase tracking-wide text-mute font-semibold mb-1.5">
          Ejemplo · base {`$${base.toFixed(2)}`} · upline {uplinePct}% · vendedor {vendorPct}%
        </div>
        <div className="flex justify-between">
          <span>Upline recibe</span>
          <span className="font-medium">{uplineEffective}% · {money(uplineEffective)}</span>
        </div>
        <div className="flex justify-between">
          <span>Vendedor recibe</span>
          <span className="font-medium">{vendorPct}% · {money(vendorPct)}</span>
        </div>
        <div className="flex justify-between border-t border-line mt-1.5 pt-1.5 font-semibold">
          <span>Costo total</span>
          <span className={additional ? 'text-warn-ink' : 'text-ok'}>
            {totalPct}% · {money(totalPct)}
          </span>
        </div>
      </div>

      <button
        className="btn-primary mt-3"
        disabled={saving || !dirty}
        onClick={save}
      >
        {saving ? 'Guardando…' : 'Guardar modo'}
      </button>
    </div>
  );
}

/**
 * #23 (2026-06-16): sección colapsable (acordeón) para reducir el scroll en
 * el detalle del negocio. Header clickeable + contenido desplegable.
 * Colapsada por default. Los cards hijos conservan su chrome.
 */
function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-lg bg-bg2 hover:bg-line transition font-semibold text-sm select-none"
        aria-expanded={open}
      >
        <span>{title}</span>
        <span
          className={`text-mute transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          ▾
        </span>
      </button>
      {open && <div className="mt-3 space-y-4">{children}</div>}
    </div>
  );
}

// ============================================================
//   Refresh global wallets — Bloque 11/D (2026-06-12)
//   Botón que encola un push update para TODOS los passes
//   activos del tenant. Útil tras cambios de branding.
// ============================================================

function WalletsGlobalRefreshCard({ tenantId }: { tenantId: string }) {
  const t = useTranslations('admin_tenants_id');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    total: number;
    enqueued: number;
  } | null>(null);

  async function trigger() {
    if (!confirm(t('confirmRefreshWallets')))
      return;
    setRunning(true);
    setResult(null);
    try {
      const res = await api<{ total: number; enqueued: number }>(
        `/passes/refresh-all/${tenantId}`,
        { method: 'POST' },
      );
      setResult(res);
      toast(
        t('walletsEnqueuedToast', { enqueued: res.enqueued, total: res.total }),
        'success',
      );
    } catch (e: any) {
      toast(e.message || t('couldNotTriggerRefresh'), 'error');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="card card-pad">
      <h2 className="text-base font-semibold m-0 flex items-center gap-2">
        {t('walletsRefreshTitle')}
      </h2>
      <p className="text-xs text-mute mt-1 leading-relaxed">
        {t('walletsRefreshDesc')}
      </p>
      {result && (
        <div className="mt-3 text-sm rounded-lg px-3 py-2 bg-ok-soft text-ok-ink">
          {t('walletsEnqueuedResult', { enqueued: result.enqueued, total: result.total })}
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={trigger}
          disabled={running}
          className="btn-primary text-sm"
        >
          {running ? t('enqueuing') : t('refreshAllWallets')}
        </button>
      </div>
    </div>
  );
}

// ============================================================
//   Mensajería WhatsApp del negocio (Bloque 8 — 2026-06-12)
//   Movido desde /app/settings: el cliente final ya no la edita,
//   solo SUPER_ADMIN desde acá.
// ============================================================

function WhatsappMessagingCard({
  tenant,
  onSaved,
}: {
  tenant: any;
  onSaved: () => void;
}) {
  const t = useTranslations('admin_tenants_id');
  const [form, setForm] = useState({
    whatsappPhone: tenant.whatsappPhone ?? '',
    whatsappOrdersPhone: tenant.whatsappOrdersPhone ?? '',
    whatsappDeliveryPhone: tenant.whatsappDeliveryPhone ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      await api(`/tenants/${tenant.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          whatsappPhone: form.whatsappPhone.trim() || '',
          whatsappOrdersPhone: form.whatsappOrdersPhone.trim() || '',
          whatsappDeliveryPhone: form.whatsappDeliveryPhone.trim() || '',
        }),
      });
      setMsg({ ok: true, text: t('numbersSaved') });
      onSaved();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message || t('couldNotSave') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card card-pad">
      <h2 className="text-base font-semibold m-0 flex items-center gap-2">
        {t('whatsappMessagingTitle')}
      </h2>
      <p className="text-xs text-mute mt-1 leading-relaxed">
        {t('whatsappMessagingDesc')}
      </p>

      <form onSubmit={save} className="mt-4 grid gap-3">
        <div>
          <label className="label">{t('mainBusinessWhatsapp')}</label>
          <input
            className="input"
            placeholder="+57 300 000 0000"
            value={form.whatsappPhone}
            onChange={(e) =>
              setForm({ ...form, whatsappPhone: e.target.value })
            }
          />
        </div>

        <div>
          <label className="label">{t('orderToBusiness')}</label>
          <input
            className="input"
            placeholder="+57 300 000 0000"
            value={form.whatsappOrdersPhone}
            onChange={(e) =>
              setForm({ ...form, whatsappOrdersPhone: e.target.value })
            }
          />
          <p className="text-[11px] text-mute mt-1 leading-relaxed">
            {t('orderToBusinessHelp')}
          </p>
        </div>

        <div>
          <label className="label">{t('businessToDelivery')}</label>
          <input
            className="input"
            placeholder="+57 300 000 0000"
            value={form.whatsappDeliveryPhone}
            onChange={(e) =>
              setForm({ ...form, whatsappDeliveryPhone: e.target.value })
            }
          />
          <p className="text-[11px] text-mute mt-1 leading-relaxed">
            {t('businessToDeliveryHelp')}
          </p>
        </div>

        {msg && (
          <div
            className={`text-sm rounded-lg px-3 py-2 ${
              msg.ok ? 'bg-ok-soft text-ok-ink' : 'bg-bad-soft text-bad'
            }`}
          >
            {msg.text}
          </div>
        )}

        <div className="flex justify-end">
          <button type="submit" disabled={saving} className="btn-primary text-sm">
            {saving ? t('saving') : t('saveNumbers')}
          </button>
        </div>
      </form>
    </div>
  );
}

// ============================================================
//   Tutoriales / Academia toggles (Bloque 2 — 2026-06-12)
//   Controla la visibilidad de los links externos a
//   academy.soyclubify.lat en el sidebar del cliente.
// ============================================================

function AcademyTogglesCard({
  tenant,
  onSaved,
}: {
  tenant: any;
  onSaved: () => void;
}) {
  const t = useTranslations('admin_tenants_id');
  const [tutorials, setTutorials] = useState<boolean>(
    tenant.tutorialsEnabled ?? true,
  );
  const [academy, setAcademy] = useState<boolean>(
    tenant.academyEnabled ?? true,
  );
  const [reservations, setReservations] = useState<boolean>(
    tenant.reservationsEnabled ?? false,
  );
  const [serviceReservations, setServiceReservations] = useState<boolean>(
    tenant.serviceReservationsEnabled ?? false,
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      await api(`/tenants/${tenant.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          tutorialsEnabled: tutorials,
          academyEnabled: academy,
          reservationsEnabled: reservations,
          serviceReservationsEnabled: serviceReservations,
        }),
      });
      setMsg({ ok: true, text: t('changesSaved') });
      onSaved();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message || t('couldNotSave') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card card-pad">
      <h2 className="text-base font-semibold m-0 flex items-center gap-2">
        {t('tenantModulesTitle')}
      </h2>
      <p className="text-xs text-mute mt-1 leading-relaxed">
        {t('tenantModulesDesc')}
      </p>

      <div className="mt-4 space-y-3">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={tutorials}
            onChange={(e) => setTutorials(e.target.checked)}
            className="mt-1"
          />
          <div>
            <div className="text-sm font-semibold">{t('showTutorials')}</div>
            <div className="text-xs text-mute leading-snug">
              {t('showTutorialsHelp')}
            </div>
          </div>
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={academy}
            onChange={(e) => setAcademy(e.target.checked)}
            className="mt-1"
          />
          <div>
            <div className="text-sm font-semibold">{t('showAcademy')}</div>
            <div className="text-xs text-mute leading-snug">
              {t('showAcademyHelp')}
            </div>
          </div>
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={reservations}
            onChange={(e) => setReservations(e.target.checked)}
            className="mt-1"
          />
          <div>
            <div className="text-sm font-semibold">{t('enableReservations')}</div>
            <div className="text-xs text-mute leading-snug">
              {t.rich('enableReservationsHelp', {
                code: (chunks) => <code>{chunks}</code>,
              })}
            </div>
          </div>
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={serviceReservations}
            onChange={(e) => setServiceReservations(e.target.checked)}
            className="mt-1"
          />
          <div>
            <div className="text-sm font-semibold">Reservas de servicios (citas)</div>
            <div className="text-xs text-mute leading-snug">
              Habilita el agendamiento de servicios (barbería, spa, clínica…) para
              este negocio: catálogo de servicios, horarios y agenda de citas.
            </div>
          </div>
        </label>
      </div>

      {msg && (
        <div
          className={`mt-3 text-sm rounded-lg px-3 py-2 ${
            msg.ok ? 'bg-ok-soft text-ok-ink' : 'bg-bad-soft text-bad'
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="btn-primary text-sm"
        >
          {saving ? t('saving') : t('save')}
        </button>
      </div>
    </div>
  );
}

// ============================================================
//   Historial de Trial — audit log de tenant.trial_adjusted
//   (2026-06-07). Renderiza la timeline de modificaciones que
//   hace el SUPER_ADMIN desde el modal "Gestionar Trial".
// ============================================================

type TrialHistoryEntry = {
  id: string;
  createdAt: string;
  actor: { id: string; fullName: string; email: string } | null;
  metadata: {
    brandName?: string;
    daysDelta?: number;
    previousTrialEndsAt?: string | null;
    newTrialEndsAt?: string | null;
    previousStatus?: string;
    newStatus?: string;
    observation?: string | null;
  };
};

function TrialHistoryCard({ tenantId }: { tenantId: string }) {
  const t = useTranslations('admin_tenants_id');
  const [rows, setRows] = useState<TrialHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await api<TrialHistoryEntry[]>(
          `/tenants/${tenantId}/trial-history`,
        );
        if (!cancelled) setRows(data);
      } catch {
        // 403 o 404 → simplemente no renderizamos contenido,
        // el card queda con el empty state.
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return (
    <div className="card card-pad mb-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-base font-semibold m-0">{t('trialHistoryTitle')}</h2>
        <span className="text-xs text-mute">
          {loading ? '…' : t('movementsCount', { count: rows.length })}
        </span>
      </div>

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 bg-bg2 rounded animate-shimmer" />
          ))}
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="text-center py-6 text-sm text-mute">
          <div className="text-2xl mb-1">📭</div>
          {t('noTrialModifications')}
          <div className="text-xs mt-1">
            {t('noTrialModificationsHelp')}
          </div>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <ul className="divide-y divide-line2">
          {rows.map((r) => {
            const delta = r.metadata?.daysDelta ?? 0;
            const positive = delta > 0;
            return (
              <li key={r.id} className="py-2.5 flex items-start gap-3">
                <div
                  className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm ${
                    positive
                      ? 'bg-ok-soft text-ok-ink'
                      : 'bg-bad-soft text-bad'
                  }`}
                >
                  {positive ? `+${delta}` : delta}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">
                    {positive
                      ? t('addedDays', { count: Math.abs(delta) })
                      : t('subtractedDays', { count: Math.abs(delta) })}
                    {r.metadata?.newStatus === 'SUSPENDED' && (
                      <span className="ml-2 badge badge-bad text-[10px]">
                        {t('endedSuspended')}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-mute mt-0.5">
                    {new Date(r.createdAt).toLocaleString('es-CO', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {r.actor && (
                      <>
                        {' · '}
                        <span className="text-ink font-medium">
                          {r.actor.fullName || r.actor.email}
                        </span>
                      </>
                    )}
                  </div>
                  {r.metadata?.previousTrialEndsAt && r.metadata?.newTrialEndsAt && (
                    <div className="text-[11px] text-mute2 mt-0.5">
                      {t('wasExpiring')}{' '}
                      {new Date(r.metadata.previousTrialEndsAt).toLocaleDateString(
                        'es-CO',
                        { day: 'numeric', month: 'short' },
                      )}{' '}
                      → {t('nowExpires')}{' '}
                      {new Date(r.metadata.newTrialEndsAt).toLocaleDateString(
                        'es-CO',
                        { day: 'numeric', month: 'short', year: 'numeric' },
                      )}
                    </div>
                  )}
                  {r.metadata?.observation && (
                    <div className="text-xs text-ink/80 mt-1 italic">
                      "{r.metadata.observation}"
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ============================================================
//        SIMULADOR HOTMART — testing sin tarjetas reales
// ============================================================

const SIMULATOR_EVENTS: {
  event: string;
  label: string;
  emoji: string;
  hint: string;
  variant: 'ok' | 'warn' | 'danger' | 'neutral';
}[] = [
  { event: 'PURCHASE_APPROVED', label: 'Pago aprobado', emoji: '✅', hint: 'Activa tenant + setea próximo cobro', variant: 'ok' },
  { event: 'PURCHASE_DELAYED', label: 'Pago demorado', emoji: '🕓', hint: 'failedPaymentCount++ → PAST_DUE', variant: 'warn' },
  { event: 'PURCHASE_PROTEST', label: 'Pago en disputa', emoji: '⚠️', hint: 'Como demorado pero más severo', variant: 'warn' },
  { event: 'PURCHASE_REFUNDED', label: 'Reembolso', emoji: '💸', hint: 'Suspende + revierte comisión', variant: 'danger' },
  { event: 'PURCHASE_CHARGEBACK', label: 'Chargeback', emoji: '🚫', hint: 'Suspende + revierte comisión', variant: 'danger' },
  { event: 'SUBSCRIPTION_CANCELLATION', label: 'Cancelación', emoji: '🛑', hint: 'Suspende suavemente (sin revertir)', variant: 'danger' },
  { event: 'UPDATE_SUBSCRIPTION_CHARGE_DATE', label: 'Mover próximo cobro', emoji: '📅', hint: '+30 días desde ahora', variant: 'neutral' },
];

// ============================================================
//   Logs de envíos SMS por reseñas negativas (audit superadmin)
// ============================================================

type ReviewAlertEvent = {
  id: string;
  type: 'review.sms_alert_sent' | 'review.sms_alert_failed';
  payload: any;
  createdAt: string;
};

// ============================================================
//   Asignación de subcuenta SMS global por propósito
// ============================================================

type GbAccountOption = {
  id: string;
  name: string;
  purpose: string;
  isDefault: boolean;
  lastTestOk: boolean | null;
};

function ReviewAlertsAccountCard({
  tenant,
  onSaved,
}: {
  tenant: any;
  onSaved: () => void;
}) {
  const t = useTranslations('admin_tenants_id');
  return (
    <AlertsAccountCard
      tenant={tenant}
      onSaved={onSaved}
      field="reviewAlertsAccountId"
      title={t('reviewAlertsAccountTitle')}
      description={t('reviewAlertsAccountDesc')}
      preferredPurpose="OPERATIONAL"
      radioName="gb-review-account"
    />
  );
}

function BillingAlertsAccountCard({
  tenant,
  onSaved,
}: {
  tenant: any;
  onSaved: () => void;
}) {
  const t = useTranslations('admin_tenants_id');
  return (
    <AlertsAccountCard
      tenant={tenant}
      onSaved={onSaved}
      field="billingAlertsAccountId"
      title={t('billingAlertsAccountTitle')}
      description={t('billingAlertsAccountDesc')}
      preferredPurpose="BILLING"
      radioName="gb-billing-account"
    />
  );
}

function DeliveryAlertsAccountCard({
  tenant,
  onSaved,
}: {
  tenant: any;
  onSaved: () => void;
}) {
  const t = useTranslations('admin_tenants_id');
  return (
    <AlertsAccountCard
      tenant={tenant}
      onSaved={onSaved}
      field="deliveryAlertsAccountId"
      title={t('deliveryAlertsAccountTitle')}
      description={t('deliveryAlertsAccountDesc')}
      preferredPurpose="OPERATIONAL"
      radioName="gb-delivery-account"
    />
  );
}

/** Componente reusable: card con radio buttons para elegir subcuenta
 *  global asignada a un campo específico del tenant. Las subcuentas se
 *  ordenan poniendo primero las del `preferredPurpose` (BILLING para
 *  billing card, OPERATIONAL para reviews card) — pero igual mostramos
 *  todas para no bloquear al admin. */
function AlertsAccountCard({
  tenant,
  onSaved,
  field,
  title,
  description,
  preferredPurpose,
  radioName,
}: {
  tenant: any;
  onSaved: () => void;
  field:
    | 'reviewAlertsAccountId'
    | 'billingAlertsAccountId'
    | 'deliveryAlertsAccountId';
  title: string;
  description: string;
  preferredPurpose: 'BILLING' | 'OPERATIONAL';
  radioName: string;
}) {
  const t = useTranslations('admin_tenants_id');
  const [accounts, setAccounts] = useState<GbAccountOption[] | null>(null);
  const [selected, setSelected] = useState<string>(tenant[field] ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected(tenant[field] ?? '');
  }, [tenant, field]);

  useEffect(() => {
    api<GbAccountOption[]>('/admin/integrations/grow-business-accounts')
      .then((data) =>
        setAccounts(
          data.map((a: any) => ({
            id: a.id,
            name: a.name,
            purpose: a.purpose ?? 'GENERAL',
            isDefault: a.isDefault,
            lastTestOk: a.lastTestOk,
          })),
        ),
      )
      .catch((e: any) =>
        toast(e.message || t('couldNotLoadAccounts'), 'error'),
      );
  }, []);

  async function save() {
    setSaving(true);
    try {
      await api(`/tenants/${tenant.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: selected || null }),
      });
      toast(t('accountAssigned'), 'success');
      onSaved();
    } catch (e: any) {
      toast(e.message || t('couldNotSave'), 'error');
    } finally {
      setSaving(false);
    }
  }

  const dirty = (selected || '') !== (tenant[field] ?? '');

  // Ordena: preferredPurpose primero, después el resto.
  const sortedAccounts = accounts
    ? [...accounts].sort((a, b) => {
        const aPref = a.purpose === preferredPurpose ? 0 : 1;
        const bPref = b.purpose === preferredPurpose ? 0 : 1;
        return aPref - bPref;
      })
    : null;

  return (
    <div className="card card-pad">
      <h3 className="text-base font-semibold m-0 flex items-center gap-2">
        {title}
      </h3>
      <p className="text-xs text-mute mt-1 leading-relaxed">
        {description}{' '}
        <Link
          href="/admin/integrations"
          className="text-brand hover:underline"
        >
          {t('manageAccounts')}
        </Link>
      </p>

      {accounts === null && (
        <div className="text-xs text-mute mt-3">{t('loadingAccounts')}</div>
      )}

      {accounts && accounts.length === 0 && (
        <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-900">
          {t('noAccountsYet')}{' '}
          <Link href="/admin/integrations" className="font-semibold underline">
            {t('createFirstAccount')}
          </Link>
        </div>
      )}

      {sortedAccounts && sortedAccounts.length > 0 && (
        <>
          <div className="mt-3 space-y-1">
            <label className="flex items-center gap-2 p-2 rounded hover:bg-bg2/40 cursor-pointer">
              <input
                type="radio"
                name={radioName}
                checked={selected === ''}
                onChange={() => setSelected('')}
                className="accent-brand"
              />
              <div>
                <div className="text-sm font-medium">
                  {t('useBusinessOwnCreds')}
                </div>
                <div className="text-[11px] text-mute">
                  {t('useBusinessOwnCredsHelp')}
                </div>
              </div>
            </label>
            {sortedAccounts.map((acc) => {
              const isPref = acc.purpose === preferredPurpose;
              return (
                <label
                  key={acc.id}
                  className="flex items-center gap-2 p-2 rounded hover:bg-bg2/40 cursor-pointer"
                >
                  <input
                    type="radio"
                    name={radioName}
                    checked={selected === acc.id}
                    onChange={() => setSelected(acc.id)}
                    className="accent-brand"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                      {acc.name}
                      <span
                        className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${
                          isPref
                            ? 'bg-brand/15 text-brand'
                            : 'bg-bg2 text-mute'
                        }`}
                      >
                        {acc.purpose === 'BILLING'
                          ? t('purposeBilling')
                          : acc.purpose === 'OPERATIONAL'
                          ? t('purposeOperational')
                          : t('purposeGeneral')}
                      </span>
                      {acc.isDefault && (
                        <span className="text-[9px] uppercase tracking-wider font-bold bg-brand/15 text-brand px-1.5 py-0.5 rounded">
                          {t('badgeDefault')}
                        </span>
                      )}
                      {acc.lastTestOk === true && (
                        <span className="text-[9px] uppercase tracking-wider font-bold bg-ok/15 text-ok px-1.5 py-0.5 rounded">
                          {t('badgeOk')}
                        </span>
                      )}
                      {acc.lastTestOk === false && (
                        <span className="text-[9px] uppercase tracking-wider font-bold bg-bad/15 text-bad px-1.5 py-0.5 rounded">
                          {t('badgeFailed')}
                        </span>
                      )}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          {dirty && (
            <div className="mt-3 flex justify-end">
              <button
                onClick={save}
                disabled={saving}
                className="btn-primary text-sm"
              >
                {saving ? t('saving') : t('saveAssignment')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ReviewAlertsLogsCard({ tenantId }: { tenantId: string }) {
  const t = useTranslations('admin_tenants_id');
  const [logs, setLogs] = useState<ReviewAlertEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await api<ReviewAlertEvent[]>(
        `/admin/tenants/${tenantId}/review-alerts/logs`,
      );
      setLogs(data);
    } catch (e: any) {
      toast(e.message || t('couldNotLoad'), 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const sent = logs?.filter((l) => l.type === 'review.sms_alert_sent').length ?? 0;
  const failed = logs?.filter((l) => l.type === 'review.sms_alert_failed').length ?? 0;

  return (
    <div className="card card-pad">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div>
          <h3 className="text-base font-semibold m-0 flex items-center gap-2">
            {t('reviewLogsTitle')}
            {logs && (
              <span className="text-[10px] uppercase tracking-wider text-mute">
                {t('reviewLogsSummary', { sent, failed })}
              </span>
            )}
          </h3>
          <p className="text-xs text-mute mt-1 leading-relaxed">
            {t('reviewLogsDesc')}
          </p>
        </div>
        <span
          className={`text-mute text-sm shrink-0 transition-transform ${
            open ? '' : '-rotate-90'
          }`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="mt-4 pt-4 border-t border-line">
          {loading && <div className="text-xs text-mute">{t('loading')}</div>}
          {!loading && logs?.length === 0 && (
            <div className="text-xs text-mute italic">
              {t('noLogsYet')}
            </div>
          )}
          {!loading && logs && logs.length > 0 && (
            <div className="space-y-2">
              {logs.map((log) => {
                const ok = log.type === 'review.sms_alert_sent';
                return (
                  <div
                    key={log.id}
                    className={`rounded-lg border px-3 py-2 text-xs ${
                      ok
                        ? 'bg-ok/5 border-ok/20'
                        : 'bg-bad/5 border-bad/20'
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span
                        className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded ${
                          ok ? 'bg-ok text-white' : 'bg-bad text-white'
                        }`}
                      >
                        {ok ? t('logSent') : t('logFailed')}
                      </span>
                      <span className="text-mute">
                        {new Date(log.createdAt).toLocaleString('es-CO')}
                      </span>
                      {log.payload?.rating && (
                        <span className="font-semibold">
                          {'⭐'.repeat(log.payload.rating)}
                        </span>
                      )}
                      {log.payload?.toPhone && (
                        <code className="ml-auto text-[10px] bg-bg2 px-1.5 py-0.5 rounded">
                          → {log.payload.toPhone}
                        </code>
                      )}
                    </div>
                    {log.payload?.response?.message && (
                      <div className="text-mute leading-snug whitespace-pre-line break-all">
                        {log.payload.response.message}
                      </div>
                    )}
                    {log.payload?.reason === 'no_destination_phone' && (
                      <div className="text-amber-700 italic">
                        {t('noDestinationPhone')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <button
            type="button"
            onClick={load}
            className="btn-ghost text-xs mt-3"
          >
            {t('refresh')}
          </button>
        </div>
      )}
    </div>
  );
}

function HotmartSimulatorCard({
  tenant,
  onChange,
}: {
  tenant: any;
  onChange: () => void;
}) {
  const t = useTranslations('admin_tenants_id');
  const [busy, setBusy] = useState<string | null>(null);

  async function fire(event: string) {
    if (!confirm(t('confirmSimulateEvent', { event }))) return;
    setBusy(event);
    try {
      const body: any = { tenantId: tenant.id, event };
      const r = await api<any>('/admin/billing/hotmart/simulate-webhook', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const action = r?.handlerResult?.action ?? t('noAction');
      toast(`${event} → ${action}`, 'success');
      onChange();
    } catch (e: any) {
      toast(e.message || t('errorSimulatingWebhook'), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card card-pad md:col-span-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold m-0">
            {t('hotmartSimulatorTitle')}
          </h2>
          <p className="text-xs text-mute mt-1">
            {t.rich('hotmartSimulatorDesc', {
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
        </div>
        <span className="text-[10px] px-2 py-1 rounded-full bg-amber-100 text-amber-900 font-semibold uppercase tracking-wide">
          {t('superAdminOnly')}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 mt-4">
        {SIMULATOR_EVENTS.map((e) => {
          const ring =
            e.variant === 'ok'
              ? 'border-ok/40 hover:border-ok bg-ok-soft/30'
              : e.variant === 'warn'
              ? 'border-amber-300 hover:border-amber-500 bg-amber-50/50'
              : e.variant === 'danger'
              ? 'border-red-300 hover:border-red-500 bg-red-50/40'
              : 'border-line hover:border-brand bg-bg2';
          return (
            <button
              key={e.event}
              type="button"
              disabled={busy !== null}
              onClick={() => fire(e.event)}
              className={`text-left rounded-input border-2 p-3 transition disabled:opacity-50 ${ring}`}
            >
              <div className="text-xl mb-1">{e.emoji}</div>
              <div className="text-sm font-semibold">
                {busy === e.event ? t('triggering') : e.label}
              </div>
              <div className="text-[11px] text-mute mt-0.5">{e.hint}</div>
              <div className="text-[10px] text-mute font-mono mt-1.5">
                {e.event}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-3 text-[11px] text-mute leading-relaxed">
        {t.rich('hotmartSimulatorFooter', {
          code: (chunks) => <code>{chunks}</code>,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
      </div>
    </div>
  );
}

// ============================================================
//             SECUENCIA SMS DE COBRO (estado read-only)
// ============================================================

function BillingNotificationsCard({ tenant }: { tenant: any }) {
  const t = useTranslations('admin_tenants_id');
  const fmt = (d: string | null | undefined) =>
    d
      ? new Date(d).toLocaleString('es-CO', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—';
  const fmtDate = (d: string | null | undefined) =>
    d
      ? new Date(d).toLocaleDateString('es-CO', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : null;
  const gbConnected = !!tenant.growBusinessLocationId;
  const reminderDate = fmtDate(tenant.currentPeriodEnd);
  const reminderSent = !!(
    tenant.paymentReminderSentFor &&
    tenant.currentPeriodEnd &&
    new Date(tenant.paymentReminderSentFor).getTime() ===
      new Date(tenant.currentPeriodEnd).getTime()
  );
  const failed = (tenant.failedPaymentCount ?? 0) > 0;

  return (
    <div className="card card-pad md:col-span-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold m-0 flex items-center gap-2">
            {t('billingSmsSequenceTitle')}
          </h2>
          <p className="text-xs text-mute mt-1 leading-relaxed">
            {t('billingSmsSequenceDesc')}
          </p>
        </div>
        {gbConnected ? (
          <span className="badge badge-ok">{t('smsConnected')}</span>
        ) : (
          <span className="badge badge-warn">{t('noGrowBusiness')}</span>
        )}
      </div>

      {!gbConnected && (
        <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-900">
          {t('noGrowBusinessWarning')}
        </div>
      )}

      <ol className="mt-4 space-y-2.5">
        <NotifStep
          n={1}
          title={t('notifStep1Title')}
          help={
            reminderDate
              ? t('notifStep1HelpNext', { date: reminderDate })
              : t('notifStep1HelpNone')
          }
          status={reminderSent ? 'sent' : 'pending'}
          when={reminderSent ? t('notifSentFor', { date: reminderDate ?? '' }) : null}
        />
        <NotifStep
          n={2}
          title={t('notifStep2Title')}
          help={t('notifStep2Help')}
          status={
            tenant.failedPaymentCount === 0 && tenant.lastPaymentAttemptAt
              ? 'sent'
              : 'idle'
          }
          when={
            tenant.failedPaymentCount === 0 && tenant.lastPaymentAttemptAt
              ? t('notifLast', { date: fmt(tenant.lastPaymentAttemptAt) })
              : null
          }
        />
        <NotifStep
          n={3}
          title={t('notifStep3Title')}
          help={t('notifStep3Help')}
          status={failed ? 'warn' : 'idle'}
          when={
            tenant.paymentFailureNoticeSentAt
              ? t('notifSent', { date: fmt(tenant.paymentFailureNoticeSentAt) })
              : null
          }
        />
        <NotifStep
          n={4}
          title={t('notifStep4Title')}
          help={t('notifStep4Help', { count: tenant.failedPaymentCount ?? 0 })}
          status={tenant.pausePendingNoticeSentAt ? 'sent' : failed ? 'pending' : 'idle'}
          when={
            tenant.pausePendingNoticeSentAt
              ? t('notifSent', { date: fmt(tenant.pausePendingNoticeSentAt) })
              : null
          }
        />
        <NotifStep
          n={5}
          title={t('notifStep5Title')}
          help={t('notifStep5Help')}
          status={
            tenant.suspendedAt && failed ? 'sent' : 'idle'
          }
          when={tenant.suspendedAt ? t('notifSuspended', { date: fmt(tenant.suspendedAt) }) : null}
        />
      </ol>
    </div>
  );
}

function NotifStep({
  n,
  title,
  help,
  status,
  when,
}: {
  n: number;
  title: string;
  help: string;
  status: 'idle' | 'pending' | 'sent' | 'warn';
  when: string | null;
}) {
  const cls =
    status === 'sent'
      ? 'border-ok/30 bg-ok-soft/40'
      : status === 'warn'
      ? 'border-amber-300 bg-amber-50'
      : status === 'pending'
      ? 'border-line bg-bg2/40'
      : 'border-line2 bg-white opacity-70';
  const dot =
    status === 'sent'
      ? '✓'
      : status === 'warn'
      ? '⚠'
      : status === 'pending'
      ? '○'
      : '○';
  return (
    <li className={`border rounded-input px-3 py-2.5 ${cls}`}>
      <div className="flex items-start gap-3">
        <div className="text-xs font-mono opacity-70 mt-0.5">{n}.</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-[11px] text-mute mt-0.5">{help}</div>
          {when && (
            <div className="text-[11px] text-ok mt-1 font-medium">{when}</div>
          )}
        </div>
        <div className="text-base flex-none mt-0.5">{dot}</div>
      </div>
    </li>
  );
}

// ============================================================
//                 BILLING EDITOR (admin)
// ============================================================

type BillingMode = 'free' | 'trial' | 'paid' | 'pending';

const MODE_OPTIONS: Array<{ v: BillingMode; emoji: string; label: string; hint: string }> = [
  { v: 'pending', emoji: '🔒', label: 'Sin pago', hint: 'Lockscreen activo' },
  { v: 'free', emoji: '🎁', label: 'Sin costo', hint: 'Cortesía indefinida' },
  { v: 'trial', emoji: '⏱', label: 'Trial', hint: 'Acceso por X días' },
  { v: 'paid', emoji: '💳', label: 'Pagada', hint: 'Hotmart enlazado' },
];

function BillingCard({ tenant, onChange }: { tenant: any; onChange: () => void }) {
  const t = useTranslations('admin_tenants_id');
  // Detectar modo actual desde el estado del tenant
  const currentMode: BillingMode = (() => {
    const code: string | null = tenant.hotmartSubscriberCode ?? null;
    if (!code) return 'pending';
    if (code.startsWith('comp-')) return 'free';
    if (code.startsWith('trial-')) return 'trial';
    return 'paid'; // manual-... o código real Hotmart
  })();

  const [mode, setMode] = useState<BillingMode>(currentMode);
  const [trialDays, setTrialDays] = useState(7);
  const [gracePeriodDays, setGracePeriodDays] = useState<number>(
    typeof tenant.gracePeriodDays === 'number' ? tenant.gracePeriodDays : 0,
  );
  const [nextChargeDate, setNextChargeDate] = useState(
    tenant.currentPeriodEnd
      ? new Date(tenant.currentPeriodEnd).toISOString().slice(0, 10)
      : '',
  );
  const [code, setCode] = useState<string>(
    typeof tenant.hotmartSubscriberCode === 'string' &&
      !tenant.hotmartSubscriberCode.startsWith('manual-') &&
      !tenant.hotmartSubscriberCode.startsWith('comp-') &&
      !tenant.hotmartSubscriberCode.startsWith('trial-')
      ? tenant.hotmartSubscriberCode
      : '',
  );
  const [saving, setSaving] = useState(false);

  // Precio REAL pagado en Hotmart — base de comisiones. Editable a mano
  // para corregir legacy (ej: negocios que pagaron con el link viejo de $50).
  const [subPrice, setSubPrice] = useState<string>(
    tenant.subscriptionPriceUsd != null
      ? String(Number(tenant.subscriptionPriceUsd))
      : '',
  );
  const [savingPrice, setSavingPrice] = useState(false);
  // Re-sincroniza el campo cuando el tenant se recarga (tras guardar o un
  // cambio externo). Sin esto, useState congelaba el valor inicial y el campo
  // parecía "no actualizarse" aunque el precio SÍ se hubiera guardado.
  useEffect(() => {
    setSubPrice(
      tenant.subscriptionPriceUsd != null
        ? String(Number(tenant.subscriptionPriceUsd))
        : '',
    );
  }, [tenant.subscriptionPriceUsd]);

  async function saveSubPrice() {
    const trimmed = subPrice.trim();
    const value = trimmed === '' ? null : Number(trimmed);
    if (value != null && (!Number.isFinite(value) || value < 0)) {
      toast(t('invalidPrice'), 'error');
      return;
    }
    setSavingPrice(true);
    try {
      await api(`/tenants/${tenant.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ subscriptionPriceUsd: value }),
      });
      toast(
        value == null
          ? t('priceCleared')
          : t('commissionPriceSaved'),
        'success',
      );
      onChange();
    } catch (e: any) {
      toast(e.message || t('couldNotSave'), 'error');
    } finally {
      setSavingPrice(false);
    }
  }

  async function apply() {
    const graceChanged = gracePeriodDays !== (tenant.gracePeriodDays ?? 0);
    const modeChanged = mode !== currentMode;
    // El "Precio real pagado" vive en esta tarjeta; antes SOLO se guardaba con
    // su botón "Guardar precio" y "Aplicar cambio" lo ignoraba → el usuario
    // editaba el precio, daba "Aplicar cambio" y no se actualizaba. Ahora
    // "Aplicar cambio" también persiste el precio si cambió.
    const currentPriceStr =
      tenant.subscriptionPriceUsd != null
        ? String(Number(tenant.subscriptionPriceUsd))
        : '';
    const priceChanged = subPrice.trim() !== currentPriceStr;
    if (priceChanged) {
      const trimmed = subPrice.trim();
      const value = trimmed === '' ? null : Number(trimmed);
      if (value != null && (!Number.isFinite(value) || value < 0)) {
        toast(t('invalidPrice'), 'error');
        return;
      }
      setSaving(true);
      try {
        await api(`/tenants/${tenant.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ subscriptionPriceUsd: value }),
        });
      } catch (e: any) {
        toast(e.message || t('couldNotSave'), 'error');
        setSaving(false);
        return;
      }
      setSaving(false);
      // Si SOLO cambió el precio (sin tocar modo ni gracia), listo.
      if (!graceChanged && !modeChanged) {
        toast(t('commissionPriceSaved'), 'success');
        onChange();
        return;
      }
    }
    // Solo cambia la gracia (mismo modo): usamos PATCH /tenants/:id sin tocar
    // trialEndsAt ni el ciclo de cobro. Útil para extender gracia sin reset.
    if (graceChanged && !modeChanged) {
      if (!confirm(t('confirmUpdateGrace', { days: gracePeriodDays }))) return;
      setSaving(true);
      try {
        await api(`/tenants/${tenant.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ gracePeriodDays }),
        });
        toast(t('graceDaysUpdated'), 'success');
        onChange();
      } catch (e: any) {
        toast(e.message || t('couldNotUpdate'), 'error');
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!confirm(t('confirmChangeBilling', { mode: MODE_OPTIONS.find((m) => m.v === mode)?.label ?? '' })))
      return;
    setSaving(true);
    try {
      const body: any = { mode };
      if (mode === 'trial') body.trialDays = trialDays;
      if (graceChanged) body.gracePeriodDays = gracePeriodDays;
      if (mode === 'paid') {
        if (nextChargeDate)
          body.nextChargeDate = new Date(nextChargeDate).toISOString();
        if (code.trim()) body.hotmartSubscriberCode = code.trim();
        if (!body.nextChargeDate && !body.hotmartSubscriberCode) {
          toast(t('paidNeedsDateOrCode'), 'error');
          setSaving(false);
          return;
        }
      }
      await api(`/tenants/${tenant.id}/billing`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      toast(t('billingUpdated'), 'success');
      onChange();
    } catch (e: any) {
      toast(e.message || t('couldNotUpdate'), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card card-pad md:col-span-2">
      <h2 className="text-base font-semibold m-0">{t('billing')}</h2>
      <p className="text-xs text-mute mt-1">
        {t('currentStatusLabel')} <strong className="text-ink">{MODE_OPTIONS.find((m) => m.v === currentMode)?.label}</strong>
        {tenant.trialEndsAt && (
          <>
            {' '}· {t('trialExpiresLabel')}{' '}
            <strong className="text-ink">
              {new Date(tenant.trialEndsAt).toLocaleDateString('es-CO', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </strong>
          </>
        )}
        {(tenant.gracePeriodDays ?? 0) > 0 && (
          <>
            {' '}· {t('gracePostTrialLabel')}{' '}
            <strong className="text-ink">{t('graceDays', { days: tenant.gracePeriodDays })}</strong>
          </>
        )}
        {tenant.currentPeriodEnd && (
          <>
            {' '}· {t('nextChargeLabel')}{' '}
            <strong className="text-ink">
              {new Date(tenant.currentPeriodEnd).toLocaleDateString('es-CO', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </strong>
          </>
        )}
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
        {MODE_OPTIONS.map((opt) => {
          const active = mode === opt.v;
          return (
            <button
              type="button"
              key={opt.v}
              onClick={() => setMode(opt.v)}
              className={`text-left rounded-input border-2 p-2.5 transition ${
                active
                  ? 'border-brand bg-brand-soft'
                  : 'border-line bg-white hover:border-brand/40'
              }`}
            >
              <div className="text-lg mb-0.5">{opt.emoji}</div>
              <div className="text-sm font-semibold">{opt.label}</div>
              <div className="text-[11px] text-mute">{opt.hint}</div>
            </button>
          );
        })}
      </div>

      {mode === 'trial' && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="label">{t('trialDaysFromToday')}</label>
            <input
              className="input"
              type="number"
              min={1}
              max={365}
              value={trialDays}
              onChange={(e) => setTrialDays(Number(e.target.value) || 7)}
            />
            <div className="text-[11px] text-mute mt-1">
              {t('trialDaysFromTodayHelp')}
            </div>
          </div>
          <div>
            <label className="label">{t('graceDaysAfterExpiry')}</label>
            <input
              className="input"
              type="number"
              min={0}
              max={365}
              value={gracePeriodDays}
              onChange={(e) =>
                setGracePeriodDays(Math.max(0, Number(e.target.value) || 0))
              }
            />
            <div className="text-[11px] text-mute mt-1">
              {t('graceDaysAfterExpiryHelp')}
            </div>
          </div>
        </div>
      )}

      {mode === 'paid' && (
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div>
            <label className="label">{t('nextChargeDate')}</label>
            <input
              className="input"
              type="date"
              value={nextChargeDate}
              onChange={(e) => setNextChargeDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label">{t('hotmartSubscriberCode')}</label>
            <input
              className="input"
              placeholder={t('optional')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
        </div>
      )}

      {mode === 'pending' && (
        <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-900">
          {t('pendingModeNote')}
        </div>
      )}

      {mode === 'free' && (
        <div className="mt-4 rounded-lg bg-ok-soft/50 border border-ok/20 px-3 py-2.5 text-xs text-ok-ink">
          {t('freeModeNote')}
        </div>
      )}

      {/* Precio real de comisión — base sobre la que se calculan las
          comisiones (directa, 5% indirecto, 10% socio). Se autollena desde
          el webhook Hotmart; editable para corregir legacy ($50 viejo). */}
      <div className="mt-5 pt-4 border-t border-line">
        <label className="label">{t('realPriceLabel')}</label>
        <div className="flex items-end gap-2 mt-1">
          <div className="relative flex-1 max-w-[180px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-mute text-sm">
              $
            </span>
            <input
              className="input pl-6"
              type="number"
              min={0}
              step="0.01"
              placeholder={t('autoPlaceholder')}
              value={subPrice}
              onChange={(e) => setSubPrice(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={saveSubPrice}
            disabled={
              savingPrice ||
              subPrice.trim() ===
                (tenant.subscriptionPriceUsd != null
                  ? String(Number(tenant.subscriptionPriceUsd))
                  : '')
            }
          >
            {savingPrice ? t('saving') : t('savePrice')}
          </button>
        </div>
        <div className="text-[11px] text-mute mt-1.5">
          {t('realPriceHelp')}
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          className="btn-primary"
          onClick={apply}
          disabled={
            saving ||
            (mode === currentMode &&
              gracePeriodDays === (tenant.gracePeriodDays ?? 0))
          }
          title={
            mode === currentMode &&
            gracePeriodDays === (tenant.gracePeriodDays ?? 0)
              ? t('noChanges')
              : t('applyChangeTitle')
          }
        >
          {saving ? t('applying') : t('applyChange')}
        </button>
      </div>
    </div>
  );
}

// ============================================================
//   Plan actual + cambio de periodicidad (SOLO METADATA INTERNA)
// ============================================================

type PeriodId = 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';

type LandingPlanCfg = { price: number; checkoutUrl: string | null };
type LandingPlansResp = Partial<Record<'mensual' | 'trimestral' | 'semestral' | 'anual', LandingPlanCfg>>;

const PERIOD_LABEL: Record<PeriodId, string> = {
  MENSUAL: 'Mensual',
  TRIMESTRAL: 'Trimestral',
  SEMESTRAL: 'Semestral',
  ANUAL: 'Anual',
};

// Default fallback en USD — los reales se editan desde /admin/branding.
// Si la API no responde, mostramos estos para no quedar en blanco.
const PERIOD_PRICE_DEFAULT: Record<PeriodId, number> = {
  MENSUAL: 68,
  TRIMESTRAL: 150,
  SEMESTRAL: 278,
  ANUAL: 500,
};

const PERIOD_TO_KEY: Record<PeriodId, 'mensual' | 'trimestral' | 'semestral' | 'anual'> = {
  MENSUAL: 'mensual',
  TRIMESTRAL: 'trimestral',
  SEMESTRAL: 'semestral',
  ANUAL: 'anual',
};

/**
 * Card "Plan actual" + modal de cambio de periodicidad.
 *
 * REGLA CRÍTICA: NO toca Hotmart. Solo actualiza metadata interna del
 * tenant (planPeriodicity + currentPeriodEnd). El admin debe cancelar la
 * suscripción vieja en Hotmart y enviarle al cliente el link del nuevo
 * plan manualmente. Sin esos pasos, el cobro real sigue siendo el del
 * plan anterior.
 *
 * El modal exige 3 checks explícitos antes de habilitar "Confirmar".
 */
function PlanCurrentCard({
  tenant,
  isSuperAdmin,
  onChange,
}: {
  tenant: any;
  isSuperAdmin: boolean;
  onChange: () => void;
}) {
  const t = useTranslations('admin_tenants_id');
  const [plans, setPlans] = useState<LandingPlansResp | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Carga precios desde /landing-plans para mostrar al lado de la
  // periodicidad actual y en los radios del modal. Si falla, usamos
  // PERIOD_PRICE_DEFAULT.
  useEffect(() => {
    api<LandingPlansResp>('/landing-plans')
      .then((data) => setPlans(data))
      .catch(() => setPlans({}));
  }, []);

  // Planes de la MARCA del negocio (Sellea, etc.) → el modal muestra SOLO esas
  // periodicidades con SUS precios, no los 4 de Clubify. Si el negocio es de
  // Clubify / la marca no tiene links configurados, brandPlans viene vacío y
  // caemos al comportamiento anterior (/landing-plans + fallback Clubify).
  const ALL_PERIODS: PeriodId[] = ['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'];
  const brandPlans: { periodicity: string; amountUsd: number | null }[] =
    tenant?.brandPlans ?? [];
  const brandPriceMap: Partial<Record<PeriodId, number>> = {};
  for (const bp of brandPlans) {
    if (ALL_PERIODS.includes(bp.periodicity as PeriodId) && bp.amountUsd != null) {
      brandPriceMap[bp.periodicity as PeriodId] = bp.amountUsd;
    }
  }
  const hasBrandPlans = Object.keys(brandPriceMap).length > 0;
  const availablePeriods: PeriodId[] = hasBrandPlans
    ? ALL_PERIODS.filter((p) => p in brandPriceMap)
    : ALL_PERIODS;
  const priceFor = (p: PeriodId): number | null =>
    hasBrandPlans
      ? brandPriceMap[p] ?? null
      : plans?.[PERIOD_TO_KEY[p]]?.price ?? PERIOD_PRICE_DEFAULT[p];

  const currentPeriod = (tenant?.planPeriodicity as PeriodId | null) ?? null;
  const currentPrice = currentPeriod ? priceFor(currentPeriod) : null;

  return (
    <div className="card card-pad">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold m-0">{t('currentPlan')}</h2>
          <p className="text-xs text-mute mt-1">
            {t('currentPlanDesc')}
          </p>
        </div>
        {isSuperAdmin && (
          <button
            type="button"
            className="btn-ghost text-sm cursor-pointer touch-manipulation select-none active:scale-[0.97] transition-transform duration-150 [-webkit-tap-highlight-color:transparent]"
            onClick={() => setModalOpen(true)}
          >
            {t('changePlan')}
          </button>
        )}
      </div>

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-mute">{t('planDt')}</dt>
          <dd className="font-semibold text-brand">
            {planDisplayName(
              tenant.plan?.name,
              tenant.planPeriodicity as PlanPeriodicity | null,
            )}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-mute">{t('periodicity')}</dt>
          <dd className="font-medium">
            {currentPeriod ? PERIOD_LABEL[currentPeriod] : <span className="text-mute">{t('undefined')}</span>}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-mute">{t('price')}</dt>
          <dd className="font-medium">
            {currentPrice != null ? (
              <>
                <span className="font-semibold">${currentPrice.toLocaleString('en-US')}</span>
                <span className="text-mute"> USD / {PERIOD_LABEL[currentPeriod!].toLowerCase()}</span>
              </>
            ) : (
              <span className="text-mute">—</span>
            )}
          </dd>
        </div>
        {tenant.currentPeriodEnd && (
          <div className="flex justify-between">
            <dt className="text-mute">{t('nextCharge')}</dt>
            <dd className="font-medium">
              {new Date(tenant.currentPeriodEnd).toLocaleDateString('es-CO', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </dd>
          </div>
        )}
      </dl>

      {modalOpen && (
        <ChangePlanPeriodModal
          tenant={tenant}
          currentPeriod={currentPeriod}
          availablePeriods={availablePeriods}
          priceFor={priceFor}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            onChange();
          }}
        />
      )}
    </div>
  );
}

/**
 * Modal de cambio de periodicidad. Exige:
 *  1. Elegir nueva periodicidad (radio).
 *  2. Marcar 3 checks de tareas manuales en Hotmart.
 *  3. Confirmar — recién ahí dispara POST /tenants/:id/change-plan-period.
 *
 * El backend SOLO actualiza metadata (planPeriodicity + currentPeriodEnd
 * + AuditLog). Hotmart sigue cobrando lo mismo hasta que el admin haga
 * los pasos manuales.
 */
function ChangePlanPeriodModal({
  tenant,
  currentPeriod,
  availablePeriods,
  priceFor,
  onClose,
  onSaved,
}: {
  tenant: any;
  currentPeriod: PeriodId | null;
  availablePeriods: PeriodId[];
  priceFor: (p: PeriodId) => number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('admin_tenants_id');
  const [selected, setSelected] = useState<PeriodId | null>(currentPeriod);
  const [check1, setCheck1] = useState(false);
  const [check2, setCheck2] = useState(false);
  const [check3, setCheck3] = useState(false);
  const [saving, setSaving] = useState(false);

  const allChecksOk = check1 && check2 && check3;
  const canConfirm =
    !!selected && selected !== currentPeriod && allChecksOk && !saving;

  async function confirm() {
    if (!canConfirm || !selected) return;
    setSaving(true);
    try {
      await api(`/tenants/${tenant.id}/change-plan-period`, {
        method: 'POST',
        body: JSON.stringify({ periodicity: selected }),
      });
      toast(t('planUpdatedMetadata'), 'success');
      onSaved();
    } catch (e: any) {
      toast(e.message || t('couldNotChangePlan'), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-end md:items-center justify-center p-3 md:p-6 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-[0_25px_70px_-12px_rgba(0,0,0,0.45)] border border-line2 w-full max-w-xl max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom-6 md:slide-in-from-bottom-2 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-line2 flex items-center justify-between sticky top-0 bg-white z-10">
          <h3 className="text-lg font-semibold m-0 text-ink">{t('changePlan')}</h3>
          <button
            type="button"
            className="text-mute hover:text-ink text-2xl leading-none cursor-pointer touch-manipulation select-none active:scale-[0.97] transition-transform duration-150 [-webkit-tap-highlight-color:transparent]"
            onClick={onClose}
            aria-label={t('close')}
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Warning grande arriba de todo */}
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3.5 py-3 text-xs text-amber-900 leading-relaxed">
            <div className="font-semibold mb-1.5">
              {t('changeWarningTitle')}
            </div>
            {t('changeWarningIntro')}
            <ol className="list-decimal list-inside mt-1.5 space-y-0.5">
              <li>{t('changeWarningStep1')}</li>
              <li>
                {t.rich('changeWarningStep2', {
                  link: (chunks) => (
                    <Link href="/admin/branding" className="underline font-semibold">
                      {chunks}
                    </Link>
                  ),
                })}
              </li>
            </ol>
            <div className="mt-1.5">
              {t('changeWarningFooter')}
            </div>
          </div>

          {/* Radios de periodicidad */}
          <div>
            <label className="label">{t('newPeriodicity')}</label>
            <div className="mt-2 space-y-1.5">
              {availablePeriods.map((p) => {
                const price = priceFor(p);
                const isCurrent = p === currentPeriod;
                return (
                  <label
                    key={p}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer touch-manipulation select-none active:scale-[0.99] transition-transform duration-150 [-webkit-tap-highlight-color:transparent] ${
                      selected === p
                        ? 'border-brand bg-brand/5'
                        : 'border-line hover:bg-bg2/40'
                    }`}
                  >
                    <input
                      type="radio"
                      name="plan-period"
                      checked={selected === p}
                      onChange={() => setSelected(p)}
                      className="accent-brand"
                    />
                    <div className="flex-1 flex items-center justify-between gap-2 flex-wrap">
                      <div className="font-medium">
                        {PERIOD_LABEL[p]}
                        {isCurrent && (
                          <span className="ml-2 text-[10px] uppercase tracking-wider font-bold text-mute bg-bg2 px-1.5 py-0.5 rounded">
                            {t('currentBadge')}
                          </span>
                        )}
                      </div>
                      <div className="text-sm">
                        {price != null ? (
                          <>
                            <span className="font-semibold">
                              ${price.toLocaleString('en-US')}
                            </span>
                            <span className="text-mute"> USD</span>
                          </>
                        ) : (
                          <span className="text-mute">—</span>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Checklist de 3 confirmaciones */}
          <div className="rounded-lg border border-line bg-bg2/40 px-3.5 py-3">
            <div className="text-xs font-semibold text-mute uppercase tracking-wider mb-2">
              {t('mandatoryConfirmations')}
            </div>
            <div className="space-y-2 text-sm">
              <label className="flex items-start gap-2.5 cursor-pointer touch-manipulation select-none">
                <input
                  type="checkbox"
                  checked={check1}
                  onChange={(e) => setCheck1(e.target.checked)}
                  className="accent-brand mt-0.5"
                />
                <span>{t('check1')}</span>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer touch-manipulation select-none">
                <input
                  type="checkbox"
                  checked={check2}
                  onChange={(e) => setCheck2(e.target.checked)}
                  className="accent-brand mt-0.5"
                />
                <span>{t('check2')}</span>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer touch-manipulation select-none">
                <input
                  type="checkbox"
                  checked={check3}
                  onChange={(e) => setCheck3(e.target.checked)}
                  className="accent-brand mt-0.5"
                />
                <span>
                  {t('check3')}
                </span>
              </label>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-line flex items-center justify-end gap-2 sticky bottom-0 bg-bg1">
          <button
            type="button"
            className="btn-ghost text-sm cursor-pointer touch-manipulation select-none active:scale-[0.97] transition-transform duration-150 [-webkit-tap-highlight-color:transparent]"
            onClick={onClose}
            disabled={saving}
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            className="btn-primary text-sm cursor-pointer touch-manipulation select-none active:scale-[0.97] transition-transform duration-150 [-webkit-tap-highlight-color:transparent]"
            onClick={confirm}
            disabled={!canConfirm}
            title={
              !selected
                ? t('chooseFirstPeriodicity')
                : selected === currentPeriod
                ? t('alreadyThisPeriodicity')
                : !allChecksOk
                ? t('mark3Checks')
                : t('confirmChangeTitle')
            }
          >
            {saving ? t('saving') : t('confirmChange')}
          </button>
        </div>
      </div>
    </div>
  );
}
