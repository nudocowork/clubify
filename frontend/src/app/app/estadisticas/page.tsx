'use client';
import { PanelHeader } from '@/components/PanelHeader';
import { InfoLinkStats } from '@/components/InfoLinkStats';
import { useTranslations } from 'next-intl';

/**
 * Estadísticas del negocio "Solo InfoLink". Métricas de InfoLink (visitas,
 * clics, escaneos QR, WhatsApp, botón más usado + desglose por InfoLink).
 * El backend bloquea el resto de módulos para estos negocios (guard).
 */
export default function EstadisticasPage() {
  const t = useTranslations('app_infolink_stats');
  return (
    <div>
      <PanelHeader
        tutorial="estadisticas"
        title={t('title')}
        crumb={<>/ InfoLink</>}
      />
      <p className="text-sm text-mute mb-5">
        {t('intro')}
      </p>
      <InfoLinkStats variant="full" />
    </div>
  );
}
