'use client';
import { useEffect, useState } from 'react';
import { api, clearSession } from '@/lib/api';

/**
 * Lockscreen específico para tenants que terminaron sus 5 días de prueba
 * sin pagar. Distinto de CardVerificationLockscreen (signup legacy Hotmart):
 * el copy reconoce que ya probaron Clubify, y el polling auto-redirige al
 * panel cuando el webhook Hotmart confirme el pago.
 *
 * El tenant SÍ tiene data (menús, tarjetas, clientes) cargada — por eso
 * ofrecemos "Activar" y no "Crear cuenta". Si activa, no pierde nada.
 */
export function TrialExpiredLockscreen({
  brandName,
  trialEndsAt,
}: {
  brandName?: string;
  trialEndsAt: string | null;
}) {
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    api<{ url: string | null }>('/billing/hotmart/checkout-url')
      .then((r) => setCheckoutUrl(r?.url ?? null))
      .catch(() => null);
  }, []);

  // Polling discreto: si el dueño paga, el webhook setea
  // hotmartSubscriberCode y el lockscreen se desmonta solo al recargar.
  useEffect(() => {
    const tick = async () => {
      try {
        const t = await api<any>('/tenants/me');
        if (t?.hotmartSubscriberCode) window.location.reload();
      } catch {}
    };
    const id = setInterval(tick, 6000);
    return () => clearInterval(id);
  }, []);

  async function checkNow() {
    setVerifying(true);
    try {
      const t = await api<any>('/tenants/me');
      if (t?.hotmartSubscriberCode) {
        window.location.reload();
        return;
      }
      setTimeout(() => setVerifying(false), 800);
    } catch {
      setVerifying(false);
    }
  }

  const expiredOn = trialEndsAt
    ? new Date(trialEndsAt).toLocaleDateString('es-CO', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-soft via-bg to-brand-100 flex items-center justify-center px-5 py-10">
      <div className="max-w-lg w-full">
        <div className="card card-pad text-center">
          <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 text-white flex items-center justify-center text-4xl mb-5">
            ⏰
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            Tu período de prueba terminó
          </h1>
          <p className="text-mute mt-2 leading-relaxed">
            Gracias por probar Clubify{brandName ? ` con ${brandName}` : ''}.
            {expiredOn && (
              <>
                {' '}Tu prueba venció el <strong>{expiredOn}</strong>.
              </>
            )}{' '}
            Activa tu cuenta para seguir usando la plataforma — mantienes
            todos tus menús, tarjetas, clientes y configuración.
          </p>

          <div className="mt-6 space-y-2">
            <a
              href={checkoutUrl ?? '#'}
              target={checkoutUrl ? '_blank' : undefined}
              rel="noopener noreferrer"
              className={`btn-primary w-full justify-center py-3.5 text-base font-semibold ${
                checkoutUrl ? '' : 'opacity-50 pointer-events-none'
              }`}
            >
              💳 Activar ahora →
            </a>
            <button
              type="button"
              onClick={checkNow}
              disabled={verifying}
              className="btn-ghost w-full text-sm disabled:opacity-50"
            >
              {verifying ? 'Verificando…' : 'Ya pagué — verificar acceso'}
            </button>
          </div>

          <div className="mt-6 pt-5 border-t border-line2 text-xs text-mute leading-relaxed">
            <p>
              Pago seguro vía Hotmart. Apenas se apruebe entras al panel con
              todo desbloqueado. Cancelas cuando quieras.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              clearSession();
              window.location.href = '/login';
            }}
            className="mt-5 text-xs text-mute hover:text-ink underline"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}
