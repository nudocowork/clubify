// Locales soportados oficialmente por Clubify.
export const LOCALES = ['es', 'en', 'pt'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'es';

export const LOCALE_LABELS: Record<Locale, { flag: string; label: string; nativeLabel: string }> = {
  es: { flag: '🇪🇸', label: 'Spanish', nativeLabel: 'Español' },
  en: { flag: '🇺🇸', label: 'English', nativeLabel: 'English' },
  pt: { flag: '🇧🇷', label: 'Portuguese', nativeLabel: 'Português' },
};

export function isValidLocale(s: string | null | undefined): s is Locale {
  return !!s && (LOCALES as readonly string[]).includes(s);
}
