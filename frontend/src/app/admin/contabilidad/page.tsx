'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

// CONTABILIDAD — Fases 1-2. Ingresos (real por transacción) + Conciliación +
// Egresos (fijo/%, pagos parciales, "por revisar") + Gastos operativos
// (recurrentes). Los demás apartados llegan en fases siguientes; quedan como
// "próximamente". Lee/escribe /admin/contabilidad/*.

type Row = {
  id: string; gateway: string; externalTxId: string; brandName: string | null;
  isFirstPayment: boolean; grossUsd: number; gatewayFeeUsd: number; taxUsd: number;
  netExpectedUsd: number; netReceivedUsd: number | null; differenceUsd: number | null;
  reconStatus: 'PENDING' | 'RECONCILED' | 'REVIEW'; saleDate: string; note?: string | null;
};
type Resumen = { count: number; grossUsd: number; gatewayFeeUsd: number; taxUsd: number; netExpectedUsd: number; netReceivedUsd: number; pendingRecon: number; inReview: number };
type Cat = { id: string; name: string; slug: string; color: string | null; active: boolean };
type Exp = { id: string; concept: string; categoryId: string | null; supplier: string | null; amountUsd: number; amountPaidUsd: number; outstandingUsd: number; status: string; method: string | null; expenseDate: string; pctRate: number | null; pctBase: number | null; receiptUrl: string | null };
type ExpResumen = { count: number; totalUsd: number; paidUsd: number; outstandingUsd: number; pending: number };
type Rec = { id: string; concept: string; categoryId: string | null; supplier: string | null; amountUsd: number; periodicity: string; active: boolean; nextDueDate: string | null };
type PEmp = { id: string; name: string; role: string | null; payType: string | null; amountUsd: number; periodicity: string; active: boolean };
type PRun = { id: string; periodLabel: string; totalUsd: number; amountPaidUsd: number; outstandingUsd: number; status: string; itemCount: number; createdAt: string; paidAt: string | null };
type PResumen = { colaboradores: number; nominaProximaUsd: number; pendienteUsd: number; pagadaUsd: number };
type PItem = { id: string; employeeName: string; role: string | null; baseUsd: number; bonusUsd: number; deductionUsd: number; totalUsd: number };
type Mov = { date: string; kind: 'INGRESO' | 'EGRESO'; category: string; concept: string; party: string | null; grossUsd: number | null; debitUsd: number; creditUsd: number; balanceUsd: number; status: string; reference: string | null; hasReceipt: boolean };
type MovResp = { movements: Mov[]; summary: { ingresosUsd: number; egresosUsd: number; saldoUsd: number; count: number } };

const money = (n: number | null | undefined) =>
  n == null ? '—' : (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s: string) => new Date(s).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });

const GATEWAY_BDG: Record<string, string> = { HOTMART: 'bg-slate-100 text-slate-700', STRIPE: 'bg-indigo-100 text-indigo-700', CROSS: 'bg-blue-100 text-blue-700', MANUAL: 'bg-amber-100 text-amber-800', MERCADOPAGO: 'bg-sky-100 text-sky-700' };
const RECON_BDG: Record<string, { cls: string; label: string }> = { RECONCILED: { cls: 'bg-emerald-100 text-emerald-700', label: 'Conciliado' }, REVIEW: { cls: 'bg-amber-100 text-amber-800', label: 'Revisar' }, PENDING: { cls: 'bg-slate-200 text-slate-600', label: 'Sin conciliar' } };
const EXP_BDG: Record<string, { cls: string; label: string }> = { PAID: { cls: 'bg-emerald-100 text-emerald-700', label: 'Pagado' }, PARTIAL: { cls: 'bg-blue-100 text-blue-700', label: 'Parcial' }, REVIEW: { cls: 'bg-amber-100 text-amber-800', label: 'Por revisar' }, PENDING: { cls: 'bg-slate-200 text-slate-600', label: 'Pendiente' } };

type Tab = 'ingresos' | 'conciliacion' | 'egresos' | 'gastos' | 'nomina' | 'movimientos' | 'reportes' | 'cierres';
const FUTURE_TABS = ['Próximos cobros', 'Comisiones'];
type Reporte = {
  period: string;
  summary: { grossUsd: number; gatewayFeeUsd: number; taxUsd: number; netUsd: number; netReceivedUsd: number; egresosUsd: number; nominaUsd: number; comisionesUsd: number; utilidadUsd: number; ingresosCount: number };
  series: Array<{ period: string; grossUsd: number; egresosUsd: number; nominaUsd: number; comisionesUsd: number; utilidadUsd: number }>;
};
type Cierre = { id: string; period: string; scope: string; grossUsd: string | number; feeTaxUsd: string | number; netUsd: string | number; egresosUsd: string | number; nominaUsd: string | number; comisionesUsd: string | number; utilidadUsd: string | number; note: string | null; closedAt: string };
const EXP_STATUS_LABEL: Record<string, string> = { PAID: 'Pagado', PARTIAL: 'Parcial', PENDING: 'Pendiente' };

