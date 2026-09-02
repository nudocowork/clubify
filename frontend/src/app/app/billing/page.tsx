'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { api, clearSession } from '@/lib/api';
import { useHidesPurchases } from '@/lib/native';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { ConstructionBadge } from '@/components/UnderConstruction';
import {
  formatPlanLabel,
  periodCadence,
  periodLabel,
  periodTotalUsd,
  type PlanPeriodicity,
} from '@/lib/plan-format';

// Catálogo de features de la suscripción (keys i18n). Si la marca define
// subscriptionFeatureKeys, se muestran SOLO las que estén acá Y en su lista
// (cada marca enseña solo lo que su plan incluye). Vacío = todas (Clubify).
const ALL_FEATURE_KEYS = [
  'featUnlimitedOrders',
  'featUnlimitedWalletCards',
  'featAppleGoogleWallet',
  'featMultiLocationStaff',
  'featCustomDomainAnalytics',
  'featWhatsappAutomations',
  'featEventMessages',
  'featAdvancedSegmentation',
  'featMessageTemplates',
  'featScannerPwa',
  'featTransactionalEmail',
  'featChatSupport',
] as const;
// Contacto default de Clubify (solo si el negocio NO es de una marca blanca).
const CLUBIFY_SUPPORT_WA = '573167689240';
const CLUBIFY_SUPPORT_EMAIL = 'hola@soyclubify.com';

type Status = {
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'EXPIRED' | 'CANCELED';
  daysLeftInTrial: number | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  isActiveAccess: boolean;
  // Prueba PAGA (tarjeta anclada, ej. 7 días de Sellea): en TRIAL pero con cobro
  // automático al terminar. NO es la prueba gratis ("Esperando pago").
  paidTrial?: boolean;
};

const STATUS_LABELS: Record<Status['status'], { text: string; bg: string; ring: string }> = {
  TRIAL: { text: 'Esperando pago', bg: 'bg-brand-soft text-brand-700', ring: 'ring-brand/30' },
  ACTIVE: { text: 'Suscripción activa', bg: 'bg-ok-soft text-ok', ring: 'ring-ok/30' },
  PAST_DUE: { text: 'Pago pendiente', bg: 'bg-amber-100 text-amber-800', ring: 'ring-amber-300' },
  EXPIRED: { text: 'Cuenta inactiva', bg: 'bg-red-100 text-red-800', ring: 'ring-red-300' },
  SUSPENDED: { text: 'Suspendida', bg: 'bg-red-100 text-red-800', ring: 'ring-red-300' },
  CANCELED: { text: 'Cancelada', bg: 'bg-bg2 text-mute', ring: 'ring-line' },
};

