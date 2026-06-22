'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';

const QrPosterEditor = dynamic(
  () => import('@/components/marketing/QrPosterEditor'),
  {
    ssr: false,
    loading: () => (
      <div className="text-mute py-8 text-center">Cargando editor…</div>
    ),
  },
);

type QrPosterType = 'MENU' | 'COUNTER' | 'DISCOUNT' | 'REVIEWS';

type QrPoster = {
  id: string;
  type: QrPosterType;
  name: string;
  config: any;
};

type Card = { id: string; name: string; type?: string };
type ReviewTarget = {
  id: string;
  name: string;
  location: { id: string; name: string } | null;
  isActive: boolean;
};

const TYPE_META: Record<QrPosterType, { labelKey: string; emoji: string }> = {
  MENU: { labelKey: 'typeMenu', emoji: '🍽' },
  COUNTER: { labelKey: 'typeCounter', emoji: '🪪' },
  DISCOUNT: { labelKey: 'typeDiscount', emoji: '🎁' },
  REVIEWS: { labelKey: 'typeReviews', emoji: '⭐' },
};

/**
 * Editor genérico de un QrPoster por id (modo multi-QR). Carga el cartel
 * por id, infiere el `type` y construye `qrUrl` + `metaSlot` apropiados
 * según el tipo. Es la versión "Pro" del editor — convive con los 4
 * editores legacy (/app/marketing/qr-{type}) que siguen funcionando para
 * editar el cartel "principal" de cada tipo.
 */
