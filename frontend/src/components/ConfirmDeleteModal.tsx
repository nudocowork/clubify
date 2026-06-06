'use client';
/**
 * Modal genérico de confirmación para acciones destructivas (DELETE).
 * Bloquea el botón confirmar mientras corre la acción (loading state).
 * El padre maneja el try/catch — si el endpoint tira 409 (dependencias
 * activas) el mensaje aparece como toast separado.
 */
import { useState } from 'react';

export function ConfirmDeleteModal({
  title,
  description,
  confirmLabel = 'Eliminar',
  cancelLabel = 'Cancelar',
  requireText,
  onConfirm,
  onClose,
}: {
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * Si se provee, el botón confirmar queda deshabilitado hasta que el
   * usuario tipee EXACTAMENTE este valor (case-sensitive). Pensado para
   * acciones irreversibles tipo eliminar negocio.
   */
  requireText?: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const matches = !requireText || confirmText === requireText;

  async function handleConfirm() {
    if (busy || !matches) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4">
      {/* Mobile: bottom-sheet con bordes redondos arriba. Desktop: card. */}
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
        <div className="px-5 py-4 border-b border-line2 flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-bad-soft flex items-center justify-center text-bad shrink-0">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-5 h-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-base">{title}</div>
          </div>
        </div>
        <div className="px-5 py-4 text-sm text-ink leading-relaxed">
          {description}
          {requireText && (
            <div className="mt-4">
              <label className="block text-xs text-mute mb-1.5">
                Escribe{' '}
                <span className="font-mono font-semibold text-ink bg-bg2 px-1.5 py-0.5 rounded">
                  {requireText}
                </span>{' '}
                para confirmar
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                className="w-full bg-white border border-line2 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-brand"
                placeholder={requireText}
              />
            </div>
          )}
        </div>
        {/* Mobile: cancelar abajo (col-reverse) — confirm queda arriba
            como acción primaria a tap natural. Desktop: row tradicional. */}
        <div className="px-5 py-3 border-t border-line2 flex flex-col-reverse sm:flex-row items-stretch sm:items-center sm:justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn-ghost text-sm disabled:opacity-50 justify-center min-h-[44px]"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy || !matches}
            className="text-sm font-semibold px-4 py-2 rounded-md bg-bad text-white hover:bg-bad/90 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] cursor-pointer touch-manipulation select-none active:scale-[0.97] transition-transform duration-150"
          >
            {busy ? 'Eliminando…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
