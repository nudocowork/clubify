'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type Trial = {
  id: string;
  brandName: string;
  email: string;
  phone: string | null;
  company: string | null;
  city: string | null;
  source: string | null;
  status: 'TRIAL_ACTIVE' | 'TRIAL_EXPIRED' | 'CONVERTED' | 'SUSPENDED';
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  daysLeft: number | null;
  createdAt: string;
  referrer: {
    code: string;
    name: string;
    role: 'INFLUENCER' | 'AMBASSADOR';
  } | null;
};

type Metrics = {
  counts: {
    total: number;
    active: number;
    expired: number;
    converted: number;
    suspended: number;
  };
  conversionPct: number | null;
  bySource: Record<
    string,
    {
      total: number;
      active: number;
      converted: number;
      expired: number;
      conversionPct: number | null;
    }
  >;
  byReferrer: Array<{
    code: string;
    name: string;
    role: string;
    total: number;
    converted: number;
    conversionPct: number | null;
  }>;
};

type Filter = 'all' | 'active' | 'expired' | 'converted';

const STATUS_BADGE: Record<Trial['status'], { labelKey: string; cls: string }> = {
  TRIAL_ACTIVE: { labelKey: 'statusActive', cls: 'badge-ok' },
  TRIAL_EXPIRED: { labelKey: 'statusExpired', cls: 'badge-warn' },
  CONVERTED: { labelKey: 'statusCustomer', cls: 'badge-ok' },
  SUSPENDED: { labelKey: 'statusSuspended', cls: 'badge-bad' },
};

const SOURCE_LABEL_KEY: Record<string, string> = {
  LANDING: 'sourceLanding',
  AMBASSADOR: 'sourceAmbassador',
  INFLUENCER: 'sourceInfluencer',
  CAMPAIGN: 'sourceCampaign',
  DIRECT: 'sourceDirect',
};

