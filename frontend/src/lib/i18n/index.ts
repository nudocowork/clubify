'use client';

// Sistema i18n minimalista para páginas públicas (storefront, infolink,
// wallet, signup, reseñas, card join). Sin librería externa: hook + dict.
//
// - Auto-detecta idioma desde navigator.language en primera visita.
// - Persiste override en localStorage (`clubify:locale`).
// - useT() devuelve función `t(key, vars?)` y refresca al cambiar idioma.
// - <LanguageSwitcher> permite override manual.

import { useCallback, useEffect, useMemo, useState } from 'react';
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

// Refactor 2026-05-15: el cliente reportó "el cambio de idioma no funciona".
// La impl previa devolvía SIEMPRE la misma referencia de `t` desde useT y
// confiaba en que `force((x)=>x+1)` triggereara re-render que la JSX
// llamara a t() de nuevo y t() leyera el módulo. Pero en algunos escenarios
// (componentes memoizados, cierres en callbacks fuera del flujo render,
// strict mode con doble mount, etc.) el re-render no propagaba o `t`
// quedaba con la referencia vieja en cierres.
//
// Nueva impl: useT() devuelve un `t` MEMOIZADO con el locale como
// dependencia. Cada cambio de locale → nueva referencia de t → React
// invalida cualquier consumer que dependa de él. Más idiomático y
// reactivo. La función free `t` exportada (para callsites no-hook) sigue
// existiendo y leyendo el módulo.

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
  if (_detected === l && _hydrated) return; // no-op si ya estaba en ese locale
  _detected = l;
  _hydrated = true;
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch {}
  if (typeof document !== 'undefined') {
    document.documentElement.lang = l;
  }
  // Snapshot del set para que un listener que se desuscriba durante la
  // iteración no rompa la propagación al resto.
  Array.from(listeners).forEach((fn) => fn(l));
}

/** Versión libre de hooks — útil en módulos que necesitan traducir fuera
 *  de un componente React. Lee el locale del módulo (puede no estar
 *  hidratado todavía si se llama muy temprano). */
export function t(
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  return translateAt(getLocale(), key, vars);
}

function translateAt(
  l: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
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
 * Hook que devuelve un `t(key, vars?)` reactivo. Re-renderiza el componente
 * cuando el locale cambia y el callback retornado depende del locale (nueva
 * referencia → memoization-safe).
 */
export function useT() {
  const locale = useCurrentLocale();
  return useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) =>
      translateAt(locale, key, vars),
    [locale],
  );
}

/** Hook interno: suscribe al locale activo y devuelve el valor actual. */
function useCurrentLocale(): Locale {
  const [loc, setLoc] = useState<Locale>('es');
  useEffect(() => {
    markHydrated();
    // Catch-up inmediato: si entre el primer render y este efecto cambió
    // el locale (caso típico: primera visita con browser en 'en' →
    // markHydrated detecta 'en' antes de que este componente termine de
    // suscribirse). Sino, este componente quedaría stuck en 'es'.
    const current = getLocale();
    if (current !== loc) setLoc(current);
    const fn = (l: Locale) => setLoc(l);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return loc;
}

/** Hook que devuelve [locale, setLocale]. Inicia en 'es' para SSR. */
export function useLocale(): [Locale, (l: Locale) => void] {
  const loc = useCurrentLocale();
  // Memoizamos el setter (referencia estable) para callers que lo usen
  // en deps de useEffect / useCallback.
  const setter = useMemo(() => setLocale, []);
  return [loc, setter];
}
