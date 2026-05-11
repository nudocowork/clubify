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
  createdAt: string;
};

type ListResp = { items: Quote[]; total: number; take: number; skip: number };

type Stats = {
  total: number;
  last30dCount: number;
  byPlan: { plan: Plan; count: number }[];
  byAdvisor: { advisorId: string | null; advisorName: string; count: number }[];
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
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
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterPlan !== 'ALL') params.set('plan', filterPlan);
      if (search.trim()) params.set('search', search.trim());
      const [resp, st] = await Promise.all([
        api<ListResp>(`/admin/quotes?${params.toString()}`),
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
  }, [filterPlan]);

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

  const topAdvisor = stats?.byAdvisor?.[0];

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Cotizaciones{' '}
          <span className="page-crumb">/ {total} registros</span>
        </h1>
        <div className="flex gap-2 flex-wrap">
          <Link className="btn-secondary" href="/admin/cotizaciones/precios">
            <Icon name="gear" /> Editar precios
          </Link>
          <Link className="btn-primary" href="/admin/cotizaciones/nueva">
            <Icon name="plus" /> Nueva cotización
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="card card-pad">
          <div className="text-[11px] uppercase tracking-[0.1em] text-mute font-semibold">Total</div>
          <div className="text-2xl font-bold mt-1">{stats?.total ?? '—'}</div>
        </div>
        <div className="card card-pad">
          <div className="text-[11px] uppercase tracking-[0.1em] text-mute font-semibold">Últimos 30 días</div>
          <div className="text-2xl font-bold mt-1">{stats?.last30dCount ?? '—'}</div>
        </div>
        <div className="card card-pad">
          <div className="text-[11px] uppercase tracking-[0.1em] text-mute font-semibold">Elite / Pro</div>
          <div className="text-2xl font-bold mt-1">
            <span className="text-brand">{byPlanMap.ELITE}</span>
            <span className="text-mute mx-1">/</span>
            <span className="text-brand">{byPlanMap.PRO}</span>
          </div>
        </div>
        <div className="card card-pad">
          <div className="text-[11px] uppercase tracking-[0.1em] text-mute font-semibold">Top asesor</div>
          <div className="text-sm font-semibold mt-1 truncate" title={topAdvisor?.advisorName}>
            {topAdvisor ? topAdvisor.advisorName : '—'}
          </div>
          <div className="text-xs text-mute">
            {topAdvisor ? `${topAdvisor.count} cotización${topAdvisor.count === 1 ? '' : 'es'}` : ''}
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="mb-3.5 flex flex-wrap gap-3 items-center">
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
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-mute">
                    Cargando…
                  </td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <div className="text-mute text-sm">
                      Aún no hay cotizaciones.{' '}
                      <Link
                        href="/admin/cotizaciones/nueva"
                        className="text-brand font-semibold hover:underline"
                      >
                        Crear la primera →
                      </Link>
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
                      </td>
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <DownloadQuotePDFButton
                          iconOnly
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
