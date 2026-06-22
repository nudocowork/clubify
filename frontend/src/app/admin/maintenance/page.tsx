'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

type Level = 'ok' | 'warn' | 'crit';

type Snapshot = {
  generatedAt: string;
  db: {
    bytes: number;
    pretty: string;
    topTables: { name: string; bytes: number; pretty: string; rows: number }[];
  };
  process: {
    uptimeSeconds: number;
    nodeVersion: string;
    memory: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
    };
    env: string;
  };
  counts: {
    tenants: number;
    tenantsActive: number;
    customers: number;
    products: number;
    orders30d: number;
    passes: number;
    stamps30d: number;
    audits30d: number;
  };
  storage: {
    provider: string;
    bucket: string;
    fileCount: number;
    avgBytesPerFile: number;
    estimateBytes: number;
    estimatePretty: string;
    breakdown: Record<string, number>;
  };
  jobs: { backlog: number };
  indicators: {
    database: { usedBytes: number; limitBytes: number; percent: number; level: Level };
    memory: { usedBytes: number; limitBytes: number; percent: number; level: Level };
    storage: { usedBytes: number; limitBytes: number; percent: number; level: Level };
    jobs: { backlog: number; level: Level };
  };
  recommendations: { level: 'info' | 'warn' | 'crit'; text: string }[];
};

function prettyBytes(b: number) {
  if (b < 1024) return `${b} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let n = b / 1024;
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 ? 2 : 1)} ${u[i]}`;
}

