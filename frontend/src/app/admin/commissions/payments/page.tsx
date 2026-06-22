'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type Role = 'INFLUENCER' | 'AMBASSADOR' | 'VENDOR' | 'SOCIO';

type PendingPersonRow = {
  codeId: string;
  code: string;
  ownerName: string;
  ownerEmail: string;
  ownerWhatsapp: string;
  role: Role;
  commissionsCount: number;
  totalOutstanding: number;
  totalPaid: number;
  oldestPending: string | null;
};

type PendingResp = {
  items: PendingPersonRow[];
  totals: {
    count: number;
    grandTotalOutstanding: number;
  };
};

const ROLE_LABEL_KEY: Record<Role, string> = {
  INFLUENCER: 'roleInfluencer',
  AMBASSADOR: 'roleAmbassador',
  VENDOR: 'roleVendor',
  SOCIO: 'roleSocio',
};

const ROLE_CLS: Record<Role, string> = {
  INFLUENCER: 'bg-purple-100 text-purple-700',
  AMBASSADOR: 'bg-blue-100 text-blue-700',
  VENDOR: 'bg-emerald-100 text-emerald-700',
  SOCIO: 'bg-amber-100 text-amber-700',
};

function fmtUsd(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function daysSince(d: string | null) {
  if (!d) return null;
  return Math.floor(
    (Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24),
  );
}

export default function CommissionsPaymentsPage() {
  const t = useTranslations('admin_commissions_payments');
  const [data, setData] = useState<PendingResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'' | Role>('');
  const [search, setSearch] = useState('');
  const [bulkTarget, setBulkTarget] = useState<PendingPersonRow | null>(null);

  async function load() {
    setLoading(true);
    try {
      setData(await api<PendingResp>('/admin/commissions/payouts/pending'));
    } catch (e: any) {
      toast(e?.message ?? t('errorLoading'), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    let items = data?.items ?? [];
    if (filter) items = items.filter((it) => it.role === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      items = items.filter(
        (it) =>
          it.ownerName.toLowerCase().includes(q) ||
          it.ownerEmail.toLowerCase().includes(q) ||
          it.code.toLowerCase().includes(q),
      );
    }
    return items;
  }, [data, filter, search]);

  return (
    <div className="max-w-6xl">
      <div className="page-head flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">
          {t('pageTitle')} <span className="page-crumb">{t('pageCrumb')}</span>
        </h1>
        <Link
          href="/admin/commissions"
          className="text-sm text-mute hover:text-ink underline"
        >
          {t('backToDetail')}
        </Link>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <KpiCard
          label={t('kpiPendingPeople')}
          value={data?.totals.count ?? 0}
          accent="brand"
        />
        <KpiCard
          label={t('kpiTotalToPay')}
          value={fmtUsd(data?.totals.grandTotalOutstanding ?? 0)}
          accent="warn"
        />
        <KpiCard
          label={t('kpiAveragePerPerson')}
          value={
            data && data.totals.count > 0
              ? fmtUsd(data.totals.grandTotalOutstanding / data.totals.count)
              : fmtUsd(0)
          }
          accent="ok"
        />
      </div>

      {/* Filtros */}
      <div className="card card-pad mb-3 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="label">{t('filterSearch')}</label>
          <input
            className="input"
            placeholder={t('phSearch')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div>
          <label className="label">{t('filterRole')}</label>
          <select
            className="input"
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
          >
            <option value="">{t('filterAll')}</option>
            <option value="INFLUENCER">{t('roleInfluencer')}</option>
            <option value="AMBASSADOR">{t('roleAmbassador')}</option>
            <option value="VENDOR">{t('roleVendor')}</option>
            <option value="SOCIO">{t('roleSocio')}</option>
          </select>
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[840px]">
            <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 font-semibold">{t('thPerson')}</th>
                <th className="px-4 py-3 font-semibold">{t('thRole')}</th>
                <th className="px-4 py-3 font-semibold text-right">
                  {t('thCommissions')}
                </th>
                <th className="px-4 py-3 font-semibold text-right">
                  {t('thOutstanding')}
                </th>
                <th className="px-4 py-3 font-semibold text-right">
                  {t('thHistoricalPaid')}
                </th>
                <th className="px-4 py-3 font-semibold">{t('thOldest')}</th>
                <th className="px-4 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-mute">
                    {t('loading')}
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-mute">
                    <div className="text-3xl mb-2">🎉</div>
                    <div className="font-semibold text-ink">
                      {t('emptyTitle')}
                    </div>
                    <div className="text-xs mt-1">
                      {t('emptyHint')}
                    </div>
                  </td>
                </tr>
              )}
              {!loading &&
                filtered.map((p) => {
                  const days = daysSince(p.oldestPending);
                  return (
                    <tr
                      key={p.codeId}
                      className="border-t border-line2 hover:bg-bg2/40"
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold">{p.ownerName}</div>
                        <div className="text-xs text-mute">
                          {p.ownerEmail}
                        </div>
                        <div className="text-[10px] text-mute font-mono mt-0.5">
                          {p.code}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            ROLE_CLS[p.role] ?? 'bg-bg3 text-ink'
                          }`}
                        >
                          {ROLE_LABEL_KEY[p.role]
                            ? t(ROLE_LABEL_KEY[p.role])
                            : p.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {p.commissionsCount}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-amber-700">
                        {fmtUsd(p.totalOutstanding)}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-ok">
                        {fmtUsd(p.totalPaid)}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div>{fmtDate(p.oldestPending)}</div>
                        {days !== null && days > 0 && (
                          <div
                            className={`text-[10px] ${
                              days > 30 ? 'text-bad' : 'text-mute'
                            }`}
                          >
                            {t('daysAgo', { days })}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          onClick={() => setBulkTarget(p)}
                          className="text-xs px-3 py-1.5 rounded-md bg-brand text-white font-semibold hover:opacity-90 transition select-none active:scale-[0.97] [-webkit-tap-highlight-color:transparent]"
                        >
                          {t('markAllPaid')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-mute mt-3">
        🛈 {t('footnote')}
      </p>

      {bulkTarget && (
        <BulkPayModal
          person={bulkTarget}
          onClose={() => setBulkTarget(null)}
          onSaved={() => {
            setBulkTarget(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function BulkPayModal({
  person,
  onClose,
  onSaved,
}: {
  person: PendingPersonRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('admin_commissions_payments');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      const res = await api<{ paidCount: number; totalPaid: number }>(
        '/admin/commissions/payouts/by-person',
        {
          method: 'POST',
          body: JSON.stringify({
            codeId: person.codeId,
            note: note.trim() || undefined,
          }),
        },
      );
      toast(
        t('toastBulkPaid', {
          count: res.paidCount,
          amount: fmtUsd(res.totalPaid),
        }),
        'success',
      );
      onSaved();
    } catch (e: any) {
      toast(e?.message ?? t('errorMarkingPayments'), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg1 rounded-xl max-w-md w-full p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-2">
          {t('modalTitle', { name: person.ownerName })}
        </h2>
        <p className="text-sm text-mute mb-4">
          {t.rich('modalDescription', {
            count: person.commissionsCount,
            total: fmtUsd(person.totalOutstanding),
            b: (chunks) => <strong className="text-ink">{chunks}</strong>,
          })}
        </p>

        <div className="bg-bg2 rounded-lg p-3 mb-4 text-sm">
          <div className="flex justify-between mb-1">
            <span className="text-mute">{t('modalEmail')}</span>
            <span className="font-medium">{person.ownerEmail}</span>
          </div>
          {person.ownerWhatsapp && (
            <div className="flex justify-between mb-1">
              <span className="text-mute">{t('modalWhatsapp')}</span>
              <span className="font-medium">{person.ownerWhatsapp}</span>
            </div>
          )}
          <div className="flex justify-between mb-1">
            <span className="text-mute">{t('modalCode')}</span>
            <span className="font-mono text-xs">{person.code}</span>
          </div>
          <div className="flex justify-between border-t border-line2 pt-2 mt-2">
            <span className="text-mute font-semibold">{t('modalTotalToPay')}</span>
            <span className="text-amber-700 font-bold">
              {fmtUsd(person.totalOutstanding)}
            </span>
          </div>
        </div>

        <div className="mb-4">
          <label className="label">{t('modalReference')}</label>
          <input
            type="text"
            placeholder={t('phReference')}
            className="input w-full"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            autoFocus
          />
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={saving}
            className="text-sm px-4 py-2 rounded-md bg-bg2 hover:bg-bg3 transition"
          >
            {t('btnCancel')}
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="text-sm px-4 py-2 rounded-md bg-brand text-white font-semibold hover:opacity-90 transition disabled:opacity-50 select-none active:scale-[0.97] [-webkit-tap-highlight-color:transparent]"
          >
            {saving ? t('processing') : t('btnConfirmBulk')}
          </button>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent: 'ok' | 'warn' | 'bad' | 'brand';
}) {
  const color =
    accent === 'ok'
      ? 'text-ok'
      : accent === 'warn'
      ? 'text-amber-600'
      : accent === 'bad'
      ? 'text-bad'
      : 'text-brand';
  return (
    <div className="card card-pad">
      <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
        {label}
      </div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}
