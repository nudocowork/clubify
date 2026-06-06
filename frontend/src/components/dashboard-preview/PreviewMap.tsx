'use client';

/**
 * Preview 4 — MAPA EJECUTIVO (estilo SaaS premium dark).
 * Mapa de negocios (reusa /admin/business-map data) + países + 2 charts.
 *
 * Dark mode (bg-slate-900) con cards claras encima.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { api } from '@/lib/api';
import { KpiCard } from './KpiCard';
import { MiniLineChart } from './MiniLineChart';
import { EmptyState } from './EmptyState';
import {
  usePreviewData,
  buildSimulatedSignupsSeries,
  type MapTenant,
} from './shared';

const STATUS_COLORS: Record<MapTenant['status'], string> = {
  ACTIVE: '#22C55E',
  TRIAL: '#F59E0B',
  SUSPENDED: '#EF4444',
};

const STATUS_LABELS: Record<MapTenant['status'], string> = {
  ACTIVE: 'Activos',
  TRIAL: 'Trial',
  SUSPENDED: 'Suspendidos',
};

function inferCountry(address: string | null | undefined): string {
  if (!address) return 'Sin país';
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return 'Sin país';
  return parts[parts.length - 1] || 'Sin país';
}

export function PreviewMap() {
  const { global, loading } = usePreviewData();
  const [mapTenants, setMapTenants] = useState<MapTenant[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<MapTenant[]>('/admin/business-map')
      .then((d) => !cancelled && setMapTenants(d))
      .catch(() => !cancelled && setMapTenants([]));
    return () => {
      cancelled = true;
    };
  }, []);

  // Countries breakdown
  const countries = useMemo(() => {
    if (!mapTenants) return [];
    const counts: Record<string, { country: string; count: number; statuses: Record<string, number> }> = {};
    for (const t of mapTenants) {
      for (const loc of t.locations) {
        const c = inferCountry(loc.address);
        if (!counts[c]) counts[c] = { country: c, count: 0, statuses: {} };
        counts[c].count += 1;
        counts[c].statuses[t.status] = (counts[c].statuses[t.status] || 0) + 1;
      }
    }
    return Object.values(counts).sort((a, b) => b.count - a.count);
  }, [mapTenants]);

  const top10Countries = countries.slice(0, 10);

  // Signups por mes (simulada).
  const signupsSeries = useMemo(
    () => buildSimulatedSignupsSeries(global?.tenants ?? 0, 6),
    [global?.tenants],
  );

  const totalLocs = useMemo(
    () =>
      mapTenants
        ? mapTenants.reduce((a, t) => a + t.locations.length, 0)
        : 0,
    [mapTenants],
  );

  // Status counts (filtered to those with locations).
  const statusCounts = useMemo(() => {
    const c = { ACTIVE: 0, TRIAL: 0, SUSPENDED: 0 };
    if (!mapTenants) return c;
    for (const t of mapTenants) c[t.status] = (c[t.status] || 0) + 1;
    return c;
  }, [mapTenants]);

  if (loading && !mapTenants) {
    return <EmptyState text="Cargando mapa ejecutivo…" icon="chart" />;
  }

  return (
    <div className="rounded-2xl bg-slate-900 text-slate-100 p-6 -mx-3 md:-mx-0">
      <div className="mb-5">
        <h2 className="text-2xl font-bold text-white">Mapa ejecutivo</h2>
        <p className="text-sm text-slate-400 mt-1">
          Expansión geográfica y crecimiento de la red.
        </p>
      </div>

      {/* KPIs hero (variant dark) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <KpiCard
          variant="dark"
          label="Países"
          value={countries.length}
          sub={`${totalLocs} sedes en mapa`}
          icon="🌎"
        />
        <KpiCard
          variant="dark"
          label="Activos"
          value={statusCounts.ACTIVE}
          tone="ok"
          icon="🟢"
        />
        <KpiCard
          variant="dark"
          label="Trial"
          value={statusCounts.TRIAL}
          tone="warn"
          icon="🟡"
        />
        <KpiCard
          variant="dark"
          label="Suspendidos"
          value={statusCounts.SUSPENDED}
          tone="bad"
          icon="🔴"
        />
      </div>

      {/* Top: mapa pseudo + sidebar países */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-5">
        {/* Mapa simplificado (visual schemático) */}
        <div className="lg:col-span-3 rounded-2xl bg-slate-800/70 border border-slate-700 p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                Distribución geográfica
              </div>
              <div className="text-base font-bold text-white mt-0.5">
                Negocios por país
              </div>
            </div>
            <Link
              href="/admin/map"
              className="text-xs font-semibold text-brand hover:underline"
            >
              Ver mapa completo →
            </Link>
          </div>

          {/* Mosaico de países con pins */}
          {countries.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">
              Sin negocios con sede aún.
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {top10Countries.map((c) => (
                <div
                  key={c.country}
                  className="rounded-xl bg-slate-900/60 border border-slate-700 p-3 hover:border-brand transition-colors"
                >
                  <div className="text-sm font-semibold text-white">
                    {c.country}
                  </div>
                  <div className="text-2xl font-bold text-brand mt-1">
                    {c.count}
                  </div>
                  <div className="flex gap-2 mt-2 text-[10px] text-slate-400">
                    {(['ACTIVE', 'TRIAL', 'SUSPENDED'] as const).map((s) =>
                      c.statuses[s] ? (
                        <span
                          key={s}
                          className="inline-flex items-center gap-1"
                        >
                          <span
                            className="inline-block w-2 h-2 rounded-full"
                            style={{ background: STATUS_COLORS[s] }}
                          />
                          {c.statuses[s]}
                        </span>
                      ) : null,
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar países (lista) */}
        <div className="rounded-2xl bg-slate-800/70 border border-slate-700 p-5">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
            Países
          </div>
          <div className="text-base font-bold text-white mt-0.5 mb-3">
            Todos los registros
          </div>
          {countries.length === 0 ? (
            <div className="text-xs text-slate-400">Sin datos aún.</div>
          ) : (
            <ul className="divide-y divide-slate-700 max-h-[280px] overflow-y-auto">
              {countries.map((c) => (
                <li
                  key={c.country}
                  className="py-2 flex items-center justify-between text-sm"
                >
                  <span className="text-slate-200">{c.country}</span>
                  <span className="font-semibold text-brand">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Bottom: 2 charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-slate-800/70 border border-slate-700 p-5">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
            Crecimiento mensual
          </div>
          <div className="text-base font-bold text-white mt-0.5 mb-3">
            Nuevos registros 6m
          </div>
          <div className="text-slate-100">
            <MiniLineChart
              data={signupsSeries}
              height={200}
              color="#4ADE80"
              area
              showAxes
              showGrid
            />
          </div>
          <div className="text-[10px] text-slate-500 mt-1">
            {/* TODO: cuando exista endpoint /admin/metrics/signups-monthly real, reemplazar. */}
            Serie estimada con crecimiento orgánico.
          </div>
        </div>

        <div className="rounded-2xl bg-slate-800/70 border border-slate-700 p-5">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
            Distribución por país
          </div>
          <div className="text-base font-bold text-white mt-0.5 mb-3">
            Top 10 países
          </div>
          {top10Countries.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">
              Sin datos.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={top10Countries.map((c) => ({
                  label: c.country,
                  value: c.count,
                }))}
                layout="vertical"
                margin={{ top: 4, right: 12, bottom: 0, left: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#334155"
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  stroke="#94A3B8"
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  stroke="#94A3B8"
                  width={90}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 8,
                    border: '1px solid #475569',
                    background: '#0F172A',
                    color: '#F1F5F9',
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="value" fill="#22C55E" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
