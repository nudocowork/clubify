'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

/**
 * Resultado de Photon (Komoot). Photon está construido sobre OSM pero
 * con autocomplete optimizado para escritura en vivo — funciona mejor que
 * Nominatim para nombres de negocios y direcciones parciales.
 *
 * https://photon.komoot.io/api/?q=…
 */
type Suggestion = {
  /** Nombre principal — restaurante, plaza, marca, calle */
  name: string;
  /** Address line: ej. "Cra 7 #45-12" */
  street?: string;
  housenumber?: string;
  city?: string;
  state?: string;
  country?: string;
  /** [lon, lat] */
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
  });
  const [picked, setPicked] = useState(false); // true cuando hay un punto válido elegido
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Debounced Photon autocomplete — 200ms, 2 chars min
  useEffect(() => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    const id = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lang=es&limit=8`,
        );
        const data = await r.json();
        setSuggestions(
          (data.features || []).map((f: any) => ({
            name: f.properties?.name ?? '',
            street: f.properties?.street,
            housenumber: f.properties?.housenumber,
            city: f.properties?.city ?? f.properties?.locality,
            state: f.properties?.state,
            country: f.properties?.country,
            osm_value: f.properties?.osm_value,
            lon: f.geometry?.coordinates?.[0],
            lat: f.geometry?.coordinates?.[1],
          })),
        );
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(id);
  }, [query]);

  function formatAddress(s: Suggestion): string {
    const parts: string[] = [];
    if (s.street) {
      parts.push(s.housenumber ? `${s.street} ${s.housenumber}` : s.street);
    }
    if (s.city) parts.push(s.city);
    if (s.state && s.state !== s.city) parts.push(s.state);
    if (s.country) parts.push(s.country);
    return parts.join(', ');
  }

  function pickSuggestion(s: Suggestion) {
    const fullAddress = [s.name, formatAddress(s)].filter(Boolean).join(' · ');
    setForm((f) => ({
      ...f,
      latitude: s.lat,
      longitude: s.lon,
      address: formatAddress(s) || s.name || '',
      // Auto-fill name si está vacío
      name: f.name || s.name || formatAddress(s).split(',')[0],
    }));
    setPicked(true);
    setSuggestions([]);
    setQuery(fullAddress.slice(0, 80));
  }

  /** Permite al usuario pegar coordenadas crudas (lat, lng) de Google Maps. */
  function pasteCoords(raw: string) {
    const m = raw.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
    if (!m) {
      toast('Formato esperado: lat, lng (ej: 4.6097, -74.0817)', 'error');
      return;
    }
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    setForm((f) => ({ ...f, latitude: lat, longitude: lng }));
    setPicked(true);
    toast('Coordenadas pegadas — completá el nombre arriba', 'success');
  }

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
      setErr('Buscá tu negocio en el mapa primero');
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
      });
      setPicked(false);
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

          {/* 🔍 Buscador estilo Google Maps */}
          <div className="mt-4">
            <label className="label">🔍 Buscar tu negocio en el mapa</label>
            <div className="relative">
              <input
                className="input w-full"
                placeholder="Ej: Café del Día, Cra 7 #45-12 Bogotá"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {searching && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-mute text-xs">
                  buscando…
                </div>
              )}
              {suggestions.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-line rounded-lg shadow-lg max-h-72 overflow-y-auto">
                  {suggestions.map((s, i) => {
                    const addr = formatAddress(s);
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => pickSuggestion(s)}
                        className="block w-full text-left px-3 py-2.5 hover:bg-bg2 border-b border-line2 last:border-0"
                      >
                        <div className="text-sm font-semibold flex items-start gap-2">
                          <span className="text-base shrink-0">📍</span>
                          <span className="flex-1">{s.name || addr || 'Sin nombre'}</span>
                        </div>
                        {addr && s.name !== addr && (
                          <div className="text-xs text-mute mt-0.5 ml-6 line-clamp-1">
                            {addr}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 mt-1.5 flex-wrap">
              <p className="text-[11px] text-mute">
                Tipea cualquier cosa — nombre, calle, barrio, ciudad. Resultados en vivo.
              </p>
              <button
                type="button"
                onClick={() => {
                  const raw = prompt(
                    'Pegá las coordenadas de Google Maps (lat, lng):\n\n' +
                      'Cómo obtenerlas: en Google Maps, click derecho en tu local → ' +
                      'aparecen las coordenadas en la parte superior, click para copiarlas.',
                  );
                  if (raw) pasteCoords(raw);
                }}
                className="text-[11px] text-brand hover:underline"
              >
                ¿No lo encuentras? Pegar coordenadas
              </button>
            </div>
          </div>

          {picked && (
            <>
              {/* Mapa preview */}
              <div className="mt-3">
                <iframe
                  title="Mapa"
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${form.longitude - 0.005},${form.latitude - 0.003},${form.longitude + 0.005},${form.latitude + 0.003}&layer=mapnik&marker=${form.latitude},${form.longitude}`}
                  className="w-full h-56 rounded-input border border-line"
                  loading="lazy"
                />
              </div>

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
          <button
            className="btn-primary mt-4 w-full justify-center"
            disabled={!picked}
            title={!picked ? 'Buscá tu negocio primero' : ''}
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
