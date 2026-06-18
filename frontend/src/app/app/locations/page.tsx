'use client';
import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { EmojiPicker } from '@/components/EmojiPicker';
import type { MapPickResult } from '@/components/MapPicker';

// Leaflet usa `window` al importar — dynamic import sin SSR
const MapPicker = dynamic(
  () => import('@/components/MapPicker').then((m) => m.MapPicker),
  { ssr: false, loading: () => <div className="h-[440px] rounded-input bg-bg2 animate-shimmer" /> },
);

type Suggestion = {
  name: string;
  street?: string;
  housenumber?: string;
  city?: string;
  state?: string;
  country?: string;
  lat: number;
  lon: number;
  /** Tipo OSM: house, street, locality, etc. */
  osm_value?: string;
};

export default function LocationsPage() {
  const [list, setList] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: '',
    address: '',
    latitude: 4.6097,
    longitude: -74.0817,
    radiusMeters: 300,
    walletRelevantText: '',
    mapsUrl: '',
    adminName: '',
    adminPhone: '',
  });
  const [picked, setPicked] = useState<MapPickResult | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handlePick = useCallback((r: MapPickResult) => {
    setPicked(r);
    setForm((f) => ({
      ...f,
      latitude: r.lat,
      longitude: r.lng,
      address: r.address,
      name: f.name || r.name || r.address.split(',')[0] || 'Local',
    }));
  }, []);

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
    if (!picked) {
      setErr('Busca tu negocio en el mapa primero');
      return;
    }
    try {
      await api('/locations', { method: 'POST', body: JSON.stringify(form) });
      setForm({
        name: '',
        address: '',
        latitude: 4.6097,
        longitude: -74.0817,
        radiusMeters: 300,
        walletRelevantText: '',
        mapsUrl: '',
        adminName: '',
        adminPhone: '',
      });
      setPicked(null);
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

          {/* Map picker estilo Google Maps */}
          <div className="mt-4">
            <label className="label">📍 Encontrá tu negocio en el mapa</label>
            <MapPicker
              picked={picked}
              onPick={handlePick}
              height={400}
            />
          </div>

          {picked && (
            <>
              <div className="mt-3">
                <label className="label">Nombre del local</label>
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

              <div className="mt-3">
                <label className="label">Link de Google Maps (exacto, opcional)</label>
                <input
                  className="input"
                  value={form.mapsUrl}
                  onChange={(e) => setForm({ ...form, mapsUrl: e.target.value })}
                  placeholder="https://maps.app.goo.gl/…"
                />
                <p className="text-[11px] text-mute mt-1 leading-snug">
                  Compartir → Copiar enlace en Google Maps. Hace que los botones
                  “Dirección” abran exactamente esta sede.
                </p>
              </div>

              {/* #3: administrador de sede — recibe las alertas de reseña
                  negativa de esta sede en vez del administrador general. */}
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Administrador de sede (opcional)</label>
                  <input
                    className="input"
                    value={form.adminName}
                    onChange={(e) => setForm({ ...form, adminName: e.target.value })}
                    placeholder="Nombre"
                  />
                </div>
                <div>
                  <label className="label">Teléfono del administrador</label>
                  <input
                    className="input"
                    value={form.adminPhone}
                    onChange={(e) => setForm({ ...form, adminPhone: e.target.value })}
                    placeholder="+52 1 55 1234 5678"
                  />
                </div>
                <p className="text-[11px] text-mute -mt-1 col-span-2 leading-snug">
                  Si una reseña queda por debajo de tu umbral, la alerta se envía
                  a este teléfono (de la sede) en vez del general del negocio.
                </p>
              </div>

              {/* Lat/lng manual (avanzado, colapsado) */}
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="text-[11px] text-mute hover:text-ink mt-3"
              >
                {showAdvanced ? '▲' : '▼'} Coordenadas exactas (avanzado)
              </button>
              {showAdvanced && (
                <div className="mt-2 grid grid-cols-2 gap-3">
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
              )}
            </>
          )}

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
              <option value={300}>⭐ Recomendado: 300 m</option>
            </select>
            <p className="text-[11px] text-mute mt-1 leading-relaxed">
              Apple Wallet muestra la tarjeta del cliente en el lock screen
              cuando esté a esta distancia o menos del local.
            </p>
          </div>
          <div className="mt-3">
            <label className="label">📱 Texto del push wallet</label>
            <div className="flex items-stretch gap-2">
              <input
                className="input flex-1"
                placeholder="Estás cerca de nuestro local · ¡pasa a sellar!"
                value={form.walletRelevantText}
                onChange={(e) =>
                  setForm({ ...form, walletRelevantText: e.target.value })
                }
                maxLength={120}
              />
              <EmojiPicker
                onSelect={(emoji) =>
                  setForm((f) => ({
                    ...f,
                    walletRelevantText: (f.walletRelevantText || '') + emoji,
                  }))
                }
                size="sm"
                placeholder="Agregar emoji"
              />
            </div>
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
          <button
            className="btn-primary mt-4 w-full justify-center"
            disabled={!picked}
            title={!picked ? 'Busca tu negocio primero' : ''}
          >
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
              <LocationCard
                key={l.id}
                loc={l}
                onRemove={() => remove(l.id)}
                onSaved={load}
              />
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
  onSaved,
}: {
  loc: any;
  onRemove: () => void;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
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
          <button
            onClick={() => setEditing(true)}
            className="btn-ghost text-xs"
            title="Editar dirección, radio y mensaje"
          >
            <Icon name="edit" /> Editar
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
      {editing && (
        <EditLocationModal
          loc={loc}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onSaved();
          }}
        />
      )}
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

