'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  SIGNED_UP: { text: 'Inscrito', cls: 'bg-bg2 text-mute' },
  ACTIVE: { text: 'En trial', cls: 'bg-amber-100 text-amber-800' },
  PAYING: { text: 'Pagando', cls: 'bg-ok-soft text-ok' },
  CHURNED: { text: 'Canceló', cls: 'bg-red-100 text-red-800' },
};

type Tab = 'leaderboard' | 'payouts' | 'codes';

type LeaderRow = {
  ownerName: string;
  ownerEmail: string;
  ownerWhatsapp: string;
  codes: string[];
  totalReferrals: number;
  paidConversions: number;
  commissionsPaidUsd: number;
  commissionsPendingUsd: number;
  revenueGeneratedUsd: number;
};

type PayoutItem = {
  id: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED';
  createdAt: string;
  availableAt: string;
  paidAt: string | null;
  ownerName: string;
  ownerEmail: string;
  ownerWhatsapp: string;
  codeText: string;
  tenantBrand: string;
};

type PayoutsResp = {
  items: PayoutItem[];
  totals: { availableUsd: number; pendingUsd: number; paidUsd: number; count: number };
  holdDays: number;
};

function fmtUsd(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(n);
}

function fmtDate(d: string | Date | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function daysFromNow(d: string | Date) {
  const diff = (new Date(d).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  return Math.ceil(diff);
}

const PAYOUT_STATUS: Record<PayoutItem['status'], { text: string; cls: string }> = {
  PENDING: { text: 'En hold', cls: 'bg-amber-100 text-amber-800' },
  APPROVED: { text: 'Disponible', cls: 'bg-ok-soft text-ok' },
  PAID: { text: 'Pagado', cls: 'bg-bg2 text-mute' },
  REJECTED: { text: 'Rechazado', cls: 'bg-red-100 text-red-800' },
};

export default function AdminReferrals() {
  const [tab, setTab] = useState<Tab>('leaderboard');

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Referidos</h1>
      </div>

      <div className="tabs mb-5">
        <button
          className={`tab ${tab === 'leaderboard' ? 'tab-active' : ''}`}
          onClick={() => setTab('leaderboard')}
        >
          🏆 Leaderboard
        </button>
        <button
          className={`tab ${tab === 'payouts' ? 'tab-active' : ''}`}
          onClick={() => setTab('payouts')}
        >
          💰 Pendientes por pagar
        </button>
        <button
          className={`tab ${tab === 'codes' ? 'tab-active' : ''}`}
          onClick={() => setTab('codes')}
        >
          🔗 Códigos
        </button>
      </div>

      {tab === 'leaderboard' && <LeaderboardTab />}
      {tab === 'payouts' && <PayoutsTab />}
      {tab === 'codes' && <CodesTab />}
    </div>
  );
}

// =============================================================
//                       LEADERBOARD TAB
// =============================================================

function LeaderboardTab() {
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setRows(await api<LeaderRow[]>('/referrals/leaderboard'));
    } catch (e: any) {
      toast(e.message || 'Error cargando leaderboard', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        affiliates: acc.affiliates + 1,
        referrals: acc.referrals + r.totalReferrals,
        conversions: acc.conversions + r.paidConversions,
        revenue: acc.revenue + r.revenueGeneratedUsd,
      }),
      { affiliates: 0, referrals: 0, conversions: 0, revenue: 0 },
    );
  }, [rows]);

  return (
    <div>
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="Afiliados" value={totals.affiliates.toString()} />
        <Kpi label="Inscritos totales" value={totals.referrals.toString()} />
        <Kpi label="Conversiones pagas" value={totals.conversions.toString()} tone="ok" />
        <Kpi label="Revenue generado" value={fmtUsd(totals.revenue)} tone="brand" />
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="bg-bg2">
              <tr>
                {['#', 'Afiliado', 'Inscritos', 'Conversiones', 'Revenue', 'Pagado', 'Pendiente'].map(
                  (h) => (
                    <th
                      key={h}
                      className="text-left px-4 py-3 text-[11px] uppercase tracking-[0.1em] text-mute font-semibold"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="border-t border-line2">
                    <td colSpan={7} className="px-4 py-3.5">
                      <div className="h-6 bg-bg2 rounded animate-shimmer" />
                    </td>
                  </tr>
                ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td className="px-4 py-12 text-center text-mute" colSpan={7}>
                    <div className="text-3xl mb-2">🏁</div>
                    <div className="font-semibold text-ink">Sin afiliados todavía</div>
                    <div className="text-xs mt-1">
                      Cuando alguien se registre en /refer aparecerá en el ranking.
                    </div>
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((r, i) => (
                  <tr
                    key={r.ownerEmail}
                    className="border-t border-line2 hover:bg-[#FAFAFB] transition"
                  >
                    <td className="px-4 py-3.5 font-bold text-lg">
                      {i === 0 ? (
                        <span className="text-amber-500">🥇</span>
                      ) : i === 1 ? (
                        <span className="text-mute">🥈</span>
                      ) : i === 2 ? (
                        <span className="text-amber-700">🥉</span>
                      ) : (
                        <span className="text-mute text-base">{i + 1}</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="font-medium">{r.ownerName}</div>
                      <div className="text-xs text-mute">{r.ownerEmail}</div>
                      {r.codes.length > 1 && (
                        <div className="text-[10px] text-mute mt-0.5">
                          {r.codes.length} códigos: {r.codes.join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3.5 font-medium">{r.totalReferrals}</td>
                    <td className="px-4 py-3.5">
                      <span className="badge badge-ok">{r.paidConversions}</span>
                    </td>
                    <td className="px-4 py-3.5 font-medium">
                      {fmtUsd(r.revenueGeneratedUsd)}
                    </td>
                    <td className="px-4 py-3.5 text-ok font-medium">
                      {fmtUsd(r.commissionsPaidUsd)}
                    </td>
                    <td className="px-4 py-3.5 text-amber-700 font-medium">
                      {fmtUsd(r.commissionsPendingUsd)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'brand' | 'warn';
}) {
  const toneCls =
    tone === 'ok'
      ? 'text-ok'
      : tone === 'brand'
      ? 'text-brand'
      : tone === 'warn'
      ? 'text-amber-700'
      : 'text-ink';
  return (
    <div className="card card-pad">
      <div className="text-[11px] uppercase tracking-[0.12em] text-mute font-semibold">
        {label}
      </div>
      <div className={`text-2xl font-bold mt-1 ${toneCls}`}>{value}</div>
    </div>
  );
}

// =============================================================
//                         PAYOUTS TAB
// =============================================================

function PayoutsTab() {
  const [data, setData] = useState<PayoutsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<
    'AVAILABLE_OR_PENDING' | 'APPROVED' | 'PENDING' | 'PAID' | 'ALL'
  >('AVAILABLE_OR_PENDING');
  const [q, setQ] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (q.trim()) params.set('q', q.trim());
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      const url = `/referrals/payouts${params.toString() ? `?${params}` : ''}`;
      setData(await api<PayoutsResp>(url));
    } catch (e: any) {
      toast(e.message || 'Error cargando payouts', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, dateFrom, dateTo]);

  // Búsqueda con debounce
  useEffect(() => {
    const t = setTimeout(() => load(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function markPaid(id: string) {
    setBusyId(id);
    try {
      await api(`/referrals/commissions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'PAID' }),
      });
      toast('Comisión marcada como pagada', 'success');
      load();
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    if (!confirm('¿Rechazar esta comisión? Se marcará como REJECTED.')) return;
    setBusyId(id);
    try {
      await api(`/referrals/commissions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'REJECTED' }),
      });
      toast('Comisión rechazada', 'success');
      load();
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <Kpi
          label="Disponible para pagar"
          value={fmtUsd(data?.totals.availableUsd ?? 0)}
          tone="ok"
        />
        <Kpi
          label="En hold (no llegó a 30d)"
          value={fmtUsd(data?.totals.pendingUsd ?? 0)}
          tone="warn"
        />
        <Kpi label="Pagado histórico" value={fmtUsd(data?.totals.paidUsd ?? 0)} tone="brand" />
      </div>

      {/* Filtros */}
      <div className="card card-pad mb-3 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[160px]">
          <label className="label">Buscar</label>
          <input
            className="input"
            placeholder="Nombre, email, código, negocio…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Estado</label>
          <select
            className="input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
          >
            <option value="AVAILABLE_OR_PENDING">Disponible + En hold</option>
            <option value="APPROVED">Solo disponibles</option>
            <option value="PENDING">Solo en hold</option>
            <option value="PAID">Pagados</option>
            <option value="ALL">Todos</option>
          </select>
        </div>
        <div>
          <label className="label">Desde</label>
          <input
            type="date"
            className="input"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Hasta</label>
          <input
            type="date"
            className="input"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
      </div>

      <div className="text-xs text-mute mb-2">
        🛈 Hold de {data?.holdDays ?? 30} días desde la creación de la comisión —
        después pasa automáticamente a "Disponible para pagar".
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead className="bg-bg2">
              <tr>
                {['Afiliado', 'Negocio', 'Monto', 'Estado', 'Creada', 'Disponible', 'Pagada', ''].map(
                  (h) => (
                    <th
                      key={h}
                      className="text-left px-4 py-3 text-[11px] uppercase tracking-[0.1em] text-mute font-semibold"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="border-t border-line2">
                    <td colSpan={8} className="px-4 py-3.5">
                      <div className="h-6 bg-bg2 rounded animate-shimmer" />
                    </td>
                  </tr>
                ))}
              {!loading && (data?.items.length ?? 0) === 0 && (
                <tr>
                  <td className="px-4 py-12 text-center text-mute" colSpan={8}>
                    <div className="text-3xl mb-2">💸</div>
                    <div className="font-semibold text-ink">
                      Sin comisiones con estos filtros
                    </div>
                  </td>
                </tr>
              )}
              {!loading &&
                data?.items.map((c) => {
                  const st = PAYOUT_STATUS[c.status];
                  const dayDiff = daysFromNow(c.availableAt);
                  return (
                    <tr key={c.id} className="border-t border-line2 hover:bg-[#FAFAFB]">
                      <td className="px-4 py-3.5">
                        <div className="font-medium">{c.ownerName}</div>
                        <div className="text-xs text-mute">{c.ownerEmail}</div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-medium">{c.tenantBrand}</div>
                        <div className="text-xs text-mute font-mono">
                          · {c.codeText}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 font-semibold">
                        {fmtUsd(c.amount)}
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${st.cls}`}
                        >
                          {st.text}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-mute">
                        {fmtDate(c.createdAt)}
                      </td>
                      <td className="px-4 py-3.5 text-xs">
                        {fmtDate(c.availableAt)}
                        {c.status === 'PENDING' && dayDiff > 0 && (
                          <div className="text-[10px] text-amber-700">
                            en {dayDiff}d
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-mute">
                        {fmtDate(c.paidAt)}
                      </td>
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        {(c.status === 'APPROVED' || c.status === 'PENDING') && (
                          <>
                            <button
                              disabled={busyId === c.id || c.status === 'PENDING'}
                              onClick={() => markPaid(c.id)}
                              className="btn-link text-xs disabled:opacity-30 disabled:cursor-not-allowed"
                              title={
                                c.status === 'PENDING'
                                  ? 'Esperando que cumpla 30 días'
                                  : 'Marcar como pagada'
                              }
                            >
                              ✓ Pagar
                            </button>
                            <button
                              disabled={busyId === c.id}
                              onClick={() => reject(c.id)}
                              className="ml-2 text-bad underline text-xs"
                            >
                              Rechazar
                            </button>
                          </>
                        )}
                        {c.status === 'PAID' && (
                          <span className="text-xs text-ok">✓ {fmtDate(c.paidAt)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// =============================================================
//                          CODES TAB
// =============================================================

function CodesTab() {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [commissionFor, setCommissionFor] = useState<{
    useId: string;
    tenantBrand: string;
  } | null>(null);
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [showLinkGen, setShowLinkGen] = useState(false);
  const [linkSource, setLinkSource] = useState('');

  const baseOrigin =
    typeof window !== 'undefined' ? window.location.origin : 'https://soyclubify.com';
  const captureLink = linkSource.trim()
    ? `${baseOrigin}/refer?source=${encodeURIComponent(linkSource.trim())}`
    : `${baseOrigin}/refer`;

  async function copyCaptureLink() {
    try {
      await navigator.clipboard.writeText(captureLink);
      toast('Link copiado al portapapeles', 'success');
    } catch {
      toast('No se pudo copiar — selecciona y copia manualmente', 'error');
    }
  }

  async function load() {
    try {
      setLoading(true);
      setList(await api('/referrals'));
    } catch (e: any) {
      toast(e.message || 'Error cargando referidos', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function submitCommission() {
    if (!commissionFor) return;
    const n = Number(amount);
    if (!n || n <= 0) {
      toast('Monto inválido', 'error');
      return;
    }
    setSaving(true);
    try {
      await api(`/referrals/uses/${commissionFor.useId}/commission`, {
        method: 'POST',
        body: JSON.stringify({ amount: n }),
      });
      toast(`Comisión de USD ${n} agregada`, 'success');
      setCommissionFor(null);
      setAmount('');
      load();
    } catch (e: any) {
      toast(e.message || 'No se pudo agregar la comisión', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(commId: string, status: string) {
    try {
      await api(`/referrals/commissions/${commId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      toast(`Comisión marcada como ${status === 'PAID' ? 'pagada' : status}`, 'success');
      load();
    } catch (e: any) {
      toast(e.message || 'No se pudo actualizar', 'error');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-mute text-sm">{list.length} códigos generados</div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => setShowLinkGen(true)}
        >
          <Icon name="plus" /> Generar link de captación
        </button>
      </div>

      <div className="space-y-3.5">
        {loading && (
          <>
            <div className="card card-pad">
              <div className="h-5 bg-bg2 rounded w-1/3 animate-shimmer" />
              <div className="mt-3 h-4 bg-bg2 rounded w-2/3 animate-shimmer" />
            </div>
            <div className="card card-pad">
              <div className="h-5 bg-bg2 rounded w-1/4 animate-shimmer" />
            </div>
          </>
        )}
        {!loading && list.length === 0 && (
          <div className="card card-pad text-center py-12">
            <div className="text-4xl mb-2">🔗</div>
            <div className="font-semibold">Aún no hay códigos de referido</div>
            <p className="text-sm text-mute mt-1.5 max-w-md mx-auto">
              Cuando un usuario genere su código en /refer aparecerá aquí con
              sus inscritos y comisiones acumuladas.
            </p>
          </div>
        )}
        {!loading &&
          list.map((r) => (
            <div key={r.id} className="card card-pad">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="font-semibold flex items-center gap-2 flex-wrap">
                    <span>{r.ownerName}</span>
                    <span className="font-mono text-mute font-normal text-sm">
                      · {r.code}
                    </span>
                  </div>
                  <div className="text-xs text-mute mt-0.5 break-all">
                    {r.ownerEmail} · {r.ownerWhatsapp}
                  </div>
                </div>
                <div className="text-sm flex items-center gap-2 flex-wrap">
                  <span className="badge badge-info">
                    {Number(r.commissionPercent)}% comisión
                  </span>
                  {r.source && (
                    <span
                      className="badge badge-mute text-[11px]"
                      title="Origen del afiliado (?source en el link de captación)"
                    >
                      📣 {r.source}
                    </span>
                  )}
                  <span className="text-xs text-mute">
                    {r.uses.length} inscritos
                  </span>
                </div>
              </div>
              <div className="mt-3 divide-y divide-line2">
                {r.uses.length === 0 && (
                  <div className="py-3 text-sm text-mute italic">
                    Sin conversiones aún.
                  </div>
                )}
                {r.uses.map((u: any) => {
                  const st = STATUS_LABEL[u.status] ?? {
                    text: u.status,
                    cls: 'bg-bg2 text-mute',
                  };
                  return (
                    <div
                      key={u.id}
                      className="py-3 text-sm flex flex-wrap items-center gap-3"
                    >
                      <div className="font-medium min-w-[140px] flex-1">
                        {u.tenant?.brandName ?? '—'}
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${st.cls}`}
                      >
                        {st.text}
                      </span>
                      <div className="flex flex-wrap gap-1.5 flex-1">
                        {u.commissions.length === 0 && (
                          <span className="text-mute text-xs">
                            Sin comisiones
                          </span>
                        )}
                        {u.commissions.map((c: any) => (
                          <span
                            key={c.id}
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] ${
                              c.status === 'PAID'
                                ? 'bg-ok-soft text-ok'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            USD {Number(c.amount).toFixed(2)} · {c.status}
                            {c.status !== 'PAID' && (
                              <button
                                className="underline hover:no-underline"
                                onClick={() => setStatus(c.id, 'PAID')}
                              >
                                marcar pagada
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                      <button
                        className="text-xs text-brand hover:underline whitespace-nowrap"
                        onClick={() =>
                          setCommissionFor({
                            useId: u.id,
                            tenantBrand: u.tenant?.brandName ?? 'Tenant',
                          })
                        }
                      >
                        + comisión
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
      </div>

      {/* Modal: agregar comisión */}
      {commissionFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-ink/60"
            onClick={() => !saving && setCommissionFor(null)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
            <h2 className="font-bold text-lg">Agregar comisión</h2>
            <p className="text-sm text-mute mt-1">
              Para inscrito en{' '}
              <b className="text-ink">{commissionFor.tenantBrand}</b>.
            </p>
            <div className="mt-4">
              <label className="label">Monto (USD)</label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="input"
                placeholder="15.00"
                onKeyDown={(e) => e.key === 'Enter' && submitCommission()}
              />
              <p className="text-xs text-mute mt-1.5">
                La comisión queda en estado PENDING. A los 30 días pasa
                automáticamente a "Disponible" para pagar.
              </p>
            </div>
            <div className="mt-5 flex gap-2 justify-end">
              <button
                onClick={() => setCommissionFor(null)}
                disabled={saving}
                className="btn-ghost text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={submitCommission}
                disabled={saving || !amount}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {saving ? 'Guardando…' : 'Agregar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: generar link de captación de afiliados */}
      {showLinkGen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-ink/60"
            onClick={() => setShowLinkGen(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h2 className="font-bold text-lg">Link de captación de afiliados</h2>
            <p className="text-sm text-mute mt-1.5 leading-relaxed">
              Comparte este link con quien quieras invitar al programa. Cuando
              se registre obtiene <b className="text-ink">su propio código y
              link personalizado</b> para promocionar Clubify.
            </p>

            <div className="mt-4">
              <label className="label">Etiqueta de origen (opcional)</label>
              <input
                type="text"
                value={linkSource}
                onChange={(e) => setLinkSource(e.target.value)}
                className="input"
                placeholder="instagram, podcast-mayo, evento-X…"
              />
              <p className="text-xs text-mute mt-1.5">
                Útil para saber por qué canal llegó cada afiliado. Solo letras,
                números y guiones.
              </p>
            </div>

            <div className="mt-4">
              <label className="label">Tu link</label>
              <div className="flex items-stretch gap-2">
                <input
                  readOnly
                  value={captureLink}
                  className="input flex-1 font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  type="button"
                  onClick={copyCaptureLink}
                  className="btn-primary text-sm whitespace-nowrap"
                >
                  Copiar
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(
                    `Te invito a unirte al programa de afiliados de Clubify y ganar comisiones por cada negocio que registres. Regístrate aquí: ${captureLink}`,
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs btn-ghost"
                >
                  💬 Compartir por WhatsApp
                </a>
                <a
                  href={captureLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs btn-ghost"
                >
                  ↗ Abrir página
                </a>
              </div>
            </div>

            <div className="mt-5 flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowLinkGen(false);
                  setLinkSource('');
                }}
                className="btn-ghost text-sm"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
