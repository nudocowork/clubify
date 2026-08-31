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

const money = (n: number | null | undefined) =>
  n == null ? '—' : (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s: string) => new Date(s).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });

const GATEWAY_BDG: Record<string, string> = { HOTMART: 'bg-slate-100 text-slate-700', STRIPE: 'bg-indigo-100 text-indigo-700', CROSS: 'bg-blue-100 text-blue-700', MANUAL: 'bg-amber-100 text-amber-800', MERCADOPAGO: 'bg-sky-100 text-sky-700' };
const RECON_BDG: Record<string, { cls: string; label: string }> = { RECONCILED: { cls: 'bg-emerald-100 text-emerald-700', label: 'Conciliado' }, REVIEW: { cls: 'bg-amber-100 text-amber-800', label: 'Revisar' }, PENDING: { cls: 'bg-slate-200 text-slate-600', label: 'Sin conciliar' } };
const EXP_BDG: Record<string, { cls: string; label: string }> = { PAID: { cls: 'bg-emerald-100 text-emerald-700', label: 'Pagado' }, PARTIAL: { cls: 'bg-blue-100 text-blue-700', label: 'Parcial' }, REVIEW: { cls: 'bg-amber-100 text-amber-800', label: 'Por revisar' }, PENDING: { cls: 'bg-slate-200 text-slate-600', label: 'Pendiente' } };

type Tab = 'ingresos' | 'conciliacion' | 'egresos' | 'gastos';
const FUTURE_TABS = ['Próximos cobros', 'Comisiones', 'Nómina', 'Movimientos', 'Cierres', 'Reportes'];

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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, list, c, e, er, rc] = await Promise.all([
        api<Resumen>(`/admin/contabilidad/ingresos/resumen?scope=${scope}`).catch(() => null),
        api<Row[]>(`/admin/contabilidad/ingresos?scope=${scope}`).catch(() => []),
        api<Cat[]>(`/admin/contabilidad/categorias`).catch(() => []),
        api<Exp[]>(`/admin/contabilidad/egresos?scope=${scope}`).catch(() => []),
        api<ExpResumen>(`/admin/contabilidad/egresos/resumen?scope=${scope}`).catch(() => null),
        api<Rec[]>(`/admin/contabilidad/gastos-recurrentes?scope=${scope}`).catch(() => []),
      ]);
      setResumen(r); setRows((list ?? []) as Row[]); setCats((c ?? []) as Cat[]);
      setExps((e ?? []) as Exp[]); setExpResumen(er); setRecs((rc ?? []) as Rec[]);
    } finally { setLoading(false); }
  }, [scope]);
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
        {([['ingresos', 'Ingresos'], ['conciliacion', `Conciliación${resumen && resumen.pendingRecon + resumen.inReview > 0 ? ` (${resumen.pendingRecon + resumen.inReview})` : ''}`], ['egresos', 'Egresos'], ['gastos', 'Gastos operativos']] as [Tab, string][]).map(([id, label]) => (
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
        </>
      )}

      {showEgreso && <EgresoModal cats={cats} onClose={() => setShowEgreso(false)} onSaved={() => { setShowEgreso(false); void load(); }} />}
      {showRec && <RecurrenteModal cats={cats} onClose={() => setShowRec(false)} onSaved={() => { setShowRec(false); void load(); }} />}
      {payFor && <PagoModal exp={payFor} onClose={() => setPayFor(null)} onSaved={() => { setPayFor(null); void load(); }} />}
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
