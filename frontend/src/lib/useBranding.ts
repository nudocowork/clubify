'use client';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

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

// Cache en memoria para que múltiples componentes no fetcheen N veces.
let cached: Branding | null = null;
let inflight: Promise<Branding> | null = null;

async function fetchBranding(): Promise<Branding> {
  if (cached) return cached;
  if (inflight) return inflight;
  // Sin force-cache: el branding cambia desde /admin/branding y el browser
  // antes quedaba pegado con una respuesta vieja con null. La cache en
  // memoria (variable `cached`) ya evita refetcheos múltiples por sesión.
  inflight = fetch(`${API}/api/branding`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : DEFAULT))
    .then((data: Branding) => {
      cached = data;
      inflight = null;
      return data;
    })
    .catch(() => {
      inflight = null;
      return DEFAULT;
    });
  return inflight;
}

export function useBranding(): Branding {
  const [b, setB] = useState<Branding>(cached ?? DEFAULT);
  useEffect(() => {
    if (cached) return;
    fetchBranding().then(setB);
  }, []);
  return b;
}
