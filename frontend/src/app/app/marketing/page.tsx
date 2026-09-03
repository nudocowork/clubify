'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/Icon';
import { AcademyButton } from '@/components/AcademyButton';
import { ConstructionBadge } from '@/components/UnderConstruction';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type QrTool = {
  href: string;
  emoji: string;
  titleKey: string;
  descriptionKey: string;
  ready: boolean;
  type: QrPosterType;
};

type QrPosterType = 'MENU' | 'COUNTER' | 'DISCOUNT' | 'REVIEWS' | 'INFOLINK';

type QrPoster = {
  id: string;
  type: QrPosterType;
  name: string;
  config: any;
  isActive: boolean;
  targetUrl: string | null;
  visitCount: number;
  exportCount: number;
  createdAt: string;
  updatedAt: string;
};

const TYPE_META: Record<
  QrPosterType,
  { emoji: string; labelKey: string; href: string; descriptionKey: string }
> = {
  MENU: {
    emoji: '🍽',
    labelKey: 'typeMenuLabel',
    href: '/app/marketing/qr-menu',
    descriptionKey: 'typeMenuDescription',
  },
  COUNTER: {
    emoji: '🪪',
    labelKey: 'typeCounterLabel',
    href: '/app/marketing/qr-counter',
    descriptionKey: 'typeCounterDescription',
  },
  DISCOUNT: {
    emoji: '🎁',
    labelKey: 'typeDiscountLabel',
    href: '/app/marketing/qr-discount',
    descriptionKey: 'typeDiscountDescription',
  },
  REVIEWS: {
    emoji: '⭐',
    labelKey: 'typeReviewsLabel',
    href: '/app/marketing/qr-reviews',
    descriptionKey: 'typeReviewsDescription',
  },
  INFOLINK: {
    emoji: '🔗',
    labelKey: 'typeInfolinkLabel',
    href: '/app/marketing/qr-infolink',
    descriptionKey: 'typeInfolinkDescription',
  },
};

const TOOLS: QrTool[] = (Object.keys(TYPE_META) as QrPosterType[]).map((type) => ({
  href: TYPE_META[type].href,
  emoji: TYPE_META[type].emoji,
  titleKey: TYPE_META[type].labelKey,
  descriptionKey: TYPE_META[type].descriptionKey,
  ready: true,
  type,
}));

