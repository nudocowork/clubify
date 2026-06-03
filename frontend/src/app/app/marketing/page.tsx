'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { ConstructionBadge } from '@/components/UnderConstruction';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type QrTool = {
  href: string;
  emoji: string;
  title: string;
  description: string;
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
  { emoji: string; label: string; href: string; description: string }
> = {
  MENU: {
    emoji: '🍽',
    label: 'QR Menú',
    href: '/app/marketing/qr-menu',
    description:
      'Cartel imprimible con el QR de tu menú digital. Ideal para mesas, mostrador o vitrina.',
  },
  COUNTER: {
    emoji: '🪪',
    label: 'QR Mostrador',
    href: '/app/marketing/qr-counter',
    description:
      'Cartel para que el cliente escanee, instale su wallet y empiece a sumar sellos al instante.',
  },
  DISCOUNT: {
    emoji: '🎁',
    label: 'QR Descuento',
    href: '/app/marketing/qr-discount',
    description:
      'Cartel promocional para campañas, primera compra, activaciones y descuentos.',
  },
  REVIEWS: {
    emoji: '⭐',
    label: 'QR Reseñas',
    href: '/app/marketing/qr-reviews',
    description:
      'Cartel para incentivar reseñas de Google. Filtro inteligente 4-5★ → Google, 1-3★ → privado.',
  },
  INFOLINK: {
    emoji: '🔗',
    label: 'QR Infolink',
    href: '/app/marketing/qr-infolink',
    description:
      'Cartel para el mini-sitio tipo Linktree del negocio. Redes, eventos, promos en un solo link dinámico.',
  },
};

const TOOLS: QrTool[] = (Object.keys(TYPE_META) as QrPosterType[]).map((t) => ({
  href: TYPE_META[t].href,
  emoji: TYPE_META[t].emoji,
  title: TYPE_META[t].label,
  description: TYPE_META[t].description,
  ready: true,
  type: t,
}));

export default function MarketingHub() {
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
          name: `${TYPE_META[type].label} #${
            (posters ?? []).filter((p) => p.type === type).length + 1
          }`,
        }),
      });
      router.push(`/app/marketing/edit/${created.id}`);
    } catch (e: any) {
      toast(e?.message || 'No se pudo crear el cartel', 'error');
    } finally {
      setCreatingType(null);
    }
  }

  async function rename(p: QrPoster) {
    const next = window.prompt('Nuevo nombre para este cartel:', p.name || '');
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
      toast(e?.message || 'No se pudo renombrar', 'error');
    }
  }

  async function remove(p: QrPoster) {
    if (
      !window.confirm(
        `¿Eliminar el cartel "${p.name?.trim() || TYPE_META[p.type].label}"?\n\nEsta acción no se puede deshacer.`,
      )
    )
      return;
    try {
      await api(`/qr-posters/${p.id}`, { method: 'DELETE' });
      reload();
      toast('Cartel eliminado', 'success');
    } catch (e: any) {
      toast(e?.message || 'No se pudo eliminar', 'error');
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
      toast(e?.message || 'No se pudo actualizar', 'error');
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
        <h1 className="page-title">Marketing</h1>
      </div>

      <p className="text-sm text-mute max-w-2xl mb-6 leading-relaxed">
        Crea carteles QR profesionales para imprimir y usar en tu negocio.
        Puedes tener varias variantes del mismo tipo — cada una con su
        diseño. Cada QR es dinámico: si cambias menú, wallet o reseñas, el
        QR sigue funcionando automáticamente.
      </p>

      {/* "Mis QRs" — galería de carteles agrupada por tipo. Solo aparece
          si el tenant tiene al menos uno. Cada card es clickeable hacia
          el editor por id. Cada grupo tiene su propio botón "+ Nuevo". */}
      {hasAny && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-ink m-0">Mis QRs</h2>
            <span className="text-xs text-mute">
              {(posters ?? []).length} cartel
              {(posters ?? []).length === 1 ? '' : 'es'}
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
                      <h3 className="font-semibold text-sm m-0">{meta.label}</h3>
                      <span className="text-[11px] text-mute">
                        · {items.length}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => createNew(type)}
                      disabled={creatingType === type}
                      className="btn-ghost text-xs"
                      title={`Agregar otra variante de ${meta.label}`}
                    >
                      {creatingType === type ? 'Creando…' : '+ Nuevo'}
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
        {hasAny ? 'Crear nuevo' : 'Empieza creando uno'}
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
                    <h3 className="font-bold text-ink">{tool.title}</h3>
                    {!tool.ready && <ConstructionBadge label="Próximamente" />}
                  </div>
                </div>
                {tool.ready && (
                  <Icon name="arrow-right" size={18} className="text-mute" />
                )}
              </div>
              <p className="text-sm text-mute leading-relaxed">
                {tool.description}
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
  const meta = TYPE_META[poster.type];
  const inactive = !poster.isActive;
  return (
    <div className="group flex flex-col gap-2">
      <Link
        href={`/app/marketing/edit/${poster.id}`}
        className={`block relative ${inactive ? 'opacity-60 grayscale' : ''}`}
        title={inactive ? 'Cartel pausado — clic para editar' : 'Editar este cartel'}
      >
        <QrPosterThumbnail config={poster.config} type={poster.type} />
        {inactive && (
          <span className="absolute top-1.5 left-1.5 bg-bad text-white text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">
            Pausado
          </span>
        )}
      </Link>
      <div className="px-1 flex items-start gap-1">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">
            {poster.name?.trim() || meta.label}
          </div>
          <div className="text-[11px] text-mute mt-0.5 flex items-center gap-2">
            <span title="Escaneos del QR">👁 {poster.visitCount ?? 0}</span>
            <span title="Descargas del cartel">⬇ {poster.exportCount ?? 0}</span>
            <span>· {timeAgo(poster.updatedAt)}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleActive}
          className={`p-0.5 transition opacity-0 group-hover:opacity-100 ${
            inactive ? 'text-brand hover:text-brand-700' : 'text-mute hover:text-amber-600'
          }`}
          title={inactive ? 'Reactivar cartel' : 'Pausar cartel'}
        >
          {inactive ? '▶' : '⏸'}
        </button>
        <button
          type="button"
          onClick={onRename}
          className="text-mute hover:text-brand p-0.5 opacity-0 group-hover:opacity-100 transition"
          title="Renombrar"
        >
          <Icon name="edit" size={14} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="text-mute hover:text-bad p-0.5 opacity-0 group-hover:opacity-100 transition"
          title="Eliminar"
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

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr}h`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `hace ${days}d`;
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}
