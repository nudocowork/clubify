'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { ImageUploader } from '@/components/ImageUploader';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

type PlanId = 'mensual' | 'trimestral' | 'semestral' | 'anual';
type LandingPlan = { price: number; checkoutUrl: string | null };
type LandingPlans = Record<PlanId, LandingPlan>;

const PLAN_LABEL_KEY: Record<PlanId, { label: string; sub: string }> = {
  mensual: { label: 'planMensualLabel', sub: 'planMensualSub' },
  trimestral: { label: 'planTrimestralLabel', sub: 'planTrimestralSub' },
  semestral: { label: 'planSemestralLabel', sub: 'planSemestralSub' },
  anual: { label: 'planAnualLabel', sub: 'planAnualSub' },
};

/** Tarjeta con las medidas recomendadas para cada logo (formato/tamaño/peso/uso). */
function BrandGuide({
  formato,
  tamano,
  ratio,
  peso,
  uso,
}: {
  formato: string;
  tamano: string;
  ratio?: string;
  peso: string;
  uso: string;
}) {
  const t = useTranslations('admin_branding');
  return (
    <div className="mt-2 text-[11px] leading-relaxed text-mute bg-bg2/60 border border-line rounded-lg px-3 py-2">
      <span className="font-semibold text-ink">{t('guideFormat')}</span> {formato} ·{' '}
      <span className="font-semibold text-ink">{t('guideSize')}</span> {tamano}
      {ratio ? (
        <>
          {' '}· <span className="font-semibold text-ink">{t('guideRatio')}</span> {ratio}
        </>
      ) : null}{' '}
      · <span className="font-semibold text-ink">{t('guideMaxWeight')}</span> {peso}
      <br />
      <span className="font-semibold text-ink">{t('guideUsage')}</span> {uso}
    </div>
  );
}

const PLAN_ORDER: PlanId[] = ['mensual', 'trimestral', 'semestral', 'anual'];

const DEFAULT_PLANS: LandingPlans = {
  mensual: { price: 68, checkoutUrl: null },
  trimestral: { price: 150, checkoutUrl: null },
  semestral: { price: 278, checkoutUrl: null },
  anual: { price: 500, checkoutUrl: null },
};

type Branding = {
  appLogoUrl: string | null;
  landingLogoUrl: string | null;
  faviconUrl: string | null;
  supportWhatsapp: string | null;
  scannerStaffPin: string | null;
  salesWhatsapp: string | null;
  salesEmail: string | null;
  salesInstagram: string | null;
  landingStatBusinesses: string | null;
  landingStatWalletCustomers: string | null;
  landingStatOrders: string | null;
  landingStatRating: string | null;
};

