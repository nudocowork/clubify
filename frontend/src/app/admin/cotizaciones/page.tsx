'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { DownloadQuotePDFButton } from '@/components/DownloadQuotePDFButton';
import {
  getQuoteTemplateBySlug,
  QUOTE_TEMPLATES,
} from '@/lib/quote-templates';

const FALLBACK_TEMPLATE = QUOTE_TEMPLATES.find((t) => t.slug === 'other')!;

type Plan = 'ELITE' | 'PRO';

type Quote = {
  id: string;
  customerName: string;
  businessName: string;
  phone: string | null;
  email: string | null;
  plan: Plan;
  templateSlug: string | null;
  advisorId: string | null;
  advisorName: string;
  priceSnapshot: string; // viene Decimal serializado como string
  currencySnapshot: string;
  pdfDownloadCount?: number;
  lastPdfDownloadAt?: string | null;
  viewCount?: number;
  firstViewedAt?: string | null;
  lastViewedAt?: string | null;
  createdAt: string;
};

type ListResp = { items: Quote[]; total: number; take: number; skip: number };

type Stats = {
  total: number;
  last30dCount: number;
  byPlan: { plan: Plan; count: number; sumPrice: string }[];
  byAdvisor: { advisorId: string | null; advisorName: string; count: number }[];
  byTemplate: { templateSlug: string | null; count: number }[];
  byMonth: { key: string; total: number; elite: number; pro: number }[];
};

