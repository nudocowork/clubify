'use client';
/**
 * Modal que se abre al tocar un botón type='POPUP' del InfoLink.
 *
 * Se monta una vez a nivel página (no por botón) — la página decide qué
 * popup mostrar pasando la config + un onClose. Soporta click fuera +
 * tecla Esc + botón X para cerrar.
 *
 * Animación: backdrop fade-in + card scale-up con tailwindcss-animate.
 */

import { useEffect } from 'react';
import type { PopupConfig } from '@/lib/info-link-popup';
import { popupMaxWidthPx, popupShadowCss } from '@/lib/info-link-popup';

export function InfoLinkPopupModal({
  popup,
  primary,
  onClose,
}: {
  popup: PopupConfig | null;
  /** Color de marca del InfoLink — fallback para CTA si ctaColor está
   *  vacío. */
  primary: string;
  onClose: () => void;
}) {
  // Esc cierra. Solo se activa cuando hay un popup montado para no
  // interferir con otros componentes de la página.
  useEffect(() => {
    if (!popup) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    // Bloqueamos scroll del body mientras el popup está abierto — UX
    // típica de modales para que no se "vea pasar" la página atrás.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [popup, onClose]);

  if (!popup) return null;
  const maxW = popupMaxWidthPx(popup.size);
  const ctaColor = popup.ctaColor || primary;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={() => {
        if (popup.closeOnOutside) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="infolink-popup-title"
    >
      <div
        className="relative w-full animate-in zoom-in-95 fade-in duration-200 max-h-[90vh] overflow-y-auto"
        style={{
          maxWidth: `${maxW}px`,
          background: popup.bgColor,
          color: popup.textColor,
          borderRadius: `${popup.borderRadius}px`,
          boxShadow: popupShadowCss(popup.shadow),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close X — siempre visible en la esquina */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full flex items-center justify-center text-xl bg-white/90 hover:bg-white text-ink shadow-md transition"
        >
          ×
        </button>

        {popup.imageUrl && (
          <div
            className="w-full overflow-hidden"
            style={{
              borderTopLeftRadius: `${popup.borderRadius}px`,
              borderTopRightRadius: `${popup.borderRadius}px`,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={popup.imageUrl}
              alt=""
              className="w-full h-auto block"
              style={{ maxHeight: '280px', objectFit: 'cover' }}
            />
          </div>
        )}

        <div className="px-6 py-5">
          <h2
            id="infolink-popup-title"
            className="text-xl font-bold leading-tight mb-2"
          >
            {popup.title || 'Información'}
          </h2>
          {popup.description && (
            <p className="text-sm leading-relaxed whitespace-pre-line opacity-90">
              {popup.description}
            </p>
          )}

          {popup.ctaText && popup.ctaUrl && (
            <a
              href={popup.ctaUrl}
              target={popup.ctaUrl.startsWith('http') ? '_blank' : undefined}
              rel="noreferrer"
              className="mt-5 inline-flex items-center justify-center w-full px-4 py-3 rounded-xl text-sm font-semibold text-white shadow-sm hover:opacity-90 transition"
              style={{ background: ctaColor }}
            >
              {popup.ctaText}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
