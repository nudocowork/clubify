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
export type { MessageKey } from './messages';

export type Locale = 'es' | 'en' | 'pt' | 'it' | 'en-GB' | 'en-US' | 'pt-BR';
type BaseLocale = 'es' | 'en' | 'pt' | 'it';

export const LOCALES: Locale[] = ['es', 'en', 'pt', 'it', 'en-GB', 'en-US', 'pt-BR'];

// #24 (2026-06-17): orden + set de banderas que se MUESTRA en el switcher:
// 1) Inglaterra 2) Estados Unidos 3) Español 4) Portugués. `LOCALES` se
// mantiene completo para validar/resolver preferencias viejas ('en', 'pt-BR')
// sin romperlas; el switcher solo itera estas 4.
export const DISPLAY_LOCALES: Locale[] = ['en-GB', 'en-US', 'es', 'pt'];

/** Variantes regionales que comparten dictionary con un locale base. */
const BASE_LOCALE: Record<Locale, BaseLocale> = {
  es: 'es',
  en: 'en',
  pt: 'pt',
  it: 'it',
  'en-GB': 'en',
  'en-US': 'en',
  'pt-BR': 'pt',
};

export const LOCALE_NAMES: Record<Locale, string> = {
  es: 'Español',
  en: 'English',
  pt: 'Português',
  it: 'Italiano',
  'en-GB': 'English (UK)',
  'en-US': 'English (US)',
  'pt-BR': 'Português (BR)',
};

export const LOCALE_FLAGS: Record<Locale, string> = {
  es: '🇪🇸',
  en: '🇺🇸',
  pt: '🇧🇷',
  it: '🇮🇹',
  'en-GB': '🇬🇧',
  'en-US': '🇺🇸',
  'pt-BR': '🇧🇷',
};

const STORAGE_KEY = 'clubify:locale';

// PDF 1254 — idioma POR NEGOCIO en el storefront público. El idioma del CLIENTE
// se guarda con una clave namespaced por negocio (`clubify:locale:<slug>`) y,
// si el cliente no eligió uno, se usa el idioma del NEGOCIO (Tenant.locale) en
// vez de navigator.language. Así, cambiar el idioma en un negocio NO afecta a
// otros negocios ni al panel.
let _tenantSlug: string | null = null;
let _tenantDefault: Locale | null = null;

function storageKey(): string {
  return _tenantSlug ? `clubify:locale:${_tenantSlug}` : STORAGE_KEY;
}

/** Normaliza un string de locale (ej. Tenant.locale) a un Locale válido. */
function coerceLocale(raw?: string | null): Locale | null {
  if (!raw) return null;
  if ((LOCALES as string[]).includes(raw)) return raw as Locale;
  const lower = raw.toLowerCase();
  if (lower.startsWith('en')) return 'en';
  if (lower.startsWith('pt')) return 'pt';
  if (lower.startsWith('it')) return 'it';
  if (lower.startsWith('es')) return 'es';
  return null;
}

function detectInitial(): Locale {
  if (typeof window === 'undefined') return 'es';
  try {
    const stored = localStorage.getItem(storageKey()) as Locale | null;
    if (stored && LOCALES.includes(stored)) return stored;
  } catch {}
  // Con negocio configurado, su idioma es el default (no navigator).
  if (_tenantDefault) return _tenantDefault;
  const nav =
    typeof navigator !== 'undefined' ? navigator.language : 'es';
  // Detect specific variants first (en-GB, en-US, pt-BR), fall back to
  // base. navigator.language returns "en-GB", "es-MX", etc.
  const normalized = nav.includes('-')
    ? `${nav.split('-')[0].toLowerCase()}-${nav.split('-')[1].toUpperCase()}`
    : nav.toLowerCase();
  if ((LOCALES as string[]).includes(normalized)) return normalized as Locale;
  const lower = nav.toLowerCase();
  if (lower.startsWith('en')) return 'en';
  if (lower.startsWith('pt')) return 'pt';
  if (lower.startsWith('it')) return 'it';
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

/**
 * PDF 1254: el storefront público llama esto al montar con el slug del negocio
 * y su idioma (Tenant.locale). Aísla el idioma del CLIENTE por negocio (clave
 * namespaced) y usa el idioma del negocio como default si el cliente no eligió.
 * Re-deriva el locale activo y notifica a los consumers una vez.
 */
export function configureTenantLocale(slug: string, defaultLocale?: string) {
  const normalized = coerceLocale(defaultLocale);
  const changed = _tenantSlug !== slug || _tenantDefault !== normalized;
  _tenantSlug = slug || null;
  _tenantDefault = normalized;
  if (!changed && _hydrated) return;
  const next = detectInitial();
  _detected = next;
  _hydrated = true;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  Array.from(listeners).forEach((fn) => fn(next));
}

export function setLocale(l: Locale) {
  if (_detected === l && _hydrated) return; // no-op si ya estaba en ese locale
  _detected = l;
  _hydrated = true;
  try {
    localStorage.setItem(storageKey(), l);
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
  // Variantes regionales (en-GB, pt-BR, etc) resuelven al dictionary del
  // locale base. Si en el futuro se agregan overrides por variante, esto
  // cambiará por un merge {base, override}.
  const base = BASE_LOCALE[l];
  const dict = messages[base] ?? messages.es;
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
