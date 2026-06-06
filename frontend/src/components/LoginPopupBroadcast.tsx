'use client';
/**
 * Popup bloqueante de difusión interna para los equipos comerciales.
 *
 * Al cargar (post-login si ya hay sesión, o cuando aparece en pantalla),
 * pega a GET /broadcasts/login-popup. Si devuelve una pieza pendiente,
 * abre un modal que NO se puede cerrar con Esc ni clickeando afuera —
 * solo con el botón principal (confirmLabel). El click dispara
 * POST /broadcasts/:id/read, que lo marca leído y nunca más vuelve a
 * salir para este user (UNIQUE broadcastId+userId en BroadcastRead).
 *
 * Si el SUPER_ADMIN crea un popup NUEVO, ese sí aparece (no hay
 * BroadcastRead todavía para esa pieza+user).
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type MediaKind = 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'PDF';

type Popup = {
  id: string;
  title: string;
  description: string;
  mediaKind: MediaKind | null;
  mediaUrl: string | null;
  confirmLabel: string | null;
};

export function LoginPopupBroadcast() {
  const [popup, setPopup] = useState<Popup | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<Popup | null>('/broadcasts/login-popup')
      .then((p) => {
        if (!cancelled) setPopup(p ?? null);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  // Bloquear scroll del body mientras el modal está abierto.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!popup) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [popup]);

  async function confirm() {
    if (!popup || busy) return;
    setBusy(true);
    try {
      await api(`/broadcasts/${popup.id}/read`, { method: 'POST' });
      setPopup(null);
    } catch {
      // Si falla el POST igual ocultamos: peor UX dejarlo trabado.
      setPopup(null);
    } finally {
      setBusy(false);
    }
  }

  if (!popup) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 animate-in zoom-in-95 fade-in duration-150 shadow-2xl">
        <div className="font-bold text-lg mb-3">{popup.title}</div>

        {popup.mediaKind === 'IMAGE' && popup.mediaUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={popup.mediaUrl}
            alt=""
            className="w-full rounded-xl mb-3 object-cover"
          />
        )}
        {popup.mediaKind === 'VIDEO' && popup.mediaUrl && (
          <video
            src={popup.mediaUrl}
            controls
            className="w-full rounded-xl mb-3"
          />
        )}
        {popup.mediaKind === 'AUDIO' && popup.mediaUrl && (
          <audio src={popup.mediaUrl} controls className="w-full mb-3" />
        )}
        {popup.mediaKind === 'PDF' && popup.mediaUrl && (
          <a
            href={popup.mediaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-violet-700 underline text-sm mb-3"
          >
            📄 Abrir documento
          </a>
        )}

        <div className="text-sm text-ink whitespace-pre-wrap leading-relaxed mb-5">
          {popup.description}
        </div>

        <button
          onClick={confirm}
          disabled={busy}
          className="btn-primary w-full"
        >
          {busy ? 'Guardando…' : popup.confirmLabel || 'He leído'}
        </button>
      </div>
    </div>
  );
}
