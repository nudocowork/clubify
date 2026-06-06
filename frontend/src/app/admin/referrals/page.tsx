'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, startImpersonation } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { AffiliateCredentialsModal } from '@/components/AffiliateCredentialsModal';
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';

// =============================================================
//                      SEARCH UTILITIES
// =============================================================
//
// Buscadores client-side por sección (item 9 sprint).
// Cada tab tiene su propio search bar arriba con debounce 150ms.
// Filtro multi-keyword AND case-insensitive sobre los campos
// más relevantes de cada tipo de registro.

function useDebouncedValue<T>(value: T, delay = 150): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function matchesQuery(haystack: string, q: string) {
  const trimmed = q.trim();
  if (!trimmed) return true;
  const hay = haystack.toLowerCase();
  return trimmed
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((kw) => hay.includes(kw));
}

function useFilteredList<T>(
  items: T[],
  query: string,
  buildHaystack: (item: T) => string,
): T[] {
  const debounced = useDebouncedValue(query, 150);
  return useMemo(() => {
    if (!debounced.trim()) return items;
    return items.filter((it) => matchesQuery(buildHaystack(it), debounced));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, debounced]);
}

function SectionSearchBar({
  value,
  onChange,
  placeholder,
  resultCount,
  totalCount,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  resultCount?: number;
  totalCount?: number;
}) {
  const showCount =
    typeof resultCount === 'number' &&
    typeof totalCount === 'number' &&
    value.trim().length > 0;
  return (
    <div className="sticky top-0 z-10 -mx-4 px-4 py-2 mb-4 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/75 md:static md:mx-0 md:p-0 md:bg-transparent md:backdrop-blur-none md:mb-4">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1 bg-bg2 rounded-pill px-4 py-2.5">
          <span aria-hidden className="text-base leading-none">
            🔍
          </span>
          <input
            type="search"
            className="flex-1 bg-transparent border-0 outline-none text-sm placeholder:text-mute"
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={placeholder}
          />
          {value && (
            <button
              type="button"
              onClick={() => onChange('')}
              className="text-mute hover:text-ink text-base leading-none"
              aria-label="Limpiar búsqueda"
            >
              ×
            </button>
          )}
        </div>
        {showCount && (
          <span className="text-xs text-mute whitespace-nowrap">
            {resultCount}/{totalCount}
          </span>
        )}
      </div>
    </div>
  );
}

