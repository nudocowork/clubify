'use client';

/**
 * Una fila de la lista de mensajes: de una sola línea y sin nada que desplegar.
 *
 * Antes cada mensaje era una tarjeta que se abría hacia abajo y empujaba a las
 * de debajo: con 30 mensajes abiertos en cadena no se sabía dónde estabas. Aquí
 * la fila solo INFORMA (nombre, principio del texto, por dónde sale y si está
 * enviando) y editar ocurre en el panel lateral.
 *
 * Colores por tokens: el punto de «Activo» va con `bg-brand`, así que bajo
 * `.brand-panel` es del color de la marca. «Apagado» va en ámbar (`warn`),
 * que es un color de estado y no cambia con la marca a propósito: apagado tiene
 * que verse igual de raro en todas.
 */

import {
  correoDe,
  nombreDeCanal,
  vistaPrevia,
  type BrandMsgTemplate,
} from './tipos';

type Props = {
  t: BrandMsgTemplate;
  /** Nombre de la carpeta; solo se pinta cuando la lista mezcla carpetas. */
  carpeta?: string | null;
  abierta: boolean;
  onAbrir: () => void;
};

export default function FilaDeMensaje({ t, carpeta, abierta, onAbrir }: Props) {
  const correo = correoDe(t);
  const hayWhatsapp = t.channel === 'SMS';
  const previa = vistaPrevia(t.channel === 'EMAIL' ? correo?.body ?? t.text : t.text);

  return (
    <button
      type="button"
      onClick={onAbrir}
      aria-expanded={abierta}
      className={`w-full min-h-[56px] flex items-center gap-3 border-b border-line2 px-3 py-2.5 text-left transition last:border-b-0 ${
        abierta ? 'bg-bg2' : 'hover:bg-bg2'
      }`}
    >
      <span
        aria-hidden
        className="grid h-9 w-9 shrink-0 place-items-center rounded-input bg-bg2 text-base"
      >
        {correo && !hayWhatsapp ? '📧' : '💬'}
      </span>

      <span className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className="truncate text-sm font-semibold text-ink">{t.label}</span>
        <span className="hidden min-w-0 flex-1 truncate text-xs text-mute2 md:block">
          {previa}
        </span>
      </span>

      {carpeta && (
        <span className="hidden shrink-0 rounded-pill bg-bg2 px-2 py-0.5 text-[11px] text-mute lg:inline">
          {carpeta}
        </span>
      )}

      <span className="hidden shrink-0 items-center gap-1 text-sm sm:flex">
        {hayWhatsapp && (
          <span title={nombreDeCanal(t.channel)}>
            <span aria-hidden>💬</span>
            <span className="sr-only">Sale por {nombreDeCanal(t.channel)}</span>
          </span>
        )}
        {correo && (
          <span title="Correo">
            <span aria-hidden>📧</span>
            <span className="sr-only">Sale por correo</span>
          </span>
        )}
      </span>

      <span className="flex shrink-0 items-center gap-1.5">
        <span
          aria-hidden
          className={`h-2 w-2 rounded-full ${t.enabled ? 'bg-brand' : 'bg-warn'}`}
        />
        <span
          className={`text-[11px] font-semibold ${t.enabled ? 'text-mute' : 'text-warn-ink'}`}
        >
          {t.enabled ? 'Activo' : 'Apagado'}
        </span>
      </span>

      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="h-4 w-4 shrink-0 text-mute2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
    </button>
  );
}