export default function ContabilidadPage() {
  const [tab, setTab] = useState<Tab>('ingresos');
  const [scope, setScope] = useState<'clubify' | 'all'>('clubify');
  const [loading, setLoading] = useState(true);

  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [edit, setEdit] = useState<{ id: string; value: string } | null>(null);

  const [cats, setCats] = useState<Cat[]>([]);
  const [exps, setExps] = useState<Exp[]>([]);
  const [expResumen, setExpResumen] = useState<ExpResumen | null>(null);
  const [recs, setRecs] = useState<Rec[]>([]);
  const [showEgreso, setShowEgreso] = useState(false);
  const [showRec, setShowRec] = useState(false);
  const [payFor, setPayFor] = useState<Exp | null>(null);

  const [emps, setEmps] = useState<PEmp[]>([]);
  const [runs, setRuns] = useState<PRun[]>([]);
  const [pRes, setPRes] = useState<PResumen | null>(null);
  const [showEmp, setShowEmp] = useState(false);
  const [showGen, setShowGen] = useState(false);
  const [payRun, setPayRun] = useState<PRun | null>(null);
  const [detailRun, setDetailRun] = useState<string | null>(null);

  const [mov, setMov] = useState<MovResp | null>(null);
  const [movKind, setMovKind] = useState<'' | 'INGRESO' | 'EGRESO'>('');
  const [reporte, setReporte] = useState<Reporte | null>(null);
  const [cierres, setCierres] = useState<Cierre[]>([]);
  const [repPeriod, setRepPeriod] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, list, c, e, er, rc, em, ru, pr, mv, rep, ci] = await Promise.all([
        api<Resumen>(`/admin/contabilidad/ingresos/resumen?scope=${scope}`).catch(() => null),
        api<Row[]>(`/admin/contabilidad/ingresos?scope=${scope}`).catch(() => []),
        api<Cat[]>(`/admin/contabilidad/categorias`).catch(() => []),
        api<Exp[]>(`/admin/contabilidad/egresos?scope=${scope}`).catch(() => []),
        api<ExpResumen>(`/admin/contabilidad/egresos/resumen?scope=${scope}`).catch(() => null),
        api<Rec[]>(`/admin/contabilidad/gastos-recurrentes?scope=${scope}`).catch(() => []),
        api<PEmp[]>(`/admin/contabilidad/nomina/colaboradores?scope=${scope}`).catch(() => []),
        api<PRun[]>(`/admin/contabilidad/nomina/cortes?scope=${scope}`).catch(() => []),
        api<PResumen>(`/admin/contabilidad/nomina/resumen?scope=${scope}`).catch(() => null),
        api<MovResp>(`/admin/contabilidad/movimientos?scope=${scope}${movKind ? `&kind=${movKind}` : ''}`).catch(() => null),
        api<Reporte>(`/admin/contabilidad/reporte?scope=${scope}&period=${repPeriod}`).catch(() => null),
        api<Cierre[]>(`/admin/contabilidad/cierres?scope=${scope}`).catch(() => []),
      ]);
      setResumen(r); setRows((list ?? []) as Row[]); setCats((c ?? []) as Cat[]);
      setExps((e ?? []) as Exp[]); setExpResumen(er); setRecs((rc ?? []) as Rec[]);
      setEmps((em ?? []) as PEmp[]); setRuns((ru ?? []) as PRun[]); setPRes(pr);
      setMov(mv); setReporte(rep); setCierres((ci ?? []) as Cierre[]);
    } finally { setLoading(false); }
  }, [scope, movKind, repPeriod]);
  useEffect(() => { void load(); }, [load]);

  const catName = useMemo(() => Object.fromEntries(cats.map((c) => [c.id, c.name])), [cats]);

  async function conciliar(id: string, value: string) {
    const net = Number(value.replace(',', '.'));
    if (!Number.isFinite(net)) { toast('Escribe un monto válido'); return; }
    const res = await api<{ ok: boolean; reconStatus?: string; differenceUsd?: number }>(`/admin/contabilidad/ingresos/${id}/conciliar`, { method: 'PATCH', body: JSON.stringify({ netReceivedUsd: net }) }).catch(() => null);
    if (res?.ok) { toast(res.reconStatus === 'RECONCILED' ? 'Conciliado ✅' : `Guardado · dif ${money(res.differenceUsd ?? 0)}`); setEdit(null); void load(); }
    else toast('No se pudo conciliar');
  }
  const conciliables = rows.filter((r) => r.reconStatus !== 'RECONCILED');

  async function cerrarMes() {
    if (!/^\d{4}-\d{2}$/.test(repPeriod)) { toast('Elegí un mes válido'); return; }
    const r = await api(`/admin/contabilidad/cierres`, { method: 'POST', body: JSON.stringify({ period: repPeriod, scope }) }).catch(() => null);
    if (r) { toast(`Mes ${repPeriod} cerrado ✅`, 'success'); void load(); } else toast('No se pudo cerrar el mes', 'error');
  }
  async function reabrirMes(id: string, period: string) {
    if (!window.confirm(`¿Reabrir ${period}? Se borra el cierre y se podrá recalcular.`)) return;
    await api(`/admin/contabilidad/cierres/${id}`, { method: 'DELETE' }).catch(() => null);
    toast(`${period} reabierto`, 'success'); void load();
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Contabilidad <span className="page-crumb">/ Centro financiero</span></h1>
        <div className="inline-flex bg-bg2 border border-line rounded-pill p-1">
          <button onClick={() => setScope('clubify')} className={`px-3 py-1.5 rounded-pill text-xs font-semibold ${scope === 'clubify' ? 'bg-white shadow-sm2 text-ink' : 'text-mute'}`}>Clubify</button>
          <button onClick={() => setScope('all')} className={`px-3 py-1.5 rounded-pill text-xs font-semibold ${scope === 'all' ? 'bg-white shadow-sm2 text-ink' : 'text-mute'}`}>Todas las marcas</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-line2 overflow-x-auto">
        {([['ingresos', 'Ingresos'], ['conciliacion', `Conciliación${resumen && resumen.pendingRecon + resumen.inReview > 0 ? ` (${resumen.pendingRecon + resumen.inReview})` : ''}`], ['egresos', 'Egresos'], ['gastos', 'Gastos operativos'], ['nomina', 'Nómina'], ['movimientos', 'Movimientos'], ['reportes', 'Reportes'], ['cierres', 'Cierres']] as [Tab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap ${tab === id ? 'border-brand text-brand' : 'border-transparent text-mute hover:text-ink'}`}>{label}</button>
        ))}
        {FUTURE_TABS.map((t) => (
          <span key={t} className="px-4 py-2.5 text-sm font-semibold text-mute2 whitespace-nowrap cursor-not-allowed" title="Próxima fase">{t} <span className="text-[9px] align-top">pronto</span></span>
        ))}
      </div>

      {loading ? <div className="card card-pad text-center text-mute">Cargando…</div> : (
        <>
          {/* ===== INGRESOS / CONCILIACIÓN ===== */}
          {(tab === 'ingresos' || tab === 'conciliacion') && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              <Kpi lbl="Ventas brutas" dot="#22C55E" val={money(resumen?.grossUsd ?? 0)} sub={`${resumen?.count ?? 0} cobros`} />
              <Kpi lbl="Fee + impuestos" dot="#DC2626" val={money((resumen?.gatewayFeeUsd ?? 0) + (resumen?.taxUsd ?? 0))} sub={`fee ${money(resumen?.gatewayFeeUsd ?? 0)} · imp ${money(resumen?.taxUsd ?? 0)}`} />
              <Kpi lbl="Neto esperado" dot="#2563EB" val={money(resumen?.netExpectedUsd ?? 0)} sub="después de deducciones" />
              <Kpi lbl="Neto recibido" dot="#16A34A" val={money(resumen?.netReceivedUsd ?? 0)} sub={`${resumen?.pendingRecon ?? 0} sin conciliar · ${resumen?.inReview ?? 0} a revisar`} />
            </div>
          )}

          {tab === 'ingresos' && (rows.length === 0 ? <EmptyState what="ingresos" /> : (
            <div className="card overflow-hidden p-0"><div className="overflow-x-auto"><table className="w-full text-sm min-w-[1050px]">
              <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider"><tr>
                {['Fecha', 'Negocio', 'Tipo', 'Pasarela'].map((h) => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}
                {['V. bruta', 'Fee', 'Impuesto', 'Neto esp.', 'Neto recib.', 'Dif.'].map((h) => <th key={h} className="px-4 py-3 font-semibold text-right">{h}</th>)}
                <th className="px-4 py-3 font-semibold">Estado</th>
              </tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id} className="border-t border-line2 hover:bg-bg2/40">
                  <td className="px-4 py-3">{fmtDate(r.saleDate)}</td>
                  <td className="px-4 py-3 font-semibold">{r.brandName ?? '—'}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${r.isFirstPayment ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'}`}>{r.isFirstPayment ? '1er pago' : 'Recurr.'}</span></td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${GATEWAY_BDG[r.gateway] ?? 'bg-slate-100 text-slate-700'}`}>{r.gateway}</span></td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(r.grossUsd)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-bad">{money(-r.gatewayFeeUsd)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-bad">{money(-r.taxUsd)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{money(r.netExpectedUsd)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(r.netReceivedUsd)}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${r.differenceUsd ? 'text-warn' : ''}`}>{r.differenceUsd == null ? '—' : money(r.differenceUsd)}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${RECON_BDG[r.reconStatus].cls}`}>{RECON_BDG[r.reconStatus].label}</span></td>
                </tr>
              ))}</tbody>
            </table></div></div>
          ))}

          {tab === 'conciliacion' && (conciliables.length === 0 ? <div className="card card-pad text-center text-mute">Todo conciliado ✅</div> : (
            <div className="grid md:grid-cols-2 gap-3">{conciliables.map((r) => (
              <div key={r.id} className={`card card-pad ${r.reconStatus === 'REVIEW' ? 'border-amber-300' : ''}`}>
                <div className="flex justify-between items-center mb-2"><b>{r.brandName ?? '—'}</b><span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${RECON_BDG[r.reconStatus].cls}`}>{RECON_BDG[r.reconStatus].label}</span></div>
                <div className="text-xs text-mute mb-3">{r.gateway} · {r.externalTxId} · {fmtDate(r.saleDate)}</div>
                <div className="flex justify-between py-1 text-sm border-b border-dashed border-line"><span>Venta bruta</span><b>{money(r.grossUsd)}</b></div>
                <div className="flex justify-between py-1 text-sm border-b border-dashed border-line"><span>− Fee pasarela</span><span className="text-bad">{money(-r.gatewayFeeUsd)}</span></div>
                <div className="flex justify-between py-1 text-sm border-b border-dashed border-line"><span>− Impuesto</span><span className="text-bad">{money(-r.taxUsd)}</span></div>
                <div className="flex justify-between py-1.5 text-sm font-bold border-b-2 border-ink"><span>Neto esperado</span><span>{money(r.netExpectedUsd)}</span></div>
                <div className="mt-3"><label className="label">Neto realmente recibido</label><div className="flex gap-2">
                  <input className="input flex-1" placeholder={String(r.netExpectedUsd)} value={edit?.id === r.id ? edit.value : (r.netReceivedUsd != null ? String(r.netReceivedUsd) : '')} onChange={(ev) => setEdit({ id: r.id, value: ev.target.value })} />
                  <button className="btn-primary text-sm px-4 rounded-pill" onClick={() => conciliar(r.id, edit?.id === r.id ? edit.value : String(r.netExpectedUsd))}>Conciliar</button>
                </div></div>
              </div>
            ))}</div>
          ))}

          {/* ===== EGRESOS ===== */}
          {tab === 'egresos' && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <Kpi lbl="Total egresos" dot="#DC2626" val={money(expResumen?.totalUsd ?? 0)} sub={`${expResumen?.count ?? 0} egresos`} />
                <Kpi lbl="Pagado" dot="#16A34A" val={money(expResumen?.paidUsd ?? 0)} sub="con comprobante" />
                <Kpi lbl="Pendiente" dot="#D97706" val={money(expResumen?.outstandingUsd ?? 0)} sub={`${expResumen?.pending ?? 0} sin pagar/revisar`} />
                <div className="card card-pad flex items-center justify-center"><button className="btn-primary rounded-pill" onClick={() => setShowEgreso(true)}>+ Nuevo egreso</button></div>
              </div>
              {exps.length === 0 ? <EmptyState what="egresos" cta={() => setShowEgreso(true)} /> : (
                <div className="card overflow-hidden p-0"><div className="overflow-x-auto"><table className="w-full text-sm min-w-[950px]">
                  <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider"><tr>
                    <th className="px-4 py-3 font-semibold">Fecha</th><th className="px-4 py-3 font-semibold">Concepto</th><th className="px-4 py-3 font-semibold">Categoría</th><th className="px-4 py-3 font-semibold">Proveedor</th>
                    <th className="px-4 py-3 font-semibold text-right">Monto</th><th className="px-4 py-3 font-semibold text-right">Pagado</th><th className="px-4 py-3 font-semibold text-right">Saldo</th><th className="px-4 py-3 font-semibold">Estado</th><th className="px-4 py-3"></th>
                  </tr></thead>
                  <tbody>{exps.map((e) => (
                    <tr key={e.id} className="border-t border-line2 hover:bg-bg2/40">
                      <td className="px-4 py-3">{fmtDate(e.expenseDate)}</td>
                      <td className="px-4 py-3 font-semibold">{e.concept}{e.pctRate != null ? <span className="text-mute font-normal"> · {e.pctRate}% de {money(e.pctBase)}</span> : null}</td>
                      <td className="px-4 py-3">{e.categoryId ? catName[e.categoryId] ?? '—' : '—'}</td>
                      <td className="px-4 py-3 text-mute">{e.supplier ?? '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(e.amountUsd)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(e.amountPaidUsd)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${e.outstandingUsd > 0 ? 'text-warn font-medium' : ''}`}>{money(e.outstandingUsd)}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${(EXP_BDG[e.status] ?? EXP_BDG.PENDING).cls}`}>{(EXP_BDG[e.status] ?? EXP_BDG.PENDING).label}</span></td>
                      <td className="px-4 py-3">{e.status !== 'PAID' && <button className="text-xs font-semibold text-brand hover:underline" onClick={() => setPayFor(e)}>Registrar pago</button>}</td>
                    </tr>
                  ))}</tbody>
                </table></div></div>
              )}
            </>
          )}

          {/* ===== GASTOS OPERATIVOS (recurrentes) ===== */}
          {tab === 'gastos' && (
            <>
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <p className="text-mute text-sm m-0">Gastos que se repiten cada período (el sistema genera el compromiso; no lo marca pagado solo).</p>
                <button className="btn-primary rounded-pill text-sm" onClick={() => setShowRec(true)}>+ Nuevo gasto recurrente</button>
              </div>
              {recs.length === 0 ? <EmptyState what="gastos recurrentes" cta={() => setShowRec(true)} /> : (
                <div className="card overflow-hidden p-0"><div className="overflow-x-auto"><table className="w-full text-sm min-w-[800px]">
                  <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider"><tr>
                    <th className="px-4 py-3 font-semibold">Concepto</th><th className="px-4 py-3 font-semibold">Categoría</th><th className="px-4 py-3 font-semibold">Proveedor</th><th className="px-4 py-3 font-semibold text-right">Monto</th><th className="px-4 py-3 font-semibold">Periodicidad</th><th className="px-4 py-3 font-semibold">Estado</th>
                  </tr></thead>
                  <tbody>{recs.map((r) => (
                    <tr key={r.id} className="border-t border-line2 hover:bg-bg2/40">
                      <td className="px-4 py-3 font-semibold">{r.concept}</td>
                      <td className="px-4 py-3">{r.categoryId ? catName[r.categoryId] ?? '—' : '—'}</td>
                      <td className="px-4 py-3 text-mute">{r.supplier ?? '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(r.amountUsd)}</td>
                      <td className="px-4 py-3">{r.periodicity}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${r.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{r.active ? 'Activo' : 'Inactivo'}</span></td>
                    </tr>
                  ))}</tbody>
                </table></div></div>
              )}
            </>
          )}

          {/* ===== NÓMINA ===== */}
          {tab === 'nomina' && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <Kpi lbl="Nómina próxima" dot="#7C3AED" val={money(pRes?.nominaProximaUsd ?? 0)} sub={`${pRes?.colaboradores ?? 0} colaboradores`} />
                <Kpi lbl="Pendiente" dot="#D97706" val={money(pRes?.pendienteUsd ?? 0)} sub="cortes sin pagar" />
                <Kpi lbl="Pagada" dot="#16A34A" val={money(pRes?.pagadaUsd ?? 0)} sub="acumulado" />
                <div className="card card-pad flex items-center justify-center gap-2">
                  <button className="btn-primary rounded-pill text-sm" onClick={() => setShowGen(true)}>Generar pago</button>
                  <button className="btn-ghost rounded-pill text-sm" onClick={() => setShowEmp(true)}>+ Colaborador</button>
                </div>
              </div>
              <div className="card overflow-hidden p-0 mb-5"><div className="overflow-x-auto"><table className="w-full text-sm min-w-[700px]">
                <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider"><tr>
                  <th className="px-4 py-3 font-semibold">Colaborador</th><th className="px-4 py-3 font-semibold">Cargo</th><th className="px-4 py-3 font-semibold">Tipo</th><th className="px-4 py-3 font-semibold text-right">Monto</th><th className="px-4 py-3 font-semibold">Periodicidad</th><th className="px-4 py-3 font-semibold">Estado</th>
                </tr></thead>
                <tbody>{emps.length === 0 ? <tr><td colSpan={6} className="px-4 py-6 text-center text-mute">Sin colaboradores — agregá el primero.</td></tr> : emps.map((e) => (
                  <tr key={e.id} className="border-t border-line2 hover:bg-bg2/40">
                    <td className="px-4 py-3 font-semibold">{e.name}</td>
                    <td className="px-4 py-3">{e.role ?? '—'}</td>
                    <td className="px-4 py-3">{e.payType ?? '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(e.amountUsd)}</td>
                    <td className="px-4 py-3">{e.periodicity}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${e.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{e.active ? 'Activo' : 'Inactivo'}</span></td>
                  </tr>
                ))}</tbody>
              </table></div></div>
              <div className="font-semibold text-sm mb-2">Cortes de nómina</div>
              {runs.length === 0 ? <div className="card card-pad text-center text-mute">Sin cortes todavía. Generá un pago con los colaboradores.</div> : (
                <div className="card overflow-hidden p-0"><div className="overflow-x-auto"><table className="w-full text-sm min-w-[750px]">
                  <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider"><tr>
                    <th className="px-4 py-3 font-semibold">Período</th><th className="px-4 py-3 font-semibold text-right">Colab.</th><th className="px-4 py-3 font-semibold text-right">Total</th><th className="px-4 py-3 font-semibold text-right">Pagado</th><th className="px-4 py-3 font-semibold text-right">Saldo</th><th className="px-4 py-3 font-semibold">Estado</th><th className="px-4 py-3"></th>
                  </tr></thead>
                  <tbody>{runs.map((r) => (
                    <tr key={r.id} className="border-t border-line2 hover:bg-bg2/40">
                      <td className="px-4 py-3 font-semibold"><button className="hover:underline text-left" onClick={() => setDetailRun(r.id)}>{r.periodLabel}</button></td>
                      <td className="px-4 py-3 text-right">{r.itemCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(r.totalUsd)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(r.amountPaidUsd)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${r.outstandingUsd > 0 ? 'text-warn font-medium' : ''}`}>{money(r.outstandingUsd)}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${(EXP_BDG[r.status] ?? EXP_BDG.PENDING).cls}`}>{EXP_STATUS_LABEL[r.status] ?? r.status}</span></td>
                      <td className="px-4 py-3">{r.status !== 'PAID' && <button className="text-xs font-semibold text-brand hover:underline" onClick={() => setPayRun(r)}>Registrar pago</button>}</td>
                    </tr>
                  ))}</tbody>
                </table></div></div>
              )}
            </>
          )}

          {/* ===== MOVIMIENTOS (F4): libro unificado ingresos + egresos ===== */}
          {tab === 'movimientos' && (
            <>
              {mov && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                  <Kpi lbl="Ingresos" dot="#16A34A" val={money(mov.summary.ingresosUsd)} sub={`${mov.summary.count} movimientos`} />
                  <Kpi lbl="Egresos" dot="#DC2626" val={money(mov.summary.egresosUsd)} sub="salidas" />
                  <Kpi lbl="Saldo" dot="#2563EB" val={money(mov.summary.saldoUsd)} sub="ingresos − egresos" />
                  <Kpi lbl="Total" dot="#6B7280" val={String(mov.summary.count)} sub="registros" />
                </div>
              )}
              <div className="flex gap-1.5 mb-3">
                {([['', 'Todos'], ['INGRESO', 'Ingresos'], ['EGRESO', 'Egresos']] as ['' | 'INGRESO' | 'EGRESO', string][]).map(([k, lbl]) => (
                  <button key={k} onClick={() => setMovKind(k)} className={`text-xs px-3 py-1 rounded-pill border transition ${movKind === k ? 'bg-brand/10 border-brand text-brand font-semibold' : 'border-line2 text-mute hover:text-ink'}`}>{lbl}</button>
                ))}
              </div>
              {!mov || mov.movements.length === 0 ? (
                <div className="card card-pad text-center text-mute">Sin movimientos en este alcance.</div>
              ) : (
                <div className="card overflow-hidden p-0"><div className="overflow-x-auto"><table className="w-full text-sm min-w-[900px]">
                  <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider"><tr>
                    <th className="px-4 py-3 font-semibold">Fecha</th>
                    <th className="px-4 py-3 font-semibold">Tipo</th>
                    <th className="px-4 py-3 font-semibold">Categoría</th>
                    <th className="px-4 py-3 font-semibold">Concepto</th>
                    <th className="px-4 py-3 font-semibold text-right">Débito</th>
                    <th className="px-4 py-3 font-semibold text-right">Crédito</th>
                    <th className="px-4 py-3 font-semibold text-right">Saldo</th>
                  </tr></thead>
                  <tbody>
                    {mov.movements.map((m, i) => (
                      <tr key={i} className="border-t border-line2">
                        <td className="px-4 py-3 whitespace-nowrap">{new Date(m.date).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                        <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${m.kind === 'INGRESO' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{m.kind === 'INGRESO' ? 'Ingreso' : 'Egreso'}</span></td>
                        <td className="px-4 py-3 text-mute whitespace-nowrap">{m.category}</td>
                        <td className="px-4 py-3">{m.concept}{m.party && <span className="text-mute"> · {m.party}</span>}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-red-600">{m.debitUsd ? money(m.debitUsd) : '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-emerald-600">{m.creditUsd ? money(m.creditUsd) : '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium">{money(m.balanceUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div></div>
              )}
            </>
          )}

          {/* ===== REPORTES (F6): cascada de utilidad + serie mensual ===== */}
          {tab === 'reportes' && (
            <>
              <div className="flex items-center gap-2 mb-4">
                <label className="text-sm text-mute">Mes:</label>
                <input type="month" className="input" value={repPeriod} onChange={(e) => setRepPeriod(e.target.value)} />
              </div>
              {!reporte ? <div className="card card-pad text-center text-mute">Sin datos.</div> : (
                <div className="grid md:grid-cols-2 gap-4 mb-5">
                  <div className="card card-pad">
                    <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-3">Cascada de utilidad · {repPeriod}</div>
                    <div className="flex justify-between py-1.5 text-sm"><span className="text-mute">Ingresos brutos</span><span className="tabular-nums font-medium">{money(reporte.summary.grossUsd)}</span></div>
                    <div className="flex justify-between py-1.5 text-sm"><span className="text-mute">− Fee pasarela + impuestos</span><span className="tabular-nums text-red-600">−{money(reporte.summary.gatewayFeeUsd + reporte.summary.taxUsd)}</span></div>
                    <div className="flex justify-between py-1.5 text-sm border-t border-line2"><span className="font-semibold">= Neto</span><span className="tabular-nums font-semibold">{money(reporte.summary.netUsd)}</span></div>
                    <div className="flex justify-between py-1.5 text-sm"><span className="text-mute">− Egresos</span><span className="tabular-nums text-red-600">−{money(reporte.summary.egresosUsd)}</span></div>
                    <div className="flex justify-between py-1.5 text-sm"><span className="text-mute">− Nómina</span><span className="tabular-nums text-red-600">−{money(reporte.summary.nominaUsd)}</span></div>
                    <div className="flex justify-between py-1.5 text-sm"><span className="text-mute">− Comisiones afiliados</span><span className="tabular-nums text-red-600">−{money(reporte.summary.comisionesUsd)}</span></div>
                    <div className="flex justify-between py-2.5 mt-1 border-t-2 border-line2"><span className="font-bold">= UTILIDAD</span><span className={`tabular-nums font-bold text-lg ${reporte.summary.utilidadUsd >= 0 ? 'text-ok' : 'text-red-600'}`}>{money(reporte.summary.utilidadUsd)}</span></div>
                  </div>
                  <div className="card card-pad">
                    <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-3">Utilidad · últimos 6 meses</div>
                    <table className="w-full text-sm"><tbody>
                      {reporte.series.map((s) => (
                        <tr key={s.period} className="border-t border-line2">
                          <td className="py-2 text-mute">{s.period}</td>
                          <td className="py-2 text-right tabular-nums text-mute2 text-xs">bruto {money(s.grossUsd)}</td>
                          <td className={`py-2 text-right tabular-nums font-semibold ${s.utilidadUsd >= 0 ? 'text-ok' : 'text-red-600'}`}>{money(s.utilidadUsd)}</td>
                        </tr>
                      ))}
                    </tbody></table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ===== CIERRES (F5): cierre mensual con snapshot ===== */}
          {tab === 'cierres' && (
            <>
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <label className="text-sm text-mute">Cerrar mes:</label>
                <input type="month" className="input" value={repPeriod} onChange={(e) => setRepPeriod(e.target.value)} />
                <button onClick={cerrarMes} className="text-sm px-4 py-2 rounded-md bg-brand text-white font-semibold hover:opacity-90">Cerrar {repPeriod}</button>
                {reporte && <span className="text-xs text-mute">Utilidad calculada: <strong className={reporte.summary.utilidadUsd >= 0 ? 'text-ok' : 'text-red-600'}>{money(reporte.summary.utilidadUsd)}</strong></span>}
              </div>
              {cierres.length === 0 ? (
                <div className="card card-pad text-center text-mute">Ningún mes cerrado todavía. Cerrar un mes congela su utilidad.</div>
              ) : (
                <div className="card overflow-hidden p-0"><div className="overflow-x-auto"><table className="w-full text-sm min-w-[820px]">
                  <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider"><tr>
                    <th className="px-4 py-3 font-semibold">Mes</th>
                    <th className="px-4 py-3 font-semibold text-right">Bruto</th>
                    <th className="px-4 py-3 font-semibold text-right">Neto</th>
                    <th className="px-4 py-3 font-semibold text-right">Egresos</th>
                    <th className="px-4 py-3 font-semibold text-right">Nómina</th>
                    <th className="px-4 py-3 font-semibold text-right">Comisiones</th>
                    <th className="px-4 py-3 font-semibold text-right">Utilidad</th>
                    <th className="px-4 py-3 font-semibold">Cerrado</th>
                    <th className="px-4 py-3 font-semibold"></th>
                  </tr></thead>
                  <tbody>
                    {cierres.map((c) => (
                      <tr key={c.id} className="border-t border-line2">
                        <td className="px-4 py-3 font-medium">{c.period}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{money(Number(c.grossUsd))}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{money(Number(c.netUsd))}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-red-600">{money(Number(c.egresosUsd))}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-red-600">{money(Number(c.nominaUsd))}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-red-600">{money(Number(c.comisionesUsd))}</td>
                        <td className={`px-4 py-3 text-right tabular-nums font-semibold ${Number(c.utilidadUsd) >= 0 ? 'text-ok' : 'text-red-600'}`}>{money(Number(c.utilidadUsd))}</td>
                        <td className="px-4 py-3 text-mute text-xs whitespace-nowrap">{new Date(c.closedAt).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                        <td className="px-4 py-3"><button onClick={() => reabrirMes(c.id, c.period)} className="text-xs text-red-600 hover:underline">Reabrir</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table></div></div>
              )}
            </>
          )}
        </>
      )}

      {showEgreso && <EgresoModal cats={cats} onClose={() => setShowEgreso(false)} onSaved={() => { setShowEgreso(false); void load(); }} />}
      {showRec && <RecurrenteModal cats={cats} onClose={() => setShowRec(false)} onSaved={() => { setShowRec(false); void load(); }} />}
      {payFor && <PagoModal exp={payFor} onClose={() => setPayFor(null)} onSaved={() => { setPayFor(null); void load(); }} />}
      {showEmp && <EmpModal onClose={() => setShowEmp(false)} onSaved={() => { setShowEmp(false); void load(); }} />}
      {showGen && <GenModal emps={emps.filter((e) => e.active)} onClose={() => setShowGen(false)} onSaved={() => { setShowGen(false); void load(); }} />}
      {payRun && <PayRunModal run={payRun} onClose={() => setPayRun(null)} onSaved={() => { setPayRun(null); void load(); }} />}
      {detailRun && <RunDetailModal id={detailRun} onClose={() => setDetailRun(null)} />}
    </div>
  );
}

function Kpi({ lbl, dot, val, sub }: { lbl: string; dot: string; val: string; sub: string }) {
  return (
    <div className="card card-pad">
      <div className="text-[10.5px] uppercase tracking-wide text-mute font-semibold flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: dot }} />{lbl}</div>
      <div className="text-xl font-bold mt-1 tabular-nums">{val}</div>
      <div className="text-[11px] text-mute mt-0.5">{sub}</div>
    </div>
  );
}
function EmptyState({ what, cta }: { what: string; cta?: () => void }) {
  return (
    <div className="card card-pad text-center">
      <div className="text-3xl mb-2">📊</div>
      <b>Todavía no hay {what}</b>
      <p className="text-mute text-sm mt-1 max-w-md mx-auto">{cta ? 'Creá el primero para empezar a llevar el control.' : 'Aparecerán aquí a medida que entren.'}</p>
      {cta && <button className="btn-primary rounded-pill mt-3" onClick={cta}>+ Crear</button>}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-surface rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="px-5 py-4 border-b border-line2 flex items-center justify-between"><b className="text-base">{title}</b><button className="text-mute text-xl" onClick={onClose}>×</button></div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function EgresoModal({ cats, onClose, onSaved }: { cats: Cat[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ concept: '', categoryId: '', supplier: '', amountUsd: '', method: 'Tarjeta', account: '', status: 'PENDING', note: '' });
  const [mode, setMode] = useState<'fijo' | 'pct'>('fijo');
  const [pct, setPct] = useState({ rate: '8.6', base: '' });
  const [busy, setBusy] = useState(false);
  const calc = mode === 'pct' ? (Number(pct.rate.replace(',', '.')) || 0) * (Number(pct.base.replace(',', '.')) || 0) / 100 : 0;
  async function save() {
    if (!f.concept.trim()) { toast('Ponle un concepto'); return; }
    setBusy(true);
    const body: any = { concept: f.concept, categoryId: f.categoryId || undefined, supplier: f.supplier || undefined, method: f.method, account: f.account || undefined, status: f.status, note: f.note || undefined };
    if (mode === 'pct') { body.pctRate = Number(pct.rate.replace(',', '.')); body.pctBase = Number(pct.base.replace(',', '.')); }
    else body.amountUsd = Number(f.amountUsd.replace(',', '.'));
    const r = await api(`/admin/contabilidad/egresos`, { method: 'POST', body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (r) { toast('Egreso guardado'); onSaved(); } else toast('No se pudo guardar');
  }
  return (
    <Modal title="Crear egreso" onClose={onClose}>
      <div className="mb-3"><label className="label">Concepto</label><input className="input w-full" value={f.concept} onChange={(e) => setF({ ...f, concept: e.target.value })} placeholder="Fee pasarela, Meta Ads, Railway…" /></div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className="label">Categoría</label><select className="input w-full" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">—</option>{cats.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label className="label">Proveedor / persona</label><input className="input w-full" value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} placeholder="Opcional" /></div>
      </div>
      <div className="mb-3">
        <label className="label">Tipo de monto</label>
        <div className="inline-flex bg-bg2 border border-line rounded-pill p-1 mb-2">
          <button type="button" onClick={() => setMode('fijo')} className={`px-3 py-1.5 rounded-pill text-xs font-semibold ${mode === 'fijo' ? 'bg-white shadow-sm2' : 'text-mute'}`}>Fijo</button>
          <button type="button" onClick={() => setMode('pct')} className={`px-3 py-1.5 rounded-pill text-xs font-semibold ${mode === 'pct' ? 'bg-white shadow-sm2' : 'text-mute'}`}>Porcentaje</button>
        </div>
        {mode === 'fijo' ? <input className="input w-full" value={f.amountUsd} onChange={(e) => setF({ ...f, amountUsd: e.target.value })} placeholder="$0,00" /> : (
          <div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="flex items-center gap-1"><input className="input w-full text-right" value={pct.rate} onChange={(e) => setPct({ ...pct, rate: e.target.value })} /><span className="font-semibold">%</span></div>
              <div className="flex items-center gap-1"><span className="text-xs text-mute whitespace-nowrap">sobre</span><input className="input w-full text-right" value={pct.base} onChange={(e) => setPct({ ...pct, base: e.target.value })} placeholder="base" /></div>
            </div>
            <div className="bg-bg2 rounded-lg px-3 py-2 flex justify-between text-sm"><span>Monto calculado</span><b>{money(calc)}</b></div>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className="label">Método</label><select className="input w-full" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option>Tarjeta</option><option>Transferencia</option><option>Binance</option><option>Nequi</option><option>Efectivo</option></select></div>
        <div><label className="label">Estado</label><select className="input w-full" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="PENDING">Pendiente</option><option value="REVIEW">Por revisar</option><option value="PAID">Pagado</option></select></div>
      </div>
      <div className="flex gap-2 justify-end"><button className="btn-ghost rounded-pill" onClick={onClose}>Cancelar</button><button className="btn-primary rounded-pill" disabled={busy} onClick={save}>Guardar egreso</button></div>
    </Modal>
  );
}

function RecurrenteModal({ cats, onClose, onSaved }: { cats: Cat[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ concept: '', categoryId: '', supplier: '', amountUsd: '', periodicity: 'MENSUAL' });
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!f.concept.trim() || !f.amountUsd) { toast('Concepto y monto'); return; }
    setBusy(true);
    const r = await api(`/admin/contabilidad/gastos-recurrentes`, { method: 'POST', body: JSON.stringify({ concept: f.concept, categoryId: f.categoryId || undefined, supplier: f.supplier || undefined, amountUsd: Number(f.amountUsd.replace(',', '.')), periodicity: f.periodicity }) }).catch(() => null);
    setBusy(false);
    if (r) { toast('Gasto recurrente guardado'); onSaved(); } else toast('No se pudo guardar');
  }
  return (
    <Modal title="Nuevo gasto recurrente" onClose={onClose}>
      <div className="mb-3"><label className="label">Concepto</label><input className="input w-full" value={f.concept} onChange={(e) => setF({ ...f, concept: e.target.value })} placeholder="Railway, Claude, Meta Ads…" /></div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className="label">Categoría</label><select className="input w-full" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">—</option>{cats.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label className="label">Proveedor</label><input className="input w-full" value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} placeholder="Opcional" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div><label className="label">Monto</label><input className="input w-full" value={f.amountUsd} onChange={(e) => setF({ ...f, amountUsd: e.target.value })} placeholder="$0,00" /></div>
        <div><label className="label">Periodicidad</label><select className="input w-full" value={f.periodicity} onChange={(e) => setF({ ...f, periodicity: e.target.value })}><option>MENSUAL</option><option>QUINCENAL</option><option>ANUAL</option><option>PERSONALIZADO</option></select></div>
      </div>
      <div className="flex gap-2 justify-end"><button className="btn-ghost rounded-pill" onClick={onClose}>Cancelar</button><button className="btn-primary rounded-pill" disabled={busy} onClick={save}>Guardar</button></div>
    </Modal>
  );
}

function PagoModal({ exp, onClose, onSaved }: { exp: Exp; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(String(exp.outstandingUsd));
  const [method, setMethod] = useState('Transferencia');
  const [busy, setBusy] = useState(false);
  async function save() {
    const n = Number(amount.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) { toast('Monto inválido'); return; }
    setBusy(true);
    const r = await api<{ ok: boolean; status?: string; outstanding?: number }>(`/admin/contabilidad/egresos/${exp.id}/pago`, { method: 'PATCH', body: JSON.stringify({ amountPaidUsd: n, method }) }).catch(() => null);
    setBusy(false);
    if (r?.ok) { toast(r.status === 'PAID' ? 'Pagado ✅' : `Parcial · saldo ${money(r.outstanding ?? 0)}`); onSaved(); } else toast('No se pudo registrar');
  }
  return (
    <Modal title={`Registrar pago — ${exp.concept}`} onClose={onClose}>
      <div className="bg-bg2 rounded-lg px-4 py-3 mb-4 flex justify-between text-sm"><span>Total {money(exp.amountUsd)} · Pagado {money(exp.amountPaidUsd)}</span><b>Saldo {money(exp.outstandingUsd)}</b></div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className="label">Monto a pagar</label><input className="input w-full" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div><label className="label">Método</label><select className="input w-full" value={method} onChange={(e) => setMethod(e.target.value)}><option>Transferencia</option><option>Binance</option><option>Nequi</option><option>Tarjeta</option><option>Efectivo</option></select></div>
      </div>
      <p className="text-xs text-mute mb-4">Podés pagar el total o una parte. Un pago parcial deja el saldo pendiente con historial.</p>
      <div className="flex gap-2 justify-end"><button className="btn-ghost rounded-pill" onClick={onClose}>Cancelar</button><button className="btn-primary rounded-pill" disabled={busy} onClick={save}>Registrar pago</button></div>
    </Modal>
  );
}

function EmpModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: '', role: '', payType: 'Fijo', amountUsd: '', periodicity: 'QUINCENAL' });
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!f.name.trim() || !f.amountUsd) { toast('Nombre y monto'); return; }
    setBusy(true);
    const r = await api(`/admin/contabilidad/nomina/colaboradores`, { method: 'POST', body: JSON.stringify({ name: f.name, role: f.role || undefined, payType: f.payType, amountUsd: Number(f.amountUsd.replace(',', '.')), periodicity: f.periodicity }) }).catch(() => null);
    setBusy(false);
    if (r) { toast('Colaborador guardado'); onSaved(); } else toast('No se pudo guardar');
  }
  return (
    <Modal title="Nuevo colaborador" onClose={onClose}>
      <div className="mb-3"><label className="label">Nombre</label><input className="input w-full" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className="label">Cargo</label><input className="input w-full" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder="Marketing, Soporte…" /></div>
        <div><label className="label">Tipo de pago</label><select className="input w-full" value={f.payType} onChange={(e) => setF({ ...f, payType: e.target.value })}><option>Fijo</option><option>Por proyecto</option></select></div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div><label className="label">Monto</label><input className="input w-full" value={f.amountUsd} onChange={(e) => setF({ ...f, amountUsd: e.target.value })} placeholder="$0,00" /></div>
        <div><label className="label">Periodicidad</label><select className="input w-full" value={f.periodicity} onChange={(e) => setF({ ...f, periodicity: e.target.value })}><option>QUINCENAL</option><option>MENSUAL</option><option>PERSONALIZADO</option></select></div>
      </div>
      <div className="flex gap-2 justify-end"><button className="btn-ghost rounded-pill" onClick={onClose}>Cancelar</button><button className="btn-primary rounded-pill" disabled={busy} onClick={save}>Guardar</button></div>
    </Modal>
  );
}

function GenModal({ emps, onClose, onSaved }: { emps: PEmp[]; onClose: () => void; onSaved: () => void }) {
  const [period, setPeriod] = useState('');
  const [sel, setSel] = useState<Record<string, { on: boolean; bonus: string; ded: string }>>(() => Object.fromEntries(emps.map((e) => [e.id, { on: true, bonus: '', ded: '' }])));
  const [busy, setBusy] = useState(false);
  const rowTotal = (e: PEmp) => { const s = sel[e.id]; return e.amountUsd + (Number((s?.bonus || '0').replace(',', '.')) || 0) - (Number((s?.ded || '0').replace(',', '.')) || 0); };
  const total = emps.filter((e) => sel[e.id]?.on).reduce((a, e) => a + rowTotal(e), 0);
  async function save() {
    const items = emps.filter((e) => sel[e.id]?.on).map((e) => ({ employeeId: e.id, employeeName: e.name, role: e.role, baseUsd: e.amountUsd, bonusUsd: Number((sel[e.id].bonus || '0').replace(',', '.')) || 0, deductionUsd: Number((sel[e.id].ded || '0').replace(',', '.')) || 0 }));
    if (!period.trim() || items.length === 0) { toast('Período y al menos un colaborador'); return; }
    setBusy(true);
    const r = await api(`/admin/contabilidad/nomina/cortes`, { method: 'POST', body: JSON.stringify({ periodLabel: period, items }) }).catch(() => null);
    setBusy(false);
    if (r) { toast('Corte de nómina generado'); onSaved(); } else toast('No se pudo generar');
  }
  return (
    <Modal title="Generar pago de nómina" onClose={onClose}>
      <div className="mb-3"><label className="label">Período</label><input className="input w-full" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="Quincena 1–15 sep 2026" /></div>
      <div className="mb-3">
        <label className="label">Colaboradores</label>
        {emps.length === 0 ? <p className="text-mute text-sm">No hay colaboradores activos. Agregá uno primero.</p> : (
          <div className="flex flex-col gap-2">{emps.map((e) => (
            <div key={e.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={sel[e.id]?.on ?? false} onChange={(ev) => setSel({ ...sel, [e.id]: { ...(sel[e.id] ?? { bonus: '', ded: '' }), on: ev.target.checked } })} />
              <span className="flex-1 truncate">{e.name} <span className="text-mute">· {money(e.amountUsd)}</span></span>
              <input className="input w-20 text-right py-1" placeholder="+bono" value={sel[e.id]?.bonus ?? ''} onChange={(ev) => setSel({ ...sel, [e.id]: { ...(sel[e.id] ?? { on: true, ded: '' }), bonus: ev.target.value } })} />
              <input className="input w-20 text-right py-1" placeholder="−deduc" value={sel[e.id]?.ded ?? ''} onChange={(ev) => setSel({ ...sel, [e.id]: { ...(sel[e.id] ?? { on: true, bonus: '' }), ded: ev.target.value } })} />
              <span className="w-20 text-right tabular-nums font-medium">{money(rowTotal(e))}</span>
            </div>
          ))}</div>
        )}
      </div>
      <div className="bg-bg2 rounded-lg px-4 py-3 mb-4 flex justify-between font-bold"><span>Total a pagar</span><span>{money(total)}</span></div>
      <div className="flex gap-2 justify-end"><button className="btn-ghost rounded-pill" onClick={onClose}>Cancelar</button><button className="btn-primary rounded-pill" disabled={busy} onClick={save}>Generar corte</button></div>
    </Modal>
  );
}

function PayRunModal({ run, onClose, onSaved }: { run: PRun; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(String(run.outstandingUsd));
  const [method, setMethod] = useState('Transferencia');
  const [busy, setBusy] = useState(false);
  async function save() {
    const n = Number(amount.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) { toast('Monto inválido'); return; }
    setBusy(true);
    const r = await api<{ ok: boolean; status?: string; outstanding?: number }>(`/admin/contabilidad/nomina/cortes/${run.id}/pago`, { method: 'PATCH', body: JSON.stringify({ amountPaidUsd: n, method }) }).catch(() => null);
    setBusy(false);
    if (r?.ok) { toast(r.status === 'PAID' ? 'Pagado ✅' : `Parcial · saldo ${money(r.outstanding ?? 0)}`); onSaved(); } else toast('No se pudo registrar');
  }
  return (
    <Modal title={`Registrar pago — ${run.periodLabel}`} onClose={onClose}>
      <div className="bg-bg2 rounded-lg px-4 py-3 mb-4 flex justify-between text-sm"><span>Total {money(run.totalUsd)} · Pagado {money(run.amountPaidUsd)}</span><b>Saldo {money(run.outstandingUsd)}</b></div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className="label">Monto a pagar</label><input className="input w-full" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div><label className="label">Método</label><select className="input w-full" value={method} onChange={(e) => setMethod(e.target.value)}><option>Transferencia</option><option>Binance</option><option>Nequi</option><option>Efectivo</option></select></div>
      </div>
      <div className="flex gap-2 justify-end"><button className="btn-ghost rounded-pill" onClick={onClose}>Cancelar</button><button className="btn-primary rounded-pill" disabled={busy} onClick={save}>Registrar pago</button></div>
    </Modal>
  );
}

function RunDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [items, setItems] = useState<PItem[] | null>(null);
  const [label, setLabel] = useState('');
  useEffect(() => {
    api<{ periodLabel: string; items: PItem[] }>(`/admin/contabilidad/nomina/cortes/${id}`).then((d) => { if (d) { setItems(d.items); setLabel(d.periodLabel); } }).catch(() => setItems([]));
  }, [id]);
  return (
    <Modal title={`Detalle — ${label || 'corte'}`} onClose={onClose}>
      {items == null ? <p className="text-mute">Cargando…</p> : items.length === 0 ? <p className="text-mute">Sin ítems.</p> : (
        <table className="w-full text-sm">
          <thead className="text-mute text-[11px] uppercase"><tr><th className="text-left py-1">Colaborador</th><th className="text-right py-1">Base</th><th className="text-right py-1">Bono</th><th className="text-right py-1">Deduc</th><th className="text-right py-1">Total</th></tr></thead>
          <tbody>{items.map((it) => (
            <tr key={it.id} className="border-t border-line2"><td className="py-2">{it.employeeName}{it.role ? <span className="text-mute"> · {it.role}</span> : null}</td><td className="text-right tabular-nums">{money(it.baseUsd)}</td><td className="text-right tabular-nums">{money(it.bonusUsd)}</td><td className="text-right tabular-nums text-bad">{money(it.deductionUsd)}</td><td className="text-right tabular-nums font-medium">{money(it.totalUsd)}</td></tr>
          ))}</tbody>
        </table>
      )}
    </Modal>
  );
}