export default function MarketingHub() {
  const t = useTranslations('app_marketing');
  const router = useRouter();
  const [posters, setPosters] = useState<QrPoster[] | null>(null);
  const [creatingType, setCreatingType] = useState<QrPosterType | null>(null);

  async function reload() {
    try {
      const arr = await api<QrPoster[]>('/qr-posters');
      setPosters(arr);
    } catch {
      setPosters([]);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  /** Crea una variante NUEVA del tipo elegido. Backend devuelve el id;
   *  redirigimos al editor por id para que el cliente lo edite. */
  async function createNew(type: QrPosterType) {
    setCreatingType(type);
    try {
      const created = await api<QrPoster>('/qr-posters', {
        method: 'POST',
        body: JSON.stringify({
          type,
          name: `${t(TYPE_META[type].labelKey)} #${
            (posters ?? []).filter((p) => p.type === type).length + 1
          }`,
        }),
      });
      router.push(`/app/marketing/edit/${created.id}`);
    } catch (e: any) {
      toast(e?.message || t('errorCreatePoster'), 'error');
    } finally {
      setCreatingType(null);
    }
  }

  async function rename(p: QrPoster) {
    const next = window.prompt(t('promptRename'), p.name || '');
    if (next == null) return;
    const trimmed = next.trim();
    if (trimmed === (p.name ?? '').trim()) return;
    try {
      await api(`/qr-posters/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: trimmed }),
      });
      reload();
    } catch (e: any) {
      toast(e?.message || t('errorRename'), 'error');
    }
  }

  async function remove(p: QrPoster) {
    if (
      !window.confirm(
        t('confirmRemove', { name: p.name?.trim() || t(TYPE_META[p.type].labelKey) }),
      )
    )
      return;
    try {
      await api(`/qr-posters/${p.id}`, { method: 'DELETE' });
      reload();
      toast(t('toastPosterRemoved'), 'success');
    } catch (e: any) {
      toast(e?.message || t('errorRemove'), 'error');
    }
  }

  async function toggleActive(p: QrPoster) {
    try {
      await api(`/qr-posters/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !p.isActive }),
      });
      reload();
    } catch (e: any) {
      toast(e?.message || t('errorUpdate'), 'error');
    }
  }

  // Agrupamos los carteles por tipo para mostrar la galería ordenada.
  const byType: Record<QrPosterType, QrPoster[]> = {
    MENU: [],
    COUNTER: [],
    DISCOUNT: [],
    REVIEWS: [],
    INFOLINK: [],
  };
  for (const p of posters ?? []) byType[p.type]?.push(p);

  const hasAny = (posters ?? []).length > 0;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">{t('pageTitle')}</h1>
        <AcademyButton moduleKey="qr" />
      </div>

      <p className="text-sm text-mute max-w-2xl mb-6 leading-relaxed">
        {t('intro')}
      </p>

      {/* "Mis QRs" — galería de carteles agrupada por tipo. Solo aparece
          si el tenant tiene al menos uno. Cada card es clickeable hacia
          el editor por id. Cada grupo tiene su propio botón "+ Nuevo". */}
      {hasAny && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-ink m-0">{t('myQrs')}</h2>
            <span className="text-xs text-mute">
              {t('posterCount', { count: (posters ?? []).length })}
            </span>
          </div>
          <div className="space-y-6">
            {(Object.keys(TYPE_META) as QrPosterType[]).map((type) => {
              const items = byType[type];
              if (items.length === 0) return null;
              const meta = TYPE_META[type];
              return (
                <div key={type}>
                  <div className="flex items-center justify-between mb-2 px-1">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{meta.emoji}</span>
                      <h3 className="font-semibold text-sm m-0">{t(meta.labelKey)}</h3>
                      <span className="text-[11px] text-mute">
                        · {items.length}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => createNew(type)}
                      disabled={creatingType === type}
                      className="btn-ghost text-xs"
                      title={t('addVariantTooltip', { label: t(meta.labelKey) })}
                    >
                      {creatingType === type ? t('creating') : t('addNew')}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {items.map((p) => (
                      <PosterCard
                        key={p.id}
                        poster={p}
                        onRename={() => rename(p)}
                        onRemove={() => remove(p)}
                        onToggleActive={() => toggleActive(p)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <h2 className="text-lg font-bold text-ink m-0 mb-3">
        {hasAny ? t('createNew') : t('startCreatingOne')}
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {TOOLS.map((tool) => {
          const card = (
            <div
              className={`card card-pad h-full flex flex-col gap-2 transition ${
                tool.ready
                  ? 'hover:shadow-card-hover hover:border-brand/40 cursor-pointer'
                  : 'opacity-75'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="text-3xl">{tool.emoji}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-ink">{t(tool.titleKey)}</h3>
                    {!tool.ready && <ConstructionBadge label={t('comingSoon')} />}
                  </div>
                </div>
                {tool.ready && (
                  <Icon name="arrow-right" size={18} className="text-mute" />
                )}
              </div>
              <p className="text-sm text-mute leading-relaxed">
                {t(tool.descriptionKey)}
              </p>
            </div>
          );

          return tool.ready ? (
            <Link key={tool.href} href={tool.href}>
              {card}
            </Link>
          ) : (
            <div key={tool.href}>{card}</div>
          );
        })}
      </div>
    </div>
  );
}

/** Card individual de un cartel — preview + nombre + acciones. Click en
 *  el preview o nombre lleva al editor por id; los botones renombrar/
 *  eliminar/pausar abren prompts. Muestra stats de escaneos y descargas. */
function PosterCard({
  poster,
  onRename,
  onRemove,
  onToggleActive,
}: {
  poster: QrPoster;
  onRename: () => void;
  onRemove: () => void;
  onToggleActive: () => void;
}) {
  const t = useTranslations('app_marketing');
  const meta = TYPE_META[poster.type];
  const inactive = !poster.isActive;
  return (
    <div className="group flex flex-col gap-2">
      <Link
        href={`/app/marketing/edit/${poster.id}`}
        className={`block relative ${inactive ? 'opacity-60 grayscale' : ''}`}
        title={inactive ? t('posterPausedTooltip') : t('editPosterTooltip')}
      >
        <QrPosterThumbnail config={poster.config} type={poster.type} />
        {inactive && (
          <span className="absolute top-1.5 left-1.5 bg-bad text-white text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">
            {t('paused')}
          </span>
        )}
      </Link>
      <div className="px-1 flex items-start gap-1">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">
            {poster.name?.trim() || t(meta.labelKey)}
          </div>
          <div className="text-[11px] text-mute mt-0.5 flex items-center gap-2">
            <span title={t('scansTooltip')}>👁 {poster.visitCount ?? 0}</span>
            <span title={t('downloadsTooltip')}>⬇ {poster.exportCount ?? 0}</span>
            <span>· {timeAgo(poster.updatedAt, t)}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleActive}
          className={`p-0.5 transition opacity-0 group-hover:opacity-100 ${
            inactive ? 'text-brand hover:text-brand-700' : 'text-mute hover:text-amber-600'
          }`}
          title={inactive ? t('reactivatePoster') : t('pausePoster')}
        >
          {inactive ? '▶' : '⏸'}
        </button>
        <button
          type="button"
          onClick={onRename}
          className="text-mute hover:text-brand p-0.5 opacity-0 group-hover:opacity-100 transition"
          title={t('rename')}
        >
          <Icon name="edit" size={14} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="text-mute hover:text-bad p-0.5 opacity-0 group-hover:opacity-100 transition"
          title={t('remove')}
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
    </div>
  );
}

/**
 * Preview ligero del QrPoster — captura el "feel" visual del diseño guardado
 * sin levantar el editor Konva completo (que pesa ~500KB de bundle).
 *
 * Renderiza con CSS:
 *   - Background del lienzo (solid/gradient/imagen — los 3 tipos del cfg)
 *   - Cuadrado QR proporcional con los colores guardados
 *   - Texto del título usando font/color/peso reales
 *   - Tipo del cartel como badge
 */
function QrPosterThumbnail({
  config,
  type,
}: {
  config: any;
  type: QrPosterType;
}) {
  const cfg = config ?? {};
  const canvas = cfg.canvas ?? { w: 1080, h: 1528 };
  const aspectRatio = `${canvas.w} / ${canvas.h}`;

  const bgStyle = bgToCss(cfg.bg);
  const qr = cfg.qr ?? {};
  const title = cfg.texts?.title;

  const qrSize = (qr.size ?? 560) / canvas.w;
  const qrX = (qr.x ?? 260) / canvas.w;
  const qrY = (qr.y ?? 620) / canvas.h;

  return (
    <div
      className="relative w-full rounded-lg border border-line2 overflow-hidden shadow-sm group-hover:shadow-md group-hover:border-brand/50 transition"
      style={{ aspectRatio, background: bgStyle }}
    >
      <div
        className="absolute"
        style={{
          left: `${qrX * 100}%`,
          top: `${qrY * 100}%`,
          width: `${qrSize * 100}%`,
          aspectRatio: '1 / 1',
          background: qr.bg ?? '#fff',
          padding: 4,
          borderRadius: qr.cornerRadius ? `${qr.cornerRadius / 6}px` : 0,
        }}
      >
        <QrLatticeMini fg={qr.fg ?? '#000'} />
      </div>
      {title?.text && (
        <div
          className="absolute left-0 right-0 px-2 text-center truncate"
          style={{
            top: title.y && canvas.h ? `${(title.y / canvas.h) * 100}%` : '8%',
            color: title.color ?? '#0a0a0a',
            fontFamily: title.font ?? 'Inter, system-ui, sans-serif',
            fontWeight: title.weight ?? 700,
            fontSize: 10,
            lineHeight: 1.1,
            textShadow: '0 1px 2px rgba(255,255,255,.4)',
          }}
        >
          {title.text.split('\n')[0]}
        </div>
      )}
      <div className="absolute top-1.5 right-1.5 bg-black/55 text-white text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider">
        {type}
      </div>
    </div>
  );
}

function bgToCss(bg: any): string {
  if (!bg) return '#FFFFFF';
  if (bg.type === 'solid') return bg.color1 ?? '#FFFFFF';
  if (bg.type === 'gradient') {
    const c1 = bg.color1 ?? '#FFFFFF';
    const c2 = bg.color2 ?? '#000000';
    if (bg.subtype === 'radial') return `radial-gradient(circle, ${c1}, ${c2})`;
    const angle = bg.subtype === 'diagonal' ? 135 : (bg.angle ?? 135);
    return `linear-gradient(${angle}deg, ${c1}, ${c2})`;
  }
  if (bg.type === 'image' && bg.url) {
    return `url(${JSON.stringify(bg.url)}) center/cover no-repeat`;
  }
  return '#FFFFFF';
}

function QrLatticeMini({ fg }: { fg: string }) {
  const cells: { row: number; col: number }[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r * 7 + c * 13 + ((r + c) * 5)) % 5 < 2) {
        cells.push({ row: r, col: c });
      }
    }
  }
  return (
    <svg viewBox="0 0 8 8" className="w-full h-full" preserveAspectRatio="none">
      {[
        [0, 0],
        [0, 5],
        [5, 0],
      ].map(([r, c]) => (
        <g key={`f-${r}-${c}`}>
          <rect x={c} y={r} width="3" height="3" fill={fg} />
          <rect x={c + 0.5} y={r + 0.5} width="2" height="2" fill="#fff" />
          <rect x={c + 1} y={r + 1} width="1" height="1" fill={fg} />
        </g>
      ))}
      {cells.map((cell) => (
        <rect
          key={`${cell.row}-${cell.col}`}
          x={cell.col}
          y={cell.row}
          width="1"
          height="1"
          fill={fg}
        />
      ))}
    </svg>
  );
}

function timeAgo(iso: string, t: (key: string, values?: Record<string, any>) => string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return t('timeJustNow');
  if (min < 60) return t('timeMinutesAgo', { min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t('timeHoursAgo', { hr });
  const days = Math.floor(hr / 24);
  if (days < 7) return t('timeDaysAgo', { days });
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}