function monthLabel(key: string) {
  // key viene como YYYY-MM
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('es-CO', { month: 'short' }).replace('.', '');
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** "hace 3h" / "hace 2d" — para badges de actividad reciente. */
function fmtRelative(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return 'recién';
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'hace segundos';
  if (min < 60) return `hace ${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `hace ${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `hace ${w}sem`;
  const mo = Math.floor(d / 30);
  return `hace ${mo}mes`;
}

function fmtMoney(amount: string | number, currency: string) {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

function humanizeSlug(slug: string | null) {
  if (!slug) return '—';
  return slug
    .split(/[_-]/g)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(' ');
}

export default function CotizacionesPage() {
  const [list, setList] = useState<Quote[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterPlan, setFilterPlan] = useState<'ALL' | Plan>('ALL');
  const [filterTemplate, setFilterTemplate] = useState<string>('');
  const [filterAdvisor, setFilterAdvisor] = useState<string>('');
  const [filterFrom, setFilterFrom] = useState<string>('');
  const [filterTo, setFilterTo] = useState<string>('');
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);

  function buildParams(): URLSearchParams {
    const p = new URLSearchParams();
    if (filterPlan !== 'ALL') p.set('plan', filterPlan);
    if (filterTemplate) p.set('templateSlug', filterTemplate);
    if (filterAdvisor) p.set('advisorId', filterAdvisor);
    if (filterFrom) p.set('from', filterFrom);
    if (filterTo) p.set('to', filterTo);
    if (search.trim()) p.set('search', search.trim());
    return p;
  }

  async function load() {
    setLoading(true);
    try {
      const [resp, st] = await Promise.all([
        api<ListResp>(`/admin/quotes?${buildParams().toString()}`),
        api<Stats>('/admin/quotes/stats'),
      ]);
      setList(resp.items);
      setTotal(resp.total);
      setStats(st);
    } catch (e: any) {
      toast(e.message || 'Error cargando cotizaciones', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterPlan, filterTemplate, filterAdvisor, filterFrom, filterTo]);

  function clearFilters() {
    setFilterPlan('ALL');
    setFilterTemplate('');
    setFilterAdvisor('');
    setFilterFrom('');
    setFilterTo('');
    setSearch('');
  }

  const anyFilterActive =
    filterPlan !== 'ALL' ||
    !!filterTemplate ||
    !!filterAdvisor ||
    !!filterFrom ||
    !!filterTo ||
    !!search.trim();

  async function exportCSV() {
    setExporting(true);
    try {
      // Pedimos hasta 500 filas con los mismos filtros activos
      const p = buildParams();
      p.set('take', '500');
      const resp = await api<ListResp>(`/admin/quotes?${p.toString()}`);
      const rows = resp.items;
      if (!rows.length) {
        toast('No hay filas para exportar', 'error');
        return;
      }
      const headers = [
        'fecha',
        'cliente',
        'negocio',
        'telefono',
        'email',
        'plan',
        'precio',
        'moneda',
        'plantilla',
        'asesor',
      ];
      const esc = (v: string | null | undefined) => {
        const s = String(v ?? '');
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };
      const body = rows
        .map((r) =>
          [
            new Date(r.createdAt).toISOString().slice(0, 10),
            r.customerName,
            r.businessName,
            r.phone,
            r.email,
            r.plan,
            r.priceSnapshot,
            r.currencySnapshot,
            r.templateSlug ?? '',
            r.advisorName,
          ]
            .map(esc)
            .join(','),
        )
        .join('\n');
      const csv = `${headers.join(',')}\n${body}\n`;
      const blob = new Blob(['﻿' + csv], {
        type: 'text/csv;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `clubify-cotizaciones-${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`Exportadas ${rows.length} cotizaciones`, 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo exportar', 'error');
    } finally {
      setExporting(false);
    }
  }

  // Buscar con debounce sutil al apretar Enter o al perder foco
  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') load();
  }

  async function remove(q: Quote) {
    if (!confirm(`¿Eliminar cotización de ${q.customerName} (${q.businessName})?`))
      return;
    try {
      await api(`/admin/quotes/${q.id}`, { method: 'DELETE' });
      toast('Cotización eliminada', 'success');
      load();
    } catch (e: any) {
      toast(e.message || 'No se pudo eliminar', 'error');
    }
  }

  const byPlanMap = useMemo(() => {
    const m: Record<string, number> = { ELITE: 0, PRO: 0 };
    stats?.byPlan.forEach((b) => {
      m[b.plan] = b.count;
    });
    return m;
  }, [stats]);

  const totalRevenue = useMemo(() => {
    if (!stats) return 0;
    return stats.byPlan.reduce((acc, b) => acc + Number(b.sumPrice || 0), 0);
  }, [stats]);

  const topMonthCount = useMemo(() => {
    if (!stats?.byMonth.length) return 0;
    return Math.max(1, ...stats.byMonth.map((b) => b.total));
  }, [stats]);

  const [insightsOpen, setInsightsOpen] = useState(false);
  const topAdvisor = stats?.byAdvisor?.[0];

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Cotizaciones{' '}
          <span className="page-crumb">/ {total} registros</span>
        </h1>
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            className="btn-ghost"
            onClick={exportCSV}
            disabled={exporting || (loading && !list.length)}
            title="Exportar CSV de los resultados visibles (máx 500)"
          >
            <Icon name="out" />
            {exporting ? 'Exportando…' : 'Exportar CSV'}
          </button>
          <Link className="btn-secondary" href="/admin/cotizaciones/precios">
            <Icon name="gear" /> Editar precios
          </Link>
          <Link className="btn-primary" href="/admin/cotizaciones/nueva">
            <Icon name="plus" /> Nueva cotización
          </Link>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard
          label="Total"
          value={stats ? String(stats.total) : null}
          loading={loading && !stats}
        />
        <StatCard
          label="Últimos 30 días"
          value={stats ? String(stats.last30dCount) : null}
          loading={loading && !stats}
        />
        <StatCard
          label="Elite / Pro"
          loading={loading && !stats}
          render={
            stats ? (
              <div className="text-2xl font-bold">
                <span>{byPlanMap.ELITE}</span>
                <span className="text-mute mx-1">/</span>
                <span className="text-brand">{byPlanMap.PRO}</span>
              </div>
            ) : null
          }
          sub={
            stats && totalRevenue > 0
              ? `${fmtMoney(totalRevenue, list[0]?.currencySnapshot ?? 'USD')} acumulado`
              : undefined
          }
        />
        <StatCard
          label="Top asesor"
          loading={loading && !stats}
          render={
            topAdvisor ? (
              <>
                <div
                  className="text-sm font-semibold truncate"
                  title={topAdvisor.advisorName}
                >
                  {topAdvisor.advisorName}
                </div>
                <div className="text-xs text-mute mt-0.5">
                  {topAdvisor.count} cotización
                  {topAdvisor.count === 1 ? '' : 'es'}
                </div>
              </>
            ) : (
              <div className="text-sm text-mute">—</div>
            )
          }
        />
      </div>

      {/* Insights expandible */}
      {stats && stats.total > 0 && (
        <div className="card overflow-hidden p-0 mb-5">
          <button
            type="button"
            onClick={() => setInsightsOpen((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-bg2/50 transition"
            aria-expanded={insightsOpen}
          >
            <div className="flex items-center gap-3">
              <span className="text-brand">
                <Icon name="trend-up" />
              </span>
              <div>
                <div className="text-sm font-semibold">Insights</div>
                <div className="text-xs text-mute">
                  Distribución por mes, plantilla y asesor (últimos 6 meses)
                </div>
              </div>
            </div>
            <span
              className={`text-mute transition-transform ${insightsOpen ? 'rotate-180' : ''}`}
            >
              <Icon name="arrow-right" />
            </span>
          </button>
          {insightsOpen && (
            <div className="border-t border-line p-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Chart mensual */}
              <div>
                <div className="text-[11px] uppercase tracking-[0.1em] text-mute font-semibold mb-3">
                  Cotizaciones por mes
                </div>
                <div className="flex items-end gap-2 h-32">
                  {stats.byMonth.map((b) => {
                    const elitePct = Math.round(
                      (b.elite / topMonthCount) * 100,
                    );
                    const proPct = Math.round((b.pro / topMonthCount) * 100);
                    return (
                      <div
                        key={b.key}
                        className="flex-1 flex flex-col items-center gap-1"
                      >
                        <div className="text-[10px] font-semibold text-mute">
                          {b.total || ''}
                        </div>
                        <div className="w-full flex flex-col-reverse h-full bg-bg2/40 rounded overflow-hidden">
                          <div
                            className="bg-ink/80 transition-all"
                            style={{ height: `${elitePct}%`, minHeight: b.elite ? 2 : 0 }}
                            title={`Elite: ${b.elite}`}
                          />
                          <div
                            className="bg-brand transition-all"
                            style={{ height: `${proPct}%`, minHeight: b.pro ? 2 : 0 }}
                            title={`Pro: ${b.pro}`}
                          />
                        </div>
                        <div className="text-[10px] text-mute uppercase">
                          {monthLabel(b.key)}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-3 mt-3 text-[11px] text-mute">
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm bg-ink/80 inline-block" />
                    Elite
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm bg-brand inline-block" />
                    Pro
                  </span>
                </div>
              </div>

              {/* Top plantillas */}
              <div>
                <div className="text-[11px] uppercase tracking-[0.1em] text-mute font-semibold mb-3">
                  Plantillas más cotizadas
                </div>
                {stats.byTemplate.length === 0 ? (
                  <div className="text-xs text-mute py-2">Sin datos aún.</div>
                ) : (
                  <div className="space-y-2">
                    {stats.byTemplate.slice(0, 6).map((b) => {
                      const pct = Math.round(
                        (b.count / Math.max(stats.total, 1)) * 100,
                      );
                      const t = getQuoteTemplateBySlug(b.templateSlug);
                      return (
                        <div key={b.templateSlug ?? 'none'}>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="flex items-center gap-1.5">
                              {t?.emoji && <span>{t.emoji}</span>}
                              <span className="text-ink">
                                {t?.name ?? humanizeSlug(b.templateSlug)}
                              </span>
                            </span>
                            <span className="text-mute font-mono tabular-nums">
                              {b.count} · {pct}%
                            </span>
                          </div>
                          <div className="h-1.5 bg-bg2 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-brand transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Ranking asesores */}
              <div>
                <div className="text-[11px] uppercase tracking-[0.1em] text-mute font-semibold mb-3">
                  Ranking de asesores
                </div>
                {stats.byAdvisor.length === 0 ? (
                  <div className="text-xs text-mute py-2">Sin datos aún.</div>
                ) : (
                  <ol className="space-y-1">
                    {stats.byAdvisor.slice(0, 8).map((a, i) => (
                      <li
                        key={a.advisorId ?? `idx-${i}`}
                        className="flex items-center gap-2 text-sm"
                      >
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                            i === 0
                              ? 'bg-brand text-white'
                              : 'bg-bg2 text-mute'
                          }`}
                        >
                          {i + 1}
                        </span>
                        <span
                          className="flex-1 truncate"
                          title={a.advisorName}
                        >
                          {a.advisorName}
                        </span>
                        <span className="text-mute font-mono tabular-nums text-xs">
                          {a.count}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filtros */}
      <div className="mb-3.5 space-y-2.5">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="tabs">
            {(['ALL', 'ELITE', 'PRO'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilterPlan(f)}
                className={`tab ${filterPlan === f ? 'tab-active' : ''}`}
              >
                {f === 'ALL' ? 'Todos' : f === 'ELITE' ? 'Elite' : 'Pro'}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[220px]">
            <input
              type="text"
              className="input pl-9"
              placeholder="Buscar cliente, negocio, email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={onSearchKey}
              onBlur={() => load()}
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-mute">
              <Icon name="search" />
            </span>
          </div>
          {anyFilterActive && (
            <button
              type="button"
              className="btn-ghost text-mute text-xs"
              onClick={clearFilters}
              title="Limpiar todos los filtros"
            >
              Limpiar filtros
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2 items-center text-xs">
          <select
            className="input py-1.5 text-xs w-auto"
            value={filterTemplate}
            onChange={(e) => setFilterTemplate(e.target.value)}
            title="Filtrar por plantilla"
          >
            <option value="">Todas las plantillas</option>
            {QUOTE_TEMPLATES.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.emoji} {t.name}
              </option>
            ))}
          </select>

          <select
            className="input py-1.5 text-xs w-auto"
            value={filterAdvisor}
            onChange={(e) => setFilterAdvisor(e.target.value)}
            disabled={!stats?.byAdvisor.length}
            title="Filtrar por asesor"
          >
            <option value="">Todos los asesores</option>
            {stats?.byAdvisor.map((a) => (
              <option key={a.advisorId ?? 'none'} value={a.advisorId ?? ''}>
                {a.advisorName} ({a.count})
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1 text-mute">
            <span>Desde</span>
            <input
              type="date"
              className="input py-1.5 text-xs w-auto"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              max={filterTo || undefined}
            />
            <span>hasta</span>
            <input
              type="date"
              className="input py-1.5 text-xs w-auto"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              min={filterFrom || undefined}
            />
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px] min-w-[820px]">
            <thead className="bg-bg2">
              <tr>
                {['Cliente', 'Negocio', 'Plan', 'Plantilla', 'Asesor', 'Fecha', ''].map((h) => (
                  <th
                    key={h}
                    className="text-left px-4 py-3.5 text-[11px] uppercase tracking-[0.1em] text-mute font-semibold"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`skel-${i}`} className="border-t border-line">
                    {Array.from({ length: 7 }).map((__, j) => (
                      <td key={j} className="px-4 py-4">
                        <div
                          className="h-3 rounded bg-bg2 animate-shimmer"
                          style={{
                            backgroundImage:
                              'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)',
                            backgroundSize: '200% 100%',
                            width: j === 0 ? '70%' : j === 6 ? '40%' : '60%',
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16">
                    <div className="max-w-md mx-auto text-center">
                      <div className="w-14 h-14 mx-auto rounded-full bg-brand-soft text-brand flex items-center justify-center mb-3">
                        <Icon name="clipboard" size={24} />
                      </div>
                      <h3 className="text-base font-semibold m-0">
                        {search || filterPlan !== 'ALL'
                          ? 'Sin resultados'
                          : 'Aún no hay cotizaciones'}
                      </h3>
                      <p className="text-xs text-mute mt-1 leading-relaxed">
                        {search || filterPlan !== 'ALL'
                          ? 'Probá con otros filtros o limpiá la búsqueda.'
                          : 'Generá tu primera propuesta profesional en 5 pasos: cliente, plantilla, plan, preview y PDF.'}
                      </p>
                      {!(search || filterPlan !== 'ALL') && (
                        <Link
                          className="btn-primary mt-4"
                          href="/admin/cotizaciones/nueva"
                        >
                          <Icon name="plus" /> Crear primera cotización
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                list.map((q) => {
                  const template =
                    getQuoteTemplateBySlug(q.templateSlug) ?? FALLBACK_TEMPLATE;
                  return (
                    <tr
                      key={q.id}
                      className="border-t border-line hover:bg-bg2/50"
                    >
                      <td className="px-4 py-3.5">
                        <Link
                          href={`/admin/cotizaciones/${q.id}`}
                          className="font-semibold hover:underline"
                        >
                          {q.customerName}
                        </Link>
                        {q.email || q.phone ? (
                          <div className="text-xs text-mute">
                            {q.email}
                            {q.email && q.phone ? ' · ' : ''}
                            {q.phone}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3.5">{q.businessName}</td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                            q.plan === 'PRO'
                              ? 'bg-brand-soft text-brand-700'
                              : 'bg-bg2 text-ink'
                          }`}
                        >
                          {q.plan}
                        </span>
                        <div className="text-xs text-mute mt-0.5">
                          {fmtMoney(q.priceSnapshot, q.currencySnapshot)}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-sm">
                        {humanizeSlug(q.templateSlug)}
                      </td>
                      <td className="px-4 py-3.5 text-sm">{q.advisorName}</td>
                      <td className="px-4 py-3.5 text-sm text-mute">
                        {fmtDate(q.createdAt)}
                        <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5 text-[11px] font-semibold">
                          {q.viewCount ? (
                            <span
                              className="text-emerald-700"
                              title={
                                q.lastViewedAt
                                  ? `Última vista ${fmtRelative(q.lastViewedAt)}`
                                  : 'Veces que el cliente abrió el link'
                              }
                            >
                              👁 {q.viewCount}
                            </span>
                          ) : null}
                          {q.pdfDownloadCount ? (
                            <span
                              className="text-brand-700"
                              title="Veces que se descargó el PDF"
                            >
                              ↓ {q.pdfDownloadCount}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <DownloadQuotePDFButton
                          iconOnly
                          quoteId={q.id}
                          onDownloaded={load}
                          customerName={q.customerName}
                          businessName={q.businessName}
                          phone={q.phone}
                          email={q.email}
                          plan={q.plan}
                          template={template}
                          price={Number(q.priceSnapshot)}
                          currency={q.currencySnapshot}
                          advisorName={q.advisorName}
                          date={new Date(q.createdAt)}
                          label="Descargar PDF"
                        />
                        <button
                          className="btn-ghost text-bad"
                          onClick={() => remove(q)}
                          title="Eliminar"
                        >
                          <Icon name="trash" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  render,
  loading,
}: {
  label: string;
  value?: string | null;
  sub?: string;
  render?: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="card card-pad">
      <div className="text-[11px] uppercase tracking-[0.1em] text-mute font-semibold">
        {label}
      </div>
      {loading ? (
        <div className="mt-2 h-7 w-16 bg-bg2 rounded animate-shimmer" />
      ) : render ? (
        <div className="mt-1">{render}</div>
      ) : (
        <div className="text-2xl font-bold mt-1">{value ?? '—'}</div>
      )}
      {sub && !loading && (
        <div className="text-xs text-mute mt-0.5">{sub}</div>
      )}
    </div>
  );
}