export default function BillingPage() {
  const t = useTranslations('app_billing');
  const router = useRouter();
  // iOS: sin CTA de compra. Apple exige su compra in-app para vender la
  // suscripción dentro de la app (guideline 3.1.1) — el plan se activa
  // desde el navegador. Cancelar y ver el estado sí se quedan.
  const sinCompras = useHidesPurchases();
  const [s, setS] = useState<Status | null>(null);
  const [tenant, setTenant] = useState<any>(null);
  // Marca que el fetch de /tenants/me YA terminó (con éxito o error). Sin esto,
  // gatear el render con `!tenant` colgaría la página para siempre si el endpoint
  // falla (el .catch deja tenant en null). Con el flag: si falla, renderizamos
  // igual (el panel full es null-safe con tenant?.).
  const [tenantLoaded, setTenantLoaded] = useState(false);
  const [hotmartConfigured, setHotmartConfigured] = useState(false);
  const [activating, setActivating] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [canceling, setCanceling] = useState(false);
  const justSuspended =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('suspended') === '1';

  useEffect(() => {
    api<Status>('/billing/status').then(setS).catch(() => null);
    api<any>('/tenants/me')
      .then(setTenant)
      .catch(() => null)
      .finally(() => setTenantLoaded(true));
    api<{ configured: boolean }>('/billing/hotmart/config')
      .then((r) => setHotmartConfigured(!!r?.configured))
      .catch(() => setHotmartConfigured(false));
  }, []);

  async function activateSubscription(planOverride?: string) {
    setActivating(true);
    try {
      const qs = planOverride ? `?plan=${encodeURIComponent(planOverride)}` : '';
      const r = await api<{ url: string | null; reason?: string }>(
        `/billing/hotmart/checkout-url${qs}`,
      );
      if (r.url) {
        window.location.href = r.url;
      } else {
        toast(t('paymentNotConfigured'), 'info');
        setActivating(false);
      }
    } catch (e: any) {
      toast(e.message || t('couldNotOpenCheckout'), 'error');
      setActivating(false);
    }
  }

  async function confirmCancel() {
    setCanceling(true);
    try {
      await api('/billing/cancel', {
        method: 'POST',
        body: JSON.stringify({ reason: cancelReason || undefined }),
      });
      clearSession();
      router.push('/login?canceled=1');
    } catch (e: any) {
      toast(e.message || t('couldNotCancel'), 'error');
      setCanceling(false);
    }
  }

  async function reactivate() {
    if (!confirm(t('reactivateConfirm'))) {
      return;
    }
    try {
      await api('/billing/reactivate', { method: 'POST' });
      toast(t('accountReactivated'), 'success');
      setTimeout(() => window.location.reload(), 800);
    } catch (e: any) {
      toast(e.message || t('couldNotReactivate'), 'error');
    }
  }

  if (!s) return <div className="text-mute">{t('loading')}</div>;
  // Esperamos a que /tenants/me TERMINE (éxito o error): sin saber el tipo de
  // negocio, pintar el panel full por un instante mostraría info errada al
  // InfoLink. Si el fetch falló (tenant null pero cargado), cae al panel full
  // null-safe en vez de colgarse.
  if (!tenantLoaded) return <div className="text-mute">{t('loading')}</div>;

  // Negocios "Solo InfoLink" (freemium Sellea): su panel es Gratis/PRO, NO el de
  // la suscripción COMPLETA ($80, Pedidos ilimitados, Wallet…). Mostrarles ese
  // panel era información errada (reporte del dueño 2026-09-02). Panel propio:
  if (tenant?.businessType === 'INFOLINK') {
    return (
      <InfolinkSubscriptionPanel
        tenant={tenant}
        currentPeriodEnd={s.currentPeriodEnd}
        sinCompras={sinCompras}
      />
    );
  }

  const meta = STATUS_LABELS[s.status];

  // ── Derivaciones por MARCA del negocio (de /tenants/me) ──
  // Contacto: WhatsApp/email de la marca; si el negocio es de Clubify (sin
  // marca), el contacto default de Clubify.
  const brandWaDigits = (tenant?.brandSupportWhatsApp || '').replace(/[^0-9]/g, '');
  const supportWaHref = `https://wa.me/${brandWaDigits || CLUBIFY_SUPPORT_WA}`;
  const supportEmail = tenant?.brandContactEmail || CLUBIFY_SUPPORT_EMAIL;
  const supportEmailHref = `mailto:${supportEmail}`;

  // Beneficios: la marca enseña SOLO los features que su plan incluye. Si no
  // configuró ninguno (o es Clubify), se muestra la lista completa.
  const brandFeatureKeys: string[] = Array.isArray(tenant?.brandSubscriptionFeatureKeys)
    ? tenant!.brandSubscriptionFeatureKeys
    : [];
  const featureKeys = brandFeatureKeys.length
    ? ALL_FEATURE_KEYS.filter((k) => brandFeatureKeys.includes(k))
    : [...ALL_FEATURE_KEYS];

  // Estado: con plan asignado mostramos "Suscripción activa · Mensual/Anual"
  // (NO "Sin plan"). Periodicidad de la metadata del tenant.
  const periodicity = (tenant?.planPeriodicity as PlanPeriodicity | null) ?? null;
  const hasPlan = s.status === 'ACTIVE' || !!periodicity;
  const statusActiveText =
    t('statusActive') + (periodicity ? ` · ${periodLabel(periodicity)}` : '');
  // Etiqueta del plan (columna derecha). Si el row de Plan es el placeholder
  // "Sin plan" pero el negocio ya tiene plan, mostramos la periodicidad.
  const planName: string | undefined = tenant?.plan?.name;
  const isPlaceholderPlan =
    !planName || planName.trim().toLowerCase() === 'sin plan';
  const planLabel =
    hasPlan && isPlaceholderPlan
      ? `Suscripción · ${periodLabel(periodicity)}`
      : formatPlanLabel(planName, periodicity);
  // Precio del ciclo: precio REAL de la marca del negocio (Sellea 80/799) desde
  // tenant.brandPlans (/tenants/me) — host-independiente; fallback al genérico.
  const planPriceUsd = (() => {
    const p = periodicity ?? 'MENSUAL';
    const brandPrice = (tenant?.brandPlans as { periodicity: string; amountUsd: number | null }[] | undefined)?.find(
      (bp) => bp.periodicity === p,
    )?.amountUsd;
    return brandPrice && brandPrice > 0
      ? brandPrice
      : periodTotalUsd(p, Number(tenant?.plan?.priceMonthly ?? 0));
  })();

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-mute mt-1">
          {t('subtitle')}
        </p>
      </div>

      {justSuspended && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 mb-4">
          {t('suspendedNotice')}
        </div>
      )}

      {/* Estado actual */}
      <div className={`card card-pad ring-1 ${meta.ring}`}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full ${meta.bg}`}>
                {s.paidTrial ? 'En prueba' : t(`badge_${s.status}`)}
              </span>
            </div>
            <div className="mt-3 text-3xl font-bold">
              {s.status === 'TRIAL'
                ? s.paidTrial
                  ? 'Prueba activa'
                  : t('statusTrial')
                : s.status === 'ACTIVE'
                ? statusActiveText
                : s.status === 'EXPIRED'
                ? t('statusExpired')
                : s.status === 'SUSPENDED'
                ? t('statusSuspended')
                : s.status === 'PAST_DUE'
                ? t('statusPastDue')
                : t('statusNone')}
            </div>
            {s.status === 'TRIAL' && (
              // Prueba paga (Sellea): la tarjeta ya está anclada; el cobro llega
              // solo al terminar la prueba. No se le pide "completar el pago".
              s.paidTrial ? (
                <div className="text-sm text-mute mt-1">
                  {s.trialEndsAt ? (
                    <>
                      Primer cobro el{' '}
                      <span className="font-medium text-ink">
                        {new Date(s.trialEndsAt).toLocaleDateString('es-CO', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })}
                      </span>
                      {typeof s.daysLeftInTrial === 'number'
                        ? ` (en ${s.daysLeftInTrial} ${s.daysLeftInTrial === 1 ? 'día' : 'días'}).`
                        : '.'}
                    </>
                  ) : (
                    'Tu prueba está activa.'
                  )}
                </div>
              ) : (
                <div className="text-sm text-mute mt-1">
                  {t('completePaymentHotmart')}
                </div>
              )
            )}
            {s.status === 'ACTIVE' && s.currentPeriodEnd && (
              <div className="text-sm text-mute mt-1">
                {t('nextCharge')}{' '}
                <span className="font-medium text-ink">
                  {new Date(s.currentPeriodEnd).toLocaleDateString('es-CO', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-mute font-semibold">
              {t('currentPlan')}
            </div>
            <div className="text-lg font-semibold mt-1">
              {planLabel}
            </div>
            <div className="text-sm text-mute mt-0.5">
              USD {planPriceUsd}
              {periodCadence(tenant?.planPeriodicity as PlanPeriodicity | null)}
            </div>
            <div className="text-xs text-mute">
              {t('exchangeRateNote')}
            </div>
          </div>
        </div>

      </div>

      {/* CTA principal — NO en prueba paga: la tarjeta ya está anclada y el
          cobro es automático, así que no se le pide "activar/pagar". */}
      {sinCompras && ((s.status === 'TRIAL' && !s.paidTrial) || s.status === 'EXPIRED' || s.status === 'PAST_DUE') && (
        <div className="card card-pad mt-4">
          <div className="font-bold text-lg">
            {s.status === 'TRIAL' ? 'Activa tu suscripción' : 'Activa tu cuenta'}
          </div>
          <p className="text-sm text-mute mt-1.5 leading-relaxed">
            La activación del plan se hace desde el panel web. Aquí puedes
            seguir viendo el estado de tu cuenta y tus cobros.
          </p>
        </div>
      )}

      {!sinCompras && ((s.status === 'TRIAL' && !s.paidTrial) || s.status === 'EXPIRED' || s.status === 'PAST_DUE') && (
        <div className="card card-pad mt-4 bg-gradient-to-br from-brand-400 to-brand-700 text-white">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="font-bold text-xl">
                  {s.status === 'TRIAL' ? t('activateSubscription') : t('activateAccount')}
                </div>
                {!hotmartConfigured && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-300/95 text-amber-900">
                    {t('underConstruction')}
                  </span>
                )}
              </div>
              <p className="text-white/85 text-sm mt-1.5 leading-relaxed">
                {hotmartConfigured
                  ? t('ctaDescConfigured')
                  : t('ctaDescNotConfigured')}
              </p>
              {!hotmartConfigured && (
                <p className="text-white/70 text-xs mt-2">
                  {t.rich('manualActivation', {
                    wa: (chunks) => (
                      <a
                        href={supportWaHref}
                        target="_blank"
                        className="underline hover:text-white"
                      >
                        {chunks}
                      </a>
                    ),
                  })}
                </p>
              )}
            </div>
            <button
              onClick={() => activateSubscription()}
              disabled={!hotmartConfigured || activating}
              className={`bg-white/95 text-brand-700 font-semibold px-5 py-2.5 rounded-pill text-sm whitespace-nowrap ${
                hotmartConfigured
                  ? 'hover:bg-white'
                  : 'opacity-70 cursor-not-allowed'
              }`}
              title={hotmartConfigured ? t('activate') : t('availableSoon')}
            >
              {activating
                ? t('openingCheckout')
                : t('activateSubscriptionCta')}
            </button>
          </div>
        </div>
      )}

      {/* Reactivar (cuando cuenta está suspendida) */}
      {s.status === 'SUSPENDED' && (
        <div className="card card-pad mt-4 bg-gradient-to-br from-ok to-emerald-600 text-white">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="font-bold text-xl">{t('backToClubify')}</div>
              <p className="text-white/85 text-sm mt-1.5 leading-relaxed">
                {t('reactivateDesc')}
              </p>
            </div>
            <button
              onClick={reactivate}
              className="bg-white text-ok font-semibold px-5 py-2.5 rounded-pill text-sm whitespace-nowrap hover:bg-white/90"
            >
              {t('reactivateMyAccount')}
            </button>
          </div>
        </div>
      )}

      {/* Lo que incluye — todos los planes (Mensual/Trimestral/Semestral/Anual) */}
      <div className="card card-pad mt-4">
        <div className="font-semibold mb-3">{t('subscriptionIncludes')}</div>
        <ul className="grid sm:grid-cols-2 gap-2 text-sm">
          {featureKeys.map((k) => t(k)).map((f) => (
            <li key={f} className="flex items-start gap-2 text-mute">
              <Icon name="check" size={14} className="text-ok mt-0.5 flex-none" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Cancelar */}
      {(s.status === 'TRIAL' || s.status === 'ACTIVE') && (
        <div className="mt-6 text-center">
          <button
            onClick={() => setCancelOpen(true)}
            className="text-xs text-mute hover:text-bad underline"
          >
            {t('cancelMyAccount')}
          </button>
        </div>
      )}

      <div className="text-xs text-mute mt-6 text-center">
        {t.rich('questionsFooter', {
          wa: (chunks) => (
            <a href={supportWaHref} className="text-brand hover:underline">
              {chunks}
            </a>
          ),
          email: (chunks) => (
            <a href={supportEmailHref} className="text-brand hover:underline">
              {chunks}
            </a>
          ),
        })}
      </div>

      {/* Modal de cancelación */}
      {cancelOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-ink/60"
            onClick={() => !canceling && setCancelOpen(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h2 className="text-lg font-bold">{t('cancelModalTitle')}</h2>
            <p className="text-sm text-mute mt-2 leading-relaxed">
              {t('cancelModalDesc')}
            </p>
            <div className="mt-4">
              <label className="label">{t('cancelReasonLabel')}</label>
              <textarea
                className="input"
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder={t('cancelReasonPlaceholder')}
              />
            </div>
            <div className="mt-5 flex gap-2 justify-end">
              <button
                onClick={() => setCancelOpen(false)}
                disabled={canceling}
                className="btn-ghost text-sm"
              >
                {t('keepMyAccount')}
              </button>
              <button
                onClick={confirmCancel}
                disabled={canceling}
                className="px-4 py-2 rounded-pill bg-bad text-white text-sm font-semibold disabled:opacity-50"
              >
                {canceling ? t('canceling') : t('confirmCancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Panel de suscripción para negocios "Solo InfoLink" (freemium Sellea) ──────
// Reemplaza el panel de suscripción COMPLETA cuando el negocio es INFOLINK: no
// paga los $80 del Completo. Gratis = sin vencimiento; PRO = $14.99/mes con
// upgrade al Payment Link INFOLINK_PRO de la marca.
function InfolinkSubscriptionPanel({
  tenant,
  currentPeriodEnd,
  sinCompras,
}: {
  tenant: any;
  currentPeriodEnd: string | null;
  sinCompras: boolean;
}) {
  const isPro = tenant?.infolinkTier === 'PRO';
  const proLink = (tenant?.whiteLabel?.paymentLinks as any[] | undefined)?.find(
    (l) => l?.productKey === 'INFOLINK_PRO',
  );
  const proUrl: string | null = proLink?.url ?? null;
  const proPrice = proLink?.amountUsd != null ? Number(proLink.amountUsd) : 14.99;

  const FREE_FEATURES = [
    '1 InfoLink personalizado',
    'Hasta 5 botones',
    'Redes sociales + WhatsApp',
    'Plantillas y colores básicos',
    'Estadísticas esenciales',
  ];
  const PRO_FEATURES = [
    'Botones ilimitados',
    'Sin publicidad de Sellea',
    'Todas las plantillas y fondos',
    'Colores personalizados',
    'Analítica avanzada',
  ];
  const features = isPro ? PRO_FEATURES : FREE_FEATURES;

  const brandWaDigits = (tenant?.brandSupportWhatsApp || '').replace(/[^0-9]/g, '');
  const supportWaHref = `https://wa.me/${brandWaDigits || CLUBIFY_SUPPORT_WA}`;
  const supportEmail = tenant?.brandContactEmail || CLUBIFY_SUPPORT_EMAIL;

  const nextChargeDate =
    isPro && currentPeriodEnd
      ? new Date(currentPeriodEnd).toLocaleDateString('es-CO', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : null;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Tu plan InfoLink</h1>
        <p className="text-mute mt-1">Estado de tu InfoLink y opciones para mejorar.</p>
      </div>

      <div className="card card-pad ring-1 ring-line">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <span
              className={`text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full ${
                isPro ? 'bg-brand-soft text-brand-700' : 'bg-ok-soft text-ok'
              }`}
            >
              {isPro ? 'InfoLink PRO' : 'Plan Gratis'}
            </span>
            <div className="mt-3 text-3xl font-bold">{isPro ? `$${proPrice} USD` : '$0'}</div>
            <div className="text-sm text-mute mt-1">
              {isPro ? (
                nextChargeDate ? (
                  <>
                    Próximo cobro <span className="font-medium text-ink">{nextChargeDate}</span>
                  </>
                ) : (
                  'Facturación mensual'
                )
              ) : (
                'Gratis · sin fecha de vencimiento'
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-mute font-semibold">Plan actual</div>
            <div className="text-lg font-semibold mt-1">{isPro ? 'InfoLink PRO' : 'InfoLink Gratis'}</div>
          </div>
        </div>
      </div>

      {/* Upgrade a PRO — solo en plan Gratis, con Payment Link configurado, y NO
          en iOS (Apple exige compra in-app). */}
      {!isPro && proUrl && !sinCompras && (
        <a
          href={proUrl}
          target="_blank"
          rel="noreferrer"
          className="no-underline mt-4 flex items-center gap-3 rounded-2xl px-4 py-3"
          style={{ background: 'linear-gradient(120deg,#FF4D3D,#E63521)', color: '#fff' }}
        >
          <span style={{ fontSize: 22 }}>⚡</span>
          <span className="flex-1">
            <b className="text-[15px]">Mejora tu InfoLink a PRO</b>
            <span className="block text-[12.5px]" style={{ color: 'rgba(255,255,255,.85)' }}>
              Botones ilimitados, sin publicidad, todas las plantillas y analítica avanzada.
            </span>
          </span>
          <span
            className="font-extrabold text-[13px] whitespace-nowrap flex-none rounded-full px-4 py-2"
            style={{ background: '#fff', color: '#E63521' }}
          >
            Mejorar · ${proPrice}/mes →
          </span>
        </a>
      )}

      <div className="card card-pad mt-4">
        <h3 className="font-semibold m-0 mb-3">Tu {isPro ? 'plan PRO' : 'plan Gratis'} incluye</h3>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 list-none p-0 m-0">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm">
              <span className="text-ok font-bold flex-none">✓</span> {f}
            </li>
          ))}
        </ul>
      </div>

      <div className="text-sm text-mute mt-6 text-center">
        ¿Dudas? Escríbenos por{' '}
        <a href={supportWaHref} target="_blank" rel="noreferrer" className="text-brand hover:underline">
          WhatsApp
        </a>{' '}
        o{' '}
        <a href={`mailto:${supportEmail}`} className="text-brand hover:underline">
          email
        </a>
        .
      </div>
    </div>
  );
}
