'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

type Use = {
  id: string;
  status: 'SIGNED_UP' | 'ACTIVE' | 'PAYING' | 'CHURNED';
  createdAt: string;
  convertedAt: string | null;
  tenantBrand: string | null;
  tenantStatus: string | null;
  commissionsTotal: number;
};

type CodeRow = {
  id: string;
  code: string;
  commissionPercent: number;
  isActive: boolean;
  createdAt: string;
  shareLink: string;
  usesCount: number;
  convertedCount: number;
  uses: Use[];
};

type MyReferrals = {
  codes: CodeRow[];
  totals: {
    signedUp: number;
    converted: number;
    paidUsd: number;
    pendingUsd: number;
  };
};

const STATUS_LABEL_KEY: Record<Use['status'], { labelKey: string; cls: string }> = {
  SIGNED_UP: { labelKey: 'statusSignedUp', cls: 'bg-bg2 text-mute' },
  ACTIVE: { labelKey: 'statusActive', cls: 'bg-amber-100 text-amber-800' },
  PAYING: { labelKey: 'statusPaying', cls: 'bg-ok-soft text-ok' },
  CHURNED: { labelKey: 'statusChurned', cls: 'bg-red-100 text-red-800' },
};

export default function TenantReferrals() {
  const t = useTranslations('app_referrals');
  const [data, setData] = useState<MyReferrals | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<MyReferrals>('/referrals/me')
      .then(setData)
      .catch(() => setData({ codes: [], totals: { signedUp: 0, converted: 0, paidUsd: 0, pendingUsd: 0 } }))
      .finally(() => setLoading(false));
  }, []);

  function copyLink(link: string) {
    try {
      navigator.clipboard.writeText(link);
      toast(t('linkCopied'), 'success');
    } catch {
      toast(t('linkCopyFailed'), 'error');
    }
  }

  if (loading) return <div className="text-mute">{t('loading')}</div>;

  const totals = data!.totals;
  const codes = data!.codes;

  return (
    <div className="max-w-4xl">
      <div className="page-head">
        <h1 className="page-title">{t('pageTitle')}</h1>
        <p className="text-mute text-sm mt-1 leading-relaxed">
          {t.rich('intro', {
            b: (chunks) => <b className="text-brand">{chunks}</b>,
            br: () => <br />,
          })}
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Kpi label={t('kpiSignedUp')} value={totals.signedUp} accent="brand" />
        <Kpi label={t('kpiPaying')} value={totals.converted} accent="ok" />
        <Kpi
          label={t('kpiCommissionPaid')}
          value={`USD ${totals.paidUsd.toFixed(2)}`}
          accent="ok"
        />
        <Kpi
          label={t('kpiCommissionPending')}
          value={`USD ${totals.pendingUsd.toFixed(2)}`}
          accent="amber"
        />
      </div>

      {codes.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-4">
          {codes.map((c) => (
            <div key={c.id} className="card card-pad">
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
                    {t('yourCode')}
                  </div>
                  <div className="font-mono text-2xl font-bold mt-0.5">
                    {c.code}
                  </div>
                  <div className="text-xs text-mute mt-1">
                    {t('createdOn', {
                      date: new Date(c.createdAt).toLocaleDateString('es-CO', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      }),
                      percent: c.commissionPercent,
                    })}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-mute">{t('labelSignedUp')}</span>
                    <span className="font-semibold">{c.usesCount}</span>
                    <span className="text-mute">·</span>
                    <span className="text-mute">{t('labelPaying')}</span>
                    <span className="font-semibold text-ok">
                      {c.convertedCount}
                    </span>
                  </div>
                  <button
                    onClick={() => copyLink(c.shareLink)}
                    className="btn-ghost text-xs"
                  >
                    <Icon name="check" size={12} /> {t('copyLink')}
                  </button>
                </div>
              </div>

              <div className="mt-3 rounded-lg bg-bg2 px-3 py-2 text-xs font-mono text-mute break-all">
                {c.shareLink}
              </div>

              {c.uses.length > 0 && (
                <details className="mt-3">
                  <summary className="text-xs text-brand cursor-pointer hover:underline">
                    {t('viewDetail', { count: c.uses.length })}
                  </summary>
                  <div className="mt-2 space-y-1.5 text-xs">
                    {c.uses.map((u) => {
                      const meta = STATUS_LABEL_KEY[u.status];
                      return (
                        <div
                          key={u.id}
                          className="flex items-center justify-between gap-2 px-3 py-2 rounded bg-bg2/60"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate">
                              {u.tenantBrand ?? t('tenantPending')}
                            </div>
                            <div className="text-[10px] text-mute">
                              {new Date(u.createdAt).toLocaleDateString('es-CO')}
                            </div>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${meta.cls}`}
                          >
                            {t(meta.labelKey)}
                          </span>
                          {u.commissionsTotal > 0 && (
                            <span className="text-[11px] text-ok font-semibold">
                              USD {u.commissionsTotal.toFixed(2)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}
            </div>
          ))}

          <div className="card card-pad text-center">
            <div className="font-semibold mb-1">{t('wantAnotherCode')}</div>
            <p className="text-sm text-mute mb-3">
              {t('wantAnotherCodeDesc')}
            </p>
            <Link
              href="/refer"
              target="_blank"
              className="btn-primary inline-flex"
            >
              <Icon name="spark" /> {t('generateNewCode')}
            </Link>
          </div>
        </div>
      )}

      <div className="mt-6 text-xs text-mute text-center">
        {t.rich('payoutFooter', {
          a: (chunks) => (
            <a
              href="https://wa.me/573167689240"
              target="_blank"
              className="text-brand hover:underline"
            >
              {chunks}
            </a>
          ),
        })}
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent: 'brand' | 'ok' | 'amber';
}) {
  const colorMap: Record<string, string> = {
    brand: 'text-brand',
    ok: 'text-ok',
    amber: 'text-amber-700',
  };
  return (
    <div className="card p-4">
      <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
        {label}
      </div>
      <div className={`text-xl font-bold mt-1 ${colorMap[accent]}`}>
        {value}
      </div>
    </div>
  );
}

function EmptyState() {
  const t = useTranslations('app_referrals');
  return (
    <div className="card card-pad bg-gradient-to-br from-brand-400 to-brand-700 text-white">
      <div className="text-2xl font-bold">{t('emptyTitle')}</div>
      <p className="text-white/85 leading-relaxed mt-2">
        {t.rich('emptyDesc', {
          b: (chunks) => <b>{chunks}</b>,
        })}
      </p>
      <ul className="mt-4 space-y-1.5 text-sm text-white/90">
        <li>{t('emptyBullet1')}</li>
        <li>{t('emptyBullet2')}</li>
        <li>
          {t.rich('emptyBullet3', {
            code: (chunks) => <code>{chunks}</code>,
          })}
        </li>
      </ul>
      <Link
        href="/refer"
        target="_blank"
        className="inline-flex items-center gap-2 mt-5 bg-white text-brand-700 font-semibold px-5 py-2.5 rounded-pill text-sm hover:bg-white/95"
      >
        <Icon name="spark" /> {t('emptyCta')}
      </Link>
    </div>
  );
}
