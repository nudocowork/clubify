'use client';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { api, startImpersonation } from '@/lib/api';
import { useAuthBrand } from '@/components/AuthBrand';
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
  const t = useTranslations('admin_referrals');
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
              aria-label={t('clearSearch')}
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

/**
 * Tooltip del botón "→ Panel". El backend manda `impersonateBlock` con el
 * motivo por el que entrar al panel no es viable en esa fila (null = sí lo
 * es); acá lo traducimos a una instrucción accionable en vez de dejar que el
 * clic falle con un 400 crudo.
 */
function panelTooltip(
  block: string | null | undefined,
  fallbackKey: string,
  t: (key: string, values?: Record<string, any>) => string,
): string {
  if (block === 'NO_ACCOUNT') return t('enterPanelBlockedNoAccount');
  if (block === 'INACTIVE') return t('enterPanelBlockedInactive');
  if (block === 'NOT_AFFILIATE') return t('enterPanelBlockedNotAffiliate');
  return t(fallbackKey);
}

async function enterAffiliatePanel(
  codeId: string,
  ownerName: string,
  router: ReturnType<typeof useRouter>,
  t: (key: string, values?: Record<string, any>) => string,
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
    toast(t('toastEnteringPanel', { name: ownerName }), 'success');
    router.push('/affiliate');
  } catch (e: any) {
    toast(e.message || t('errorCouldNotEnter'), 'error');
  }
}

