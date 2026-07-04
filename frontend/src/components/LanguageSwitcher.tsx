'use client';

import { useEffect, useRef, useState } from 'react';
import {
  DISPLAY_LOCALES,
  LOCALE_FLAGS,
  LOCALE_NAMES,
  useLocale,
  type Locale,
} from '@/lib/i18n';

/**
 * Switcher flotante de idioma. Pensado para páginas públicas (storefront,
 * infolink, wallet, signup, reseñas). Posición fija inferior-izquierda
 * para no chocar con el dock del carrito ni el ClubifyBadge (inferior-derecha).
 */
export function LanguageSwitcher({
  variant = 'floating',
  extraLocales,
}: {
  variant?: 'floating' | 'inline';
  /** Idiomas adicionales a los DISPLAY_LOCALES por defecto, para marcas que
   *  ofrecen más idiomas (ej. Sellea agrega italiano). Se anexan sin duplicar. */
  extraLocales?: Locale[];
}) {
  const [locale, setLocale] = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const localesToShow = extraLocales?.length
    ? [...DISPLAY_LOCALES, ...extraLocales.filter((l) => !DISPLAY_LOCALES.includes(l))]
    : DISPLAY_LOCALES;

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const isFloating = variant === 'floating';

  return (
    <div
      ref={ref}
      className={
        isFloating
          ? 'fixed bottom-3 left-3 z-40'
          : 'inline-block'
      }
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/95 backdrop-blur border border-line shadow-sm text-xs font-medium text-ink hover:bg-white active:scale-95 transition"
        aria-label="Cambiar idioma"
      >
        <span aria-hidden>{LOCALE_FLAGS[locale]}</span>
        <span className="uppercase tracking-wider">{locale}</span>
        <svg
          width="9"
          height="9"
          viewBox="0 0 12 12"
          fill="none"
          className={`transition ${open ? 'rotate-180' : ''}`}
        >
          <path
            d="M3 4.5L6 7.5L9 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div
          className={
            isFloating
              ? 'absolute bottom-full mb-1.5 left-0 min-w-[140px] rounded-xl bg-white shadow-lg border border-line overflow-hidden animate-in fade-in slide-in-from-bottom-1 duration-150'
              : 'absolute mt-1.5 left-0 min-w-[140px] rounded-xl bg-white shadow-lg border border-line overflow-hidden z-50'
          }
        >
          {localesToShow.map((l) => {
            const active = l === locale;
            return (
              <button
                key={l}
                type="button"
                onClick={() => {
                  setLocale(l);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition active:scale-[0.98] ${
                  active
                    ? 'bg-brand-soft text-brand-700 font-semibold'
                    : 'text-ink hover:bg-bg2'
                }`}
              >
                <span aria-hidden>{LOCALE_FLAGS[l]}</span>
                <span>{LOCALE_NAMES[l]}</span>
                {active && (
                  <span className="ml-auto text-brand text-xs">✓</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
