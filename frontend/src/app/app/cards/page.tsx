'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
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
  | 'MULTI'
  | 'CASHBACK'
  | 'VISITS'
  | 'HYBRID';

type Card = {
  id: string;
  name: string;
  type: CardType;
  rewardText: string;
  primaryColor: string;
  secondaryColor: string;
  stampsRequired: number | null;
  visitsRequired: number | null;
  cashbackPercent: number | null;
  discountPercent: number | null;
  pointsPerCurrency: number | null;
  stampIcon: string | null;
  isActive: boolean;
  tiers: Array<{ name: string; threshold: number }>;
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
  CASHBACK: 'Cashback',
  VISITS: 'Visitas',
  HYBRID: 'Híbrida',
};

const TYPE_EMOJI: Record<CardType, string> = {
  STAMPS: '☕',
  POINTS: '⭐',
  DISCOUNT: '%',
  MEMBERSHIP: '👑',
  COUPON: '🎟',
  GIFT: '🎁',
  MULTI: '✨',
  CASHBACK: '💰',
  VISITS: '🚶',
  HYBRID: '🔀',
};

const TYPE_COLORS: Record<CardType, { primary: string; accent: string }> = {
  STAMPS: { primary: '#22C55E', accent: '#4ADE80' },
  POINTS: { primary: '#0EA5E9', accent: '#06B6D4' },
  DISCOUNT: { primary: '#F59E0B', accent: '#EC4899' },
  MEMBERSHIP: { primary: '#0F172A', accent: '#475569' },
  COUPON: { primary: '#10B981', accent: '#22C55E' },
  GIFT: { primary: '#EC4899', accent: '#F97316' },
  MULTI: { primary: '#7C3AED', accent: '#DB2777' },
  CASHBACK: { primary: '#0F766E', accent: '#14B8A6' },
  VISITS: { primary: '#7C3AED', accent: '#A855F7' },
  HYBRID: { primary: '#1E40AF', accent: '#3B82F6' },
};

type FilterType = 'all' | CardType;
type FilterStatus = 'all' | 'active' | 'paused';