// Cada status mapea a su clase de color + key de traducción (admin_referrals).
const STATUS_LABEL: Record<string, { key: string; cls: string }> = {
  SIGNED_UP: { key: 'statusSignedUp', cls: 'bg-bg2 text-mute' },
  ACTIVE: { key: 'statusInTrial', cls: 'bg-amber-100 text-amber-800' },
  PAYING: { key: 'statusPaying', cls: 'bg-ok-soft text-ok' },
  CHURNED: { key: 'statusChurned', cls: 'bg-red-100 text-red-800' },
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

const PAYOUT_STATUS: Record<PayoutItem['status'], { key: string; cls: string }> = {
  PENDING: { key: 'payoutStatusPending', cls: 'bg-amber-100 text-amber-800' },
  APPROVED: { key: 'payoutStatusApproved', cls: 'bg-ok-soft text-ok' },
  PAID: { key: 'payoutStatusPaid', cls: 'bg-bg2 text-mute' },
  REJECTED: { key: 'payoutStatusRejected', cls: 'bg-red-100 text-red-800' },
};

export default function AdminReferrals() {
  const t = useTranslations('admin_referrals');
  const [tab, setTab] = useState<Tab>('summary');

  // #10 (2026-06-16): la pestaña "Campañas" se eliminó del panel. El modelo
  // Campaign y su data se mantienen (las campañas viejas siguen funcionando
  // vía parentCodeId), pero ya no se gestionan desde acá: los influencers se
  // crean directo (#36) y los embajadores se autoregistran por link (#35).
  const TABS: { id: Tab; label: string }[] = [
    { id: 'summary', label: `📊 ${t('tabSummary')}` },
    { id: 'influencers', label: `🌟 ${t('tabInfluencers')}` },
    { id: 'ambassadors', label: `👥 ${t('tabAmbassadors')}` },
    { id: 'clients', label: `🏢 ${t('tabClients')}` },
    { id: 'commissions', label: `💵 ${t('tabCommissions')}` },
    { id: 'payouts', label: `⏳ ${t('tabPayouts')}` },
    { id: 'config', label: `⚙️ ${t('tabConfig')}` },
  ];

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">{t('pageTitle')}</h1>
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
  const t = useTranslations('admin_referrals');
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setRows(await api<LeaderRow[]>('/referrals/leaderboard'));
    } catch (e: any) {
      toast(e.message || t('errorLoadingLeaderboard'), 'error');
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
        <Kpi label={t('kpiAffiliates')} value={totals.affiliates.toString()} />
        <Kpi label={t('kpiTotalSignups')} value={totals.referrals.toString()} />
        <Kpi label={t('kpiPaidConversions')} value={totals.conversions.toString()} tone="ok" />
        <Kpi label={t('kpiRevenueGenerated')} value={fmtUsd(totals.revenue)} tone="brand" />
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="bg-bg2">
              <tr>
                {['#', t('colAffiliate'), t('colSignups'), t('colConversions'), t('colRevenue'), t('colPaid'), t('colPending')].map(
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
                    <div className="font-semibold text-ink">{t('emptyNoAffiliates')}</div>
                    <div className="text-xs mt-1">
                      {t('emptyNoAffiliatesHint')}
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
                          {t('codesCountList', { count: r.codes.length, list: r.codes.join(', ') })}
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
  const t = useTranslations('admin_referrals');
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
      toast(e.message || t('errorLoadingPayouts'), 'error');
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
      PAYOUT_STATUS[c.status] ? t(PAYOUT_STATUS[c.status].key) : '',
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
      toast(t('toastCommissionMarkedPaid'), 'success');
      load();
    } catch (e: any) {
      toast(e.message || t('errorGeneric'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    if (!confirm(t('confirmVoidSale')))
      return;
    setBusyId(id);
    try {
      const res = await api<{ cascaded?: number }>(`/referrals/commissions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'REJECTED', cascade: true }),
      });
      const extra = res?.cascaded ? t('saleVoidedExtra', { count: res.cascaded }) : '';
      toast(t('toastSaleVoided', { extra }), 'success');
      load();
    } catch (e: any) {
      toast(e.message || t('errorGeneric'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <Kpi
          label={t('kpiAvailableToPay')}
          value={fmtUsd(data?.totals.availableUsd ?? 0)}
          tone="ok"
        />
        <Kpi
          label={t('kpiOnHold30d')}
          value={fmtUsd(data?.totals.pendingUsd ?? 0)}
          tone="warn"
        />
        <Kpi label={t('kpiPaidHistoric')} value={fmtUsd(data?.totals.paidUsd ?? 0)} tone="brand" />
      </div>

      <SectionSearchBar
        value={q}
        onChange={setQ}
        placeholder={t('phSearchPendingPayout')}
        resultCount={filtered.length}
        totalCount={itemsAfterDropdowns.length}
      />

      {/* Filtros */}
      <div className="card card-pad mb-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">{t('filterStatus')}</label>
          <select
            className="input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
          >
            <option value="AVAILABLE_OR_PENDING">{t('filterAvailablePlusHold')}</option>
            <option value="APPROVED">{t('filterOnlyAvailable')}</option>
            <option value="PENDING">{t('filterOnlyHold')}</option>
            <option value="PAID">{t('filterPaid')}</option>
            <option value="ALL">{t('filterAll')}</option>
          </select>
        </div>
        <div>
          <label className="label">{t('filterFrom')}</label>
          <input
            type="date"
            className="input"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="label">{t('filterTo')}</label>
          <input
            type="date"
            className="input"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        <div>
          <label className="label">{t('filterAffiliate')}</label>
          <select
            className="input"
            value={affiliateFilter}
            onChange={(e) => setAffiliateFilter(e.target.value)}
          >
            <option value="">{t('filterAll')}</option>
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
          <label className="label">{t('filterClient')}</label>
          <select
            className="input"
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
          >
            <option value="">{t('filterAll')}</option>
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
        🛈 {t('holdNote', { days: data?.holdDays ?? 30 })}
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead className="bg-bg2">
              <tr>
                {[t('colAffiliate'), t('colBusiness'), t('colAmount'), t('colStatus'), t('colCreated'), t('colAvailable'), t('colPaidDate'), ''].map(
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
                      {t('emptyNoCommissionsFilters')}
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
                          {t(st.key)}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-mute">
                        {fmtDate(c.createdAt)}
                      </td>
                      <td className="px-4 py-3.5 text-xs">
                        {fmtDate(c.availableAt)}
                        {c.status === 'PENDING' && dayDiff > 0 && (
                          <div className="text-[10px] text-amber-700">
                            {t('inDays', { days: dayDiff })}
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
                              ? t('noteTooltip', { note: `${c.notes.slice(0, 60)}${c.notes.length > 60 ? '…' : ''}` })
                              : t('addInternalNote')
                          }
                        >
                          {c.notes ? '📝' : '＋'}
                        </button>
                        {c.clientContactedAt && (
                          <span
                            className="text-[10px] text-ok mr-2"
                            title={t('contactedTooltip', { date: fmtDate(c.clientContactedAt) })}
                          >
                            ✓ {t('contacted')}
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
                                  ? t('waitingHold')
                                  : t('markAsPaid')
                              }
                            >
                              ✓ {t('btnPay')}
                            </button>
                            <button
                              disabled={busyId === c.id}
                              onClick={() => reject(c.id)}
                              className="ml-2 text-bad underline text-xs"
                            >
                              {t('btnReject')}
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
  const t = useTranslations('admin_referrals');
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
      toast(t('toastNoteSaved'), 'success');
      onSaved();
    } catch (e: any) {
      toast(e.message || t('errorGeneric'), 'error');
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
          <h2 className="text-lg font-semibold m-0">{t('internalNote')}</h2>
          <button onClick={onClose} className="text-mute hover:text-ink text-xl leading-none">
            ×
          </button>
        </div>
        <div className="text-xs text-mute mb-3">
          {t('commissionOf')} <strong>{item.ownerName}</strong> · {fmtUsd(item.amount)} ·{' '}
          {t('clientLower')} <strong>{item.tenantBrand}</strong>
        </div>
        <textarea
          className="input min-h-[120px] mb-3"
          placeholder={t('phInternalNote')}
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
          <span>{t('clientContactedForPayment')}</span>
        </label>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost" disabled={busy}>
            {t('btnCancel')}
          </button>
          <button onClick={save} className="btn-primary" disabled={busy}>
            {busy ? t('saving') : t('save')}
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
  const t = useTranslations('admin_referrals');
  // Nombre de la marca (Sellea en su dominio) para textos que decían "Clubify".
  const { brand } = useAuthBrand();
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
      toast(t('toastLinkCopied'), 'success');
    } catch {
      toast(t('toastCopyFailed'), 'error');
    }
  }

  async function load() {
    try {
      setLoading(true);
      setList(await api('/referrals'));
    } catch (e: any) {
      toast(e.message || t('errorLoadingReferrals'), 'error');
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
      toast(t('invalidAmount'), 'error');
      return;
    }
    setSaving(true);
    try {
      await api(`/referrals/uses/${commissionFor.useId}/commission`, {
        method: 'POST',
        body: JSON.stringify({ amount: n }),
      });
      toast(t('toastCommissionAdded', { amount: n }), 'success');
      setCommissionFor(null);
      setAmount('');
      load();
    } catch (e: any) {
      toast(e.message || t('errorCouldNotAddCommission'), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(commId: string, status: string) {
    // #4: rechazar anula toda la venta (cascada en backend). Avisar.
    if (status === 'REJECTED' && !confirm(t('confirmVoidSaleCodes')))
      return;
    try {
      const res = await api<{ cascaded?: number }>(`/referrals/commissions/${commId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      if (status === 'REJECTED') {
        const extra = res?.cascaded ? t('saleVoidedExtra', { count: res.cascaded }) : '';
        toast(t('toastSaleVoided', { extra }), 'success');
      } else {
        toast(
          status === 'PAID'
            ? t('toastCommissionMarkedPaid')
            : t('toastCommissionMarkedAs', { status }),
          'success',
        );
      }
      load();
    } catch (e: any) {
      toast(e.message || t('errorCouldNotUpdate'), 'error');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-mute text-sm">{t('codesGenerated', { count: list.length })}</div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => setShowLinkGen(true)}
        >
          <Icon name="plus" /> {t('generateCaptureLink')}
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
            <div className="font-semibold">{t('emptyNoCodes')}</div>
            <p className="text-sm text-mute mt-1.5 max-w-md mx-auto">
              {t('emptyNoCodesHint')}
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
                    {t('percentCommission', { percent: Number(r.commissionPercent) })}
                  </span>
                  {r.source && (
                    <span
                      className="badge badge-mute text-[11px]"
                      title={t('affiliateSourceTooltip')}
                    >
                      📣 {r.source}
                    </span>
                  )}
                  <span className="text-xs text-mute">
                    {t('signupsCount', { count: r.uses.length })}
                  </span>
                </div>
              </div>
              <div className="mt-3 divide-y divide-line2">
                {r.uses.length === 0 && (
                  <div className="py-3 text-sm text-mute italic">
                    {t('noConversionsYet')}
                  </div>
                )}
                {r.uses.map((u: any) => {
                  const stMap = STATUS_LABEL[u.status];
                  const stText = stMap ? t(stMap.key) : u.status;
                  const stCls = stMap ? stMap.cls : 'bg-bg2 text-mute';
                  return (
                    <div
                      key={u.id}
                      className="py-3 text-sm flex flex-wrap items-center gap-3"
                    >
                      <div className="font-medium min-w-[140px] flex-1">
                        {u.tenant?.brandName ?? '—'}
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${stCls}`}
                      >
                        {stText}
                      </span>
                      <div className="flex flex-wrap gap-1.5 flex-1">
                        {u.commissions.length === 0 && (
                          <span className="text-mute text-xs">
                            {t('noCommissions')}
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
                                {t('markPaidShort')}
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
                        + {t('commissionLower')}
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
            <h2 className="font-bold text-lg">{t('addCommission')}</h2>
            <p className="text-sm text-mute mt-1">
              {t('forSignupIn')}{' '}
              <b className="text-ink">{commissionFor.tenantBrand}</b>.
            </p>
            <div className="mt-4">
              <label className="label">{t('amountUsd')}</label>
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
                {t('commissionPendingHint')}
              </p>
            </div>
            <div className="mt-5 flex gap-2 justify-end">
              <button
                onClick={() => setCommissionFor(null)}
                disabled={saving}
                className="btn-ghost text-sm"
              >
                {t('btnCancel')}
              </button>
              <button
                onClick={submitCommission}
                disabled={saving || !amount}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {saving ? t('saving') : t('btnAdd')}
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
            <h2 className="font-bold text-lg">{t('captureLinkTitle')}</h2>
            <p className="text-sm text-mute mt-1.5 leading-relaxed">
              {t.rich('captureLinkDesc', {
                brandName: brand?.name ?? 'Clubify',
                b: (chunks) => <b className="text-ink">{chunks}</b>,
              })}
            </p>

            <div className="mt-4">
              <label className="label">{t('sourceLabelOptional')}</label>
              <input
                type="text"
                value={linkSource}
                onChange={(e) => setLinkSource(e.target.value)}
                className="input"
                placeholder={t('phSourceLabel')}
              />
              <p className="text-xs text-mute mt-1.5">
                {t('sourceLabelHint')}
              </p>
            </div>

            <div className="mt-4">
              <label className="label">{t('yourLink')}</label>
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
                  {t('btnCopy')}
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(
                    t('whatsappInviteMessage', {
                      link: captureLink,
                      brandName: brand?.name ?? 'Clubify',
                    }),
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs btn-ghost"
                >
                  💬 {t('shareViaWhatsApp')}
                </a>
                <a
                  href={captureLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs btn-ghost"
                >
                  ↗ {t('openPage')}
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
                {t('btnClose')}
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

const STATUS_PILL: Record<CampaignSummary['status'], { key: string; cls: string }> = {
  ACTIVE: { key: 'campaignStatusActive', cls: 'bg-ok-soft text-ok' },
  PAUSED: { key: 'campaignStatusPaused', cls: 'bg-amber-100 text-amber-800' },
  FINISHED: { key: 'campaignStatusFinished', cls: 'bg-bg2 text-mute' },
};

function CampaignsTab() {
  const t = useTranslations('admin_referrals');
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
      toast(e.message || t('errorLoadingCampaigns'), 'error');
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
      STATUS_PILL[c.status] ? t(STATUS_PILL[c.status].key) : '',
      c.createdAt ? fmtDate(c.createdAt) : '',
    ]
      .filter(Boolean)
      .join(' '),
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="text-sm text-mute">
          {t('campaignsIntro')}
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-sm">
          <Icon name="plus" /> {t('newCampaign')}
        </button>
      </div>

      {!loading && list.length > 0 && (
        <SectionSearchBar
          value={query}
          onChange={setQuery}
          placeholder={t('phSearchCampaign')}
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
          <div className="font-semibold">{t('emptyNoCampaigns')}</div>
          <div className="text-sm text-mute mt-1">
            {t('emptyNoCampaignsHint')}
          </div>
        </div>
      )}

      {!loading && list.length > 0 && filtered.length === 0 && (
        <div className="card card-pad text-center py-10">
          <div className="text-3xl mb-2">🔎</div>
          <div className="font-semibold">{t('noMatches')}</div>
          <div className="text-sm text-mute mt-1">
            {t('noCampaignMatches', { query })}
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
                {t(STATUS_PILL[c.status].key)}
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
                <div className="text-mute">{t('cardAmbassadors')}</div>
                <div className="font-bold text-base">{c.ambassadorsCount}</div>
              </div>
              <div className="bg-bg2/50 rounded p-2">
                <div className="text-mute">{t('cardActiveClients')}</div>
                <div className="font-bold text-base">{c.totalActiveClients}</div>
              </div>
              <div className="bg-bg2/50 rounded p-2 col-span-2">
                <div className="text-mute">{t('cardAmbassadorCommissions')}</div>
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
  const t = useTranslations('admin_referrals');
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
        toast(t('toastCampaignCreatedCreds'), 'success');
      } else {
        toast(t('toastCampaignCreated'), 'success');
        onCreated();
      }
    } catch (e: any) {
      setErr(e.message || t('errorCouldNotCreate'));
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
        whoLabel={t('whoLabelInfluencer', { name: form.influencerName })}
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
          <h2 className="text-lg font-semibold m-0">{t('newCampaign')}</h2>
          <button type="button" onClick={onClose} className="text-mute hover:text-ink text-xl leading-none">
            ×
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="label">{t('campaignName')}</label>
            <input
              className="input"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t('phCampaignName')}
            />
          </div>
          <div className="pt-2 border-t border-line text-xs uppercase tracking-wider text-mute font-semibold">
            {t('headInfluencerHolder')}
          </div>
          <div>
            <label className="label">{t('fieldName')}</label>
            <input
              className="input"
              required
              value={form.influencerName}
              onChange={(e) => setForm({ ...form, influencerName: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">{t('fieldEmail')}</label>
              <input
                className="input"
                type="email"
                required
                value={form.influencerEmail}
                onChange={(e) => setForm({ ...form, influencerEmail: e.target.value })}
              />
            </div>
            <div>
              <label className="label">{t('fieldWhatsapp')}</label>
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
              <label className="label">{t('fieldDirectPercent')}</label>
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
              <label className="label">{t('fieldCodeOptional')}</label>
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
            <label className="label">{t('fieldAccessPassword')}</label>
            <input
              className="input"
              type="text"
              required
              minLength={8}
              maxLength={64}
              placeholder={t('phMin8Chars')}
              value={form.influencerPassword}
              onChange={(e) =>
                setForm({ ...form, influencerPassword: e.target.value })
              }
            />
            <p className="text-xs text-mute mt-1">
              {t('influencerPasswordHint')}
            </p>
          </div>
        </div>
        {err && <div className="mt-3 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad-ink">{err}</div>}
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            {t('btnCancel')}
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? t('creating') : t('btnCreateCampaign')}
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
  const t = useTranslations('admin_referrals');
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
    toast(
      status === 'ACTIVE'
        ? t('toastCampaignActivated')
        : status === 'PAUSED'
          ? t('toastCampaignPaused')
          : t('toastCampaignFinished'),
      'success',
    );
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
        toast(t('toastAmbassadorAdded'), 'success');
      }
    } catch (e: any) {
      toast(e.message || t('errorGeneric'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeAmbassador(id: string) {
    if (!confirm(t('confirmDeactivateAmbassador'))) return;
    await api(`/campaigns/ambassadors/${id}`, { method: 'DELETE' });
    toast(t('toastAmbassadorDeactivated'), 'success');
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
          <h2 className="text-lg font-semibold m-0">{loading ? t('loading') : data?.name}</h2>
          <button onClick={onClose} className="text-mute hover:text-ink text-xl leading-none">
            ×
          </button>
        </div>

        {data && (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className={`text-xs uppercase font-bold px-2 py-0.5 rounded ${STATUS_PILL[data.status as keyof typeof STATUS_PILL].cls}`}>
                {t(STATUS_PILL[data.status as keyof typeof STATUS_PILL].key)}
              </span>
              <div className="ml-auto flex gap-1">
                {data.status !== 'ACTIVE' && (
                  <button onClick={() => setStatus('ACTIVE')} className="btn-ghost text-xs">
                    {t('btnActivate')}
                  </button>
                )}
                {data.status !== 'PAUSED' && (
                  <button onClick={() => setStatus('PAUSED')} className="btn-ghost text-xs">
                    {t('btnPause')}
                  </button>
                )}
                {data.status !== 'FINISHED' && (
                  <button onClick={() => setStatus('FINISHED')} className="btn-ghost text-xs">
                    {t('btnFinish')}
                  </button>
                )}
              </div>
            </div>

            <div className="card card-pad mb-4 bg-bg2/40">
              <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1">
                {t('headInfluencerHolder')}
              </div>
              <div className="font-semibold">{data.ownerCode.ownerName}</div>
              <div className="text-xs text-mute">{data.ownerCode.ownerEmail}</div>
              <div className="mt-2 font-mono font-bold text-lg bg-white px-3 py-2 rounded inline-block">
                {data.ownerCode.code}{' '}
                <span className="text-xs text-mute font-normal">
                  · {t('percentDirect', { percent: Number(data.ownerCode.commissionPercent) })}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold m-0">{t('ambassadorsCount', { count: data.codes.length })}</h3>
              <button onClick={() => setShowAdd(!showAdd)} className="btn-ghost text-xs">
                {showAdd ? t('btnCancel') : t('btnAddAmbassador')}
              </button>
            </div>

            {showAdd && (
              <form onSubmit={addAmbassador} className="border border-line rounded-lg p-3 mb-3 space-y-2 bg-bg2/30">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="input"
                    placeholder={t('phName')}
                    required
                    value={addForm.fullName}
                    onChange={(e) => setAddForm({ ...addForm, fullName: e.target.value })}
                  />
                  <input
                    className="input"
                    type="email"
                    placeholder={t('phEmail')}
                    required
                    value={addForm.email}
                    onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    className="input"
                    placeholder={t('phWhatsapp')}
                    required
                    value={addForm.whatsapp}
                    onChange={(e) => setAddForm({ ...addForm, whatsapp: e.target.value })}
                  />
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={100}
                    placeholder={t('phCommissionPercent')}
                    value={addForm.commissionPercent}
                    onChange={(e) => setAddForm({ ...addForm, commissionPercent: Number(e.target.value) })}
                  />
                  <input
                    className="input"
                    placeholder={t('phCodeOptional')}
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
                  placeholder={t('phAccessPasswordMin8')}
                  value={addForm.password}
                  onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
                />
                <button type="submit" className="btn-primary text-sm w-full" disabled={busy}>
                  {busy ? t('adding') : t('btnAddAmbassadorFull')}
                </button>
              </form>
            )}

            {data.codes.length === 0 ? (
              <div className="text-center py-8 text-mute text-sm">
                {t('noAmbassadorsYet')}
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
                      {t('percentClients', { percent: Number(amb.commissionPercent), clients: amb.uses?.length ?? 0 })}
                    </div>
                    {amb.isActive && (
                      <button
                        onClick={() => removeAmbassador(amb.id)}
                        className="text-mute hover:text-bad text-lg leading-none"
                        aria-label={t('deactivate')}
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
          whoLabel={t('whoLabelAmbassador', { name: ambassadorCredentials.fullName })}
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
  const t = useTranslations('admin_referrals');
  const [data, setData] = useState<SummaryResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<SummaryResp>('/referrals/summary')
      .then(setData)
      .catch((e) => toast(e.message || t('errorGeneric'), 'error'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <div className="card card-pad h-32 animate-shimmer" />;
  if (!data) return null;

  const k = data.kpis;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label={t('kpiInfluencers')} value={k.influencerCount.toString()} />
        <Kpi label={t('kpiAmbassadors')} value={k.ambassadorCount.toString()} />
        <Kpi label={t('kpiReferredClients')} value={k.totalReferredClients.toString()} />
        <Kpi label={t('kpiActiveClients')} value={k.activeClients.toString()} tone="ok" />
        <Kpi label={t('kpiInTrial')} value={k.trialClients.toString()} />
        <Kpi label={t('kpiChurned')} value={k.churnedClients.toString()} />
        <Kpi label={t('kpiMrr30d')} value={fmtUsd(k.mrrUsd)} tone="brand" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="card card-pad">
          <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1">
            {t('referralCommissions')}
          </div>
          <div className="space-y-1.5">
            <SumRow label={t('sumPaid')} value={fmtUsd(k.commPaidUsd)} tone="ok" />
            <SumRow label={t('sumPending')} value={fmtUsd(k.commPendingUsd)} tone="amber" />
            <SumRow label={t('sumRejected')} value={fmtUsd(k.commRejectedUsd)} tone="muted" />
          </div>
        </div>
        <div className="card card-pad">
          <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1">
            {t('partnerCommission10')}
          </div>
          <div className="space-y-1.5">
            <SumRow label={t('sumPaidSingular')} value={fmtUsd(k.socioPaidUsd)} tone="ok" />
            <SumRow label={t('sumPendingSingular')} value={fmtUsd(k.socioPendingUsd)} tone="amber" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TopList title={`🌟 ${t('topInfluencers')}`} rows={data.topInfluencers} />
        <TopList title={`👥 ${t('topAmbassadors')}`} rows={data.topAmbassadors} />
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
  const t = useTranslations('admin_referrals');
  return (
    <div className="card card-pad">
      <h3 className="font-semibold m-0 mb-3">{title}</h3>
      {rows.length === 0 ? (
        <div className="text-center text-mute py-6 text-sm">{t('noDataYet')}</div>
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
                  <span className="font-mono">{r.code}</span> · {t('activeOfTotalConv', { active: r.activeClients, total: r.totalClients, rate: r.conversionRate })}
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
  const t = useTranslations('admin_referrals');
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const [demoteTarget, setDemoteTarget] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [voidComm, setVoidComm] = useState(false);
  const [query, setQuery] = useState('');
  // #36 (2026-06-16): crear influencer directo desde la empresa.
  const [showCreate, setShowCreate] = useState(false);

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
      r.isActive === false ? t('searchInactive') : t('searchActive'),
    ]
      .filter(Boolean)
      .join(' '),
  );

  if (loading) return <div className="card card-pad h-32 animate-shimmer" />;

  return (
    <div>
      <div className="flex justify-end gap-2 mb-3">
        {/* #35: link de autoregistro de influencer (la persona crea su cuenta). */}
        <SelfRegisterLinkButton role="influencer" label={`🔗 ${t('linkRegisterInfluencer')}`} />
        <button onClick={() => setShowCreate(true)} className="btn-primary text-sm">
          + {t('btnCreateInfluencer')}
        </button>
      </div>
      {showCreate && (
        <CreateInfluencerModal
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
          placeholder={t('phSearchInfluencer')}
          resultCount={filtered.length}
          totalCount={rows.length}
        />
      )}
      <div className="card overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[940px]">
          <thead className="bg-bg2">
            <tr>
              {[t('colInfluencer'), t('colCode'), '%', t('colCampaign'), t('colAmbassadors'), t('colClients'), t('colPaid'), t('colPending'), ''].map(
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
                  {t('emptyNoInfluencers')}
                </td>
              </tr>
            )}
            {rows.length > 0 && filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-10 text-mute">
                  <div className="text-2xl mb-1">🔎</div>
                  {t('noInfluencerMatches', { query })}
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
                      title={t('demoteInfluencerTooltip')}
                    >
                      ↓ {t('btnDemote')}
                    </button>
                    {/* Si el backend marcó un impersonateBlock, entrar al panel
                        respondería 400: deshabilitamos y el tooltip dice qué
                        hacer. Si el campo no viene (backend viejo) el botón
                        queda habilitado y nada cambia. */}
                    <button
                      disabled={enteringId === r.id || !!r.impersonateBlock}
                      onClick={async () => {
                        setEnteringId(r.id);
                        await enterAffiliatePanel(r.id, r.ownerName, router, t);
                        setEnteringId(null);
                      }}
                      className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-violet-100 text-violet-700 hover:bg-violet-200 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                      title={panelTooltip(
                        r.impersonateBlock,
                        'enterPanelInfluencerTooltip',
                        t,
                      )}
                    >
                      {enteringId === r.id ? t('entering') : `→ ${t('btnPanel')}`}
                    </button>
                    <AffiliateLinkButton
                      codeId={r.id}
                      ownerName={r.ownerName}
                      slug={r.slug ?? null}
                      code={r.code}
                      onSaved={reload}
                    />
                    <AffiliatePasswordButton codeId={r.id} ownerName={r.ownerName} />
                    <button
                      onClick={() => setDeleteTarget(r)}
                      className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-red-100 text-red-700 hover:bg-red-200 whitespace-nowrap"
                      title={t('deleteInfluencerTooltip')}
                    >
                      🗑 {t('btnDelete')}
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
          title={t('deleteInfluencerTitle', { name: deleteTarget.ownerName })}
          description={
            <>
              {t.rich('deleteInfluencerDesc', {
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
              <label className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={voidComm}
                  onChange={(e) => setVoidComm(e.target.checked)}
                />
                <span>
                  {t.rich('voidCommissionsAndDelete', {
                    strong: (chunks) => <strong>{chunks}</strong>,
                  })}
                </span>
              </label>
            </>
          }
          confirmLabel={voidComm ? t('btnVoidAndDelete') : t('btnDelete')}
          onConfirm={async () => {
            try {
              const res = await api<any>(
                `/referrals/codes/${deleteTarget.id}${voidComm ? '?voidCommissions=true' : ''}`,
                { method: 'DELETE' },
              );
              toast(
                res?.voided != null
                  ? t('toastInfluencerDeletedVoided', { name: deleteTarget.ownerName, voided: res.voided, preserved: res.preservedPaid ? t('preservedPaidExtra', { count: res.preservedPaid }) : '' })
                  : res?.mode === 'hard'
                    ? t('toastInfluencerDeleted', { name: deleteTarget.ownerName })
                    : t('toastInfluencerDeactivated', { name: deleteTarget.ownerName }),
                'success',
              );
              setDeleteTarget(null);
              setVoidComm(false);
              reload();
            } catch (e: any) {
              toast(e.message || t('errorCouldNotDelete'), 'error');
            }
          }}
          onClose={() => {
            setDeleteTarget(null);
            setVoidComm(false);
          }}
        />
      )}
      {demoteTarget && (
        <InfluencerPickerModal
          title={t('demoteTitle', { name: demoteTarget.ownerName })}
          description={
            <>
              {t.rich('demoteDesc', {
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
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
                t('toastNowAmbassadorUnder', { name: demoteTarget.ownerName, parent: newParent.ownerName }),
                'success',
              );
              setDemoteTarget(null);
              reload();
            } catch (e: any) {
              toast(e.message || t('errorGeneric'), 'error');
            }
          }}
        />
      )}
      </div>
    </div>
  );
}

function AmbassadorsTab() {
  const t = useTranslations('admin_referrals');
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const [reassignTarget, setReassignTarget] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [voidComm, setVoidComm] = useState(false);
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
      r.isCompanyDirect ? t('searchCompanyDirect') : '',
      r.isActive === false ? t('searchInactive') : t('searchActive'),
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
          <div className="font-semibold">{t('ambassadorsCount', { count: rows.length })}</div>
          <div className="text-xs text-mute leading-relaxed mt-1">
            {t.rich('ambassadorsBreakdown', {
              companyDirect: companyDirect.length,
              linked: linked.length,
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </div>
        </div>
        {/* #35 (2026-06-16): se reemplazó "+ Embajador Directo Empresa" por
            el link de autoregistro — la persona crea su cuenta sola. */}
        <SelfRegisterLinkButton role="ambassador" label={`🔗 ${t('linkRegisterAmbassador')}`} />
      </div>

      {rows.length > 0 && (
        <SectionSearchBar
          value={query}
          onChange={setQuery}
          placeholder={t('phSearchAmbassador')}
          resultCount={filtered.length}
          totalCount={rows.length}
        />
      )}

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1040px]">
            <thead className="bg-bg2">
              <tr>
                {[t('colAmbassador'), t('colCode'), '%', t('colReportsTo'), t('colCampaign'), t('colActive'), t('colTotal'), t('colVendors'), t('colPaid'), t('colPending'), ''].map(
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
                    {t('emptyNoAmbassadors')}
                  </td>
                </tr>
              )}
              {rows.length > 0 && filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="text-center py-10 text-mute">
                    <div className="text-2xl mb-1">🔎</div>
                    {t('noAmbassadorMatches', { query })}
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
                          🏢 {t('badgeCompanyDirect')}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-mute">{r.ownerEmail}</div>
                  </td>
                  <td className="px-4 py-3 font-mono font-bold">{r.code}</td>
                  <td className="px-4 py-3">{r.commissionPercent}%</td>
                  <td className="px-4 py-3 text-xs">
                    {r.isCompanyDirect ? (
                      <span className="text-violet-700 font-medium">{t('company')}</span>
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
                          if (!confirm(t('confirmPromoteAmbassador', { name: r.ownerName })))
                            return;
                          try {
                            await api(
                              `/referrals/ambassadors/${r.id}/promote-to-influencer`,
                              { method: 'POST' },
                            );
                            toast(t('toastNowInfluencer', { name: r.ownerName }), 'success');
                            reload();
                          } catch (e: any) {
                            toast(e.message || t('errorGeneric'), 'error');
                          }
                        }}
                        className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-amber-100 text-amber-800 hover:bg-amber-200 whitespace-nowrap"
                        title={t('promoteAmbassadorTooltip')}
                      >
                        ↑ {t('btnPromote')}
                      </button>
                      <button
                        onClick={() => setReassignTarget(r)}
                        className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-sky-100 text-sky-800 hover:bg-sky-200 whitespace-nowrap"
                        title={t('changeInfluencerTooltip')}
                      >
                        ↻ {t('btnChangeInfluencer')}
                      </button>
                      <button
                        onClick={() => setVendorConfigTarget(r)}
                        className={`text-xs font-semibold px-2.5 py-1.5 rounded-md whitespace-nowrap ${
                          r.allowVendors
                            ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                            : 'bg-bg2 text-mute hover:bg-line2'
                        }`}
                        title={t('vendorsConfigTooltip')}
                      >
                        👥 {t('btnVendors')}
                      </button>
                      {/* Ver nota en InfluencersTab: si hay impersonateBlock el
                          botón queda inerte y el tooltip explica por qué. */}
                      <button
                        disabled={enteringId === r.id || !!r.impersonateBlock}
                        onClick={async () => {
                          setEnteringId(r.id);
                          await enterAffiliatePanel(r.id, r.ownerName, router, t);
                          setEnteringId(null);
                        }}
                        className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-violet-100 text-violet-700 hover:bg-violet-200 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                        title={panelTooltip(
                          r.impersonateBlock,
                          'enterPanelAmbassadorTooltip',
                          t,
                        )}
                      >
                        {enteringId === r.id ? t('entering') : `→ ${t('btnPanel')}`}
                      </button>
                      <AffiliateLinkButton
                        codeId={r.id}
                        ownerName={r.ownerName}
                        slug={r.slug ?? null}
                        code={r.code}
                        onSaved={reload}
                      />
                      <AffiliatePasswordButton codeId={r.id} ownerName={r.ownerName} />
                      <button
                        onClick={() => setDeleteTarget(r)}
                        className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-red-100 text-red-700 hover:bg-red-200 whitespace-nowrap"
                        title={t('deleteAmbassadorTooltip')}
                      >
                        🗑 {t('btnDelete')}
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
          title={t('deleteAmbassadorTitle', { name: deleteTarget.ownerName })}
          description={
            <>
              {t.rich('deleteAmbassadorDesc', {
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
              <label className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={voidComm}
                  onChange={(e) => setVoidComm(e.target.checked)}
                />
                <span>
                  {t.rich('voidCommissionsAndDelete', {
                    strong: (chunks) => <strong>{chunks}</strong>,
                  })}
                </span>
              </label>
            </>
          }
          confirmLabel={voidComm ? t('btnVoidAndDelete') : t('btnDelete')}
          onConfirm={async () => {
            try {
              const res = await api<any>(
                `/referrals/codes/${deleteTarget.id}${voidComm ? '?voidCommissions=true' : ''}`,
                { method: 'DELETE' },
              );
              toast(
                res?.voided != null
                  ? t('toastAmbassadorDeletedVoided', { name: deleteTarget.ownerName, voided: res.voided, preserved: res.preservedPaid ? t('preservedPaidExtra', { count: res.preservedPaid }) : '' })
                  : res?.mode === 'hard'
                    ? t('toastAmbassadorDeleted', { name: deleteTarget.ownerName })
                    : t('toastAmbassadorDeactivated2', { name: deleteTarget.ownerName }),
                'success',
              );
              setDeleteTarget(null);
              setVoidComm(false);
              reload();
            } catch (e: any) {
              toast(e.message || t('errorCouldNotDelete'), 'error');
            }
          }}
          onClose={() => {
            setDeleteTarget(null);
            setVoidComm(false);
          }}
        />
      )}
      {reassignTarget && (
        <InfluencerPickerModal
          title={t('reassignTitle', { name: reassignTarget.ownerName })}
          description={
            <>
              {t.rich('reassignDesc', {
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
              {reassignTarget.parentName && (
                <>
                  <br />
                  <span className="text-mute">
                    {t.rich('currentlyUnder', {
                      name: reassignTarget.parentName,
                      strong: (chunks) => <strong>{chunks}</strong>,
                    })}
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
                t('toastNowReportsTo', { name: reassignTarget.ownerName, parent: newParent.ownerName }),
                'success',
              );
              setReassignTarget(null);
              reload();
            } catch (e: any) {
              toast(e.message || t('errorGeneric'), 'error');
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
  const t = useTranslations('admin_referrals');
  const [allowVendors, setAllowVendors] = useState<boolean>(
    !!embajador.allowVendors,
  );
  const [maxPct, setMaxPct] = useState<number>(
    Number(embajador.maxCommissionPercent ?? 25),
  );
  const [busy, setBusy] = useState(false);

  // Lista de vendedores del embajador — para poder promover uno a influencer
  // de la empresa (2026-06-15). Reusa el endpoint by-embajador.
  const [vendors, setVendors] = useState<any[]>([]);
  const [promoting, setPromoting] = useState<string | null>(null);

  async function loadVendors() {
    try {
      const r = await api<{ vendors: any[] }>(
        `/referrals/vendors/by-embajador/${embajador.id}`,
      );
      setVendors(r.vendors ?? []);
    } catch {
      setVendors([]);
    }
  }
  useEffect(() => {
    loadVendors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embajador.id]);

  async function promoteVendor(v: any) {
    if (!confirm(t('confirmPromoteVendor', { name: v.ownerName })))
      return;
    setPromoting(v.id);
    try {
      await api(`/referrals/ambassadors/${v.id}/promote-to-influencer`, {
        method: 'POST',
      });
      toast(t('toastNowCompanyInfluencer', { name: v.ownerName }), 'success');
      await loadVendors();
      onSaved();
    } catch (e: any) {
      toast(e.message || t('errorCouldNotPromote'), 'error');
    } finally {
      setPromoting(null);
    }
  }

  const activeCount = Number(embajador.activeVendorsCount ?? 0);
  // CORRECCIÓN LÓGICA 2026-06-16: el tope no puede superar la propia
  // comisión del embajador/influencer — el vendedor cobra de su tajada.
  const ownPct = Number(embajador.commissionPercent ?? 0);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (maxPct <= 0 || maxPct > 100) {
      toast(t('maxCommissionRange'), 'error');
      return;
    }
    if (ownPct > 0 && maxPct > ownPct) {
      toast(t('maxCommissionExceedsOwn', { percent: ownPct }), 'error');
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
      toast(t('toastConfigUpdatedFor', { name: embajador.ownerName }), 'success');
      onSaved();
    } catch (e: any) {
      toast(e.message || t('errorSaving'), 'error');
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
              {t('vendorModuleTitle', { name: embajador.ownerName })}
            </div>
            <div className="text-[11px] text-mute mt-0.5">
              {t('vendorModuleSubtitle')}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-mute hover:text-ink text-xl leading-none"
            aria-label={t('btnClose')}
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
                {t('allowVendors')}
              </div>
              <div className="text-[11px] text-mute leading-snug mt-0.5">
                {t('allowVendorsHint')}
              </div>
            </div>
          </label>

          <div>
            <label className="label">{t('maxCommissionPercent')}</label>
            <input
              className="input"
              type="number"
              min={0.5}
              max={ownPct > 0 ? ownPct : 100}
              step={0.5}
              required
              value={maxPct}
              onChange={(e) => setMaxPct(Number(e.target.value) || 0)}
            />
            <div className="text-[11px] text-mute mt-1 leading-snug">
              {t('maxCommissionHint')}
              {ownPct > 0 && (
                <>
                  {' '}
                  {t.rich('maxCommissionCannotExceed', {
                    percent: ownPct,
                    strong: (chunks) => <strong>{chunks}</strong>,
                  })}
                </>
              )}
            </div>
          </div>

          {activeCount > 0 && !allowVendors && (
            <div className="text-[11px] rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 leading-snug">
              ⚠ {t.rich('activeVendorsWarning', {
                count: activeCount,
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </div>
          )}

          {vendors.length > 0 && (
            <div className="border-t border-line2 pt-3">
              <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
                {t('vendorsPromoteHeader')}
              </div>
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {vendors.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-line px-2.5 py-1.5"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {v.ownerName}{' '}
                        <span className="text-[11px] text-mute">
                          ({t('percentSales', { percent: v.commissionPercent, sales: v.salesCount })})
                        </span>
                      </div>
                      <div className="text-[10px] text-mute font-mono">
                        {v.code}
                        {!v.isActive && ` · ${t('inactiveLower')}`}
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5">
                      <AffiliatePasswordButton codeId={v.id} ownerName={v.ownerName} />
                      <button
                        type="button"
                        onClick={() => promoteVendor(v)}
                        disabled={promoting === v.id}
                        className="text-[11px] px-2.5 py-1 rounded-md bg-amber-100 text-amber-800 font-semibold hover:bg-amber-200 transition disabled:opacity-50"
                        title={t('promoteVendorTooltip')}
                      >
                        {promoting === v.id ? '…' : `↑ ${t('influencer')}`}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost text-sm"
              disabled={busy}
            >
              {t('btnCancel')}
            </button>
            <button
              type="submit"
              className="btn-primary text-sm"
              disabled={busy}
            >
              {busy ? t('saving') : t('save')}
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
  const t = useTranslations('admin_referrals');
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
            placeholder={t('phSearchInfluencerPicker')}
            className="w-full px-3 py-2 text-sm rounded-md border border-line2 focus:outline-none focus:ring-2 focus:ring-violet-400"
            autoFocus
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-center text-mute text-sm">{t('loading')}</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-mute text-sm">
              {q ? t('noResults') : t('noOtherInfluencers')}
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
                            <> · {t('campaignLabel')}: <strong>{r.campaignName}</strong></>
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
            {t('btnCancel')}
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
            {busy ? t('applying') : picked ? t('assignTo', { name: picked.ownerName }) : t('chooseInfluencer')}
          </button>
        </div>
      </div>
    </div>
  );
}

// #35 (2026-06-16): botón que copia el link público de autoregistro de
// afiliado para el rol dado. La persona abre el link, elige usuario/
// contraseña y crea su perfil sola (página /registro-afiliado?role=).
// Requiere que el autoregistro esté habilitado en /admin/affiliate-registration.
function SelfRegisterLinkButton({
  role,
  label,
}: {
  role: 'influencer' | 'ambassador';
  label: string;
}) {
  const t = useTranslations('admin_referrals');
  async function copy() {
    const origin =
      typeof window !== 'undefined' ? window.location.origin : '';
    const link = `${origin}/registro-afiliado?role=${role}`;
    try {
      await navigator.clipboard.writeText(link);
      toast(t('toastRegisterLinkCopied'), 'success');
    } catch {
      toast(link, 'info');
    }
  }
  return (
    <button onClick={copy} className="btn-primary text-sm whitespace-nowrap" title={t('copySelfRegisterTooltip')}>
      {label}
    </button>
  );
}

// #37 (2026-06-16): genera una contraseña segura (12 chars, letras+números+
// símbolos) para que el admin la fije al crear el afiliado.
function genAffiliatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const symbols = '!@#$%&*?';
  const arr = new Uint32Array(11);
  crypto.getRandomValues(arr);
  let out = '';
  for (let i = 0; i < 11; i++) out += chars[arr[i] % chars.length];
  const symArr = new Uint32Array(1);
  crypto.getRandomValues(symArr);
  // intercalar un símbolo en el medio para cumplir variedad
  const pos = 5;
  return out.slice(0, pos) + symbols[symArr[0] % symbols.length] + out.slice(pos);
}

// #37 (2026-06-16): bloque reutilizable de contraseña para los modales de
// creación de afiliado. Si se deja vacío, el backend manda email de invite;
// si se llena, el afiliado entra de inmediato y se muestran las credenciales.
function AffiliatePasswordFields({
  password,
  confirmPassword,
  onPasswordChange,
  onConfirmChange,
}: {
  password: string;
  confirmPassword: string;
  onPasswordChange: (v: string) => void;
  onConfirmChange: (v: string) => void;
}) {
  const t = useTranslations('admin_referrals');
  const mismatch = confirmPassword.length > 0 && confirmPassword !== password;
  return (
    <div className="mt-3 rounded-lg border border-line p-3 bg-bg2/40">
      <div className="flex items-center justify-between">
        <label className="label mb-0">{t('fieldAccessPassword')}</label>
        <button
          type="button"
          className="text-xs font-semibold text-brand hover:underline"
          onClick={() => {
            const p = genAffiliatePassword();
            onPasswordChange(p);
            onConfirmChange(p);
          }}
        >
          {t('generateAuto')}
        </button>
      </div>
      <p className="text-[11px] text-mute leading-relaxed mt-0.5 mb-2">
        {t('passwordFieldHint')}
      </p>
      <input
        className="input font-mono"
        type="text"
        value={password}
        onChange={(e) => onPasswordChange(e.target.value)}
        minLength={8}
        maxLength={64}
        placeholder={t('phEmptyInvite')}
        autoComplete="new-password"
      />
      {password.length > 0 && (
        <>
          <input
            className="input font-mono mt-2"
            type="text"
            value={confirmPassword}
            onChange={(e) => onConfirmChange(e.target.value)}
            minLength={8}
            maxLength={64}
            placeholder={t('phConfirmPassword')}
            autoComplete="new-password"
          />
          {mismatch && (
            <p className="text-[11px] text-bad-ink mt-1">{t('passwordsDoNotMatch')}</p>
          )}
        </>
      )}
    </div>
  );
}

// #12 (2026-06-16): botón reutilizable para CREAR/CAMBIAR la contraseña de un
// afiliado existente (influencer / embajador / vendedor). Modal autocontenido;
// se puede colocar en cualquier fila pasando codeId + ownerName.
/**
 * Editor del enlace corto de un afiliado: `/ref/<ruta>`.
 *
 * El slug se genera del nombre completo, y sale larguísimo:
 * `/ref/briggit-stefany-labrador`. Esto deja ponerle la ruta que el admin
 * quiera — `/ref/stefany` — apuntando a la MISMA página de referencia, con el
 * mismo código y la misma atribución. No es un redirector aparte: es la ruta
 * real del afiliado, así que no hay salto ni enlace intermedio que se pierda.
 *
 * El backend (`PATCH /referrals/codes/:id/slug`) normaliza y valida unicidad;
 * acá replicamos la normalización solo para la vista previa, nunca como
 * validación única.
 */
function AffiliateLinkButton({
  codeId,
  ownerName,
  slug,
  code,
  onSaved,
}: {
  codeId: string;
  ownerName: string;
  slug: string | null;
  code: string;
  onSaved: () => void;
}) {
  const t = useTranslations('admin_referrals');
  const [open, setOpen] = useState(false);
  const [valor, setValor] = useState('');
  const [busy, setBusy] = useState(false);

  // Misma normalización que `slugify` del backend: minúsculas, sin tildes,
  // separadores a guión. Solo para la vista previa — quien decide es el server.
  const limpio = valor
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  const actual = slug || code.toLowerCase();
  const base =
    typeof window !== 'undefined' ? window.location.origin : '';
  const previo = `${base}/ref/${limpio || actual}`;
  const cambia = limpio !== '' && limpio !== actual;

  async function guardar() {
    if (!cambia) return;
    setBusy(true);
    try {
      await api(`/referrals/codes/${codeId}/slug`, {
        method: 'PATCH',
        body: JSON.stringify({ slug: limpio }),
      });
      toast(t('linkSaved', { slug: limpio }), 'success');
      setOpen(false);
      onSaved();
    } catch (e: unknown) {
      toast((e as Error)?.message || t('linkError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(`${base}/ref/${actual}`);
      toast(t('linkCopied'), 'success');
    } catch {
      toast(t('linkCopyFailed'), 'error');
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setValor('');
          setOpen(true);
        }}
        className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-teal-100 text-teal-700 hover:bg-teal-200 whitespace-nowrap"
        title={t('linkButtonTooltip')}
      >
        🔗 {t('btnLink')}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-xl w-full max-w-md p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-1">
              {t('linkOf', { name: ownerName })}
            </h3>
            <p className="text-xs text-mute mb-4">{t('linkHelp')}</p>

            <div className="rounded-lg bg-bg2 border border-line p-3 mb-4">
              <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1">
                {t('linkCurrent')}
              </div>
              <div className="flex items-center gap-2">
                <code className="text-xs break-all flex-1">
                  {base}/ref/{actual}
                </code>
                <button
                  type="button"
                  onClick={copiar}
                  className="text-xs font-semibold px-2 py-1 rounded bg-white border border-line hover:bg-bg2 whitespace-nowrap"
                >
                  {t('linkCopy')}
                </button>
              </div>
            </div>

            <label className="text-xs font-semibold text-mute block mb-1">
              {t('linkNew')}
            </label>
            <div className="flex items-stretch rounded-lg border border-line overflow-hidden">
              <span className="px-2.5 flex items-center bg-bg2 text-xs text-mute whitespace-nowrap">
                /ref/
              </span>
              <input
                autoFocus
                className="flex-1 px-2.5 py-2 text-sm outline-none"
                placeholder={actual}
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && cambia && !busy) void guardar();
                }}
              />
            </div>
            {cambia && (
              <>
                <p className="text-[11px] text-mute mt-2 break-all">
                  {t('linkPreview')} <b>{previo}</b>
                </p>
                {/* El slug es la ruta real, no un alias: al cambiarla, la
                    anterior deja de resolver. Si el afiliado ya la compartió,
                    hay que avisarle. */}
                <p className="text-[11px] text-amber-700 mt-1.5 leading-snug">
                  ⚠️ {t('linkWarnOld', { old: `${base}/ref/${actual}` })}
                </p>
              </>
            )}

            <div className="mt-5 flex gap-2 justify-end">
              <button
                type="button"
                className="btn-ghost text-sm"
                onClick={() => setOpen(false)}
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                disabled={!cambia || busy}
                onClick={guardar}
                className="btn text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? t('saving') : t('linkSave')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function AffiliatePasswordButton({
  codeId,
  ownerName,
}: {
  codeId: string;
  ownerName: string;
}) {
  const t = useTranslations('admin_referrals');
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{
    email: string;
    password: string;
    loginUrl: string;
  } | null>(null);

  function reset() {
    setPassword('');
    setConfirm('');
    setDone(null);
    setBusy(false);
  }

  async function submit() {
    const pwd = password.trim();
    if (pwd.length < 8) {
      toast(t('passwordMin8'), 'error');
      return;
    }
    if (pwd !== confirm.trim()) {
      toast(t('passwordsDoNotMatch'), 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await api<{
        email: string;
        password: string;
        loginUrl: string;
      }>(`/referrals/affiliates/${codeId}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ password: pwd }),
      });
      setDone(res ?? { email: '', password: pwd, loginUrl: '' });
      toast(t('toastPasswordUpdated'), 'success');
    } catch (e: unknown) {
      toast((e as Error)?.message || t('errorChangingPassword'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-sky-100 text-sky-700 hover:bg-sky-200 whitespace-nowrap"
        title={t('passwordButtonTooltip')}
      >
        🔑 {t('btnPassword')}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-xl w-full max-w-md p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-1">{t('passwordOf', { name: ownerName })}</h3>
            {done ? (
              <div className="mt-3 space-y-2 text-sm">
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
                  <div>✅ {t('passwordUpdatedShareCreds')}</div>
                  <div className="mt-2 font-mono text-xs break-all space-y-0.5">
                    <div>📧 {done.email}</div>
                    <div>🔑 {done.password}</div>
                    <div>🔗 {done.loginUrl}</div>
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    className="btn-primary text-sm"
                    onClick={() => setOpen(false)}
                  >
                    {t('btnDone')}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-xs text-mute">
                  {t('passwordModalHint')}
                </p>
                <AffiliatePasswordFields
                  password={password}
                  confirmPassword={confirm}
                  onPasswordChange={setPassword}
                  onConfirmChange={setConfirm}
                />
                <div className="flex justify-end gap-2 pt-3">
                  <button
                    type="button"
                    className="btn-ghost text-sm"
                    disabled={busy}
                    onClick={() => setOpen(false)}
                  >
                    {t('btnCancel')}
                  </button>
                  <button
                    type="button"
                    className="btn-primary text-sm"
                    disabled={busy || password.trim().length < 8}
                    onClick={submit}
                  >
                    {busy ? t('saving') : t('btnSavePassword')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// #36 (2026-06-16): crear influencer directo desde la empresa.
function CreateInfluencerModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useTranslations('admin_referrals');
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    whatsapp: '',
    commissionPercent: 30,
    customCode: '',
    password: '',
    confirmPassword: '',
  });
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState<{
    email: string;
    password: string;
    loginUrl: string;
  } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const pwd = form.password.trim();
    if (pwd) {
      if (pwd.length < 8) {
        toast(t('passwordMin8'), 'error');
        return;
      }
      if (pwd !== form.confirmPassword.trim()) {
        toast(t('passwordsDoNotMatch'), 'error');
        return;
      }
    }
    setBusy(true);
    try {
      const payload: any = {
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        whatsapp: form.whatsapp.trim(),
        commissionPercent: Number(form.commissionPercent),
      };
      if (form.customCode.trim()) payload.customCode = form.customCode.trim().toUpperCase();
      if (pwd) payload.password = pwd;
      const res = await api<any>('/referrals/influencers', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (res?.credentials) {
        // No cerramos: mostramos las credenciales una sola vez.
        setCredentials(res.credentials);
        toast(t('toastInfluencerCreatedCreds'), 'success');
      } else {
        toast(t('toastInfluencerCreatedInvite'), 'success');
        onCreated();
      }
    } catch (e: any) {
      toast(e.message || t('errorCouldNotCreate'), 'error');
      setBusy(false);
    }
  }

  if (credentials) {
    return (
      <AffiliateCredentialsModal
        credentials={credentials}
        whoLabel={t('whoLabelInfluencer', { name: form.fullName.trim() })}
        whatsapp={form.whatsapp.trim()}
        onClose={() => {
          setCredentials(null);
          onCreated();
        }}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-lg font-bold">🌟 {t('btnCreateInfluencer')}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-mute hover:text-ink text-xl leading-none"
          >
            ×
          </button>
        </div>
        <p className="text-xs text-mute leading-relaxed mb-4">
          {t.rich('createInfluencerDesc', {
            code: (chunks) => <code>{chunks}</code>,
          })}
        </p>

        <label className="label">{t('fieldFullName')}</label>
        <input
          className="input"
          value={form.fullName}
          onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          required
          minLength={2}
        />

        <label className="label mt-3">{t('fieldEmail')}</label>
        <input
          className="input"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
        />

        <label className="label mt-3">{t('fieldWhatsappCountry')}</label>
        <input
          className="input"
          value={form.whatsapp}
          onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
          placeholder="+57 300 000 0000"
          required
        />

        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <label className="label">{t('fieldCommissionPercent')}</label>
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
            <label className="label">{t('fieldCustomCodeOptional')}</label>
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

        <AffiliatePasswordFields
          password={form.password}
          confirmPassword={form.confirmPassword}
          onPasswordChange={(v) => setForm({ ...form, password: v })}
          onConfirmChange={(v) => setForm({ ...form, confirmPassword: v })}
        />

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost text-sm"
            disabled={busy}
          >
            {t('btnCancel')}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {busy ? t('creating') : form.password.trim() ? t('btnCreateInfluencerSubmit') : t('btnCreateAndInvite')}
          </button>
        </div>
      </form>
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
  const t = useTranslations('admin_referrals');
  // Nombre de la marca (Sellea) para la descripción que decía "Clubify".
  const { brand } = useAuthBrand();
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    whatsapp: '',
    commissionPercent: 25,
    customCode: '',
    password: '',
    confirmPassword: '',
  });
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState<{
    email: string;
    password: string;
    loginUrl: string;
  } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const pwd = form.password.trim();
    if (pwd) {
      if (pwd.length < 8) {
        toast(t('passwordMin8'), 'error');
        return;
      }
      if (pwd !== form.confirmPassword.trim()) {
        toast(t('passwordsDoNotMatch'), 'error');
        return;
      }
    }
    setBusy(true);
    try {
      const payload: any = {
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        whatsapp: form.whatsapp.trim(),
        commissionPercent: Number(form.commissionPercent),
      };
      if (form.customCode.trim()) payload.customCode = form.customCode.trim().toUpperCase();
      if (pwd) payload.password = pwd;
      const res = await api<any>('/referrals/ambassadors/company-direct', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (res?.credentials) {
        setCredentials(res.credentials);
        toast(t('toastAmbassadorCreatedCreds'), 'success');
      } else {
        toast(t('toastCompanyDirectCreatedInvite'), 'success');
        onCreated();
      }
    } catch (e: any) {
      toast(e.message || t('errorCouldNotCreate'), 'error');
      setBusy(false);
    }
  }

  if (credentials) {
    return (
      <AffiliateCredentialsModal
        credentials={credentials}
        whoLabel={t('whoLabelAmbassador', { name: form.fullName.trim() })}
        whatsapp={form.whatsapp.trim()}
        onClose={() => {
          setCredentials(null);
          onCreated();
        }}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-lg font-bold">🏢 {t('companyDirectAmbassadorTitle')}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-mute hover:text-ink text-xl leading-none"
          >
            ×
          </button>
        </div>
        <p className="text-xs text-mute leading-relaxed mb-4">
          {t.rich('companyDirectAmbassadorDesc', {
            brandName: brand?.name ?? 'Clubify',
            code: (chunks) => <code>{chunks}</code>,
          })}
        </p>

        <label className="label">{t('fieldFullName')}</label>
        <input
          className="input"
          value={form.fullName}
          onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          required
          minLength={2}
        />

        <label className="label mt-3">{t('fieldEmail')}</label>
        <input
          className="input"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
        />

        <label className="label mt-3">{t('fieldWhatsappCountry')}</label>
        <input
          className="input"
          value={form.whatsapp}
          onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
          placeholder="+57 300 000 0000"
          required
        />

        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <label className="label">{t('fieldCommissionPercent')}</label>
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
            <label className="label">{t('fieldCustomCodeOptional')}</label>
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

        <AffiliatePasswordFields
          password={form.password}
          confirmPassword={form.confirmPassword}
          onPasswordChange={(v) => setForm({ ...form, password: v })}
          onConfirmChange={(v) => setForm({ ...form, confirmPassword: v })}
        />

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost text-sm"
            disabled={busy}
          >
            {t('btnCancel')}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {busy ? t('creating') : form.password.trim() ? t('btnCreateAmbassador') : t('btnCreateAndInvite')}
          </button>
        </div>
      </form>
    </div>
  );
}

const CLIENT_STATUS: Record<string, { key: string; cls: string }> = {
  SIGNED_UP: { key: 'clientStatusSignedUp', cls: 'bg-bg2 text-mute' },
  ACTIVE: { key: 'clientStatusActive', cls: 'bg-ok-soft text-ok' },
  PAYING: { key: 'clientStatusPaying', cls: 'bg-ok-soft text-ok' },
  CHURNED: { key: 'clientStatusChurned', cls: 'bg-red-100 text-red-800' },
};

function ClientsTab() {
  const t = useTranslations('admin_referrals');
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
      CLIENT_STATUS[r.status] ? t(CLIENT_STATUS[r.status].key) : '',
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
          placeholder={t('phSearchBusiness')}
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
              {f === 'all' ? t('filterClientAll') : f === 'active' ? t('filterClientActive') : f === 'trial' ? t('filterClientTrial') : t('filterClientChurned')}{' '}
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
                {[t('colBusiness'), t('colPlan'), t('colAttribution'), t('colType'), t('colStatus'), t('colSignedUp'), t('colCommissions')].map(
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
                    {t('emptyNoBusinessesFilter')}
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
                      {/* FIX 2026-06-16 (review): attribution puede ser null
                          (cliente cuyo afiliado se anuló/eliminó) → crasheaba
                          toda la tab. Guardas con ?. */}
                      <div className="font-medium">{r.attribution?.ownerName ?? '—'}</div>
                      <div className="text-mute font-mono">{r.attribution?.code ?? ''}</div>
                      {r.attribution?.parentCode && (
                        <div className="text-mute text-[10px] mt-0.5">
                          {t('viaName', { name: r.attribution.parentName })}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="px-1.5 py-0.5 rounded bg-bg2 text-[10px] uppercase font-bold">
                        {r.attribution?.role ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${s.cls}`}>
                        {t(s.key)}
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
  const t = useTranslations('admin_referrals');
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
      PAYOUT_STATUS[c.status] ? t(PAYOUT_STATUS[c.status].key) : '',
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
        <Kpi label={t('kpiAvailable')} value={fmtUsd(data.totals.availableUsd)} tone="ok" />
        <Kpi label={t('kpiOnHold')} value={fmtUsd(data.totals.pendingUsd)} />
        <Kpi label={t('kpiPaid')} value={fmtUsd(data.totals.paidUsd)} tone="brand" />
        <Kpi label={t('kpiTotalRecords')} value={data.totals.count.toString()} />
      </div>

      {items.length > 0 && (
        <SectionSearchBar
          value={query}
          onChange={setQuery}
          placeholder={t('phSearchCommission')}
          resultCount={filtered.length}
          totalCount={byStatus.length}
        />
      )}

      {items.length > 0 && (
        <div className="flex gap-1 mb-3 flex-wrap">
          {(
            [
              { id: 'all', label: t('chipAll') },
              { id: 'pending', label: t('chipPending') },
              { id: 'paid', label: t('chipPaid') },
              { id: 'partial', label: t('chipPartial') },
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
                {[t('colBeneficiary'), t('colCode'), t('colClient'), t('colAmount'), t('colStatus'), t('colCreated'), t('colPaidDate')].map(
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
                    {t('emptyNoCommissionsYet')}
                  </td>
                </tr>
              )}
              {items.length > 0 && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-mute">
                    <div className="text-2xl mb-1">🔎</div>
                    {t('emptyNoCommissionsMatch')}
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
                        {t(s.key)}
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
  const t = useTranslations('admin_referrals');
  // Nombre de la marca (Sellea en su dominio) para el hint del socio que decía "Clubify".
  const { brand } = useAuthBrand();
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
      toast(t('toastConfigSaved'), 'success');
    } catch (e: any) {
      toast(e.message || t('errorGeneric'), 'error');
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
          <h3 className="font-semibold m-0 mb-1">{t('defaultCommissions')}</h3>
          <div className="text-xs text-mute mb-3">
            {t('defaultCommissionsHint')}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('influencerDirect')}</label>
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
              <label className="label">{t('ambassador')}</label>
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
            <label className="label">{t('influencerIndirect')}</label>
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
          <h3 className="font-semibold m-0 mb-1">{t('globalPartner')}</h3>
          <div className="text-xs text-mute mb-3">
            {t('globalPartnerHint', { brandName: brand?.name ?? 'Clubify' })}
          </div>
          {socioOptions.length > 0 && (
            <select
              className="input mb-3"
              value={cfg.socioCodeId}
              onChange={(e) => setCfg({ ...cfg, socioCodeId: e.target.value })}
            >
              <option value="">{t('noPartnerConfigured')}</option>
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
          <h3 className="font-semibold m-0 mb-1">{t('payments')}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('holdDays')}</label>
              <input
                type="number"
                min={0}
                className="input"
                value={cfg.holdDays}
                onChange={(e) => setCfg({ ...cfg, holdDays: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className="label">{t('minPayoutUsd')}</label>
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
          <h3 className="font-semibold m-0 mb-1">👥 {t('ambassadorsPermissions')}</h3>
          <div className="text-xs text-mute mb-3">
            {t('ambassadorsPermissionsHint')}
          </div>
        </div>
        <NotifToggle
          label={t('allowInfluencersCreateAmbassadors')}
          description={t('allowInfluencersCreateAmbassadorsDesc')}
          checked={cfg.allowInfluencerCreatesAmbassadors}
          onChange={(v) => setCfg({ ...cfg, allowInfluencerCreatesAmbassadors: v })}
        />
        <NotifToggle
          label={t('requireAmbassadorApproval')}
          description={t('requireAmbassadorApprovalDesc')}
          checked={cfg.requireAmbassadorApproval}
          onChange={(v) => setCfg({ ...cfg, requireAmbassadorApproval: v })}
        />
        <PendingAmbassadorsList />
      </div>

      <div className="card card-pad lg:col-span-2 space-y-3">
        <div>
          <h3 className="font-semibold m-0 mb-1">🔔 {t('autoNotifications')}</h3>
          <div className="text-xs text-mute mb-3">
            {t.rich('autoNotificationsHint', {
              code: (chunks) => <code className="bg-bg2 px-1 rounded">{chunks}</code>,
            })}
          </div>
        </div>
        <NotifToggle
          label={t('notifyPaymentFailed')}
          description={t('notifyPaymentFailedDesc')}
          checked={cfg.notifyPaymentFailed}
          onChange={(v) => setCfg({ ...cfg, notifyPaymentFailed: v })}
        />
        <NotifToggle
          label={t('notifyChurn')}
          description={t('notifyChurnDesc')}
          checked={cfg.notifyChurn}
          onChange={(v) => setCfg({ ...cfg, notifyChurn: v })}
        />
        <div className="pt-2 border-t border-line">
          <label className="label">{t('sendChannel')}</label>
          <select
            className="input"
            value={cfg.notifyChannel}
            onChange={(e) => setCfg({ ...cfg, notifyChannel: e.target.value as any })}
          >
            <option value="SMS">📱 {t('channelSmsOnly')}</option>
            <option value="EMAIL">📧 {t('channelEmailOnly')}</option>
            <option value="BOTH">📱 + 📧 {t('channelBoth')}</option>
          </select>
        </div>
      </div>

      <div className="lg:col-span-2 flex justify-end">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? t('saving') : t('btnSaveConfig')}
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
  const t = useTranslations('admin_referrals');
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
        aria-label={t('toggleAria', { label })}
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
  const t = useTranslations('admin_referrals');
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
    toast(t('toastAmbassadorApproved'), 'success');
    load();
  }
  async function reject(id: string) {
    if (!confirm(t('confirmRejectAmbassador'))) return;
    await api(`/referrals/ambassadors/${id}/reject`, { method: 'POST' });
    toast(t('toastAmbassadorRejected'), 'success');
    load();
  }

  if (loading) return null;
  if (pending.length === 0) return null;

  return (
    <div className="border-t border-line pt-3 mt-2">
      <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-2">
        {t('pendingApprovalCount', { count: pending.length })}
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
                  {t('createdBy', { name: p.parentCode.ownerName, code: p.parentCode.code })}
                </div>
              )}
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => approve(p.id)} className="text-xs text-ok hover:underline">
                ✓ {t('btnApprove')}
              </button>
              <button onClick={() => reject(p.id)} className="text-xs text-bad hover:underline">
                {t('btnReject')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SocioInviteForm({ onCreated }: { onCreated: () => void }) {
  const t = useTranslations('admin_referrals');
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
      toast(t('toastPartnerCreated'), 'success');
      setForm({ fullName: '', email: '', whatsapp: '', commissionPercent: 10, customCode: '' });
      setShow(false);
      onCreated();
    } catch (e: any) {
      toast(e.message || t('errorGeneric'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {!show ? (
        <button onClick={() => setShow(true)} className="btn-ghost text-xs w-full">
          + {t('btnCreateInvitePartner')}
        </button>
      ) : (
        <form onSubmit={submit} className="border border-line rounded-lg p-3 space-y-2 bg-bg2/30">
          <div className="grid grid-cols-2 gap-2">
            <input
              className="input"
              placeholder={t('phFullName')}
              required
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
            <input
              className="input"
              type="email"
              placeholder={t('phEmail')}
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input
              className="input"
              placeholder={t('phWhatsapp')}
              required
              value={form.whatsapp}
              onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
            />
            <input
              type="number"
              min={0}
              max={100}
              className="input"
              placeholder={t('phGlobalPercent')}
              value={form.commissionPercent}
              onChange={(e) => setForm({ ...form, commissionPercent: Number(e.target.value) })}
            />
            <input
              className="input"
              placeholder={t('phCodeOptional')}
              value={form.customCode}
              onChange={(e) => setForm({ ...form, customCode: e.target.value.toUpperCase() })}
            />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShow(false)} className="btn-ghost text-xs flex-1">
              {t('btnCancel')}
            </button>
            <button type="submit" disabled={busy} className="btn-primary text-xs flex-1">
              {busy ? t('creating') : t('btnCreateSendInvite')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
