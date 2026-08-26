'use client';
import { useEffect, useRef, useState } from 'react';
import type * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type MapPickResult = {
  name: string;
  address: string;
  lat: number;
  lng: number;
};

/**
 * Selector de ubicación con **OpenStreetMap**, sin API key.
 *
 * Antes usaba Google Maps + Places. Google restringe sus claves por dominio, y
 * cuando un admin entra a un negocio DESDE el panel maestro (`soyfidelity.com`)
 * el componente corre en ese dominio: `RefererNotAllowedMapError` y el negocio
 * se quedaba sin poder fijar su sede. Autorizar cada dominio en Google Cloud es
 * una tarea manual que se repite con cada marca nueva.
 *
 * Además, Google avisó que `places.Autocomplete` ya no admite clientes nuevos,
 * así que el buscador tenía fecha de caducidad de todos modos.
 *
 * Ahora: mapa de OpenStreetMap con Leaflet y búsqueda con **Nominatim**, el
 * geocodificador de OSM. Sin clave, sin restricción por dominio, funciona en
 * cualquier marca que se conecte mañana sin que nadie autorice nada.
 *
 * Nominatim pide un máximo de 1 consulta por segundo: por eso la búsqueda no
 * dispara mientras se escribe, sino al pulsar Enter o el botón. Es una
 * búsqueda que se hace un par de veces al dar de alta una sede, no un
 * autocompletado.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org';

type Sugerencia = {
  display_name: string;
  lat: string;
  lon: string;
  name?: string;
};

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
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const leafletRef = useRef<typeof L | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [sugerencias, setSugerencias] = useState<Sugerencia[] | null>(null);
  const [buscando, setBuscando] = useState(false);

  // Fallback manual: si el mapa no carga (red del cliente, corte de OSM), el
  // usuario igual puede guardar su ubicación a mano. Nunca lo dejamos sin
  // camino.
  const [manualOpen, setManualOpen] = useState(false);
  const [mAddr, setMAddr] = useState(picked?.address ?? '');
  const [mLat, setMLat] = useState(picked ? String(picked.lat) : '');
  const [mLng, setMLng] = useState(picked ? String(picked.lng) : '');

  function submitManual() {
    const lat = Number(mLat);
    const lng = Number(mLng);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      alert(
        'Coordenadas inválidas. La latitud va de -90 a 90 y la longitud de -180 a 180.',
      );
      return;
    }
    onPickRef.current({
      name: mAddr.trim() ? mAddr.trim().split(',')[0] : 'Ubicación manual',
      address: mAddr.trim() || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      lat,
      lng,
    });
  }

  /** Coloca el marcador y avisa al formulario. */
  function elegir(lat: number, lng: number, address: string, name?: string) {
    const Lm = leafletRef.current;
    const map = mapRef.current;
    if (Lm && map) {
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      } else {
        markerRef.current = Lm.marker([lat, lng], { draggable: true }).addTo(map);
        // Arrastrar el pin afina la posición sin volver a buscar: la dirección
        // se recalcula desde las coordenadas nuevas.
        markerRef.current.on('dragend', () => {
          const p = markerRef.current!.getLatLng();
          void reverse(p.lat, p.lng);
        });
      }
      map.setView([lat, lng], Math.max(map.getZoom(), 16));
    }
    onPickRef.current({
      name: name?.trim() || address.split(',')[0] || 'Ubicación',
      address,
      lat,
      lng,
    });
  }

  /** Coordenadas → dirección. Si Nominatim no responde, se usan las cifras. */
  async function reverse(lat: number, lng: number) {
    let address = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    try {
      const r = await fetch(
        `${NOMINATIM}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=es`,
      );
      if (r.ok) {
        const d = await r.json();
        if (d?.display_name) address = d.display_name;
      }
    } catch {
      /* nos quedamos con las coordenadas: el punto elegido es válido igual */
    }
    elegir(lat, lng, address);
  }

  /** Dirección → coordenadas. Se dispara al enviar, no al teclear. */
  async function buscar() {
    const q = busqueda.trim();
    if (q.length < 3) return;
    setBuscando(true);
    try {
      const r = await fetch(
        `${NOMINATIM}/search?format=jsonv2&limit=5&accept-language=es&q=${encodeURIComponent(q)}`,
      );
      setSugerencias(r.ok ? await r.json() : []);
    } catch {
      setSugerencias([]);
    } finally {
      setBuscando(false);
    }
  }

  // Inicializa el mapa una sola vez.
  useEffect(() => {
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    (async () => {
      try {
        // Import dinámico: Leaflet toca `window` al cargarse y revienta en el
        // render del servidor.
        const Lm = (await import('leaflet')).default;
        if (cancelled || !containerRef.current || mapRef.current) return;
        leafletRef.current = Lm;

        const map = Lm.map(containerRef.current, {
          center: [picked?.lat ?? initialLat, picked?.lng ?? initialLng],
          zoom: picked ? 16 : initialZoom,
          scrollWheelZoom: true,
        });
        Lm.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          // Obligatoria por la licencia de OpenStreetMap.
          attribution: '© OpenStreetMap',
        }).addTo(map);

        // Clic directo en el mapa: el camino más rápido cuando el negocio ya
        // sabe dónde está y la dirección escrita no lo encuentra bien.
        map.on('click', (e: L.LeafletMouseEvent) => {
          void reverse(e.latlng.lat, e.latlng.lng);
        });

        if (picked) {
          markerRef.current = Lm.marker([picked.lat, picked.lng], {
            draggable: true,
          }).addTo(map);
          markerRef.current.on('dragend', () => {
            const p = markerRef.current!.getLatLng();
            void reverse(p.lat, p.lng);
          });
        }

        mapRef.current = map;

        // Leaflet mide el contenedor UNA vez, al crearse, y coloca los tiles
        // en posiciones absolutas a partir de esa medida. Dentro de un modal
        // el contenedor todavía no tiene su tamaño final en ese instante
        // (se está abriendo, o el ancho depende de un layout que aún no
        // resolvió), así que el mapa se dibujaba con las medidas equivocadas
        // y los tiles se salían de la ventana, encima del formulario.
        //
        // `invalidateSize()` le dice que vuelva a medir. Una vez tras el
        // primer pintado, y luego cada vez que el contenedor cambie de
        // tamaño — que es lo que pasa al abrir el modal, al rotar el móvil o
        // al plegarse el menú lateral.
        requestAnimationFrame(() => {
          if (!cancelled) map.invalidateSize();
        });
        if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
          ro = new ResizeObserver(() => {
            if (!cancelled) map.invalidateSize();
          });
          ro.observe(containerRef.current);
        }
      } catch (e: any) {
        setLoadErr(e?.message ?? 'No se pudo cargar el mapa.');
      }
    })();
    return () => {
      cancelled = true;
      ro?.disconnect();
      ro = null;
      // Leaflet no se limpia solo: sin esto el contenedor queda marcado como
      // inicializado y al volver a abrir el formulario falla.
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const manualForm = (
    <div className="mt-3 space-y-2">
      <input
        className="input w-full"
        placeholder="Dirección (Calle 1 #2-3, Ciudad)"
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
            Puedes guardar tu ubicación igual con el formulario de abajo.
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
          className="input w-full pr-10"
          placeholder="Escribe la dirección y pulsa Enter…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void buscar();
            }
          }}
        />
        <button
          type="button"
          onClick={() => void buscar()}
          disabled={buscando || busqueda.trim().length < 3}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-mute disabled:opacity-40"
          aria-label="Buscar dirección"
        >
          {buscando ? '⏳' : '🔍'}
        </button>
      </div>
      <p className="text-[11px] text-mute mt-1.5 mb-2">
        Búsqueda de OpenStreetMap · o da clic directo en el mapa
      </p>

      {sugerencias !== null && (
        <div className="mb-2 rounded-input border border-line overflow-hidden">
          {sugerencias.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-mute">
              No encontramos esa dirección. Prueba con menos detalle (calle y
              ciudad), o da clic directo en el mapa.
            </div>
          ) : (
            sugerencias.map((s, i) => (
              <button
                key={`${s.lat}-${s.lon}-${i}`}
                type="button"
                onClick={() => {
                  elegir(
                    Number(s.lat),
                    Number(s.lon),
                    s.display_name,
                    s.name,
                  );
                  setSugerencias(null);
                }}
                className="w-full text-left px-3 py-2.5 text-xs hover:bg-bg2 border-b border-line last:border-0"
              >
                {s.display_name}
              </button>
            ))
          )}
        </div>
      )}

      {/* `position: relative` en línea, no confiado al CSS de Leaflet.
          Los paneles del mapa se posicionan en ABSOLUTO; si el contenedor no
          es su contexto de posicionamiento, se anclan al documento y el mapa
          aparece fuera del modal, encima del formulario. Leaflet lo pone en su
          hoja de estilos, pero cuando el componente se carga con `dynamic` esa
          hoja puede llegar después de que el mapa ya se dibujó. En línea no
          depende de nada. */}
      <div
        ref={containerRef}
        className="rounded-input overflow-hidden border border-line bg-bg2"
        style={{ height, position: 'relative', width: '100%' }}
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
