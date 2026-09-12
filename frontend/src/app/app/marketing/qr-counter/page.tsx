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

type Card = { id: string; businessName?: string; name?: string };

export default function QrCounterPage() {
  const t = useTranslations('app_qr');
  const [tenant, setTenant] = useState<any>(null);
  const [cards, setCards] = useState<Card[]>([]);

  useEffect(() => {
    Promise.all([
      api<any>('/tenants/me').catch(() => null),
      api<Card[]>('/cards').catch(() => []),
    ]).then(([t, c]) => {
      setTenant(t);
      setCards(Array.isArray(c) ? c : []);
    });
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
          <span className="page-crumb">/ {t('counterCrumb')}</span>
        </h1>
      </div>

      <p className="text-sm text-mute max-w-2xl mb-5 leading-relaxed">
        {t('counterIntro')}
      </p>

      <QrPosterEditor
        type="COUNTER"
        brandName={tenant.brandName ?? t('defaultBusiness')}
        logoUrl={tenant.walletLogoUrl || tenant.logoUrl || null}
        qrUrl={(meta) => {
          const cardId = meta?.cardId || cards[0]?.id;
          return cardId ? `${origin}/c/${cardId}` : `${origin}/m/${slug}`;
        }}
        metaSlot={(meta, setMeta) => (
          <div className="card card-pad space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
              {t('targetCard')}
            </div>
            {cards.length === 0 ? (
              <div className="text-[11px] text-mute leading-relaxed">
                {t.rich('noCardsYet', {
                  link: (c) => (
                    <Link href="/app/cards/new" className="text-brand underline">
                      {c}
                    </Link>
                  ),
                })}
              </div>
            ) : (
              <select
                value={meta?.cardId ?? cards[0].id}
                onChange={(e) => setMeta({ ...meta, cardId: e.target.value })}
                className="input text-sm"
              >
                {cards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.businessName || c.name || c.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            )}
            <div className="text-[11px] text-mute leading-relaxed">
              {t('counterHint')}
            </div>
          </div>
        )}
      />
    </div>
  );
}
