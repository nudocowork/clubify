'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { useTranslations } from 'next-intl';
import { EditorCargando } from '@/components/marketing/EditorCargando';

const QrPosterEditor = dynamic(
  () => import('@/components/marketing/QrPosterEditor'),
  { ssr: false, loading: () => <EditorCargando /> },
);

// Mini-page tipo Linktree del negocio. El QR Infolink puede apuntar a:
// - /i/<slug>                   → lista completa de info-links activos
// - /i/<slug>/<linkSlug>        → directo a un info-link específico
// - /<rootSlug>                 → vanity URL (si el info-link tiene rootSlug)
//
// El user elige cuál usando el dropdown abajo. Default = lista completa.

type InfoLink = {
  id: string;
  slug: string;
  title: string;
  isActive: boolean;
  rootSlug?: string | null;
};

export default function QrInfolinkPage() {
  const t = useTranslations('app_qr');
  const [tenant, setTenant] = useState<any>(null);
  const [links, setLinks] = useState<InfoLink[] | null>(null);
  // Empty = ir a la lista completa /i/<slug>. Sino, ir directo al
  // info-link específico /i/<slug>/<linkSlug> (o /<rootSlug> si tiene).
  const [selectedLinkId, setSelectedLinkId] = useState<string>('');

  useEffect(() => {
    api<any>('/tenants/me').then(setTenant).catch(() => null);
    api<InfoLink[]>('/info-links')
      .then(setLinks)
      .catch(() => setLinks([]));
  }, []);

  const activeLinks = useMemo(
    () => (links ?? []).filter((l) => l.isActive),
    [links],
  );

  const selectedLink = useMemo(
    () => activeLinks.find((l) => l.id === selectedLinkId) ?? null,
    [activeLinks, selectedLinkId],
  );

  if (!tenant) return <div className="text-mute">{t('loading')}</div>;

  const slug = tenant.slug ?? 'demo';
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://soyclubify.com';

  // Construir URL del QR según selección. Prioridad:
  // 1. Si el link seleccionado tiene rootSlug → vanity URL en la raíz.
  // 2. Si tiene slug normal → /i/<tenantSlug>/<linkSlug>.
  // 3. Sin selección → /i/<tenantSlug> (lista).
  const qrUrl = selectedLink
    ? selectedLink.rootSlug
      ? `${origin}/${selectedLink.rootSlug}`
      : `${origin}/i/${slug}/${selectedLink.slug}`
    : `${origin}/i/${slug}`;
  const hasLinks = activeLinks.length > 0;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          <Link href="/app/marketing" className="text-mute hover:text-ink">
            {t('marketing')}
          </Link>{' '}
          <span className="page-crumb">/ {t('infolinkCrumb')}</span>
        </h1>
      </div>

      <p className="text-sm text-mute max-w-2xl mb-5 leading-relaxed">
        {t('infolinkIntro')}
      </p>

      {links !== null && !hasLinks && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 mb-5 text-sm">
          <div className="font-semibold text-amber-900">
            {t('noLinksTitle')}
          </div>
          <div className="text-amber-800/90 mt-1">
            {t.rich('noLinksBody', {
              link: (c) => (
                <Link href="/app/info-links" className="underline font-semibold">
                  {c}
                </Link>
              ),
            })}
          </div>
        </div>
      )}

      {/* Selector de destino del QR. Solo aparece si hay info-links
          activos — si no hay, el QR cae al default y sugerimos crear
          uno arriba. */}
      {hasLinks && (
        <div className="card card-pad mb-5">
          <label className="label">
            {t('qrTarget')}{' '}
            <span className="text-mute font-normal">{t('optional')}</span>
          </label>
          <select
            className="input"
            value={selectedLinkId}
            onChange={(e) => setSelectedLinkId(e.target.value)}
          >
            <option value="">
              {t('fullList')}
            </option>
            {activeLinks.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
                {l.rootSlug ? ` · vanity: /${l.rootSlug}` : ` · /${l.slug}`}
              </option>
            ))}
          </select>
          <div className="text-xs text-mute mt-2 font-mono break-all">
            {t('qrUrl')}: {qrUrl}
          </div>
        </div>
      )}

      <QrPosterEditor
        type="INFOLINK"
        qrUrl={qrUrl}
        brandName={tenant.brandName ?? t('defaultBusiness')}
        logoUrl={tenant.walletLogoUrl || tenant.logoUrl || null}
      />
    </div>
  );
}
