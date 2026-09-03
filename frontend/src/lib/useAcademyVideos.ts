'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

// Videos-tutorial activos de la marca del negocio (mapa por clave de módulo),
// leídos de /tenants/me. Cache a nivel módulo (solo cliente) para no repetir el
// fetch por cada botón. Igual patrón que useTenantCountry. NO se toca en SSR.
export type AcademyVideo = { youtubeUrl: string; title: string; description: string };
type VideoMap = Record<string, AcademyVideo>;

let cache: VideoMap | null = null;
let inflight: Promise<VideoMap> | null = null;

function fetchOnce(): Promise<VideoMap> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = api<any>('/tenants/me')
      .then((me) => {
        cache = (me?.academyVideos ?? {}) as VideoMap;
        return cache;
      })
      .catch(() => {
        cache = {};
        return cache;
      });
  }
  return inflight;
}

/** Mapa { moduleKey: {youtubeUrl,title,description} } de la marca. {} si aún carga. */
export function useAcademyVideos(): VideoMap {
  const [map, setMap] = useState<VideoMap>(cache ?? {});
  useEffect(() => {
    let alive = true;
    fetchOnce().then((m) => {
      if (alive) setMap(m);
    });
    return () => {
      alive = false;
    };
  }, []);
  return map;
}
