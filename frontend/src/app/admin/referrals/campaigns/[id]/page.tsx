'use client';
/**
 * Página dedicada de una campaña — supera al modal con vista completa:
 * mini dashboard de KPIs, lista detallada de embajadores con métricas,
 * historial de comisiones de la campaña.
 */
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { PhoneInput } from '@/components/PhoneInput';
import { AffiliateCredentialsModal } from '@/components/AffiliateCredentialsModal';
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import {
  CommissionExceptionModal,
  CommissionExceptionHistoryDrawer,
  type AttributionLevel,
  type ExistingException,
} from '@/components/CommissionExceptionModal';

type Detail = {
  id: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'FINISHED';
  createdAt: string;
  ownerCode: {
    id: string;
    code: string;
    slug?: string | null;
    ownerName: string;
    ownerEmail: string;
    ownerWhatsapp: string;
    commissionPercent: any;
    uses: any[];
  };
  codes: Array<{
    id: string;
    code: string;
    slug?: string | null;
    ownerName: string;
    ownerEmail: string;
    commissionPercent: any;
    isActive: boolean;
    approvedAt: string | null;
    uses: any[];
  }>;
};

const STATUS_PILL: Record<Detail['status'], { textKey: string; cls: string }> = {
  ACTIVE: { textKey: 'statusActive', cls: 'bg-ok-soft text-ok' },
  PAUSED: { textKey: 'statusPaused', cls: 'bg-amber-100 text-amber-800' },
  FINISHED: { textKey: 'statusFinished', cls: 'bg-bg2 text-mute' },
};

