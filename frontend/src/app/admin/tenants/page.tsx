'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';

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
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'ALL' | 'ACTIVE' | 'TRIAL' | 'SUSPENDED'>('ALL');

  async function load() {
    setLoading(true);
    try {
      setList(await api('/tenants'));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function setStatus(id: string, status: string) {
    await api(`/tenants/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    load();
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
        <table className="w-full text-[13.5px]">
          <thead className="bg-bg2">
            <tr>
              {['Negocio', 'Email', 'Plan', 'Estado', 'Tarjetas', 'Clientes', ''].map(
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
            {loading && (
              <tr>
                <td className="px-4 py-6 text-center text-mute" colSpan={7}>
                  Cargando…
                </td>
              </tr>
            )}
            {!loading && visible.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-mute" colSpan={7}>
                  Sin negocios.
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
                      <div className="text-mute text-xs">{t.slug}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5 text-mute">{t.email}</td>
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
                <td className="px-4 py-3.5">{t._count?.cards ?? 0}</td>
                <td className="px-4 py-3.5">{t._count?.customers ?? 0}</td>
                <td className="px-4 py-3.5 text-right">
                  <Link className="btn-link" href={`/admin/tenants/${t.id}`}>
                    Editar
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
  );
}
