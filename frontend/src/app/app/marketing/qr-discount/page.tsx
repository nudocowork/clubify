'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { useTranslations } from 'next-intl';
import { EditorCargando } from '@/components/marketing/EditorCargando';

const QrPosterEditor = dynamic(
  () => import('@/components/marketing/QrPosterEditor'),
  { ssr: false, loading: () => <EditorCargando /> },
);

export default function QrDiscountPage() {
  const t = useTranslations('app_qr');
  const [tenant, setTenant] = useState<any>(null);

  useEffect(() => {
    api<any>('/tenants/me').then(setTenant).catch(() => null);
  }, []);

  if (!tenant) return <div className="text-mute">{t('loading')}</div>;

  const slug = tenant.slug ?? 'demo';
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://soyclubify.com';

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          <Link href="/app/marketing" className="text-mute hover:text-ink">
            {t('marketing')}
          </Link>{' '}
          <span className="page-crumb">/ {t('discountCrumb')}</span>
        </h1>
      </div>

      <p className="text-sm text-mute max-w-2xl mb-5 leading-relaxed">
        {t('discountIntro')}
      </p>

      <QrPosterEditor
        type="DISCOUNT"
        brandName={tenant.brandName ?? t('defaultBusiness')}
        logoUrl={tenant.walletLogoUrl || tenant.logoUrl || null}
        qrUrl={(meta) => {
          // Fix 2026-06-08: tras separación /m vs /d, el QR Descuento
          // debe llevar a /d/ (con carrito) sino el cliente ve el banner
          // del cupón pero no puede ordenar — conversión muere.
          const code = (meta?.promoCode ?? '').toString().trim();
          return code
            ? `${origin}/d/${slug}?promo=${encodeURIComponent(code)}`
            : `${origin}/d/${slug}`;
        }}
        metaSlot={(meta, setMeta) => (
          <div className="card card-pad space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
              {t('promoCode')}
            </div>
            <input
              type="text"
              value={meta?.promoCode ?? ''}
              onChange={(e) =>
                setMeta({ ...meta, promoCode: e.target.value.toUpperCase() })
              }
              placeholder={t('promoPlaceholder')}
              maxLength={32}
              className="input text-sm uppercase tracking-wider"
            />
            <div className="text-[11px] text-mute leading-relaxed">
              {t.rich('discountHint', {
                link: (c) => (
                  <Link href="/app/promos" className="text-brand underline">
                    {c}
                  </Link>
                ),
              })}
            </div>
          </div>
        )}
      />
    </div>
  );
}
