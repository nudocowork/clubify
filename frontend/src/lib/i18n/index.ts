'use client';

// Sistema i18n minimalista para páginas públicas (storefront, infolink,
// wallet, signup, reseñas, card join). Sin librería externa: hook + dict.
//
// - Auto-detecta idioma desde navigator.language en primera visita.
// - Persiste override en localStorage (`clubify:locale`).
// - useT() devuelve función `t(key, vars?)` y refresca al cambiar idioma.
// - <LanguageSwitcher> permite override manual.

import { useEffect, useState } from 'react';
import { messages, MessageKey } from './messages';

export type Locale = 'es' | 'en' | 'pt';

export const LOCALES: Locale[] = ['es', 'en', 'pt'];

export const LOCALE_NAMES: Record<Locale, string> = {
  es: 'Español',
  en: 'English',
  pt: 'Português',
};

export const LOCALE_FLAGS: Record<Locale, string> = {
  es: '🇪🇸',
  en: '🇺🇸',
  pt: '🇧🇷',
};

const STORAGE_KEY = 'clubify:locale';

function detectInitial(): Locale {
  if (typeof window === 'undefined') return 'es';
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (stored && LOCALES.includes(stored)) return stored;
  } catch {}
  const nav =
    typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : 'es';
  if (nav.startsWith('en')) return 'en';
  if (nav.startsWith('pt')) return 'pt';
  return 'es';
}

let _detected: Locale | null = null;
let _hydrated = false;
const listeners = new Set<(l: Locale) => void>();

/**
 * Devuelve el locale activo. Antes de hidratar (en SSR y primer render del
 * cliente) siempre devuelve 'es' para evitar hydration mismatch. Después de
 * hidratar (cuando algún useT/useLocale corrió su useEffect) devuelve el
 * locale detectado o el override guardado.
 */
export function getLocale(): Locale {
  if (!_hydrated) return 'es';
  if (_detected) return _detected;
  _detected = detectInitial();
  return _detected;
}

function markHydrated() {
  if (_hydrated) return;
  _hydrated = true;
  if (!_detected) _detected = detectInitial();
  if (_detected !== 'es') {
    listeners.forEach((fn) => fn(_detected!));
  }
}

export function setLocale(l: Locale) {
  _detected = l;
  _hydrated = true;
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch {}
  if (typeof document !== 'undefined') {
    document.documentElement.lang = l;
  }
  listeners.forEach((fn) => fn(l));
}

export function t(
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const l = getLocale();
  const dict = messages[l] ?? messages.es;
  let str: string = dict[key] ?? messages.es[key] ?? (key as string);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
    }
  }
  return str;
}

/**
 * Hook que devuelve la función t() y re-renderiza al cambiar idioma.
 * En primer render devuelve español (matchea SSR). En el useEffect marca
 * hydrated → si el detect difiere de 'es', dispara re-render.
 */
export function useT() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((x) => x + 1);
    listeners.add(fn);
    markHydrated();
    if (typeof document !== 'undefined') {
      document.documentElement.lang = getLocale();
    }
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return t;
}

/** Hook que devuelve [locale, setLocale]. Inicia en 'es' para SSR. */
export function useLocale(): [Locale, (l: Locale) => void] {
  const [loc, setLoc] = useState<Locale>('es');
  useEffect(() => {
    markHydrated();
    setLoc(getLocale());
    const fn = (l: Locale) => setLoc(l);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return [loc, setLocale];
}
