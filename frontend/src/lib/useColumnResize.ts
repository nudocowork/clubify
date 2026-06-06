import { useEffect, useRef, useState } from 'react';

/**
 * Hook minimal estilo Excel/Airtable para columnas redimensionables.
 * - State { key -> width } + drag handler que escucha mousemove en window.
 * - Persiste en localStorage por `storageKey` (debounced 250ms).
 * - Merge con defaults para tolerar columnas nuevas en deploys posteriores.
 *
 * Diseño: sin libs externas — las tablas del menú son chicas, no
 * virtualizadas, y solo necesitan ancho per-columna + persistencia local.
 */
export function useColumnResize(
  storageKey: string,
  defaults: Record<string, number>,
) {
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    if (typeof window === 'undefined') return defaults;
    try {
      const cached = localStorage.getItem(storageKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        return { ...defaults, ...parsed };
      }
    } catch {}
    return defaults;
  });

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(widths));
      } catch {}
    }, 250);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [widths, storageKey]);

  function startResize(key: string, startX: number, startW: number) {
    function onMove(e: MouseEvent) {
      const dx = e.clientX - startX;
      const next = Math.max(60, Math.min(800, startW + dx));
      setWidths((prev) => ({ ...prev, [key]: next }));
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    // Evita que el drag seleccione texto en la página.
    document.body.style.userSelect = 'none';
  }

  function reset() {
    setWidths(defaults);
  }

  return { widths, startResize, reset };
}
