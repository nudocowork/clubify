'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { LOCALES, LOCALE_LABELS, type Locale } from '@/i18n/config';

/**
 * Selector de idioma para next-intl (landing público + panel).
 *
 * Coexiste con `LanguageSwitcher` (sistema legacy para storefront público
 * — menús, info-links, reseñas; ese usa localStorage + claves dinámicas
 * y NO se mezcla con next-intl). Eventualmente migrar pero NO en esta
 * sesión, sino rompemos contextos vivos en prod.
 *
 * Variantes:
 *  - "header"  → dropdown compacto con bandera (landing público).
 *  - "panel"   → cards apilados con bandera + label, para /app/settings.
 */
export function LanguageSwitcherIntl({
  variant = 'header',
  className = '',
}: {
  variant?: 'header' | 'panel';
  className?: string;
}) {
  const currentLocale = useLocale() as Locale;
  const t = useTranslations('language_switcher');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  async function pick(locale: Locale) {
    if (locale === currentLocale) {
      setOpen(false);
      return;
    }
    try {
      await fetch('/api/locale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale }),
      });
    } catch {
      // Si falla el POST igual hacemos refresh — el cookie no se setea,
      // pero al menos no rompemos UX. El próximo POST exitoso resuelve.
    }
    setOpen(false);
    startTransition(() => router.refresh());
  }

  if (variant === 'panel') {
    return (
      <div className={`grid grid-cols-1 sm:grid-cols-3 gap-2 ${className}`}>
        {LOCALES.map((loc) => {
          const meta = LOCALE_LABELS[loc];
          const active = loc === currentLocale;
          return (
            <button
              key={loc}
              type="button"
              onClick={() => pick(loc)}
              disabled={pending}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-left min-h-[44px] transition ${
                active
                  ? 'border-brand bg-brand/5 text-ink'
                  : 'border-line bg-white text-mute hover:border-ink/30 hover:text-ink'
              } disabled:opacity-60`}
              aria-pressed={active}
            >
              <span className="text-xl" aria-hidden>{meta.flag}</span>
              <div className="flex flex-col">
                <span className="text-sm font-semibold">{meta.nativeLabel}</span>
                <span className="text-xs text-mute">{loc.toUpperCase()}</span>
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  const currentMeta = LOCALE_LABELS[currentLocale];
  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-label={t('label')}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-sm text-mute hover:text-ink px-2 py-1.5 rounded-md disabled:opacity-60"
      >
        <span aria-hidden>{currentMeta.flag}</span>
        <span className="font-medium uppercase">{currentLocale}</span>
        <svg width="10" height="10" viewBox="0 0 10 6" aria-hidden>
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <ul
            className="absolute right-0 top-full mt-1 z-50 bg-white border border-line rounded-lg shadow-lg min-w-[160px] py-1"
            role="listbox"
          >
            {LOCALES.map((loc) => {
              const meta = LOCALE_LABELS[loc];
              const active = loc === currentLocale;
              return (
                <li key={loc} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onClick={() => pick(loc)}
                    disabled={pending}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-bg2 disabled:opacity-60 ${
                      active ? 'bg-bg2/60 font-semibold' : ''
                    }`}
                  >
                    <span aria-hidden>{meta.flag}</span>
                    <span>{meta.nativeLabel}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
