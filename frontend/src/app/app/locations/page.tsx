'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';

export default function LocationsPage() {
  const [list, setList] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: '',
    address: '',
    latitude: 4.6097,
    longitude: -74.0817,
    radiusMeters: 300,
  });
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setList(await api('/locations'));
  }
  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api('/locations', { method: 'POST', body: JSON.stringify(form) });
      setForm({
        name: '',
        address: '',
        latitude: 4.6097,
        longitude: -74.0817,
        radiusMeters: 300,
      });
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function remove(id: string) {
    if (!confirm('¿Eliminar ubicación?')) return;
    await api(`/locations/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Ubicaciones <span className="page-crumb">/ {list.length} configuradas</span>
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <form onSubmit={create} className="card card-pad">
          <h2 className="text-base font-semibold m-0">Nueva ubicación</h2>
          <div className="mt-4">
            <label className="label">Nombre</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div className="mt-3">
            <label className="label">Dirección</label>
            <input
              className="input"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="label">Latitud</label>
              <input
                type="number"
                step="0.000001"
                className="input"
                value={form.latitude}
                onChange={(e) =>
                  setForm({ ...form, latitude: Number(e.target.value) })
                }
              />
            </div>
            <div>
              <label className="label">Longitud</label>
              <input
                type="number"
                step="0.000001"
                className="input"
                value={form.longitude}
                onChange={(e) =>
                  setForm({ ...form, longitude: Number(e.target.value) })
                }
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="label">Radio para notificación geo</label>
            <select
              className="input"
              value={form.radiusMeters}
              onChange={(e) =>
                setForm({ ...form, radiusMeters: Number(e.target.value) })
              }
            >
              <option value={100}>100 m</option>
              <option value={300}>300 m</option>
              <option value={500}>500 m</option>
            </select>
          </div>
          {err && (
            <div className="mt-3 rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink">
              {err}
            </div>
          )}
          <button className="btn-primary mt-4 w-full justify-center">
            <Icon name="plus" /> Agregar ubicación
          </button>
        </form>

        <div>
          <h2 className="text-base font-semibold m-0 mb-3">Tus ubicaciones</h2>
          <div className="space-y-2.5">
            {list.length === 0 && (
              <div className="card card-pad text-mute text-sm">
                Aún sin ubicaciones.
              </div>
            )}
            {list.map((l) => (
              <div
                key={l.id}
                className="card card-pad flex items-center justify-between"
              >
                <div className="flex items-start gap-3">
                  <div className="avatar w-9 h-9 avatar-3">
                    <Icon name="pin" size={16} />
                  </div>
                  <div>
                    <div className="font-medium">{l.name}</div>
                    <div className="text-xs text-mute">{l.address}</div>
                    <div className="text-xs text-mute mt-0.5">
                      {Number(l.latitude).toFixed(4)},{' '}
                      {Number(l.longitude).toFixed(4)} · radio {l.radiusMeters} m
                    </div>
                  </div>
                </div>
                <button
                  className="btn-danger"
                  onClick={() => remove(l.id)}
                  title="Eliminar"
                >
                  <Icon name="trash" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
