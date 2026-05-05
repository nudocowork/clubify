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
          </div>
        </div>
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

        <GrowBusinessCard tenantId={t.id} />

        <BillingCard tenant={t} onChange={load} />
      </div>
    </div>
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
    if (!confirm(`Cambiar facturación a "${MODE_OPTIONS.find((m) => m.v === mode)?.label}"?`))
      return;
    setSaving(true);
    try {
      const body: any = { mode };
      if (mode === 'trial') body.trialDays = trialDays;
      if (mode === 'paid') {
        if (nextChargeDate)
          body.nextChargeDate = new Date(nextChargeDate).toISOString();
        if (code.trim()) body.hotmartSubscriberCode = code.trim();
        if (!body.nextChargeDate && !body.hotmartSubscriberCode) {
          alert('Para "Pagada" necesitas fecha o código de suscriptor');
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
        <div className="mt-4">
          <label className="label">Días de trial desde hoy</label>
          <input
            className="input max-w-xs"
            type="number"
            min={1}
            max={365}
            value={trialDays}
            onChange={(e) => setTrialDays(Number(e.target.value) || 7)}
          />
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
          disabled={saving || mode === currentMode}
          title={mode === currentMode ? 'Ya está en este modo' : 'Aplicar cambio'}
        >
          {saving ? 'Aplicando…' : 'Aplicar cambio →'}
        </button>
      </div>
    </div>
  );
}
