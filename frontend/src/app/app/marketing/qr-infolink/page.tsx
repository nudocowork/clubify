'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';

const QrPosterEditor = dynamic(
  () => import('@/components/marketing/QrPosterEditor'),
  { ssr: false, loading: () => <div className="text-mute py-8 text-center">Cargando editor…</div> },
);

// Mini-page tipo Linktree del negocio — vive en /i/<slug>/<linkSlug>.
// El QR Infolink apunta al root /i/<slug> que muestra la lista de links
// disponibles. Si el tenant no tiene InfoLinks creados, mostramos un
// banner para incentivarlo a crear el primero.

type InfoLink = { id: string; slug: string; title: string; isActive: boolean };

export default function QrInfolinkPage() {
  const [tenant, setTenant] = useState<any>(null);
  const [links, setLinks] = useState<InfoLink[] | null>(null);

  useEffect(() => {
    api<any>('/tenants/me').then(setTenant).catch(() => null);
    api<InfoLink[]>('/info-links')
      .then(setLinks)
      .catch(() => setLinks([]));
  }, []);

  if (!tenant) return <div className="text-mute">Cargando…</div>;

  const slug = tenant.slug ?? 'demo';
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://soyclubify.com';
  const qrUrl = `${origin}/i/${slug}`;
  const activeLinks = (links ?? []).filter((l) => l.isActive);
  const hasLinks = activeLinks.length > 0;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          <Link href="/app/marketing" className="text-mute hover:text-ink">
            Marketing
          </Link>{' '}
          <span className="page-crumb">/ QR Infolink</span>
        </h1>
      </div>

      <p className="text-sm text-mute max-w-2xl mb-5 leading-relaxed">
        Cartel para el mini-sitio tipo Linktree de tu negocio. El QR abre la
        lista de links que tengás creados (redes, eventos, formularios,
        promos). Cambialos cuando quieras — el cartel impreso sigue
        funcionando.
      </p>

      {links !== null && !hasLinks && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 mb-5 text-sm">
          <div className="font-semibold text-amber-900">
            ⚠ Todavía no tenés links activos
          </div>
          <div className="text-amber-800/90 mt-1">
            Creá tu primero desde{' '}
            <Link href="/app/info-links" className="underline font-semibold">
              Info Links
            </Link>{' '}
            para que el QR muestre algo cuando lo escaneen.
          </div>
        </div>
      )}

      <QrPosterEditor
        type="INFOLINK"
        qrUrl={qrUrl}
        brandName={tenant.brandName ?? 'Mi Negocio'}
        logoUrl={tenant.walletLogoUrl || tenant.logoUrl || null}
      />
    </div>
  );
}
