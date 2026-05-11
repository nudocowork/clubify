'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';

const QrPosterEditor = dynamic(
  () => import('@/components/marketing/QrPosterEditor'),
  { ssr: false, loading: () => <div className="text-mute py-8 text-center">Cargando editor…</div> },
);

export default function QrReviewsPage() {
  const [tenant, setTenant] = useState<any>(null);

  useEffect(() => {
    api<any>('/tenants/me').then(setTenant).catch(() => null);
  }, []);

  if (!tenant) return <div className="text-mute">Cargando…</div>;

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
            Marketing
          </Link>{' '}
          <span className="page-crumb">/ QR Reseñas</span>
        </h1>
      </div>

      <p className="text-sm text-mute max-w-2xl mb-5 leading-relaxed">
        Cartel para incentivar reseñas de Google. El QR usa el filtro
        inteligente de 4-5★: los clientes contentos van directo a Google,
        los menos contentos te dejan feedback privado.
      </p>

      {!hasGoogleUrl && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 mb-5 text-sm">
          <div className="font-semibold text-amber-900">
            ⚠ Falta tu URL de Google Reviews
          </div>
          <div className="text-amber-800/90 mt-1">
            El filtro funciona, pero los clientes con 4-5★ no podrán ir a tu
            ficha de Google hasta que la cargues en{' '}
            <Link href="/app/reviews" className="underline font-semibold">
              Reseña de Google
            </Link>
            .
          </div>
        </div>
      )}

      <QrPosterEditor
        type="REVIEWS"
        qrUrl={qrUrl}
        brandName={tenant.brandName ?? 'Mi Negocio'}
        logoUrl={tenant.walletLogoUrl ?? tenant.logoUrl ?? null}
      />
    </div>
  );
}