function fmtUsd(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}
function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function CampaignDetailPage() {
  const t = useTranslations('admin_referrals_campaigns_id');
  const tc = useTranslations('common');
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({
    fullName: '',
    email: '',
    whatsapp: '',
    commissionPercent: 25,
    customCode: '',
    password: '',
  });
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setData(await api<Detail>(`/campaigns/${id}`));
    } catch (e: any) {
      toast(e.message || tc('error'), 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function setStatus(status: Detail['status']) {
    await api(`/campaigns/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    toast(t('toastStatusUpdated'), 'success');
    load();
  }

  async function patchCampaign(
    patch: Partial<{ name: string; ownerCommissionPercent: number }>,
  ) {
    try {
      const res = await api<{
        recalc?: { updated: number; skippedPaid: number; affectedAmount: number } | null;
      }>(`/campaigns/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      if (res?.recalc && res.recalc.updated > 0) {
        toast(
          t('toastRecalc', { updated: res.recalc.updated }) +
            (res.recalc.skippedPaid > 0
              ? ` ${t('toastRecalcSkipped', { skipped: res.recalc.skippedPaid })}`
              : '.'),
          'success',
        );
      } else {
        toast(t('toastSaved'), 'success');
      }
      load();
    } catch (e: any) {
      toast(e.message ?? t('errorSave'), 'error');
    }
  }

  const [ambCreds, setAmbCreds] = useState<{
    email: string;
    password: string;
    loginUrl: string;
    fullName: string;
    whatsapp: string;
  } | null>(null);
  const [showDelete, setShowDelete] = useState(false);

  async function addAmbassador(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api<any>(`/campaigns/${id}/ambassadors`, {
        method: 'POST',
        body: JSON.stringify(addForm),
      });
      const saved = { ...addForm };
      setAddForm({ fullName: '', email: '', whatsapp: '', commissionPercent: 25, customCode: '', password: '' });
      setShowAdd(false);
      load();
      if (res?.affiliateCredentials) {
        setAmbCreds({
          ...res.affiliateCredentials,
          fullName: saved.fullName,
          whatsapp: saved.whatsapp,
        });
      } else {
        toast(t('toastAmbassadorAdded'), 'success');
      }
    } catch (e: any) {
      toast(e.message || tc('error'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeAmbassador(ambId: string) {
    if (!confirm(t('confirmDeactivateAmbassador'))) return;
    await api(`/campaigns/ambassadors/${ambId}`, { method: 'DELETE' });
    toast(t('toastAmbassadorDeactivated'), 'success');
    load();
  }

  if (loading || !data) return <div className="p-8 text-mute">{tc('loading')}</div>;

  // Métricas calculadas
  const allUses = [
    ...data.ownerCode.uses,
    ...data.codes.flatMap((c) => c.uses),
  ];
  const allCommissions = allUses.flatMap((u: any) => u.commissions ?? []);
  const round = (n: number) => Math.round(n * 100) / 100;
  const directClients = data.ownerCode.uses.length;
  const indirectClients = data.codes.reduce((s, a) => s + a.uses.length, 0);
  const activeClients = allUses.filter(
    (u: any) => u.status === 'PAYING' || u.status === 'ACTIVE',
  ).length;
  const churnedClients = allUses.filter((u: any) => u.status === 'CHURNED').length;
  const totalCommissionsUsd = round(
    allCommissions.reduce((s: number, c: any) => s + Number(c.amount), 0),
  );
  const paidUsd = round(
    allCommissions
      .filter((c: any) => c.status === 'PAID')
      .reduce((s: number, c: any) => s + Number(c.amount), 0),
  );
  const pendingUsd = round(
    allCommissions
      .filter((c: any) => c.status === 'PENDING' || c.status === 'APPROVED')
      .reduce((s: number, c: any) => s + Number(c.amount), 0),
  );

  return (
    <div>
      <div className="page-head flex-wrap gap-3">
        <div className="flex-1 min-w-[260px]">
          <Link href="/admin/referrals" className="text-xs text-mute hover:text-ink">
            {t('back')}
          </Link>
          <h1 className="page-title m-0 mt-1">{data.name}</h1>
          <div className="flex items-center gap-2 mt-2">
            <span
              className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${STATUS_PILL[data.status].cls}`}
            >
              {t(STATUS_PILL[data.status].textKey)}
            </span>
            <span className="text-xs text-mute">{t('createdOn', { date: fmtDate(data.createdAt) })}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {data.status !== 'ACTIVE' && (
            <button onClick={() => setStatus('ACTIVE')} className="btn-ghost text-sm">
              {t('activate')}
            </button>
          )}
          {data.status !== 'PAUSED' && (
            <button onClick={() => setStatus('PAUSED')} className="btn-ghost text-sm">
              {t('pause')}
            </button>
          )}
          {data.status !== 'FINISHED' && (
            <button onClick={() => setStatus('FINISHED')} className="btn-ghost text-sm">
              {t('finish')}
            </button>
          )}
          <button
            onClick={() => setShowDelete(true)}
            className="text-sm font-semibold px-3 py-1.5 rounded-md bg-red-100 text-red-700 hover:bg-red-200"
            title={t('deleteTitle')}
          >
            🗑 {tc('delete')}
          </button>
        </div>
      </div>
      {showDelete && (
        <ConfirmDeleteModal
          title={t('deleteModalTitle', { name: data.name })}
          description={
            <>
              {t.rich('deleteModalDescription', {
                active: (chunks) => <strong>{chunks}</strong>,
                cant: (chunks) => <strong>{chunks}</strong>,
              })}
            </>
          }
          onConfirm={async () => {
            try {
              await api(`/campaigns/${id}`, { method: 'DELETE' });
              toast(t('toastCampaignDeleted', { name: data.name }), 'success');
              router.push('/admin/referrals');
            } catch (e: any) {
              toast(e.message || t('errorDelete'), 'error');
            }
          }}
          onClose={() => setShowDelete(false)}
        />
      )}

      {/* Mini dashboard */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 mb-5">
        <Stat label={t('statActiveClients')} value={String(activeClients)} tone="ok" />
        <Stat label={t('statTotalClients')} value={String(directClients + indirectClients)} />
        <Stat label={t('statChurned')} value={String(churnedClients)} />
        <Stat label={t('statAmbassadors')} value={String(data.codes.length)} />
        <Stat label={t('statCommissionsGenerated')} value={fmtUsd(totalCommissionsUsd)} tone="brand" />
        <Stat label={t('statPaid')} value={fmtUsd(paidUsd)} tone="ok" />
        <Stat label={t('statPending')} value={fmtUsd(pendingUsd)} tone="amber" />
        <Stat
          label={t('statDirectVsIndirect')}
          value={`${directClients} / ${indirectClients}`}
        />
      </div>

      {/* Configuración editable */}
      <CampaignSettings data={data} onPatch={patchCampaign} />

      {/* Influencer titular + link */}
      <div className="card card-pad mb-5 bg-bg2/40">
        <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1">
          {t('ownerInfluencer')}
        </div>
        <div className="font-semibold text-base">{data.ownerCode.ownerName}</div>
        <div className="text-xs text-mute">
          {data.ownerCode.ownerEmail} · {data.ownerCode.ownerWhatsapp}
        </div>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center gap-2 bg-white px-3 py-2 rounded-lg">
            <span className="font-mono font-bold text-lg">{data.ownerCode.code}</span>
            <span className="text-xs text-mute">
              · {t('affiliateCommissionPct', { pct: Number(data.ownerCode.commissionPercent) })}
            </span>
          </div>
        </div>
        <CampaignShareLink code={data.ownerCode.code} slug={data.ownerCode.slug ?? null} />
        <AmbassadorApplyLink code={data.ownerCode.code} />
      </div>

      {/* Embajadores */}
      <div className="card card-pad mb-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold m-0">
            {t('ambassadorsHeading', { count: data.codes.length })}
          </h2>
          <button onClick={() => setShowAdd(!showAdd)} className="btn-ghost text-sm">
            {showAdd ? tc('cancel') : t('addAmbassadorBtn')}
          </button>
        </div>

        {showAdd && (
          <form
            onSubmit={addAmbassador}
            className="border border-line rounded-lg p-3 mb-3 space-y-2 bg-bg2/30"
          >
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
            <div>
              <PhoneInput
                value={addForm.whatsapp}
                onChange={(v) => setAddForm({ ...addForm, whatsapp: v })}
                placeholder={t('phWhatsapp')}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                className="input"
                type="number"
                min={0}
                max={100}
                placeholder={t('phCommissionPct')}
                value={addForm.commissionPercent}
                onChange={(e) => setAddForm({ ...addForm, commissionPercent: Number(e.target.value) })}
              />
              <input
                className="input"
                placeholder={t('phCode')}
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
              placeholder={t('phPassword')}
              value={addForm.password}
              onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
            />
            <button type="submit" disabled={busy} className="btn-primary text-sm w-full">
              {busy ? t('adding') : t('addAmbassadorSubmit')}
            </button>
          </form>
        )}

        {data.codes.length === 0 ? (
          <div className="text-center py-8 text-mute text-sm">
            {t('noAmbassadors')}
          </div>
        ) : (
          <div className="space-y-2">
            {data.codes.map((amb) => {
              const ambUses = amb.uses ?? [];
              const ambComm = (ambUses as any[])
                .flatMap((u) => u.commissions ?? [])
                .reduce((s, c) => s + Number(c.amount), 0);
              return (
                <div
                  key={amb.id}
                  className={`border border-line rounded-lg p-3 flex items-center justify-between gap-3 ${
                    amb.isActive ? '' : 'opacity-50'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate flex items-center gap-2">
                      {amb.ownerName}
                      {!amb.approvedAt && (
                        <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                          {t('pending')}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-mute truncate">{amb.ownerEmail}</div>
                  </div>
                  <div className="font-mono font-bold text-sm bg-bg2 px-2 py-1 rounded">
                    {amb.code}
                  </div>
                  <div className="text-xs text-mute whitespace-nowrap text-right">
                    <div>{t('pctClients', { pct: Number(amb.commissionPercent), count: ambUses.length })}</div>
                    <div className="text-brand font-semibold">{fmtUsd(round(ambComm))}</div>
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
              );
            })}
          </div>
        )}
      </div>

      {/* Item 6 sprint: comisiones por cliente con excepciones individuales. */}
      <ClientsCommissionsSection campaignId={id} />

      {ambCreds && (
        <AffiliateCredentialsModal
          credentials={ambCreds}
          whoLabel={t('whoLabelAmbassador', { name: ambCreds.fullName })}
          whatsapp={ambCreds.whatsapp}
          onClose={() => setAmbCreds(null)}
        />
      )}
    </div>
  );
}

type CampaignClient = {
  tenantId: string;
  brandName: string;
  status: string;
  email: string | null;
  attributions: AttributionLevel[];
  exceptions: ExistingException[];
  breakdown?: {
    revenueUsd: number;
    commissionsUsd: number;
    paidUsd: number;
    pendingUsd: number;
    netUsd: number;
    cyclesCount: number;
  };
};

function ClientsCommissionsSection({ campaignId }: { campaignId: string }) {
  const t = useTranslations('admin_referrals_campaigns_id');
  const tc = useTranslations('common');
  const [clients, setClients] = useState<CampaignClient[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CampaignClient | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await api<{ items: CampaignClient[] }>(
        `/admin/commission-exceptions?campaignId=${encodeURIComponent(campaignId)}${
          q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''
        }`,
      );
      setClients(res.items);
    } catch (e: any) {
      setError(e.message ?? t('errorLoadList'));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  // Refresca de los reportes scoped al cliente cuando se guarda una
  // excepción — listar comisiones del tenant para cache busted.
  async function bustTenantReportsCache(tenantId: string) {
    try {
      await api(`/admin/commissions?tenantId=${tenantId}&_=${Date.now()}`).catch(() => null);
    } catch {
      /* best-effort: el endpoint puede no existir según versión del panel */
    }
  }

  return (
    <div className="card card-pad mb-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h2 className="font-semibold m-0">
          {t('attributedClients', { count: clients?.length ?? 0 })}
        </h2>
        <input
          className="input text-sm max-w-xs"
          placeholder={t('searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') load();
          }}
        />
      </div>

      {error && (
        <div className="text-xs text-bad bg-bad-soft/40 rounded-md px-3 py-2 mb-2">
          {error}
        </div>
      )}

      {!clients ? (
        <div className="text-sm text-mute py-6 text-center">{tc('loading')}</div>
      ) : clients.length === 0 ? (
        <div className="text-sm text-mute py-6 text-center">
          {t('noAttributedClients')}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-mute border-b border-line2">
                <th className="py-2 pr-3">{t('thClient')}</th>
                <th className="py-2 pr-3">{t('thAttribution')}</th>
                <th className="py-2 pr-3">{t('thCommission')}</th>
                <th className="py-2 pr-3 text-right" title={t('thInTitle')}>
                  {t('thIn')}
                </th>
                <th className="py-2 pr-3 text-right" title={t('thCommissionColTitle')}>
                  {t('thCommission')}
                </th>
                <th className="py-2 pr-3 text-right" title={t('thLeftTitle')}>
                  {t('thLeft')}
                </th>
                <th className="py-2 pr-3 text-right">{t('thActions')}</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => {
                // Si hay más de una atribución, mostramos el directo más
                // grande (= el con mayor % default) como "principal".
                const principalAttr = [...c.attributions].sort(
                  (a, b) => b.defaultPercent - a.defaultPercent,
                )[0];
                const principalException = principalAttr
                  ? c.exceptions.find(
                      (e) => e.recipientCodeId === principalAttr.codeId && e.isActive,
                    )
                  : null;
                return (
                  <tr key={c.tenantId} className="border-b border-line2/40 last:border-b-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium truncate max-w-[200px]">
                        {c.brandName}
                      </div>
                      <div className="text-xs text-mute truncate max-w-[200px]">
                        {c.email ?? '—'}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      {c.attributions.length === 0 ? (
                        <span className="text-mute text-xs">{t('noAttribution')}</span>
                      ) : (
                        <div className="space-y-0.5">
                          {c.attributions.map((a) => (
                            <div key={a.codeId} className="text-xs">
                              <span className="font-mono">{a.code}</span>
                              <span className="text-mute"> · {a.ownerName}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {principalAttr ? (
                        principalException ? (
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold">
                              {principalException.customPercent}%
                            </span>
                            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                              {t('exception')}
                            </span>
                            <span title={t('activeException')} aria-hidden>
                              ✏️
                            </span>
                          </div>
                        ) : (
                          <div className="text-xs">
                            <span className="font-semibold">
                              {principalAttr.defaultPercent}%
                            </span>{' '}
                            <span className="text-mute">{t('campaignTag')}</span>
                          </div>
                        )
                      ) : (
                        <span className="text-mute text-xs">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap font-mono text-xs">
                      {c.breakdown ? fmtUsd(c.breakdown.revenueUsd) : '—'}
                      {c.breakdown && c.breakdown.cyclesCount > 0 && (
                        <div className="text-[10px] text-mute font-sans">
                          {t('cyclesCount', { count: c.breakdown.cyclesCount })}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap font-mono text-xs">
                      {c.breakdown ? fmtUsd(c.breakdown.commissionsUsd) : '—'}
                      {c.breakdown && c.breakdown.pendingUsd > 0 && (
                        <div className="text-[10px] text-amber-700 font-sans">
                          {t('pendingAmount', { amount: fmtUsd(c.breakdown.pendingUsd) })}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap font-mono text-xs">
                      <span
                        className={
                          c.breakdown && c.breakdown.netUsd > 0
                            ? 'text-emerald-700 font-semibold'
                            : 'text-mute'
                        }
                      >
                        {c.breakdown ? fmtUsd(c.breakdown.netUsd) : '—'}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => setEditing(c)}
                        className="btn-ghost text-xs"
                      >
                        {t('editCommission')}
                      </button>
                      {principalException && (
                        <button
                          onClick={() => setHistoryFor(principalException.id)}
                          className="btn-ghost text-xs ml-1"
                          title={t('viewHistory')}
                        >
                          📜
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <CommissionExceptionModal
          tenantId={editing.tenantId}
          brandName={editing.brandName}
          attributions={editing.attributions}
          exceptions={editing.exceptions}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await bustTenantReportsCache(editing.tenantId);
            await load();
          }}
        />
      )}

      {historyFor && (
        <CommissionExceptionHistoryDrawer
          exceptionId={historyFor}
          onClose={() => setHistoryFor(null)}
        />
      )}
    </div>
  );
}

/** Edición del nombre de la campaña. */
function CampaignSettings({
  data,
  onPatch,
}: {
  data: { name: string; ownerCode: { commissionPercent: any } };
  onPatch: (
    patch: Partial<{ name: string; ownerCommissionPercent: number }>,
  ) => Promise<void>;
}) {
  const t = useTranslations('admin_referrals_campaigns_id');
  const tc = useTranslations('common');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(data.name);
  const [pct, setPct] = useState(Number(data.ownerCode.commissionPercent));

  useEffect(() => {
    setName(data.name);
    setPct(Number(data.ownerCode.commissionPercent));
  }, [data.name, data.ownerCode.commissionPercent]);

  async function save() {
    const patch: Partial<{ name: string; ownerCommissionPercent: number }> = {};
    if (name.trim() && name !== data.name) patch.name = name.trim();
    const currentPct = Number(data.ownerCode.commissionPercent);
    if (Number.isFinite(pct) && pct >= 0 && pct <= 100 && pct !== currentPct) {
      patch.ownerCommissionPercent = pct;
    }
    if (Object.keys(patch).length > 0) {
      await onPatch(patch);
    }
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="card card-pad mb-5 flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1">
            {t('configuration')}
          </div>
          <div className="text-sm">{t('nameLabel', { name: data.name })}</div>
          <div className="text-sm">
            {t('influencerCommissionLabel', { pct: Number(data.ownerCode.commissionPercent) })}
          </div>
        </div>
        <button onClick={() => setEditing(true)} className="btn-ghost text-sm">
          {tc('edit')}
        </button>
      </div>
    );
  }

  return (
    <div className="card card-pad mb-5 space-y-3">
      <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
        {t('editCampaign')}
      </div>
      <label className="block">
        <div className="text-xs text-mute mb-1">{t('phName')}</div>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="block">
        <div className="text-xs text-mute mb-1">{t('influencerCommissionPct')}</div>
        <input
          className="input"
          type="number"
          min={0}
          max={100}
          step={0.01}
          value={pct}
          onChange={(e) => setPct(Number(e.target.value))}
        />
        <div className="text-[10px] text-mute mt-1">
          {t('futureCommissionsNote')}
        </div>
      </label>
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => {
            setEditing(false);
            setName(data.name);
            setPct(Number(data.ownerCode.commissionPercent));
          }}
          className="btn-ghost text-sm"
        >
          {tc('cancel')}
        </button>
        <button onClick={save} className="btn-primary text-sm">
          {tc('save')}
        </button>
      </div>
    </div>
  );
}

/** Link de postulación de embajadores. Item 18 — cualquier persona con
 *  este link puede aplicar como embajador de la campaña vía form
 *  público en /refer/[code]. */
function AmbassadorApplyLink({ code }: { code: string }) {
  const t = useTranslations('admin_referrals_campaigns_id');
  const link =
    typeof window !== 'undefined'
      ? `${window.location.origin}/refer/${code}`
      : '';
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toast(t('toastLinkCopied'), 'success');
    } catch {
      toast(t('errorCopy'), 'error');
    }
  }
  const waText = encodeURIComponent(
    `${t('applyWaText')}: ${link}`,
  );
  return (
    <div className="mt-3 pt-3 border-t border-line2">
      <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1.5">
        {t('applyLinkHeading')}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={link}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
          className="input flex-1 min-w-[240px] font-mono text-xs"
        />
        <button onClick={copy} className="btn-ghost text-xs">
          {t('copy')}
        </button>
        <a
          href={`https://wa.me/?text=${waText}`}
          target="_blank"
          rel="noreferrer"
          className="btn-ghost text-xs"
        >
          💬 WhatsApp
        </a>
      </div>
      <div className="text-[11px] text-mute mt-1.5 leading-relaxed">
        {t.rich('applyLinkNote', {
          code: () => <code>referrals.requireAmbassadorApproval</code>,
        })}
      </div>
    </div>
  );
}

/** Link corto público para que el influencer comparta con sus seguidores.
 *  Usa `/ref/<slug>` si hay slug definido (más memorable), fallback a
 *  `/signup?ref=CODE`. El backend loguea visita en ReferralVisit. */
function CampaignShareLink({ code, slug }: { code: string; slug: string | null }) {
  const t = useTranslations('admin_referrals_campaigns_id');
  const link =
    typeof window !== 'undefined'
      ? slug
        ? `${window.location.origin}/ref/${slug}`
        : `${window.location.origin}/signup?ref=${code}`
      : '';
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toast(t('toastLinkCopied'), 'success');
    } catch {
      toast(t('errorCopy'), 'error');
    }
  }
  const waText = encodeURIComponent(
    `${t('shareWaText', { code })}: ${link}`,
  );
  return (
    <div className="mt-3 pt-3 border-t border-line2">
      <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1.5">
        {t('campaignLinkHeading')}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={link}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
          className="input flex-1 min-w-[240px] font-mono text-xs"
        />
        <button onClick={copy} className="btn-ghost text-xs">
          {t('copy')}
        </button>
        <a
          href={`https://wa.me/?text=${waText}`}
          target="_blank"
          rel="noreferrer"
          className="btn-ghost text-xs"
        >
          💬 WhatsApp
        </a>
      </div>
      <div className="text-[11px] text-mute mt-1.5 leading-relaxed">
        {t.rich('campaignLinkNote', {
          code: () => <code>{code}</code>,
        })}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'amber' | 'brand';
}) {
  const cls =
    tone === 'ok'
      ? 'text-ok'
      : tone === 'amber'
      ? 'text-amber-700'
      : tone === 'brand'
      ? 'text-brand'
      : 'text-ink';
  return (
    <div className="card card-pad">
      <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
        {label}
      </div>
      <div className={`text-xl font-bold mt-1 ${cls}`}>{value}</div>
    </div>
  );
}
