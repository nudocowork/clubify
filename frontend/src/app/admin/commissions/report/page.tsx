'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type Afiliado = {
  id: string;
  code: string;
  ownerName: string;
  role: 'INFLUENCER' | 'AMBASSADOR' | 'VENDOR' | 'SOCIO';
  percent: number;
};

type ReportRow = {
  tenantId: string;
  brandName: string;
  status: string;
  planName: string | null;
  planPeriodicity: string | null;
  currentPeriodEnd: string | null;
  base: number;
  afiliado: Afiliado;
  influencer: {
    id: string;
    code: string;
    ownerName: string;
    percent: number;
  } | null;
  comisionDirecta: number;
  comisionIndirecta: number;
  socioPercent: number;
  socio: number;
  totalComisiones: number;
  neto: number;
  registradas: number;
  registradasCount: number;
};

type ReportResp = {
  rows: ReportRow[];
  totals: {
    companies: number;
    base: number;
    comisionDirecta: number;
    comisionIndirecta: number;
    comisiones: number;
    socio: number;
    neto: number;
    registradas: number;
  };
  indirectPercent: number;
  socioPercent: number;
};

const ROLE_LABEL: Record<string, string> = {
  INFLUENCER: 'Influencer',
  AMBASSADOR: 'Embajador',
  VENDOR: 'Vendedor',
  SOCIO: 'Socio',
};

