'use client';
/**
 * Academia — botón contextual "▶ Ver tutorial" (Propuesta 1: minimalista).
 * Se coloca en el header de un módulo con <AcademyButton moduleKey="wallet" />.
 * - Invisible si la marca no tiene un video activo para ese módulo.
 * - Abre un popup centrado con el iframe de YouTube EMBEBIDO (carga solo al
 *   hacer clic — el iframe se monta con el popup, nunca antes).
 * - Responsive: en móvil el popup ocupa el ancho completo.
 */
import { useEffect, useState } from 'react';
import { useAcademyVideos } from '@/lib/useAcademyVideos';
import { ACADEMY_MODULE_LABEL, youTubeEmbedUrl } from '@/lib/academy-modules';

export function AcademyButton({
  moduleKey,
  className = '',
}: {
  moduleKey: string;
  className?: string;
}) {
  const videos = useAcademyVideos();
  const v = videos[moduleKey];
  const [open, setOpen] = useState(false);
  const embed = v ? youTubeEmbedUrl(v.youtubeUrl) : null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Invisible (no deshabilitado) si no hay video activo/válido para el módulo.
  if (!v || !embed) return null;

  const title = (v.title || '').trim() || ACADEMY_MODULE_LABEL[moduleKey] || 'Tutorial';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`academy-pill ${className}`}
        aria-haspopup="dialog"
      >
        <span className="academy-tri" aria-hidden="true">▶</span>
        <span>Ver tutorial</span>
      </button>

      {open && (
        <div
          className="academy-overlay"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="academy-modal card"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="academy-x"
              onClick={() => setOpen(false)}
              aria-label="Cerrar"
            >
              ✕
            </button>
            <div className="academy-pad">
              <h3 className="academy-title">{title}</h3>
              <div className="academy-frame">
                {/* iframe montado SOLO al abrir → carga bajo demanda */}
                <iframe
                  src={embed}
                  title={title}
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
              {(v.description || '').trim() && (
                <p className="academy-desc">{v.description}</p>
              )}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .academy-pill {
          display: inline-flex; align-items: center; gap: 7px; white-space: nowrap;
          border: 1px solid var(--line, #e3e8e3); border-radius: 999px;
          background: var(--surface, #fff); color: var(--ink, #16201b);
          font-size: 12.5px; font-weight: 600; padding: 7px 13px; cursor: pointer;
          box-shadow: 0 2px 8px -2px rgba(20,30,24,.10); transition: border-color .16s, color .16s;
          line-height: 1;
        }
        .academy-pill:hover { border-color: var(--brand, #16a34a); color: var(--brand, #16a34a); }
        .academy-pill:focus-visible { outline: 2px solid var(--brand, #16a34a); outline-offset: 3px; }
        .academy-tri { color: var(--brand, #16a34a); font-size: 10px; }

        .academy-overlay {
          position: fixed; inset: 0; z-index: 60; display: flex; align-items: center;
          justify-content: center; padding: 20px;
          background: rgba(10,14,12,.55); backdrop-filter: blur(2px);
          animation: academyFade .16s ease;
        }
        @keyframes academyFade { from { opacity: 0; } }
        .academy-modal {
          position: relative; width: 100%; max-width: 720px; max-height: 92vh; overflow: auto;
        }
        .academy-x {
          position: absolute; top: 12px; right: 12px; z-index: 2; width: 34px; height: 34px;
          border-radius: 50%; border: 1px solid var(--line, #e3e8e3);
          background: var(--surface, #fff); color: var(--ink, #16201b); cursor: pointer;
          font-size: 15px; display: grid; place-items: center;
        }
        .academy-x:focus-visible { outline: 2px solid var(--brand, #16a34a); outline-offset: 2px; }
        .academy-pad { padding: 20px 22px 22px; }
        .academy-title { margin: 0 34px 12px 0; font-size: 18px; font-weight: 750; letter-spacing: -.01em; }
        .academy-frame { aspect-ratio: 16/9; border-radius: 12px; overflow: hidden; background: #000; }
        .academy-frame :global(iframe) { width: 100%; height: 100%; border: 0; display: block; }
        .academy-desc { margin: 14px 0 0; color: var(--muted, #647069); font-size: 14px; line-height: 1.55; }
        @media (max-width: 560px) {
          .academy-overlay { padding: 0; align-items: flex-end; }
          .academy-modal { max-width: 100%; max-height: 94vh; border-radius: 18px 18px 0 0; }
        }
      `}</style>
    </>
  );
}
