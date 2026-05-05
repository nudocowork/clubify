'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, clearSession } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { ConstructionBadge } from '@/components/UnderConstruction';

type Status = {
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'EXPIRED' | 'CANCELED';
  daysLeftInTrial: number | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  isActiveAccess: boolean;
};

const STATUS_LABELS: Record<Status['status'], { text: string; bg: string; ring: string }> = {
  TRIAL: { text: 'Esperando pago', bg: 'bg-brand-soft text-brand-700', ring: 'ring-brand/30' },
  ACTIVE: { text: 'Suscripción activa', bg: 'bg-ok-soft text-ok', ring: 'ring-ok/30' },
  PAST_DUE: { text: 'Pago pendiente', bg: 'bg-amber-100 text-amber-800', ring: 'ring-amber-300' },
  EXPIRED: { text: 'Cuenta inactiva', bg: 'bg-red-100 text-red-800', ring: 'ring-red-300' },
  SUSPENDED: { text: 'Suspendida', bg: 'bg-red-100 text-red-800', ring: 'ring-red-300' },
  CANCELED: { text: 'Cancelada', bg: 'bg-bg2 text-mute', ring: 'ring-line' },
};

export default function BillingPage() {
  const router = useRouter();
  const [s, setS] = useState<Status | null>(null);
  const [tenant, setTenant] = useState<any>(null);
  const [hotmartConfigured, setHotmartConfigured] = useState(false);
  const [activating, setActivating] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [canceling, setCanceling] = useState(false);
  const justSuspended =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('suspended') === '1';

  useEffect(() => {
    api<Status>('/billing/status').then(setS).catch(() => null);
    api<any>('/tenants/me').then(setTenant).catch(() => null);
    api<{ configured: boolean }>('/billing/hotmart/config')
      .then((r) => setHotmartConfigured(!!r?.configured))
      .catch(() => setHotmartConfigured(false));
  }, []);

  async function activateSubscription(planOverride?: string) {
    setActivating(true);
    try {
      const qs = planOverride ? `?plan=${encodeURIComponent(planOverride)}` : '';
      const r = await api<{ url: string | null; reason?: string }>(
        `/billing/hotmart/checkout-url${qs}`,
      );
      if (r.url) {
        window.location.href = r.url;
      } else {
        toast(
          'El pago aún no está configurado. Te avisamos en cuanto esté listo.',
          'info',
        );
        setActivating(false);
      }
    } catch (e: any) {
      toast(e.message || 'No se pudo abrir el checkout', 'error');
      setActivating(false);
    }
  }

  async function confirmCancel() {
    setCanceling(true);
    try {
      await api('/billing/cancel', {
        method: 'POST',
        body: JSON.stringify({ reason: cancelReason || undefined }),
      });
      clearSession();
      router.push('/login?canceled=1');
    } catch (e: any) {
      toast(e.message || 'No se pudo cancelar', 'error');
      setCanceling(false);
    }
  }

  async function reactivate() {
    if (!confirm('Te reactivamos por 3 días para que completes el pago en Hotmart. ¿Confirmas?')) {
      return;
    }
    try {
      await api('/billing/reactivate', { method: 'POST' });
      toast('Cuenta reactivada · completa el pago en Hotmart', 'success');
      setTimeout(() => window.location.reload(), 800);
    } catch (e: any) {
      toast(e.message || 'No se pudo reactivar', 'error');
    }
  }

  if (!s) return <div className="text-mute">Cargando…</div>;

  const meta = STATUS_LABELS[s.status];

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Suscripción y facturación</h1>
        <p className="text-mute mt-1">
          Estado de tu cuenta y opciones para activar tu suscripción.
        </p>
      </div>

      {justSuspended && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 mb-4">
          Quisiste hacer una acción que requiere cuenta activa. Reactiva tu
          suscripción para continuar.
        </div>
      )}

      {/* Estado actual */}
      <div className={`card card-pad ring-1 ${meta.ring}`}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full ${meta.bg}`}>
                {meta.text}
              </span>
            </div>
            <div className="mt-3 text-3xl font-bold">
              {s.status === 'TRIAL'
                ? 'Esperando pago'
                : s.status === 'ACTIVE'
                ? 'Suscripción activa'
                : s.status === 'EXPIRED'
                ? 'Cuenta inactiva'
                : s.status === 'SUSPENDED'
                ? 'Cuenta suspendida'
                : s.status === 'PAST_DUE'
                ? 'Pago pendiente'
                : 'Sin suscripción'}
            </div>
            {s.status === 'TRIAL' && (
              <div className="text-sm text-mute mt-1">
                Completa el pago en Hotmart para activar tu cuenta.
              </div>
            )}
            {s.status === 'ACTIVE' && s.currentPeriodEnd && (
              <div className="text-sm text-mute mt-1">
                Próximo cobro:{' '}
                <span className="font-medium text-ink">
                  {new Date(s.currentPeriodEnd).toLocaleDateString('es-CO', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-mute font-semibold">
              Plan actual
            </div>
            <div className="text-lg font-semibold mt-1">
              {tenant?.plan?.name ?? '—'} · USD {Number(tenant?.plan?.priceMonthly ?? 0)}/mes
            </div>
            <div className="text-xs text-mute">
              ≈ equivalente al cambio del día en tu país
            </div>
          </div>
        </div>

      </div>

      {/* CTA principal */}
      {(s.status === 'TRIAL' || s.status === 'EXPIRED' || s.status === 'PAST_DUE') && (
        <div className="card card-pad mt-4 bg-gradient-to-br from-brand-400 to-brand-700 text-white">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="font-bold text-xl">
                  {s.status === 'TRIAL' ? 'Activa tu suscripción' : 'Activa tu cuenta'}
                </div>
                {!hotmartConfigured && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-300/95 text-amber-900">
                    🚧 En construcción
                  </span>
                )}
              </div>
              <p className="text-white/85 text-sm mt-1.5 leading-relaxed">
                {hotmartConfigured
                  ? 'Te llevamos al checkout seguro para activar tu suscripción mensual. Cancela cuando quieras desde aquí.'
                  : 'El cobro recurrente se hará en USD 50/mes facturado en tu moneda local al cambio del día. Estamos terminando la integración: en cuanto esté lista te avisamos por email.'}
              </p>
              {!hotmartConfigured && (
                <p className="text-white/70 text-xs mt-2">
                  Si necesitas activación manual, escríbenos por{' '}
                  <a
                    href="https://wa.me/573000000000"
                    target="_blank"
                    className="underline hover:text-white"
                  >
                    WhatsApp
                  </a>
                  .
                </p>
              )}
            </div>
            <button
              onClick={() => activateSubscription()}
              disabled={!hotmartConfigured || activating}
              className={`bg-white/95 text-brand-700 font-semibold px-5 py-2.5 rounded-pill text-sm whitespace-nowrap ${
                hotmartConfigured
                  ? 'hover:bg-white'
                  : 'opacity-70 cursor-not-allowed'
              }`}
              title={hotmartConfigured ? 'Activar' : 'Disponible muy pronto'}
            >
              {activating
                ? 'Abriendo checkout…'
                : hotmartConfigured
                ? 'Activar suscripción →'
                : 'Activar suscripción →'}
            </button>
          </div>
        </div>
      )}

      {/* Reactivar (cuando cuenta está suspendida) */}
      {s.status === 'SUSPENDED' && (
        <div className="card card-pad mt-4 bg-gradient-to-br from-ok to-emerald-600 text-white">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="font-bold text-xl">¿Volver a Clubify?</div>
              <p className="text-white/85 text-sm mt-1.5 leading-relaxed">
                Te reactivamos por 3 días para que completes el pago en
                Hotmart y retomes tu negocio. Tu data está intacta.
              </p>
            </div>
            <button
              onClick={reactivate}
              className="bg-white text-ok font-semibold px-5 py-2.5 rounded-pill text-sm whitespace-nowrap hover:bg-white/90"
            >
              Reactivar mi cuenta →
            </button>
          </div>
        </div>
      )}

      {/* Lo que incluye — features según plan actual */}
      {(() => {
        const planName = tenant?.plan?.name ?? '';
        const isElite = planName.toLowerCase() === 'elite';
        const eliteFeatures = [
          'Pedidos ilimitados',
          'Tarjetas wallet ilimitadas',
          'Multi-ubicación + multi-staff',
          'Dominio propio + analítica',
          'Email transaccional',
          'Apple Wallet + Google Wallet',
          'Scanner PWA',
          'Soporte por chat',
        ];
        const proFeatures = [
          ...eliteFeatures,
          'Automatizaciones de WhatsApp',
          'Mensajes automáticos por evento (sello, cumpleaños, recordatorio)',
          'Segmentación avanzada de clientes',
          'Plantillas de mensaje',
          'Soporte prioritario',
        ];
        const features = isElite ? eliteFeatures : proFeatures;
        return (
          <div className="card card-pad mt-4">
            <div className="font-semibold mb-3">
              Tu plan {planName} incluye
            </div>
            <ul className="grid sm:grid-cols-2 gap-2 text-sm">
              {features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-mute">
                  <Icon name="check" size={14} className="text-ok mt-0.5 flex-none" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}

      {/* Upsell a Pro — solo se muestra a Elite (los Pro ya tienen todo) */}
      {tenant?.plan?.name?.toLowerCase() === 'elite' && (
        <div className="card card-pad mt-4 bg-gradient-to-br from-brand-400 via-brand-500 to-brand-700 text-white relative overflow-hidden">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-[0.18em] font-semibold opacity-85">
                Sube a Pro
              </div>
              <h3 className="text-xl font-bold mt-1 leading-tight">
                Automatizaciones de WhatsApp por USD 49 más al mes
              </h3>
              <p className="text-sm text-white/85 mt-1.5 leading-relaxed">
                Manda mensajes solos cuando un cliente cumple años, hace su
                primer pedido, lleva 30 días sin volver, completa su tarjeta
                de fidelización o llega cerca de tu local. Sin programar nada.
              </p>
              <ul className="grid sm:grid-cols-2 gap-1.5 mt-3 text-sm">
                {[
                  'Mensajes automáticos por evento',
                  'Plantillas con variables ({{nombre}}, etc.)',
                  'Segmentación avanzada (VIP, inactivos, etc.)',
                  'Recordatorios y cumpleaños automáticos',
                  'Soporte prioritario',
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Icon name="check" size={14} className="mt-0.5 flex-none" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between flex-wrap gap-3">
            <div className="text-sm text-white/85">
              Hoy: <strong>USD 50/mes</strong> · Pro:{' '}
              <strong>USD 99/mes</strong>
            </div>
            <button
              onClick={() => activateSubscription('Pro')}
              disabled={!hotmartConfigured || activating}
              className="bg-white text-brand-700 font-semibold px-5 py-2.5 rounded-pill hover:bg-white/95 disabled:opacity-70"
            >
              {activating ? 'Abriendo…' : 'Cambiarme a Pro →'}
            </button>
          </div>
        </div>
      )}

      {/* Cancelar */}
      {(s.status === 'TRIAL' || s.status === 'ACTIVE') && (
        <div className="mt-6 text-center">
          <button
            onClick={() => setCancelOpen(true)}
            className="text-xs text-mute hover:text-bad underline"
          >
            Cancelar mi cuenta
          </button>
        </div>
      )}

      <div className="text-xs text-mute mt-6 text-center">
        ¿Dudas? Escríbenos por{' '}
        <a href="https://wa.me/573000000000" className="text-brand hover:underline">
          WhatsApp
        </a>{' '}
        o{' '}
        <a href="mailto:hola@soyclubify.com" className="text-brand hover:underline">
          email
        </a>
        .
      </div>

      {/* Modal de cancelación */}
      {cancelOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-ink/60"
            onClick={() => !canceling && setCancelOpen(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h2 className="text-lg font-bold">¿Seguro que quieres cancelar?</h2>
            <p className="text-sm text-mute mt-2 leading-relaxed">
              Tu cuenta queda suspendida inmediatamente. Tu storefront público
              dejará de recibir pedidos. Tu data se conserva 30 días por si
              decides volver. Después se elimina.
            </p>
            <div className="mt-4">
              <label className="label">¿Por qué cancelas? (opcional)</label>
              <textarea
                className="input"
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Nos ayuda mucho a mejorar"
              />
            </div>
            <div className="mt-5 flex gap-2 justify-end">
              <button
                onClick={() => setCancelOpen(false)}
                disabled={canceling}
                className="btn-ghost text-sm"
              >
                No, mantener mi cuenta
              </button>
              <button
                onClick={confirmCancel}
                disabled={canceling}
                className="px-4 py-2 rounded-pill bg-bad text-white text-sm font-semibold disabled:opacity-50"
              >
                {canceling ? 'Cancelando…' : 'Sí, cancelar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
