'use client';
import Link from 'next/link';
import { createContext, useContext, type ReactNode } from 'react';
import { api } from '@/lib/api';

/**
 * De dónde sacan sus datos las pantallas de Métricas y a dónde lleva el clic
 * en un negocio.
 *
 * En /admin/metricas: la API con la sesión del admin y la ficha del negocio.
 * En /embed/metricas (dentro de TeamClubify): la API pública del embed con su
 * token, y sin enlaces — quien mira no tiene sesión en Clubify.
 */
export type FuenteMetricas = {
  get<T>(path: string): Promise<T>;
  enlaceNegocio(id: string): string | null;
};

const ADMIN: FuenteMetricas = {
  get: <T,>(path: string) => api<T>(path),
  enlaceNegocio: (id) => `/admin/tenants/${id}`,
};

export const FuenteMetricasContext = createContext<FuenteMetricas>(ADMIN);
export const useFuenteMetricas = () => useContext(FuenteMetricasContext);

/** El nombre de un negocio: enlace a su ficha, o solo texto en el embed. */
export function EnlaceNegocio({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  const href = useFuenteMetricas().enlaceNegocio(id);
  return href ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  );
}

/** Fuente del embed: `/tenants/ranking` y `/admin/metricas/*` → `/embed/metricas/*` con el token. */
export function fuenteDelEmbed(token: string): FuenteMetricas {
  const base = `${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/embed/metricas`;
  return {
    async get<T>(path: string): Promise<T> {
      const [ruta, query = ''] = path.split('?');
      const nombre = ruta === '/tenants/ranking' ? 'ranking' : ruta.replace('/admin/metricas/', '');
      const q = new URLSearchParams(query);
      q.set('t', token);
      const res = await fetch(`${base}/${nombre}?${q}`);
      if (!res.ok) throw new Error(res.status === 403 ? 'El enlace de métricas no es válido.' : 'No se pudieron cargar las métricas.');
      return (await res.json()) as T;
    },
    enlaceNegocio: () => null,
  };
}
