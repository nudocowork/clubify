'use client';
/**
 * Banner de difusión interna para afiliados.
 *
 * Pide GET /broadcasts/banner — si hay un banner activo dirigido al rol
 * del user que todavía no descartó, lo pinta encima de los tabs del panel.
 * El botón X dispara POST /broadcasts/:id/read y lo oculta.
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Color = 'GREEN' | 'BLUE' | 'YELLOW' | 'RED' | 'CUSTOM';
type IconKind = 'INFO' | 'ALERT' | 'NEWS' | 'TRAINING' | 'PROMO';

type Banner = {
  id: string;
  title: string;
  description: string;
  color: Color | null;
  customColor: string | null;
  icon: IconKind | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
};

const COLOR_PRESETS: Record<Exclude<Color, 'CUSTOM'>, { bg: string; ink: string }> = {
  GREEN: { bg: '#16a34a', ink: '#ffffff' },
  BLUE: { bg: '#2563eb', ink: '#ffffff' },
  YELLOW: { bg: '#f59e0b', ink: '#1f2937' },
  RED: { bg: '#dc2626', ink: '#ffffff' },
};

const ICON_SYMBOL: Record<IconKind, string> = {
  INFO: 'ℹ️',
  ALERT: '⚠️',
  NEWS: '📰',
  TRAINING: '🎓',
  PROMO: '🎁',
};

export function AffiliateBroadcastBanner() {
  const [banner, setBanner] = useState<Banner | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<Banner | null>('/broadcasts/banner')
      .then((b) => {
        if (!cancelled) setBanner(b ?? null);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  async function dismiss() {
    if (!banner) return;
    setDismissed(true);
    try {
      await api(`/broadcasts/${banner.id}/read`, { method: 'POST' });
    } catch {
      // Silencio: el usuario ya lo cerró visualmente, no vale alertarlo.
    }
  }

  if (!banner || dismissed) return null;

  const color: Color = banner.color ?? 'BLUE';
  const palette =
    color === 'CUSTOM'
      ? { bg: banner.customColor || '#2563eb', ink: '#ffffff' }
      : COLOR_PRESETS[color];
  const icon = banner.icon ?? 'INFO';

  return (
    <div
      className="rounded-xl px-4 py-3 mb-4 flex items-center gap-3 shadow-sm"
      style={{ background: palette.bg, color: palette.ink }}
    >
      <span className="text-2xl leading-none flex-none">{ICON_SYMBOL[icon]}</span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold leading-tight text-[14px]">
          {banner.title}
        </div>
        <div className="opacity-90 text-[12px] leading-snug">
          {banner.description}
        </div>
      </div>
      {banner.ctaLabel && banner.ctaUrl && (
        <a
          href={banner.ctaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 flex-none"
          style={{ color: palette.ink }}
        >
          {banner.ctaLabel}
        </a>
      )}
      <button
        onClick={dismiss}
        className="text-lg leading-none px-1 hover:opacity-70 flex-none"
        style={{ color: palette.ink }}
        title="Descartar"
      >
        ✕
      </button>
    </div>
  );
}
