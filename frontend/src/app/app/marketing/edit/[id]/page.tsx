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

type Card = { id: string; name: string };

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
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api<QrPoster>(`/qr-posters/${id}`).then(setPoster),
      api<any>('/tenants/me').then(setTenant).catch(() => null),
      api<any[]>('/cards')
        .then((arr) => setCards(arr.map((c) => ({ id: c.id, name: c.name }))))
        .catch(() => setCards([])),
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
    qrUrl = `${origin}/r/${slug}`;
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
    // DISCOUNT
    qrUrl = (m) => {
      const code = (m?.promoCode ?? '').toString().trim();
      return code
        ? `${origin}/m/${slug}?promo=${encodeURIComponent(code)}`
        : `${origin}/m/${slug}`;
    };
    metaSlot = (m, setM) => (
      <div className="card card-pad space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
          Código promocional
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
        />
        <div className="text-[11px] text-mute leading-relaxed">
          Para que el descuento sea válido, dálo de alta en{' '}
          <Link href="/app/promos" className="text-brand underline">
            Promociones
          </Link>{' '}
          también.
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
