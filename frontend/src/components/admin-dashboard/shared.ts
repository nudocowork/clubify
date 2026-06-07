'use client';

/**
 * Tipos + helpers + hook compartido del dashboard admin Premium.
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

// ─── Tipos espejo de los endpoints existentes ───
export type GlobalMetrics = {
  tenants: number;
  activeTenants: number;
  trialTenants: number;
  suspendedTenants: number;
  expiringSoon: number;
  passes: number;
  customers: number;
  orders30: number;
  revenue30: number;
  mrrUsd: number;
  arrUsd: number;
  planBreakdown: Record<string, { count: number; mrr: number }>;
  churnedLast30: number;
  conversionRate30: number | null;
  newSignups7: number;
  pendingCommissions: number;
};

export type DashboardMetrics = {
  comisionesGeneradasMesUsd: number;
  comisionesPendientesUsd: number;
  comisionesPagadasMesUsd: number;
  proximasRenovaciones: number;
  clientesActivos: number;
  clientesVencidos: number;
  salesByPlan: Array<{
    periodicity: string;
    label: string;
    count: number;
    billingUsd: number;
  }>;
  generatedAt: string;
};

export type TenantRow = {
  id: string;
  brandName: string;
  status: 'ACTIVE' | 'TRIAL' | 'SUSPENDED' | string;
  planName?: string | null;
  planPeriodicity?: string | null;
  currentPeriodEnd?: string | null;
  createdAt: string;
  email?: string | null;
  suspendedAt?: string | null;
  trialEndsAt?: string | null;
};

export type TrialMetrics = {
  counts: {
    total: number;
    active: number;
    expired: number;
    converted: number;
    suspended: number;
  };
  conversionPct: number | null;
  bySource: Record<
    string,
    {
      total: number;
      active: number;
      converted: number;
      expired: number;
      conversionPct: number | null;
    }
  >;
  byReferrer: Array<{
    code: string;
    name: string;
    role: string;
    total: number;
    converted: number;
    conversionPct: number | null;
  }>;
};

export type RankingRow = {
  rank: number;
  id: string;
  code: string;
  ownerName: string;
  ownerEmail: string;
  commissionPercent: number;
  sales: number;
  revenueUsd: number;
  commissionsUsd: number;
};

export type RankingResponse = {
  role: 'INFLUENCER' | 'AMBASSADOR' | 'VENDOR';
  metric: 'sales' | 'revenue' | 'commissions';
  range: '7d' | '30d' | '90d' | 'all';
  rows: RankingRow[];
};

export type MapTenant = {
  tenantId: string;
  brandName: string;
  slug: string;
  status: 'ACTIVE' | 'TRIAL' | 'SUSPENDED';
  businessCategorySlug: string | null;
  createdAt: string;
  locations: Array<{
    id: string;
    name: string;
    address: string;
    latitude: number;
    longitude: number;
  }>;
};

// ─── Formatters ───
export const usd = (n: number | null | undefined) =>
  `$${Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export const usd2 = (n: number | null | undefined) =>
  `$${Number(n ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;

export const compact = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

export const daysBetween = (a: Date, b: Date) =>
  Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));

export const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
  });
};

// ─── Hook que carga los datos comunes una sola vez ───
export type DashboardData = {
  global: GlobalMetrics | null;
  dashboard: DashboardMetrics | null;
  tenants: TenantRow[] | null;
  trialMetrics: TrialMetrics | null;
  loading: boolean;
};

export function useDashboardData(): DashboardData {
  const [global, setGlobal] = useState<GlobalMetrics | null>(null);
  const [dashboard, setDashboard] = useState<DashboardMetrics | null>(null);
  const [tenants, setTenants] = useState<TenantRow[] | null>(null);
  const [trialMetrics, setTrialMetrics] = useState<TrialMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [g, d, t, tm] = await Promise.allSettled([
        api<GlobalMetrics>('/metrics/global'),
        api<DashboardMetrics>('/admin/dashboard/metrics'),
        api<TenantRow[]>('/tenants'),
        api<TrialMetrics>('/admin/trials/metrics'),
      ]);
      if (cancelled) return;
      if (g.status === 'fulfilled') setGlobal(g.value);
      if (d.status === 'fulfilled') setDashboard(d.value);
      if (t.status === 'fulfilled') setTenants(t.value);
      if (tm.status === 'fulfilled') setTrialMetrics(tm.value);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { global, dashboard, tenants, trialMetrics, loading };
}

// ─── Serie simulada de MRR mensual (cuando no hay endpoint histórico) ───
// TODO: cuando exista endpoint de MRR por mes, reemplazar este builder.
export function buildSimulatedMrrSeries(
  currentMrr: number,
  months = 6,
): Array<{ label: string; value: number }> {
  const out: Array<{ label: string; value: number }> = [];
  const now = new Date();
  // Asumimos crecimiento ~15% mes a mes (curva exponencial reversa).
  const growth = 1.15;
  let v = currentMrr || 1;
  const past: number[] = [];
  for (let i = 0; i < months; i++) {
    past.push(Math.round(v));
    v = v / growth;
  }
  past.reverse();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i);
    const label = d.toLocaleDateString('es-CO', { month: 'short' });
    out.push({ label, value: past[months - 1 - i] });
  }
  return out;
}

// ─── Serie simulada de signups mensuales ───
// TODO: cuando exista endpoint /admin/metrics/signups-monthly reemplazar.
export function buildSimulatedSignupsSeries(
  totalTenants: number,
  months = 6,
): Array<{ label: string; value: number }> {
  const out: Array<{ label: string; value: number }> = [];
  const now = new Date();
  const avg = Math.max(1, Math.round(totalTenants / Math.max(months * 2, 1)));
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i);
    // Ola pseudo-aleatoria pero determinística por mes.
    const wave = Math.round(avg * (1 + 0.3 * Math.sin(i * 1.2)));
    out.push({
      label: d.toLocaleDateString('es-CO', { month: 'short' }),
      value: Math.max(0, wave + (i === 0 ? Math.round(avg * 0.4) : 0)),
    });
  }
  return out;
}
