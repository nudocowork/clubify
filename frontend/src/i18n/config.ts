// Locales soportados oficialmente por Clubify.
//
// Los locales "base" (es, en, pt) tienen su propio messages/<code>.json
// completo. Las variantes regionales (en-GB, en-US, pt-BR) usan el JSON
// base correspondiente vía `BASE_LOCALE` para no duplicar strings — solo
// se diferencian en metadata (flag, label) y permiten formato dinámico de
// fecha/moneda según locale ICU.
export const LOCALES = ['es', 'en', 'pt', 'en-GB', 'en-US', 'pt-BR'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'es';

// #24 (2026-06-17): orden + set que se MUESTRA en el switcher:
// Inglaterra, Estados Unidos, Español, Portugués. `LOCALES` queda completo
// para resolver preferencias viejas; el switcher solo itera estas 4.
export const DISPLAY_LOCALES: readonly Locale[] = ['en-GB', 'en-US', 'es', 'pt'];

/** Variantes regionales → archivo de mensajes base que resuelven en
 *  request.ts. en-GB y en-US ambos cargan `en.json`; pt-BR carga `pt.json`. */
export const BASE_LOCALE: Record<Locale, 'es' | 'en' | 'pt'> = {
  es: 'es',
  en: 'en',
  pt: 'pt',
  'en-GB': 'en',
  'en-US': 'en',
  'pt-BR': 'pt',
};

export const LOCALE_LABELS: Record<Locale, { flag: string; label: string; nativeLabel: string }> = {
  es: { flag: '🇪🇸', label: 'Spanish', nativeLabel: 'Español' },
  en: { flag: '🇺🇸', label: 'English', nativeLabel: 'English' },
  pt: { flag: '🇧🇷', label: 'Portuguese', nativeLabel: 'Português' },
  'en-GB': { flag: '🇬🇧', label: 'English (UK)', nativeLabel: 'English (UK)' },
  'en-US': { flag: '🇺🇸', label: 'English (US)', nativeLabel: 'English (US)' },
  'pt-BR': { flag: '🇧🇷', label: 'Portuguese (BR)', nativeLabel: 'Português (BR)' },
};

export function isValidLocale(s: string | null | undefined): s is Locale {
  return !!s && (LOCALES as readonly string[]).includes(s);
}