export default function AdminBrandingPage() {
  const t = useTranslations('admin_branding');
  const [b, setB] = useState<Branding>({
    appLogoUrl: null,
    landingLogoUrl: null,
    faviconUrl: null,
    supportWhatsapp: null,
    scannerStaffPin: null,
    salesWhatsapp: null,
    salesEmail: null,
    salesInstagram: null,
    landingStatBusinesses: null,
    landingStatWalletCustomers: null,
    landingStatOrders: null,
    landingStatRating: null,
  });
  const [plans, setPlans] = useState<LandingPlans>(DEFAULT_PLANS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      // Endpoint admin que SÍ devuelve scannerStaffPin (el público no, por seguridad)
      const [data, plansData] = await Promise.all([
        api<Branding>('/admin/branding'),
        api<LandingPlans>('/landing-plans'),
      ]);
      setB(data);
      setPlans(plansData);
    } catch (e: any) {
      toast(e.message || t('errorLoading'), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    try {
      await Promise.all([
        api('/admin/branding', {
          method: 'PATCH',
          body: JSON.stringify(b),
        }),
        api('/admin/landing-plans', {
          method: 'PATCH',
          body: JSON.stringify(plans),
        }),
      ]);
      toast(t('savedSuccess'), 'success');
    } catch (e: any) {
      toast(e.message || t('saveError'), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          {t('pageTitle')} <span className="page-crumb">{t('pageCrumb')}</span>
        </h1>
        <button className="btn-primary" onClick={save} disabled={saving || loading}>
          <Icon name="check" /> {saving ? t('saving') : t('saveChanges')}
        </button>
      </div>

      {loading ? (
        <div className="card card-pad">
          <div className="h-4 bg-bg2 rounded animate-shimmer mb-3" />
          <div className="h-40 bg-bg2 rounded animate-shimmer" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="card card-pad">
            <h2 className="text-base font-semibold m-0">{t('panelLogoTitle')}</h2>
            <p className="text-xs text-mute mt-1 leading-relaxed">
              {t('panelLogoDesc')}
            </p>
            <BrandGuide
              formato={t('formatPngTransparent')}
              tamano="512 × 512 px"
              ratio="1:1"
              peso="300 KB"
              uso={t('panelLogoUsage')}
            />
            <div className="mt-3.5">
              <ImageUploader
                value={b.appLogoUrl}
                onChange={(url) => setB({ ...b, appLogoUrl: url })}
                folder="branding"
                crop
                aspect={1}
                maxSizeMb={2}
                minDimensionWarn={false}
              />
            </div>
          </div>

          <div className="card card-pad">
            <h2 className="text-base font-semibold m-0">
              {t('landingLogoTitle')}
            </h2>
            <p className="text-xs text-mute mt-1 leading-relaxed">
              {t.rich('landingLogoDesc', {
                code: (chunks) => (
                  <code className="bg-bg2 px-1 rounded">{chunks}</code>
                ),
              })}
            </p>
            <BrandGuide
              formato={t('formatPngTransparent')}
              tamano="1200 × 400 px"
              ratio="3:1"
              peso="500 KB"
              uso={t('landingLogoUsage')}
            />
            <div className="mt-3.5">
              <ImageUploader
                value={b.landingLogoUrl}
                onChange={(url) => setB({ ...b, landingLogoUrl: url })}
                folder="branding"
                crop={false}
                maxSizeMb={2}
                minDimensionWarn={false}
              />
            </div>
          </div>

          <div className="card card-pad">
            <h2 className="text-base font-semibold m-0">{t('faviconTitle')}</h2>
            <p className="text-xs text-mute mt-1 leading-relaxed">
              {t('faviconDesc')}
            </p>
            <BrandGuide
              formato="PNG / ICO / SVG / WEBP"
              tamano="512 × 512 px"
              ratio="1:1"
              peso="200 KB"
              uso={t('faviconUsage')}
            />
            <div className="mt-3.5">
              <ImageUploader
                value={b.faviconUrl}
                onChange={(url) => setB({ ...b, faviconUrl: url })}
                folder="branding"
                crop
                aspect={1}
                maxSizeMb={1}
                minDimensionWarn={false}
              />
            </div>
          </div>
        </div>
      )}

      <div className="card card-pad mt-5">
        <h2 className="text-base font-semibold m-0">
          {t('commercialContactTitle')}
        </h2>
        <p className="text-xs text-mute mt-1 leading-relaxed">
          {t.rich('commercialContactDesc', {
            code: (chunks) => (
              <code className="bg-bg2 px-1 rounded">{chunks}</code>
            ),
          })}
        </p>
        <div className="mt-3.5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="label">{t('salesWhatsappLabel')}</label>
            <input
              type="text"
              className="input"
              placeholder="+57 300 000 0000"
              value={b.salesWhatsapp ?? ''}
              onChange={(e) => setB({ ...b, salesWhatsapp: e.target.value })}
            />
          </div>
          <div>
            <label className="label">{t('salesEmailLabel')}</label>
            <input
              type="email"
              className="input"
              placeholder="ventas@soyclubify.com"
              value={b.salesEmail ?? ''}
              onChange={(e) => setB({ ...b, salesEmail: e.target.value })}
            />
          </div>
          <div>
            <label className="label">{t('salesInstagramLabel')}</label>
            <input
              type="text"
              className="input"
              placeholder="https://instagram.com/clubify"
              value={b.salesInstagram ?? ''}
              onChange={(e) => setB({ ...b, salesInstagram: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="card card-pad mt-5">
        <h2 className="text-base font-semibold m-0">
          {t('landingPlansTitle')}
        </h2>
        <p className="text-xs text-mute mt-1 leading-relaxed">
          {t.rich('landingPlansDesc', {
            code: (chunks) => (
              <code className="bg-bg2 px-1 rounded">{chunks}</code>
            ),
          })}
        </p>
        <div className="mt-4 space-y-3">
          {PLAN_ORDER.map((id) => {
            const meta = PLAN_LABEL_KEY[id];
            const plan = plans[id];
            return (
              <div
                key={id}
                className="grid grid-cols-12 gap-3 items-end border border-line2 rounded-lg p-3"
              >
                <div className="col-span-12 sm:col-span-3">
                  <div className="font-semibold text-sm">{t(meta.label)}</div>
                  <div className="text-[11px] text-mute">{t(meta.sub)}</div>
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <label className="label">{t('priceUsdLabel')}</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    className="input"
                    value={plan.price}
                    onChange={(e) =>
                      setPlans({
                        ...plans,
                        [id]: {
                          ...plan,
                          price: Number(e.target.value) || 0,
                        },
                      })
                    }
                  />
                </div>
                <div className="col-span-8 sm:col-span-7">
                  <label className="label">{t('checkoutLinkLabel')}</label>
                  <input
                    type="url"
                    className="input"
                    placeholder="https://pay.hotmart.com/..."
                    value={plan.checkoutUrl ?? ''}
                    onChange={(e) =>
                      setPlans({
                        ...plans,
                        [id]: {
                          ...plan,
                          checkoutUrl: e.target.value || null,
                        },
                      })
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card card-pad mt-5">
        <h2 className="text-base font-semibold m-0">
          {t('landingStatsTitle')}
        </h2>
        <p className="text-xs text-mute mt-1 leading-relaxed">
          {t.rich('landingStatsDesc', {
            code: (chunks) => (
              <code className="bg-bg2 px-1 rounded">{chunks}</code>
            ),
          })}
        </p>
        <div className="mt-3.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="label">{t('statBusinessesLabel')}</label>
            <input
              type="text"
              className="input"
              placeholder="+150"
              maxLength={40}
              value={b.landingStatBusinesses ?? ''}
              onChange={(e) =>
                setB({ ...b, landingStatBusinesses: e.target.value })
              }
            />
          </div>
          <div>
            <label className="label">{t('statWalletCustomersLabel')}</label>
            <input
              type="text"
              className="input"
              placeholder="+30K"
              maxLength={40}
              value={b.landingStatWalletCustomers ?? ''}
              onChange={(e) =>
                setB({ ...b, landingStatWalletCustomers: e.target.value })
              }
            />
          </div>
          <div>
            <label className="label">{t('statOrdersLabel')}</label>
            <input
              type="text"
              className="input"
              placeholder="50K"
              maxLength={40}
              value={b.landingStatOrders ?? ''}
              onChange={(e) =>
                setB({ ...b, landingStatOrders: e.target.value })
              }
            />
          </div>
          <div>
            <label className="label">{t('statRatingLabel')}</label>
            <input
              type="text"
              className="input"
              placeholder="4.9 / 5"
              maxLength={40}
              value={b.landingStatRating ?? ''}
              onChange={(e) =>
                setB({ ...b, landingStatRating: e.target.value })
              }
            />
          </div>
        </div>
      </div>

      <div className="card card-pad mt-5">
        <h2 className="text-base font-semibold m-0">
          {t('scannerPinTitle')}
        </h2>
        <p className="text-xs text-mute mt-1 leading-relaxed">
          {t.rich('scannerPinDesc', {
            code: (chunks) => <code>{chunks}</code>,
            b: (chunks) => <b>{chunks}</b>,
          })}
        </p>
        <div className="mt-3.5 max-w-sm">
          <label className="label">{t('scannerPinLabel')}</label>
          <input
            type="text"
            inputMode="numeric"
            className="input font-mono tracking-widest"
            placeholder={t('scannerPinPlaceholder')}
            value={b.scannerStaffPin ?? ''}
            onChange={(e) =>
              setB({ ...b, scannerStaffPin: e.target.value })
            }
          />
        </div>
      </div>

      <div className="card card-pad mt-5">
        <h2 className="text-base font-semibold m-0">
          {t('supportWhatsappTitle')}
        </h2>
        <p className="text-xs text-mute mt-1 leading-relaxed">
          {t('supportWhatsappDesc')}
        </p>
        <div className="mt-3.5 max-w-sm">
          <label className="label">{t('supportWhatsappLabel')}</label>
          <input
            type="text"
            className="input"
            placeholder="+57 300 000 0000"
            value={b.supportWhatsapp ?? ''}
            onChange={(e) =>
              setB({ ...b, supportWhatsapp: e.target.value })
            }
          />
        </div>
      </div>

      <div className="card card-pad mt-5 bg-brand-soft border-brand/30">
        <h3 className="text-sm font-semibold m-0">{t('howAppliedTitle')}</h3>
        <ul className="text-xs text-mute mt-2 leading-relaxed space-y-1.5 list-disc pl-4">
          <li>{t('howAppliedItem1')}</li>
          <li>{t('howAppliedItem2')}</li>
          <li>{t('howAppliedItem3')}</li>
        </ul>
      </div>
    </div>
  );
}
