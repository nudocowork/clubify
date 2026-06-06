'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, getUser, startImpersonation } from '@/lib/api';
import { GrowBusinessCard } from '@/components/GrowBusinessCard';
import { ReferralAssignmentCard } from '@/components/ReferralAssignmentCard';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import {
  formatPlanLabel,
  periodCadence,
  periodLabel,
  periodTotalUsd,
  type PlanPeriodicity,
} from '@/lib/plan-format';

export default function TenantDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [t, setT] = useState<any>(null);
  const [extraLocations, setExtraLocations] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);
  const [actioning, setActioning] = useState(false);
  // MARKETING ve la página pero sin acciones de billing/status — esos
  // endpoints son SUPER_ADMIN only y mostrarían "Permisos insuficientes"
  // al click. Esconderlos limpia UX en lugar de fallar fuerte.
  //
  // M5 (2026-06-04): MARKETING SÍ puede impersonar tenants (entrar al
  // panel como dueño) — el rol se usa para implementadores que
  // configuran cuentas. Por eso el botón "Entrar al negocio" gateamos
  // con `canImpersonate` en vez de `isSuperAdmin`.
  const me = getUser();
  const isSuperAdmin = me?.role === 'SUPER_ADMIN';
  const canImpersonate = isSuperAdmin || me?.role === 'MARKETING';

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

  /**
   * Convierte el tenant a cliente pagante (ACTIVE + currentPeriodEnd
   * +30d + sin trialEndsAt). Útil cuando paga por fuera de Hotmart.
   * Automáticamente dispara backfill de comisión si tiene asignación
   * a INFLUENCER/AMBASSADOR.
   */
  async function convertToPaying() {
    if (
      !confirm(
        `¿Convertir ${t?.brandName ?? 'este negocio'} a cliente pagante?\n\n` +
          'Esto:\n' +
          '• Marca el negocio como ACTIVE\n' +
          '• Setea el próximo cobro en 30 días\n' +
          '• Limpia los días de trial\n' +
          '• Genera la comisión PENDING al afiliado si lo tiene asignado\n\n' +
          'Usalo solo si el cliente efectivamente pagó (por fuera de Hotmart).',
      )
    ) {
      return;
    }
    setActioning(true);
    try {
      await api(`/tenants/${id}/convert-to-paying`, {
        method: 'POST',
        body: JSON.stringify({ periodDays: 30 }),
      });
      await load();
      toast('Negocio convertido a cliente pagante', 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo convertir', 'error');
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
            {canImpersonate && (
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
            )}
            {isSuperAdmin && t.status === 'TRIAL' && (
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
                <button
                  className="btn-primary text-sm"
                  disabled={actioning}
                  onClick={convertToPaying}
                  title="El cliente pagó por fuera de Hotmart — convertir a cliente activo y generar comisión"
                >
                  💰 Marcar como pagado
                </button>
              </>
            )}
            {isSuperAdmin && t.status === 'SUSPENDED' && (
              <button
                className="btn-primary text-sm"
                disabled={actioning}
                onClick={() => extendTrial(14)}
              >
                Reactivar (+14d)
              </button>
            )}
            {isSuperAdmin && (t.status === 'ACTIVE' ? (
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
            ))}
            {/* Demo lock toggle — convierte el tenant en cuenta demo de
                solo-lectura. Cualquier no-SUPER_ADMIN que entre solo puede
                ver/navegar. Útil para que los embajadores muestren a prospects. */}
            {isSuperAdmin && (<button
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
            </button>)}
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
          <div className="kpi-val text-brand">{t.plan?.name ?? 'Elite'}</div>
          <div className="kpi-sub">
            🗓️ {periodLabel(t.planPeriodicity as PlanPeriodicity | null)} ·{' '}
            {periodTotalUsd(
              t.planPeriodicity as PlanPeriodicity | null,
              Number(t.plan?.priceMonthly ?? 0),
            )}{' '}
            USD{periodCadence(t.planPeriodicity as PlanPeriodicity | null)}
          </div>
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
            {/* Periodicidad ahora vive en la card "Plan actual" más abajo
                — con modal de confirmación + checklist de tareas Hotmart
                manuales (cancelar suscripción vieja + enviar nuevo link).
                Ver PlanCurrentCard. */}
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

        <PlanCurrentCard tenant={t} isSuperAdmin={isSuperAdmin} onChange={load} />

        {isSuperAdmin && (
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
        )}

        {/* HOTFIX 2026-06-05 (bug N): estos 3 cards consumen endpoints
            que el backend gatea como SUPER_ADMIN-only. Antes se mostraban
            a MARKETING y al click recibía 403 — UX rota. Ahora se gatean
            con isSuperAdmin como el resto de cards admin. */}
        {isSuperAdmin && (
          <GrowBusinessCard tenantId={t.id} planName={t.plan?.name ?? null} />
        )}

        {isSuperAdmin && <ReferralAssignmentCard tenantId={t.id} />}

        {isSuperAdmin && <ReviewAlertsAccountCard tenant={t} onSaved={load} />}

        {isSuperAdmin && <BillingAlertsAccountCard tenant={t} onSaved={load} />}

        {isSuperAdmin && <DeliveryAlertsAccountCard tenant={t} onSaved={load} />}

        {isSuperAdmin && <ReviewAlertsLogsCard tenantId={t.id} />}

        {isSuperAdmin && <BillingNotificationsCard tenant={t} />}

        {isSuperAdmin && <BillingCard tenant={t} onChange={load} />}

        {isSuperAdmin && <HotmartSimulatorCard tenant={t} onChange={load} />}
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

// ============================================================
//   Logs de envíos SMS por reseñas negativas (audit superadmin)
// ============================================================

type ReviewAlertEvent = {
  id: string;
  type: 'review.sms_alert_sent' | 'review.sms_alert_failed';
  payload: any;
  createdAt: string;
};

// ============================================================
//   Asignación de subcuenta SMS global por propósito
// ============================================================

type GbAccountOption = {
  id: string;
  name: string;
  purpose: string;
  isDefault: boolean;
  lastTestOk: boolean | null;
};

function ReviewAlertsAccountCard({
  tenant,
  onSaved,
}: {
  tenant: any;
  onSaved: () => void;
}) {
  return (
    <AlertsAccountCard
      tenant={tenant}
      onSaved={onSaved}
      field="reviewAlertsAccountId"
      title="📲 Subcuenta SMS para alertas de reseñas"
      description="Elige qué subcuenta Grow Business usar para los SMS cuando un cliente deje una reseña baja en este negocio."
      preferredPurpose="OPERATIONAL"
      radioName="gb-review-account"
    />
  );
}

function BillingAlertsAccountCard({
  tenant,
  onSaved,
}: {
  tenant: any;
  onSaved: () => void;
}) {
  return (
    <AlertsAccountCard
      tenant={tenant}
      onSaved={onSaved}
      field="billingAlertsAccountId"
      title="💳 Subcuenta SMS para recordatorios de pago"
      description="Elige qué subcuenta Grow Business usar para los SMS administrativos (D-1 recordatorio, impago, suspensión)."
      preferredPurpose="BILLING"
      radioName="gb-billing-account"
    />
  );
}

function DeliveryAlertsAccountCard({
  tenant,
  onSaved,
}: {
  tenant: any;
  onSaved: () => void;
}) {
  return (
    <AlertsAccountCard
      tenant={tenant}
      onSaved={onSaved}
      field="deliveryAlertsAccountId"
      title="🛵 Subcuenta SMS para alertas de domicilio"
      description="Elige qué subcuenta Grow Business usar para los SMS a empresas de domicilio cuando un pedido delivery cambia de estado."
      preferredPurpose="OPERATIONAL"
      radioName="gb-delivery-account"
    />
  );
}

/** Componente reusable: card con radio buttons para elegir subcuenta
 *  global asignada a un campo específico del tenant. Las subcuentas se
 *  ordenan poniendo primero las del `preferredPurpose` (BILLING para
 *  billing card, OPERATIONAL para reviews card) — pero igual mostramos
 *  todas para no bloquear al admin. */
function AlertsAccountCard({
  tenant,
  onSaved,
  field,
  title,
  description,
  preferredPurpose,
  radioName,
}: {
  tenant: any;
  onSaved: () => void;
  field:
    | 'reviewAlertsAccountId'
    | 'billingAlertsAccountId'
    | 'deliveryAlertsAccountId';
  title: string;
  description: string;
  preferredPurpose: 'BILLING' | 'OPERATIONAL';
  radioName: string;
}) {
  const [accounts, setAccounts] = useState<GbAccountOption[] | null>(null);
  const [selected, setSelected] = useState<string>(tenant[field] ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected(tenant[field] ?? '');
  }, [tenant, field]);

  useEffect(() => {
    api<GbAccountOption[]>('/admin/integrations/grow-business-accounts')
      .then((data) =>
        setAccounts(
          data.map((a: any) => ({
            id: a.id,
            name: a.name,
            purpose: a.purpose ?? 'GENERAL',
            isDefault: a.isDefault,
            lastTestOk: a.lastTestOk,
          })),
        ),
      )
      .catch((e: any) =>
        toast(e.message || 'No se cargaron las subcuentas', 'error'),
      );
  }, []);

  async function save() {
    setSaving(true);
    try {
      await api(`/tenants/${tenant.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: selected || null }),
      });
      toast('Subcuenta asignada', 'success');
      onSaved();
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar', 'error');
    } finally {
      setSaving(false);
    }
  }

  const dirty = (selected || '') !== (tenant[field] ?? '');

  // Ordena: preferredPurpose primero, después el resto.
  const sortedAccounts = accounts
    ? [...accounts].sort((a, b) => {
        const aPref = a.purpose === preferredPurpose ? 0 : 1;
        const bPref = b.purpose === preferredPurpose ? 0 : 1;
        return aPref - bPref;
      })
    : null;

  return (
    <div className="card card-pad">
      <h3 className="text-base font-semibold m-0 flex items-center gap-2">
        {title}
      </h3>
      <p className="text-xs text-mute mt-1 leading-relaxed">
        {description}{' '}
        <Link
          href="/admin/integrations"
          className="text-brand hover:underline"
        >
          Gestionar subcuentas →
        </Link>
      </p>

      {accounts === null && (
        <div className="text-xs text-mute mt-3">Cargando subcuentas…</div>
      )}

      {accounts && accounts.length === 0 && (
        <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-900">
          No hay subcuentas registradas todavía.{' '}
          <Link href="/admin/integrations" className="font-semibold underline">
            Crea la primera →
          </Link>
        </div>
      )}

      {sortedAccounts && sortedAccounts.length > 0 && (
        <>
          <div className="mt-3 space-y-1">
            <label className="flex items-center gap-2 p-2 rounded hover:bg-bg2/40 cursor-pointer">
              <input
                type="radio"
                name={radioName}
                checked={selected === ''}
                onChange={() => setSelected('')}
                className="accent-brand"
              />
              <div>
                <div className="text-sm font-medium">
                  Usar credenciales propias del negocio
                </div>
                <div className="text-[11px] text-mute">
                  Fallback al card Grow Business arriba (creds pegadas
                  individualmente para este tenant).
                </div>
              </div>
            </label>
            {sortedAccounts.map((acc) => {
              const isPref = acc.purpose === preferredPurpose;
              return (
                <label
                  key={acc.id}
                  className="flex items-center gap-2 p-2 rounded hover:bg-bg2/40 cursor-pointer"
                >
                  <input
                    type="radio"
                    name={radioName}
                    checked={selected === acc.id}
                    onChange={() => setSelected(acc.id)}
                    className="accent-brand"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                      {acc.name}
                      <span
                        className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${
                          isPref
                            ? 'bg-brand/15 text-brand'
                            : 'bg-bg2 text-mute'
                        }`}
                      >
                        {acc.purpose === 'BILLING'
                          ? 'Billing'
                          : acc.purpose === 'OPERATIONAL'
                          ? 'Operativa'
                          : 'General'}
                      </span>
                      {acc.isDefault && (
                        <span className="text-[9px] uppercase tracking-wider font-bold bg-brand/15 text-brand px-1.5 py-0.5 rounded">
                          Default
                        </span>
                      )}
                      {acc.lastTestOk === true && (
                        <span className="text-[9px] uppercase tracking-wider font-bold bg-ok/15 text-ok px-1.5 py-0.5 rounded">
                          OK
                        </span>
                      )}
                      {acc.lastTestOk === false && (
                        <span className="text-[9px] uppercase tracking-wider font-bold bg-bad/15 text-bad px-1.5 py-0.5 rounded">
                          Falló
                        </span>
                      )}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          {dirty && (
            <div className="mt-3 flex justify-end">
              <button
                onClick={save}
                disabled={saving}
                className="btn-primary text-sm"
              >
                {saving ? 'Guardando…' : 'Guardar asignación'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ReviewAlertsLogsCard({ tenantId }: { tenantId: string }) {
  const [logs, setLogs] = useState<ReviewAlertEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await api<ReviewAlertEvent[]>(
        `/admin/tenants/${tenantId}/review-alerts/logs`,
      );
      setLogs(data);
    } catch (e: any) {
      toast(e.message || 'No se pudo cargar', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const sent = logs?.filter((l) => l.type === 'review.sms_alert_sent').length ?? 0;
  const failed = logs?.filter((l) => l.type === 'review.sms_alert_failed').length ?? 0;

  return (
    <div className="card card-pad">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div>
          <h3 className="text-base font-semibold m-0 flex items-center gap-2">
            📲 Logs de alertas SMS de reseñas
            {logs && (
              <span className="text-[10px] uppercase tracking-wider text-mute">
                {sent} enviadas · {failed} fallidas (últimas 50)
              </span>
            )}
          </h3>
          <p className="text-xs text-mute mt-1 leading-relaxed">
            Cada vez que un cliente deja una reseña baja, registramos si el
            SMS via Grow Business salió o falló.
          </p>
        </div>
        <span
          className={`text-mute text-sm shrink-0 transition-transform ${
            open ? '' : '-rotate-90'
          }`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="mt-4 pt-4 border-t border-line">
          {loading && <div className="text-xs text-mute">Cargando…</div>}
          {!loading && logs?.length === 0 && (
            <div className="text-xs text-mute italic">
              Aún no hay envíos registrados.
            </div>
          )}
          {!loading && logs && logs.length > 0 && (
            <div className="space-y-2">
              {logs.map((log) => {
                const ok = log.type === 'review.sms_alert_sent';
                return (
                  <div
                    key={log.id}
                    className={`rounded-lg border px-3 py-2 text-xs ${
                      ok
                        ? 'bg-ok/5 border-ok/20'
                        : 'bg-bad/5 border-bad/20'
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span
                        className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded ${
                          ok ? 'bg-ok text-white' : 'bg-bad text-white'
                        }`}
                      >
                        {ok ? 'enviado' : 'fallido'}
                      </span>
                      <span className="text-mute">
                        {new Date(log.createdAt).toLocaleString('es-CO')}
                      </span>
                      {log.payload?.rating && (
                        <span className="font-semibold">
                          {'⭐'.repeat(log.payload.rating)}
                        </span>
                      )}
                      {log.payload?.toPhone && (
                        <code className="ml-auto text-[10px] bg-bg2 px-1.5 py-0.5 rounded">
                          → {log.payload.toPhone}
                        </code>
                      )}
                    </div>
                    {log.payload?.response?.message && (
                      <div className="text-mute leading-snug whitespace-pre-line break-all">
                        {log.payload.response.message}
                      </div>
                    )}
                    {log.payload?.reason === 'no_destination_phone' && (
                      <div className="text-amber-700 italic">
                        Sin teléfono destino configurado.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <button
            type="button"
            onClick={load}
            className="btn-ghost text-xs mt-3"
          >
            ↻ Refrescar
          </button>
        </div>
      )}
    </div>
  );
}

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
        para distinguir de cobros reales. Si quieres simular múltiples renovaciones,
        usa <strong>UPDATE_SUBSCRIPTION_CHARGE_DATE</strong> y después{' '}
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

// ============================================================
//   Plan actual + cambio de periodicidad (SOLO METADATA INTERNA)
// ============================================================

type PeriodId = 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';

type LandingPlanCfg = { price: number; checkoutUrl: string | null };
type LandingPlansResp = Partial<Record<'mensual' | 'trimestral' | 'semestral' | 'anual', LandingPlanCfg>>;

const PERIOD_LABEL: Record<PeriodId, string> = {
  MENSUAL: 'Mensual',
  TRIMESTRAL: 'Trimestral',
  SEMESTRAL: 'Semestral',
  ANUAL: 'Anual',
};

// Default fallback en USD — los reales se editan desde /admin/branding.
// Si la API no responde, mostramos estos para no quedar en blanco.
const PERIOD_PRICE_DEFAULT: Record<PeriodId, number> = {
  MENSUAL: 68,
  TRIMESTRAL: 150,
  SEMESTRAL: 278,
  ANUAL: 500,
};

const PERIOD_TO_KEY: Record<PeriodId, 'mensual' | 'trimestral' | 'semestral' | 'anual'> = {
  MENSUAL: 'mensual',
  TRIMESTRAL: 'trimestral',
  SEMESTRAL: 'semestral',
  ANUAL: 'anual',
};

/**
 * Card "Plan actual" + modal de cambio de periodicidad.
 *
 * REGLA CRÍTICA: NO toca Hotmart. Solo actualiza metadata interna del
 * tenant (planPeriodicity + currentPeriodEnd). El admin debe cancelar la
 * suscripción vieja en Hotmart y enviarle al cliente el link del nuevo
 * plan manualmente. Sin esos pasos, el cobro real sigue siendo el del
 * plan anterior.
 *
 * El modal exige 3 checks explícitos antes de habilitar "Confirmar".
 */
function PlanCurrentCard({
  tenant,
  isSuperAdmin,
  onChange,
}: {
  tenant: any;
  isSuperAdmin: boolean;
  onChange: () => void;
}) {
  const [plans, setPlans] = useState<LandingPlansResp | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Carga precios desde /landing-plans para mostrar al lado de la
  // periodicidad actual y en los radios del modal. Si falla, usamos
  // PERIOD_PRICE_DEFAULT.
  useEffect(() => {
    api<LandingPlansResp>('/landing-plans')
      .then((data) => setPlans(data))
      .catch(() => setPlans({}));
  }, []);

  const currentPeriod = (tenant?.planPeriodicity as PeriodId | null) ?? null;
  const currentPrice = currentPeriod
    ? plans?.[PERIOD_TO_KEY[currentPeriod]]?.price ?? PERIOD_PRICE_DEFAULT[currentPeriod]
    : null;

  return (
    <div className="card card-pad">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold m-0">Plan actual</h2>
          <p className="text-xs text-mute mt-1">
            Metadata interna del negocio. El cobro real lo dicta Hotmart.
          </p>
        </div>
        {isSuperAdmin && (
          <button
            type="button"
            className="btn-ghost text-sm cursor-pointer touch-manipulation select-none active:scale-[0.97] transition-transform duration-150 [-webkit-tap-highlight-color:transparent]"
            onClick={() => setModalOpen(true)}
          >
            Cambiar plan
          </button>
        )}
      </div>

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-mute">Plan</dt>
          <dd className="font-semibold text-brand">{tenant.plan?.name ?? '—'}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-mute">Periodicidad</dt>
          <dd className="font-medium">
            {currentPeriod ? PERIOD_LABEL[currentPeriod] : <span className="text-mute">— sin definir —</span>}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-mute">Precio</dt>
          <dd className="font-medium">
            {currentPrice != null ? (
              <>
                <span className="font-semibold">${currentPrice.toLocaleString('en-US')}</span>
                <span className="text-mute"> USD / {PERIOD_LABEL[currentPeriod!].toLowerCase()}</span>
              </>
            ) : (
              <span className="text-mute">—</span>
            )}
          </dd>
        </div>
        {tenant.currentPeriodEnd && (
          <div className="flex justify-between">
            <dt className="text-mute">Próximo cobro</dt>
            <dd className="font-medium">
              {new Date(tenant.currentPeriodEnd).toLocaleDateString('es-CO', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </dd>
          </div>
        )}
      </dl>

      {modalOpen && (
        <ChangePlanPeriodModal
          tenant={tenant}
          currentPeriod={currentPeriod}
          plans={plans ?? {}}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            onChange();
          }}
        />
      )}
    </div>
  );
}

/**
 * Modal de cambio de periodicidad. Exige:
 *  1. Elegir nueva periodicidad (radio).
 *  2. Marcar 3 checks de tareas manuales en Hotmart.
 *  3. Confirmar — recién ahí dispara POST /tenants/:id/change-plan-period.
 *
 * El backend SOLO actualiza metadata (planPeriodicity + currentPeriodEnd
 * + AuditLog). Hotmart sigue cobrando lo mismo hasta que el admin haga
 * los pasos manuales.
 */
function ChangePlanPeriodModal({
  tenant,
  currentPeriod,
  plans,
  onClose,
  onSaved,
}: {
  tenant: any;
  currentPeriod: PeriodId | null;
  plans: LandingPlansResp;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<PeriodId | null>(currentPeriod);
  const [check1, setCheck1] = useState(false);
  const [check2, setCheck2] = useState(false);
  const [check3, setCheck3] = useState(false);
  const [saving, setSaving] = useState(false);

  const allChecksOk = check1 && check2 && check3;
  const canConfirm =
    !!selected && selected !== currentPeriod && allChecksOk && !saving;

  async function confirm() {
    if (!canConfirm || !selected) return;
    setSaving(true);
    try {
      await api(`/tenants/${tenant.id}/change-plan-period`, {
        method: 'POST',
        body: JSON.stringify({ periodicity: selected }),
      });
      toast('Plan actualizado (metadata interna)', 'success');
      onSaved();
    } catch (e: any) {
      toast(e.message || 'No se pudo cambiar el plan', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-end md:items-center justify-center p-3 md:p-6 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-[0_25px_70px_-12px_rgba(0,0,0,0.45)] border border-line2 w-full max-w-xl max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom-6 md:slide-in-from-bottom-2 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-line2 flex items-center justify-between sticky top-0 bg-white z-10">
          <h3 className="text-lg font-semibold m-0 text-ink">Cambiar plan</h3>
          <button
            type="button"
            className="text-mute hover:text-ink text-2xl leading-none cursor-pointer touch-manipulation select-none active:scale-[0.97] transition-transform duration-150 [-webkit-tap-highlight-color:transparent]"
            onClick={onClose}
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Warning grande arriba de todo */}
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3.5 py-3 text-xs text-amber-900 leading-relaxed">
            <div className="font-semibold mb-1.5">
              ⚠ Este cambio actualiza la metadata interna del negocio.
            </div>
            Hotmart NO se entera automáticamente — tú tienes que:
            <ol className="list-decimal list-inside mt-1.5 space-y-0.5">
              <li>Cancelar la suscripción vieja en Hotmart.</li>
              <li>
                Enviarle al cliente el link del nuevo plan (link de Hotmart
                configurado en{' '}
                <Link href="/admin/branding" className="underline font-semibold">
                  /admin/branding
                </Link>
                ).
              </li>
            </ol>
            <div className="mt-1.5">
              Sin esto, el cobro seguirá siendo el del plan anterior.
            </div>
          </div>

          {/* Radios de periodicidad */}
          <div>
            <label className="label">Nueva periodicidad</label>
            <div className="mt-2 space-y-1.5">
              {(['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'] as PeriodId[]).map((p) => {
                const price =
                  plans?.[PERIOD_TO_KEY[p]]?.price ?? PERIOD_PRICE_DEFAULT[p];
                const isCurrent = p === currentPeriod;
                return (
                  <label
                    key={p}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer touch-manipulation select-none active:scale-[0.99] transition-transform duration-150 [-webkit-tap-highlight-color:transparent] ${
                      selected === p
                        ? 'border-brand bg-brand/5'
                        : 'border-line hover:bg-bg2/40'
                    }`}
                  >
                    <input
                      type="radio"
                      name="plan-period"
                      checked={selected === p}
                      onChange={() => setSelected(p)}
                      className="accent-brand"
                    />
                    <div className="flex-1 flex items-center justify-between gap-2 flex-wrap">
                      <div className="font-medium">
                        {PERIOD_LABEL[p]}
                        {isCurrent && (
                          <span className="ml-2 text-[10px] uppercase tracking-wider font-bold text-mute bg-bg2 px-1.5 py-0.5 rounded">
                            actual
                          </span>
                        )}
                      </div>
                      <div className="text-sm">
                        <span className="font-semibold">
                          ${price.toLocaleString('en-US')}
                        </span>
                        <span className="text-mute"> USD</span>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Checklist de 3 confirmaciones */}
          <div className="rounded-lg border border-line bg-bg2/40 px-3.5 py-3">
            <div className="text-xs font-semibold text-mute uppercase tracking-wider mb-2">
              Confirmaciones obligatorias
            </div>
            <div className="space-y-2 text-sm">
              <label className="flex items-start gap-2.5 cursor-pointer touch-manipulation select-none">
                <input
                  type="checkbox"
                  checked={check1}
                  onChange={(e) => setCheck1(e.target.checked)}
                  className="accent-brand mt-0.5"
                />
                <span>Cancelé la suscripción vieja en Hotmart</span>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer touch-manipulation select-none">
                <input
                  type="checkbox"
                  checked={check2}
                  onChange={(e) => setCheck2(e.target.checked)}
                  className="accent-brand mt-0.5"
                />
                <span>Le envié al cliente el link del nuevo plan</span>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer touch-manipulation select-none">
                <input
                  type="checkbox"
                  checked={check3}
                  onChange={(e) => setCheck3(e.target.checked)}
                  className="accent-brand mt-0.5"
                />
                <span>
                  Confirmo que entiendo que el cobro real lo dicta Hotmart
                </span>
              </label>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-line flex items-center justify-end gap-2 sticky bottom-0 bg-bg1">
          <button
            type="button"
            className="btn-ghost text-sm cursor-pointer touch-manipulation select-none active:scale-[0.97] transition-transform duration-150 [-webkit-tap-highlight-color:transparent]"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn-primary text-sm cursor-pointer touch-manipulation select-none active:scale-[0.97] transition-transform duration-150 [-webkit-tap-highlight-color:transparent]"
            onClick={confirm}
            disabled={!canConfirm}
            title={
              !selected
                ? 'Elige una periodicidad'
                : selected === currentPeriod
                ? 'Ya está en esta periodicidad'
                : !allChecksOk
                ? 'Marca los 3 checks de confirmación'
                : 'Confirmar el cambio'
            }
          >
            {saving ? 'Guardando…' : 'Confirmar cambio'}
          </button>
        </div>
      </div>
    </div>
  );
}
