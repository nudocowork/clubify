'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { resolveMainSectionLabel } from '@/lib/business-categories';

const QrPosterEditor = dynamic(
  () => import('@/components/marketing/QrPosterEditor'),
  { ssr: false, loading: () => <div className="text-mute py-8 text-center">Cargando editor…</div> },
);

export default function QrMenuPage() {
  const [tenant, setTenant] = useState<any>(null);
  // Mesa = QR pegado en la mesa (informativo).
  // Delivery = QR para compartir, con carrito + WhatsApp.
  const [target, setTarget] = useState<'mesa' | 'delivery'>('mesa');

  useEffect(() => {
    api<any>('/tenants/me').then(setTenant).catch(() => null);
  }, []);

  if (!tenant) return <div className="text-mute">Cargando…</div>;

  const slug = tenant.slug ?? 'demo';
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://soyclubify.com';
  const qrUrl =
    target === 'delivery'
      ? `${origin}/d/${slug}`
      : `${origin}/m/${slug}`;
  const mainLabel = resolveMainSectionLabel(
    tenant.mainSectionLabelOverride,
    tenant.businessCategorySlug,
  );

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          <Link href="/app/marketing" className="text-mute hover:text-ink">
            Marketing
          </Link>{' '}
          <span className="page-crumb">/ QR {mainLabel}</span>
        </h1>
      </div>

      <p className="text-sm text-mute max-w-2xl mb-3 leading-relaxed">
        Diseñá tu cartel QR para imprimir. Elegí qué versión apunta:
      </p>

      <div className="inline-flex bg-bg2 rounded-pill p-1 mb-5 text-sm font-semibold">
        <button
          type="button"
          onClick={() => setTarget('mesa')}
          className={`px-4 py-1.5 rounded-pill transition ${
            target === 'mesa' ? 'bg-white shadow-sm' : 'text-mute hover:text-ink'
          }`}
        >
          🍽 Mesa <span className="text-[10px] text-mute">/m/</span>
        </button>
        <button
          type="button"
          onClick={() => setTarget('delivery')}
          className={`px-4 py-1.5 rounded-pill transition ${
            target === 'delivery' ? 'bg-white shadow-sm' : 'text-mute hover:text-ink'
          }`}
        >
          🛵 Delivery <span className="text-[10px] text-mute">/d/</span>
        </button>
      </div>

      <p className="text-xs text-mute mb-4">
        URL del QR: <span className="font-mono break-all">{qrUrl}</span>
      </p>

      <QrPosterEditor
        type="MENU"
        qrUrl={qrUrl}
        brandName={tenant.brandName ?? 'Mi Negocio'}
        logoUrl={tenant.walletLogoUrl || tenant.logoUrl || null}
      />
    </div>
  );
}
