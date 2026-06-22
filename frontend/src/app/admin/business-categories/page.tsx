'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { api } from '@/lib/api';
import {
  BUSINESS_CATEGORIES,
  type BusinessModule,
} from '@/lib/business-categories';

const MODULE_INFO: Record<BusinessModule, { emoji: string; labelKey: string }> =
  {
    cards: { emoji: '💳', labelKey: 'moduleCards' },
    customers: { emoji: '👥', labelKey: 'moduleCustomers' },
    scanner: { emoji: '🔍', labelKey: 'moduleScanner' },
    push: { emoji: '🔔', labelKey: 'modulePush' },
    menu: { emoji: '📋', labelKey: 'moduleMenu' },
    orders: { emoji: '🛒', labelKey: 'moduleOrders' },
    analytics: { emoji: '📊', labelKey: 'moduleAnalytics' },
    staff: { emoji: '👤', labelKey: 'moduleStaff' },
    info_links: { emoji: '🔗', labelKey: 'moduleInfoLinks' },
    services: { emoji: '🛠', labelKey: 'moduleServices' },
  };

type CategoryCounts = Record<string, number>;

export default function BusinessCategoriesPage() {
  const t = useTranslations('admin_business_categories');
  const [counts, setCounts] = useState<CategoryCounts>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<any[]>('/tenants')
      .then((tenants) => {
        const c: CategoryCounts = {};
        for (const tn of tenants) {
          const slug = tn.businessCategorySlug ?? '_unset';
          c[slug] = (c[slug] ?? 0) + 1;
        }
        setCounts(c);
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          {t('title')}{' '}
          <span className="page-crumb">
            / {t('available', { count: BUSINESS_CATEGORIES.length })}
          </span>
        </h1>
      </div>

      <div className="card card-pad mb-5">
        <h3 className="text-base font-semibold m-0 flex items-center gap-2">
          🎯 {t('panelCustomizationTitle')}
        </h3>
        <p className="text-sm text-mute mt-2 leading-relaxed">
          {t.rich('panelCustomizationDesc', {
            autolavado: (chunks) => <b>{chunks}</b>,
            cafeteria: (chunks) => <b>{chunks}</b>,
            code: (chunks) => (
              <code className="text-xs bg-bg2 px-1.5 py-0.5 rounded">
                {chunks}
              </code>
            ),
          })}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {BUSINESS_CATEGORIES.map((c) => (
          <div key={c.slug} className="card card-pad flex flex-col">
            <div className="flex items-start gap-3">
              <div className="text-3xl flex-none">{c.emoji}</div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold leading-tight">{c.name}</div>
                <div className="text-[10px] uppercase tracking-wider text-mute font-mono mt-0.5">
                  {c.slug}
                </div>
              </div>
              {counts[c.slug] > 0 && (
                <span
                  className="badge badge-info text-[10px]"
                  title={t('businessesInCategory', { count: counts[c.slug] })}
                >
                  {counts[c.slug]}
                </span>
              )}
            </div>
            <p className="text-xs text-mute mt-2 leading-relaxed">
              {c.description}
            </p>
            <div className="mt-3 pt-3 border-t border-line2">
              <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1.5">
                {t('enabledModules')}
              </div>
              <div className="flex flex-wrap gap-1">
                {c.modules.map((m) => (
                  <span
                    key={m}
                    className="text-[10px] bg-bg2 text-ink px-1.5 py-0.5 rounded font-medium"
                    title={t(MODULE_INFO[m].labelKey)}
                  >
                    {MODULE_INFO[m].emoji} {t(MODULE_INFO[m].labelKey)}
                  </span>
                ))}
              </div>
              <div className="text-[10px] text-mute mt-2">
                {t('catalogItemInSidebar')}{' '}
                <b className="text-ink">
                  {c.catalogLabel === 'services'
                    ? t('catalogLabelServices')
                    : c.catalogLabel === 'catalog'
                    ? t('catalogLabelCatalog')
                    : t('catalogLabelMenu')}
                </b>
              </div>
            </div>
          </div>
        ))}
      </div>

      {!loading && counts['_unset'] > 0 && (
        <div className="mt-5 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          {t.rich('unsetWarning', {
            count: counts['_unset'],
            b: (chunks) => <b>{chunks}</b>,
            code: (chunks) => <code>{chunks}</code>,
          })}{' '}
          <Link href="/admin/tenants" className="underline">
            {t('reviewTenants')}
          </Link>
        </div>
      )}
    </div>
  );
}
