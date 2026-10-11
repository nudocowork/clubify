'use client';
/**
 * Wallet V3 — Historial de sellos del negocio (Fase 5). Muestra los ajustes
 * (+1/-1, canjes, ajustes) con empleado, motivo, y — si la marca lo permite —
 * IP/dispositivo. Gateado por la marca (showHistory); el backend devuelve
 * enabled:false si está apagado.
 */
import { StampAuditTable } from '@/components/StampAuditTable';
import { useTranslations } from 'next-intl';
import { PanelHeader } from '@/components/PanelHeader';

export default function HistorialSellosPage() {
  const t = useTranslations('app_stamp_history');
  return (
    <div>
      <PanelHeader title={t('title')} subtitle={t('intro')} />
      <div className="card card-pad">
        <StampAuditTable />
      </div>
    </div>
  );
}
