'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
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

const TYPE_META: Record<QrPosterType, { label: string; emoji: string }> = {
  MENU: { label: 'QR Menú', emoji: '🍽' },
  COUNTER: { label: 'QR Mostrador', emoji: '🪪' },
  DISCOUNT: { label: 'QR Descuento', emoji: '🎁' },
  REVIEWS: { label: 'QR Reseñas', emoji: '⭐' },
};

/**
 * Editor genérico de un QrPoster por id (modo multi-QR). Carga el cartel
 * por id, infiere el `type` y construye `qrUrl` + `metaSlot` apropiados
 * según el tipo. Es la versión "Pro" del editor — convive con los 4
 * editores legacy (/app/marketing/qr-{type}) que siguen funcionando para
 * editar el cartel "principal" de cada tipo.
 */
export default function EditQrPosterPage() {
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
    ]).catch((e) => setErr(e?.message || 'No se pudo cargar el cartel'));
  }, [id]);

  if (err) {
    return (
      <div className="card card-pad max-w-lg mx-auto mt-8 text-center space-y-3">
        <div className="text-3xl">⚠️</div>
        <div className="font-semibold">No se pudo cargar el cartel</div>
        <div className="text-sm text-mute break-words">{err}</div>
        <Link href="/app/marketing" className="btn-primary inline-block">
          Volver a Marketing
        </Link>
      </div>
    );
  }

  if (!poster || !tenant) {
    return <div className="text-mute">Cargando…</div>;
  }

  const slug = tenant.slug ?? 'demo';
  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://soyclubify.com';

  const meta = TYPE_META[poster.type];

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
          Sede del QR
        </div>
        {activeTargets.length === 0 ? (
          <div className="text-[11px] text-mute leading-relaxed">
            No tienes targets multi-sede aún. Crea uno en{' '}
            <Link
              href="/app/marketing/review-targets"
              className="text-brand underline"
            >
              Targets de reseñas
            </Link>{' '}
            — mientras tanto el QR apunta al link genérico del negocio.
          </div>
        ) : (
          <select
            value={m?.reviewTargetId ?? ''}
            onChange={(e) => setM({ ...m, reviewTargetId: e.target.value })}
            className="input text-sm"
          >
            <option value="">— Link genérico (sede principal) —</option>
            {activeTargets.map((t) => (
              <option key={t.id} value={t.id}>
                ⭐ {t.name}
                {t.location ? ` · ${t.location.name}` : ''}
              </option>
            ))}
          </select>
        )}
        <div className="text-[11px] text-mute leading-relaxed">
          Cada sede puede tener su propio QR con su Google Reviews y
          umbral. Edítalos en{' '}
          <Link
            href="/app/marketing/review-targets"
            className="text-brand underline"
          >
            Targets de reseñas
          </Link>
          .
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
          Tarjeta destino
        </div>
        {cards.length === 0 ? (
          <div className="text-[11px] text-mute leading-relaxed">
            Aún no tienes tarjetas. Crea una en{' '}
            <Link href="/app/cards/new" className="text-brand underline">
              Tarjetas
            </Link>{' '}
            — mientras tanto el QR apunta al menú.
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
    // DISCOUNT — M7.2 (2026-06-04): el QR de descuento puede apuntar a:
    //  a) Una Card de cupón específica → /c/<cardId> (el cliente se
    //     inscribe a la tarjeta de cupón y la canjea en su wallet).
    //  b) Un código promocional libre → /m/<slug>?promo=<code> (legacy,
    //     valida contra Promociones).
    //  c) Solo el menú → /m/<slug> (default si no hay ninguno).
    const couponCards = cards.filter((c) => c.type === 'COUPON');
    qrUrl = (m) => {
      const cardId = (m?.cardId ?? '').toString().trim();
      if (cardId) return `${origin}/c/${cardId}`;
      const code = (m?.promoCode ?? '').toString().trim();
      return code
        ? `${origin}/m/${slug}?promo=${encodeURIComponent(code)}`
        : `${origin}/m/${slug}`;
    };
    metaSlot = (m, setM) => (
      <div className="card card-pad space-y-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-1.5">
            Tarjeta de cupón (recomendado)
          </div>
          {couponCards.length === 0 ? (
            <div className="text-[11px] text-mute leading-relaxed">
              No tienes tarjetas de cupón aún. Crea una en{' '}
              <Link href="/app/cards/new" className="text-brand underline">
                Tarjetas → Cupón
              </Link>{' '}
              para que el QR inscriba directo al cliente.
            </div>
          ) : (
            <select
              value={m?.cardId ?? ''}
              onChange={(e) => setM({ ...m, cardId: e.target.value })}
              className="input text-sm"
            >
              <option value="">— Ninguna · usar código promo —</option>
              {couponCards.map((c) => (
                <option key={c.id} value={c.id}>
                  🎁 {c.name}
                </option>
              ))}
            </select>
          )}
          <div className="text-[11px] text-mute mt-1.5 leading-snug">
            Si eliges una tarjeta de cupón, el QR redirige a{' '}
            <code className="text-[10px]">/c/&lt;id&gt;</code> para
            inscribir al cliente automáticamente al escanear.
          </div>
        </div>
        <div className={m?.cardId ? 'opacity-50 pointer-events-none' : ''}>
          <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-1.5">
            O código promocional libre
          </div>
          <input
            type="text"
            value={m?.promoCode ?? ''}
            onChange={(e) =>
              setM({ ...m, promoCode: e.target.value.toUpperCase() })
            }
            placeholder="Ej: BIENVENIDA10"
            maxLength={32}
            className="input text-sm uppercase tracking-wider"
            disabled={!!m?.cardId}
          />
          <div className="text-[11px] text-mute mt-1.5 leading-relaxed">
            Si no usas tarjeta de cupón, el QR aplica este código sobre
            el carrito. Dálo de alta en{' '}
            <Link href="/app/promos" className="text-brand underline">
              Promociones
            </Link>
            .
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
            Marketing
          </Link>{' '}
          <span className="page-crumb">
            / {meta.emoji} {poster.name?.trim() || meta.label}
          </span>
        </h1>
      </div>

      <p className="text-sm text-mute max-w-2xl mb-5 leading-relaxed">
        Editas una variante de <strong>{meta.label}</strong>. Cada variante
        tiene su propio diseño y se guarda automáticamente. El nombre lo
        cambias desde la lista en{' '}
        <Link href="/app/marketing" className="text-brand underline">
          Marketing
        </Link>
        .
      </p>

      <QrPosterEditor
        type={poster.type}
        posterId={poster.id}
        qrUrl={qrUrl}
        brandName={tenant.brandName ?? 'Mi Negocio'}
        logoUrl={tenant.walletLogoUrl || tenant.logoUrl || null}
        metaSlot={metaSlot}
      />
    </div>
  );
}
