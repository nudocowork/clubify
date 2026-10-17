'use client';
import { useEffect } from 'react';

/**
 * Ventana del reporte. En el celular ocupa la pantalla desde abajo (hoja) y
 * hace scroll por dentro; en escritorio es una caja centrada.
 */
export function Modal({
  titulo,
  subtitulo,
  onCerrar,
  children,
  ancho = 'max-w-2xl',
}: {
  titulo: string;
  subtitulo?: string;
  onCerrar: () => void;
  children: React.ReactNode;
  ancho?: string;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', k);
      document.body.style.overflow = prev;
    };
  }, [onCerrar]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onCerrar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className={`bg-white w-full ${ancho} max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-line2 px-4 sm:px-5 py-3 flex items-start justify-between gap-3 z-10">
          <div className="min-w-0">
            <h3 className="m-0 text-[15px] font-semibold text-ink">{titulo}</h3>
            {subtitulo && <p className="text-xs text-mute mt-0.5">{subtitulo}</p>}
          </div>
          <button onClick={onCerrar} className="text-mute hover:text-ink text-xl leading-none px-1" aria-label="Cerrar">
            ×
          </button>
        </div>
        <div className="px-4 sm:px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/** Campo de motivo: obligatorio en todo cambio, queda en el historial. */
export function CampoMotivo({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label">Motivo del cambio (obligatorio)</label>
      <textarea
        className="input"
        rows={2}
        maxLength={500}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Por qué se hace este cambio. Queda en el historial con tu nombre y la hora."
      />
    </div>
  );
}
