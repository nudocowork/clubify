'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type Dup = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
  totalOrdersCount: number;
  totalOrdersAmount: number;
  lastOrderAt: string | null;
  _count: { passes: number; stamps: number; orders: number };
};

type Group = {
  reason: 'phone' | 'email';
  key: string;
  customers: Dup[];
};

type Resp = { total: number; groups: Group[] };

const REASON_EMOJI = { phone: '📞', email: '✉️' } as const;

function COP(n: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

function fmtDate(s: string | null, locale: string) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

export default function DuplicatesPage() {
  const t = useTranslations('app_duplicates');
  const locale = useLocale();
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  // Por grupo: id del que se conserva (default = más antiguo)
  const [keepers, setKeepers] = useState<Record<string, string>>({});
  const [merging, setMerging] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const r: Resp = await api('/customers/duplicates');
      setData(r);
      const k: Record<string, string> = {};
      for (const g of r.groups) {
        // Default: el más antiguo (primero en el array, ya viene ordenado asc)
        k[g.key] = g.customers[0].id;
      }
      setKeepers(k);
    } catch (e: any) {
      toast(e.message || t('loadError'), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function doMerge(group: Group) {
    const keepId = keepers[group.key];
    const mergeIds = group.customers
      .filter((c) => c.id !== keepId)
      .map((c) => c.id);
    if (mergeIds.length === 0) return;

    const keeper = group.customers.find((c) => c.id === keepId);
    const others = group.customers.filter((c) => c.id !== keepId);
    const ok = window.confirm(
      t('confirmMerge', {
        count: others.length,
        keeper: keeper?.fullName ?? '',
      }),
    );
    if (!ok) return;

    setMerging(group.key);
    try {
      const res = await api('/customers/merge', {
        method: 'POST',
        body: JSON.stringify({ keepId, mergeIds }),
      });
      toast(
        t('merged', { orders: res.movedOrders, stamps: res.movedStamps }),
        'success',
      );
      await load();
    } catch (e: any) {
      toast(e.message || t('mergeError'), 'error');
    } finally {
      setMerging(null);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">
            {t('title')}{' '}
            {data && (
              <span className="page-crumb">
                /{' '}
                {data.total === 1
                  ? t('groupCrumb', { count: data.total })
                  : t('groupsCrumb', { count: data.total })}
              </span>
            )}
          </h1>
          <p className="text-mute text-sm mt-1">{t('intro')}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/app/customers" className="btn-ghost text-xs">
            {t('backToCustomers')}
          </Link>
          <button onClick={load} className="btn-ghost text-xs">
            {t('refresh')}
          </button>
        </div>
      </div>

      {loading && (
        <div className="card card-pad text-mute text-sm">{t('searching')}</div>
      )}

      {!loading && data && data.total === 0 && (
        <div className="card card-pad text-center py-12">
          <div className="text-5xl mb-3">✨</div>
          <h3 className="font-semibold text-lg mb-1">{t('noneTitle')}</h3>
          <p className="text-mute text-sm max-w-md mx-auto">{t('noneBody')}</p>
          <Link
            href="/app/customers"
            className="btn-primary mt-6 inline-flex"
          >
            {t('backToCustomers')}
          </Link>
        </div>
      )}

      {!loading &&
        data &&
        data.groups.map((g) => {
          const emoji = REASON_EMOJI[g.reason];
          const keepId = keepers[g.key];
          const isMerging = merging === g.key;
          return (
            <div key={g.key} className="card mb-4">
              <div className="px-4 py-3 border-b border-line flex items-center justify-between bg-bg2/50">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{emoji}</span>
                  <span className="text-sm font-medium">
                    {g.reason === 'phone' ? t('reasonPhone') : t('reasonEmail')}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-mute bg-white px-2 py-0.5 rounded-full border border-line">
                    {t('customersCount', { count: g.customers.length })}
                  </span>
                </div>
                <button
                  className="btn-primary text-xs"
                  disabled={isMerging}
                  onClick={() => doMerge(g)}
                >
                  {isMerging ? t('merging') : t('mergeGroup')}
                </button>
              </div>
              <div className="divide-y divide-line">
                {g.customers.map((c) => {
                  const isKeeper = c.id === keepId;
                  return (
                    <label
                      key={c.id}
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition ${
                        isKeeper ? 'bg-brand/5' : 'hover:bg-bg2/40'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`keep-${g.key}`}
                        checked={isKeeper}
                        onChange={() =>
                          setKeepers((prev) => ({ ...prev, [g.key]: c.id }))
                        }
                        className="accent-brand"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link
                            href={`/app/customers/${c.id}`}
                            target="_blank"
                            className="font-medium text-ink hover:text-brand truncate"
                          >
                            {c.fullName}
                          </Link>
                          {isKeeper && (
                            <span className="text-[10px] font-semibold uppercase tracking-wide bg-brand text-white px-2 py-0.5 rounded-full">
                              {t('keep')}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-mute mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
                          {c.email && <span>✉️ {c.email}</span>}
                          {c.phone && <span>📞 {c.phone}</span>}
                          <span>{t('since', { date: fmtDate(c.createdAt, locale) })}</span>
                        </div>
                      </div>
                      <div className="text-right text-xs text-mute hidden sm:block">
                        <div>
                          {t('ordersAndTotal', {
                            count: c._count.orders,
                            total: COP(c.totalOrdersAmount),
                          })}
                        </div>
                        <div>
                          {t('passesAndStamps', {
                            passes: c._count.passes,
                            stamps: c._count.stamps,
                          })}
                        </div>
                        <div>
                          {t('lastOrder', {
                            date: fmtDate(c.lastOrderAt, locale),
                          })}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
              <div className="px-4 py-2 text-[11px] text-mute bg-bg2/30 border-t border-line">
                {t('tip')}
              </div>
            </div>
          );
        })}
    </div>
  );
}