export default function TrialsAdminPage() {
  const t = useTranslations('admin_trials');
  const [trials, setTrials] = useState<Trial[] | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  async function load() {
    try {
      const [tr, m] = await Promise.all([
        api<Trial[]>(`/admin/trials?filter=${filter}`),
        api<Metrics>('/admin/trials/metrics'),
      ]);
      setTrials(tr);
      setMetrics(m);
    } catch (e: any) {
      toast(e?.message ?? t('errorLoading'), 'error');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  return (
    <div className="max-w-6xl">
      <div className="page-head">
        <h1 className="page-title">
          {t('pageTitle')} <span className="page-crumb">{t('pageCrumb')}</span>
        </h1>
      </div>

      <TrialPolicyCard />

      {/* KPI cards */}
      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
          <KpiCard label={t('kpiActiveTrials')} value={metrics.counts.active} accent="ok" />
          <KpiCard label={t('kpiExpired')} value={metrics.counts.expired} accent="warn" />
          <KpiCard label={t('kpiConverted')} value={metrics.counts.converted} accent="ok" />
          <KpiCard label={t('kpiSuspended')} value={metrics.counts.suspended} accent="bad" />
          <KpiCard
            label={t('kpiConversionPct')}
            value={metrics.conversionPct !== null ? `${metrics.conversionPct}%` : '—'}
            accent="brand"
            hint={t('kpiConversionHint')}
          />
        </div>
      )}

      {/* Breakdown por source */}
      {metrics && Object.keys(metrics.bySource).length > 0 && (
        <div className="card card-pad mb-5">
          <h2 className="text-base font-semibold m-0">{t('bySourceTitle')}</h2>
          <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-3">
            {Object.entries(metrics.bySource).map(([src, s]) => (
              <div key={src} className="rounded-lg border border-line2 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
                  {SOURCE_LABEL_KEY[src] ? t(SOURCE_LABEL_KEY[src]) : src}
                </div>
                <div className="text-xl font-bold mt-1">{s.total}</div>
                <div className="text-[11px] text-mute mt-1">
                  {t('sourceActivePaid', { active: s.active, paid: s.converted })}
                </div>
                {s.conversionPct !== null && (
                  <div className="text-[11px] text-brand font-semibold mt-0.5">
                    {t('conversionShort', { pct: s.conversionPct })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Breakdown por embajador */}
      {metrics && metrics.byReferrer.length > 0 && (
        <div className="card card-pad mb-5">
          <h2 className="text-base font-semibold m-0">{t('byReferrerTitle')}</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-mute text-[11px] uppercase tracking-wider border-b border-line2">
                  <th className="py-2 font-semibold">{t('thCode')}</th>
                  <th className="py-2 font-semibold">{t('thName')}</th>
                  <th className="py-2 font-semibold">{t('thRole')}</th>
                  <th className="py-2 font-semibold text-right">{t('thTrials')}</th>
                  <th className="py-2 font-semibold text-right">{t('thConverted')}</th>
                  <th className="py-2 font-semibold text-right">{t('thConvPct')}</th>
                </tr>
              </thead>
              <tbody>
                {metrics.byReferrer.map((r) => (
                  <tr key={r.code} className="border-b border-line2/40">
                    <td className="py-2 font-mono text-xs">{r.code}</td>
                    <td className="py-2 font-medium">{r.name}</td>
                    <td className="py-2 text-mute text-xs">{r.role}</td>
                    <td className="py-2 text-right">{r.total}</td>
                    <td className="py-2 text-right">{r.converted}</td>
                    <td className="py-2 text-right font-semibold text-brand">
                      {r.conversionPct !== null ? `${r.conversionPct}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(['all', 'active', 'expired', 'converted'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-sm px-3.5 py-1.5 rounded-pill transition ${
              filter === f
                ? 'bg-brand text-white font-semibold'
                : 'bg-bg2 text-ink hover:bg-bg3'
            }`}
          >
            {f === 'all'
              ? t('filterAll')
              : f === 'active'
              ? t('filterActive')
              : f === 'expired'
              ? t('filterExpired')
              : t('filterConverted')}
          </button>
        ))}
      </div>

      {/* Tabla */}
      <div className="card overflow-hidden">
        {!trials ? (
          <div className="p-6 text-mute text-sm">{t('loading')}</div>
        ) : trials.length === 0 ? (
          <div className="p-10 text-center text-mute">
            <div className="text-4xl mb-2">📭</div>
            {t('emptyFilter')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 font-semibold">{t('thBusiness')}</th>
                  <th className="px-4 py-3 font-semibold">{t('thContact')}</th>
                  <th className="px-4 py-3 font-semibold">{t('thSource')}</th>
                  <th className="px-4 py-3 font-semibold">{t('thStart')}</th>
                  <th className="px-4 py-3 font-semibold">{t('thEnd')}</th>
                  <th className="px-4 py-3 font-semibold text-right">{t('thDays')}</th>
                  <th className="px-4 py-3 font-semibold">{t('thStatus')}</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {trials.map((tr) => {
                  const badge = STATUS_BADGE[tr.status];
                  return (
                    <tr
                      key={tr.id}
                      className="border-t border-line2 hover:bg-bg2/40"
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold">{tr.brandName}</div>
                        {tr.city && (
                          <div className="text-[11px] text-mute">{tr.city}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div className="truncate max-w-[200px]">{tr.email}</div>
                        {tr.phone && (
                          <div className="text-mute">{tr.phone}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div>
                          {SOURCE_LABEL_KEY[tr.source ?? 'DIRECT']
                            ? t(SOURCE_LABEL_KEY[tr.source ?? 'DIRECT'])
                            : tr.source}
                        </div>
                        {tr.referrer && (
                          <div className="text-mute mt-0.5">
                            {t('viaName', { name: tr.referrer.name })}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {tr.trialStartedAt
                          ? new Date(tr.trialStartedAt).toLocaleDateString(
                              'es-CO',
                              { day: 'numeric', month: 'short' },
                            )
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {tr.trialEndsAt
                          ? new Date(tr.trialEndsAt).toLocaleDateString(
                              'es-CO',
                              { day: 'numeric', month: 'short' },
                            )
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">
                        {tr.daysLeft !== null ? (
                          tr.status === 'TRIAL_ACTIVE' ? (
                            <span className="text-brand">{tr.daysLeft}</span>
                          ) : (
                            <span className="text-mute">{tr.daysLeft}</span>
                          )
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`badge ${badge.cls}`}>
                          {t(badge.labelKey)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/tenants/${tr.id}`}
                          className="text-brand text-xs hover:underline"
                        >
                          {t('viewArrow')}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[11px] text-mute mt-3">
        {t('footnote')}
      </p>
    </div>
  );
}

/** Política de pruebas gratuitas cuando una marca blanca no tiene créditos.
 *  0 = bloquear trials · N = tope de días. Editable solo por super admin. */
function TrialPolicyCard() {
  const [days, setDays] = useState<string>('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ maxTrialDaysNoCredits: number }>('/admin/trial-policy')
      .then((r) => {
        setDays(String(r?.maxTrialDaysNoCredits ?? 7));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function save() {
    const n = Math.max(0, Math.min(365, Math.floor(Number(days) || 0)));
    setSaving(true);
    try {
      await api('/admin/trial-policy', {
        method: 'PATCH',
        body: JSON.stringify({ maxTrialDaysNoCredits: n }),
      });
      setDays(String(n));
      toast('Política de pruebas actualizada', 'success');
    } catch (e: any) {
      toast(e?.message ?? 'Error al guardar', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return null;

  return (
    <div className="card card-pad mb-5">
      <h2 className="text-base font-semibold m-0">Política de pruebas gratuitas</h2>
      <p className="text-[13px] text-mute mt-1 mb-3">
        Tope de días de prueba cuando una marca blanca <b>no tiene créditos</b>{' '}
        disponibles. <b>0 = bloquear</b> (no puede activar pruebas). Marcas con
        créditos o ilimitadas no se ven afectadas.
      </p>
      <div className="flex items-end gap-3">
        <div>
          <label className="text-[11px] uppercase tracking-wider text-mute font-semibold block mb-1">
            Máx. días sin créditos
          </label>
          <input
            type="number"
            min={0}
            max={365}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="input w-32"
          />
        </div>
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: number | string;
  accent: 'ok' | 'warn' | 'bad' | 'brand';
  hint?: string;
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
      {hint && <div className="text-[10px] text-mute mt-1">{hint}</div>}
    </div>
  );
}
