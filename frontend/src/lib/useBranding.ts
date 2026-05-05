'use client';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

export type Branding = {
  appLogoUrl: string | null;
  faviconUrl: string | null;
};

const DEFAULT: Branding = { appLogoUrl: null, faviconUrl: null };

// Cache en memoria para que múltiples componentes no fetcheen N veces.
let cached: Branding | null = null;
let inflight: Promise<Branding> | null = null;

async function fetchBranding(): Promise<Branding> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = fetch(`${API}/api/branding`, { cache: 'force-cache' })
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
