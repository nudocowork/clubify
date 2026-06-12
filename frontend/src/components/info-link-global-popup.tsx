'use client';
/**
 * Popup promocional global para InfoLink (Bloque 1 — 2026-06-12).
 *
 * Se monta cuando `link.theme.popup.enabled === true`. Muestra una
 * ventana emergente con título, imagen, descripción y CTA. Una sola
 * vez por sesión si `oncePerSession=true`.
 */
import { useEffect, useState } from 'react';
import type { InfoLinkPopup } from '@/lib/info-link-extras';

const SESSION_KEY_PREFIX = 'info_link_popup_seen_';

function wasSeen(linkId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(SESSION_KEY_PREFIX + linkId) === '1';
  } catch {
    return false;
  }
}

function markSeen(linkId: string) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_KEY_PREFIX + linkId, '1');
  } catch {
    /* sessionStorage no disponible en incognito estricto */
  }
}

export function InfoLinkGlobalPopup({
  linkId,
  config,
  primary,
}: {
  linkId: string;
  config: InfoLinkPopup | null | undefined;
  primary: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!config?.enabled) return;
    if (config.oncePerSession && wasSeen(linkId)) return;
    const delay = Math.max(0, config.delaySeconds ?? 3) * 1000;
    const t = setTimeout(() => {
      setOpen(true);
      if (config.oncePerSession) markSeen(linkId);
    }, delay);
    return () => clearTimeout(t);
  }, [linkId, config?.enabled, config?.delaySeconds, config?.oncePerSession]);

  if (!config?.enabled || !open) return null;

  const hasContent =
    !!config.imageUrl ||
    !!config.title?.trim() ||
    !!config.description?.trim() ||
    !!config.buttonText?.trim();
  if (!hasContent) return null;

  const buttonBg = config.buttonColor || primary;

  function handleButton() {
    setOpen(false);
    const url = config?.buttonUrl?.trim();
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4 animate-in fade-in"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-white text-ink rounded-t-3xl sm:rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in slide-in-from-bottom-8 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {config.imageUrl && (
          <img
            src={config.imageUrl}
            alt={config.title ?? ''}
            className="w-full h-48 object-cover"
          />
        )}
        <div className="px-5 py-5">
          {config.title && (
            <h3 className="text-xl font-bold m-0 leading-tight">
              {config.title}
            </h3>
          )}
          {config.description && (
            <p className="text-sm text-mute mt-2 leading-relaxed whitespace-pre-wrap">
              {config.description}
            </p>
          )}
          <div className="mt-5 flex flex-col gap-2">
            {config.buttonText && (
              <button
                type="button"
                onClick={handleButton}
                className="w-full py-3 rounded-full font-semibold text-white text-sm shadow-md active:scale-[0.97] transition-transform"
                style={{ background: buttonBg }}
              >
                {config.buttonText}
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-full py-2 text-xs text-mute hover:text-ink"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
