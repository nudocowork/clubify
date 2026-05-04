'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Status = {
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'EXPIRED' | 'CANCELED';
  daysLeftInTrial: number | null;
  trialEndsAt: string | null;
  isActiveAccess: boolean;
};

export function TrialBanner() {
  const [s, setS] = useState<Status | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    api<Status>('/billing/status').then(setS).catch(() => null);
  }, []);

  if (!s || hidden) return null;
  if (s.status !== 'TRIAL' && s.status !== 'PAST_DUE' && s.status !== 'EXPIRED' && s.status !== 'SUSPENDED') {
    return null;
  }

  let bg = 'bg-amber-50';
  let border = 'border-amber-200';
  let text = 'text-amber-900';
  let label = '';
  let cta = 'Activar suscripción';

  if (s.status === 'TRIAL') {
    const d = s.daysLeftInTrial ?? 0;
    if (d > 5) {
      bg = 'bg-brand-soft';
      border = 'border-brand/20';
      text = 'text-brand-700';
      label = `Estás en prueba gratis · te quedan ${d} día${d === 1 ? '' : 's'}`;
    } else if (d > 0) {
      label = `Tu prueba termina en ${d} día${d === 1 ? '' : 's'}. Activa tu suscripción para no perder acceso.`;
    } else {
      label = 'Tu prueba termina hoy. Activa tu suscripción para no perder acceso.';
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
    label = 'Tu prueba expiró. Activa la suscripción para reactivar tu negocio.';
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
      {s.status === 'TRIAL' && (s.daysLeftInTrial ?? 0) > 5 && (
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
