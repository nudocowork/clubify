'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';

const QrPosterEditor = dynamic(
  () => import('@/components/marketing/QrPosterEditor'),
  { ssr: false, loading: () => <div className="text-mute py-8 text-center">Cargando editor…</div> },
);

export default function QrDiscountPage() {
  const [tenant, setTenant] = useState<any>(null);

  useEffect(() => {
    api<any>('/tenants/me').then(setTenant).catch(() => null);
  }, []);

  if (!tenant) return <div className="text-mute">Cargando…</div>;

  const slug = tenant.slug ?? 'demo';
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://soyclubify.com';

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          <Link href="/app/marketing" className="text-mute hover:text-ink">
            Marketing
          </Link>{' '}
          <span className="page-crumb">/ QR Descuento</span>
        </h1>
      </div>

      <p className="text-sm text-mute max-w-2xl mb-5 leading-relaxed">
        Cartel promocional para campañas, primera compra o activaciones. El
        cliente escanea, ve un banner con tu código en el menú y lo presenta
        al pagar para activar el descuento.
      </p>

      <QrPosterEditor
        type="DISCOUNT"
        brandName={tenant.brandName ?? 'Mi Negocio'}
        logoUrl={tenant.walletLogoUrl || tenant.logoUrl || null}
        qrUrl={(meta) => {
          const code = (meta?.promoCode ?? '').toString().trim();
          return code
            ? `${origin}/m/${slug}?promo=${encodeURIComponent(code)}`
            : `${origin}/m/${slug}`;
        }}
        metaSlot={(meta, setMeta) => (
          <div className="card card-pad space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
              Código promocional
            </div>
            <input
              type="text"
              value={meta?.promoCode ?? ''}
              onChange={(e) =>
                setMeta({ ...meta, promoCode: e.target.value.toUpperCase() })
              }
              placeholder="Ej: BIENVENIDA10"
              maxLength={32}
              className="input text-sm uppercase tracking-wider"
            />
            <div className="text-[11px] text-mute leading-relaxed">
              El cliente verá un banner con el código al escanear y lo
              presenta al pagar. Para que el descuento sea válido, dálo de
              alta en{' '}
              <Link href="/app/promos" className="text-brand underline">
                Promociones
              </Link>{' '}
              también.
            </div>
          </div>
        )}
      />
    </div>
  );
}
