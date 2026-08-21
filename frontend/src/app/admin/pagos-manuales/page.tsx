'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { periodLabel, type PlanPeriodicity } from '@/lib/plan-format';

// =====================================================
// Pagos por fuera — lista de revisión de cobranza manual
// =====================================================
// Los negocios marcados "paga por fuera" (Nequi/efectivo/transferencia) NO
// se suspenden solos: ninguna pasarela confirma sus pagos. Cuando su ciclo
// vence sin un pago manual que lo cubra, caen aquí para perseguir el cobro
// o desconectarlos a mano. Backend: GET /tenants/manual-payments/review
// (SUPER_ADMIN, aislado por marca), ordenado por días vencidos desc.

type ReviewItem = {
  tenantId: string;
  brandName: string;
  email: string;
  phone: string | null;
  status: string;
  whiteLabelId: string | null;
  planPeriodicity: PlanPeriodicity;
  /** VENCIDO = hay que perseguirlo · AL_DIA = cubierto · DESCONECTADO = suspendido */
  estado: 'VENCIDO' | 'AL_DIA' | 'DESCONECTADO';
  /** Hasta cuándo está cubierto. Null = nunca arrancó ciclo. */
  coveredUntil: string | null;
  dueSince: string | null;
  daysOverdue: number;
  reason: 'CICLO_VENCIDO' | 'TRIAL_VENCIDO';
  lastManualPayment: {
    id: string;
    method: string;
    /** Decimal de Prisma → string en JSON (o null). */
    amount: string | null;
    currency: string | null;
    paidAt: string;
    periodStart: string;
    periodEnd: string;
  } | null;
};