async function enterAffiliatePanel(
  codeId: string,
  ownerName: string,
  router: ReturnType<typeof useRouter>,
) {
  try {
    const res = await api<any>(`/referrals/codes/${codeId}/impersonate`, {
      method: 'POST',
    });
    startImpersonation({
      accessToken: res.accessToken,
      user: res.user,
      affiliate: res.affiliate,
    });
    toast(`Entrando al panel de ${ownerName}…`, 'success');
    router.push('/affiliate');
  } catch (e: any) {
    toast(e.message || 'No se pudo entrar', 'error');
  }
}

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
    { id: 'clients', label: '🏢 Negocios' },
    { id: 'commissions', label: '💵 Comisiones' },
    { id: 'payouts', label: '⏳ Pendientes por pagar' },
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
  // FASE 9 sprint: ahora la búsqueda es 100% client-side (debounce 150ms)
  // a través del SectionSearchBar arriba — antes pegaba al server con
  // ?q= y debounce 300ms. Mantenemos los filtros server-side de fecha/
  // estado/afiliado/cliente porque agregan métricas y reducen payload.
  const [q, setQ] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [affiliateFilter, setAffiliateFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState<PayoutItem | null>(null);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
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

  const allItems = data?.items ?? [];
  const itemsAfterDropdowns = useMemo(
    () =>
      allItems
        .filter((c) => (affiliateFilter ? c.ownerEmail === affiliateFilter : true))
        .filter((c) => (clientFilter ? c.tenantBrand === clientFilter : true)),
    [allItems, affiliateFilter, clientFilter],
  );

  const filtered = useFilteredList(itemsAfterDropdowns, q, (c) =>
    [
      c.ownerName,
      c.ownerEmail,
      c.ownerWhatsapp,
      c.codeText,
      c.tenantBrand,
      c.notes,
      String(c.amount ?? ''),
      PAYOUT_STATUS[c.status]?.text,
      c.status,
      c.createdAt ? fmtDate(c.createdAt) : '',
      c.paidAt ? fmtDate(c.paidAt) : '',
    ]
      .filter(Boolean)
      .join(' '),
  );

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

      <SectionSearchBar
        value={q}
        onChange={setQ}
        placeholder="Buscar pago pendiente…"
        resultCount={filtered.length}
        totalCount={itemsAfterDropdowns.length}
      />

      {/* Filtros */}
      <div className="card card-pad mb-3 flex flex-wrap items-end gap-3">
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
        <div>
          <label className="label">Afiliado</label>
          <select
            className="input"
            value={affiliateFilter}
            onChange={(e) => setAffiliateFilter(e.target.value)}
          >
            <option value="">Todos</option>
            {Array.from(
              new Set((data?.items ?? []).map((i) => i.ownerEmail).filter(Boolean)),
            ).map((email) => {
              const item = data?.items.find((i) => i.ownerEmail === email);
              return (
                <option key={email} value={email}>
                  {item?.ownerName} ({email})
                </option>
              );
            })}
          </select>
        </div>
        <div>
          <label className="label">Cliente</label>
          <select
            className="input"
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
          >
            <option value="">Todos</option>
            {Array.from(
              new Set((data?.items ?? []).map((i) => i.tenantBrand).filter((b) => b && b !== '—')),
            ).map((brand) => (
              <option key={brand} value={brand}>
                {brand}
              </option>
            ))}
          </select>
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
              {!loading && filtered.length === 0 && (
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
                filtered.map((c) => {
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
  const [query, setQuery] = useState('');

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

  const filtered = useFilteredList(list, query, (c) =>
    [
      c.name,
      c.ownerCode?.code,
      c.ownerCode?.ownerName,
      c.status,
      STATUS_PILL[c.status]?.text,
      c.createdAt ? fmtDate(c.createdAt) : '',
    ]
      .filter(Boolean)
      .join(' '),
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="text-sm text-mute">
          Cada campaña pertenece a un influencer. Los embajadores reciben 25%
          y el influencer gana 5% por las ventas indirectas.
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-sm">
          <Icon name="plus" /> Nueva campaña
        </button>
      </div>

      {!loading && list.length > 0 && (
        <SectionSearchBar
          value={query}
          onChange={setQuery}
          placeholder="Buscar campaña…"
          resultCount={filtered.length}
          totalCount={list.length}
        />
      )}

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

      {!loading && list.length > 0 && filtered.length === 0 && (
        <div className="card card-pad text-center py-10">
          <div className="text-3xl mb-2">🔎</div>
          <div className="font-semibold">Sin coincidencias</div>
          <div className="text-sm text-mute mt-1">
            Ninguna campaña coincide con "{query}".
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((c) => (
          <a
            key={c.id}
            href={`/admin/referrals/campaigns/${c.id}`}
            className="card card-pad cursor-pointer hover:shadow-md2 transition block"
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
          </a>
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
    influencerPassword: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<{
    email: string;
    password: string;
    loginUrl: string;
  } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await api<any>('/campaigns', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      if (res?.affiliateCredentials) {
        setCredentials(res.affiliateCredentials);
        toast('Campaña creada — copia las credenciales del influencer', 'success');
      } else {
        toast('Campaña creada', 'success');
        onCreated();
      }
    } catch (e: any) {
      setErr(e.message || 'No se pudo crear');
    } finally {
      setBusy(false);
    }
  }

  // Pantalla de credenciales: aparece UNA SOLA VEZ después de crear.
  // El admin las copia y comparte con el afiliado (WhatsApp, etc).
  if (credentials) {
    return (
      <AffiliateCredentialsModal
        credentials={credentials}
        whoLabel={`influencer ${form.influencerName}`}
        whatsapp={form.influencerWhatsapp}
        onClose={() => {
          setCredentials(null);
          onCreated();
        }}
      />
    );
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
            <label className="label">Contraseña de acceso</label>
            <input
              className="input"
              type="text"
              required
              minLength={8}
              maxLength={64}
              placeholder="Mínimo 8 caracteres"
              value={form.influencerPassword}
              onChange={(e) =>
                setForm({ ...form, influencerPassword: e.target.value })
              }
            />
            <p className="text-xs text-mute mt-1">
              Esta es la contraseña que el influencer va a usar para entrar en /login. Copiala y compartila junto al email.
            </p>
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
  const [addForm, setAddForm] = useState({ fullName: '', email: '', whatsapp: '', commissionPercent: 25, customCode: '', password: '' });
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

  const [ambassadorCredentials, setAmbassadorCredentials] = useState<{
    email: string;
    password: string;
    loginUrl: string;
    fullName: string;
    whatsapp: string;
  } | null>(null);

  async function addAmbassador(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api<any>(`/campaigns/${campaignId}/ambassadors`, {
        method: 'POST',
        body: JSON.stringify(addForm),
      });
      const saved = { ...addForm };
      setAddForm({ fullName: '', email: '', whatsapp: '', commissionPercent: 25, customCode: '', password: '' });
      setShowAdd(false);
      load();
      onChanged();
      if (res?.affiliateCredentials) {
        setAmbassadorCredentials({
          ...res.affiliateCredentials,
          fullName: saved.fullName,
          whatsapp: saved.whatsapp,
        });
      } else {
        toast('Embajador agregado', 'success');
      }
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
                <input
                  className="input"
                  type="text"
                  required
                  minLength={8}
                  maxLength={64}
                  placeholder="Contraseña de acceso (mín 8 caracteres)"
                  value={addForm.password}
                  onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
                />
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
      {ambassadorCredentials && (
        <AffiliateCredentialsModal
          credentials={ambassadorCredentials}
          whoLabel={`embajador ${ambassadorCredentials.fullName}`}
          whatsapp={ambassadorCredentials.whatsapp}
          onClose={() => setAmbassadorCredentials(null)}
        />
      )}
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
    conversionRate: number;
  }>;
  topAmbassadors: Array<{
    code: string;
    ownerName: string;
    role: string;
    activeClients: number;
    totalClients: number;
    revenueUsd: number;
    conversionRate: number;
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                  <span className="font-mono">{r.code}</span> · {r.activeClients}/{r.totalClients} activos · {r.conversionRate}% conv
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
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const [demoteTarget, setDemoteTarget] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [query, setQuery] = useState('');

  function reload() {
    setLoading(true);
    api<any[]>('/referrals/influencers')
      .then((r) => setRows(r ?? []))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    reload();
  }, []);

  const filtered = useFilteredList(rows, query, (r) =>
    [
      r.ownerName,
      r.ownerEmail,
      r.ownerWhatsapp,
      r.code,
      r.country,
      r.city,
      r.campaignName,
      r.isActive === false ? 'inactivo' : 'activo',
    ]
      .filter(Boolean)
      .join(' '),
  );

  if (loading) return <div className="card card-pad h-32 animate-shimmer" />;

  return (
    <div>
      {rows.length > 0 && (
        <SectionSearchBar
          value={query}
          onChange={setQuery}
          placeholder="Buscar influencer…"
          resultCount={filtered.length}
          totalCount={rows.length}
        />
      )}
      <div className="card overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[940px]">
          <thead className="bg-bg2">
            <tr>
              {['Influencer', 'Código', '%', 'Campaña', 'Embajadores', 'Clientes', 'Pagado', 'Pendiente', ''].map(
                (h, i) => (
                  <th
                    key={h || `col-${i}`}
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
                  Aún no hay influencers
                </td>
              </tr>
            )}
            {rows.length > 0 && filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-10 text-mute">
                  <div className="text-2xl mb-1">🔎</div>
                  Sin influencers que coincidan con "{query}"
                </td>
              </tr>
            )}
            {filtered.map((r) => (
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
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex items-center gap-1.5">
                    <button
                      onClick={() => setDemoteTarget(r)}
                      className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-rose-100 text-rose-700 hover:bg-rose-200 whitespace-nowrap"
                      title="Convertir este influencer en embajador bajo otro influencer (preserva clientes y comisiones)"
                    >
                      ↓ Bajar
                    </button>
                    <button
                      disabled={enteringId === r.id}
                      onClick={async () => {
                        setEnteringId(r.id);
                        await enterAffiliatePanel(r.id, r.ownerName, router);
                        setEnteringId(null);
                      }}
                      className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-violet-100 text-violet-700 hover:bg-violet-200 disabled:opacity-50 whitespace-nowrap"
                      title="Entrar al panel /affiliate como este influencer (auditado en logs)"
                    >
                      {enteringId === r.id ? 'Entrando…' : '→ Panel'}
                    </button>
                    <button
                      onClick={() => setDeleteTarget(r)}
                      className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-red-100 text-red-700 hover:bg-red-200 whitespace-nowrap"
                      title="Eliminar este influencer (valida que no tenga tenants ni embajadores activos)"
                    >
                      🗑 Eliminar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {deleteTarget && (
        <ConfirmDeleteModal
          title={`Eliminar influencer "${deleteTarget.ownerName}"`}
          description={
            <>
              ¿Deseas eliminar este registro? Si tiene tenants atribuidos en
              estado <strong>activo o pagando</strong>, embajadores debajo
              suyo o una campaña activa,{' '}
              <strong>no se podrá eliminar</strong> — recibirás un aviso. Si
              no tiene historial, se borra por completo; si tenía clientes
              cancelados o embajadores inactivos, queda desactivado para
              preservar atribución histórica.
            </>
          }
          onConfirm={async () => {
            try {
              const res = await api<any>(
                `/referrals/codes/${deleteTarget.id}`,
                { method: 'DELETE' },
              );
              toast(
                res?.mode === 'hard'
                  ? `Influencer "${deleteTarget.ownerName}" eliminado`
                  : `Influencer "${deleteTarget.ownerName}" desactivado (tenía historial)`,
                'success',
              );
              setDeleteTarget(null);
              reload();
            } catch (e: any) {
              toast(e.message || 'No se pudo eliminar', 'error');
            }
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}
      {demoteTarget && (
        <InfluencerPickerModal
          title={`Bajar a "${demoteTarget.ownerName}" a embajador`}
          description={
            <>
              Pasa de <strong>INFLUENCER</strong> a <strong>AMBASSADOR</strong>{' '}
              colgando de otro influencer. Sus <strong>clientes y
              comisiones se preservan</strong> — solo cambia el rol y a
              quién reporta. Las próximas comisiones generadas pagarán 5%
              indirecto al nuevo influencer parent.
            </>
          }
          excludeId={demoteTarget.id}
          onClose={() => setDemoteTarget(null)}
          onPick={async (newParent) => {
            try {
              await api(
                `/referrals/influencers/${demoteTarget.id}/demote-to-ambassador`,
                {
                  method: 'POST',
                  body: JSON.stringify({ newParentId: newParent.id }),
                },
              );
              toast(
                `${demoteTarget.ownerName} ahora es embajador bajo ${newParent.ownerName}`,
                'success',
              );
              setDemoteTarget(null);
              reload();
            } catch (e: any) {
              toast(e.message || 'Error', 'error');
            }
          }}
        />
      )}
      </div>
    </div>
  );
}

function AmbassadorsTab() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const [reassignTarget, setReassignTarget] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  // FASE B1: modal de config "Permitir vendedores" + max %.
  const [vendorConfigTarget, setVendorConfigTarget] = useState<any | null>(null);
  const [query, setQuery] = useState('');

  function reload() {
    setLoading(true);
    api<any[]>('/referrals/ambassadors')
      .then((r) => setRows(r ?? []))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    reload();
  }, []);

  const filtered = useFilteredList(rows, query, (r) =>
    [
      r.ownerName,
      r.ownerEmail,
      r.ownerWhatsapp,
      r.code,
      r.country,
      r.city,
      r.parentName,
      r.parentCode,
      r.campaignName,
      r.isCompanyDirect ? 'directo empresa' : '',
      r.isActive === false ? 'inactivo' : 'activo',
    ]
      .filter(Boolean)
      .join(' '),
  );

  if (loading) return <div className="card card-pad h-32 animate-shimmer" />;

  // Particionamos: directos de empresa vs vinculados a influencer.
  const companyDirect = rows.filter((r) => r.isCompanyDirect);
  const linked = rows.filter((r) => !r.isCompanyDirect);

  return (
    <div className="space-y-5">
      <div className="card card-pad flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[260px]">
          <div className="font-semibold">Embajadores ({rows.length})</div>
          <div className="text-xs text-mute leading-relaxed mt-1">
            <strong>{companyDirect.length}</strong> directos de empresa ·{' '}
            <strong>{linked.length}</strong> vinculados a influencer.
            <br />
            Los <strong>directos de empresa</strong> no reportan a un
            influencer — reportan directo a Clubify. Mismo % de comisión,
            sin 5% indirecto.
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="btn-primary text-sm whitespace-nowrap"
        >
          + Embajador Directo Empresa
        </button>
      </div>

      {showCreate && (
        <CompanyDirectAmbassadorModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            reload();
          }}
        />
      )}

      {rows.length > 0 && (
        <SectionSearchBar
          value={query}
          onChange={setQuery}
          placeholder="Buscar embajador…"
          resultCount={filtered.length}
          totalCount={rows.length}
        />
      )}

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1040px]">
            <thead className="bg-bg2">
              <tr>
                {['Embajador', 'Código', '%', 'Reporta a', 'Campaña', 'Activos', 'Total', 'Vendedores', 'Pagado', 'Pendiente', ''].map(
                  (h, i) => (
                    <th
                      key={h || `col-${i}`}
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
                  <td colSpan={11} className="text-center py-12 text-mute">
                    Aún no hay embajadores
                  </td>
                </tr>
              )}
              {rows.length > 0 && filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="text-center py-10 text-mute">
                    <div className="text-2xl mb-1">🔎</div>
                    Sin embajadores que coincidan con "{query}"
                  </td>
                </tr>
              )}
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className={`border-t border-line2 hover:bg-[#FAFAFB] ${r.isActive ? '' : 'opacity-50'}`}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium flex items-center gap-1.5">
                      {r.ownerName}
                      {r.isCompanyDirect && (
                        <span className="inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 whitespace-nowrap">
                          🏢 Directo Empresa
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-mute">{r.ownerEmail}</div>
                  </td>
                  <td className="px-4 py-3 font-mono font-bold">{r.code}</td>
                  <td className="px-4 py-3">{r.commissionPercent}%</td>
                  <td className="px-4 py-3 text-xs">
                    {r.isCompanyDirect ? (
                      <span className="text-violet-700 font-medium">Empresa</span>
                    ) : r.parentName ? (
                      <>
                        {r.parentName}
                        <div className="text-mute font-mono">{r.parentCode}</div>
                      </>
                    ) : (
                      <span className="text-mute">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">{r.campaignName ?? '—'}</td>
                  <td className="px-4 py-3 text-center">{r.activeClients}</td>
                  <td className="px-4 py-3 text-center">{r.clients}</td>
                  <td className="px-4 py-3 text-center text-xs">
                    {/* FASE B1: counter de vendedores activos. Si el módulo
                        no está habilitado, lo mostramos en mute para que
                        sea obvio. */}
                    {r.allowVendors ? (
                      <span className="font-bold">
                        {r.activeVendorsCount ?? 0}
                        <span className="text-mute font-normal">
                          {' '}
                          / {r.maxCommissionPercent ?? 25}%
                        </span>
                      </span>
                    ) : (
                      <span className="text-mute">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ok font-medium">{fmtUsd(r.paidUsd)}</td>
                  <td className="px-4 py-3 text-amber-700 font-medium">{fmtUsd(r.pendingUsd)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        onClick={async () => {
                          if (
                            !confirm(
                              `¿Promover a "${r.ownerName}" de embajador a influencer?\n\nMantiene su historial, referidos y comisiones. Obtiene panel /affiliate completo con permiso para crear sus propios embajadores. La acción es reversible solo manualmente.`,
                            )
                          )
                            return;
                          try {
                            await api(
                              `/referrals/ambassadors/${r.id}/promote-to-influencer`,
                              { method: 'POST' },
                            );
                            toast(`${r.ownerName} ahora es influencer`, 'success');
                            reload();
                          } catch (e: any) {
                            toast(e.message || 'Error', 'error');
                          }
                        }}
                        className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-amber-100 text-amber-800 hover:bg-amber-200 whitespace-nowrap"
                        title="Convertir este embajador en influencer (panel completo, puede crear embajadores)"
                      >
                        ↑ Promover
                      </button>
                      <button
                        onClick={() => setReassignTarget(r)}
                        className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-sky-100 text-sky-800 hover:bg-sky-200 whitespace-nowrap"
                        title="Cambiar el influencer al que reporta este embajador (preserva clientes y comisiones)"
                      >
                        ↻ Cambiar influencer
                      </button>
                      <button
                        onClick={() => setVendorConfigTarget(r)}
                        className={`text-xs font-semibold px-2.5 py-1.5 rounded-md whitespace-nowrap ${
                          r.allowVendors
                            ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                            : 'bg-bg2 text-mute hover:bg-line2'
                        }`}
                        title="Configurar módulo de vendedores (toggle + comisión máxima)"
                      >
                        👥 Vendedores
                      </button>
                      <button
                        disabled={enteringId === r.id}
                        onClick={async () => {
                          setEnteringId(r.id);
                          await enterAffiliatePanel(r.id, r.ownerName, router);
                          setEnteringId(null);
                        }}
                        className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-violet-100 text-violet-700 hover:bg-violet-200 disabled:opacity-50 whitespace-nowrap"
                        title="Entrar al panel /affiliate como este embajador (auditado en logs)"
                      >
                        {enteringId === r.id ? 'Entrando…' : '→ Panel'}
                      </button>
                      <button
                        onClick={() => setDeleteTarget(r)}
                        className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-red-100 text-red-700 hover:bg-red-200 whitespace-nowrap"
                        title="Eliminar este embajador (valida que no tenga tenants activos)"
                      >
                        🗑 Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {deleteTarget && (
        <ConfirmDeleteModal
          title={`Eliminar embajador "${deleteTarget.ownerName}"`}
          description={
            <>
              ¿Deseas eliminar este registro? Si tiene tenants atribuidos en
              estado <strong>activo o pagando</strong>,{' '}
              <strong>no se podrá eliminar</strong> — recibirás un aviso con
              la cantidad. Si tenía clientes cancelados queda desactivado
              para preservar atribución histórica.
            </>
          }
          onConfirm={async () => {
            try {
              const res = await api<any>(
                `/referrals/codes/${deleteTarget.id}`,
                { method: 'DELETE' },
              );
              toast(
                res?.mode === 'hard'
                  ? `Embajador "${deleteTarget.ownerName}" eliminado`
                  : `Embajador "${deleteTarget.ownerName}" desactivado (tenía historial)`,
                'success',
              );
              setDeleteTarget(null);
              reload();
            } catch (e: any) {
              toast(e.message || 'No se pudo eliminar', 'error');
            }
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}
      {reassignTarget && (
        <InfluencerPickerModal
          title={`Cambiar influencer de "${reassignTarget.ownerName}"`}
          description={
            <>
              Mueve este embajador a otro <strong>influencer parent</strong>.
              Clientes y comisiones se preservan — solo cambia a quién
              reporta. Las próximas comisiones indirectas (5%) van al nuevo
              influencer; las históricas quedan donde están.
              {reassignTarget.parentName && (
                <>
                  <br />
                  <span className="text-mute">
                    Actualmente bajo: <strong>{reassignTarget.parentName}</strong>
                  </span>
                </>
              )}
            </>
          }
          excludeId={reassignTarget.parentCodeId ?? null}
          onClose={() => setReassignTarget(null)}
          onPick={async (newParent) => {
            try {
              await api(
                `/referrals/ambassadors/${reassignTarget.id}/reassign-parent`,
                {
                  method: 'POST',
                  body: JSON.stringify({ newParentId: newParent.id }),
                },
              );
              toast(
                `${reassignTarget.ownerName} ahora reporta a ${newParent.ownerName}`,
                'success',
              );
              setReassignTarget(null);
              reload();
            } catch (e: any) {
              toast(e.message || 'Error', 'error');
            }
          }}
        />
      )}
      {vendorConfigTarget && (
        <VendorConfigModal
          embajador={vendorConfigTarget}
          onClose={() => setVendorConfigTarget(null)}
          onSaved={() => {
            setVendorConfigTarget(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

/**
 * FASE B1 — Modal del super admin para togglear el módulo de
 * vendedores de un embajador y setear cuál es su comisión máxima
 * (lo que él puede repartir). PATCH /referrals/codes/:id/vendor-config
 */
function VendorConfigModal({
  embajador,
  onClose,
  onSaved,
}: {
  embajador: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [allowVendors, setAllowVendors] = useState<boolean>(
    !!embajador.allowVendors,
  );
  const [maxPct, setMaxPct] = useState<number>(
    Number(embajador.maxCommissionPercent ?? 25),
  );
  const [busy, setBusy] = useState(false);

  const activeCount = Number(embajador.activeVendorsCount ?? 0);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (maxPct <= 0 || maxPct > 100) {
      toast('La comisión máxima debe ser > 0 y <= 100', 'error');
      return;
    }
    setBusy(true);
    try {
      await api(`/referrals/codes/${embajador.id}/vendor-config`, {
        method: 'PATCH',
        body: JSON.stringify({
          allowVendors,
          maxCommissionPercent: maxPct,
        }),
      });
      toast(`Configuración actualizada para ${embajador.ownerName}`, 'success');
      onSaved();
    } catch (e: any) {
      toast(e.message || 'Error al guardar', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
        <div className="px-5 py-4 border-b border-line2 flex items-center justify-between">
          <div>
            <div className="font-semibold text-base">
              Módulo vendedores · {embajador.ownerName}
            </div>
            <div className="text-[11px] text-mute mt-0.5">
              Permite al embajador armar su equipo y repartir parte de su
              comisión.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-mute hover:text-ink text-xl leading-none"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
        <form onSubmit={save} className="px-5 py-4 space-y-4">
          <label className="flex items-start gap-3 p-3 rounded-lg border border-line cursor-pointer">
            <input
              type="checkbox"
              checked={allowVendors}
              onChange={(e) => setAllowVendors(e.target.checked)}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="font-semibold text-sm">
                Permitir vendedores
              </div>
              <div className="text-[11px] text-mute leading-snug mt-0.5">
                Habilita la página /affiliate/team del embajador para que
                pueda crear y gestionar sus propios vendedores.
              </div>
            </div>
          </label>

          <div>
            <label className="label">Comisión máxima %</label>
            <input
              className="input"
              type="number"
              min={0.5}
              max={100}
              step={0.5}
              required
              value={maxPct}
              onChange={(e) => setMaxPct(Number(e.target.value) || 0)}
            />
            <div className="text-[11px] text-mute mt-1 leading-snug">
              Tope que el embajador puede repartir entre todos sus
              vendedores activos. Default 25%. La suma de los % de sus
              vendedores no puede superar este número.
            </div>
          </div>

          {activeCount > 0 && !allowVendors && (
            <div className="text-[11px] rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 leading-snug">
              ⚠ Este embajador tiene <strong>{activeCount}</strong>{' '}
              vendedor(es) activo(s). Si desactivas el módulo, dejará de
              poder administrarlos desde su panel — pero los vendedores y
              sus comisiones históricas se preservan. Puedes re-activar el
              módulo cuando quieras sin perder nada.
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost text-sm"
              disabled={busy}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-primary text-sm"
              disabled={busy}
            >
              {busy ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function InfluencerPickerModal({
  title,
  description,
  excludeId,
  onClose,
  onPick,
}: {
  title: string;
  description: React.ReactNode;
  excludeId: string | null;
  onClose: () => void;
  onPick: (influencer: { id: string; ownerName: string; code: string }) => void;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<any[]>('/referrals/influencers')
      .then((r) => setRows((r ?? []).filter((x) => x.id !== excludeId && x.isActive !== false)))
      .finally(() => setLoading(false));
  }, [excludeId]);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? rows.filter(
        (r) =>
          r.ownerName?.toLowerCase().includes(q) ||
          r.code?.toLowerCase().includes(q) ||
          r.ownerEmail?.toLowerCase().includes(q),
      )
    : rows;
  const picked = filtered.find((r) => r.id === pickedId);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-line2">
          <div className="font-semibold text-base">{title}</div>
          <div className="text-xs text-mute leading-relaxed mt-1.5">
            {description}
          </div>
        </div>
        <div className="px-5 py-3 border-b border-line2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar influencer por nombre, código o email…"
            className="w-full px-3 py-2 text-sm rounded-md border border-line2 focus:outline-none focus:ring-2 focus:ring-violet-400"
            autoFocus
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-center text-mute text-sm">Cargando…</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-mute text-sm">
              {q ? 'Sin resultados' : 'No hay otros influencers disponibles'}
            </div>
          ) : (
            <ul className="divide-y divide-line2">
              {filtered.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => setPickedId(r.id)}
                    className={`w-full text-left px-5 py-3 hover:bg-bg2 transition ${
                      pickedId === r.id ? 'bg-violet-50' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{r.ownerName}</div>
                        <div className="text-xs text-mute truncate">
                          {r.ownerEmail}
                          {r.campaignName && (
                            <> · Campaña: <strong>{r.campaignName}</strong></>
                          )}
                        </div>
                      </div>
                      <div className="text-xs font-mono font-bold whitespace-nowrap">
                        {r.code}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="px-5 py-3 border-t border-line2 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="text-sm px-3 py-2 rounded-md hover:bg-bg2"
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            disabled={!picked || busy}
            onClick={async () => {
              if (!picked) return;
              setBusy(true);
              try {
                await onPick(picked);
              } finally {
                setBusy(false);
              }
            }}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {busy ? 'Aplicando…' : picked ? `Asignar a ${picked.ownerName}` : 'Elige un influencer'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CompanyDirectAmbassadorModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    whatsapp: '',
    commissionPercent: 25,
    customCode: '',
  });
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload: any = {
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        whatsapp: form.whatsapp.trim(),
        commissionPercent: Number(form.commissionPercent),
      };
      if (form.customCode.trim()) payload.customCode = form.customCode.trim().toUpperCase();
      await api('/referrals/ambassadors/company-direct', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      toast(
        'Embajador Directo Empresa creado · invitación enviada por email',
        'success',
      );
      onCreated();
    } catch (e: any) {
      toast(e.message || 'No se pudo crear', 'error');
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl"
      >
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-lg font-bold">🏢 Embajador Directo Empresa</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-mute hover:text-ink text-xl leading-none"
          >
            ×
          </button>
        </div>
        <p className="text-xs text-mute leading-relaxed mb-4">
          Reporta directo a Clubify (sin influencer parent). Mismo % de comisión
          que un embajador normal; el 5% indirecto se queda con la empresa.
          Recibe invitación por email y panel propio en <code>/affiliate</code>.
        </p>

        <label className="label">Nombre completo</label>
        <input
          className="input"
          value={form.fullName}
          onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          required
          minLength={2}
        />

        <label className="label mt-3">Email</label>
        <input
          className="input"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
        />

        <label className="label mt-3">WhatsApp (con código país)</label>
        <input
          className="input"
          value={form.whatsapp}
          onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
          placeholder="+57 300 000 0000"
          required
        />

        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <label className="label">Comisión %</label>
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              step={1}
              value={form.commissionPercent}
              onChange={(e) =>
                setForm({ ...form, commissionPercent: Number(e.target.value) })
              }
            />
          </div>
          <div>
            <label className="label">Código custom (opcional)</label>
            <input
              className="input font-mono uppercase"
              value={form.customCode}
              onChange={(e) =>
                setForm({ ...form, customCode: e.target.value.toUpperCase() })
              }
              placeholder="JUAN2026"
              maxLength={16}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost text-sm"
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {busy ? 'Creando…' : 'Crear y enviar invitación'}
          </button>
        </div>
      </form>
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
  const [query, setQuery] = useState('');

  useEffect(() => {
    api<any[]>('/referrals/clients')
      .then((r) => setRows(r ?? []))
      .finally(() => setLoading(false));
  }, []);

  const byStatus = rows.filter((r) => {
    if (filter === 'active') return r.status === 'ACTIVE' || r.status === 'PAYING';
    if (filter === 'churned') return r.status === 'CHURNED';
    if (filter === 'trial') return r.status === 'SIGNED_UP';
    return true;
  });

  const visible = useFilteredList(byStatus, query, (r) =>
    [
      r.tenantBrand,
      r.tenantStatus,
      r.ownerName,
      r.email,
      r.whatsappPhone,
      r.city,
      r.country,
      r.plan,
      r.attribution?.ownerName,
      r.attribution?.code,
      r.attribution?.parentName,
      r.attribution?.parentCode,
      r.attribution?.role,
      CLIENT_STATUS[r.status]?.text,
    ]
      .filter(Boolean)
      .join(' '),
  );

  if (loading) return <div className="card card-pad h-32 animate-shimmer" />;

  return (
    <div>
      {rows.length > 0 && (
        <SectionSearchBar
          value={query}
          onChange={setQuery}
          placeholder="Buscar negocio…"
          resultCount={visible.length}
          totalCount={byStatus.length}
        />
      )}
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
                    Sin negocios en este filtro
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
  const [query, setQuery] = useState('');
  // FASE 9 sprint: chips de filtro adicionales por status.
  // Periodicidad no viene en el endpoint actual (PayoutItem), se omite.
  const [statusChip, setStatusChip] = useState<
    'all' | 'pending' | 'paid' | 'partial'
  >('all');

  useEffect(() => {
    api<PayoutsResp>('/referrals/payouts').then(setData).finally(() => setLoading(false));
  }, []);

  const items = data?.items ?? [];

  const byStatus = useMemo(() => {
    if (statusChip === 'all') return items;
    if (statusChip === 'paid') return items.filter((c) => c.status === 'PAID');
    if (statusChip === 'pending')
      return items.filter((c) => c.status === 'PENDING' || c.status === 'APPROVED');
    // "partial" no existe como status nativo del endpoint actual; lo dejamos
    // mapeado a comisiones rechazadas para no romper el chip cuando no hay data.
    if (statusChip === 'partial')
      return items.filter((c) => c.status === 'REJECTED');
    return items;
  }, [items, statusChip]);

  const filtered = useFilteredList(byStatus, query, (c) =>
    [
      c.ownerName,
      c.ownerEmail,
      c.ownerWhatsapp,
      c.codeText,
      c.tenantBrand,
      c.notes,
      String(c.amount ?? ''),
      PAYOUT_STATUS[c.status]?.text,
      c.status,
      c.createdAt ? fmtDate(c.createdAt) : '',
      c.paidAt ? fmtDate(c.paidAt) : '',
    ]
      .filter(Boolean)
      .join(' '),
  );

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

      {items.length > 0 && (
        <SectionSearchBar
          value={query}
          onChange={setQuery}
          placeholder="Buscar comisión…"
          resultCount={filtered.length}
          totalCount={byStatus.length}
        />
      )}

      {items.length > 0 && (
        <div className="flex gap-1 mb-3 flex-wrap">
          {(
            [
              { id: 'all', label: 'Todas' },
              { id: 'pending', label: 'Pendiente' },
              { id: 'paid', label: 'Pagada' },
              { id: 'partial', label: 'Parcial' },
            ] as const
          ).map((chip) => {
            const active = statusChip === chip.id;
            return (
              <button
                key={chip.id}
                onClick={() => setStatusChip(chip.id)}
                className={`text-xs px-3 py-1.5 rounded-pill border ${
                  active
                    ? 'bg-ink text-white border-ink'
                    : 'bg-white border-line text-mute hover:text-ink'
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      )}

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
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-mute">
                    Sin comisiones todavía
                  </td>
                </tr>
              )}
              {items.length > 0 && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-mute">
                    <div className="text-2xl mb-1">🔎</div>
                    Sin comisiones que coincidan con los filtros
                  </td>
                </tr>
              )}
              {filtered.map((c) => {
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
  allowInfluencerCreatesAmbassadors: boolean;
  requireAmbassadorApproval: boolean;
  notifyChannel: 'SMS' | 'EMAIL' | 'BOTH';
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
          allowInfluencerCreatesAmbassadors: cfg.allowInfluencerCreatesAmbassadors,
          requireAmbassadorApproval: cfg.requireAmbassadorApproval,
          notifyChannel: cfg.notifyChannel,
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
            de qué código se use. Solo códigos con rol SOCIO aparecen aquí.
          </div>
          {socioOptions.length > 0 && (
            <select
              className="input mb-3"
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
          <SocioInviteForm onCreated={load} />
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
          <h3 className="font-semibold m-0 mb-1">👥 Embajadores (permisos)</h3>
          <div className="text-xs text-mute mb-3">
            Controla si los influencers pueden crear sus propios embajadores
            desde su panel y si esos requieren aprobación tuya.
          </div>
        </div>
        <NotifToggle
          label="Permitir que influencers creen embajadores"
          description="Cuando está activo, el influencer ve un botón '+ Embajador' en su panel."
          checked={cfg.allowInfluencerCreatesAmbassadors}
          onChange={(v) => setCfg({ ...cfg, allowInfluencerCreatesAmbassadors: v })}
        />
        <NotifToggle
          label="Requerir aprobación manual de embajadores"
          description="Los embajadores creados por influencers quedan pendientes hasta que los apruebes aquí."
          checked={cfg.requireAmbassadorApproval}
          onChange={(v) => setCfg({ ...cfg, requireAmbassadorApproval: v })}
        />
        <PendingAmbassadorsList />
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
        <div className="pt-2 border-t border-line">
          <label className="label">Canal de envío</label>
          <select
            className="input"
            value={cfg.notifyChannel}
            onChange={(e) => setCfg({ ...cfg, notifyChannel: e.target.value as any })}
          >
            <option value="SMS">📱 Solo SMS / WhatsApp</option>
            <option value="EMAIL">📧 Solo email</option>
            <option value="BOTH">📱 + 📧 Ambos</option>
          </select>
        </div>
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

function PendingAmbassadorsList() {
  const [pending, setPending] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setPending(await api<any[]>('/referrals/pending-ambassadors'));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function approve(id: string) {
    await api(`/referrals/ambassadors/${id}/approve`, { method: 'POST' });
    toast('Embajador aprobado', 'success');
    load();
  }
  async function reject(id: string) {
    if (!confirm('¿Rechazar este embajador? Quedará desactivado.')) return;
    await api(`/referrals/ambassadors/${id}/reject`, { method: 'POST' });
    toast('Embajador rechazado', 'success');
    load();
  }

  if (loading) return null;
  if (pending.length === 0) return null;

  return (
    <div className="border-t border-line pt-3 mt-2">
      <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-2">
        Pendientes de aprobación ({pending.length})
      </div>
      <div className="space-y-2">
        {pending.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200"
          >
            <div className="min-w-0">
              <div className="font-medium text-sm">{p.ownerName}</div>
              <div className="text-xs text-mute">
                {p.ownerEmail} · <span className="font-mono">{p.code}</span> ·{' '}
                {Number(p.commissionPercent)}%
              </div>
              {p.parentCode && (
                <div className="text-[11px] text-mute mt-0.5">
                  Creado por {p.parentCode.ownerName} ({p.parentCode.code})
                </div>
              )}
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => approve(p.id)} className="text-xs text-ok hover:underline">
                ✓ Aprobar
              </button>
              <button onClick={() => reject(p.id)} className="text-xs text-bad hover:underline">
                Rechazar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SocioInviteForm({ onCreated }: { onCreated: () => void }) {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    whatsapp: '',
    commissionPercent: 10,
    customCode: '',
  });
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/referrals/socio', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      toast('Socio creado e invitado por email', 'success');
      setForm({ fullName: '', email: '', whatsapp: '', commissionPercent: 10, customCode: '' });
      setShow(false);
      onCreated();
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {!show ? (
        <button onClick={() => setShow(true)} className="btn-ghost text-xs w-full">
          + Crear / invitar socio nuevo
        </button>
      ) : (
        <form onSubmit={submit} className="border border-line rounded-lg p-3 space-y-2 bg-bg2/30">
          <div className="grid grid-cols-2 gap-2">
            <input
              className="input"
              placeholder="Nombre completo"
              required
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
            <input
              className="input"
              type="email"
              placeholder="Email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input
              className="input"
              placeholder="WhatsApp"
              required
              value={form.whatsapp}
              onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
            />
            <input
              type="number"
              min={0}
              max={100}
              className="input"
              placeholder="% global"
              value={form.commissionPercent}
              onChange={(e) => setForm({ ...form, commissionPercent: Number(e.target.value) })}
            />
            <input
              className="input"
              placeholder="Código (opcional)"
              value={form.customCode}
              onChange={(e) => setForm({ ...form, customCode: e.target.value.toUpperCase() })}
            />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShow(false)} className="btn-ghost text-xs flex-1">
              Cancelar
            </button>
            <button type="submit" disabled={busy} className="btn-primary text-xs flex-1">
              {busy ? 'Creando…' : 'Crear y enviar invite'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