export default function CardsList() {
  const [list, setList] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [filterType, setFilterType] = useState<FilterType>('all');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [search, setSearch] = useState('');

  const [walletLogoUrl, setWalletLogoUrl] = useState<string | null>(null);
  const [savingWalletLogo, setSavingWalletLogo] = useState(false);
  const [showLogoModal, setShowLogoModal] = useState(false);

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

  const filtered = useMemo(() => {
    return list.filter((c) => {
      if (filterType !== 'all' && c.type !== filterType) return false;
      if (filterStatus === 'active' && !c.isActive) return false;
      if (filterStatus === 'paused' && c.isActive) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (
          !c.name.toLowerCase().includes(q) &&
          !c.rewardText.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [list, filterType, filterStatus, search]);

  const totalPasses = list.reduce((s, c) => s + (c._count?.passes ?? 0), 0);
  const activeCount = list.filter((c) => c.isActive).length;
  const typesPresent: CardType[] = useMemo(
    () => Array.from(new Set(list.map((c) => c.type))) as CardType[],
    [list],
  );

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Tarjetas{' '}
          <span className="page-crumb">
            / {activeCount} activa{activeCount === 1 ? '' : 's'}
          </span>
        </h1>
        <div className="flex gap-2 flex-wrap">
          <button
            className="btn-ghost"
            onClick={() => setShowLogoModal(true)}
            title="Logo que aparece en el wallet de tus clientes"
          >
            {walletLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={walletLogoUrl}
                alt=""
                className="w-5 h-5 rounded object-cover"
              />
            ) : (
              <span>📱</span>
            )}
            Configura tu logo
          </button>
          <Link className="btn-primary" href="/app/cards/new">
            <Icon name="plus" /> Crear tarjeta
          </Link>
        </div>
      </div>

      {list.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Kpi label="Tarjetas" value={list.length} />
          <Kpi label="Activas" value={activeCount} accent="ok" />
          <Kpi label="Pases emitidos" value={totalPasses} accent="brand" />
        </div>
      )}

      {list.length > 0 && (
        <div className="card card-pad mb-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <input
              className="input flex-1 min-w-[200px]"
              placeholder="Buscar por nombre o recompensa…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="bg-bg2 rounded-full p-0.5 flex text-xs font-semibold">
              {(['all', 'active', 'paused'] as FilterStatus[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`px-3 py-1.5 rounded-full transition ${
                    filterStatus === s ? 'bg-white text-ink shadow-sm' : 'text-mute'
                  }`}
                >
                  {s === 'all' ? 'Todas' : s === 'active' ? 'Activas' : 'Pausadas'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setFilterType('all')}
              className={`text-xs px-3 py-1.5 rounded-full transition ${
                filterType === 'all'
                  ? 'bg-ink text-white'
                  : 'bg-bg2 text-mute hover:bg-line/50'
              }`}
            >
              Todos los tipos
            </button>
            {typesPresent.map((t) => (
              <button
                key={t}
                onClick={() => setFilterType(t)}
                className={`text-xs px-3 py-1.5 rounded-full transition flex items-center gap-1.5 ${
                  filterType === t
                    ? 'bg-ink text-white'
                    : 'bg-bg2 text-mute hover:bg-line/50'
                }`}
              >
                <span>{TYPE_EMOJI[t]}</span> {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
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
              Tarjetas que viven en Apple Wallet y Google Wallet. Sellos, puntos,
              cashback, visitas o membresías VIP — vos elegís.
            </div>
            <Link href="/app/cards/new" className="btn-primary inline-flex mt-5">
              <Icon name="plus" /> Crear mi primera tarjeta
            </Link>
          </div>
        )}

        {!loading && list.length > 0 && filtered.length === 0 && (
          <div className="card card-pad md:col-span-2 lg:col-span-3 text-center py-10">
            <div className="text-3xl mb-2">🔍</div>
            <div className="text-sm text-mute">
              No hay tarjetas con esos filtros.{' '}
              <button
                onClick={() => {
                  setFilterType('all');
                  setFilterStatus('all');
                  setSearch('');
                }}
                className="text-brand hover:underline"
              >
                Limpiar
              </button>
            </div>
          </div>
        )}

        {!loading &&
          filtered.map((c) => (
            <CardPreview
              key={c.id}
              card={c}
              deleting={deletingId === c.id}
              onDelete={(e) => handleDelete(e, c)}
            />
          ))}
      </div>

      {showLogoModal && (
        <div
          className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowLogoModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold text-base m-0">📱 Logo de tarjetas wallet</h3>
                <p className="text-xs text-mute mt-1 leading-relaxed">
                  Aparece en el header de Apple Wallet y Google Wallet de TODAS
                  las tarjetas que emitas.
                </p>
              </div>
              <button
                onClick={() => setShowLogoModal(false)}
                className="text-mute hover:text-ink text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-900 leading-relaxed mb-3">
              💡 <b>Recomendado: PNG con fondo transparente.</b> Si tiene fondo
              blanco, va a aparecer un cuadrado blanco detrás del logo en la
              wallet del cliente.
            </div>
            <ImageUploader
              value={walletLogoUrl}
              onChange={(url) => saveWalletLogo(url)}
              folder="wallet-logos"
            />
            {savingWalletLogo && (
              <div className="text-[11px] text-mute mt-2 text-center">
                Guardando…
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CardPreview({
  card,
  deleting,
  onDelete,
}: {
  card: Card;
  deleting: boolean;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const fallback = TYPE_COLORS[card.type] ?? TYPE_COLORS.STAMPS;
  const primary = card.primaryColor || fallback.primary;
  const accent = card.secondaryColor || fallback.accent;
  const passes = card._count?.passes ?? 0;
  const brand = (card.name.split('—')[0] || 'Tarjeta').trim();

  // Header value preview — refleja lo que verá el cliente en wallet.
  const headerValue =
    card.type === 'STAMPS' || card.type === 'HYBRID'
      ? `0/${card.stampsRequired ?? 10}`
      : card.type === 'VISITS'
      ? `0/${card.visitsRequired ?? 10}`
      : card.type === 'CASHBACK'
      ? `${card.cashbackPercent ?? 5}%`
      : card.type === 'DISCOUNT'
      ? `${card.discountPercent ?? 10}%`
      : card.type === 'POINTS'
      ? '0 pts'
      : card.type === 'MEMBERSHIP'
      ? card.tiers?.[0]?.name || 'Activa'
      : '—';

  const previewStamps = Math.min(card.stampsRequired ?? 10, 6);
  const showStrip =
    card.type === 'STAMPS' ||
    card.type === 'HYBRID' ||
    card.type === 'VISITS';

  return (
    <Link href={`/app/cards/${card.id}`} className="block group">
      <div
        className={`rounded-2xl overflow-hidden h-full flex flex-col bg-white border border-line shadow-sm transition group-hover:shadow-lg group-hover:-translate-y-0.5 ${
          !card.isActive ? 'opacity-70' : ''
        }`}
      >
        {/* Wallet pass preview real — header + strip + fields */}
        <div
          className="relative p-3.5 text-white"
          style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}
        >
          {!card.isActive && (
            <span className="absolute top-2 left-2 bg-white/95 text-ink text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider z-10">
              Pausada
            </span>
          )}

          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            title="Eliminar tarjeta"
            aria-label={`Eliminar ${card.name}`}
            className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-black/30 hover:bg-red-500 backdrop-blur text-white flex items-center justify-center transition disabled:opacity-50"
          >
            {deleting ? (
              <span className="block w-3 h-3 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
            ) : (
              <Icon name="trash" />
            )}
          </button>

          {/* Header del pass: brand + valor según tipo */}
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="min-w-0">
              <div className="text-[9px] uppercase tracking-wider opacity-80 font-bold truncate">
                {brand}
              </div>
              <div className="text-[10px] opacity-75 mt-0.5">
                {TYPE_EMOJI[card.type]} {TYPE_LABEL[card.type]}
              </div>
            </div>
            <div className="text-right shrink-0 mr-7">
              <div className="text-[8px] uppercase tracking-wider opacity-75 font-bold">
                {card.type === 'STAMPS' || card.type === 'HYBRID'
                  ? 'SELLOS'
                  : card.type === 'VISITS'
                  ? 'VISITAS'
                  : card.type === 'CASHBACK'
                  ? 'CASHBACK'
                  : card.type === 'DISCOUNT'
                  ? 'OFF'
                  : card.type === 'POINTS'
                  ? 'PUNTOS'
                  : card.type === 'MEMBERSHIP'
                  ? 'NIVEL'
                  : ''}
              </div>
              <div className="text-base font-bold leading-tight">{headerValue}</div>
            </div>
          </div>

          {/* Strip / preview central según tipo */}
          {showStrip && (
            <div className="bg-black/15 rounded-lg px-3 py-2 flex justify-center gap-1">
              {Array.from({ length: previewStamps }).map((_, i) => (
                <span
                  key={i}
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[10px]"
                  style={{
                    background: i < 1 ? 'white' : 'rgba(255,255,255,0.18)',
                    color: i < 1 ? primary : 'white',
                    fontSize: i < 1 ? 12 : 10,
                  }}
                >
                  {i < 1 ? card.stampIcon || '✓' : ''}
                </span>
              ))}
            </div>
          )}

          {card.type === 'CASHBACK' && (
            <div className="bg-black/15 rounded-lg px-3 py-2.5 text-center">
              <div className="text-[9px] uppercase tracking-wider opacity-75 font-bold">
                Saldo cliente
              </div>
              <div className="text-2xl font-bold">$0</div>
            </div>
          )}

          {card.type === 'POINTS' && (
            <div className="bg-black/15 rounded-lg px-3 py-2.5 text-center">
              <div className="text-[9px] uppercase tracking-wider opacity-75 font-bold">
                Acumulado
              </div>
              <div className="text-2xl font-bold">0 pts</div>
            </div>
          )}

          {card.type === 'MEMBERSHIP' && (
            <div className="bg-black/15 rounded-lg px-3 py-2 text-center">
              <div className="text-[9px] uppercase tracking-wider opacity-75 font-bold">
                {(card.tiers ?? []).length > 0
                  ? `${card.tiers.length} niveles`
                  : 'Sin tiers'}
              </div>
              <div className="text-sm font-semibold mt-0.5">
                {(card.tiers ?? [])
                  .slice(0, 3)
                  .map((t) => t.name)
                  .join(' · ') || 'Membresía única'}
              </div>
            </div>
          )}

          {card.type === 'DISCOUNT' && (
            <div className="bg-black/15 rounded-lg px-3 py-2.5 text-center">
              <div className="text-3xl font-black">{card.discountPercent ?? 10}%</div>
              <div className="text-[9px] uppercase tracking-wider opacity-75 font-bold mt-0.5">
                Descuento permanente
              </div>
            </div>
          )}

          {(card.type === 'GIFT' || card.type === 'COUPON') && (
            <div className="bg-black/15 rounded-lg px-3 py-3 text-center">
              <div className="text-2xl">{TYPE_EMOJI[card.type]}</div>
              <div className="text-[9px] uppercase tracking-wider opacity-75 font-bold mt-1">
                {TYPE_LABEL[card.type]}
              </div>
            </div>
          )}
        </div>

        {/* Footer blanco con info y CTA */}
        <div className="p-3 flex-1 flex flex-col">
          <div className="font-semibold text-sm leading-snug line-clamp-2">
            {card.name}
          </div>
          <div className="text-xs text-mute mt-1 line-clamp-2">
            {card.rewardText || '—'}
          </div>
          <div className="mt-auto pt-3 flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-mute">
              <Icon name="users" />
              <strong className="text-ink">{passes}</strong>
              <span>{passes === 1 ? 'pase' : 'pases'}</span>
            </div>
            <span className="text-brand font-semibold group-hover:underline">
              Abrir →
            </span>
          </div>
        </div>
      </div>
    </Link>
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
