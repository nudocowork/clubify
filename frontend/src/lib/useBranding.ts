'use client';
import { useEffect, useLayoutEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';
const STORAGE_KEY = 'clubify.branding.v1';

export type Branding = {
  appLogoUrl: string | null;
  faviconUrl: string | null;
  supportWhatsapp: string | null;
};

const DEFAULT: Branding = {
  appLogoUrl: null,
  faviconUrl: null,
  supportWhatsapp: null,
};

/**
 * Devuelve un wa.me link al número de soporte de Clubify (configurado por
 * super admin en /admin/branding) con el texto pre-rellenado. Si no hay
 * número configurado, devuelve null y el componente que llama debería
 * ocultar el botón.
 */
export function supportWaLink(
  branding: Branding,
  text: string,
): string | null {
  const phone = (branding.supportWhatsapp ?? '').replace(/\D/g, '');
  if (!phone) return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

// Cache en memoria — sobrevive entre client-side navigations pero NO entre
// page refreshes. Para eso usamos localStorage (ver readFromStorage).
let cached: Branding | null = null;
let inflight: Promise<Branding> | null = null;

function readFromStorage(): Branding | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Branding>;
    // Defensive: shape puede cambiar entre versiones. Forzamos defaults.
    return {
      appLogoUrl: parsed.appLogoUrl ?? null,
      faviconUrl: parsed.faviconUrl ?? null,
      supportWhatsapp: parsed.supportWhatsapp ?? null,
    };
  } catch {
    return null;
  }
}

function writeToStorage(b: Branding) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(b));
  } catch {
    /* QuotaExceeded / Safari privado / disabled — fail silent */
  }
}

function brandingEquals(a: Branding, b: Branding): boolean {
  return (
    a.appLogoUrl === b.appLogoUrl &&
    a.faviconUrl === b.faviconUrl &&
    a.supportWhatsapp === b.supportWhatsapp
  );
}

async function fetchBranding(): Promise<Branding> {
  if (inflight) return inflight;
  // Sin force-cache: el branding cambia desde /admin/branding y el browser
  // antes quedaba pegado con una respuesta vieja con null. La cache de
  // localStorage cubre el flicker visual; este fetch es para refresco.
  inflight = fetch(`${API}/api/branding`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : DEFAULT))
    .then((data: Branding) => {
      cached = data;
      inflight = null;
      return data;
    })
    .catch(() => {
      inflight = null;
      return cached ?? readFromStorage() ?? DEFAULT;
    });
  return inflight;
}

// useLayoutEffect produce warning en SSR (no corre en server). El alias
// isomorphic lo silencia y mantiene el comportamiento sincrónico en cliente.
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Devuelve el branding (logo, favicon, support WhatsApp).
 *
 * **Sin flicker:** el hook lee localStorage en `useLayoutEffect` (antes del
 * primer paint), así el componente renderea el logo cacheado desde el
 * primer frame visible. El fetch network corre en background y solo
 * actualiza el state si cambió algo respecto del cached — evitando
 * re-render innecesario.
 *
 * Primera vez (sin localStorage): el componente renderea DEFAULT primero
 * y se actualiza tras el fetch. Esto es aceptable porque el usuario aún
 * no había visto el logo nunca.
 */
export function useBranding(): Branding {
  const [b, setB] = useState<Branding>(cached ?? DEFAULT);

  // Pre-paint: aplica el branding cacheado de sesiones anteriores.
  useIsomorphicLayoutEffect(() => {
    if (cached) return; // Ya hidratado en este module load
    const stored = readFromStorage();
    if (stored) {
      cached = stored;
      setB(stored);
    }
  }, []);

  // Background refresh — solo setea si cambió.
  useEffect(() => {
    fetchBranding().then((fresh) => {
      writeToStorage(fresh);
      setB((prev) => (brandingEquals(prev, fresh) ? prev : fresh));
    });
  }, []);

  return b;
}
