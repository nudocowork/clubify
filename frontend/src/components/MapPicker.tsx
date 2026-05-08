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
 * Map picker tipo Google Maps: mapa interactivo (Leaflet + OSM tiles) con
 * search en vivo (Photon) que dropea pins en el mapa para todos los
 * resultados. Click en un pin selecciona esa ubicación.
 *
 * Bonus: click en cualquier punto del mapa también lo selecciona (con
 * reverse geocoding via Nominatim para sacar la dirección).
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
  const markersGroup = useRef<L.LayerGroup | null>(null);
  const pickedMarker = useRef<L.Marker | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  // Cuando hay un picked, mostramos su nombre/dirección en el input
  // (en vez del término de búsqueda). Se vuelve editable solo al focus.
  const [editingQuery, setEditingQuery] = useState(false);
  const inputValue = editingQuery
    ? query
    : picked
    ? [picked.name, picked.address].filter(Boolean).join(' · ')
    : query;

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Fix default Leaflet icon paths (Webpack/Next break them)
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

    markersGroup.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // Click en mapa = reverse geocode + select
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

  // Cuando cambia el picked, mover el mapa al punto y poner marker
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
  }, [picked]);

  // Debounced Photon search → drop pins for each result
  useEffect(() => {
    if (query.length < 2) {
      markersGroup.current?.clearLayers();
      return;
    }
    const id = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lang=es&limit=10`,
        );
        const data = await r.json();
        const features = (data.features || []) as any[];

        markersGroup.current?.clearLayers();
        if (features.length === 0) return;

        const bounds = L.latLngBounds([]);
        features.forEach((f) => {
          const lon = f.geometry?.coordinates?.[0];
          const lat = f.geometry?.coordinates?.[1];
          if (typeof lat !== 'number' || typeof lon !== 'number') return;
          const s: Suggestion = {
            name: f.properties?.name ?? '',
            street: f.properties?.street,
            housenumber: f.properties?.housenumber,
            city: f.properties?.city ?? f.properties?.locality,
            state: f.properties?.state,
            country: f.properties?.country,
            lat,
            lon,
          };
          const addr = fmtAddress(s);
          const marker = L.marker([lat, lon], {
            icon: brandIcon('#7C3AED', '📍'),
          });
          const label = (s.name || addr || 'Sin nombre').replace(/'/g, '&apos;');
          marker.bindTooltip(label, {
            permanent: false,
            direction: 'top',
            offset: [0, -10],
          });
          marker.on('click', () => {
            onPick({
              name: s.name || addr.split(',')[0] || 'Punto',
              address: addr || s.name,
              lat,
              lng: lon,
            });
          });
          marker.addTo(markersGroup.current!);
          bounds.extend([lat, lon]);
        });

        if (mapRef.current && bounds.isValid()) {
          mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
        }
      } catch {
        // silencioso
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [query, onPick]);

  return (
    <div className="relative" style={{ height }}>
      {/* Search box overlay arriba */}
      <div className="absolute top-3 left-3 right-3 z-[400]">
        <div className="relative bg-white rounded-full shadow-lg border border-line">
          <input
            className={`w-full pl-5 pr-11 py-3 rounded-full bg-transparent outline-none text-sm ${
              !editingQuery && picked ? 'font-semibold' : ''
            }`}
            placeholder="Buscá tu negocio o dirección…"
            value={inputValue}
            onFocus={() => {
              setEditingQuery(true);
              if (picked && query === '') {
                // empezar buscando con el nombre del picked
                setQuery(picked.name || '');
              }
            }}
            onBlur={() => setEditingQuery(false)}
            onChange={(e) => {
              setEditingQuery(true);
              setQuery(e.target.value);
            }}
          />
          <div className="absolute right-4 top-1/2 -translate-y-1/2 text-mute">
            {searching ? (
              <span className="inline-block w-4 h-4 border-2 border-mute border-t-transparent rounded-full animate-spin" />
            ) : picked && !editingQuery ? (
              <span className="text-ok text-base">✓</span>
            ) : (
              '🔍'
            )}
          </div>
        </div>
        {!picked && (
          <p className="text-[11px] text-white/90 mt-1.5 text-center drop-shadow-md">
            Click en cualquier pin morado · o click en mapa para coordenadas exactas
          </p>
        )}
      </div>

      {/* Card flotante con dirección del pick (abajo del mapa) */}
      {picked && (
        <div className="absolute bottom-3 left-3 right-3 z-[400] pointer-events-none">
          <div className="bg-white rounded-2xl shadow-lg border border-line px-4 py-3 flex items-start gap-3 pointer-events-auto">
            <div className="w-9 h-9 rounded-full bg-ok-soft text-ok-ink flex items-center justify-center text-base shrink-0">
              ✓
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">
                {picked.name || 'Punto seleccionado'}
              </div>
              <div className="text-xs text-mute mt-0.5 line-clamp-2 leading-snug">
                {picked.address}
              </div>
              <div className="text-[10px] text-mute mt-0.5">
                {picked.lat.toFixed(5)}, {picked.lng.toFixed(5)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mapa */}
      <div ref={containerRef} className="absolute inset-0 rounded-input overflow-hidden border border-line" />
    </div>
  );
}

/**
 * DivIcon de Leaflet con un círculo de color y un emoji adentro — estilo
 * "Grow Business" del screenshot.
 */
function brandIcon(color: string, emoji: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: ${color};
      box-shadow: 0 4px 10px rgba(0,0,0,0.3);
      border: 2px solid white;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 16px;
    ">${emoji}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}
