'use client';
import { InfoLinkStats } from '@/components/InfoLinkStats';

/**
 * Estadísticas del negocio "Solo InfoLink". Métricas de InfoLink (visitas,
 * clics, escaneos QR, WhatsApp, botón más usado + desglose por InfoLink).
 * El backend bloquea el resto de módulos para estos negocios (guard).
 */
export default function EstadisticasPage() {
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Estadísticas <span className="page-crumb">/ InfoLink</span>
        </h1>
      </div>
      <p className="text-sm text-mute mb-5">
        Rendimiento de tus InfoLinks en los últimos 30 días.
      </p>
      <InfoLinkStats variant="full" />
    </div>
  );
}
