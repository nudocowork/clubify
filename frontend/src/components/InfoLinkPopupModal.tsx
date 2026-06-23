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

export type PopupContinueAction = {
  /** Label del botón primario. Default: "Continuar →". */
  label?: string;
  /** Label del botón secundario de cancelar. Default: "Cancelar". */
  cancelLabel?: string;
  /** Callback al confirmar. El modal lo invoca y cierra a continuación
   *  — el caller se encarga de window.open / window.location. */
  onContinue: () => void;
};

export function InfoLinkPopupModal({
  popup,
  primary,
  onClose,
  continueAction,
}: {
  popup: PopupConfig | null;
  /** Color de marca del InfoLink — fallback para CTA si ctaColor está
   *  vacío. */
  primary: string;
  onClose: () => void;
  /** Si está presente, el popup es PRE-ACCIÓN: muestra botón "Continuar"
   *  que ejecuta la acción original del botón, + botón "Cancelar" que
   *  solo cierra. El CTA tradicional (ctaText/ctaUrl del config) sigue
   *  apareciendo como link adicional si existe — caso típico: "Antes
   *  de reservar, instala tu tarjeta" con dos opciones distintas. */
  continueAction?: PopupContinueAction;
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

  // Auto-close timer (G3): si la config trae autoCloseSeconds > 0, el
  // popup se cierra solo después de N segundos. Útil para avisos tipo
  // "toast modal". El user puede cerrar antes con X / Esc / outside.
  useEffect(() => {
    if (!popup) return;
    const secs = popup.autoCloseSeconds ?? 0;
    if (!secs || secs <= 0) return;
    const t = window.setTimeout(onClose, secs * 1000);
    return () => window.clearTimeout(t);
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
              // Mostramos la imagen COMPLETA (sin recorte): ancho 100% + alto
              // automático respeta la proporción real (vertical/horizontal/
              // cuadrada). Si queda muy alta, el modal scrollea (el contenedor
              // padre tiene max-h-[90vh] overflow-y-auto) en vez de cortar.
              // Fondo neutro por si la imagen tarda en cargar.
              background: 'rgba(0,0,0,0.04)',
              borderTopLeftRadius: `${popup.borderRadius}px`,
              borderTopRightRadius: `${popup.borderRadius}px`,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={popup.imageUrl}
              alt=""
              className="block w-full h-auto"
              style={{ objectFit: 'contain' }}
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

          {/* CTA tradicional (ctaText + ctaUrl del config). Aparece como
              botón secundario cuando hay continueAction (caso popup
              pre-acción con CTA extra tipo "Instalar tarjeta wallet"). */}
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

          {/* Botón wallet (G3): si el popup tiene walletCardId, abre
              /c/<id> en nueva pestaña — el cliente puede agregar la
              tarjeta de fidelización ahí mismo. Cierra el popup tras
              clickear así no queda tapando la nueva tab. */}
          {popup.walletCardId && (
            <a
              href={`/c/${popup.walletCardId}`}
              target="_blank"
              rel="noreferrer"
              onClick={() => onClose()}
              className="mt-3 inline-flex items-center justify-center w-full px-4 py-3 rounded-xl text-sm font-semibold border-2 hover:opacity-90 transition"
              style={{
                borderColor: ctaColor,
                color: ctaColor,
                background: 'transparent',
              }}
            >
              {popup.walletCardLabel || '🎁 Instalar tarjeta de fidelización'}
            </a>
          )}

          {/* Botones pre-acción: continuar (primario) + cancelar */}
          {continueAction && (
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  continueAction.onContinue();
                  onClose();
                }}
                className="inline-flex items-center justify-center w-full px-4 py-3 rounded-xl text-sm font-semibold text-white shadow-sm hover:opacity-90 transition"
                style={{ background: ctaColor }}
              >
                {continueAction.label ?? 'Continuar →'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center justify-center w-full px-4 py-2.5 rounded-xl text-sm font-medium opacity-70 hover:opacity-100 transition"
              >
                {continueAction.cancelLabel ?? 'Cancelar'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
