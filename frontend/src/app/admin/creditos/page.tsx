'use client';
/**
 * /admin/creditos — Panel de créditos de la marca blanca (Fase 3 · #6/#7).
 *
 * El admin de una marca blanca ve sus créditos (1 crédito = 30 días de
 * servicio para un negocio), compra packs (links Hotmart configurados por
 * el PLATFORM_OWNER), y activa manualmente los negocios pendientes
 * consumiendo 1 crédito.
 *
 * Aislado por marca en el backend (user.whiteLabelId). Para admins
 * globales (Clubify) el endpoint da 403 → mostramos un aviso.
 */
import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type BuyLink = {
  id: string;
  credits: number;
  label: string;
  url: string;
  price: number | null;
  currency: string;
};

type Tx = {
  id: string;
  type: 'PURCHASE' | 'CONSUME' | 'COMMIT' | 'REFUND' | 'ADJUSTMENT';
  amount: number;
  note: string | null;
  tenantId: string | null;
  createdAt: string;
  refundedAt?: string | null;
};

// Ventana de reembolso (días) — debe coincidir con REFUND_WINDOW_DAYS del backend.
const REFUND_WINDOW_DAYS = 5;

type Credits = {
  whiteLabel: { id: string; name: string; slug: string };
  unlimited: boolean;
  available: number;
  committed: number;
  used: number;
  pendingTenants: number;
  buyLinks: BuyLink[];
  history: Tx[];
};

type Pending = {
  id: string;
  brandName: string;
  slug: string;
  status: string;
  reason: string;
  overdueDays: number;
  createdAt: string;
};

const TX_LABEL_KEY: Record<Tx['type'], string> = {
  PURCHASE: 'txPurchase',
  CONSUME: 'txConsume',
  COMMIT: 'txCommit',
  REFUND: 'txRefund',
  ADJUSTMENT: 'txAdjustment',
};