// ─── Modal de edición de ubicación / GeoPush ───
function EditLocationModal({
  loc,
  onClose,
  onSaved,
}: {
  loc: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: loc.name ?? '',
    address: loc.address ?? '',
    latitude: Number(loc.latitude),
    longitude: Number(loc.longitude),
    radiusMeters: Number(loc.radiusMeters ?? 300),
    walletRelevantText: loc.walletRelevantText ?? '',
    mapsUrl: loc.mapsUrl ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      await api(`/locations/${loc.id}`, {
        method: 'PATCH',
        body: JSON.stringify(form),
      });
      toast('Ubicación actualizada', 'success');
      onSaved();
    } catch (e: any) {
      setErr(e.message || 'Error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={save}
        className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5 space-y-3 max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-base m-0">📍 Editar ubicación</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-mute hover:text-ink text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div>
          <label className="label">Nombre del local</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>

        <div>
          <label className="label">Dirección</label>
          <input
            className="input"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="Calle 123 #45-67, Bogotá"
          />
        </div>

        <div>
          <label className="label">Link de Google Maps (exacto)</label>
          <input
            className="input"
            value={form.mapsUrl}
            onChange={(e) => setForm({ ...form, mapsUrl: e.target.value })}
            placeholder="https://maps.app.goo.gl/…"
          />
          <p className="text-[11px] text-mute mt-1 leading-snug">
            Pegá el link del lugar exacto desde Google Maps (botón Compartir →
            Copiar enlace). Si lo cargás, los botones “Dirección” abren
            exactamente esta sede en vez de una búsqueda aproximada.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
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

        <div>
          <label className="label">Radio de geolocalización</label>
          <select
            className="input"
            value={form.radiusMeters}
            onChange={(e) =>
              setForm({ ...form, radiusMeters: Number(e.target.value) })
            }
          >
            <option value={100}>100 m</option>
            <option value={300}>⭐ Recomendado: 300 m</option>
          </select>
        </div>

        <div>
          <label className="label">📱 Texto del push wallet (GeoPush)</label>
          <input
            className="input"
            placeholder="Estás cerca de nuestro local · ¡pasa a sellar!"
            value={form.walletRelevantText}
            onChange={(e) =>
              setForm({ ...form, walletRelevantText: e.target.value })
            }
            maxLength={120}
          />
          <p className="text-[11px] text-mute mt-1 leading-snug">
            Aparece en el lock screen del iPhone cuando el cliente entra al
            radio. Vacío = "Estás cerca de [tu marca]" por default.
          </p>
        </div>

        {err && (
          <div className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad-ink">
            {err}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button type="submit" className="btn-primary flex-1" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
