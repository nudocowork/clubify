'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, clearSession } from '@/lib/api';

/**
 * Lockscreen que se muestra cuando un tenant aún no tiene `hotmartSubscriberCode`.
 * El usuario completó signup → fue enviado a Hotmart → el webhook
 * `PURCHASE_APPROVED` setea el código en el tenant. Hasta que ese código
 * exista, el dueño NO ve el panel — solo este pantalla con CTA para completar
 * la verificación de tarjeta en Hotmart.
 *
 * El polling discreto cada 6s detecta automáticamente cuando Hotmart
 * confirma para ahorrarle al usuario hacer "Refrescar" manual.
 */
export function CardVerificationLockscreen({
  brandName,
  planName,
}: {
  brandName?: string;
  planName: 'Elite' | 'Pro' | string;
}) {
  const router = useRouter();
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    api<{ url: string | null }>('/billing/hotmart/checkout-url')
      .then((r) => setCheckoutUrl(r?.url ?? null))
      .catch(() => null);
  }, []);

  // Polling discreto: chequea cada 6s si el webhook ya confirmó la tarjeta.
  // Cuando aparezca hotmartSubscriberCode, recargamos la página para que
  // AppShell desmonte el lockscreen y muestre el panel real.
  useEffect(() => {
    const tick = async () => {
      try {
        const t = await api<any>('/tenants/me');
        if (t?.hotmartSubscriberCode) {
          window.location.reload();
        }
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
      // No hay código aún — quedamos en la pantalla
      setTimeout(() => setVerifying(false), 800);
    } catch {
      setVerifying(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-soft via-bg to-brand-100 flex items-center justify-center px-5 py-10">
      <div className="max-w-lg w-full">
        <div className="card card-pad text-center">
          <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 text-white flex items-center justify-center text-4xl mb-5">
            💳
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            Falta confirmar tu pago
          </h1>
          <p className="text-mute mt-2 leading-relaxed">
            Para activar tu plan {planName} de{' '}
            {brandName ?? 'tu cuenta'}, completa el pago seguro en Hotmart.
            Apenas se apruebe el cobro entras al panel con todas las
            funciones desbloqueadas. Puedes cancelar la suscripción en
            cualquier momento desde tu panel.
          </p>

          {checkoutUrl ? (
            <a
              href={checkoutUrl}
              className="btn-primary w-full justify-center text-base py-3 mt-7"
            >
              Ir al pago seguro en Hotmart →
            </a>
          ) : (
            <div className="mt-7 rounded-lg bg-bg2 px-4 py-3 text-sm text-mute">
              No hay link de checkout disponible. Escríbenos por WhatsApp y te
              ayudamos a activarlo manualmente.
            </div>
          )}

          <button
            onClick={checkNow}
            disabled={verifying}
            className="btn-ghost w-full justify-center mt-3 text-sm"
          >
            {verifying
              ? 'Verificando…'
              : 'Ya completé Hotmart — verificar ahora'}
          </button>

          <div className="mt-6 pt-5 border-t border-line2 text-xs text-mute space-y-2">
            <div>
              <strong>¿Qué pasa después?</strong> Apenas Hotmart confirme tu
              tarjeta, esta página desaparece sola y entras al panel.
              Detectamos la confirmación automáticamente cada pocos segundos.
            </div>
            <div>
              ¿Necesitas ayuda?{' '}
              <a
                className="text-brand hover:underline"
                href="https://wa.me/573001112233?text=Hola,%20me%20registr%C3%A9%20en%20Clubify%20pero%20no%20puedo%20completar%20Hotmart"
                target="_blank"
                rel="noreferrer"
              >
                Escríbenos por WhatsApp
              </a>
            </div>
            <div>
              <button
                onClick={() => {
                  clearSession();
                  router.push('/login');
                }}
                className="text-mute hover:text-ink underline"
              >
                Cerrar sesión
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