const METHOD_LABEL: Record<string, string> = {
  NEQUI: 'Nequi',
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  OTRO: 'Otro',
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function fmtAmount(amount: string | null, currency: string | null) {
  if (amount == null) return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return `${n.toLocaleString('es-CO', { maximumFractionDigits: 2 })} ${currency ?? 'USD'}`;
}

export default function PagosManualesPage() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [pendientes, setPendientes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<ReviewItem | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ count: number; pendientes: number; items: ReviewItem[] }>(
        '/tenants/manual-payments/review',
      );
      setItems(res?.items ?? []);
      setPendientes(res?.pendientes ?? 0);
    } catch (e: any) {
      // Error visible con reintento — que nunca parezca "no hay vencidos"
      // cuando en realidad falló la carga.
      setError(e?.message || 'No se pudo cargar la lista de revisión');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Pagos por fuera{' '}
          {!loading && !error && (
            <span className="page-crumb">
              {items.length === 1 ? '1 negocio' : `${items.length} negocios`}
              {pendientes > 0 && (
                <span className="text-bad font-semibold">
                  {' · '}
                  {pendientes === 1 ? '1 por cobrar' : `${pendientes} por cobrar`}
                </span>
              )}
            </span>
          )}
        </h1>
        <button type="button" className="btn-ghost text-sm" onClick={load} disabled={loading}>
          Actualizar
        </button>
      </div>
      <p className="text-sm text-mute mb-4 -mt-2 max-w-3xl">
        Negocios que pagan por Nequi, efectivo o transferencia y cuyo ciclo{' '}
        <strong>cobras a mano</strong>. El sistema no los
        suspende solo: persigue el cobro (y regístralo desde su ficha) o desconéctalos
        a mano desde aquí.
      </p>

      {error && !loading && (
        <div className="card card-pad">
          <div className="text-sm text-bad-ink">{error}</div>
          <button type="button" className="btn-ghost text-sm mt-2" onClick={load}>
            Reintentar
          </button>
        </div>
      )}

      {!error && (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px] min-w-[860px]">
              <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 font-semibold">Negocio</th>
                  <th className="px-4 py-3 font-semibold">Motivo</th>
                  <th className="px-4 py-3 font-semibold">Vencido hace</th>
                  <th className="px-4 py-3 font-semibold">Plan</th>
                  <th className="px-4 py-3 font-semibold">Último pago manual</th>
                  <th className="px-4 py-3 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {loading &&
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={`sk-${i}`} className="border-t border-line2">
                      <td colSpan={6} className="px-4 py-3.5">
                        <div className="h-6 bg-bg2 rounded animate-shimmer" />
                      </td>
                    </tr>
                  ))}
                {!loading && items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center">
                      <div className="text-3xl mb-1">✅</div>
                      <div className="font-semibold">Ningún negocio marcado</div>
                      <div className="text-mute text-xs mt-1 max-w-md mx-auto">
                        Marca un negocio como «paga por fuera» desde su ficha y
                        aparecerá acá, con su cobertura y avisándote cuando le
                        toque cobrar.
                      </div>
                    </td>
                  </tr>
                )}
                {!loading &&
                  items.map((it) => {
                    const lastAmount = it.lastManualPayment
                      ? fmtAmount(it.lastManualPayment.amount, it.lastManualPayment.currency)
                      : null;
                    return (
                      <tr key={it.tenantId} className="border-t border-line2 align-top">
                        <td className="px-4 py-3.5">
                          <Link
                            href={`/admin/tenants/${it.tenantId}`}
                            className="font-medium hover:text-brand transition"
                          >
                            {it.brandName}
                          </Link>
                          <div className="text-mute text-xs">{it.email}</div>
                          {it.phone && (
                            <div className="text-mute text-xs">{it.phone}</div>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className={`badge ${
                              it.estado === 'VENCIDO'
                                ? 'badge-bad'
                                : it.estado === 'DESCONECTADO'
                                  ? 'badge-warn'
                                  : 'badge-ok'
                            }`}
                          >
                            {it.estado === 'VENCIDO'
                              ? it.reason === 'CICLO_VENCIDO'
                                ? 'Ciclo vencido'
                                : 'Prueba vencida'
                              : it.estado === 'DESCONECTADO'
                                ? 'Desconectado'
                                : 'Al día'}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          {it.estado === 'VENCIDO' && it.dueSince ? (
                            <>
                              <span
                                className={`font-semibold ${
                                  it.daysOverdue >= 7 ? 'text-bad' : 'text-warn'
                                }`}
                              >
                                {it.daysOverdue === 1 ? '1 día' : `${it.daysOverdue} días`}
                              </span>
                              <div className="text-mute text-xs">
                                desde el {fmtDate(it.dueSince)}
                              </div>
                            </>
                          ) : (
                            <span className="text-mute">
                              {it.coveredUntil
                                ? `cubierto hasta el ${fmtDate(it.coveredUntil)}`
                                : 'sin ciclo iniciado'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          {periodLabel(it.planPeriodicity)}
                        </td>
                        <td className="px-4 py-3.5">
                          {it.lastManualPayment ? (
                            <>
                              <div className="whitespace-nowrap">
                                {METHOD_LABEL[it.lastManualPayment.method] ??
                                  it.lastManualPayment.method}
                                {lastAmount ? ` · ${lastAmount}` : ''}
                              </div>
                              <div className="text-mute text-xs whitespace-nowrap">
                                {fmtDate(it.lastManualPayment.paidAt)} · cubría hasta el{' '}
                                {fmtDate(it.lastManualPayment.periodEnd)}
                              </div>
                            </>
                          ) : (
                            <span className="text-mute2 text-xs">
                              Nunca registró un pago manual
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right whitespace-nowrap">
                          <Link
                            href={`/admin/tenants/${it.tenantId}`}
                            className="btn-ghost text-xs px-3 py-1.5 min-h-0 inline-flex"
                          >
                            Ver ficha
                          </Link>
                          <button
                            type="button"
                            className="btn-ghost text-xs px-3 py-1.5 min-h-0 text-bad ml-1"
                            onClick={() => setSuspendTarget(it)}
                          >
                            Suspender
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {suspendTarget && (
        <SuspendModal
          item={suspendTarget}
          onClose={() => setSuspendTarget(null)}
          onDone={() => {
            setSuspendTarget(null);
            load();
          }}
        />
      )}
    </div>
  );
}

/** Confirmación de suspensión: nombre del negocio + consecuencia real, con
 *  estado "Suspendiendo…" para que no se pueda disparar dos veces. */
function SuspendModal({
  item,
  onClose,
  onDone,
}: {
  item: ReviewItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function suspend() {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/tenants/${item.tenantId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'SUSPENDED' }),
      });
      toast(`«${item.brandName}» quedó suspendido`, 'success');
      onDone();
    } catch (e: any) {
      toast(e?.message || 'No se pudo suspender el negocio', 'error');
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center sm:p-4"
      onClick={() => !busy && onClose()}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-line2 flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-bad-soft flex items-center justify-center text-bad shrink-0">
            ⏸
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-base">Suspender negocio</div>
            <div className="text-xs text-mute mt-0.5">{item.brandName}</div>
          </div>
        </div>
        <div className="px-5 py-4 space-y-2 text-sm">
          <p>
            Vas a suspender <strong>«{item.brandName}»</strong> (
            {item.daysOverdue === 1 ? '1 día' : `${item.daysOverdue} días`} vencido).
          </p>
          <p className="text-mute leading-snug">
            El negocio queda desconectado: el dueño pierde acceso a su panel y sus
            clientes dejan de poder usar sus tarjetas y menús, hasta que lo reactives
            desde su ficha. Si el cliente ya pagó, registra el pago manual en su ficha
            en lugar de suspenderlo.
          </p>
        </div>
        <div className="px-5 py-3 border-t border-line2 flex flex-col-reverse sm:flex-row items-stretch sm:items-center sm:justify-end gap-2">
          <button
            type="button"
            className="btn-ghost text-sm justify-center min-h-[44px] disabled:opacity-50"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="text-sm font-semibold px-4 py-2 rounded-md bg-bad text-white hover:bg-bad/90 disabled:opacity-50 min-h-[44px]"
            disabled={busy}
            onClick={suspend}
          >
            {busy ? 'Suspendiendo…' : 'Suspender negocio'}
          </button>
        </div>
      </div>
    </div>
  );
}
