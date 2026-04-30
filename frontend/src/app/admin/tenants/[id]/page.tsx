'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function TenantDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [t, setT] = useState<any>(null);
  const [extraLocations, setExtraLocations] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setT(await api(`/tenants/${id}`));
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
      load();
    } finally {
      setSaving(false);
    }
  }

  if (!t) return <div className="text-mute">Cargando…</div>;

  return (
    <div className="max-w-3xl">
      <div className="page-head">
        <h1 className="page-title">
          {t.brandName} <span className="page-crumb">/ Negocios</span>
        </h1>
        <button className="btn-ghost" onClick={() => router.push('/admin/tenants')}>
          ← Volver
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3.5 mb-4">
        <div className="kpi">
          <div className="kpi-lbl">Plan</div>
          <div className="kpi-val text-brand">{t.plan?.name}</div>
        </div>
        <div className="kpi">
          <div className="kpi-lbl">Estado</div>
          <div className="kpi-val">{t.status}</div>
        </div>
        <div className="kpi">
          <div className="kpi-lbl">Pases emitidos</div>
          <div className="kpi-val">{t._count?.passes ?? 0}</div>
        </div>
      </div>

      <div className="card card-pad">
        <h2 className="text-base font-semibold m-0">Límite de ubicaciones</h2>
        <p className="mt-1 text-sm text-mute">
          Plan permite <strong>{t.plan?.maxLocations}</strong>. Override actual:{' '}
          <strong>{t.maxLocationsOverride ?? '—'}</strong>
        </p>
        <div className="mt-4 flex items-end gap-3">
          <div className="flex-1">
            <label className="label">Override de ubicaciones</label>
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
    </div>
  );
}
