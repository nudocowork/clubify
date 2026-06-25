'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthBrand } from '@/components/AuthBrand';

type Status = {
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'EXPIRED' | 'CANCELED';
  daysLeftInTrial: number | null;
  trialEndsAt: string | null;
  isActiveAccess: boolean;
  gracePeriodDays?: number;
  inGracePeriod?: boolean;
  graceDaysLeft?: number | null;
};

export function TrialBanner() {
  const [s, setS] = useState<Status | null>(null);
  const [hidden, setHidden] = useState(false);
  // Nombre de la marca (Sellea en su dominio) para no decir "Clubify".
  const { brand } = useAuthBrand();
  const platform = brand?.name || 'Clubify';

  useEffect(() => {
    api<Status>('/billing/status').then(setS).catch(() => null);
  }, []);

  if (!s || hidden) return null;
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
  let cta = 'Activar suscripción';

  // Gracia post-trial: prioridad sobre el flujo TRIAL normal — el trial
  // técnicamente ya venció pero el super admin extendió X días de margen.
  if (s.inGracePeriod) {
    const g = s.graceDaysLeft ?? 0;
    bg = 'bg-orange-50';
    border = 'border-orange-200';
    text = 'text-orange-900';
    label =
      g > 1
        ? `Tu trial venció. Tienes ${g} días de gracia restantes antes de que se suspenda tu cuenta.`
        : g === 1
        ? 'Tu trial venció. Te queda 1 día de gracia antes de que se suspenda tu cuenta.'
        : 'Tu trial venció. Tu cuenta se suspende hoy si no activas la suscripción.';
  } else if (s.status === 'TRIAL') {
    const d = s.daysLeftInTrial ?? 0;
    if (d > 0) {
      bg = 'bg-brand-soft';
      border = 'border-brand/20';
      text = 'text-brand-700';
      label =
        d === 1
          ? '⏰ Tu modo prueba termina mañana. Activa tu cuenta para no perder acceso.'
          : `🎁 Estás usando ${platform} en modo prueba. Te quedan ${d} días para activar tu cuenta.`;
      cta = 'Activar ahora';
    } else {
      label = 'Tu modo prueba está por terminar. Activa tu cuenta ahora.';
      cta = 'Activar ahora';
    }
  } else if (s.status === 'PAST_DUE') {
    bg = 'bg-orange-50';
    border = 'border-orange-200';
    text = 'text-orange-900';
    label = 'No pudimos cobrar tu suscripción. Actualiza tu método de pago para evitar la suspensión.';
    cta = 'Actualizar pago';
  } else if (s.status === 'EXPIRED') {
    bg = 'bg-red-50';
    border = 'border-red-200';
    text = 'text-red-900';
    label = 'Tu cuenta no está activa. Completa el pago para reactivar tu negocio.';
  } else if (s.status === 'SUSPENDED') {
    bg = 'bg-red-50';
    border = 'border-red-200';
    text = 'text-red-900';
    label = 'Tu cuenta está suspendida. Activa la suscripción para reactivar tu negocio.';
    cta = 'Reactivar';
  }

  return (
    <div className={`${bg} ${border} ${text} border-b px-4 py-2.5 flex items-center gap-3 text-sm`}>
      <div className="flex-1 truncate">{label}</div>
      <Link
        href="/app/billing"
        className="font-semibold underline whitespace-nowrap hover:no-underline"
      >
        {cta} →
      </Link>
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
