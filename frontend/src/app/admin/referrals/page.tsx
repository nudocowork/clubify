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

type Tab =
  | 'summary'
  | 'campaigns'
  | 'influencers'
  | 'ambassadors'
  | 'clients'
  | 'commissions'
  | 'payouts'
  | 'coupons'
  | 'config'
  | 'leaderboard'
  | 'codes';

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
  notes: string | null;
  clientContactedAt: string | null;
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
  const [tab, setTab] = useState<Tab>('summary');

  const TABS: { id: Tab; label: string }[] = [
    { id: 'summary', label: '📊 Resumen' },
    { id: 'campaigns', label: '🎯 Campañas' },
    { id: 'influencers', label: '🌟 Influencers' },
    { id: 'ambassadors', label: '👥 Embajadores' },
    { id: 'clients', label: '🏢 Clientes' },
    { id: 'commissions', label: '💵 Comisiones' },
    { id: 'payouts', label: '⏳ Pendientes por pagar' },
    { id: 'coupons', label: '🎟 Cupones' },
    { id: 'config', label: '⚙️ Configuración' },
  ];

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Referidos</h1>
      </div>

      <div className="tabs mb-5 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'tab-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'summary' && <SummaryTab />}
      {tab === 'campaigns' && <CampaignsTab />}
      {tab === 'influencers' && <InfluencersTab />}
      {tab === 'ambassadors' && <AmbassadorsTab />}
      {tab === 'clients' && <ClientsTab />}
      {tab === 'commissions' && <CommissionsTab />}
      {tab === 'payouts' && <PayoutsTab />}
      {tab === 'coupons' && <CouponsTab />}
      {tab === 'config' && <ConfigTab />}
      {tab === 'leaderboard' && <LeaderboardTab />}
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
  const [editingNotes, setEditingNotes] = useState<PayoutItem | null>(null);

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
                        <button
                          onClick={() => setEditingNotes(c)}
                          className="text-xs text-mute hover:text-ink mr-2"
                          title={
                            c.notes
                              ? `Nota: ${c.notes.slice(0, 60)}${c.notes.length > 60 ? '…' : ''}`
                              : 'Agregar nota interna'
                          }
                        >
                          {c.notes ? '📝' : '＋'}
                        </button>
                        {c.clientContactedAt && (
                          <span
                            className="text-[10px] text-ok mr-2"
                            title={`Contactado: ${fmtDate(c.clientContactedAt)}`}
                          >
                            ✓ contactado
                          </span>
                        )}
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

      {editingNotes && (
        <CommissionNotesModal
          item={editingNotes}
          onClose={() => setEditingNotes(null)}
          onSaved={() => {
            setEditingNotes(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function CommissionNotesModal({
  item,
  onClose,
  onSaved,
}: {
  item: PayoutItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [notes, setNotes] = useState(item.notes ?? '');
  const [contacted, setContacted] = useState(!!item.clientContactedAt);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api(`/referrals/commissions/${item.id}/notes`, {
        method: 'PATCH',
        body: JSON.stringify({
          notes: notes.trim() || null,
          markContacted: contacted,
        }),
      });
      toast('Nota guardada', 'success');
      onSaved();
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold m-0">Nota interna</h2>
          <button onClick={onClose} className="text-mute hover:text-ink text-xl leading-none">
            ×
          </button>
        </div>
        <div className="text-xs text-mute mb-3">
          Comisión de <strong>{item.ownerName}</strong> · {fmtUsd(item.amount)} ·{' '}
          cliente <strong>{item.tenantBrand}</strong>
        </div>
        <textarea
          className="input min-h-[120px] mb-3"
          placeholder="Ej: Pagado vía Wise · Cliente prometió pagar el 15 ·…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm cursor-pointer mb-4">
          <input
            type="checkbox"
            checked={contacted}
            onChange={(e) => setContacted(e.target.checked)}
            className="accent-brand"
          />
          <span>Cliente fue contactado por pago</span>
        </label>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost" disabled={busy}>
            Cancelar
          </button>
          <button onClick={save} className="btn-primary" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
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

// =============================================================
//                       CAMPAIGNS TAB (Fase 2)
// =============================================================

type CampaignSummary = {
  id: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'FINISHED';
  discountAbsorption: string;
  createdAt: string;
  ownerCode: { id: string; code: string; ownerName: string; commissionPercent: number };
  ambassadorsCount: number;
  directClients: number;
  indirectClients: number;
  totalActiveClients: number;
  ambassadorCommissionsUsd: number;
};

const STATUS_PILL: Record<CampaignSummary['status'], { text: string; cls: string }> = {
  ACTIVE: { text: 'Activa', cls: 'bg-ok-soft text-ok' },
  PAUSED: { text: 'Pausada', cls: 'bg-amber-100 text-amber-800' },
  FINISHED: { text: 'Finalizada', cls: 'bg-bg2 text-mute' },
};

function CampaignsTab() {
  const [list, setList] = useState<CampaignSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [openCampaign, setOpenCampaign] = useState<CampaignSummary | null>(null);

  async function load() {
    setLoading(true);
    try {
      setList(await api<CampaignSummary[]>('/campaigns'));
    } catch (e: any) {
      toast(e.message || 'Error cargando campañas', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-mute">
          Cada campaña pertenece a un influencer. Los embajadores reciben 25%
          y el influencer gana 5% por las ventas indirectas.
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-sm">
          <Icon name="plus" /> Nueva campaña
        </button>
      </div>

      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card card-pad h-44 animate-shimmer" />
          ))}
        </div>
      )}

      {!loading && list.length === 0 && (
        <div className="card card-pad text-center py-12">
          <div className="text-4xl mb-2">🎯</div>
          <div className="font-semibold">Aún no hay campañas</div>
          <div className="text-sm text-mute mt-1">
            Crea la primera para asignar un influencer y sumar embajadores.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {list.map((c) => (
          <div
            key={c.id}
            className="card card-pad cursor-pointer hover:shadow-md2 transition"
            onClick={() => setOpenCampaign(c)}
          >
            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="min-w-0">
                <div className="font-bold text-base leading-tight truncate">{c.name}</div>
                <div className="text-xs text-mute mt-0.5 truncate">{c.ownerCode.ownerName}</div>
              </div>
              <span
                className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded ${STATUS_PILL[c.status].cls}`}
              >
                {STATUS_PILL[c.status].text}
              </span>
            </div>
            <div className="bg-bg2 rounded-lg px-3 py-2 mb-3 font-mono text-sm font-bold">
              {c.ownerCode.code}
              <span className="text-mute font-normal ml-2 text-xs">
                · {c.ownerCode.commissionPercent}%
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-bg2/50 rounded p-2">
                <div className="text-mute">Embajadores</div>
                <div className="font-bold text-base">{c.ambassadorsCount}</div>
              </div>
              <div className="bg-bg2/50 rounded p-2">
                <div className="text-mute">Clientes activos</div>
                <div className="font-bold text-base">{c.totalActiveClients}</div>
              </div>
              <div className="bg-bg2/50 rounded p-2 col-span-2">
                <div className="text-mute">Comisiones embajadores</div>
                <div className="font-bold text-base text-brand">
                  {fmtUsd(c.ambassadorCommissionsUsd)}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showCreate && (
        <CreateCampaignModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}
      {openCampaign && (
        <CampaignDetailModal
          campaignId={openCampaign.id}
          onClose={() => setOpenCampaign(null)}
          onChanged={() => {
            load();
          }}
        />
      )}
    </div>
  );
}

function CreateCampaignModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    name: '',
    influencerName: '',
    influencerEmail: '',
    influencerWhatsapp: '',
    influencerCommissionPercent: 30,
    influencerCustomCode: '',
    discountAbsorption: 'PROPORTIONAL',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api('/campaigns', { method: 'POST', body: JSON.stringify(form) });
      toast('Campaña creada', 'success');
      onCreated();
    } catch (e: any) {
      setErr(e.message || 'No se pudo crear');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold m-0">Nueva campaña</h2>
          <button type="button" onClick={onClose} className="text-mute hover:text-ink text-xl leading-none">
            ×
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="label">Nombre de campaña</label>
            <input
              className="input"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ej: Campaña Influencer Juan"
            />
          </div>
          <div className="pt-2 border-t border-line text-xs uppercase tracking-wider text-mute font-semibold">
            Influencer titular
          </div>
          <div>
            <label className="label">Nombre</label>
            <input
              className="input"
              required
              value={form.influencerName}
              onChange={(e) => setForm({ ...form, influencerName: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                required
                value={form.influencerEmail}
                onChange={(e) => setForm({ ...form, influencerEmail: e.target.value })}
              />
            </div>
            <div>
              <label className="label">WhatsApp</label>
              <input
                className="input"
                required
                value={form.influencerWhatsapp}
                onChange={(e) => setForm({ ...form, influencerWhatsapp: e.target.value })}
                placeholder="+57..."
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">% Directo</label>
              <input
                type="number"
                min={0}
                max={100}
                className="input"
                value={form.influencerCommissionPercent}
                onChange={(e) =>
                  setForm({
                    ...form,
                    influencerCommissionPercent: Number(e.target.value),
                  })
                }
              />
            </div>
            <div>
              <label className="label">Código (opcional)</label>
              <input
                className="input"
                placeholder="JUAN30"
                value={form.influencerCustomCode}
                onChange={(e) =>
                  setForm({ ...form, influencerCustomCode: e.target.value.toUpperCase() })
                }
              />
            </div>
          </div>
          <div>
            <label className="label">Regla de descuento</label>
            <select
              className="input"
              value={form.discountAbsorption}
              onChange={(e) => setForm({ ...form, discountAbsorption: e.target.value })}
            >
              <option value="PROPORTIONAL">Socio + empresa proporcional (default)</option>
              <option value="EMPRESA_ABSORBS">Solo empresa absorbe</option>
              <option value="ORIGINAL_PRICE">Comisión sobre precio original</option>
              <option value="PAID_PRICE">Comisión sobre precio pagado</option>
            </select>
          </div>
        </div>
        {err && <div className="mt-3 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad-ink">{err}</div>}
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Creando…' : 'Crear campaña'}
          </button>
        </div>
      </form>
    </div>
  );
}

function CampaignDetailModal({
  campaignId,
  onClose,
  onChanged,
}: {
  campaignId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ fullName: '', email: '', whatsapp: '', commissionPercent: 25, customCode: '' });
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setData(await api(`/campaigns/${campaignId}`));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, [campaignId]);

  async function setStatus(status: 'ACTIVE' | 'PAUSED' | 'FINISHED') {
    await api(`/campaigns/${campaignId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    toast(`Campaña ${status === 'ACTIVE' ? 'activada' : status === 'PAUSED' ? 'pausada' : 'finalizada'}`, 'success');
    load();
    onChanged();
  }

  async function addAmbassador(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/campaigns/${campaignId}/ambassadors`, {
        method: 'POST',
        body: JSON.stringify(addForm),
      });
      setAddForm({ fullName: '', email: '', whatsapp: '', commissionPercent: 25, customCode: '' });
      setShowAdd(false);
      toast('Embajador agregado', 'success');
      load();
      onChanged();
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeAmbassador(id: string) {
    if (!confirm('¿Desactivar este embajador? El historial se conserva.')) return;
    await api(`/campaigns/ambassadors/${id}`, { method: 'DELETE' });
    toast('Embajador desactivado', 'success');
    load();
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-auto p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold m-0">{loading ? 'Cargando…' : data?.name}</h2>
          <button onClick={onClose} className="text-mute hover:text-ink text-xl leading-none">
            ×
          </button>
        </div>

        {data && (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className={`text-xs uppercase font-bold px-2 py-0.5 rounded ${STATUS_PILL[data.status as keyof typeof STATUS_PILL].cls}`}>
                {STATUS_PILL[data.status as keyof typeof STATUS_PILL].text}
              </span>
              <span className="text-xs text-mute">Regla: {data.discountAbsorption}</span>
              <div className="ml-auto flex gap-1">
                {data.status !== 'ACTIVE' && (
                  <button onClick={() => setStatus('ACTIVE')} className="btn-ghost text-xs">
                    Activar
                  </button>
                )}
                {data.status !== 'PAUSED' && (
                  <button onClick={() => setStatus('PAUSED')} className="btn-ghost text-xs">
                    Pausar
                  </button>
                )}
                {data.status !== 'FINISHED' && (
                  <button onClick={() => setStatus('FINISHED')} className="btn-ghost text-xs">
                    Finalizar
                  </button>
                )}
              </div>
            </div>

            <div className="card card-pad mb-4 bg-bg2/40">
              <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1">
                Influencer titular
              </div>
              <div className="font-semibold">{data.ownerCode.ownerName}</div>
              <div className="text-xs text-mute">{data.ownerCode.ownerEmail}</div>
              <div className="mt-2 font-mono font-bold text-lg bg-white px-3 py-2 rounded inline-block">
                {data.ownerCode.code}{' '}
                <span className="text-xs text-mute font-normal">
                  · {Number(data.ownerCode.commissionPercent)}% directo
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold m-0">Embajadores ({data.codes.length})</h3>
              <button onClick={() => setShowAdd(!showAdd)} className="btn-ghost text-xs">
                {showAdd ? 'Cancelar' : '+ Embajador'}
              </button>
            </div>

            {showAdd && (
              <form onSubmit={addAmbassador} className="border border-line rounded-lg p-3 mb-3 space-y-2 bg-bg2/30">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="input"
                    placeholder="Nombre"
                    required
                    value={addForm.fullName}
                    onChange={(e) => setAddForm({ ...addForm, fullName: e.target.value })}
                  />
                  <input
                    className="input"
                    type="email"
                    placeholder="Email"
                    required
                    value={addForm.email}
                    onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    className="input"
                    placeholder="WhatsApp"
                    required
                    value={addForm.whatsapp}
                    onChange={(e) => setAddForm({ ...addForm, whatsapp: e.target.value })}
                  />
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={100}
                    placeholder="% comisión"
                    value={addForm.commissionPercent}
                    onChange={(e) => setAddForm({ ...addForm, commissionPercent: Number(e.target.value) })}
                  />
                  <input
                    className="input"
                    placeholder="Código (opcional)"
                    value={addForm.customCode}
                    onChange={(e) => setAddForm({ ...addForm, customCode: e.target.value.toUpperCase() })}
                  />
                </div>
                <button type="submit" className="btn-primary text-sm w-full" disabled={busy}>
                  {busy ? 'Agregando…' : 'Agregar embajador'}
                </button>
              </form>
            )}

            {data.codes.length === 0 ? (
              <div className="text-center py-8 text-mute text-sm">
                Sin embajadores aún
              </div>
            ) : (
              <div className="space-y-2">
                {data.codes.map((amb: any) => (
                  <div
                    key={amb.id}
                    className={`border border-line rounded-lg p-3 flex items-center justify-between gap-2 ${
                      amb.isActive ? '' : 'opacity-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{amb.ownerName}</div>
                      <div className="text-xs text-mute truncate">{amb.ownerEmail}</div>
                    </div>
                    <div className="font-mono font-bold text-sm bg-bg2 px-2 py-1 rounded">
                      {amb.code}
                    </div>
                    <div className="text-xs text-mute whitespace-nowrap">
                      {Number(amb.commissionPercent)}% · {amb.uses?.length ?? 0} clientes
                    </div>
                    {amb.isActive && (
                      <button
                        onClick={() => removeAmbassador(amb.id)}
                        className="text-mute hover:text-bad text-lg leading-none"
                        aria-label="Desactivar"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// =============================================================
//                       COUPONS TAB (Fase 3)
// =============================================================

type CouponRow = {
  id: string;
  code: string;
  discountPercent: string | number;
  duration: 'FIRST_MONTH' | 'RECURRING';
  status: 'ACTIVE' | 'PAUSED' | 'EXPIRED';
  validFrom: string | null;
  validUntil: string | null;
  maxUses: number | null;
  useCount: number;
  applicablePlans: string;
  referralCode: { code: string; ownerName: string; role: string } | null;
  campaign: { name: string } | null;
  _count: { uses: number };
};

const COUPON_STATUS_CLS: Record<CouponRow['status'], string> = {
  ACTIVE: 'bg-ok-soft text-ok',
  PAUSED: 'bg-amber-100 text-amber-800',
  EXPIRED: 'bg-bg2 text-mute',
};

function CouponsTab() {
  const [list, setList] = useState<CouponRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setList(await api<CouponRow[]>('/coupons'));
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function setStatus(id: string, status: CouponRow['status']) {
    await api(`/coupons/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    load();
  }

  async function remove(id: string) {
    if (!confirm('¿Eliminar este cupón? El historial de usos se preserva.')) return;
    try {
      await api(`/coupons/${id}`, { method: 'DELETE' });
      toast('Cupón eliminado', 'success');
      load();
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-mute">
          Los cupones aplican un descuento en el signup. Si están vinculados a un
          influencer/embajador, también atribuyen la venta.
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-sm">
          <Icon name="plus" /> Nuevo cupón
        </button>
      </div>

      {loading ? (
        <div className="card card-pad h-32 animate-shimmer" />
      ) : list.length === 0 ? (
        <div className="card card-pad text-center py-12">
          <div className="text-4xl mb-2">🎟</div>
          <div className="font-semibold">Aún no hay cupones</div>
          <div className="text-sm text-mute mt-1">
            Crea uno para correr una promo o vincular descuentos a una campaña.
          </div>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead className="bg-bg2">
                <tr>
                  {['Código', 'Descuento', 'Duración', 'Atribución', 'Vigencia', 'Usos', 'Estado', ''].map((h) => (
                    <th
                      key={h}
                      className="text-left px-4 py-3 text-[11px] uppercase tracking-[0.1em] text-mute font-semibold"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="border-t border-line2 hover:bg-[#FAFAFB]">
                    <td className="px-4 py-3 font-mono font-bold">{c.code}</td>
                    <td className="px-4 py-3 font-semibold">
                      {Number(c.discountPercent)}%
                    </td>
                    <td className="px-4 py-3 text-xs text-mute">
                      {c.duration === 'RECURRING' ? 'Recurrente' : 'Primer mes'}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {c.referralCode ? (
                        <div>
                          <div className="font-medium">{c.referralCode.ownerName}</div>
                          <div className="text-mute font-mono">{c.referralCode.code}</div>
                        </div>
                      ) : c.campaign ? (
                        <div className="text-mute">📣 {c.campaign.name}</div>
                      ) : (
                        <span className="text-mute">— Global</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-mute">
                      {c.validFrom || c.validUntil ? (
                        <>
                          {c.validFrom ? fmtDate(c.validFrom) : '—'}
                          {' → '}
                          {c.validUntil ? fmtDate(c.validUntil) : '—'}
                        </>
                      ) : (
                        'Sin límite'
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {c.useCount}
                      {c.maxUses != null && (
                        <span className="text-mute"> / {c.maxUses}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${COUPON_STATUS_CLS[c.status]}`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {c.status === 'ACTIVE' && (
                        <button
                          onClick={() => setStatus(c.id, 'PAUSED')}
                          className="text-xs text-amber-700 hover:underline mr-2"
                        >
                          Pausar
                        </button>
                      )}
                      {c.status === 'PAUSED' && (
                        <button
                          onClick={() => setStatus(c.id, 'ACTIVE')}
                          className="text-xs text-ok hover:underline mr-2"
                        >
                          Activar
                        </button>
                      )}
                      <button
                        onClick={() => remove(c.id)}
                        className="text-xs text-bad hover:underline"
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showCreate && (
        <CreateCouponModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function CreateCouponModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    code: '',
    discountPercent: 10,
    duration: 'FIRST_MONTH' as 'FIRST_MONTH' | 'RECURRING',
    validFrom: '',
    validUntil: '',
    maxUses: '',
    applicablePlans: '',
    referralCodeId: '',
    campaignId: '',
  });
  const [referrals, setReferrals] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<any>('/referrals/leaderboard').then((rows) => setReferrals(rows ?? [])).catch(() => {});
    api<any[]>('/campaigns').then((rows) => setCampaigns(rows ?? [])).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api('/coupons', {
        method: 'POST',
        body: JSON.stringify({
          code: form.code,
          discountPercent: Number(form.discountPercent),
          duration: form.duration,
          validFrom: form.validFrom || null,
          validUntil: form.validUntil || null,
          maxUses: form.maxUses ? Number(form.maxUses) : null,
          applicablePlans: form.applicablePlans,
          referralCodeId: form.referralCodeId || null,
          campaignId: form.campaignId || null,
        }),
      });
      toast('Cupón creado', 'success');
      onCreated();
    } catch (e: any) {
      setErr(e.message || 'No se pudo crear');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-5 max-h-[90vh] overflow-auto"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold m-0">Nuevo cupón</h2>
          <button type="button" onClick={onClose} className="text-mute hover:text-ink text-xl leading-none">
            ×
          </button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Código</label>
              <input
                className="input"
                required
                placeholder="JUAN10"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              />
            </div>
            <div>
              <label className="label">Descuento %</label>
              <input
                type="number"
                min={1}
                max={100}
                className="input"
                value={form.discountPercent}
                onChange={(e) => setForm({ ...form, discountPercent: Number(e.target.value) })}
              />
            </div>
          </div>
          <div>
            <label className="label">Duración del descuento</label>
            <select
              className="input"
              value={form.duration}
              onChange={(e) => setForm({ ...form, duration: e.target.value as any })}
            >
              <option value="FIRST_MONTH">Solo primer mes</option>
              <option value="RECURRING">Recurrente mensual</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Vigencia desde</label>
              <input
                type="date"
                className="input"
                value={form.validFrom}
                onChange={(e) => setForm({ ...form, validFrom: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Vigencia hasta</label>
              <input
                type="date"
                className="input"
                value={form.validUntil}
                onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Máx. usos (vacío = sin límite)</label>
              <input
                type="number"
                min={1}
                className="input"
                value={form.maxUses}
                onChange={(e) => setForm({ ...form, maxUses: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Planes (CSV)</label>
              <input
                className="input"
                placeholder="Elite,Pro o vacío para todos"
                value={form.applicablePlans}
                onChange={(e) => setForm({ ...form, applicablePlans: e.target.value })}
              />
            </div>
          </div>
          <div className="pt-2 border-t border-line text-xs uppercase tracking-wider text-mute font-semibold">
            Atribución (opcional)
          </div>
          <div>
            <label className="label">Vincular a campaña</label>
            <select
              className="input"
              value={form.campaignId}
              onChange={(e) => setForm({ ...form, campaignId: e.target.value })}
            >
              <option value="">— Sin atribución —</option>
              {campaigns.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.ownerCode.code})
                </option>
              ))}
            </select>
          </div>
        </div>
        {err && <div className="mt-3 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad-ink">{err}</div>}
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Creando…' : 'Crear cupón'}
          </button>
        </div>
      </form>
    </div>
  );
}


// =============================================================
//                       SUMMARY TAB (Fase 4)
// =============================================================

type SummaryResp = {
  kpis: {
    activeCampaigns: number;
    totalCampaigns: number;
    influencerCount: number;
    ambassadorCount: number;
    totalReferredClients: number;
    activeClients: number;
    churnedClients: number;
    trialClients: number;
    mrrUsd: number;
    commPaidUsd: number;
    commPendingUsd: number;
    commRejectedUsd: number;
    socioPaidUsd: number;
    socioPendingUsd: number;
    discountUsedUsd: number;
    netoEmpresaUsd: number;
  };
  topCampaigns: Array<{
    id: string;
    name: string;
    ownerCode: string;
    ownerName: string;
    status: string;
    ambassadors: number;
    activeClients: number;
    mrrUsd: number;
  }>;
  topInfluencers: Array<{
    code: string;
    ownerName: string;
    role: string;
    activeClients: number;
    totalClients: number;
    revenueUsd: number;
  }>;
  topAmbassadors: Array<{
    code: string;
    ownerName: string;
    role: string;
    activeClients: number;
    totalClients: number;
    revenueUsd: number;
  }>;
};

function SummaryTab() {
  const [data, setData] = useState<SummaryResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<SummaryResp>('/referrals/summary')
      .then(setData)
      .catch((e) => toast(e.message || 'Error', 'error'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="card card-pad h-32 animate-shimmer" />;
  if (!data) return null;

  const k = data.kpis;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Campañas activas" value={`${k.activeCampaigns}/${k.totalCampaigns}`} />
        <Kpi label="Influencers" value={k.influencerCount.toString()} />
        <Kpi label="Embajadores" value={k.ambassadorCount.toString()} />
        <Kpi label="Clientes referidos" value={k.totalReferredClients.toString()} />
        <Kpi label="Clientes activos" value={k.activeClients.toString()} tone="ok" />
        <Kpi label="En trial" value={k.trialClients.toString()} />
        <Kpi label="Cancelados" value={k.churnedClients.toString()} />
        <Kpi label="MRR (30d)" value={fmtUsd(k.mrrUsd)} tone="brand" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="card card-pad">
          <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1">
            Comisiones referidos
          </div>
          <div className="space-y-1.5">
            <SumRow label="Pagadas" value={fmtUsd(k.commPaidUsd)} tone="ok" />
            <SumRow label="Pendientes" value={fmtUsd(k.commPendingUsd)} tone="amber" />
            <SumRow label="Rechazadas" value={fmtUsd(k.commRejectedUsd)} tone="muted" />
          </div>
        </div>
        <div className="card card-pad">
          <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1">
            Comisión socio (10%)
          </div>
          <div className="space-y-1.5">
            <SumRow label="Pagado" value={fmtUsd(k.socioPaidUsd)} tone="ok" />
            <SumRow label="Pendiente" value={fmtUsd(k.socioPendingUsd)} tone="amber" />
          </div>
        </div>
        <div className="card card-pad">
          <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1">
            Descuentos aplicados
          </div>
          <div className="text-2xl font-bold text-brand">{fmtUsd(k.discountUsedUsd)}</div>
          <div className="text-xs text-mute mt-1">
            Suma estimada por cupones × usos
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold m-0">🔥 Top campañas (MRR 30d)</h3>
        </div>
        {data.topCampaigns.length === 0 ? (
          <div className="text-center text-mute py-6 text-sm">Sin actividad reciente</div>
        ) : (
          <div className="space-y-2">
            {data.topCampaigns.map((c, i) => (
              <div
                key={c.id}
                className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-bg2/40"
              >
                <div className="font-bold text-base w-6 text-center">
                  {['🥇', '🥈', '🥉'][i] ?? `${i + 1}`}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{c.name}</div>
                  <div className="text-xs text-mute truncate">
                    {c.ownerName} · <span className="font-mono">{c.ownerCode}</span> ·{' '}
                    {c.ambassadors} embajadores · {c.activeClients} activos
                  </div>
                </div>
                <div className="font-bold text-brand whitespace-nowrap">{fmtUsd(c.mrrUsd)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TopList title="🌟 Top influencers (revenue total)" rows={data.topInfluencers} />
        <TopList title="👥 Top embajadores (revenue total)" rows={data.topAmbassadors} />
      </div>
    </div>
  );
}

function TopList({
  title,
  rows,
}: {
  title: string;
  rows: SummaryResp['topInfluencers'];
}) {
  return (
    <div className="card card-pad">
      <h3 className="font-semibold m-0 mb-3">{title}</h3>
      {rows.length === 0 ? (
        <div className="text-center text-mute py-6 text-sm">Sin datos aún</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={r.code} className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg2/40">
              <div className="font-bold text-base w-6 text-center">
                {['🥇', '🥈', '🥉'][i] ?? `${i + 1}`}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{r.ownerName}</div>
                <div className="text-xs text-mute truncate">
                  <span className="font-mono">{r.code}</span> · {r.activeClients}/{r.totalClients} activos
                </div>
              </div>
              <div className="font-bold text-brand whitespace-nowrap">{fmtUsd(r.revenueUsd)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SumRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'amber' | 'muted';
}) {
  const cls =
    tone === 'ok'
      ? 'text-ok'
      : tone === 'amber'
      ? 'text-amber-700'
      : tone === 'muted'
      ? 'text-mute'
      : 'text-ink';
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-mute">{label}</span>
      <span className={`font-semibold ${cls}`}>{value}</span>
    </div>
  );
}

// =============================================================
//                  INFLUENCERS / AMBASSADORS / CLIENTS
// =============================================================

function InfluencersTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api<any[]>('/referrals/influencers')
      .then((r) => setRows(r ?? []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="card card-pad h-32 animate-shimmer" />;

  return (
    <div className="card overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead className="bg-bg2">
            <tr>
              {['Influencer', 'Código', '%', 'Campaña', 'Embajadores', 'Clientes', 'Pagado', 'Pendiente'].map(
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
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-12 text-mute">
                  Aún no hay influencers
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line2 hover:bg-[#FAFAFB]">
                <td className="px-4 py-3">
                  <div className="font-medium">{r.ownerName}</div>
                  <div className="text-xs text-mute">{r.ownerEmail}</div>
                </td>
                <td className="px-4 py-3 font-mono font-bold">{r.code}</td>
                <td className="px-4 py-3">{r.commissionPercent}%</td>
                <td className="px-4 py-3 text-xs">{r.campaignName ?? '—'}</td>
                <td className="px-4 py-3 text-center">{r.ambassadorsCount}</td>
                <td className="px-4 py-3 text-center">
                  {r.directActiveClients}
                  {r.directClients !== r.directActiveClients && (
                    <span className="text-mute"> / {r.directClients}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-ok font-medium">{fmtUsd(r.paidUsd)}</td>
                <td className="px-4 py-3 text-amber-700 font-medium">{fmtUsd(r.pendingUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AmbassadorsTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api<any[]>('/referrals/ambassadors')
      .then((r) => setRows(r ?? []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="card card-pad h-32 animate-shimmer" />;

  return (
    <div className="card overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[920px]">
          <thead className="bg-bg2">
            <tr>
              {['Embajador', 'Código', '%', 'Influencer parent', 'Campaña', 'Activos', 'Total', 'Pagado', 'Pendiente'].map(
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
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-12 text-mute">
                  Aún no hay embajadores
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.id}
                className={`border-t border-line2 hover:bg-[#FAFAFB] ${r.isActive ? '' : 'opacity-50'}`}
              >
                <td className="px-4 py-3">
                  <div className="font-medium">{r.ownerName}</div>
                  <div className="text-xs text-mute">{r.ownerEmail}</div>
                </td>
                <td className="px-4 py-3 font-mono font-bold">{r.code}</td>
                <td className="px-4 py-3">{r.commissionPercent}%</td>
                <td className="px-4 py-3 text-xs">
                  {r.parentName && (
                    <>
                      {r.parentName}
                      <div className="text-mute font-mono">{r.parentCode}</div>
                    </>
                  )}
                </td>
                <td className="px-4 py-3 text-xs">{r.campaignName ?? '—'}</td>
                <td className="px-4 py-3 text-center">{r.activeClients}</td>
                <td className="px-4 py-3 text-center">{r.clients}</td>
                <td className="px-4 py-3 text-ok font-medium">{fmtUsd(r.paidUsd)}</td>
                <td className="px-4 py-3 text-amber-700 font-medium">{fmtUsd(r.pendingUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const CLIENT_STATUS: Record<string, { text: string; cls: string }> = {
  SIGNED_UP: { text: 'Inscrito', cls: 'bg-bg2 text-mute' },
  ACTIVE: { text: 'Activo', cls: 'bg-ok-soft text-ok' },
  PAYING: { text: 'Pagando', cls: 'bg-ok-soft text-ok' },
  CHURNED: { text: 'Canceló', cls: 'bg-red-100 text-red-800' },
};

function ClientsTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'churned' | 'trial'>('all');

  useEffect(() => {
    api<any[]>('/referrals/clients')
      .then((r) => setRows(r ?? []))
      .finally(() => setLoading(false));
  }, []);

  const visible = rows.filter((r) => {
    if (filter === 'active') return r.status === 'ACTIVE' || r.status === 'PAYING';
    if (filter === 'churned') return r.status === 'CHURNED';
    if (filter === 'trial') return r.status === 'SIGNED_UP';
    return true;
  });

  if (loading) return <div className="card card-pad h-32 animate-shimmer" />;

  return (
    <div>
      <div className="flex gap-1 mb-3 flex-wrap">
        {(['all', 'active', 'trial', 'churned'] as const).map((f) => {
          const count =
            f === 'all'
              ? rows.length
              : f === 'active'
              ? rows.filter((r) => r.status === 'ACTIVE' || r.status === 'PAYING').length
              : f === 'churned'
              ? rows.filter((r) => r.status === 'CHURNED').length
              : rows.filter((r) => r.status === 'SIGNED_UP').length;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-pill border ${
                filter === f
                  ? 'bg-ink text-white border-ink'
                  : 'bg-white border-line text-mute hover:text-ink'
              }`}
            >
              {f === 'all' ? 'Todos' : f === 'active' ? 'Activos' : f === 'trial' ? 'En trial' : 'Cancelados'}{' '}
              ({count})
            </button>
          );
        })}
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[920px]">
            <thead className="bg-bg2">
              <tr>
                {['Negocio', 'Plan', 'Atribución', 'Tipo', 'Estado', 'Inscrito', 'Comisiones'].map(
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
              {visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-mute">
                    Sin clientes en este filtro
                  </td>
                </tr>
              )}
              {visible.map((r) => {
                const s = CLIENT_STATUS[r.status] ?? CLIENT_STATUS.SIGNED_UP;
                return (
                  <tr key={r.id} className="border-t border-line2 hover:bg-[#FAFAFB]">
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.tenantBrand}</div>
                      <div className="text-xs text-mute">{r.tenantStatus}</div>
                    </td>
                    <td className="px-4 py-3 text-xs">{r.plan}</td>
                    <td className="px-4 py-3 text-xs">
                      <div className="font-medium">{r.attribution.ownerName}</div>
                      <div className="text-mute font-mono">{r.attribution.code}</div>
                      {r.attribution.parentCode && (
                        <div className="text-mute text-[10px] mt-0.5">
                          via {r.attribution.parentName}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="px-1.5 py-0.5 rounded bg-bg2 text-[10px] uppercase font-bold">
                        {r.attribution.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${s.cls}`}>
                        {s.text}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-mute">{fmtDate(r.signedUpAt)}</td>
                    <td className="px-4 py-3 text-xs">
                      {r.commissionsCount} · {fmtUsd(r.commissionsTotalUsd)}
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
//                       COMMISSIONS (TODAS)
// =============================================================

function CommissionsTab() {
  // Reusa /referrals/payouts pero sin filtro de status — muestra TODAS.
  // PayoutsTab ya filtra por defecto a APPROVED, este muestra el ledger completo.
  const [data, setData] = useState<PayoutsResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<PayoutsResp>('/referrals/payouts').then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="card card-pad h-32 animate-shimmer" />;
  if (!data) return null;

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Kpi label="Disponible" value={fmtUsd(data.totals.availableUsd)} tone="ok" />
        <Kpi label="En hold" value={fmtUsd(data.totals.pendingUsd)} />
        <Kpi label="Pagado" value={fmtUsd(data.totals.paidUsd)} tone="brand" />
        <Kpi label="Total registros" value={data.totals.count.toString()} />
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead className="bg-bg2">
              <tr>
                {['Beneficiario', 'Código', 'Cliente', 'Monto', 'Estado', 'Creada', 'Pagada'].map(
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
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-mute">
                    Sin comisiones todavía
                  </td>
                </tr>
              )}
              {data.items.map((c) => {
                const s = PAYOUT_STATUS[c.status];
                return (
                  <tr key={c.id} className="border-t border-line2 hover:bg-[#FAFAFB]">
                    <td className="px-4 py-3">
                      <div className="font-medium">{c.ownerName}</div>
                      <div className="text-xs text-mute">{c.ownerEmail}</div>
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-xs">{c.codeText}</td>
                    <td className="px-4 py-3 text-xs">{c.tenantBrand}</td>
                    <td className="px-4 py-3 font-bold">{fmtUsd(c.amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${s.cls}`}>
                        {s.text}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-mute">{fmtDate(c.createdAt)}</td>
                    <td className="px-4 py-3 text-xs text-mute">{fmtDate(c.paidAt)}</td>
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
//                       CONFIGURATION TAB
// =============================================================

type ConfigResp = {
  socioCodeId: string;
  socio: { id: string; code: string; ownerName: string; commissionPercent: number; role: string } | null;
  indirectPercent: number;
  defaultInfluencerPercent: number;
  defaultAmbassadorPercent: number;
  holdDays: number;
  minPayoutUsd: number;
  notifyPaymentFailed: boolean;
  notifyChurn: boolean;
};

function ConfigTab() {
  const [cfg, setCfg] = useState<ConfigResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [referrals, setReferrals] = useState<any[]>([]);

  async function load() {
    setLoading(true);
    try {
      const [c, codes] = await Promise.all([
        api<ConfigResp>('/referrals/config'),
        api<any[]>('/referrals'),
      ]);
      setCfg(c);
      setReferrals(codes);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!cfg) return;
    setSaving(true);
    try {
      const updated = await api<ConfigResp>('/referrals/config', {
        method: 'PATCH',
        body: JSON.stringify({
          socioCodeId: cfg.socioCodeId || null,
          indirectPercent: cfg.indirectPercent,
          defaultInfluencerPercent: cfg.defaultInfluencerPercent,
          defaultAmbassadorPercent: cfg.defaultAmbassadorPercent,
          holdDays: cfg.holdDays,
          minPayoutUsd: cfg.minPayoutUsd,
          notifyPaymentFailed: cfg.notifyPaymentFailed,
          notifyChurn: cfg.notifyChurn,
        }),
      });
      setCfg(updated);
      toast('Configuración guardada', 'success');
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading || !cfg) return <div className="card card-pad h-32 animate-shimmer" />;

  const socioOptions = referrals.filter((r: any) => r.role === 'SOCIO');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div className="card card-pad space-y-4">
        <div>
          <h3 className="font-semibold m-0 mb-1">Comisiones por defecto</h3>
          <div className="text-xs text-mute mb-3">
            Aplican cuando se crea un nuevo influencer/embajador sin un % específico.
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Influencer directo</label>
              <input
                type="number"
                min={0}
                max={100}
                className="input"
                value={cfg.defaultInfluencerPercent}
                onChange={(e) =>
                  setCfg({ ...cfg, defaultInfluencerPercent: Number(e.target.value) })
                }
              />
            </div>
            <div>
              <label className="label">Embajador</label>
              <input
                type="number"
                min={0}
                max={100}
                className="input"
                value={cfg.defaultAmbassadorPercent}
                onChange={(e) =>
                  setCfg({ ...cfg, defaultAmbassadorPercent: Number(e.target.value) })
                }
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="label">Influencer indirecto (cuando lo usa un embajador)</label>
            <input
              type="number"
              min={0}
              max={100}
              className="input"
              value={cfg.indirectPercent}
              onChange={(e) => setCfg({ ...cfg, indirectPercent: Number(e.target.value) })}
            />
          </div>
        </div>
      </div>

      <div className="card card-pad space-y-4">
        <div>
          <h3 className="font-semibold m-0 mb-1">Socio global</h3>
          <div className="text-xs text-mute mb-3">
            El socio recibe el 10% de TODAS las ventas de Clubify, no depende
            de qué código se use. Solo códigos con rol SOCIO aparecen acá.
          </div>
          {socioOptions.length === 0 ? (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-sm text-amber-900">
              No hay códigos SOCIO. Crea uno desde la tab Códigos y vuelve acá.
            </div>
          ) : (
            <select
              className="input"
              value={cfg.socioCodeId}
              onChange={(e) => setCfg({ ...cfg, socioCodeId: e.target.value })}
            >
              <option value="">— Sin socio configurado —</option>
              {socioOptions.map((r: any) => (
                <option key={r.id} value={r.id}>
                  {r.ownerName} ({r.code}) — {Number(r.commissionPercent)}%
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <h3 className="font-semibold m-0 mb-1">Pagos</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Días de hold</label>
              <input
                type="number"
                min={0}
                className="input"
                value={cfg.holdDays}
                onChange={(e) => setCfg({ ...cfg, holdDays: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className="label">Mínimo para pagar (USD)</label>
              <input
                type="number"
                min={0}
                className="input"
                value={cfg.minPayoutUsd}
                onChange={(e) => setCfg({ ...cfg, minPayoutUsd: Number(e.target.value) })}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="card card-pad lg:col-span-2 space-y-3">
        <div>
          <h3 className="font-semibold m-0 mb-1">🔔 Notificaciones automáticas</h3>
          <div className="text-xs text-mute mb-3">
            Avisos por WhatsApp a la cadena de atribución (embajador →
            influencer → admin) cuando un cliente referido falla un pago o
            cancela. El admin recibe el aviso al WhatsApp configurado en
            Settings (key <code className="bg-bg2 px-1 rounded">salesWhatsapp</code>).
          </div>
        </div>
        <NotifToggle
          label="Pago fallido"
          description="Hotmart reportó pago atrasado, billete pendiente o protesto."
          checked={cfg.notifyPaymentFailed}
          onChange={(v) => setCfg({ ...cfg, notifyPaymentFailed: v })}
        />
        <NotifToggle
          label="Cliente canceló o reembolso"
          description="Cuando un cliente referido se da de baja, refund o chargeback."
          checked={cfg.notifyChurn}
          onChange={(v) => setCfg({ ...cfg, notifyChurn: v })}
        />
      </div>

      <div className="lg:col-span-2 flex justify-end">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? 'Guardando…' : 'Guardar configuración'}
        </button>
      </div>
    </div>
  );
}

function NotifToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-bg2/40">
      <div className="min-w-0">
        <div className="font-medium text-sm">{label}</div>
        <div className="text-xs text-mute">{description}</div>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-5 rounded-full transition shrink-0 ${
          checked ? 'bg-brand' : 'bg-bg2 border border-line'
        }`}
        aria-label={`Toggle ${label}`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition ${
            checked ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}
