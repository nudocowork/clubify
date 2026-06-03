'use client';
import { useEffect, useState } from 'react';
import { api } from './api';
import { resolveMainSectionLabel } from './business-categories';

type TenantLabelFields = {
  mainSectionLabelOverride?: string | null;
  businessCategorySlug?: string | null;
};

// Caché module-level del fetch a /tenants/me — todos los componentes que
// llaman al hook comparten el mismo promise. Se invalida tras guardar la
// configuración para que el cambio se vea inmediato.
let cache: Promise<TenantLabelFields | null> | null = null;

function fetchLabelFields(): Promise<TenantLabelFields | null> {
  if (!cache) {
    cache = api<any>('/tenants/me')
      .then((t) => ({
        mainSectionLabelOverride: t?.mainSectionLabelOverride ?? null,
        businessCategorySlug: t?.businessCategorySlug ?? null,
      }))
      .catch(() => null);
  }
  return cache;
}

export function invalidateMainSectionLabel() {
  cache = null;
}

/**
 * Label visible de sección principal del tenant ("Menú", "Servicios" o
 * texto custom). Fallback "Menú" mientras carga o si falla el fetch.
 *
 * @param singular si true usa el label tal cual ("Menú"); si false puedes
 *   pasar variantes (ej: `${label}.toLowerCase()` para "Configurar menú").
 */
export function useMainSectionLabel(): string {
  const [label, setLabel] = useState<string>('Menú');
  useEffect(() => {
    let alive = true;
    fetchLabelFields().then((f) => {
      if (!alive) return;
      setLabel(
        resolveMainSectionLabel(
          f?.mainSectionLabelOverride,
          f?.businessCategorySlug,
        ),
      );
    });
    return () => {
      alive = false;
    };
  }, []);
  return label;
}