const PERIOD_LABEL: Record<string, string> = {
  MENSUAL: 'Mensual',
  TRIMESTRAL: 'Trimestral',
  SEMESTRAL: 'Semestral',
  ANUAL: 'Anual',
};

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export default function CompanyReportPage() {
  const [data, setData] = useState<ReportResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true);
    try {
      setData(await api<ReportResp>('/admin/commissions/company-report'));
    } catch (e: any) {
      toast(e?.message ?? 'Error cargando el reporte', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const term = q.trim().toLowerCase();
    if (!term) return all;
    return all.filter((r) =>
      `${r.brandName} ${r.afiliado.ownerName} ${r.afiliado.code} ${
        r.influencer?.ownerName ?? ''
      }`
        .toLowerCase()
        .includes(term),
    );
  }, [data, q]);

  function exportCsv() {
    if (!data?.rows.length) {
      toast('Sin filas para exportar', 'info');
      return;
    }
    const headers = [
      'Empresa',
      'Estado',
      'Plan',
      'Periodicidad',
      'Pago del cliente',
      'Afiliado',
      'Rol',
      'Código',
      '% directo',
      'Comisión directa',
      'Influencer (indirecto)',
      '% indirecto',
      'Comisión indirecta',
      '% socio',
      'Socio',
      'Neto empresa (aprox)',
      'Comisiones registradas',
      '# registradas',
    ];
    const csvRows = data.rows.map((r) => [
      r.brandName,
      r.status,
      r.planName ?? '',
      r.planPeriodicity ?? '',
      r.base.toFixed(2),
      r.afiliado.ownerName,
      ROLE_LABEL[r.afiliado.role] ?? r.afiliado.role,
      r.afiliado.code,
      r.afiliado.percent.toFixed(2),
      r.comisionDirecta.toFixed(2),
      r.influencer?.ownerName ?? '',
      r.influencer ? r.influencer.percent.toFixed(2) : '',
      r.comisionIndirecta.toFixed(2),
      r.socioPercent.toFixed(2),
      r.socio.toFixed(2),
      r.neto.toFixed(2),
      r.registradas.toFixed(2),
      String(r.registradasCount),
    ]);
    const csv = [headers, ...csvRows]
      .map((row) =>
        row
          .map((v) => {
            const s = String(v ?? '');
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(','),
      )
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reporte-empresas-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const t = data?.totals;

  return (
    <div className="max-w-7xl">
      <div className="page-head flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">
          Reporte por empresa{' '}
          <span className="page-crumb">/ Contabilidad de comisiones</span>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/commissions"
            className="text-sm px-3.5 py-2 rounded-pill border border-slate-300 bg-white text-slate-700 font-semibold hover:bg-slate-50 transition"
          >
            ← Volver a comisiones
          </Link>
          <button
            onClick={exportCsv}
            className="text-sm px-3.5 py-2 rounded-pill bg-brand text-white font-semibold hover:opacity-90 transition"
          >
            Exportar CSV
          </button>
        </div>
      </div>

      <p className="text-sm text-slate-500 mb-5 max-w-3xl">
        Económica <strong>por ciclo de facturación</strong> sobre la base = lo
        que el cliente paga por su plan (precio canónico del bundle). Por cada
        empresa: pago − comisión del afiliado (directa{' '}
        {data ? `+ ${data.indirectPercent}% indirecto del influencer` : ''}) −{' '}
        {data ? `${data.socioPercent}%` : '10%'} del socio de plataforma = neto
        a la empresa (aprox). La columna <em>Registradas</em> muestra las
        comisiones reales acumuladas (no anuladas) para reconciliar.
      </p>

      {/* KPIs totales */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <KpiCard
          label="Empresas"
          value={t ? String(t.companies) : '—'}
          tone="slate"
        />
        <KpiCard
          label="Pago clientes / ciclo"
          value={t ? usd(t.base) : '—'}
          tone="indigo"
        />
        <KpiCard
          label="Comisiones afiliados"
          value={t ? usd(t.comisiones) : '—'}
          tone="amber"
          sub={
            t
              ? `${usd(t.comisionDirecta)} dir + ${usd(
                  t.comisionIndirecta,
                )} indir`
              : undefined
          }
        />
        <KpiCard
          label={`Socio (${data?.socioPercent ?? 10}%)`}
          value={t ? usd(t.socio) : '—'}
          tone="violet"
        />
        <KpiCard
          label="Neto empresa (aprox)"
          value={t ? usd(t.neto) : '—'}
          tone="emerald"
        />
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar empresa, afiliado o código…"
        className="w-full md:w-80 mb-4 px-3.5 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-brand/30"
      />

      {loading ? (
        <div className="text-sm text-slate-400 py-10 text-center">
          Cargando…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-slate-400 py-10 text-center">
          Sin empresas con atribución de afiliado.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm min-w-[1080px]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200 bg-slate-50">
                <th className="px-3 py-2.5">Empresa</th>
                <th className="px-3 py-2.5">Plan</th>
                <th className="px-3 py-2.5 text-right">Pago cliente</th>
                <th className="px-3 py-2.5">Afiliado</th>
                <th className="px-3 py-2.5 text-right">Directa</th>
                <th className="px-3 py-2.5 text-right">Indirecta</th>
                <th className="px-3 py-2.5 text-right">
                  Socio {data?.socioPercent ?? 10}%
                </th>
                <th className="px-3 py-2.5 text-right">Neto empresa</th>
                <th className="px-3 py-2.5 text-right">Registradas</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.tenantId}
                  className="border-b border-slate-100 hover:bg-slate-50/60"
                >
                  <td className="px-3 py-2.5">
                    <div className="font-semibold text-slate-800">
                      {r.brandName}
                    </div>
                    {r.status !== 'ACTIVE' && (
                      <span className="text-[11px] text-amber-600">
                        {r.status}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">
                    {r.planPeriodicity
                      ? PERIOD_LABEL[r.planPeriodicity] ?? r.planPeriodicity
                      : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-slate-800">
                    {usd(r.base)}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="text-slate-800">
                      {r.afiliado.ownerName}{' '}
                      <span className="text-slate-400">
                        ({r.afiliado.percent}%)
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {ROLE_LABEL[r.afiliado.role] ?? r.afiliado.role} ·{' '}
                      {r.afiliado.code}
                    </div>
                    {r.influencer && (
                      <div className="text-[11px] text-indigo-500">
                        ↳ {r.influencer.ownerName} ({r.influencer.percent}%
                        indir)
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right text-amber-700">
                    {usd(r.comisionDirecta)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-indigo-600">
                    {r.comisionIndirecta > 0 ? usd(r.comisionIndirecta) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right text-violet-600">
                    {usd(r.socio)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-emerald-700">
                    {usd(r.neto)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-500">
                    {usd(r.registradas)}
                    {r.registradasCount > 0 && (
                      <span className="text-[11px] text-slate-400">
                        {' '}
                        ({r.registradasCount})
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {t && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-800">
                  <td className="px-3 py-2.5" colSpan={2}>
                    Total ({t.companies} empresas)
                  </td>
                  <td className="px-3 py-2.5 text-right">{usd(t.base)}</td>
                  <td className="px-3 py-2.5"></td>
                  <td className="px-3 py-2.5 text-right text-amber-700">
                    {usd(t.comisionDirecta)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-indigo-600">
                    {usd(t.comisionIndirecta)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-violet-600">
                    {usd(t.socio)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-emerald-700">
                    {usd(t.neto)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-500">
                    {usd(t.registradas)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: 'slate' | 'indigo' | 'amber' | 'violet' | 'emerald';
}) {
  const toneMap: Record<string, string> = {
    slate: 'text-slate-700',
    indigo: 'text-indigo-600',
    amber: 'text-amber-600',
    violet: 'text-violet-600',
    emerald: 'text-emerald-600',
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className={`text-lg font-bold ${toneMap[tone]}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}
