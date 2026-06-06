'use client';

import * as React from 'react';

type Props = {
  label: React.ReactNode;
  width: number;
  onResizeStart: (e: React.MouseEvent) => void;
  className?: string;
  align?: 'left' | 'right' | 'center';
};

/**
 * Header de columna estilo Excel/Airtable — texto truncado + strip
 * draggable al borde derecho. Se usa dentro de un wrapper que arme su
 * propio `gridTemplateColumns` con el mismo `width` numérico.
 */
export function ResizableHeader({
  label,
  width,
  onResizeStart,
  className,
  align = 'left',
}: Props) {
  const alignClass =
    align === 'right'
      ? 'text-right'
      : align === 'center'
        ? 'text-center'
        : 'text-left';
  return (
    <div
      style={{ width, minWidth: width, maxWidth: width }}
      className={`relative ${alignClass} ${className ?? ''}`}
    >
      <div className="truncate pr-2">{label}</div>
      <div
        onMouseDown={(e) => {
          // El strip vive sobre el header; evitamos que el click bubble
          // dispare ordenamientos u otros handlers del header.
          e.preventDefault();
          e.stopPropagation();
          onResizeStart(e);
        }}
        className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-brand/40 active:bg-brand/60 transition-colors"
        title="Arrastra para redimensionar"
      />
    </div>
  );
}
