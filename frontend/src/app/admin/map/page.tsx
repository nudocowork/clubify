'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import {
  BUSINESS_CATEGORIES,
  getCategoryBySlug,
} from '@/lib/business-categories';
import { marcaDeLaRuta } from '@/lib/brand-from-path';

type TenantStatus = 'ACTIVE' | 'TRIAL' | 'SUSPENDED';

type AssignedToCode = {
  id: string;
  code: string;
  ownerName: string;
  role: 'AMBASSADOR' | 'INFLUENCER';
};

type MapLocation = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
};

type MapTenant = {
  tenantId: string;
  brandName: string;
  slug: string;
  status: TenantStatus;
  businessCategorySlug: string | null;
  createdAt: string;
  locations: MapLocation[];
  assignedToCode: AssignedToCode | null;
};

type Affiliate = {
  id: string;
  code: string;
  ownerName: string;
  role: 'AMBASSADOR' | 'INFLUENCER';
};

const STATUS_COLORS: Record<TenantStatus, string> = {
  ACTIVE: '#22C55E', // brand verde
  TRIAL: '#F59E0B', // amarillo / amber
  SUSPENDED: '#6B7280', // gris
};

const STATUS_LABEL_KEY: Record<TenantStatus, string> = {
  ACTIVE: 'statusActive',
  TRIAL: 'statusTrial',
  SUSPENDED: 'statusSuspended',
};

const MAP_API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

/**
 * El mapa del panel usa **OpenStreetMap con Leaflet**, no Google Maps.
 *
 * Google restringe sus claves por dominio, y el panel maestro
 * (`soyfidelity.com`) no estaba en la lista: el mapa moria con
 * `RefererNotAllowedMapError` mirando cualquier marca, y arreglarlo requeria
 * entrar a la consola de Google Cloud — que no todos tienen a mano.
 *
 * Leaflet + OSM no lleva clave ni restriccion por dominio: funciona en
 * `soyfidelity.com`, en `app.selleala.com` y en cualquier dominio de marca
 * que se conecte manana, sin que nadie tenga que autorizar nada.
 *
 * Se pierde el mosaico de Google (satelite, street view). Para un mapa que
 * solo muestra donde estan los negocios, no hace falta.
 *
 * `MapPicker` (el que usa el NEGOCIO para fijar las coordenadas de su sede)
 * sigue en Google: corre en el panel del negocio, que si esta autorizado, y
 * ahi el buscador de direcciones de Google si aporta.
 */

/** Extrae país aproximado del address ("…, Colombia" o "…, México"). */
function inferCountry(address: string | null | undefined): string | null {
  if (!address) return null;
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  return parts[parts.length - 1] || null;
}

/** Extrae ciudad aproximada (penúltimo segmento del address). */
function inferCity(address: string | null | undefined): string | null {
  if (!address) return null;
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  return parts[parts.length - 2] || null;
}

