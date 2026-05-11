'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';

const QrPosterEditor = dynamic(
  () => import('@/components/marketing/QrPosterEditor'),
  { ssr: false, loading: () => <div className="text-mute py-8 text-center">Cargando editor…</div> },
);

export default function QrMenuPage() {
  const [tenant, setTenant] = useState<any>(null);

  useEffect(() => {
    api<any>('/tenants/me').then(setTenant).catch(() => null);
  }, []);

  if (!tenant) return <div className="text-mute">Cargando…</div>;

  const slug = tenant.slug ?? 'demo';
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://soyclubify.com';
  const qrUrl = `${origin}/m/${slug}`;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          <Link href="/app/marketing" className="text-mute hover:text-ink">
            Marketing
          </Link>{' '}
          <span className="page-crumb">/ QR Menú</span>
        </h1>
      </div>

      <p className="text-sm text-mute max-w-2xl mb-5 leading-relaxed">
        Diseñá tu cartel QR para imprimir. El QR apunta automáticamente a tu
        menú digital — si lo cambiás, el cartel impreso sigue funcionando.
      </p>

      <QrPosterEditor
        type="MENU"
        qrUrl={qrUrl}
        brandName={tenant.brandName ?? 'Mi Negocio'}
        logoUrl={tenant.walletLogoUrl ?? tenant.logoUrl ?? null}
      />
    </div>
  );
}