function Kpi({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  tone?: 'default' | 'good' | 'warn';
}) {
  const ring =
    tone === 'good'
      ? 'border-emerald-200 bg-emerald-50'
      : tone === 'warn'
        ? 'border-amber-200 bg-amber-50'
        : 'border-gray-200 bg-white';
  return (
    <div className={`rounded-2xl border ${ring} p-4`}>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-[12px] text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

export default function CreditsPage() {
  const t = useTranslations('admin_creditos');
  const [data, setData] = useState<Credits | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [refundingId, setRefundingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, p] = await Promise.all([
        api<Credits>('/admin/credits'),
        api<Pending[]>('/admin/credits/pending'),
      ]);
      setData(c);
      setPending(p ?? []);
    } catch (e: any) {
      if (e?.status === 403) setForbidden(true);
      else toast(e?.message ?? t('errorLoad'), 'error');
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function activate(item: Pending) {
    if (activatingId) return;
    if (!confirm(t('confirmActivate', { brand: item.brandName }))) return;
    setActivatingId(item.id);
    try {
      const res = await api<{ consumed: number; creditsAvailable: number }>(
        `/admin/credits/activate/${item.id}`,
        { method: 'POST' },
      );
      toast(
        res.consumed > 0
          ? t('activatedWithCredits', { credits: res.creditsAvailable })
          : t('activated'),
        'success',
      );
      await load();
    } catch (e: any) {
      toast(e?.message ?? t('errorActivate'), 'error');
    } finally {
      setActivatingId(null);
    }
  }

  async function refund(tx: Tx) {
    if (refundingId) return;
    if (
      !confirm(
        '¿Estás seguro que deseas reembolsar?\n\n' +
          'Al aceptar, el cliente no podrá tener acceso a la plataforma: se pausarán sus servicios.\n\n' +
          'Y de manera inmediata te colocaremos el crédito usado en disponible.',
      )
    )
      return;
    setRefundingId(tx.id);
    try {
      const res = await api<{ refunded: number; creditsAvailable: number }>(
        `/admin/credits/refund/${tx.id}`,
        { method: 'POST' },
      );
      toast(
        `Crédito reembolsado. Disponibles: ${res.creditsAvailable}.`,
        'success',
      );
      await load();
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo reembolsar el crédito.', 'error');
    } finally {
      setRefundingId(null);
    }
  }

  // Días restantes de la ventana de reembolso para un movimiento CONSUME.
  // >0 = reembolsable; <=0 = vencido; null = no aplica / ya reembolsado.
  function refundDaysLeft(tx: Tx): number | null {
    if (tx.type !== 'CONSUME' || tx.refundedAt) return null;
    const deadline =
      new Date(tx.createdAt).getTime() + REFUND_WINDOW_DAYS * 86400000;
    return Math.ceil((deadline - Date.now()) / 86400000);
  }

  if (loading) {
    return <div className="p-6 text-gray-500">{t('loading')}</div>;
  }

  if (forbidden || !data) {
    return (
      <div className="p-6">
        <div className="max-w-lg rounded-2xl border border-gray-200 bg-white p-6">
          <h1 className="text-lg font-bold text-gray-900">{t('pageTitle')}</h1>
          <p className="mt-2 text-sm text-gray-600">{t('forbiddenNote')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t('pageTitle')}</h1>
          <p className="text-sm text-gray-500">
            {t('subtitle', { brand: data.whiteLabel.name })}
          </p>
        </div>
        <button
          onClick={load}
          className="text-sm px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50"
        >
          {t('refresh')}
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
        <Kpi label={t('kpiAvailable')} value={data.available} tone="good" />
        <Kpi label={t('kpiCommitted')} value={data.committed} />
        <Kpi label={t('kpiUsed')} value={data.used} />
        <Kpi
          label={t('kpiPendingBusinesses')}
          value={data.pendingTenants}
          tone={data.pendingTenants > 0 ? 'warn' : 'default'}
        />
      </div>

      {/* Comprar créditos */}
      {data.buyLinks.length > 0 && (
        <section className="mt-7">
          <h2 className="text-sm font-bold text-gray-700 mb-2">
            {t('buyCreditsTitle')}
          </h2>
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
            {t.rich('buyCreditsWarning', {
              b: (chunks) => <span className="font-bold">{chunks}</span>,
            })}
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.buyLinks.map((l) => (
              <a
                key={l.id}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-2xl border border-gray-200 bg-white p-4 hover:border-gray-300 hover:shadow-sm transition"
              >
                <div className="text-sm font-semibold text-gray-900">
                  {l.label}
                </div>
                <div className="text-[12px] text-gray-500 mt-0.5">
                  {t('creditsCount', { count: l.credits })}
                </div>
                {l.price != null && (
                  <div className="text-base font-bold text-gray-900 mt-2">
                    {l.currency} ${l.price.toLocaleString()}
                  </div>
                )}
                <div className="text-[12px] text-emerald-600 font-semibold mt-2">
                  {t('buyArrow')}
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Negocios pendientes de activación */}
      <section className="mt-7">
        <h2 className="text-sm font-bold text-gray-700 mb-2">
          {t('pendingBusinessesTitle')}
        </h2>
        {pending.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
            {t('noPendingBusinesses')}
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
            {pending.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 p-3.5 flex-wrap"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900 truncate">
                    {item.brandName}
                  </div>
                  <div className="text-[12px] text-gray-500">
                    {item.reason}
                    {item.overdueDays > 0
                      ? t('overdueSuffix', { days: item.overdueDays })
                      : ''}
                  </div>
                </div>
                <button
                  disabled={activatingId === item.id || (!data.unlimited && data.available <= 0)}
                  onClick={() => activate(item)}
                  className="text-[13px] font-semibold px-3 py-2 rounded-lg bg-gray-900 text-white hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed"
                  title={
                    (!data.unlimited && data.available <= 0)
                      ? t('noCreditsTitle')
                      : t('consumesOneCreditTitle')
                  }
                >
                  {activatingId === item.id
                    ? t('activating')
                    : t('activateOneCredit')}
                </button>
              </div>
            ))}
          </div>
        )}
        {(!data.unlimited && data.available <= 0) && pending.length > 0 && (
          <p className="text-[12px] text-amber-600 mt-2">
            {t('noCreditsHint')}
          </p>
        )}
      </section>

      {/* Historial */}
      {data.history.length > 0 && (
        <section className="mt-7">
          <h2 className="text-sm font-bold text-gray-700 mb-2">
            {t('recentMovementsTitle')}
          </h2>
          <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
            {data.history.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between gap-3 p-3 text-sm"
              >
                <div className="min-w-0">
                  <span className="font-medium text-gray-800">
                    {t(TX_LABEL_KEY[tx.type])}
                  </span>
                  {tx.note && (
                    <span className="text-gray-500 ml-2 text-[12px]">
                      {tx.note}
                    </span>
                  )}
                  <div className="text-[11px] text-gray-400">
                    {new Date(tx.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {tx.refundedAt ? (
                    <span className="text-[11px] font-medium text-gray-400 whitespace-nowrap">
                      ✓ Reembolsado
                    </span>
                  ) : tx.type === 'CONSUME' ? (
                    (() => {
                      const days = refundDaysLeft(tx);
                      if (days !== null && days > 0) {
                        return (
                          <button
                            onClick={() => refund(tx)}
                            disabled={refundingId === tx.id}
                            className="text-[11px] font-semibold rounded-lg border border-amber-300 text-amber-700 bg-amber-50 px-2.5 py-1 hover:bg-amber-100 disabled:opacity-50 whitespace-nowrap"
                            title="Devolver el crédito al pool y suspender el negocio (por si el cliente no pagó)"
                          >
                            {refundingId === tx.id
                              ? 'Reembolsando…'
                              : `↩ Reembolsar · quedan ${days} día${days === 1 ? '' : 's'}`}
                          </button>
                        );
                      }
                      // Ventana de 5 días vencida: botón ROJO "No reembolsable";
                      // al clic avisa que ya pasaron los 5 días.
                      return (
                        <button
                          type="button"
                          onClick={() =>
                            toast(
                              'Ya pasaron los 5 días — este crédito ya no se puede reembolsar.',
                              'error',
                            )
                          }
                          className="text-[11px] font-semibold rounded-lg border border-red-300 text-red-600 bg-red-50 px-2.5 py-1 hover:bg-red-100 whitespace-nowrap"
                        >
                          No reembolsable
                        </button>
                      );
                    })()
                  ) : null}
                  <span
                    className={`font-bold tabular-nums ${
                      tx.amount >= 0 ? 'text-emerald-600' : 'text-gray-700'
                    }`}
                  >
                    {tx.amount >= 0 ? '+' : ''}
                    {tx.amount}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
