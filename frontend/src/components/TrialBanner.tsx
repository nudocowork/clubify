'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useHidesPurchases } from '@/lib/native';
import { useAuthBrand } from '@/components/AuthBrand';
import { useTranslations } from 'next-intl';

type Status = {
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'EXPIRED' | 'CANCELED';
  daysLeftInTrial: number | null;
  trialEndsAt: string | null;
  isActiveAccess: boolean;
  gracePeriodDays?: number;
  inGracePeriod?: boolean;
  graceDaysLeft?: number | null;
  /**
   * Canceló la renovación y AÚN LE QUEDAN días pagados. Es el último día con
   * acceso; null = no ha cancelado, o ya se le acabó.
   *
   * Cancelar dejó de desconectar en el acto el 2026-09-23 (LICORES EL AMANECER
   * perdió tres días que había pagado), pero el panel no se enteraba: el
   * negocio cancelaba, seguía viéndolo todo normal y no tenía forma de saber
   * hasta cuándo. Eso es peor que el fallo anterior, porque parece que la
   * cancelación no se guardó y la gente vuelve a darle.
   */
  canceladaHasta?: string | null;
};

export function TrialBanner() {
  const t = useTranslations('trial_banner');
  // En iOS el aviso se queda, pero SIN la llamada a la acción: "Activar ahora"
  // es una invitación a pagar, y Apple prohíbe dirigir a un cobro que no sea
  // el suyo (3.1.1). El enlace lleva a /app/billing, donde el botón de compra
  // ya está oculto — pero el reviewer juzga la llamada, no solo el destino.
  // El texto informativo sí puede quedarse: decirle al dueño en qué estado
  // está su cuenta no es venderle nada.
  const sinCompras = useHidesPurchases();
  const [s, setS] = useState<Status | null>(null);
  const [hidden, setHidden] = useState(false);
  // Nombre de la marca (Sellea en su dominio) para no decir "Clubify".
  const { brand } = useAuthBrand();
  const platform = brand?.name || 'Clubify';

  useEffect(() => {
    api<Status>('/billing/status').then(setS).catch(() => null);
  }, []);

  if (!s || hidden) return null;

  // CANCELADA CON DÍAS POR DELANTE. Va antes del corte de abajo porque el
  // estado sigue siendo ACTIVE —que es justo el sentido del arreglo— y si no,
  // este aviso no se pintaría nunca. No se puede ocultar con la ✕: mientras
  // corre el tiempo que ya pagó, es la información más importante de su panel.
  if (s.canceladaHasta) {
    const hasta = new Date(s.canceladaHasta);
    const fecha = Number.isNaN(hasta.getTime())
      ? null
      : hasta.toLocaleDateString('es-CO', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
    return (
      <div className="bg-amber-50 border-amber-200 text-amber-900 border-b px-4 py-2.5 flex items-center gap-3 text-sm">
        <div className="flex-1">
          <b>Cancelaste la renovación.</b>{' '}
          {fecha
            ? `Tu cuenta sigue activa hasta el ${fecha}; después se pausa.`
            : 'Tu cuenta sigue activa hasta el final del período que ya pagaste.'}
        </div>
        {!sinCompras && (
          <Link
            href="/app/billing"
            className="font-semibold underline whitespace-nowrap hover:no-underline"
          >
            Reactivar →
          </Link>
        )}
      </div>
    );
  }

  if (
    s.status !== 'TRIAL' &&
    s.status !== 'PAST_DUE' &&
    s.status !== 'EXPIRED' &&
    s.status !== 'SUSPENDED' &&
    !s.inGracePeriod
  ) {
    return null;
  }

  let bg = 'bg-amber-50';
  let border = 'border-amber-200';
  let text = 'text-amber-900';
  let label = '';
  let cta = t('ctaActivateSubscription');

  // Gracia post-trial: prioridad sobre el flujo TRIAL normal — el trial
  // técnicamente ya venció pero el super admin extendió X días de margen.
  if (s.inGracePeriod) {
    const g = s.graceDaysLeft ?? 0;
    bg = 'bg-orange-50';
    border = 'border-orange-200';
    text = 'text-orange-900';
    label =
      g > 1
        ? t('graceDays', { days: g })
        : g === 1
          ? t('graceOneDay')
          : t('graceToday');
  } else if (s.status === 'TRIAL') {
    const d = s.daysLeftInTrial ?? 0;
    if (d > 0) {
      bg = 'bg-brand-soft';
      border = 'border-brand/20';
      text = 'text-brand-700';
      label =
        d === 1
          ? t('trialEndsTomorrow')
          : t('trialDaysLeft', { platform, days: d });
      cta = t('ctaActivateNow');
    } else {
      label = t('trialEnding');
      cta = t('ctaActivateNow');
    }
  } else if (s.status === 'PAST_DUE') {
    bg = 'bg-orange-50';
    border = 'border-orange-200';
    text = 'text-orange-900';
    label = t('pastDue');
    cta = t('ctaUpdatePayment');
  } else if (s.status === 'EXPIRED') {
    bg = 'bg-red-50';
    border = 'border-red-200';
    text = 'text-red-900';
    label = t('expired');
  } else if (s.status === 'SUSPENDED') {
    bg = 'bg-red-50';
    border = 'border-red-200';
    text = 'text-red-900';
    label = t('suspended');
    cta = t('ctaReactivate');
  }

  return (
    <div className={`${bg} ${border} ${text} border-b px-4 py-2.5 flex items-center gap-3 text-sm`}>
      <div className="flex-1 truncate">{label}</div>
      {!sinCompras && (
        <Link
          href="/app/billing"
          className="font-semibold underline whitespace-nowrap hover:no-underline"
        >
          {cta} →
        </Link>
      )}
      {s.status === 'TRIAL' && (s.daysLeftInTrial ?? 0) > 0 && (
        <button
          onClick={() => setHidden(true)}
          className="text-xs opacity-60 hover:opacity-100"
          title="Ocultar"
        >
          ✕
        </button>
      )}
    </div>
  );
}
