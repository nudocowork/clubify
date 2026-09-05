'use client';
/**
 * Popup promocional global para InfoLink (Bloque 1 — 2026-06-12,
 * multi-popup — 2026-06-15).
 *
 * Soporta tanto el popup singular legacy (`link.theme.popup`) como el
 * array multi-popup (`link.theme.popups`). Cuando hay varios, mostramos
 * el primero matchable (enabled + schedule + sin "visto" en sesión).
 */
import { useEffect, useState } from 'react';
import { avisoYaVisto, marcarAvisoVisto } from '@/lib/popup-visto';
import {
  combineInfoLinkPopups,
  popupScheduleMatches,
  type InfoLinkPopup,
} from '@/lib/info-link-extras';
import { useT } from '@/lib/i18n';

const SESSION_KEY_PREFIX = 'info_link_popup_seen_';

function popupKey(linkId: string, popup: InfoLinkPopup, index: number): string {
  // Si el popup tiene `id` explícito, lo usamos como sub-key (multi-popup
  // nuevo). Sino caemos a linkId solo (singular legacy) o index (fallback).
  if (popup.id) return `${SESSION_KEY_PREFIX}${linkId}_${popup.id}`;
  if (index === 0) return `${SESSION_KEY_PREFIX}${linkId}`;
  return `${SESSION_KEY_PREFIX}${linkId}_${index}`;
}

// `localStorage` con caducidad y no `sessionStorage`: la marca por PESTAÑA
// hacía que el mismo aviso saliera otra vez en cada pestaña nueva, y otra vez
// al pasar de la página del link al menú. Se le enseña una vez al día.
function wasSeen(key: string): boolean {
  if (typeof window === 'undefined') return false;
  return avisoYaVisto(key);
}

function markSeen(key: string) {
  if (typeof window === 'undefined') return;
  marcarAvisoVisto(key);
}

export function InfoLinkGlobalPopup({
  linkId,
  config,
  popups,
  primary,
}: {
  linkId: string;
  config: InfoLinkPopup | null | undefined;
  popups?: InfoLinkPopup[] | null;
  primary: string;
}) {
  const tt = useT();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const all = combineInfoLinkPopups(config, popups);

  useEffect(() => {
    if (!all.length) return;
    const now = new Date();
    // Encuentra el primer popup matchable: enabled + schedule + no visto.
    let chosen: { popup: InfoLinkPopup; index: number } | null = null;
    for (let i = 0; i < all.length; i++) {
      const p = all[i];
      if (!p?.enabled) continue;
      if (!popupScheduleMatches(p.schedule, now)) continue;
      if (p.oncePerSession && wasSeen(popupKey(linkId, p, i))) continue;
      chosen = { popup: p, index: i };
      break;
    }
    if (!chosen) return;
    const delay = Math.max(0, chosen.popup.delaySeconds ?? 3) * 1000;
    const t = setTimeout(() => {
      setActiveIndex(chosen!.index);
      if (chosen!.popup.oncePerSession) {
        markSeen(popupKey(linkId, chosen!.popup, chosen!.index));
      }
    }, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkId, JSON.stringify(all.map((p) => ({ id: p.id, e: p.enabled, s: p.schedule, d: p.delaySeconds, o: p.oncePerSession })))]);

  if (activeIndex === null) return null;
  const popup = all[activeIndex];
  if (!popup?.enabled) return null;

  const hasContent =
    !!popup.imageUrl ||
    !!popup.title?.trim() ||
    !!popup.description?.trim() ||
    !!popup.buttonText?.trim();
  if (!hasContent) return null;

  const buttonBg = popup.buttonColor || primary;

  function handleButton() {
    setActiveIndex(null);
    const url = popup?.buttonUrl?.trim();
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4 animate-in fade-in"
      onClick={() => setActiveIndex(null)}
    >
      <div
        className="bg-white text-ink rounded-t-3xl sm:rounded-3xl w-full max-w-md overflow-hidden max-h-[90vh] overflow-y-auto shadow-2xl animate-in slide-in-from-bottom-8 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {popup.imageUrl && (
          // Imagen COMPLETA (sin recorte): h-auto respeta la proporción real.
          // Si queda muy alta, el modal scrollea (max-h-[90vh] overflow-y-auto).
          <img
            src={popup.imageUrl}
            alt={popup.title ?? ''}
            className="block w-full h-auto"
            style={{ background: 'rgba(0,0,0,0.04)' }}
          />
        )}
        <div className="px-5 py-5">
          {popup.title && (
            <h3 className="text-xl font-bold m-0 leading-tight">
              {popup.title}
            </h3>
          )}
          {popup.description && (
            <p className="text-sm text-mute mt-2 leading-relaxed whitespace-pre-wrap">
              {popup.description}
            </p>
          )}
          <div className="mt-5 flex flex-col gap-2">
            {popup.buttonText && (
              <button
                type="button"
                onClick={handleButton}
                className="w-full py-3 rounded-full font-semibold text-white text-sm shadow-md active:scale-[0.97] transition-transform"
                style={{ background: buttonBg }}
              >
                {popup.buttonText}
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveIndex(null)}
              className="w-full py-2 text-xs text-mute hover:text-ink"
            >
              {tt('common.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
