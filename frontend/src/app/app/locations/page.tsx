'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

export default function LocationsPage() {
  const [list, setList] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: '',
    address: '',
    latitude: 4.6097,
    longitude: -74.0817,
    radiusMeters: 300,
    walletRelevantText: '',
  });
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      setList(await api('/locations'));
    } catch (e: any) {
      toast(e.message || 'Error cargando ubicaciones', 'error');
    }
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
        walletRelevantText: '',
      });
      load();
      toast('Ubicación agregada', 'success');
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function remove(id: string) {
    if (!confirm('¿Eliminar ubicación?')) return;
    try {
      await api(`/locations/${id}`, { method: 'DELETE' });
      load();
      toast('Ubicación eliminada', 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo eliminar', 'error');
    }
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
            <label className="label">Radio de geolocalización</label>
            <select
              className="input"
              value={form.radiusMeters}
              onChange={(e) =>
                setForm({ ...form, radiusMeters: Number(e.target.value) })
              }
            >
              <option value={100}>100 m</option>
              <option value={300}>300 m (recomendado)</option>
              <option value={500}>500 m</option>
              <option value={1000}>1 km</option>
            </select>
            <p className="text-[11px] text-mute mt-1 leading-relaxed">
              Apple Wallet muestra la tarjeta del cliente en el lock screen
              cuando esté a esta distancia o menos del local.
            </p>
          </div>
          <div className="mt-3">
            <label className="label">📱 Texto del push wallet</label>
            <input
              className="input"
              placeholder="Estás cerca de nuestro local · ¡pasa a sellar!"
              value={form.walletRelevantText}
              onChange={(e) =>
                setForm({ ...form, walletRelevantText: e.target.value })
              }
              maxLength={120}
            />
            <p className="text-[11px] text-mute mt-1 leading-relaxed">
              Mensaje que aparece en el lock screen del iPhone cuando el
              cliente entra al radio. Si lo dejas vacío, usa "Estás cerca
              de [tu marca]".
            </p>
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
              <div className="card card-pad text-center py-8">
                <div className="text-3xl mb-1">📍</div>
                <div className="font-semibold text-sm">Aún sin ubicaciones</div>
                <p className="text-xs text-mute mt-1 max-w-md mx-auto">
                  Agrega tus locales para activar notificaciones por geo
                  (cuando un cliente pase cerca, recibe un push).
                </p>
              </div>
            )}
            {list.map((l) => (
              <LocationCard key={l.id} loc={l} onRemove={() => remove(l.id)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LocationCard({
  loc,
  onRemove,
}: {
  loc: any;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const lat = Number(loc.latitude);
  const lng = Number(loc.longitude);
  // BBox aproximado para que el zoom sea razonable según el radio (300m → ~0.005°)
  const radius = Number(loc.radiusMeters ?? 300);
  const delta = Math.max(0.003, radius / 100000); // ~degrees
  const bbox = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;
  const embedSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
  const externalLink = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;

  return (
    <div className="card overflow-hidden">
      <div className="card-pad flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="avatar w-9 h-9 avatar-3">
            <Icon name="pin" size={16} />
          </div>
          <div className="min-w-0">
            <div className="font-medium truncate">{loc.name}</div>
            <div className="text-xs text-mute truncate">{loc.address}</div>
            <div className="text-xs text-mute mt-0.5">
              {lat.toFixed(4)}, {lng.toFixed(4)} · radio {radius} m
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setOpen((v) => !v)}
            className="btn-ghost text-xs"
            title="Mostrar en mapa"
          >
            🗺 {open ? 'Ocultar' : 'Ver'} mapa
          </button>
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost text-xs"
            title="Cómo llegar"
          >
            🧭 Ir
          </a>
          <button
            className="btn-danger"
            onClick={onRemove}
            title="Eliminar"
          >
            <Icon name="trash" />
          </button>
        </div>
      </div>
      {open && (
        <div className="border-t border-line2">
          <iframe
            src={embedSrc}
            title={`Mapa ${loc.name}`}
            className="w-full"
            style={{ height: 280, border: 0 }}
            loading="lazy"
          />
          <div className="px-3 py-2 text-[10px] text-mute text-right border-t border-line2">
            <a
              href={externalLink}
              target="_blank"
              rel="noreferrer"
              className="text-brand hover:underline"
            >
              Abrir en OpenStreetMap →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
