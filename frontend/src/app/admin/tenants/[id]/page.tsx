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
      </div>
    </div>
  );
}
