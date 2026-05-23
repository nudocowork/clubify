'use client';

// Controla el popup opcional por categoría del menú público. Se monta
// una sola vez en el storefront público; el resto de los layouts no
// necesitan saber que existe.
//
// Cómo funciona:
//   - Recibe el array de categorías del menú (con su popupConfig).
//   - Trigger `auto`: usa IntersectionObserver para detectar cuando el
//     usuario llega a la sección (entry visible al 35% del viewport).
//     Dispara el popup la primera vez que aparece — si `oncePerSession`
//     está activo, sessionStorage previene reabrirlo en la misma visita.
//   - Trigger `click`: el header de la categoría debe renderizar el
//     componente <CategoryPopupBadge categoryId={...} /> que pulse y
//     dispara el popup al tap. Sin el badge no hay manera de abrir el
//     popup en modo click — pero los layouts vertical-acordeón pueden
//     mostrarlo automáticamente mirando data-cat-popup-trigger.
//
// Compatibilidad cross-layout: como TODOS los layouts vertical-acordeón
// usan `id="cat-${catId}"` en el wrapper de la sección, el observer
// los encuentra sin tocar cada layout individualmente.

import { useEffect, useMemo, useRef, useState } from 'react';

export type PopupConfig = {
  enabled: boolean;
  imageUrl?: string | null;
  title?: string | null;
  description?: string | null;
  buttonText?: string | null;
  buttonUrl?: string | null;
  buttonColor?: string | null;
  trigger?: 'auto' | 'click';
  oncePerSession?: boolean;
};

type CategoryLike = {
  id: string;
  popupConfig?: PopupConfig | null;
};

const SESSION_KEY_PREFIX = 'category_popup_seen_';

function wasSeen(catId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(SESSION_KEY_PREFIX + catId) === '1';
  } catch {
    return false;
  }
}

function markSeen(catId: string) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_KEY_PREFIX + catId, '1');
  } catch {
    // sessionStorage puede fallar en modo incognito estricto — ignoramos.
  }
}

export function CategoryPopupController({
  categories,
}: {
  categories: CategoryLike[];
}) {
  const [openCatId, setOpenCatId] = useState<string | null>(null);
  // Tracker para no reabrir el popup al hacer scroll de ida y vuelta.
  const firedRef = useRef<Set<string>>(new Set());

  // Categorías que tienen popup habilitado, indexadas por id para acceso O(1).
  const byId = useMemo(() => {
    const m = new Map<string, PopupConfig>();
    for (const c of categories) {
      if (c.popupConfig?.enabled) m.set(c.id, c.popupConfig);
    }
    return m;
  }, [categories]);

  // Auto trigger via IntersectionObserver. Se re-instala cuando cambia
  // el set de categorías con popup.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (byId.size === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = entry.target.id.replace(/^cat-/, '');
          const cfg = byId.get(id);
          if (!cfg || cfg.trigger === 'click') continue;
          if (firedRef.current.has(id)) continue;
          if (cfg.oncePerSession !== false && wasSeen(id)) {
            firedRef.current.add(id);
            continue;
          }
          firedRef.current.add(id);
          setOpenCatId(id);
        }
      },
      { threshold: 0.35 },
    );

    for (const catId of byId.keys()) {
      const el = document.getElementById(`cat-${catId}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [byId]);

  // Trigger click: cualquier elemento con data-cat-popup-trigger=catId
  // abre el popup al tap. Listener delegado en document para que cada
  // layout no tenga que conocer al controller.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      const trigger = target?.closest('[data-cat-popup-trigger]') as
        | HTMLElement
        | null;
      if (!trigger) return;
      const id = trigger.dataset.catPopupTrigger;
      if (!id) return;
      const cfg = byId.get(id);
      if (!cfg) return;
      e.preventDefault();
      e.stopPropagation();
      setOpenCatId(id);
    }
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [byId]);

  function close() {
    if (openCatId) {
      const cfg = byId.get(openCatId);
      if (cfg && cfg.oncePerSession !== false) markSeen(openCatId);
    }
    setOpenCatId(null);
  }

  const activeCfg = openCatId ? byId.get(openCatId) : null;
  if (!activeCfg) return null;

  return <CategoryPopupOverlay cfg={activeCfg} onClose={close} />;
}

/** Badge pulsante para trigger=click. Lo monta cada layout en el header
 *  de la categoría cuando `category.popupConfig?.trigger === 'click'`.
 *  Es solo visual — el click se captura globalmente por data attr. */
export function CategoryPopupBadge({
  categoryId,
  className = '',
}: {
  categoryId: string;
  className?: string;
}) {
  return (
    <span
      data-cat-popup-trigger={categoryId}
      role="button"
      tabIndex={0}
      aria-label="Ver detalle de la sección"
      className={`relative inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800 cursor-pointer select-none ${className}`}
    >
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
      </span>
      Tocar
    </span>
  );
}

function CategoryPopupOverlay({
  cfg,
  onClose,
}: {
  cfg: PopupConfig;
  onClose: () => void;
}) {
  // Lock body scroll mientras está abierto + cerrar con Escape.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4 animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl animate-in zoom-in-95 duration-200"
      >
        {cfg.imageUrl && (
          <img
            src={cfg.imageUrl}
            alt=""
            className="w-full max-h-[45vh] object-cover rounded-t-2xl"
          />
        )}
        <div className="p-5 space-y-3">
          {cfg.title && (
            <h3 className="text-lg font-bold m-0 leading-tight">{cfg.title}</h3>
          )}
          {cfg.description && (
            <p className="text-sm text-mute whitespace-pre-line leading-relaxed m-0">
              {cfg.description}
            </p>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="text-sm px-3 py-2 rounded-md text-mute hover:bg-bg2"
            >
              Cerrar
            </button>
            {cfg.buttonText && cfg.buttonUrl && (
              <a
                href={cfg.buttonUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onClose}
                className="text-sm font-semibold px-4 py-2 rounded-md text-white shadow-sm"
                style={{ background: cfg.buttonColor || '#22C55E' }}
              >
                {cfg.buttonText}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
