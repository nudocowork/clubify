'use client';
import { useEffect, useRef, useState } from 'react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';

export type MapPickResult = {
  name: string;
  address: string;
  lat: number;
  lng: number;
};

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

let loaderPromise: Promise<typeof google> | null = null;
let optionsSet = false;

function loadGoogleMaps(): Promise<typeof google> {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'));
  if (loaderPromise) return loaderPromise;
  if (!API_KEY) return Promise.reject(new Error('Falta NEXT_PUBLIC_GOOGLE_MAPS_API_KEY'));
  if (!optionsSet) {
    setOptions({ key: API_KEY, v: 'weekly', language: 'es' });
    optionsSet = true;
  }
  loaderPromise = (async () => {
    await importLibrary('maps');
    await importLibrary('places');
    return (window as any).google as typeof google;
  })();
  return loaderPromise;
}

/**
 * Map picker con Google Maps + Places Autocomplete:
 *
 * 1. Input arriba — Google Places Autocomplete bindea su dropdown nativo
 *    automáticamente (mismo UX que cualquier sitio que usa Google Places)
 * 2. Al elegir una sugerencia, se mueve el mapa y aparece el marker
 * 3. Click directo en el mapa → reverse geocode y selecciona ese punto
 *
 * Requiere NEXT_PUBLIC_GOOGLE_MAPS_API_KEY en el env del frontend.
 * Habilitar en Google Cloud: Maps JavaScript API + Places API.
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.marker.AdvancedMarkerElement | google.maps.Marker | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Inicializa Maps + Autocomplete una sola vez
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const g = await loadGoogleMaps();
        if (cancelled || !containerRef.current) return;

        const map = new g.maps.Map(containerRef.current, {
          center: { lat: initialLat, lng: initialLng },
          zoom: initialZoom,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          // mapId requerido para AdvancedMarkerElement; sin él usamos Marker clásico
        });
        mapRef.current = map;
        geocoderRef.current = new g.maps.Geocoder();

        // Click en mapa → reverse geocode
        map.addListener('click', async (e: google.maps.MapMouseEvent) => {
          const ll = e.latLng;
          if (!ll) return;
          const lat = ll.lat();
          const lng = ll.lng();
          try {
            const res = await geocoderRef.current!.geocode({ location: { lat, lng } });
            const r = res.results?.[0];
            onPickRef.current({
              name: r?.address_components?.[0]?.long_name ?? 'Punto seleccionado',
              address: r?.formatted_address ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
              lat,
              lng,
            });
          } catch {
            onPickRef.current({
              name: 'Punto seleccionado',
              address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
              lat,
              lng,
            });
          }
        });

        // Bindea Autocomplete al input
        if (inputRef.current) {
          const ac = new g.maps.places.Autocomplete(inputRef.current, {
            fields: ['name', 'formatted_address', 'geometry'],
            // sin types limitados: deja que Google sugiera lo que sea
          });
          // Cuando el usuario selecciona algo del dropdown:
          ac.addListener('place_changed', () => {
            const place = ac.getPlace();
            const loc = place.geometry?.location;
            if (!loc) return;
            const lat = loc.lat();
            const lng = loc.lng();
            onPickRef.current({
              name: place.name ?? place.formatted_address?.split(',')[0] ?? 'Punto',
              address: place.formatted_address ?? '',
              lat,
              lng,
            });
          });
        }

        setReady(true);
      } catch (e: any) {
        setLoadErr(e?.message ?? 'Error cargando Google Maps');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialLat, initialLng, initialZoom]);

  // Cuando cambia el picked → mover mapa + marker
  useEffect(() => {
    if (!ready || !mapRef.current || !picked) return;
    const map = mapRef.current;
    const pos = { lat: picked.lat, lng: picked.lng };
    map.panTo(pos);
    map.setZoom(16);
    if (markerRef.current) {
      (markerRef.current as google.maps.Marker).setPosition(pos);
    } else {
      markerRef.current = new google.maps.Marker({
        position: pos,
        map,
        animation: google.maps.Animation.DROP,
      });
    }
  }, [picked, ready]);

  if (loadErr) {
    return (
      <div className="rounded-input border border-line bg-amber-50 p-4 text-sm text-amber-900 leading-relaxed">
        <div className="font-semibold mb-1">Google Maps no está configurado</div>
        <div>{loadErr}</div>
        <div className="text-xs mt-2 text-amber-800/80">
          Necesitás definir{' '}
          <code className="bg-amber-100 px-1 rounded">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>{' '}
          en el frontend con una API key con Maps JavaScript API + Places API
          habilitadas.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <input
          ref={inputRef}
          className="input w-full pr-10"
          placeholder="Escribe la dirección o nombre del negocio…"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-mute pointer-events-none">
          🔍
        </span>
      </div>
      <p className="text-[11px] text-mute mt-1.5 mb-2">
        Powered by Google Places · o da clic directo en el mapa
      </p>
      <div
        ref={containerRef}
        className="rounded-input overflow-hidden border border-line bg-bg2"
        style={{ height }}
      />
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
