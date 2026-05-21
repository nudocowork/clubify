'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, startImpersonation } from '@/lib/api';
import { GrowBusinessCard } from '@/components/GrowBusinessCard';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

export default function TenantDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [t, setT] = useState<any>(null);
  const [extraLocations, setExtraLocations] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);
  const [actioning, setActioning] = useState(false);

  async function load() {
    try {
      const data = await api<any>(`/tenants/${id}`);
      setT(data);
      setExtraLocations(data.maxLocationsOverride ?? '');
    } catch (e: any) {
      toast(e.message || 'Error cargando tenant', 'error');
    }
  }
  useEffect(() => {
    load();
  }, [id]);

  async function save() {
    setSaving(true);
    try {
      await api(`/tenants/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          maxLocationsOverride: extraLocations === '' ? null : Number(extraLocations),
        }),
      });
      await load();
      toast('Cambios guardados', 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(status: string) {
    if (
      status === 'SUSPENDED' &&
      !confirm(`¿Suspender ${t?.brandName ?? 'este negocio'}? Su storefront público dejará de aceptar pedidos.`)
    ) {
      return;
    }
    setActioning(true);
    try {
      await api(`/tenants/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await load();
      toast(
        status === 'ACTIVE'
          ? 'Negocio activado'
          : status === 'SUSPENDED'
          ? 'Negocio suspendido'
          : 'Estado actualizado',
        'success',
      );
    } catch (e: any) {
      toast(e.message || 'No se pudo cambiar el estado', 'error');
    } finally {
      setActioning(false);
    }
  }

  async function extendTrial(days: number) {
    setActioning(true);
    try {
      await api(`/tenants/${id}/extend-trial`, {
        method: 'POST',
        body: JSON.stringify({ days }),
      });
      await load();
      toast(`Trial extendido ${days} día${days === 1 ? '' : 's'}`, 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo extender el trial', 'error');
    } finally {
      setActioning(false);
    }
  }

  if (!t) {
    return (
      <div className="space-y-3">
        <div className="h-10 bg-bg2 rounded animate-shimmer" />
        <div className="h-32 bg-bg2 rounded animate-shimmer" />
        <div className="h-48 bg-bg2 rounded animate-shimmer" />
      </div>
    );
  }

  const daysLeft = t.trialEndsAt
    ? Math.max(
        0,
        Math.ceil((new Date(t.trialEndsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
      )
    : null;

  return (
    <div className="max-w-4xl">
      <div className="page-head">
        <h1 className="page-title">
          {t.brandName} <span className="page-crumb">/ Negocios</span>
        </h1>
        <button className="btn-ghost" onClick={() => router.push('/admin/tenants')}>
          ← Volver
        </button>
      </div>

      {/* Estado y trial */}
      <div className="card card-pad mb-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wider text-mute font-semibold">
              Estado actual
            </div>
            <div className="mt-2 flex items-center gap-3 flex-wrap">
              <span
                className={`badge ${
                  t.status === 'ACTIVE'
                    ? 'badge-ok'
                    : t.status === 'TRIAL'
                    ? 'badge-warn'
                    : 'badge-bad'
                }`}
              >
                {t.status}
              </span>
              {daysLeft !== null && (
                <span className="text-sm text-mute">
                  Trial: <strong className="text-ink">{daysLeft} días restantes</strong>
                  {t.trialEndsAt && (
                    <>
                      {' '}
                      (vence{' '}
                      {new Date(t.trialEndsAt).toLocaleDateString('es-CO', {
                        day: 'numeric',
                        month: 'short',
                      })}
                      )
                    </>
                  )}
                </span>
              )}
              {t.suspendedAt && (
                <span className="text-xs text-bad">
                  Suspendido el{' '}
                  {new Date(t.suspendedAt).toLocaleDateString('es-CO', {
                    day: 'numeric',
                    month: 'short',
                  })}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-primary text-sm"
              disabled={actioning || t.status === 'SUSPENDED'}
              onClick={async () => {
                setActioning(true);
                try {
                  const res = await api(`/tenants/${id}/impersonate`, { method: 'POST' });
                  startImpersonation({
                    accessToken: res.accessToken,
                    user: res.user,
                    tenant: { id: res.tenant.id, brandName: res.tenant.brandName },
                  });
                  toast(`Entrando a ${res.tenant.brandName}…`, 'success');
                  router.push('/app');
                } catch (e: any) {
                  toast(e.message || 'No se pudo entrar', 'error');
                  setActioning(false);
                }
              }}
              title={t.status === 'SUSPENDED' ? 'Reactiva el negocio para entrar' : 'Entrar como dueño del negocio'}
            >
              <Icon name="arrow-right" /> Entrar al negocio
            </button>
            {t.status === 'TRIAL' && (
              <>
                <button
                  className="btn-ghost text-sm"
                  disabled={actioning}
                  onClick={() => extendTrial(7)}
                >
                  +7 días
                </button>
                <button
                  className="btn-ghost text-sm"
                  disabled={actioning}
                  onClick={() => extendTrial(30)}
                >
                  +30 días
                </button>
              </>
            )}
            {t.status === 'SUSPENDED' && (
              <button
                className="btn-primary text-sm"
                disabled={actioning}
                onClick={() => extendTrial(14)}
              >
                Reactivar (+14d)
              </button>
            )}
            {t.status === 'ACTIVE' ? (
              <button
                className="btn-ghost text-sm text-bad"
                disabled={actioning}
                onClick={() => setStatus('SUSPENDED')}
              >
                Suspender
              </button>
            ) : (
              <button
                className="btn-primary text-sm"
                disabled={actioning}
                onClick={() => setStatus('ACTIVE')}
              >
                Marcar como activo
              </button>
            )}
            {/* Demo lock toggle — convierte el tenant en cuenta demo de
                solo-lectura. Cualquier no-SUPER_ADMIN que entre solo puede
                ver/navegar. Útil para que los embajadores muestren a prospects. */}
            <button
              className={`text-sm ${t.isLocked ? 'btn-primary' : 'btn-ghost'}`}
              disabled={actioning}
              onClick={async () => {
                const wantLock = !t.isLocked;
                if (wantLock) {
                  if (
                    !confirm(
                      '¿Activar modo demo (solo lectura)?\n\nNadie excepto super admin podrá modificar este negocio. Pensado para cuentas demo que los embajadores muestran a prospects.',
                    )
                  )
                    return;
                }
                setActioning(true);
                try {
                  await api(`/tenants/${id}/lock`, {
                    method: 'PATCH',
                    body: JSON.stringify({ locked: wantLock }),
                  });
                  toast(
                    wantLock ? '🔒 Cuenta bloqueada como demo' : '🔓 Demo desbloqueado — editable',
                    'success',
                  );
                  await load();
                } catch (e: any) {
                  toast(e.message || 'No se pudo cambiar el lock', 'error');
                } finally {
                  setActioning(false);
                }
              }}
              title={
                t.isLocked
                  ? 'Quitar el bloqueo demo para volver a editar el contenido'
                  : 'Activar modo demo: solo lectura para no-super-admin'
              }
            >
              {t.isLocked ? '🔓 Desbloquear demo' : '🔒 Bloquear como demo'}
            </button>
          </div>
        </div>
        {t.isLocked && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 mt-3 text-xs text-amber-900">
            <strong>🔒 Modo demo activo.</strong> Cualquier usuario que entre a
            este negocio (incluyendo dueño o staff) solo puede ver y navegar —
            no puede modificar nada. Solo super admin puede editar. Desbloqueá
            arriba si necesitás actualizar el contenido curado.
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-4">
        <div className="kpi">
          <div className="kpi-lbl">Plan</div>
          <div className="kpi-val text-brand">{t.plan?.name}</div>
          <div className="kpi-sub">${Number(t.plan?.priceMonthly ?? 0).toLocaleString('es-CO')}/mes</div>
        </div>
        <div className="kpi">
          <div className="kpi-lbl">Tarjetas</div>
          <div className="kpi-val">{t._count?.cards ?? 0}</div>
        </div>
        <div className="kpi">
          <div className="kpi-lbl">Clientes</div>
          <div className="kpi-val">{t._count?.customers ?? 0}</div>
        </div>
        <div className="kpi">
          <div className="kpi-lbl">Pases</div>
          <div className="kpi-val">{t._count?.passes ?? 0}</div>
        </div>
      </div>

      {/* Info */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card card-pad">
          <h2 className="text-base font-semibold m-0">Información</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-mute">Email</dt>
              <dd className="font-medium">{t.email}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-mute">WhatsApp</dt>
              <dd className="font-medium">{t.whatsappPhone || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-mute">Slug</dt>
              <dd className="font-mono text-xs">{t.slug}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-mute">Creado</dt>
              <dd className="font-medium">
                {new Date(t.createdAt).toLocaleDateString('es-CO', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </dd>
            </div>
          </dl>
          <div className="mt-4 pt-3 border-t border-line">
            <Link
              href={`/m/${t.slug}`}
              target="_blank"
              className="text-sm text-brand hover:underline"
            >
              Abrir storefront →
            </Link>
          </div>
        </div>

        <div className="card card-pad">
          <h2 className="text-base font-semibold m-0">Override de ubicaciones</h2>
          <p className="mt-1 text-sm text-mute">
            Plan permite <strong className="text-ink">{t.plan?.maxLocations}</strong> ubicaciones.
          </p>
          <div className="mt-4 flex items-end gap-3">
            <div className="flex-1">
              <label className="label">Override</label>
              <input
                className="input"
                type="number"
                min={0}
                placeholder={`Default ${t.plan?.maxLocations}`}
                value={extraLocations}
                onChange={(e) =>
                  setExtraLocations(e.target.value === '' ? '' : Number(e.target.value))
                }
              />
            </div>
            <button className="btn-primary" disabled={saving} onClick={save}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>

        <GrowBusinessCard tenantId={t.id} planName={t.plan?.name ?? null} />

        <BillingNotificationsCard tenant={t} />

        <BillingCard tenant={t} onChange={load} />

        <HotmartSimulatorCard tenant={t} onChange={load} />
      </div>
    </div>
  );
}

// ============================================================
//        SIMULADOR HOTMART — testing sin tarjetas reales
// ============================================================

const SIMULATOR_EVENTS: {
  event: string;
  label: string;
  emoji: string;
  hint: string;
  variant: 'ok' | 'warn' | 'danger' | 'neutral';
}[] = [
  { event: 'PURCHASE_APPROVED', label: 'Pago aprobado', emoji: '✅', hint: 'Activa tenant + setea próximo cobro', variant: 'ok' },
  { event: 'PURCHASE_DELAYED', label: 'Pago demorado', emoji: '🕓', hint: 'failedPaymentCount++ → PAST_DUE', variant: 'warn' },
  { event: 'PURCHASE_PROTEST', label: 'Pago en disputa', emoji: '⚠️', hint: 'Como demorado pero más severo', variant: 'warn' },
  { event: 'PURCHASE_REFUNDED', label: 'Reembolso', emoji: '💸', hint: 'Suspende + revierte comisión', variant: 'danger' },
  { event: 'PURCHASE_CHARGEBACK', label: 'Chargeback', emoji: '🚫', hint: 'Suspende + revierte comisión', variant: 'danger' },
  { event: 'SUBSCRIPTION_CANCELLATION', label: 'Cancelación', emoji: '🛑', hint: 'Suspende suavemente (sin revertir)', variant: 'danger' },
  { event: 'UPDATE_SUBSCRIPTION_CHARGE_DATE', label: 'Mover próximo cobro', emoji: '📅', hint: '+30 días desde ahora', variant: 'neutral' },
];

function HotmartSimulatorCard({
  tenant,
  onChange,
}: {
  tenant: any;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function fire(event: string) {
    if (!confirm(`¿Disparar ${event} en este tenant? Esto NO involucra Hotmart real.`)) return;
    setBusy(event);
    try {
      const body: any = { tenantId: tenant.id, event };
      const r = await api<any>('/admin/billing/hotmart/simulate-webhook', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const action = r?.handlerResult?.action ?? 'sin acción';
      toast(`${event} → ${action}`, 'success');
      onChange();
    } catch (e: any) {
      toast(e.message || 'Error simulando webhook', 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card card-pad md:col-span-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold m-0">
            🧪 Simulador Hotmart (QA)
          </h2>
          <p className="text-xs text-mute mt-1">
            Dispara eventos del webhook contra este tenant{' '}
            <strong>sin involucrar Hotmart ni cobrar nada</strong>. Pasa por el
            mismo handler que un pago real.
          </p>
        </div>
        <span className="text-[10px] px-2 py-1 rounded-full bg-amber-100 text-amber-900 font-semibold uppercase tracking-wide">
          solo super admin
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 mt-4">
        {SIMULATOR_EVENTS.map((e) => {
          const ring =
            e.variant === 'ok'
              ? 'border-ok/40 hover:border-ok bg-ok-soft/30'
              : e.variant === 'warn'
              ? 'border-amber-300 hover:border-amber-500 bg-amber-50/50'
              : e.variant === 'danger'
              ? 'border-red-300 hover:border-red-500 bg-red-50/40'
              : 'border-line hover:border-brand bg-bg2';
          return (
            <button
              key={e.event}
              type="button"
              disabled={busy !== null}
              onClick={() => fire(e.event)}
              className={`text-left rounded-input border-2 p-3 transition disabled:opacity-50 ${ring}`}
            >
              <div className="text-xl mb-1">{e.emoji}</div>
              <div className="text-sm font-semibold">
                {busy === e.event ? 'Disparando…' : e.label}
              </div>
              <div className="text-[11px] text-mute mt-0.5">{e.hint}</div>
              <div className="text-[10px] text-mute font-mono mt-1.5">
                {e.event}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-3 text-[11px] text-mute leading-relaxed">
        Las simulaciones marcan al tenant con <code>subscriberCode = sim-...</code>{' '}
        para distinguir de cobros reales. Si querés simular múltiples renovaciones,
        usá <strong>UPDATE_SUBSCRIPTION_CHARGE_DATE</strong> y después{' '}
        <strong>PURCHASE_APPROVED</strong> de nuevo.
      </div>
    </div>
  );
}

// ============================================================
//             SECUENCIA SMS DE COBRO (estado read-only)
// ============================================================

function BillingNotificationsCard({ tenant }: { tenant: any }) {
  const fmt = (d: string | null | undefined) =>
    d
      ? new Date(d).toLocaleString('es-CO', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—';
  const fmtDate = (d: string | null | undefined) =>
    d
      ? new Date(d).toLocaleDateString('es-CO', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : null;
  const gbConnected = !!tenant.growBusinessLocationId;
  const reminderDate = fmtDate(tenant.currentPeriodEnd);
  const reminderSent = !!(
    tenant.paymentReminderSentFor &&
    tenant.currentPeriodEnd &&
    new Date(tenant.paymentReminderSentFor).getTime() ===
      new Date(tenant.currentPeriodEnd).getTime()
  );
  const failed = (tenant.failedPaymentCount ?? 0) > 0;

  return (
    <div className="card card-pad md:col-span-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold m-0 flex items-center gap-2">
            📱 Secuencia SMS de cobro
          </h2>
          <p className="text-xs text-mute mt-1 leading-relaxed">
            Mensajes SMS automáticos al dueño desde el sub-account de Grow
            Business. El cron diario (3 AM) los dispara según el ciclo de
            Hotmart.
          </p>
        </div>
        {gbConnected ? (
          <span className="badge badge-ok">SMS conectado</span>
        ) : (
          <span className="badge badge-warn">Sin Grow Business</span>
        )}
      </div>

      {!gbConnected && (
        <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-900">
          ⚠ Este negocio no está conectado a Grow Business. Los SMS de cobro
          no se envían — los emails que aparezcan en el cron quedan en log
          pero no llegan al dueño. Conecta arriba en la card "Grow Business ·
          SMS".
        </div>
      )}

      <ol className="mt-4 space-y-2.5">
        <NotifStep
          n={1}
          title="🗓 Recordatorio D-1 (un día antes del cobro)"
          help={
            reminderDate
              ? `Próximo cobro: ${reminderDate}`
              : 'Sin currentPeriodEnd configurado'
          }
          status={reminderSent ? 'sent' : 'pending'}
          when={reminderSent ? `Enviado para ${reminderDate}` : null}
        />
        <NotifStep
          n={2}
          title="✅ Confirmación de pago"
          help="Se envía al recibir PURCHASE_APPROVED del webhook Hotmart"
          status={
            tenant.failedPaymentCount === 0 && tenant.lastPaymentAttemptAt
              ? 'sent'
              : 'idle'
          }
          when={
            tenant.failedPaymentCount === 0 && tenant.lastPaymentAttemptAt
              ? `Último: ${fmt(tenant.lastPaymentAttemptAt)}`
              : null
          }
        />
        <NotifStep
          n={3}
          title="⚠ Aviso de pago fallido"
          help="Se envía al recibir PURCHASE_DELAYED/PROTEST"
          status={failed ? 'warn' : 'idle'}
          when={
            tenant.paymentFailureNoticeSentAt
              ? `Enviado: ${fmt(tenant.paymentFailureNoticeSentAt)}`
              : null
          }
        />
        <NotifStep
          n={4}
          title="⏰ Tu cuenta se pausará en 2 días"
          help={`Cron envía 2 días después del último intento fallido (failedPaymentCount=${tenant.failedPaymentCount ?? 0})`}
          status={tenant.pausePendingNoticeSentAt ? 'sent' : failed ? 'pending' : 'idle'}
          when={
            tenant.pausePendingNoticeSentAt
              ? `Enviado: ${fmt(tenant.pausePendingNoticeSentAt)}`
              : null
          }
        />
        <NotifStep
          n={5}
          title="🔴 Cuenta pausada"
          help="4 días después del último intento fallido sin pago, cron suspende la cuenta"
          status={
            tenant.suspendedAt && failed ? 'sent' : 'idle'
          }
          when={tenant.suspendedAt ? `Suspendido: ${fmt(tenant.suspendedAt)}` : null}
        />
      </ol>
    </div>
  );
}

function NotifStep({
  n,
  title,
  help,
  status,
  when,
}: {
  n: number;
  title: string;
  help: string;
  status: 'idle' | 'pending' | 'sent' | 'warn';
  when: string | null;
}) {
  const cls =
    status === 'sent'
      ? 'border-ok/30 bg-ok-soft/40'
      : status === 'warn'
      ? 'border-amber-300 bg-amber-50'
      : status === 'pending'
      ? 'border-line bg-bg2/40'
      : 'border-line2 bg-white opacity-70';
  const dot =
    status === 'sent'
      ? '✓'
      : status === 'warn'
      ? '⚠'
      : status === 'pending'
      ? '○'
      : '○';
  return (
    <li className={`border rounded-input px-3 py-2.5 ${cls}`}>
      <div className="flex items-start gap-3">
        <div className="text-xs font-mono opacity-70 mt-0.5">{n}.</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-[11px] text-mute mt-0.5">{help}</div>
          {when && (
            <div className="text-[11px] text-ok mt-1 font-medium">{when}</div>
          )}
        </div>
        <div className="text-base flex-none mt-0.5">{dot}</div>
      </div>
    </li>
  );
}

// ============================================================
//                 BILLING EDITOR (admin)
// ============================================================

type BillingMode = 'free' | 'trial' | 'paid' | 'pending';

const MODE_OPTIONS: Array<{ v: BillingMode; emoji: string; label: string; hint: string }> = [
  { v: 'pending', emoji: '🔒', label: 'Sin pago', hint: 'Lockscreen activo' },
  { v: 'free', emoji: '🎁', label: 'Sin costo', hint: 'Cortesía indefinida' },
  { v: 'trial', emoji: '⏱', label: 'Trial', hint: 'Acceso por X días' },
  { v: 'paid', emoji: '💳', label: 'Pagada', hint: 'Hotmart enlazado' },
];

function BillingCard({ tenant, onChange }: { tenant: any; onChange: () => void }) {
  // Detectar modo actual desde el estado del tenant
  const currentMode: BillingMode = (() => {
    const code: string | null = tenant.hotmartSubscriberCode ?? null;
    if (!code) return 'pending';
    if (code.startsWith('comp-')) return 'free';
    if (code.startsWith('trial-')) return 'trial';
    return 'paid'; // manual-... o código real Hotmart
  })();

  const [mode, setMode] = useState<BillingMode>(currentMode);
  const [trialDays, setTrialDays] = useState(7);
  const [gracePeriodDays, setGracePeriodDays] = useState<number>(
    typeof tenant.gracePeriodDays === 'number' ? tenant.gracePeriodDays : 0,
  );
  const [nextChargeDate, setNextChargeDate] = useState(
    tenant.currentPeriodEnd
      ? new Date(tenant.currentPeriodEnd).toISOString().slice(0, 10)
      : '',
  );
  const [code, setCode] = useState<string>(
    typeof tenant.hotmartSubscriberCode === 'string' &&
      !tenant.hotmartSubscriberCode.startsWith('manual-') &&
      !tenant.hotmartSubscriberCode.startsWith('comp-') &&
      !tenant.hotmartSubscriberCode.startsWith('trial-')
      ? tenant.hotmartSubscriberCode
      : '',
  );
  const [saving, setSaving] = useState(false);

  async function apply() {
    const graceChanged = gracePeriodDays !== (tenant.gracePeriodDays ?? 0);
    const modeChanged = mode !== currentMode;
    // Solo cambia la gracia (mismo modo): usamos PATCH /tenants/:id sin tocar
    // trialEndsAt ni el ciclo de cobro. Útil para extender gracia sin reset.
    if (graceChanged && !modeChanged) {
      if (!confirm(`Actualizar días de gracia a ${gracePeriodDays}?`)) return;
      setSaving(true);
      try {
        await api(`/tenants/${tenant.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ gracePeriodDays }),
        });
        toast('Días de gracia actualizados', 'success');
        onChange();
      } catch (e: any) {
        toast(e.message || 'No se pudo actualizar', 'error');
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!confirm(`Cambiar facturación a "${MODE_OPTIONS.find((m) => m.v === mode)?.label}"?`))
      return;
    setSaving(true);
    try {
      const body: any = { mode };
      if (mode === 'trial') body.trialDays = trialDays;
      if (graceChanged) body.gracePeriodDays = gracePeriodDays;
      if (mode === 'paid') {
        if (nextChargeDate)
          body.nextChargeDate = new Date(nextChargeDate).toISOString();
        if (code.trim()) body.hotmartSubscriberCode = code.trim();
        if (!body.nextChargeDate && !body.hotmartSubscriberCode) {
          toast('Para "Pagada" necesitas fecha o código de suscriptor', 'error');
          setSaving(false);
          return;
        }
      }
      await api(`/tenants/${tenant.id}/billing`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      toast('Facturación actualizada', 'success');
      onChange();
    } catch (e: any) {
      toast(e.message || 'No se pudo actualizar', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card card-pad md:col-span-2">
      <h2 className="text-base font-semibold m-0">Facturación</h2>
      <p className="text-xs text-mute mt-1">
        Estado actual: <strong className="text-ink">{MODE_OPTIONS.find((m) => m.v === currentMode)?.label}</strong>
        {tenant.trialEndsAt && (
          <>
            {' '}· Trial vence{' '}
            <strong className="text-ink">
              {new Date(tenant.trialEndsAt).toLocaleDateString('es-CO', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </strong>
          </>
        )}
        {(tenant.gracePeriodDays ?? 0) > 0 && (
          <>
            {' '}· Gracia post-trial{' '}
            <strong className="text-ink">{tenant.gracePeriodDays} días</strong>
          </>
        )}
        {tenant.currentPeriodEnd && (
          <>
            {' '}· Próximo cobro{' '}
            <strong className="text-ink">
              {new Date(tenant.currentPeriodEnd).toLocaleDateString('es-CO', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </strong>
          </>
        )}
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
        {MODE_OPTIONS.map((opt) => {
          const active = mode === opt.v;
          return (
            <button
              type="button"
              key={opt.v}
              onClick={() => setMode(opt.v)}
              className={`text-left rounded-input border-2 p-2.5 transition ${
                active
                  ? 'border-brand bg-brand-soft'
                  : 'border-line bg-white hover:border-brand/40'
              }`}
            >
              <div className="text-lg mb-0.5">{opt.emoji}</div>
              <div className="text-sm font-semibold">{opt.label}</div>
              <div className="text-[11px] text-mute">{opt.hint}</div>
            </button>
          );
        })}
      </div>

      {mode === 'trial' && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="label">Días de trial desde hoy</label>
            <input
              className="input"
              type="number"
              min={1}
              max={365}
              value={trialDays}
              onChange={(e) => setTrialDays(Number(e.target.value) || 7)}
            />
            <div className="text-[11px] text-mute mt-1">
              El trial arranca al aplicar y vence al final del día N.
            </div>
          </div>
          <div>
            <label className="label">Días de gracia tras vencer</label>
            <input
              className="input"
              type="number"
              min={0}
              max={365}
              value={gracePeriodDays}
              onChange={(e) =>
                setGracePeriodDays(Math.max(0, Number(e.target.value) || 0))
              }
            />
            <div className="text-[11px] text-mute mt-1">
              Días extra de acceso tras vencer el trial antes de bloquear.
              0 = corte inmediato.
            </div>
          </div>
        </div>
      )}

      {mode === 'paid' && (
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div>
            <label className="label">Próxima fecha de cobro</label>
            <input
              className="input"
              type="date"
              value={nextChargeDate}
              onChange={(e) => setNextChargeDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Código suscriptor Hotmart</label>
            <input
              className="input"
              placeholder="opcional"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
        </div>
      )}

      {mode === 'pending' && (
        <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-900">
          Esto desactiva el código actual y reactiva el lockscreen. El dueño
          tendrá que pagar en Hotmart para volver a entrar.
        </div>
      )}

      {mode === 'free' && (
        <div className="mt-4 rounded-lg bg-ok-soft/50 border border-ok/20 px-3 py-2.5 text-xs text-ok-ink">
          Cuenta queda activa de cortesía indefinidamente.
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          className="btn-primary"
          onClick={apply}
          disabled={
            saving ||
            (mode === currentMode &&
              gracePeriodDays === (tenant.gracePeriodDays ?? 0))
          }
          title={
            mode === currentMode &&
            gracePeriodDays === (tenant.gracePeriodDays ?? 0)
              ? 'No hay cambios'
              : 'Aplicar cambio'
          }
        >
          {saving ? 'Aplicando…' : 'Aplicar cambio →'}
        </button>
      </div>
    </div>
  );
}