export default function EditQrPosterPage() {
  const t = useTranslations('app_marketing_edit_id');
  const { id } = useParams<{ id: string }>();
  const [poster, setPoster] = useState<QrPoster | null>(null);
  const [tenant, setTenant] = useState<any>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [reviewTargets, setReviewTargets] = useState<ReviewTarget[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api<QrPoster>(`/qr-posters/${id}`).then(setPoster),
      api<any>('/tenants/me').then(setTenant).catch(() => null),
      api<any[]>('/cards')
        .then((arr) =>
          setCards(
            arr.map((c) => ({ id: c.id, name: c.name, type: c.type })),
          ),
        )
        .catch(() => setCards([])),
      api<any[]>('/review-qr-targets')
        .then((arr) =>
          setReviewTargets(
            (arr ?? []).map((t) => ({
              id: t.id,
              name: t.name,
              location: t.location ?? null,
              isActive: t.isActive,
            })),
          ),
        )
        .catch(() => setReviewTargets([])),
    ]).catch((e) => setErr(e?.message || t('loadError')));
  }, [id, t]);

  if (err) {
    return (
      <div className="card card-pad max-w-lg mx-auto mt-8 text-center space-y-3">
        <div className="text-3xl">⚠️</div>
        <div className="font-semibold">{t('loadError')}</div>
        <div className="text-sm text-mute break-words">{err}</div>
        <Link href="/app/marketing" className="btn-primary inline-block">
          {t('backToMarketing')}
        </Link>
      </div>
    );
  }

  if (!poster || !tenant) {
    return <div className="text-mute">{t('loading')}</div>;
  }

  const slug = tenant.slug ?? 'demo';
  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://soyclubify.com';

  const meta = TYPE_META[poster.type];
  const metaLabel = t(meta.labelKey);

  // Construye qrUrl y metaSlot según el tipo del cartel — replica la
  // lógica de los editores legacy.
  let qrUrl: string | ((m: Record<string, any>) => string);
  let metaSlot:
    | ((m: Record<string, any>, setM: (m: Record<string, any>) => void) => React.ReactNode)
    | undefined;

  if (poster.type === 'MENU') {
    qrUrl = `${origin}/m/${slug}`;
  } else if (poster.type === 'REVIEWS') {
    // M7.3: si hay un target multi-sede elegido, se va con ?target=<id>.
    // Sin target, fallback al link genérico (sede principal del tenant).
    const activeTargets = reviewTargets.filter((t) => t.isActive);
    qrUrl = (m) => {
      const tg = (m?.reviewTargetId ?? '').toString().trim();
      return tg
        ? `${origin}/r/${slug}?target=${encodeURIComponent(tg)}`
        : `${origin}/r/${slug}`;
    };
    metaSlot = (m, setM) => (
      <div className="card card-pad space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
          {t('reviewsVenueLabel')}
        </div>
        {activeTargets.length === 0 ? (
          <div className="text-[11px] text-mute leading-relaxed">
            {t.rich('reviewsNoTargets', {
              link: (chunks) => (
                <Link
                  href="/app/marketing/review-targets"
                  className="text-brand underline"
                >
                  {chunks}
                </Link>
              ),
            })}
          </div>
        ) : (
          <select
            value={m?.reviewTargetId ?? ''}
            onChange={(e) => setM({ ...m, reviewTargetId: e.target.value })}
            className="input text-sm"
          >
            <option value="">{t('reviewsGenericOption')}</option>
            {activeTargets.map((rt) => (
              <option key={rt.id} value={rt.id}>
                ⭐ {rt.name}
                {rt.location ? ` · ${rt.location.name}` : ''}
              </option>
            ))}
          </select>
        )}
        <div className="text-[11px] text-mute leading-relaxed">
          {t.rich('reviewsVenueHint', {
            link: (chunks) => (
              <Link
                href="/app/marketing/review-targets"
                className="text-brand underline"
              >
                {chunks}
              </Link>
            ),
          })}
        </div>
      </div>
    );
  } else if (poster.type === 'COUNTER') {
    qrUrl = (m) => {
      const cardId = m?.cardId || cards[0]?.id;
      return cardId ? `${origin}/c/${cardId}` : `${origin}/m/${slug}`;
    };
    metaSlot = (m, setM) => (
      <div className="card card-pad space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
          {t('counterTargetLabel')}
        </div>
        {cards.length === 0 ? (
          <div className="text-[11px] text-mute leading-relaxed">
            {t.rich('counterNoCards', {
              link: (chunks) => (
                <Link href="/app/cards/new" className="text-brand underline">
                  {chunks}
                </Link>
              ),
            })}
          </div>
        ) : (
          <select
            value={m?.cardId ?? cards[0].id}
            onChange={(e) => setM({ ...m, cardId: e.target.value })}
            className="input text-sm"
          >
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  } else {
    // DISCOUNT — M7.2 (2026-06-04, fix 2026-06-08): el QR de descuento
    // puede apuntar a:
    //  a) Una Card de cupón específica → /c/<cardId> (el cliente se
    //     inscribe a la tarjeta de cupón y la canjea en su wallet).
    //  b) Un código promocional libre → /d/<slug>?promo=<code> (delivery
    //     con carrito para que el cliente pueda aplicar el cupón y
    //     ordenar en la misma sesión).
    //  c) Solo el menú → /d/<slug> (default si no hay ninguno).
    //
    // Fix 2026-06-08: tras la separación /m vs /d, los DISCOUNT QR
    // apuntaban a /m/ (mesa sin carrito) → el cliente veía el banner
    // del cupón pero no podía ordenar.
    const couponCards = cards.filter((c) => c.type === 'COUPON');
    qrUrl = (m) => {
      const cardId = (m?.cardId ?? '').toString().trim();
      if (cardId) return `${origin}/c/${cardId}`;
      const code = (m?.promoCode ?? '').toString().trim();
      return code
        ? `${origin}/d/${slug}?promo=${encodeURIComponent(code)}`
        : `${origin}/d/${slug}`;
    };
    metaSlot = (m, setM) => (
      <div className="card card-pad space-y-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-1.5">
            {t('discountCouponCardLabel')}
          </div>
          {couponCards.length === 0 ? (
            <div className="text-[11px] text-mute leading-relaxed">
              {t.rich('discountNoCouponCards', {
                link: (chunks) => (
                  <Link href="/app/cards/new" className="text-brand underline">
                    {chunks}
                  </Link>
                ),
              })}
            </div>
          ) : (
            <select
              value={m?.cardId ?? ''}
              onChange={(e) => setM({ ...m, cardId: e.target.value })}
              className="input text-sm"
            >
              <option value="">{t('discountNoneOption')}</option>
              {couponCards.map((c) => (
                <option key={c.id} value={c.id}>
                  🎁 {c.name}
                </option>
              ))}
            </select>
          )}
          <div className="text-[11px] text-mute mt-1.5 leading-snug">
            {t.rich('discountCouponCardHint', {
              code: (chunks) => (
                <code className="text-[10px]">{chunks}</code>
              ),
            })}
          </div>
        </div>
        <div className={m?.cardId ? 'opacity-50 pointer-events-none' : ''}>
          <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-1.5">
            {t('discountPromoCodeLabel')}
          </div>
          <input
            type="text"
            value={m?.promoCode ?? ''}
            onChange={(e) =>
              setM({ ...m, promoCode: e.target.value.toUpperCase() })
            }
            placeholder={t('discountPromoCodePlaceholder')}
            maxLength={32}
            className="input text-sm uppercase tracking-wider"
            disabled={!!m?.cardId}
          />
          <div className="text-[11px] text-mute mt-1.5 leading-relaxed">
            {t.rich('discountPromoCodeHint', {
              link: (chunks) => (
                <Link href="/app/promos" className="text-brand underline">
                  {chunks}
                </Link>
              ),
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          <Link href="/app/marketing" className="text-mute hover:text-ink">
            {t('marketing')}
          </Link>{' '}
          <span className="page-crumb">
            / {meta.emoji} {poster.name?.trim() || metaLabel}
          </span>
        </h1>
      </div>

      <p className="text-sm text-mute max-w-2xl mb-5 leading-relaxed">
        {t.rich('intro', {
          label: metaLabel,
          strong: (chunks) => <strong>{chunks}</strong>,
          link: (chunks) => (
            <Link href="/app/marketing" className="text-brand underline">
              {chunks}
            </Link>
          ),
        })}
      </p>

      <QrPosterEditor
        type={poster.type}
        posterId={poster.id}
        qrUrl={qrUrl}
        brandName={tenant.brandName ?? t('defaultBrandName')}
        logoUrl={tenant.walletLogoUrl || tenant.logoUrl || null}
        metaSlot={metaSlot}
      />
    </div>
  );
}
