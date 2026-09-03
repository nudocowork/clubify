'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { regionsForCountry } from '@/lib/regions';

// País del NEGOCIO (Tenant.country, ISO alpha-2). Se usa para:
//   - prefill de <PhoneInput defaultCountry={country}> (bandera del país)
//   - ejemplos/placeholders referentes al país (estado/región, etc.)
// Client-only (fetch en useEffect); durante SSR devuelve 'CO' (cached es null
// en el server, nunca se escribe ahí → sin fuga cross-tenant).
let cached: string | null = null;
let inflight: Promise<string> | null = null;

export function useTenantCountry(): string {
  const [country, setCountry] = useState<string>(cached ?? 'CO');
  useEffect(() => {
    if (cached) {
      setCountry(cached);
      return;
    }
    if (!inflight) {
      inflight = api<{ country?: string }>('/tenants/me')
        .then((t) => (cached = (t?.country || 'CO').toUpperCase()))
        .catch(() => (cached = 'CO'));
    }
    inflight.then((c) => setCountry(c || 'CO'));
  }, []);
  return country;
}

/** Placeholder de ejemplo para el campo estado/región, con nombres reales del
 *  país del negocio (ej. CO → "Ej: Antioquia, Cundinamarca…"; VE → "Ej: Miranda…").
 *  Cae al fallback genérico si el país no está curado en regions.ts. */
export function stateExamplePlaceholder(country: string | null | undefined): string {
  const cr = regionsForCountry(country);
  const names = cr.regions.slice(0, 3).map((r) => r.name).filter(Boolean);
  if (!names.length) return `Ej: ${cr.regionLabel}`;
  return `Ej: ${names.join(', ')}`;
}
