'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

// CONTABILIDAD — Fase 1. Ingresos reales (bruto/fee/impuesto/neto) + conciliación.
// Los demás apartados (Egresos, Nómina, Comisiones, Movimientos, Cierres…) llegan
// en las fases siguientes; acá quedan visibles como "próximamente" para no perder
// el mapa del módulo. Lee /admin/contabilidad/* (solo lectura + conciliar).

type Row = {
  id: string;
  gateway: string;
  externalTxId: string;
  brandName: string | null;
  planPeriodicity: string | null;
  isFirstPayment: boolean;
  grossUsd: number;
  gatewayFeeUsd: number;
  taxUsd: number;
  netExpectedUsd: number;
  netReceivedUsd: number | null;
  differenceUsd: number | null;
  reconStatus: 'PENDING' | 'RECONCILED' | 'REVIEW';
  saleDate: string;
};
type Resumen = {
  count: number;
  grossUsd: number;
  gatewayFeeUsd: number;
  taxUsd: number;
  netExpectedUsd: number;
  netReceivedUsd: number;
  pendingRecon: number;
  inReview: number;
};

const money = (n: number | null | undefined) =>
  n == null
    ? '—'
    : (n < 0 ? '-$' : '$') +
      Math.abs(n).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });

const GATEWAY_BDG: Record<string, string> = {
  HOTMART: 'bg-slate-100 text-slate-700',
  STRIPE: 'bg-indigo-100 text-indigo-700',
  CROSS: 'bg-blue-100 text-blue-700',
  MANUAL: 'bg-amber-100 text-amber-800',
  MERCADOPAGO: 'bg-sky-100 text-sky-700',
};
const RECON_BDG: Record<string, { cls: string; label: string }> = {
  RECONCILED: { cls: 'bg-emerald-100 text-emerald-700', label: 'Conciliado' },
  REVIEW: { cls: 'bg-amber-100 text-amber-800', label: 'Revisar' },
  PENDING: { cls: 'bg-slate-200 text-slate-600', label: 'Sin conciliar' },
};

const FUTURE_TABS = ['Próximos cobros', 'Egresos', 'Comisiones', 'Nómina', 'Gastos operativos', 'Movimientos', 'Cierres', 'Reportes'];

