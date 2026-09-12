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

export default function QrReviewsPage() {
  const t = useTranslations('app_qr');
  const [tenant, setTenant] = useState<any>(null);

  useEffect(() => {
    api<any>('/tenants/me').then(setTenant).catch(() => null);
  }, []);

  if (!tenant) return <div className="text-mute">{t('loading')}</div>;

  const slug = tenant.slug ?? 'demo';
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://soyclubify.com';
  const qrUrl = `${origin}/r/${slug}`;
  const hasGoogleUrl = !!tenant.googleReviewUrl;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          <Link href="/app/marketing" className="text-mute hover:text-ink">
            {t('marketing')}
          </Link>{' '}
          <span className="page-crumb">/ {t('reviewsCrumb')}</span>
        </h1>
      </div>

      <p className="text-sm text-mute max-w-2xl mb-5 leading-relaxed">
        {t('reviewsIntro')}
      </p>

      {!hasGoogleUrl && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 mb-5 text-sm">
          <div className="font-semibold text-amber-900">
            {t('noGoogleUrlTitle')}
          </div>
          <div className="text-amber-800/90 mt-1">
            {t.rich('noGoogleUrlBody', {
              link: (c) => (
                <Link href="/app/reviews" className="underline font-semibold">
                  {c}
                </Link>
              ),
            })}
          </div>
        </div>
      )}

      <QrPosterEditor
        type="REVIEWS"
        qrUrl={qrUrl}
        brandName={tenant.brandName ?? t('defaultBusiness')}
        logoUrl={tenant.walletLogoUrl || tenant.logoUrl || null}
      />
    </div>
  );
}
