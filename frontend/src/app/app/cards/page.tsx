'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { ImageUploader } from '@/components/ImageUploader';
import { toast } from '@/components/Toast';

type CardType =
  | 'STAMPS'
  | 'POINTS'
  | 'DISCOUNT'
  | 'MEMBERSHIP'
  | 'COUPON'
  | 'GIFT'
  | 'MULTI';

type Card = {
  id: string;
  name: string;
  type: CardType;
  rewardText: string;
  primaryColor: string;
  secondaryColor: string;
  stampsRequired: number | null;
  isActive: boolean;
  _count?: { passes: number };
};

const TYPE_LABEL: Record<CardType, string> = {
  STAMPS: 'Sellos',
  POINTS: 'Puntos',
  DISCOUNT: 'Descuento',
  MEMBERSHIP: 'Membresía',
  COUPON: 'Cupón',
  GIFT: 'Regalo',
  MULTI: 'Múltiple',
};

const TYPE_EMOJI: Record<CardType, string> = {
  STAMPS: '☕',
  POINTS: '⭐',
  DISCOUNT: '%',
  MEMBERSHIP: '👑',
  COUPON: '🎟',
  GIFT: '🎁',
  MULTI: '✨',
};

// Colores por tipo — usados como fallback si el card no tiene primary/secondary
const TYPE_COLORS: Record<CardType, { primary: string; accent: string }> = {
  STAMPS: { primary: '#22C55E', accent: '#4ADE80' },
  POINTS: { primary: '#0EA5E9', accent: '#06B6D4' },
  DISCOUNT: { primary: '#F59E0B', accent: '#EC4899' },
  MEMBERSHIP: { primary: '#0F172A', accent: '#475569' },
  COUPON: { primary: '#10B981', accent: '#22C55E' },
  GIFT: { primary: '#EC4899', accent: '#F97316' },
  MULTI: { primary: '#7C3AED', accent: '#DB2777' },
};

