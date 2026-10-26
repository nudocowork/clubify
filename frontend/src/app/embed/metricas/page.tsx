'use client';
import { useEffect, useMemo, useState } from 'react';
import { PanelMetricas } from '@/app/admin/metricas/_components/PanelMetricas';
import { FuenteMetricasContext, fuenteDelEmbed } from '@/lib/fuente-metricas';

/**
 * /embed/metricas?t=<token> — las Métricas de Clubify dentro de TeamClubify
 * (Team Soporte), en un iframe. Sin sesión de Clubify: los datos salen de
 * `/api/embed/metricas/*` con el token, y los negocios no llevan enlace.
 * Javier, 2026-10-26.
 */
export default function EmbedMetricasPage() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('t') ?? '');
  }, []);
  const fuente = useMemo(() => (token ? fuenteDelEmbed(token) : null), [token]);

  if (token === null) return null;
  if (!fuente) {
    return <div className="p-6 text-sm text-mute">Falta el enlace de acceso a las métricas.</div>;
  }
  return (
    <FuenteMetricasContext.Provider value={fuente}>
      <div className="min-h-screen bg-bg p-4 sm:p-6">
        <PanelMetricas />
      </div>
    </FuenteMetricasContext.Provider>
  );
}
