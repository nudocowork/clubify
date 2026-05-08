'use client';
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type MapPickResult = {
  name: string;
  address: string;
  lat: number;
  lng: number;
};

type Suggestion = {
  name: string;
  street?: string;
  housenumber?: string;
  city?: string;
  state?: string;
  country?: string;
  lat: number;
  lon: number;
};

function fmtAddress(s: Suggestion): string {
  const parts: string[] = [];
  if (s.street) parts.push(s.housenumber ? `${s.street} ${s.housenumber}` : s.street);
  if (s.city) parts.push(s.city);
  if (s.state && s.state !== s.city) parts.push(s.state);
  if (s.country) parts.push(s.country);
  return parts.join(', ');
}

/**
 * Map picker estilo Google Places Autocomplete:
 *
 * 1. Input arriba — el usuario escribe la dirección
 * 2. A medida que tipea, dropdown debajo del input lista resultados
 *    (texto: nombre + dirección completa formateada)
 * 3. Click en una sugerencia → mapa abajo se mueve al punto y dropea pin
 * 4. Click en cualquier punto del mapa también selecciona (reverse geocoding)
 *
 * Search vía Photon (Komoot · OSM, free).
 * Mapa via Leaflet + tiles OpenStreetMap.
 */
export function MapPicker({
  initialLat = 4.6097,
  initialLng = -74.0817,
  initialZoom = 13,
  height = 440,
  onPick,
  picked,
}: {
  initialLat?: number;
  initialLng?: number;
  initialZoom?: number;
  height?: number;
  onPick: (r: MapPickResult) => void;
  picked: MapPickResult | null;
}) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pickedMarker = useRef<L.Marker | null>(null);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Init Leaflet map una sola vez
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
    }).setView([initialLat, initialLng], initialZoom);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;

    // Click directo en el mapa → reverse geocode + select
    map.on('click', async (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
        );
        const d = await r.json();
        const name = d?.name || d?.address?.road || 'Punto seleccionado';
        const address = d?.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        onPick({ name, address, lat, lng });
      } catch {
        onPick({
          name: 'Punto seleccionado',
          address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          lat,
          lng,
        });
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cuando cambia el picked: animar al punto + actualizar marker
  useEffect(() => {
    if (!mapRef.current || !picked) return;
    mapRef.current.setView([picked.lat, picked.lng], 16, { animate: true });
    if (pickedMarker.current) {
      pickedMarker.current.setLatLng([picked.lat, picked.lng]);
    } else {
      pickedMarker.current = L.marker([picked.lat, picked.lng], {
        icon: brandIcon('#22C55E', '✓'),
      }).addTo(mapRef.current);
    }
    // Cuando hay pick, cerrar dropdown
    setShowDropdown(false);
  }, [picked]);

  // Debounced Photon autocomplete (200ms, 2 chars min)
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
        const results: Suggestion[] = (data.features || [])
          .map((f: any) => {
            const lon = f.geometry?.coordinates?.[0];
            const lat = f.geometry?.coordinates?.[1];
            if (typeof lat !== 'number' || typeof lon !== 'number') return null;
            return {
              name: f.properties?.name ?? '',
              street: f.properties?.street,
              housenumber: f.properties?.housenumber,
              city: f.properties?.city ?? f.properties?.locality,
              state: f.properties?.state,
              country: f.properties?.country,
              lat,
              lon,
            } as Suggestion;
          })
          .filter(Boolean);
        setSuggestions(results);
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(id);
  }, [query]);

  function selectSuggestion(s: Suggestion) {
    const addr = fmtAddress(s);
    onPick({
      name: s.name || addr.split(',')[0] || 'Punto',
      address: addr || s.name,
      lat: s.lat,
      lng: s.lon,
    });
    setQuery('');
    setSuggestions([]);
  }

  return (
    <div>
      {/* INPUT con autocomplete dropdown */}
      <div className="relative">
        <input
          className="input w-full pr-10"
          placeholder="Escribí la dirección de tu negocio…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => {
            // dejar 200ms para que el click en una sugerencia se registre
            setTimeout(() => setShowDropdown(false), 200);
          }}
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-mute pointer-events-none">
          {searching ? (
            <span className="inline-block w-4 h-4 border-2 border-mute border-t-transparent rounded-full animate-spin" />
          ) : (
            '🔍'
          )}
        </div>

        {showDropdown && suggestions.length > 0 && (
          <div className="absolute z-[500] left-0 right-0 mt-1 bg-white border border-line rounded-lg shadow-xl max-h-72 overflow-y-auto">
            {suggestions.map((s, i) => {
              const addr = fmtAddress(s);
              return (
                <button
                  key={i}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()} // evita que el blur cierre antes del click
                  onClick={() => selectSuggestion(s)}
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

        {showDropdown && query.length >= 2 && !searching && suggestions.length === 0 && (
          <div className="absolute z-[500] left-0 right-0 mt-1 bg-white border border-line rounded-lg shadow-xl px-3 py-3 text-xs text-mute text-center">
            Sin resultados. Probá con otro término o haz click directo en el mapa.
          </div>
        )}
      </div>

      <p className="text-[11px] text-mute mt-1.5 mb-2">
        Tipea para autocompletar · o haz click directo en cualquier punto del mapa abajo
      </p>

      {/* MAPA debajo */}
      <div
        ref={containerRef}
        className="relative rounded-input overflow-hidden border border-line"
        style={{ height, cursor: 'crosshair' }}
      />

      {/* Card resumen del pick */}
      {picked && (
        <div className="mt-2 bg-ok-soft border border-ok/20 rounded-xl px-3 py-2.5 flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-ok text-white flex items-center justify-center text-base shrink-0">
            ✓
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">{picked.name}</div>
            <div className="text-xs text-ok-ink/80 mt-0.5 line-clamp-2 leading-snug">
              {picked.address}
            </div>
            <div className="text-[10px] text-mute mt-0.5">
              {picked.lat.toFixed(5)}, {picked.lng.toFixed(5)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function brandIcon(color: string, emoji: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: ${color};
      box-shadow: 0 4px 10px rgba(0,0,0,0.3);
      border: 3px solid white;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 18px;
    ">${emoji}</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}
