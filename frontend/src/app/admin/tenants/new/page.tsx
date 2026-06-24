'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { api, getImpersonationBackup } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { PhoneInput } from '@/components/PhoneInput';
import {
  BUSINESS_CATEGORIES,
  DEFAULT_CATEGORY_SLUG,
} from '@/lib/business-categories';
import { AffiliatePickerSearch } from '@/components/AffiliatePickerSearch';

export default function NewTenant() {
  const t = useTranslations('admin_tenants_new');
  const router = useRouter();
  const [plans, setPlans] = useState<any[]>([]);
  type BillingMode = 'pending' | 'free' | 'trial' | 'paid';
  const [billingMode, setBillingMode] = useState<BillingMode>('pending');
  const [form, setForm] = useState({
    brandName: '',
    email: '',
    phone: '',
    ownerFullName: '',
    ownerPassword: '',
    planId: '',
    // M9: periodicidad del plan elegida por el admin. Informativo (no
    // altera billing real). Default vacío hasta que el admin elija.
    planPeriodicity: '' as '' | 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL',
    businessCategorySlug: DEFAULT_CATEGORY_SLUG,
    trialDays: 7,
    nextChargeDate: '',
    hotmartSubscriberCode: '',
    // B5: asignar este negocio (al crearlo) a un INFLUENCER/AMBASSADOR.
    // string vacío = sin asignación. El POST inicial no acepta esto, así
    // que después de crear el tenant disparamos PATCH al endpoint de
    // assignment (B3).
    referralCodeId: '',
  });
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  // #10: si la marca activa NO tiene el módulo REFERRALS, ocultamos la
  // asignación a afiliados. null = sin marca (Clubify global) → se muestra.
  const [referralsEnabled, setReferralsEnabled] = useState(true);
  // Créditos de la marca del admin. null = admin global (Clubify, sin créditos)
  // → usa el flujo Hotmart. Objeto = admin de marca → activa con créditos y, al
  // crear un negocio, aparece el popup OBLIGATORIO de activación.
  type Credits = {
    available: number;
    unlimited: boolean;
    buyLinks: any[];
    // Periodicidades que ofrece la marca (configurable en Master Admin).
    planPeriodicities?: string[];
  };
  const [credits, setCredits] = useState<Credits | null>(null);
  const [creditsLoaded, setCreditsLoaded] = useState(false);
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [activated, setActivated] = useState(false);

  useEffect(() => {
    api('/tenants').then((arr: any[]) => {
      const seen = new Map();
      arr.forEach((t) => seen.set(t.plan.id, t.plan));
      setPlans(Array.from(seen.values()));
    });
  }, []);

  // #10: resuelve el módulo REFERRALS de la marca activa (vía la pila de
  // impersonación). Sin marca (admin Clubify) → REFERRALS activo por default.
  useEffect(() => {
    const slug = getImpersonationBackup()?.tenant?.slug;
    if (!slug) {
      setReferralsEnabled(true);
      return;
    }
    let cancelled = false;
    api<{ modules?: string[] } | null>(
      `/superadmin-public/white-labels/branding?slug=${encodeURIComponent(slug)}`,
    )
      .then((r) => {
        if (cancelled) return;
        // Marca resuelta: mostramos afiliados SOLO si tiene REFERRALS activo.
        // (modules viene como array; vacío = sin REFERRALS → ocultar.)
        const mods = r?.modules;
        setReferralsEnabled(mods ? mods.includes('REFERRALS') : true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolvemos si el admin opera con créditos (admin de marca). El endpoint
  // 403ea para admins globales (Clubify) → credits queda null.
  useEffect(() => {
    api<any>('/admin/credits')
      .then((c) =>
        setCredits({
          available: c?.available ?? 0,
          unlimited: !!c?.unlimited,
          buyLinks: c?.buyLinks ?? [],
          planPeriodicities: Array.isArray(c?.planPeriodicities)
            ? c.planPeriodicities
            : undefined,
        }),
      )
      .catch(() => setCredits(null))
      .finally(() => setCreditsLoaded(true));
  }, []);

  function set<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm({ ...form, [k]: v });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const body: any = {
        brandName: form.brandName,
        email: form.email,
        phone: form.phone || undefined,
        ownerFullName: form.ownerFullName,
        ownerPassword: form.ownerPassword || undefined,
        planId: form.planId || undefined,
        planPeriodicity: form.planPeriodicity || undefined,
        businessCategorySlug: form.businessCategorySlug,
      };
      if (billingMode === 'free') {
        body.freeAccount = true;
      } else if (billingMode === 'trial') {
        body.trialDays = Math.max(1, Math.min(365, Number(form.trialDays) || 7));
      } else if (billingMode === 'paid') {
        if (form.nextChargeDate)
          body.nextChargeDate = new Date(form.nextChargeDate).toISOString();
        if (form.hotmartSubscriberCode.trim())
          body.hotmartSubscriberCode = form.hotmartSubscriberCode.trim();
      }
      const res = await api<any>('/tenants', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      // B5: si el admin eligió un afiliado, lo asignamos en una segunda
      // request al endpoint de assignment (B3). No bloqueamos la creación
      // del tenant si la asignación falla — solo warneamos.
      if (form.referralCodeId && res?.tenant?.id) {
        try {
          await api(`/referrals/tenants/${res.tenant.id}/assignment`, {
            method: 'PATCH',
            body: JSON.stringify({ referralCodeId: form.referralCodeId }),
          });
        } catch (assignErr: any) {
          console.warn('Asignación referral falló:', assignErr?.message);
        }
      }
      setResult(res);
      // Negocio creado por una marca blanca → nace BLOQUEADO. Forzamos el popup
      // obligatorio de activación con créditos (usar o comprar).
      if (res?.requiresCreditActivation) {
        setShowCreditModal(true);
      }
    } catch (e: any) {
      setErr(e.message);
    }
  }

  if (result) {
    // La contraseña a mostrar: si la generó el backend → result.ownerTempPassword;
    // si el admin la entró manualmente → form.ownerPassword (la guardamos en
    // memoria al submit, no se pierde al cambiar el state).
    const password = result.ownerTempPassword || form.ownerPassword || '';
    const email = result.tenant.email;
    const brand = result.tenant.brandName;
    const phone = form.phone;
    const blocked = result.requiresCreditActivation && !activated;
    return (
      <div className="max-w-xl">
        {showCreditModal && (
          <CreditActivationModal
            tenantId={result.tenant.id}
            tenantName={brand}
            credits={credits}
            onActivated={(left) => {
              setActivated(true);
              setShowCreditModal(false);
              setCredits((c) => (c ? { ...c, available: left } : c));
            }}
            onSkip={() => setShowCreditModal(false)}
          />
        )}
        <div className="page-head">
          <h1 className="page-title">{t('resultPageTitle')}</h1>
        </div>
        {blocked && (
          <div className="card card-pad mb-3 border-2 border-warn/40 bg-warn-soft/40">
            <div className="flex items-start gap-2">
              <span className="text-xl leading-none">🔒</span>
              <div>
                <div className="font-semibold text-warn-ink">
                  {t('blockedTitle')}
                </div>
                <p className="text-sm text-warn-ink/90 mt-1 mb-3">
                  {t('blockedDescription')}
                </p>
                <button
                  className="btn-primary"
                  onClick={() => setShowCreditModal(true)}
                >
                  {t('activateNow')}
                </button>
              </div>
            </div>
          </div>
        )}
        {activated && (
          <div className="card card-pad mb-3 border-2 border-ok/30 bg-ok-soft/40">
            <div className="flex items-center gap-2 text-ok-ink font-semibold">
              <Icon name="check" size={18} /> {t('activatedBanner')}
            </div>
          </div>
        )}
        <div className="card card-pad">
          <div className="flex items-center gap-2 text-ok">
            <Icon name="check" size={22} />
            <h3 className="m-0 text-lg font-semibold">{t('brandReady', { brand })}</h3>
          </div>
          <p className="text-sm text-mute mt-1.5 mb-4">
            {t('credentialsHint')}
          </p>

          <div className="space-y-2.5">
            <CredentialRow label={t('credUserEmail')} value={email} />
            {password && (
              <CredentialRow label={t('credPassword')} value={password} mono highlight />
            )}
            {phone && <CredentialRow label={t('credPhone')} value={phone} />}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <SendButton
              kind="email"
              email={email}
              brand={brand}
              password={password}
              loginUrl="https://soyclubify.com/login"
            />
            <SendButton
              kind="whatsapp"
              phone={phone}
              email={email}
              brand={brand}
              password={password}
              loginUrl="https://soyclubify.com/login"
            />
          </div>

          <div className="mt-6 flex gap-2.5 pt-4 border-t border-line">
            <button className="btn-ghost" onClick={() => setResult(null)}>
              {t('createAnother')}
            </button>
            <button
              className="btn-primary"
              onClick={() => router.push('/admin/tenants')}
            >
              {t('backToList')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="page-head">
        <h1 className="page-title">
          {t('pageTitle')} <span className="page-crumb">{t('pageCrumb')}</span>
        </h1>
      </div>

      <form onSubmit={submit} className="card card-pad grid grid-cols-2 gap-3.5">
        <div className="col-span-2">
          <label className="label">{t('fieldBrandName')}</label>
          <input
            className="input"
            value={form.brandName}
            onChange={(e) => set('brandName', e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">{t('fieldOwnerEmail')}</label>
          <input
            className="input"
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">{t('fieldPhone')}</label>
          <PhoneInput
            value={form.phone}
            onChange={(v) => set('phone', v)}
            placeholder="3001234567"
          />
          <div className="text-[11px] text-mute mt-1">
            {t('phoneHint')}
          </div>
        </div>
        <div>
          <label className="label">{t('fieldOwnerName')}</label>
          <input
            className="input"
            value={form.ownerFullName}
            onChange={(e) => set('ownerFullName', e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">{t('fieldPassword')}</label>
          <input
            className="input"
            placeholder={t('phPassword')}
            value={form.ownerPassword}
            onChange={(e) => set('ownerPassword', e.target.value)}
          />
        </div>
        {/* El selector de Plan lista los planes de Clubify (Hotmart). Para
            admins de MARCA BLANCA (credits != null) NO aplica — sus negocios se
            crean sin plan (la marca maneja sus propios planes). Lo ocultamos. */}
        {credits === null && (
          <div>
            <label className="label">{t('fieldPlan')}</label>
            <select
              className="input"
              value={form.planId}
              onChange={(e) => set('planId', e.target.value)}
            >
              {/* #9: "Sin plan" permite crear el negocio aunque la marca no tenga
                  planes configurados (ej. Sellea). */}
              <option value="">{t('noPlan')}</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {!form.planId && (
              <div className="text-[11px] text-mute mt-1">
                {t('noPlanHint')}
              </div>
            )}
          </div>
        )}
        <div className="col-span-2">
          <label className="label">
            {t('fieldPeriodicity')}{' '}
            <span className="text-mute font-normal">{t('periodicityNote')}</span>
          </label>
          {/* Periodicidades CONFIGURABLES por marca (Master Admin → Marca →
              planPeriodicities). Sin marca (Clubify) o sin config → las 4. */}
          {(() => {
            const ALL = [
              { v: 'MENSUAL' as const, label: t('periodicityMonthly') },
              { v: 'TRIMESTRAL' as const, label: t('periodicityQuarterly') },
              { v: 'SEMESTRAL' as const, label: t('periodicitySemiannual') },
              { v: 'ANUAL' as const, label: t('periodicityAnnual') },
            ];
            const allowed = credits?.planPeriodicities?.length
              ? credits.planPeriodicities
              : null;
            const opts = allowed ? ALL.filter((o) => allowed.includes(o.v)) : ALL;
            const cols = opts.length <= 2 ? 'grid-cols-2' : opts.length === 3 ? 'grid-cols-3' : 'grid-cols-4';
            return (
          <div className={`grid ${cols} gap-2`}>
            {opts.map((opt) => {
              const active = form.planPeriodicity === opt.v;
              return (
                <button
                  type="button"
                  key={opt.v}
                  onClick={() => set('planPeriodicity', active ? '' : opt.v)}
                  className={`rounded-input border-2 p-2.5 text-sm font-semibold transition ${
                    active
                      ? 'border-brand bg-brand-soft text-brand-700'
                      : 'border-line bg-white text-ink hover:border-brand/40'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
            );
          })()}
          <div className="text-[11px] text-mute mt-1">
            {t('periodicityHint')}
          </div>
        </div>
        {/* #10: la asignación a afiliados solo se muestra si la marca activa
            tiene el módulo REFERRALS habilitado. */}
        {referralsEnabled && (
          <div className="col-span-2">
            <label className="label">
              {t('fieldAssignAffiliate')}{' '}
              <span className="text-mute font-normal">{t('optionalSuffix')}</span>
            </label>
            <AffiliatePickerSearch
              value={form.referralCodeId}
              onChange={(id) => set('referralCodeId', id)}
              placeholder={t('phAffiliateSearch')}
            />
            <div className="text-[11px] text-mute mt-1 leading-snug">
              {t('assignAffiliateHint')}
            </div>
          </div>
        )}

        <div className="col-span-2">
          <label className="label">{t('fieldCategory')}</label>
          <select
            className="input"
            value={form.businessCategorySlug}
            onChange={(e) => set('businessCategorySlug', e.target.value)}
            required
          >
            {BUSINESS_CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.emoji} {c.name}
              </option>
            ))}
          </select>
          <div className="text-[11px] text-mute mt-1 leading-relaxed">
            {t.rich('categoryHint', {
              a: (chunks) => (
                <a
                  href="/admin/business-categories"
                  target="_blank"
                  className="text-brand hover:underline"
                >
                  {chunks}
                </a>
              ),
            })}
          </div>
        </div>
        {/* Marca blanca: la activación es con créditos, no con Hotmart. */}
        {creditsLoaded && credits && (
          <div className="col-span-2 mt-2 border-t border-line2 pt-4">
            <div className="rounded-lg bg-brand-soft/50 border border-brand/20 px-3 py-3 text-sm">
              <div className="font-semibold text-brand-700">
                {t('creditActivationTitle')}
              </div>
              <p className="text-[13px] text-mute mt-1 mb-0">
                {t.rich('creditActivationDescription', {
                  strong: (chunks) => <strong>{chunks}</strong>,
                })}{' '}
                {credits.unlimited ? (
                  <span className="text-ok-ink font-medium">
                    {t('creditsUnlimited')}
                  </span>
                ) : (
                  <span>
                    {t.rich('creditsAvailable', {
                      count: credits.available,
                      strong: (chunks) => <strong>{chunks}</strong>,
                    })}
                  </span>
                )}
              </p>
            </div>
          </div>
        )}
        {/* Facturación / Hotmart — solo para Clubify (admin global, sin créditos). */}
        {creditsLoaded && !credits && (
        <div className="col-span-2 mt-2 border-t border-line2 pt-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-mute font-semibold mb-3">
            {t('billingSectionTitle')}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            {(
              [
                {
                  v: 'pending',
                  emoji: '🔒',
                  label: t('billingPendingLabel'),
                  hint: t('billingPendingHint'),
                },
                {
                  v: 'free',
                  emoji: '🎁',
                  label: t('billingFreeLabel'),
                  hint: t('billingFreeHint'),
                },
                {
                  v: 'trial',
                  emoji: '⏱',
                  label: t('billingTrialLabel'),
                  hint: t('billingTrialHint'),
                },
                {
                  v: 'paid',
                  emoji: '💳',
                  label: t('billingPaidLabel'),
                  hint: t('billingPaidHint'),
                },
              ] as const
            ).map((opt) => {
              const active = billingMode === opt.v;
              return (
                <button
                  type="button"
                  key={opt.v}
                  onClick={() => setBillingMode(opt.v)}
                  className={`text-left rounded-input border-2 p-3 transition ${
                    active
                      ? 'border-brand bg-brand-soft'
                      : 'border-line bg-white hover:border-brand/40'
                  }`}
                >
                  <div className="text-xl mb-0.5">{opt.emoji}</div>
                  <div className="text-sm font-semibold">{opt.label}</div>
                  <div className="text-[11px] text-mute mt-0.5">{opt.hint}</div>
                </button>
              );
            })}
          </div>

          {billingMode === 'trial' && (
            <div>
              <label className="label">{t('trialDaysLabel')}</label>
              <input
                className="input"
                type="number"
                min={1}
                max={365}
                value={form.trialDays}
                onChange={(e) =>
                  set('trialDays', Number(e.target.value) as any)
                }
              />
              <div className="text-[11px] text-mute mt-1">
                {t.rich('trialDaysHint', {
                  count: form.trialDays || 0,
                  strong: (chunks) => <strong>{chunks}</strong>,
                })}
              </div>
            </div>
          )}

          {billingMode === 'paid' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{t('nextChargeLabel')}</label>
                <input
                  className="input"
                  type="date"
                  value={form.nextChargeDate}
                  onChange={(e) => set('nextChargeDate', e.target.value)}
                />
                <div className="text-[11px] text-mute mt-1">
                  {t('nextChargeHint')}
                </div>
              </div>
              <div>
                <label className="label">{t('subscriberCodeLabel')}</label>
                <input
                  className="input"
                  placeholder={t('phSubscriberCode')}
                  value={form.hotmartSubscriberCode}
                  onChange={(e) =>
                    set('hotmartSubscriberCode', e.target.value)
                  }
                />
                <div className="text-[11px] text-mute mt-1">
                  {t('subscriberCodeHint')}
                </div>
              </div>
            </div>
          )}

          {billingMode === 'pending' && (
            <div className="rounded-lg bg-bg2/60 px-3 py-2.5 text-xs text-mute">
              {t('pendingInfo')}
            </div>
          )}

          {billingMode === 'free' && (
            <div className="rounded-lg bg-ok-soft/50 border border-ok/20 px-3 py-2.5 text-xs text-ok-ink">
              {t('freeInfo')}
            </div>
          )}
        </div>
        )}

        {err && (
          <div className="col-span-2 rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink">
            {err}
          </div>
        )}
        <div className="col-span-2 mt-2">
          <button className="btn-primary" type="submit">
            <Icon name="check" /> {t('submitCreate')}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Popup OBLIGATORIO de activación tras crear un negocio en una marca blanca.
 * El negocio nace bloqueado; el admin debe usar 1 crédito (activa +30d) o
 * comprar más. No se puede cerrar por el backdrop — solo activando o eligiendo
 * "activar después" (el negocio queda bloqueado, como pide el flujo).
 */
function CreditActivationModal({
  tenantId,
  tenantName,
  credits,
  onActivated,
  onSkip,
}: {
  tenantId: string;
  tenantName: string;
  credits: { available: number; unlimited: boolean; buyLinks: any[] } | null;
  onActivated: (creditsLeft: number) => void;
  onSkip: () => void;
}) {
  const t = useTranslations('admin_tenants_new');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canUseCredit = !!credits && (credits.unlimited || credits.available >= 1);
  const buyLinks = credits?.buyLinks ?? [];

  async function useCredit() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api<{ consumed: number; creditsAvailable: number }>(
        `/admin/credits/activate/${tenantId}`,
        { method: 'POST' },
      );
      onActivated(res?.creditsAvailable ?? 0);
    } catch (e: any) {
      setErr(e?.message ?? t('errorCouldNotActivate'));
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,30,22,.6)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="w-full max-w-md rounded-[16px] bg-white p-6"
        style={{ boxShadow: '0 20px 50px rgba(0,0,0,.3)' }}
      >
        <h3 className="m-0 text-lg font-bold text-ink">{t('modalActivate', { tenantName })}</h3>
        <p className="text-sm text-mute mt-1.5">
          {t.rich('modalActivateDescription', {
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </p>

        {!credits?.unlimited && (
          <div className="mt-4 rounded-lg bg-bg2/60 px-3 py-2.5 text-sm">
            {t.rich('modalCreditsAvailable', {
              count: credits?.available ?? 0,
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </div>
        )}

        {err && (
          <div className="mt-4 rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink">
            {err}
          </div>
        )}

        <button
          onClick={useCredit}
          disabled={!canUseCredit || busy}
          className="btn-primary w-full justify-center mt-4 disabled:opacity-50"
        >
          {busy
            ? t('activating')
            : credits?.unlimited
            ? t('activateBusiness')
            : t('useOneCredit')}
        </button>

        {!canUseCredit && !credits?.unlimited && (
          <p className="text-xs text-warn-ink mt-2 text-center">
            {t('noCreditsAvailable')}
          </p>
        )}

        {buyLinks.length > 0 && (
          <div className="mt-5 border-t border-line pt-4">
            <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
              {t('buyCredits')}
            </div>
            <div className="space-y-2">
              {buyLinks.map((l: any) => (
                <a
                  key={l.id ?? l.url}
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5 text-sm hover:bg-bg2"
                >
                  <span className="font-medium">{l.label}</span>
                  <span className="text-brand font-semibold">{t('buy')} →</span>
                </a>
              ))}
            </div>
            <p className="text-[11px] text-mute mt-2">
              {t.rich('buyCreditsHint', {
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
          </div>
        )}

        <button
          onClick={onSkip}
          disabled={busy}
          className="block w-full text-center text-xs text-mute hover:text-ink mt-5"
        >
          {t('activateLater')}
        </button>
      </div>
    </div>
  );
}

function CredentialRow({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  const t = useTranslations('admin_tenants_new');
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }
  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-3 py-2.5 ${
        highlight ? 'bg-warn-soft' : 'bg-bg2/50'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div
          className={`text-[10px] uppercase tracking-wider font-semibold ${
            highlight ? 'text-warn-ink' : 'text-mute'
          }`}
        >
          {label}
        </div>
        <div
          className={`text-sm truncate ${mono ? 'font-mono' : ''} ${
            highlight ? 'text-warn-ink font-semibold' : 'text-ink'
          }`}
        >
          {value}
        </div>
      </div>
      <button
        onClick={copy}
        className="shrink-0 text-xs font-semibold px-2.5 py-1.5 rounded-md bg-white border border-line hover:bg-bg2"
        type="button"
      >
        {copied ? `✓ ${t('copied')}` : t('copy')}
      </button>
    </div>
  );
}

function SendButton({
  kind,
  email,
  phone,
  brand,
  password,
  loginUrl,
}: {
  kind: 'email' | 'whatsapp';
  email?: string;
  phone?: string;
  brand: string;
  password: string;
  loginUrl: string;
}) {
  const t = useTranslations('admin_tenants_new');
  const body = t('sendMessageBody', {
    brand,
    email: email ?? '',
    password,
    loginUrl,
  });
  if (kind === 'email') {
    const href = `mailto:${encodeURIComponent(email ?? '')}?subject=${encodeURIComponent(
      t('sendEmailSubject', { brand }),
    )}&body=${encodeURIComponent(body)}`;
    return (
      <a
        href={href}
        className="text-center text-sm font-semibold py-2.5 rounded-lg bg-white border border-line hover:bg-bg2"
      >
        ✉ {t('sendByEmail')}
      </a>
    );
  }
  // WhatsApp: requiere teléfono. Si no hay, deshabilitamos.
  if (!phone) {
    return (
      <button
        disabled
        className="text-sm font-semibold py-2.5 rounded-lg bg-bg2/50 text-mute cursor-not-allowed"
      >
        {t('whatsappNoPhone')}
      </button>
    );
  }
  const cleanPhone = phone.replace(/\D/g, '');
  const href = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(body)}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-center text-sm font-semibold py-2.5 rounded-lg bg-[#25D366] text-white hover:opacity-95"
    >
      💬 {t('sendByWhatsapp')}
    </a>
  );
}