export default function CardsList() {
  const [list, setList] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Logo wallet — se inyecta en el header del .pkpass de todas las tarjetas
  // (Apple/Google). Independiente del logoUrl general del negocio.
  const [walletLogoUrl, setWalletLogoUrl] = useState<string | null>(null);
  const [savingWalletLogo, setSavingWalletLogo] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [cards, me] = await Promise.all([
        api<Card[]>('/cards'),
        api<any>('/tenants/me').catch(() => null),
      ]);
      setList(cards);
      if (me) setWalletLogoUrl(me.walletLogoUrl ?? null);
    } catch (e: any) {
      toast(e.message || 'Error cargando tarjetas', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function saveWalletLogo(url: string | null) {
    setSavingWalletLogo(true);
    try {
      await api('/tenants/me', {
        method: 'PATCH',
        body: JSON.stringify({ walletLogoUrl: url }),
      });
      setWalletLogoUrl(url);
      toast('Logo de wallet actualizado · regenera el pase para verlo', 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar', 'error');
    } finally {
      setSavingWalletLogo(false);
    }
  }

  async function handleDelete(e: React.MouseEvent, card: Card) {
    e.preventDefault();
    e.stopPropagation();
    const passes = card._count?.passes ?? 0;
    const msg =
      passes > 0
        ? `¿Eliminar "${card.name}"? Esto borrará también ${passes} pase${passes === 1 ? '' : 's'} de clientes y los desinstalará de sus wallets. Esta acción NO se puede deshacer.`
        : `¿Eliminar la tarjeta "${card.name}"? Esta acción no se puede deshacer.`;
    if (!confirm(msg)) return;
    setDeletingId(card.id);
    try {
      await api(`/cards/${card.id}`, { method: 'DELETE' });
      toast('Tarjeta eliminada', 'success');
      setList((prev) => prev.filter((c) => c.id !== card.id));
    } catch (err: any) {
      toast(err.message || 'No se pudo eliminar', 'error');
    } finally {
      setDeletingId(null);
    }
  }

  const totalPasses = list.reduce((s, c) => s + (c._count?.passes ?? 0), 0);
  const activeCount = list.filter((c) => c.isActive).length;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Tarjetas{' '}
          <span className="page-crumb">
            / {activeCount} activa{activeCount === 1 ? '' : 's'}
          </span>
        </h1>
        <Link className="btn-primary" href="/app/cards/new">
          <Icon name="plus" /> Crear tarjeta
        </Link>
      </div>

      {/* Configuración del logo wallet — afecta TODAS las tarjetas */}
      <div className="card card-pad mb-5">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-[240px]">
            <h3 className="text-base font-semibold m-0 flex items-center gap-2">
              📱 Logo de tarjetas wallet
            </h3>
            <p className="text-xs text-mute mt-1.5 leading-relaxed">
              Aparece en el header de Apple Wallet y Google Wallet de TODAS
              las tarjetas que emitas. Es independiente del logo general del
              negocio.
            </p>
            <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-900 leading-relaxed">
              💡 <b>Recomendado: PNG con fondo transparente</b>. Si el archivo
              tiene fondo blanco, va a aparecer un cuadrado blanco detrás del
              logo en la wallet del cliente. Si no tienes una versión con
              alpha, pídele al diseñador que te la exporte así.
            </div>
            {walletLogoUrl && (
              <div className="text-[11px] text-mute mt-2">
                Si no configuras un logo aquí, se usa el logo general del
                negocio como fallback.
              </div>
            )}
          </div>
          <div className="w-full sm:w-[260px]">
            <ImageUploader
              value={walletLogoUrl}
              onChange={(url) => saveWalletLogo(url)}
              folder="wallet-logos"
            />
            {savingWalletLogo && (
              <div className="text-[11px] text-mute mt-1.5 text-center">
                Guardando…
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Resumen rápido */}
      {list.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Kpi label="Tarjetas" value={list.length} />
          <Kpi label="Activas" value={activeCount} accent="ok" />
          <Kpi label="Pases emitidos" value={totalPasses} accent="brand" />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {loading &&
          Array.from({ length: 3 }).map((_, i) => (
            <div key={`sk-${i}`} className="card card-pad">
              <div className="h-32 bg-bg2 rounded-2xl animate-shimmer" />
              <div className="h-4 bg-bg2 rounded mt-3 animate-shimmer" />
            </div>
          ))}

        {!loading && list.length === 0 && (
          <div className="card card-pad md:col-span-2 lg:col-span-3 text-center py-12">
            <div className="text-5xl mb-3">🎟️</div>
            <div className="font-semibold text-lg">
              Crea tu primera tarjeta de fidelización
            </div>
            <div className="text-sm text-mute mt-1.5 max-w-md mx-auto leading-relaxed">
              Tarjetas de sellos o puntos que viven en Apple Wallet y Google
              Wallet. Tus clientes las suman con cada pedido y vuelven 3× más.
            </div>
            <Link href="/app/cards/new" className="btn-primary inline-flex mt-5">
              <Icon name="plus" /> Crear mi primera tarjeta
            </Link>
          </div>
        )}

        {!loading &&
          list.map((c) => {
            const fallback = TYPE_COLORS[c.type] ?? TYPE_COLORS.STAMPS;
            const primary = c.primaryColor || fallback.primary;
            const accent = c.secondaryColor || fallback.accent;
            const passes = c._count?.passes ?? 0;
            return (
              <Link key={c.id} href={`/app/cards/${c.id}`} className="block group">
                <div
                  className={`rounded-2xl p-5 text-white relative overflow-hidden h-full flex flex-col shadow-md2 transition group-hover:scale-[1.02] group-hover:shadow-xl ${
                    !c.isActive ? 'opacity-70 grayscale' : ''
                  }`}
                  style={{
                    background: `linear-gradient(135deg, ${primary}, ${accent})`,
                  }}
                >
                  {/* Emoji watermark gigante de fondo */}
                  <div
                    className="absolute -right-6 -top-8 text-[140px] leading-none opacity-10 select-none pointer-events-none"
                    aria-hidden
                  >
                    {TYPE_EMOJI[c.type] ?? '🎟'}
                  </div>

                  {!c.isActive && (
                    <span className="absolute top-3 left-3 bg-white/95 text-ink text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                      Pausada
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={(e) => handleDelete(e, c)}
                    disabled={deletingId === c.id}
                    title="Eliminar tarjeta"
                    aria-label={`Eliminar ${c.name}`}
                    className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/30 hover:bg-red-500 backdrop-blur text-white flex items-center justify-center transition disabled:opacity-50"
                  >
                    {deletingId === c.id ? (
                      <span className="block w-3 h-3 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Icon name="trash" />
                    )}
                  </button>

                  <div className="relative">
                    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-bold opacity-90">
                      <span className="text-base">{TYPE_EMOJI[c.type] ?? '🎟'}</span>
                      {TYPE_LABEL[c.type] ?? c.type}
                    </div>
                    <div className="font-bold text-lg mt-2 leading-tight line-clamp-2">
                      {c.name}
                    </div>
                    <div className="text-sm opacity-85 mt-1 line-clamp-2">
                      {c.rewardText || '—'}
                    </div>
                  </div>

                  <div className="relative mt-auto pt-6 flex items-end justify-between">
                    <div>
                      <div className="text-3xl font-black leading-none">{passes}</div>
                      <div className="text-[10px] uppercase tracking-wider opacity-80 mt-1">
                        {passes === 1 ? 'pase activo' : 'pases activos'}
                      </div>
                    </div>
                    <div className="text-xs opacity-90 underline group-hover:opacity-100">
                      Ver →
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: 'brand' | 'ok';
}) {
  const cls: Record<string, string> = {
    brand: 'text-brand',
    ok: 'text-ok',
  };
  return (
    <div className="card p-4">
      <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
        {label}
      </div>
      <div className={`text-xl font-bold mt-1 ${accent ? cls[accent] : ''}`}>
        {value}
      </div>
    </div>
  );
}
