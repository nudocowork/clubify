'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { downloadFile } from '@/lib/api';

type Order = {
  id: string;
  code: string;
  status: 'PENDING' | 'CONFIRMED' | 'READY' | 'DELIVERED' | 'CANCELLED';
  createdAt: string;
  total: number | string;
  fulfillment: string | null;
  items?: unknown[];
  customer?: { fullName: string | null; phone: string | null; email?: string | null } | null;
};

const STATUS_CLS: Record<Order['status'], string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  CONFIRMED: 'bg-blue-100 text-blue-800',
  READY: 'bg-indigo-100 text-indigo-800',
  DELIVERED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-red-100 text-red-800',
};

type Location = {
  id: string;
  name: string;
  isActive: boolean;
};

export default function OrdersHistoryPage() {
  const t = useTranslations('app_orders_history');
  const locale = useLocale();
  const [rows, setRows] = useState<Order[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  // Filtro por sede (solo tenants multi-sede). '' = todas las sedes.
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState('');

  const qs = useCallback(() => {
    const p = new URLSearchParams();
    if (search.trim()) p.set('search', search.trim());
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (status) p.set('status', status);
    if (locationId) p.set('locationId', locationId);
    const s = p.toString();
    return s ? `?${s}` : '';
  }, [search, from, to, status, locationId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<Order[]>(`/orders${qs()}`);
      setRows(data ?? []);
    } catch (e: any) {
      toast(e?.message ?? t('loadError'), 'error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [qs]);

  // Carga inicial (pedidos recientes).
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sedes activas del tenant para el filtro (solo se muestra si hay ≥2).
  useEffect(() => {
    api<Location[]>('/locations')
      .then((ls) => setLocations((ls ?? []).filter((l) => l.isActive)))
      .catch(() => setLocations([]));
  }, []);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-mute text-sm mt-1">{t('intro')}</p>
        </div>
        <Link href="/app/orders" className="btn-ghost text-sm">
          {t('backToBoard')}
        </Link>
      </div>

      {/* Filtros */}
      <form
        className="card card-pad mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <div className="flex-1 min-w-[200px]">
          <label className="label">{t('searchLabel')}</label>
          <div className="flex items-center gap-2 bg-white border border-line rounded-input px-3 py-2 mt-1">
            <Icon name="search" size={14} className="text-mute" />
            <input
              className="border-0 outline-none text-sm w-full bg-transparent"
              placeholder={t('searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="label">{t('from')}</label>
          <input
            type="date"
            className="input mt-1"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="label">{t('to')}</label>
          <input
            type="date"
            className="input mt-1"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div>
          <label className="label">{t('status')}</label>
          <select
            className="input mt-1"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">{t('allStatuses')}</option>
            <option value="PENDING">{t('statusPENDING')}</option>
            <option value="CONFIRMED">{t('statusCONFIRMED')}</option>
            <option value="READY">{t('statusREADY')}</option>
            <option value="DELIVERED">{t('statusDELIVERED')}</option>
            <option value="CANCELLED">{t('statusCANCELLED')}</option>
          </select>
        </div>
        {locations.length >= 2 && (
          <div>
            <label className="label">{t('location')}</label>
            <select
              className="input mt-1"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">{t('allLocations')}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <button type="submit" className="btn-primary text-sm" disabled={loading}>
          {loading ? t('searching') : t('search')}
        </button>
        <button
          type="button"
          className="btn-ghost text-sm"
          title={t('downloadCsv')}
          onClick={() =>
            downloadFile(
              `/orders/export.csv${qs()}`,
              `${t('csvFileName')}-${new Date().toISOString().slice(0, 10)}.csv`,
            )
          }
        >
          ⤓ CSV
        </button>
      </form>

      {/* Resultados */}
      <div className="card overflow-hidden">
        {rows === null ? (
          <div className="p-8 text-center text-mute text-sm">{t('loading')}</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-mute text-sm">
            {t('noResults')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-mute border-b border-line2">
                  <th className="px-4 py-2.5 font-semibold">{t('colCode')}</th>
                  <th className="px-4 py-2.5 font-semibold">{t('colDate')}</th>
                  <th className="px-4 py-2.5 font-semibold">{t('colCustomer')}</th>
                  <th className="px-4 py-2.5 font-semibold">{t('colPhone')}</th>
                  <th className="px-4 py-2.5 font-semibold">{t('colType')}</th>
                  <th className="px-4 py-2.5 font-semibold">{t('colStatus')}</th>
                  <th className="px-4 py-2.5 font-semibold text-right">{t('colTotal')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const estadoCls = STATUS_CLS[o.status];
                  return (
                    <tr
                      key={o.id}
                      className="border-b border-line2/60 hover:bg-bg2/40"
                    >
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/app/orders/${o.id}`}
                          className="font-mono font-semibold text-brand hover:underline"
                        >
                          {o.code}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-mute whitespace-nowrap">
                        {new Date(o.createdAt).toLocaleString(locale, {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-2.5">{o.customer?.fullName ?? '—'}</td>
                      <td className="px-4 py-2.5 text-mute">{o.customer?.phone ?? '—'}</td>
                      <td className="px-4 py-2.5 text-mute">
                        {o.fulfillment
                          ? t(`fulfillment${o.fulfillment}` as any)
                          : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${estadoCls}`}>
                          {t(`status${o.status}` as any)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold">
                        ${Math.round(Number(o.total)).toLocaleString('es-CO')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows && rows.length >= 200 && (
          <div className="p-3 text-center text-[11px] text-mute border-t border-line2">
            {t('capped')}
          </div>
        )}
      </div>
    </div>
  );
}
