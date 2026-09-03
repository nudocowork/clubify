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
const MAP_API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

/** Resuelve la API key de Google Maps POR MARCA (branding-by-host), igual que
 *  el mapa del SuperAdmin (admin/map). Si el host es de una marca blanca con su
 *  propia `WhiteLabel.mapsApiKey`, la usa; si no (o es host Clubify), cae a la
 *  key global del env. Así una marca (ej. Sellea) puede traer SU key restringida
 *  a su dominio sin depender de la allowlist de la key global. Si el mapa no
 *  carga y la marca NO tiene key propia, revisar los referrers HTTP de la key
 *  global en Google Cloud (RefererNotAllowedMapError = falta el dominio). */
async function resolveMapsKey(): Promise<string> {
  if (typeof window === 'undefined') return API_KEY;
  const host = (window.location.host || '').toLowerCase().split(':')[0];
  const isClubify =
    !host || host === 'localhost' || host.startsWith('127.') ||
    host.endsWith('soyclubify.com') || host.endsWith('clubify.app');
  if (!isClubify) {
    try {
      const r = await fetch(
        `${MAP_API}/api/superadmin-public/white-labels/branding-by-host?host=${encodeURIComponent(host)}`,
      );
      if (r.ok) {
        const d = await r.json();
        if (d?.mapsApiKey) return d.mapsApiKey as string;
      }
    } catch {
      /* cae a la env global */
    }
  }
  return API_KEY;
}

let loaderPromise: Promise<typeof google> | null = null;
let optionsSet = false;

function loadGoogleMaps(key: string): Promise<typeof google> {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'));
  if (loaderPromise) return loaderPromise;
  if (!key) return Promise.reject(new Error('Falta la API key de Google Maps de la marca'));
  if (!optionsSet) {
    setOptions({ key, v: 'weekly', language: 'es' });
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

  // Fallback manual: si el mapa no carga (key sin cuota, dominio fuera de la
  // allowlist, red del cliente), el usuario igual puede guardar su ubicación
  // ingresando dirección + coordenadas a mano. Nunca lo dejamos sin camino.
  const [manualOpen, setManualOpen] = useState(false);
  const [mAddr, setMAddr] = useState(picked?.address ?? '');
  const [mLat, setMLat] = useState(picked ? String(picked.lat) : '');
  const [mLng, setMLng] = useState(picked ? String(picked.lng) : '');
  function submitManual() {
    const lat = Number(mLat);
    const lng = Number(mLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      alert('Coordenadas inválidas. La latitud va de -90 a 90 y la longitud de -180 a 180.');
      return;
    }
    onPickRef.current({
      name: mAddr.trim() ? mAddr.trim().split(',')[0] : 'Ubicación manual',
      address: mAddr.trim() || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      lat,
      lng,
    });
  }

  // Inicializa Maps + Autocomplete una sola vez
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const key = await resolveMapsKey();
        const g = await loadGoogleMaps(key);
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
        // Log del fallo (para detectarlo sin depender del reporte del cliente).
        console.error('[MapPicker] Google Maps no cargó:', e?.message ?? e);
        setLoadErr(e?.message ?? 'Error cargando Google Maps');
        setManualOpen(true); // abrimos el fallback manual automáticamente
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

  const manualForm = (
    <div className="rounded-input border border-line bg-bg2 p-3 mt-2 space-y-2">
      <div className="text-sm font-semibold">📍 Ingresar ubicación manualmente</div>
      <input
        className="input w-full"
        placeholder="Dirección (ej. Av. Luis Muñoz Rivera 168, San Juan)"
        value={mAddr}
        onChange={(e) => setMAddr(e.target.value)}
      />
      <div className="flex gap-2">
        <input
          className="input w-full"
          inputMode="decimal"
          placeholder="Latitud (18.10995)"
          value={mLat}
          onChange={(e) => setMLat(e.target.value)}
        />
        <input
          className="input w-full"
          inputMode="decimal"
          placeholder="Longitud (-66.16660)"
          value={mLng}
          onChange={(e) => setMLng(e.target.value)}
        />
      </div>
      <p className="text-[11px] text-mute">
        En Google Maps: clic derecho en el punto → copia las coordenadas (lat, lng).
      </p>
      <button
        type="button"
        onClick={submitManual}
        className="w-full rounded-input bg-ok text-white font-semibold py-2.5 text-sm"
      >
        Usar esta ubicación
      </button>
    </div>
  );

  if (loadErr) {
    return (
      <div>
        <div className="rounded-input border border-line bg-amber-50 p-4 text-sm text-amber-900 leading-relaxed">
          <div className="font-semibold mb-1">El mapa no se pudo cargar</div>
          <div>{loadErr}</div>
          <div className="text-xs mt-2 text-amber-800/80">
            Podés guardar tu ubicación igual con el formulario de abajo. (Si sos
            admin: este dominio debe estar en los <b>Referrers HTTP</b> de la API
            key de Google Maps, con Maps JavaScript API + Places + Geocoding
            habilitadas y facturación activa. RefererNotAllowedMapError = falta el
            dominio en la allowlist.)
          </div>
        </div>
        {manualForm}
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

      <div className="mt-2 text-center">
        <button
          type="button"
          onClick={() => setManualOpen((v) => !v)}
          className="text-xs text-mute underline"
        >
          {manualOpen
            ? 'Ocultar entrada manual'
            : '¿El mapa no carga? Ingresar dirección manualmente'}
        </button>
      </div>
      {manualOpen && manualForm}
    </div>
  );
}