export default function ContabilidadPage() {
  const [tab, setTab] = useState<'ingresos' | 'conciliacion'>('ingresos');
  const [scope, setScope] = useState<'clubify' | 'all'>('clubify');
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<{ id: string; value: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, list] = await Promise.all([
        api<Resumen>(`/admin/contabilidad/ingresos/resumen?scope=${scope}`).catch(() => null),
        api<Row[]>(`/admin/contabilidad/ingresos?scope=${scope}`).catch(() => []),
      ]);
      setResumen(r);
      setRows((list ?? []) as Row[]);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  async function conciliar(id: string, value: string) {
    const net = Number(value.replace(',', '.'));
    if (!Number.isFinite(net)) {
      toast('Escribe un monto válido');
      return;
    }
    try {
      const res = await api<{ ok: boolean; reconStatus?: string; differenceUsd?: number }>(
        `/admin/contabilidad/ingresos/${id}/conciliar`,
        { method: 'PATCH', body: JSON.stringify({ netReceivedUsd: net }) },
      );
      if (res?.ok) {
        toast(
          res.reconStatus === 'RECONCILED'
            ? 'Conciliado ✅'
            : `Guardado · diferencia ${money(res.differenceUsd ?? 0)}`,
        );
        setEdit(null);
        void load();
      }
    } catch {
      toast('No se pudo conciliar');
    }
  }

  const conciliables = rows.filter((r) => r.reconStatus !== 'RECONCILED');

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Contabilidad <span className="page-crumb">/ Centro financiero</span>
        </h1>
        <div className="flex items-center gap-2">
          <div className="inline-flex bg-bg2 border border-line rounded-pill p-1">
            <button
              onClick={() => setScope('clubify')}
              className={`px-3 py-1.5 rounded-pill text-xs font-semibold ${scope === 'clubify' ? 'bg-white shadow-sm2 text-ink' : 'text-mute'}`}
            >
              Clubify
            </button>
            <button
              onClick={() => setScope('all')}
              className={`px-3 py-1.5 rounded-pill text-xs font-semibold ${scope === 'all' ? 'bg-white shadow-sm2 text-ink' : 'text-mute'}`}
            >
              Todas las marcas
            </button>
          </div>
        </div>
      </div>
      <p className="text-mute text-sm mb-4">
        Fase 1 — Ingresos reales por transacción (venta bruta → fee → impuesto → neto) y conciliación.
        Los ingresos se capturan solos en cada cobro; aquí no se crean a mano.
      </p>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-line2 overflow-x-auto">
        <button
          onClick={() => setTab('ingresos')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap ${tab === 'ingresos' ? 'border-brand text-brand' : 'border-transparent text-mute hover:text-ink'}`}
        >
          Ingresos
        </button>
        <button
          onClick={() => setTab('conciliacion')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap ${tab === 'conciliacion' ? 'border-brand text-brand' : 'border-transparent text-mute hover:text-ink'}`}
        >
          Conciliación {resumen && resumen.pendingRecon + resumen.inReview > 0 ? `(${resumen.pendingRecon + resumen.inReview})` : ''}
        </button>
        {FUTURE_TABS.map((t) => (
          <span key={t} className="px-4 py-2.5 text-sm font-semibold text-mute2 whitespace-nowrap cursor-not-allowed" title="Próxima fase">
            {t} <span className="text-[9px] align-top">pronto</span>
          </span>
        ))}
      </div>

      {/* Resumen KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi lbl="Ventas brutas" dot="#22C55E" val={money(resumen?.grossUsd ?? 0)} sub={`${resumen?.count ?? 0} cobros`} />
        <Kpi lbl="Fee + impuestos" dot="#DC2626" val={money((resumen?.gatewayFeeUsd ?? 0) + (resumen?.taxUsd ?? 0))} sub={`fee ${money(resumen?.gatewayFeeUsd ?? 0)} · imp ${money(resumen?.taxUsd ?? 0)}`} />
        <Kpi lbl="Neto esperado" dot="#2563EB" val={money(resumen?.netExpectedUsd ?? 0)} sub="después de deducciones" />
        <Kpi lbl="Neto recibido" dot="#16A34A" val={money(resumen?.netReceivedUsd ?? 0)} sub={`${resumen?.pendingRecon ?? 0} sin conciliar · ${resumen?.inReview ?? 0} a revisar`} />
      </div>

      {loading ? (
        <div className="card card-pad text-center text-mute">Cargando…</div>
      ) : tab === 'ingresos' ? (
        rows.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1050px]">
                <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Fecha</th>
                    <th className="px-4 py-3 font-semibold">Negocio</th>
                    <th className="px-4 py-3 font-semibold">Tipo</th>
                    <th className="px-4 py-3 font-semibold">Pasarela</th>
                    <th className="px-4 py-3 font-semibold text-right">V. bruta</th>
                    <th className="px-4 py-3 font-semibold text-right">Fee</th>
                    <th className="px-4 py-3 font-semibold text-right">Impuesto</th>
                    <th className="px-4 py-3 font-semibold text-right">Neto esp.</th>
                    <th className="px-4 py-3 font-semibold text-right">Neto recib.</th>
                    <th className="px-4 py-3 font-semibold text-right">Dif.</th>
                    <th className="px-4 py-3 font-semibold">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-line2 hover:bg-bg2/40">
                      <td className="px-4 py-3">{fmtDate(r.saleDate)}</td>
                      <td className="px-4 py-3 font-semibold">{r.brandName ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${r.isFirstPayment ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'}`}>
                          {r.isFirstPayment ? '1er pago' : 'Recurr.'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${GATEWAY_BDG[r.gateway] ?? 'bg-slate-100 text-slate-700'}`}>{r.gateway}</span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(r.grossUsd)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-bad">{money(-r.gatewayFeeUsd)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-bad">{money(-r.taxUsd)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{money(r.netExpectedUsd)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(r.netReceivedUsd)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${r.differenceUsd ? 'text-warn' : ''}`}>{r.differenceUsd == null ? '—' : money(r.differenceUsd)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${RECON_BDG[r.reconStatus].cls}`}>{RECON_BDG[r.reconStatus].label}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : conciliables.length === 0 ? (
        <div className="card card-pad text-center text-mute">Todo conciliado ✅</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {conciliables.map((r) => (
            <div key={r.id} className={`card card-pad ${r.reconStatus === 'REVIEW' ? 'border-amber-300' : ''}`}>
              <div className="flex justify-between items-center mb-2">
                <b>{r.brandName ?? '—'}</b>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${RECON_BDG[r.reconStatus].cls}`}>{RECON_BDG[r.reconStatus].label}</span>
              </div>
              <div className="text-xs text-mute mb-3">{r.gateway} · {r.externalTxId} · {fmtDate(r.saleDate)}</div>
              <div className="flex justify-between py-1 text-sm border-b border-dashed border-line"><span>Venta bruta</span><b>{money(r.grossUsd)}</b></div>
              <div className="flex justify-between py-1 text-sm border-b border-dashed border-line"><span>− Fee pasarela</span><span className="text-bad">{money(-r.gatewayFeeUsd)}</span></div>
              <div className="flex justify-between py-1 text-sm border-b border-dashed border-line"><span>− Impuesto</span><span className="text-bad">{money(-r.taxUsd)}</span></div>
              <div className="flex justify-between py-1.5 text-sm font-bold border-b-2 border-ink"><span>Neto esperado</span><span>{money(r.netExpectedUsd)}</span></div>
              <div className="mt-3">
                <label className="label">Neto realmente recibido</label>
                <div className="flex gap-2">
                  <input
                    className="input flex-1"
                    placeholder={String(r.netExpectedUsd)}
                    value={edit?.id === r.id ? edit.value : (r.netReceivedUsd != null ? String(r.netReceivedUsd) : '')}
                    onChange={(e) => setEdit({ id: r.id, value: e.target.value })}
                  />
                  <button
                    className="btn-primary text-sm px-4 rounded-pill"
                    onClick={() => conciliar(r.id, edit?.id === r.id ? edit.value : String(r.netExpectedUsd))}
                  >
                    Conciliar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Kpi({ lbl, dot, val, sub }: { lbl: string; dot: string; val: string; sub: string }) {
  return (
    <div className="card card-pad">
      <div className="text-[10.5px] uppercase tracking-wide text-mute font-semibold flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full" style={{ background: dot }} />
        {lbl}
      </div>
      <div className="text-xl font-bold mt-1 tabular-nums">{val}</div>
      <div className="text-[11px] text-mute mt-0.5">{sub}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card card-pad text-center">
      <div className="text-3xl mb-2">📊</div>
      <b>Todavía no hay ingresos registrados</b>
      <p className="text-mute text-sm mt-1 max-w-md mx-auto">
        Cada cobro nuevo (Hotmart, Stripe, Cross o pago manual) se registrará aquí automáticamente con su
        desglose bruto → fee → impuesto → neto. El histórico empieza desde que se activa este módulo.
      </p>
    </div>
  );
}