export default function AdminBusinessMapPage() {
  const t = useTranslations('admin_map');
  const [tenants, setTenants] = useState<MapTenant[] | null>(null);
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [filters, setFilters] = useState({
    country: 'all',
    category: 'all',
    ambassador: 'all',
    influencer: 'all',
    status: 'all' as 'all' | TenantStatus,
  });

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.CircleMarker[]>([]);
  // El agrupador se vuelve a ejecutar en cada zoom; guardamos la referencia
  // para poder desuscribirlo al desmontar.
  const redibujarRef = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);

  // ─── Cargar data ───
  useEffect(() => {
    (async () => {
      try {
        const [tn, a] = await Promise.all([
          // La marca que se esta viendo va como parametro: el panel maestro
          // no tiene marca propia y sin esto el mapa de Sellea mostraba los
          // negocios de todas las marcas mezclados.
          api<MapTenant[]>(
            '/admin/business-map' +
              (marcaDeLaRuta(window.location.pathname)
                ? `?marca=${encodeURIComponent(marcaDeLaRuta(window.location.pathname) as string)}`
                : ''),
          ),
          api<Affiliate[]>('/admin/business-map/affiliates'),
        ]);
        setTenants(tn);
        setAffiliates(a);
      } catch (e: any) {
        toast(e?.message ?? t('errorLoadingMap'), 'error');
        setTenants([]);
      }
    })();
  }, []);

  // ─── Inicializar el mapa una sola vez ───
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Import dinámico: Leaflet toca `window` al cargarse y revienta en el
        // render del servidor.
        const L = (await import('leaflet')).default;
        if (cancelled || !mapContainerRef.current) return;
        // Puede quedar una instancia viva de un montaje anterior (StrictMode
        // monta dos veces en desarrollo); sin esto Leaflet lanza
        // "Map container is already initialized".
        if (mapRef.current) return;

        const map = L.map(mapContainerRef.current, {
          // Centro genérico LATAM (Bogotá) — el encuadre posterior lo ajusta.
          center: [4.6097, -74.0817],
          zoom: 4,
          scrollWheelZoom: true,
        });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          // La atribución es obligatoria por la licencia de OpenStreetMap.
          attribution: '© OpenStreetMap',
        }).addTo(map);

        mapRef.current = map;
        setReady(true);
      } catch (e: any) {
        setLoadErr(e?.message ?? t('errorLoadingMaps'));
      }
    })();
    return () => {
      cancelled = true;
      // Leaflet no se limpia solo: sin esto, al volver a la página el
      // contenedor sigue marcado como inicializado.
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // ─── Filtros derivados ───
  const filtered = useMemo(() => {
    if (!tenants) return [];
    return tenants.filter((tn) => {
      if (filters.status !== 'all' && tn.status !== filters.status) return false;
      if (filters.category !== 'all' && tn.businessCategorySlug !== filters.category) {
        return false;
      }
      if (filters.ambassador !== 'all') {
        const ref = tn.assignedToCode;
        if (!ref || ref.role !== 'AMBASSADOR' || ref.id !== filters.ambassador) {
          return false;
        }
      }
      if (filters.influencer !== 'all') {
        const ref = tn.assignedToCode;
        if (!ref || ref.role !== 'INFLUENCER' || ref.id !== filters.influencer) {
          return false;
        }
      }
      if (filters.country !== 'all') {
        // Match contra país de cualquiera de sus locations.
        const matches = tn.locations.some(
          (l) => inferCountry(l.address)?.toLowerCase() === filters.country.toLowerCase(),
        );
        if (!matches) return false;
      }
      return true;
    });
  }, [tenants, filters]);

  // Países disponibles para el dropdown (derivados de los addresses).
  const countries = useMemo(() => {
    if (!tenants) return [];
    const set = new Set<string>();
    for (const tn of tenants) {
      for (const l of tn.locations) {
        const c = inferCountry(l.address);
        if (c) set.add(c);
      }
    }
    return Array.from(set).sort();
  }, [tenants]);

  const ambassadors = useMemo(
    () => affiliates.filter((a) => a.role === 'AMBASSADOR'),
    [affiliates],
  );
  const influencers = useMemo(
    () => affiliates.filter((a) => a.role === 'INFLUENCER'),
    [affiliates],
  );

  // ─── Pintar markers cuando cambian datos filtrados o el mapa está listo ───
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const map = mapRef.current;
    let cancelado = false;

    void (async () => {
      const L = (await import('leaflet')).default;
      if (cancelado || !mapRef.current) return;

      for (const m of markersRef.current) m.remove();
      markersRef.current = [];

      // Todas las sedes, aplanadas.
      const sedes: { tn: (typeof filtered)[number]; loc: MapLocation }[] = [];
      for (const tn of filtered) {
        for (const loc of tn.locations) sedes.push({ tn, loc });
      }
      const puntos: [number, number][] = sedes.map((s) => [
        s.loc.latitude,
        s.loc.longitude,
      ]);

      /**
       * Agrupa las sedes que caen en el mismo punto de la PANTALLA.
       *
       * Sin esto, cuatro sedes a 5 km se pintan una encima de otra al ver el
       * continente entero: el panel decía "7 sedes" y solo se contaban 3
       * puntos. Se reagrupa en cada zoom porque lo que importa son píxeles,
       * no kilómetros.
       */
      function pintar() {
        for (const m of markersRef.current) m.remove();
        markersRef.current = [];
        if (!mapRef.current) return;

        const CELDA = 44; // píxeles: por debajo de esto los puntos se tocan
        const grupos = new Map<string, typeof sedes>();
        for (const s of sedes) {
          const p = map.latLngToLayerPoint([s.loc.latitude, s.loc.longitude]);
          const clave = `${Math.round(p.x / CELDA)}:${Math.round(p.y / CELDA)}`;
          const g = grupos.get(clave);
          if (g) g.push(s);
          else grupos.set(clave, [s]);
        }

        for (const grupo of grupos.values()) {
          const centro: [number, number] = [
            grupo.reduce((a, s) => a + s.loc.latitude, 0) / grupo.length,
            grupo.reduce((a, s) => a + s.loc.longitude, 0) / grupo.length,
          ];

          if (grupo.length === 1) {
            const { tn, loc } = grupo[0];
            const marker = L.circleMarker([loc.latitude, loc.longitude], {
              radius: 8,
              fillColor: STATUS_COLORS[tn.status],
              fillOpacity: 0.95,
              color: '#FFFFFF',
              weight: 2,
            })
              .addTo(map)
              .bindPopup(buildInfoWindow(tn, loc, t), { maxWidth: 280 });
            marker.bindTooltip(tn.brandName);
            markersRef.current.push(marker);
            continue;
          }

          // Varias sedes en el mismo sitio: un círculo con el número. Si todas
          // comparten estado se pinta de su color; si no, gris neutro para no
          // mentir sobre el estado del grupo.
          const estados = new Set(grupo.map((s) => s.tn.status));
          const color =
            estados.size === 1
              ? STATUS_COLORS[grupo[0].tn.status]
              : '#64748B';
          const cluster = L.marker(centro, {
            icon: L.divIcon({
              className: '',
              html: `<div style="width:34px;height:34px;border-radius:9999px;background:${color};color:#fff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font:600 13px/1 system-ui,sans-serif">${grupo.length}</div>`,
              iconSize: [34, 34],
              iconAnchor: [17, 17],
            }),
          }).addTo(map);

          const nombres = [...new Set(grupo.map((s) => s.tn.brandName))];
          cluster.bindTooltip(
            `${grupo.length} sedes · ${nombres.slice(0, 3).join(', ')}${nombres.length > 3 ? '…' : ''}`,
          );
          // Clic = acercarse hasta separarlas. Es la forma natural de "ver los
          // otros" sin tener que buscar el control de zoom.
          cluster.on('click', () => {
            map.fitBounds(
              L.latLngBounds(
                grupo.map(
                  (s) => [s.loc.latitude, s.loc.longitude] as [number, number],
                ),
              ),
              { padding: [80, 80], maxZoom: 17 },
            );
          });
          markersRef.current.push(cluster as unknown as L.CircleMarker);
        }
      }

      pintar();
      map.on('zoomend', pintar);
      redibujarRef.current = pintar;

      if (puntos.length) {
        // Con un solo punto, `fitBounds` se va a zoom máximo: lo capamos.
        map.fitBounds(L.latLngBounds(puntos), { padding: [60, 60], maxZoom: 14 });
      }
    })();

    return () => {
      cancelado = true;
      if (redibujarRef.current) {
        map.off('zoomend', redibujarRef.current);
        redibujarRef.current = null;
      }
    };
  }, [ready, filtered]);

  // ─── KPIs ───
  const kpis = useMemo(() => {
    const counts = { ACTIVE: 0, TRIAL: 0, SUSPENDED: 0 };
    const byCategory: Record<string, number> = {};
    const byAmbassador: Record<string, { name: string; count: number }> = {};
    const byInfluencer: Record<string, { name: string; count: number }> = {};

    for (const tn of filtered) {
      counts[tn.status] = (counts[tn.status] || 0) + 1;
      const cat = tn.businessCategorySlug ?? 'other';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
      const ref = tn.assignedToCode;
      if (ref) {
        const bucket = ref.role === 'AMBASSADOR' ? byAmbassador : byInfluencer;
        if (!bucket[ref.id]) bucket[ref.id] = { name: ref.ownerName, count: 0 };
        bucket[ref.id].count += 1;
      }
    }

    const topCategories = Object.entries(byCategory)
      .map(([slug, count]) => ({ slug, count, label: getCategoryBySlug(slug).name }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const topAmbassadors = Object.entries(byAmbassador)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const topInfluencers = Object.entries(byInfluencer)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return { counts, topCategories, topAmbassadors, topInfluencers };
  }, [filtered]);

  const totalLocations = useMemo(
    () => filtered.reduce((acc, tn) => acc + tn.locations.length, 0),
    [filtered],
  );

  return (
    <div className="max-w-7xl">
      <div className="page-head">
        <h1 className="page-title">
          {t('pageTitle')} <span className="page-crumb">{t('pageCrumb')}</span>
        </h1>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <KpiCard
          label={t('kpiBusinesses')}
          value={filtered.length}
          hint={t('kpiLocationsOnMap', { count: totalLocations })}
          accent="brand"
        />
        <KpiCard label={t('kpiActive')} value={kpis.counts.ACTIVE} accent="ok" />
        <KpiCard label={t('kpiTrial')} value={kpis.counts.TRIAL} accent="warn" />
        <KpiCard label={t('kpiSuspended')} value={kpis.counts.SUSPENDED} accent="bad" />
        <KpiCard
          label={t('kpiNoLocation')}
          value={
            tenants
              ? Math.max(0, tenants.length - filtered.length)
              : 0
          }
          accent="mute"
          hint={t('kpiExcludedByFilters')}
        />
      </div>

      {/* Top categorías / embajadores / influencers */}
      {(kpis.topCategories.length > 0 ||
        kpis.topAmbassadors.length > 0 ||
        kpis.topInfluencers.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
          <TopList
            title={t('topCategories')}
            items={kpis.topCategories.map((c) => ({
              key: c.slug,
              label: c.label,
              value: c.count,
            }))}
            emptyHint={t('noData')}
          />
          <TopList
            title={t('topAmbassadors')}
            items={kpis.topAmbassadors.map((a) => ({
              key: a.id,
              label: a.name,
              value: a.count,
            }))}
            emptyHint={t('noAmbassadorAttribution')}
          />
          <TopList
            title={t('topInfluencers')}
            items={kpis.topInfluencers.map((i) => ({
              key: i.id,
              label: i.name,
              value: i.count,
            }))}
            emptyHint={t('noInfluencerAttribution')}
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        {/* Sidebar filtros */}
        <aside className="card card-pad self-start lg:sticky lg:top-4">
          <h2 className="text-base font-semibold m-0">{t('filtersTitle')}</h2>
          <div className="mt-3 flex flex-col gap-3 text-sm">
            <FilterSelect
              label={t('filterCountry')}
              value={filters.country}
              onChange={(v) => setFilters((f) => ({ ...f, country: v }))}
              options={[
                { value: 'all', label: t('optionAll') },
                ...countries.map((c) => ({ value: c, label: c })),
              ]}
            />
            <FilterSelect
              label={t('filterBusinessType')}
              value={filters.category}
              onChange={(v) => setFilters((f) => ({ ...f, category: v }))}
              options={[
                { value: 'all', label: t('optionAll') },
                ...BUSINESS_CATEGORIES.map((c) => ({
                  value: c.slug,
                  label: `${c.emoji} ${c.name}`,
                })),
              ]}
            />
            <FilterSelect
              label={t('filterAmbassador')}
              value={filters.ambassador}
              onChange={(v) => setFilters((f) => ({ ...f, ambassador: v }))}
              options={[
                { value: 'all', label: t('optionAll') },
                ...ambassadors.map((a) => ({
                  value: a.id,
                  label: a.ownerName,
                })),
              ]}
            />
            <FilterSelect
              label={t('filterInfluencer')}
              value={filters.influencer}
              onChange={(v) => setFilters((f) => ({ ...f, influencer: v }))}
              options={[
                { value: 'all', label: t('optionAll') },
                ...influencers.map((i) => ({
                  value: i.id,
                  label: i.ownerName,
                })),
              ]}
            />
            <FilterSelect
              label={t('filterStatus')}
              value={filters.status}
              onChange={(v) =>
                setFilters((f) => ({ ...f, status: v as typeof filters.status }))
              }
              options={[
                { value: 'all', label: t('optionAll') },
                { value: 'ACTIVE', label: t('optionActive') },
                { value: 'TRIAL', label: t('optionTrial') },
                { value: 'SUSPENDED', label: t('optionSuspended') },
              ]}
            />
            <button
              type="button"
              className="text-xs text-brand hover:underline self-start mt-1"
              onClick={() =>
                setFilters({
                  country: 'all',
                  category: 'all',
                  ambassador: 'all',
                  influencer: 'all',
                  status: 'all',
                })
              }
            >
              {t('clearFilters')}
            </button>
          </div>

          {/* Leyenda */}
          <div className="mt-5 pt-4 border-t border-line2">
            <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-2">
              {t('legend')}
            </div>
            <div className="flex flex-col gap-1.5 text-xs">
              {(['ACTIVE', 'TRIAL', 'SUSPENDED'] as TenantStatus[]).map((s) => (
                <div key={s} className="flex items-center gap-2">
                  <span
                    className="inline-block w-3 h-3 rounded-full border-2 border-white shadow"
                    style={{ background: STATUS_COLORS[s] }}
                  />
                  <span>{t(STATUS_LABEL_KEY[s])}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Mapa */}
        <div className="card overflow-hidden relative" style={{ minHeight: 560 }}>
          {loadErr ? (
            <div className="p-6 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl m-4">
              <div className="font-semibold mb-1">{t('mapsNotConfigured')}</div>
              <div>{loadErr}</div>
              {/* Ya no hay clave que configurar: el mapa no la usa. Si esto
                  falla es que no cargaron los mosaicos de OpenStreetMap. */}
              <div className="text-xs mt-2 text-amber-800/80">
                Recarga la página. Si sigue igual, puede ser un corte temporal
                de OpenStreetMap.
              </div>
            </div>
          ) : (
            <div ref={mapContainerRef} style={{ height: 640, width: '100%' }} />
          )}
          {!tenants && !loadErr && (
            <div className="absolute inset-0 bg-white/60 flex items-center justify-center text-mute text-sm">
              {t('loading')}
            </div>
          )}
          {tenants && filtered.length === 0 && !loadErr && (
            <div className="absolute inset-0 bg-white/60 flex items-center justify-center pointer-events-none">
              <div className="bg-white px-5 py-3 rounded-xl border border-line2 shadow text-sm text-mute">
                {t('noBusinessesForFilters')}
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-mute mt-3">
        {t.rich('footnote', {
          link: (chunks) => (
            <Link href="/admin/tenants" className="underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </div>
  );
}

/**
 * HTML del InfoWindow del marker. Lo inyectamos como string porque
 * El popup de Leaflet acepta una cadena de HTML, que es el patrón más simple
 * sin tener que montar React dentro del mapa.
 */
function buildInfoWindow(
  tn: MapTenant,
  loc: MapLocation,
  t: ReturnType<typeof useTranslations<'admin_map'>>,
): string {
  const cat = getCategoryBySlug(tn.businessCategorySlug);
  const city = inferCity(loc.address) ?? '—';
  const status = t(STATUS_LABEL_KEY[tn.status]);
  const date = new Date(tn.createdAt).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const refLine = tn.assignedToCode
    ? `<div style="font-size:11px;color:#6b7280;margin-top:4px;">${escapeHtml(
        t('infoVia', {
          name: tn.assignedToCode.ownerName,
          role:
            tn.assignedToCode.role === 'AMBASSADOR'
              ? t('roleAmbassadorLower')
              : t('roleInfluencerLower'),
        }),
      )}</div>`
    : '';
  return `
    <div style="font-family:inherit;min-width:200px;max-width:240px;padding:2px 4px;">
      <div style="font-weight:600;font-size:14px;color:#111827;">${escapeHtml(tn.brandName)}</div>
      <div style="font-size:12px;color:#374151;margin-top:2px;">${cat.emoji} ${escapeHtml(cat.name)}</div>
      <div style="font-size:12px;color:#374151;margin-top:6px;">📍 ${escapeHtml(city)}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:2px;">${escapeHtml(loc.name)}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
        <span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:10px;font-weight:600;background:${STATUS_COLORS[tn.status]};color:white;">${status}</span>
        <span style="font-size:10px;color:#9ca3af;">${escapeHtml(t('infoRegistered', { date }))}</span>
      </div>
      ${refLine}
      <a href="/admin/tenants/${tn.tenantId}" style="display:inline-block;margin-top:8px;font-size:12px;color:#22C55E;text-decoration:none;font-weight:600;">${escapeHtml(t('viewBusiness'))}</a>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function KpiCard({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: number | string;
  accent: 'ok' | 'warn' | 'bad' | 'brand' | 'mute';
  hint?: string;
}) {
  const color =
    accent === 'ok'
      ? 'text-ok'
      : accent === 'warn'
      ? 'text-amber-600'
      : accent === 'bad'
      ? 'text-bad'
      : accent === 'mute'
      ? 'text-mute'
      : 'text-brand';
  return (
    <div className="card card-pad">
      <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
        {label}
      </div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
      {hint && <div className="text-[10px] text-mute mt-1">{hint}</div>}
    </div>
  );
}

function TopList({
  title,
  items,
  emptyHint,
}: {
  title: string;
  items: Array<{ key: string; label: string; value: number }>;
  emptyHint?: string;
}) {
  return (
    <div className="card card-pad">
      <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
        {title}
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-mute">{emptyHint ?? ''}</div>
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm">
          {items.map((it) => (
            <li key={it.key} className="flex justify-between items-center gap-2">
              <span className="truncate">{it.label}</span>
              <span className="font-semibold text-brand shrink-0">{it.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-mute font-semibold">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
