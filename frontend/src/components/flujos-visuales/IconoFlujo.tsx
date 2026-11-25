'use client';
import type { Textos } from './textos';

/**
 * Iconos de trazo del constructor. Dibujados aquí (y no con la biblioteca
 * general `Icon`) porque esa no tiene reloj de arena, rama ni bandera, y
 * mezclar dos familias de trazo en un mismo lienzo se nota.
 */
const TRAZOS: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  sparkles: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z',
  moon: 'M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z',
  stamp: 'M9 4h6l-1 6h3a3 3 0 013 3v2H4v-2a3 3 0 013-3h3zM5 19h14',
  gift: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0',
  ticket: 'M4 7h16v3a2 2 0 000 4v3H4v-3a2 2 0 000-4zM14 7v10',
  cake: 'M4 20h16v-7H4zM4 16c2 1.5 4 1.5 6 0s4-1.5 6 0 3 1.5 4 0M12 9v4M12 5l1 2h-2z',
  repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 014-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 01-4 4H4',
  wait: 'M7 3h10M7 21h10M8 3c0 4 8 5 8 9s-8 5-8 9M16 3c0 4-8 5-8 9s8 5 8 9',
  push: 'M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 004 0',
  sms: 'M4 5h16v11H8l-4 4z',
  whatsapp: 'M4 20l1.4-4A8 8 0 1112 20a8 8 0 01-4-1zM9 9c0 3 3 6 6 6l1-1.5-2-1-1 1c-1-.5-2-1.5-2.5-2.5l1-1-1-2z',
  condition: 'M6 3v6a3 3 0 003 3h6a3 3 0 013 3v6M6 21v-6M18 3v4M15 6l3-3 3 3',
  end: 'M5 21V4M5 4h11l-2 4 2 4H5',
  trigger: 'M13 2L4 14h7l-1 8 9-12h-7z',
  'zoom-in': 'M11 4a7 7 0 110 14 7 7 0 010-14zM20 20l-4-4M11 8v6M8 11h6',
  'zoom-out': 'M11 4a7 7 0 110 14 7 7 0 010-14zM20 20l-4-4M8 11h6',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  x: 'M6 6l12 12M18 6L6 18',
  alert: 'M12 3l10 18H2zM12 10v4M12 17.5v.5',
  check: 'M5 12l5 5L20 7',
};

export function IconoFlujo({ nombre, size = 18, className = '' }: { nombre: string; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={TRAZOS[nombre] ?? TRAZOS.sparkles} />
    </svg>
  );
}

export function PildoraEstado({ estado, t }: { estado: string; t: Textos }) {
  const estilo =
    estado === 'active' ? 'bg-ok-soft text-ok-ink' : estado === 'paused' ? 'bg-warn-soft text-warn-ink' : 'bg-bg2 text-mute';
  const punto = estado === 'active' ? 'bg-ok' : estado === 'paused' ? 'bg-warn' : 'bg-mute2';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap ${estilo}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${punto}`} />
      {t.estado[estado] ?? estado}
    </span>
  );
}