function uptimeText(sec: number) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${sec % 60}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return `${h}h ${remM}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function levelClasses(level: Level) {
  if (level === 'crit')
    return {
      bar: 'bg-red-500',
      text: 'text-red-700',
      bg: 'bg-red-50',
      border: 'border-red-200',
      labelKey: 'levelCrit',
      dot: 'bg-red-500',
    };
  if (level === 'warn')
    return {
      bar: 'bg-amber-500',
      text: 'text-amber-700',
      bg: 'bg-amber-50',
      border: 'border-amber-200',
      labelKey: 'levelWarn',
      dot: 'bg-amber-500',
    };
  return {
    bar: 'bg-emerald-500',
    text: 'text-emerald-700',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    labelKey: 'levelOk',
    dot: 'bg-emerald-500',
  };
}

export default function MaintenancePage() {
  const t = useTranslations('admin_maintenance');
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load(showSpinner = false) {
    if (showSpinner) setRefreshing(true);
    try {
      const data = await api<Snapshot>('/admin/system-health');
      setSnap(data);
    } catch (e: any) {
      toast(e.message || t('errorLoadingMetrics'), 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
    // Auto-refresh cada 30s para vista tipo SaaS dashboard
    const timer = setInterval(() => load(false), 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          {t('pageTitle')}{' '}
          <span className="page-crumb">
            {t('pageCrumb')}
          </span>
        </h1>
        <div className="flex items-center gap-2">
          {snap && (
            <span className="text-xs text-mute">
              {t('updatedAt', {
                time: new Date(snap.generatedAt).toLocaleTimeString('es-CO'),
              })}
            </span>
          )}
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="btn-ghost"
            title={t('refreshNow')}
          >
            <Icon name="history" /> {refreshing ? t('loadingShort') : t('refresh')}
          </button>
        </div>
      </div>

      {/* Toggle de modo mantenimiento — sobre toda la plataforma. */}
      <MaintenanceToggleCard />

      {loading && !snap && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card card-pad">
              <div className="h-5 bg-bg2 rounded w-1/2 animate-shimmer" />
              <div className="mt-3 h-3 bg-bg2 rounded animate-shimmer" />
              <div className="mt-2 h-3 bg-bg2 rounded w-2/3 animate-shimmer" />
            </div>
          ))}
        </div>
      )}

      {snap && (
        <>
          {/* Indicadores principales (semáforo) */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            <CapacityCard
              icon="🗄"
              title={t('cardDatabaseTitle')}
              subtitle={t('cardDatabaseSubtitle', { size: snap.db.pretty })}
              percent={snap.indicators.database.percent}
              level={snap.indicators.database.level}
              limitText={t('cardCapacity', {
                value: prettyBytes(snap.indicators.database.limitBytes),
              })}
            />
            <CapacityCard
              icon="🧠"
              title={t('cardMemoryTitle')}
              subtitle={`${prettyBytes(snap.indicators.memory.usedBytes)} / ${prettyBytes(snap.indicators.memory.limitBytes)}`}
              percent={snap.indicators.memory.percent}
              level={snap.indicators.memory.level}
              limitText={t('cardRss', {
                value: prettyBytes(snap.process.memory.rss),
              })}
            />
            <CapacityCard
              icon="☁"
              title={t('cardStorageTitle')}
              subtitle={t('cardStorageSubtitle', {
                size: snap.storage.estimatePretty,
                files: snap.storage.fileCount,
              })}
              percent={snap.indicators.storage.percent}
              level={snap.indicators.storage.level}
              limitText={t('cardPlan', {
                value: prettyBytes(snap.indicators.storage.limitBytes),
              })}
            />
            <StatusCard
              icon="⚙"
              title={t('cardJobsTitle')}
              level={snap.indicators.jobs.level}
              valueText={snap.indicators.jobs.backlog.toString()}
              caption={t('cardJobsCaption')}
            />
          </div>

          {/* Recomendaciones */}
          {snap.recommendations.length > 0 && (
            <div className="card card-pad mb-6">
              <h3 className="text-base font-semibold m-0 mb-3 flex items-center gap-2">
                <span>💡</span> {t('autoRecommendations')}
              </h3>
              <div className="space-y-2">
                {snap.recommendations.map((r, i) => {
                  const cls =
                    r.level === 'crit'
                      ? 'bg-red-50 border-red-200 text-red-800'
                      : r.level === 'warn'
                      ? 'bg-amber-50 border-amber-200 text-amber-800'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-800';
                  const icon = r.level === 'crit' ? '🔴' : r.level === 'warn' ? '🟡' : '🟢';
                  return (
                    <div
                      key={i}
                      className={`border rounded-input px-3 py-2 text-sm flex items-start gap-2 ${cls}`}
                    >
                      <span>{icon}</span>
                      <div className="flex-1">{r.text}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Grid 2 columnas: tablas y contadores */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            <div className="card lg:col-span-2 overflow-hidden p-0">
              <div className="card-h">
                <h3 className="m-0">{t('topTablesTitle')}</h3>
                <span className="badge badge-mute text-[11px]">
                  {t('tablesCount', { count: snap.db.topTables.length })}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[520px]">
                  <thead className="bg-bg2">
                    <tr>
                      {[
                        t('thTable'),
                        t('thSize'),
                        t('thRows'),
                        t('thPercentTotal'),
                      ].map((h) => (
                        <th
                          key={h}
                          className="text-left px-4 py-2.5 text-[11px] uppercase tracking-[0.1em] text-mute font-semibold"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {snap.db.topTables.map((tbl) => {
                      const pct = snap.db.bytes > 0 ? (tbl.bytes / snap.db.bytes) * 100 : 0;
                      return (
                        <tr key={tbl.name} className="border-t border-line2">
                          <td className="px-4 py-2.5 font-mono text-xs">{tbl.name}</td>
                          <td className="px-4 py-2.5 font-medium">{tbl.pretty}</td>
                          <td className="px-4 py-2.5 text-mute text-xs">
                            {tbl.rows.toLocaleString('es-CO')}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 bg-bg2 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-brand"
                                  style={{ width: `${Math.min(pct, 100)}%` }}
                                />
                              </div>
                              <span className="text-xs text-mute w-10">
                                {pct.toFixed(1)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card card-pad">
              <h3 className="text-base font-semibold m-0 mb-3">{t('processTitle')}</h3>
              <dl className="text-sm space-y-2">
                <Row label={t('processUptime')} value={uptimeText(snap.process.uptimeSeconds)} />
                <Row label={t('processNode')} value={snap.process.nodeVersion} />
                <Row label={t('processEnv')} value={snap.process.env} />
                <Row label={t('processHeapUsed')} value={prettyBytes(snap.process.memory.heapUsed)} />
                <Row label={t('processHeapTotal')} value={prettyBytes(snap.process.memory.heapTotal)} />
                <Row label={t('processRss')} value={prettyBytes(snap.process.memory.rss)} />
              </dl>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Contadores de negocio */}
            <div className="card card-pad">
              <h3 className="text-base font-semibold m-0 mb-3">{t('countersTitle')}</h3>
              <div className="grid grid-cols-2 gap-2.5">
                <Stat label={t('statTenants')} value={snap.counts.tenants} />
                <Stat
                  label={t('statActive')}
                  value={snap.counts.tenantsActive}
                  tone="ok"
                />
                <Stat label={t('statCustomers')} value={snap.counts.customers} />
                <Stat label={t('statProducts')} value={snap.counts.products} />
                <Stat label={t('statOrders30d')} value={snap.counts.orders30d} tone="brand" />
                <Stat label={t('statWalletPasses')} value={snap.counts.passes} />
                <Stat label={t('statStamps30d')} value={snap.counts.stamps30d} />
                <Stat label={t('statAudit30d')} value={snap.counts.audits30d} />
              </div>
            </div>

            {/* Storage breakdown */}
            <div className="card card-pad">
              <h3 className="text-base font-semibold m-0 mb-1">{t('storageR2Title')}</h3>
              <div className="text-xs text-mute mb-3">
                {t.rich('storageR2Desc', {
                  bucket: snap.storage.bucket,
                  files: snap.storage.fileCount,
                  avg: prettyBytes(snap.storage.avgBytesPerFile),
                  mono: (chunks) => <span className="font-mono">{chunks}</span>,
                })}
              </div>
              <dl className="text-sm space-y-1.5">
                {Object.entries(snap.storage.breakdown).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-mute capitalize text-xs">
                      {k
                        .replace(/([A-Z])/g, ' $1')
                        .replace(/^./, (s) => s.toUpperCase())
                        .trim()}
                    </span>
                    <span className="font-medium">{v}</span>
                  </div>
                ))}
              </dl>
              <div className="border-t border-line2 mt-3 pt-3 flex justify-between font-semibold">
                <span>{t('totalEstimated')}</span>
                <span className="text-brand">{snap.storage.estimatePretty}</span>
              </div>
            </div>
          </div>

          <div className="text-center text-[11px] text-mute mt-4">
            {t('autoRefreshNote')}
          </div>
        </>
      )}
    </div>
  );
}

// ===============================================================
//                          subcomponentes
// ===============================================================

function CapacityCard({
  icon,
  title,
  subtitle,
  percent,
  level,
  limitText,
}: {
  icon: string;
  title: string;
  subtitle: string;
  percent: number;
  level: Level;
  limitText: string;
}) {
  const t = useTranslations('admin_maintenance');
  const c = levelClasses(level);
  return (
    <div className={`card card-pad border ${c.border}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-mute font-semibold flex items-center gap-1.5">
            <span>{icon}</span> {title}
          </div>
          <div className="text-base font-semibold mt-1">{subtitle}</div>
        </div>
        <span
          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full ${c.bg} ${c.text}`}
        >
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${c.dot}`}
          />
          {t(c.labelKey)}
        </span>
      </div>
      <div className="mt-3">
        <div className="flex justify-between text-xs text-mute mb-1">
          <span>{limitText}</span>
          <span className={`font-semibold ${c.text}`}>{percent.toFixed(1)}%</span>
        </div>
        <div className="w-full h-2 bg-bg2 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${c.bar}`}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function StatusCard({
  icon,
  title,
  level,
  valueText,
  caption,
}: {
  icon: string;
  title: string;
  level: Level;
  valueText: string;
  caption: string;
}) {
  const t = useTranslations('admin_maintenance');
  const c = levelClasses(level);
  return (
    <div className={`card card-pad border ${c.border}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-mute font-semibold flex items-center gap-1.5">
            <span>{icon}</span> {title}
          </div>
          <div className={`text-3xl font-bold mt-1 ${c.text}`}>{valueText}</div>
          <div className="text-xs text-mute mt-1">{caption}</div>
        </div>
        <span
          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full ${c.bg} ${c.text}`}
        >
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${c.dot}`}
          />
          {t(c.labelKey)}
        </span>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-line2 last:border-b-0 pb-1.5 last:pb-0">
      <dt className="text-mute">{label}</dt>
      <dd className="font-mono font-medium">{value}</dd>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'ok' | 'brand';
}) {
  const cls =
    tone === 'ok' ? 'text-ok' : tone === 'brand' ? 'text-brand' : 'text-ink';
  return (
    <div className="bg-bg2/50 rounded-input p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
        {label}
      </div>
      <div className={`text-xl font-bold ${cls}`}>
        {value.toLocaleString('es-CO')}
      </div>
    </div>
  );
}

type MaintenanceStatus = {
  enabled: boolean;
  message: string | null;
  until: string | null;
};

/**
 * Tarjeta de "Modo mantenimiento". Permite activar/desactivar el flag
 * global que bloquea a TODOS los clientes (excepto SUPER_ADMIN) mientras
 * el sistema se actualiza. El SUPER_ADMIN sigue navegando normal y puede
 * desactivar desde aquí cuando termina el deploy.
 */
function MaintenanceToggleCard() {
  const t = useTranslations('admin_maintenance');
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [untilLocal, setUntilLocal] = useState('');

  async function load() {
    try {
      const s = await api<MaintenanceStatus>('/admin/maintenance');
      setStatus(s);
      setMessage(s.message ?? '');
      if (s.until) {
        const d = new Date(s.until);
        if (!Number.isNaN(d.getTime())) {
          const pad = (n: number) => String(n).padStart(2, '0');
          setUntilLocal(
            `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
              d.getDate(),
            )}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
          );
        }
      } else {
        setUntilLocal('');
      }
    } catch (e: any) {
      toast(e?.message || t('errorLoadStatus'), 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function save(nextEnabled: boolean) {
    if (nextEnabled && !confirm(t('confirmActivate'))) return;
    setSaving(true);
    try {
      let untilIso: string | null = null;
      if (untilLocal.trim()) {
        const d = new Date(untilLocal);
        if (!Number.isNaN(d.getTime())) untilIso = d.toISOString();
      }
      const next = await api<MaintenanceStatus>('/admin/maintenance', {
        method: 'PATCH',
        body: JSON.stringify({
          enabled: nextEnabled,
          message: message.trim() || null,
          until: untilIso,
        }),
      });
      setStatus(next);
      toast(
        nextEnabled
          ? t('toastActivated')
          : t('toastDeactivated'),
        'success',
      );
    } catch (e: any) {
      toast(e?.message || t('errorSave'), 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="card card-pad mb-5">
        <div className="h-5 bg-bg2 rounded w-1/2 animate-shimmer" />
      </div>
    );
  }

  const enabled = status?.enabled ?? false;

  return (
    <div
      className={`card card-pad mb-5 border-2 ${
        enabled ? 'border-amber-400 bg-amber-50/40' : 'border-line'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="text-3xl flex-none">{enabled ? '🛠' : '✅'}</div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold m-0 flex items-center gap-2">
            {t('maintenanceModeTitle')}{' '}
            {enabled ? (
              <span className="badge badge-warn text-[10px]">{t('badgeActive')}</span>
            ) : (
              <span className="badge badge-info text-[10px]">{t('badgeOff')}</span>
            )}
          </h2>
          <p className="text-sm text-mute mt-2 leading-relaxed">
            {enabled ? t('maintenanceDescOn') : t('maintenanceDescOff')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
        <div>
          <label className="label">{t('clientMessageLabel')}</label>
          <textarea
            className="input"
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('clientMessagePlaceholder')}
            maxLength={500}
          />
        </div>
        <div>
          <label className="label">{t('etaLabel')}</label>
          <input
            type="datetime-local"
            className="input"
            value={untilLocal}
            onChange={(e) => setUntilLocal(e.target.value)}
          />
          <div className="text-[11px] text-mute mt-1 leading-relaxed">
            {t('etaHint')}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-line2">
        {enabled ? (
          <button
            onClick={() => save(false)}
            disabled={saving}
            className="btn-primary"
          >
            {saving ? t('saving') : t('deactivateMaintenance')}
          </button>
        ) : (
          <>
            <button
              onClick={() => save(false)}
              disabled={saving}
              className="btn-ghost"
              title={t('saveDraftTitle')}
            >
              {t('saveDraft')}
            </button>
            <button
              onClick={() => save(true)}
              disabled={saving}
              className="btn-primary bg-amber-500 hover:bg-amber-600 border-amber-500"
            >
              {saving ? t('saving') : t('activateMaintenance')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
