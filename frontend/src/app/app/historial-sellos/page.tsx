'use client';
/**
 * Wallet V3 — Historial de sellos del negocio (Fase 5). Muestra los ajustes
 * (+1/-1, canjes, ajustes) con empleado, motivo, y — si la marca lo permite —
 * IP/dispositivo. Gateado por la marca (showHistory); el backend devuelve
 * enabled:false si está apagado.
 */
import { StampAuditTable } from '@/components/StampAuditTable';
import { useTranslations } from 'next-intl';

export default function HistorialSellosPage() {
  const t = useTranslations('app_stamp_history');
  return (
    <div>
      <h1 className="page-title">{t('title')}</h1>
      <p className="text-sm text-mute mb-4 max-w-2xl">
        {t('intro')}
      </p>
      <div className="card card-pad">
        <StampAuditTable />
      </div>
    </div>
  );
}
