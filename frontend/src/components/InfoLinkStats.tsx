'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/Icon';

type Overview = {
  range: string;
  links: number;
  activeLinks: number;
  views: number;
  clicks: number;
  qrScans: number;
  whatsappClicks: number;
  topButton: { label: string; count: number } | null;
  topButtons: { label: string; count: number }[];
  totalViewsAllTime: number;
  perLink: { id: string; title: string; slug: string; isActive: boolean; views: number }[];
};

const Kpi = ({
  label,
  value,
  sub,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon: Parameters<typeof Icon>[0]['name'];
  tone?: 'neutral' | 'ok' | 'brand' | 'info';
}) => {
  const cls = {
    neutral: { l: 'text-mute', v: 'text-ink' },
    ok: { l: 'text-ok', v: 'text-ok' },
    brand: { l: 'text-brand', v: 'text-brand' },
    info: { l: 'text-info', v: 'text-info' },
  }[tone];
  return (
    <div className="kpi">
      <div className="kpi-top">
        <div className={`kpi-lbl ${cls.l}`}>
          <Icon name={icon} size={14} /> {label}
        </div>
      </div>
      <div className={`kpi-val ${cls.v}`}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
};

/**
 * Estadísticas del negocio "Solo InfoLink". Usa /info-links/overview (últimos
 * 30 días): visitas, clics, escaneos QR, WhatsApp abiertos y botón más usado.
 *  - variant="dashboard": KPIs + accesos rápidos (para /app).
 *  - variant="full": KPIs + top botones + tabla por InfoLink (para /app/estadisticas).
 */
export function InfoLinkStats({ variant }: { variant: 'dashboard' | 'full' }) {
  const t = useTranslations('infolink_stats');
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Overview>('/info-links/overview')
      .then(setData)
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  const topLabel = data?.topButton?.label ?? '—';

  return (
    <div>
      <div className="grid gap-3.5 grid-cols-2 md:grid-cols-4 mb-6">
        <Kpi label={t('visits')} value={loading ? '…' : data?.views ?? 0} sub={t('last30')} icon="trend-up" tone="brand" />
        <Kpi label={t('buttonClicks')} value={loading ? '…' : data?.clicks ?? 0} sub={t('last30')} icon="spark" tone="info" />
        <Kpi label={t('qrScans')} value={loading ? '…' : data?.qrScans ?? 0} sub={t('last30')} icon="qr" tone="neutral" />
        <Kpi label={t('whatsappOpened')} value={loading ? '…' : data?.whatsappClicks ?? 0} sub={t('last30')} icon="send" tone="ok" />
      </div>

      <div className="grid gap-3.5 grid-cols-1 md:grid-cols-3 mb-6">
        <Kpi label={t('topButton')} value={loading ? '…' : topLabel} sub={data?.topButton ? t('clicksCount', { count: data.topButton.count }) : t('noClicksYet')} icon="check" tone="brand" />
        <Kpi label={t('activeInfoLinks')} value={loading ? '…' : `${data?.activeLinks ?? 0} / ${data?.links ?? 0}`} sub={t('published')} icon="grid" tone="neutral" />
        <Kpi label={t('allTimeVisits')} value={loading ? '…' : data?.totalViewsAllTime ?? 0} sub={t('allTimeTotal')} icon="history" tone="info" />
      </div>

      {variant === 'dashboard' && (
        <div className="flex flex-wrap gap-2 mb-2">
          <Link href="/app/info-links" className="btn-primary">
            <Icon name="edit" /> Editar mi InfoLink
          </Link>
          <Link href="/app/marketing/qr-infolink" className="btn-ghost">
            <Icon name="qr" /> Ver QR
          </Link>
          <Link href="/app/estadisticas" className="btn-ghost">
            <Icon name="history" /> Ver estadísticas
          </Link>
        </div>
      )}

      {variant === 'full' && (
        <>
          {/* Top botones */}
          <h2 className="text-xs uppercase tracking-[0.18em] text-mute font-semibold mb-2.5">
            {t('topButtons')}
          </h2>
          <div className="card card-pad mb-6">
            {!data || data.topButtons.length === 0 ? (
              <div className="text-sm text-mute">{t('noClicks')}</div>
            ) : (
              <div className="space-y-2">
                {data.topButtons.map((b) => {
                  const max = data.topButtons[0]?.count || 1;
                  const pct = Math.round((b.count / max) * 100);
                  return (
                    <div key={b.label} className="flex items-center gap-3">
                      <div className="w-40 shrink-0 truncate text-sm text-ink">{b.label}</div>
                      <div className="flex-1 h-2 rounded-full bg-bg2 overflow-hidden">
                        <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="w-12 text-right text-sm font-semibold text-ink">{b.count}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Por InfoLink */}
          <h2 className="text-xs uppercase tracking-[0.18em] text-mute font-semibold mb-2.5">
            Por InfoLink
          </h2>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-mute border-b border-line">
                  <th className="px-4 py-2.5 font-medium">InfoLink</th>
                  <th className="px-4 py-2.5 font-medium">Estado</th>
                  <th className="px-4 py-2.5 font-medium text-right">Visitas</th>
                  <th className="px-4 py-2.5 font-medium text-right"></th>
                </tr>
              </thead>
              <tbody>
                {(!data || data.perLink.length === 0) && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-mute">
                      {t('noneCreated')}{' '}
                      <Link href="/app/info-links" className="text-brand font-semibold">
                        {t('createOne')}
                      </Link>
                    </td>
                  </tr>
                )}
                {data?.perLink.map((l) => (
                  <tr key={l.id} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-ink truncate max-w-[240px]">{l.title || l.slug}</td>
                    <td className="px-4 py-2.5">
                      {l.isActive ? (
                        <span className="badge badge-ok">Activa</span>
                      ) : (
                        <span className="badge">Borrador</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{l.views}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Link href={`/app/info-links/${l.id}`} className="text-brand font-semibold">Editar</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
