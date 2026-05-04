'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, startImpersonation } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

function avatarClass(seed: string) {
  const sum = seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return `avatar-${(sum % 7) + 1}`;
}
function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

export default function TenantsPage() {
  const router = useRouter();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'ALL' | 'ACTIVE' | 'TRIAL' | 'SUSPENDED'>('ALL');
  const [enteringId, setEnteringId] = useState<string | null>(null);

  async function enterTenant(t: any) {
    if (enteringId) return;
    setEnteringId(t.id);
    try {
      const res = await api(`/tenants/${t.id}/impersonate`, { method: 'POST' });
      startImpersonation({
        accessToken: res.accessToken,
        user: res.user,
        tenant: { id: res.tenant.id, brandName: res.tenant.brandName },
      });
      toast(`Entrando a ${res.tenant.brandName}…`, 'success');
      router.push('/app');
    } catch (e: any) {
      toast(e.message || 'No se pudo entrar al negocio', 'error');
      setEnteringId(null);
    }
  }

  async function load() {
    setLoading(true);
    try {
      setList(await api('/tenants'));
    } catch (e: any) {
      toast(e.message || 'Error cargando negocios', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function setStatus(id: string, status: string) {
    try {
      await api(`/tenants/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      toast(
        status === 'ACTIVE' ? 'Negocio reactivado' : 'Negocio suspendido',
        'success',
      );
      load();
    } catch (e: any) {
      toast(e.message || 'No se pudo cambiar el estado', 'error');
    }
  }

  const visible = list.filter((t) => filter === 'ALL' || t.status === filter);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Negocios <span className="page-crumb">/ {list.length} registros</span>
        </h1>
        <div className="flex gap-2 flex-wrap">
          <Link className="btn-primary" href="/admin/tenants/new">
            <Icon name="plus" /> Nuevo negocio
          </Link>
        </div>
      </div>

      <div className="mb-3.5">
        <div className="tabs">
          {(['ALL', 'ACTIVE', 'TRIAL', 'SUSPENDED'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`tab ${filter === f ? 'tab-active' : ''}`}
            >
              {f === 'ALL' ? 'Todos' : f === 'ACTIVE' ? 'Activos' : f === 'TRIAL' ? 'Trial' : 'Suspendidos'}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden p-0">
       <div className="overflow-x-auto">
        <table className="w-full text-[13.5px] min-w-[760px]">
          <thead className="bg-bg2">
            <tr>
              {['Negocio', 'Plan', 'Estado', 'Trial', 'Pedidos 30d', 'Revenue 30d', 'Clientes', ''].map(
                (h) => (
                  <th
                    key={h}
                    className="text-left px-4 py-3.5 text-[11px] uppercase tracking-[0.1em] text-mute font-semibold"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-t border-line2">
                  <td colSpan={8} className="px-4 py-3.5">
                    <div className="h-6 bg-bg2 rounded animate-shimmer" />
                  </td>
                </tr>
              ))}
            {!loading && visible.length === 0 && (
              <tr>
                <td className="px-4 py-12 text-center" colSpan={8}>
                  <div className="text-3xl mb-1">🏢</div>
                  <div className="font-semibold">
                    {filter === 'ALL'
                      ? 'Sin negocios todavía'
                      : `Sin negocios en estado ${filter}`}
                  </div>
                  <div className="text-mute text-xs mt-1">
                    {filter === 'ALL'
                      ? 'Cuando alguien haga signup aparecerá aquí.'
                      : 'Prueba cambiar el filtro arriba.'}
                  </div>
                </td>
              </tr>
            )}
            {visible.map((t) => (
              <tr key={t.id} className="border-t border-line2 hover:bg-[#FAFAFB]">
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`avatar w-8 h-8 text-xs ${avatarClass(t.brandName)}`}
                    >
                      {initials(t.brandName)}
                    </span>
                    <div>
                      <div className="font-medium">{t.brandName}</div>
                      <div className="text-mute text-xs">{t.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5">{t.plan?.name}</td>
                <td className="px-4 py-3.5">
                  <span
                    className={`badge ${
                      t.status === 'ACTIVE'
                        ? 'badge-ok'
                        : t.status === 'TRIAL'
                        ? 'badge-warn'
                        : 'badge-bad'
                    }`}
                  >
                    {t.status === 'ACTIVE'
                      ? 'Activo'
                      : t.status === 'TRIAL'
                      ? 'Trial'
                      : 'Suspendido'}
                  </span>
                </td>
                <td className="px-4 py-3.5">
                  {t.daysLeftInTrial !== null ? (
                    <span
                      className={
                        t.daysLeftInTrial <= 2
                          ? 'text-bad font-medium'
                          : t.daysLeftInTrial <= 5
                          ? 'text-warn font-medium'
                          : 'text-mute'
                      }
                    >
                      {t.daysLeftInTrial}d
                    </span>
                  ) : (
                    <span className="text-mute2">—</span>
                  )}
                </td>
                <td className="px-4 py-3.5 font-medium">{t.orders30 ?? 0}</td>
                <td className="px-4 py-3.5 font-medium">
                  {(t.revenue30 ?? 0).toLocaleString('es-CO', {
                    style: 'currency',
                    currency: t.currency ?? 'COP',
                    maximumFractionDigits: 0,
                  })}
                </td>
                <td className="px-4 py-3.5">{t._count?.customers ?? 0}</td>
                <td className="px-4 py-3.5 text-right whitespace-nowrap">
                  <button
                    onClick={() => enterTenant(t)}
                    disabled={enteringId === t.id || t.status === 'SUSPENDED'}
                    className="btn-link disabled:opacity-50 disabled:cursor-not-allowed"
                    title={
                      t.status === 'SUSPENDED'
                        ? 'Reactiva el negocio para entrar'
                        : 'Entrar como dueño'
                    }
                  >
                    {enteringId === t.id ? '…' : 'Entrar →'}
                  </button>
                  <Link className="ml-3 btn-link" href={`/admin/tenants/${t.id}`}>
                    Ver
                  </Link>
                  {t.status === 'ACTIVE' ? (
                    <button
                      onClick={() => setStatus(t.id, 'SUSPENDED')}
                      className="ml-3 text-bad underline text-xs"
                    >
                      Suspender
                    </button>
                  ) : (
                    <button
                      onClick={() => setStatus(t.id, 'ACTIVE')}
                      className="ml-3 text-ok underline text-xs"
                    >
                      Activar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
       </div>
      </div>
    </div>
  );
}
