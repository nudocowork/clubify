'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';

/**
 * Historial de pagos del negocio.
 *
 * Responde una sola pregunta: ¿este negocio está pagando o no? Por eso lo
 * primero que se ve no es la lista sino el aviso de cobros rechazados sin
 * resolver — es lo único que exige actuar. La lista queda debajo para
 * verificarlo.
 *
 * Un mismo cobro puede tener varios INTENTOS: cuando la tarjeta no tiene
 * saldo, Hotmart reintenta a los días. Por eso se muestra el número de cobro:
 * dos filas «Cobro #3», una rechazada y otra pagada, son un mes que entró al
 * segundo intento — no dos meses cobrados.
 */

type PagoHistorial = {
  id: string;
  fecha: string;
  origen: 'HOTMART' | 'STRIPE' | 'MANUAL' | 'CREDITO';
  estado:
    | 'PAGADO'
    | 'RECHAZADO'
    | 'REEMBOLSADO'
    | 'CONTRACARGO'
    | 'EXPIRADO'
    | 'PENDIENTE'
    | 'CANCELADO';
  monto: number | null;
  moneda: string | null;
  montoUsd: number | null;
  metodo: string | null;
  motivo: string | null;
  referencia: string | null;
  numeroDeCobro: number | null;
  cubreDesde: string | null;
  cubreHasta: string | null;
  nota: string | null;
};

type HistorialResp = {
  resumen: {
    totalCobros: number;
    pagosCorrectos: number;
    ultimoPagoEn: string | null;
    cobrosFallidos: number;
    ultimoRechazoMotivo: string | null;
    ultimoRechazoEn: string | null;
    reembolsos: number;
    contracargos: number;
  };
  pagos: PagoHistorial[];
};

const VISIBLES_POR_DEFECTO = 6;

function fechaCorta(iso: string) {
  return new Date(iso).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** El separador de miles no es cosmético: 191900 COP sin él se confunde con
 *  un importe en dólares, que es justo la lectura que arruina la decisión. */
function importe(monto: number | null, moneda: string | null) {
  if (monto == null) return null;
  const n = monto.toLocaleString('es-CO', {
    minimumFractionDigits: Number.isInteger(monto) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return moneda ? `${n} ${moneda}` : n;
}

export function PaymentHistoryCard({ tenantId }: { tenantId: string }) {
  const t = useTranslations('admin_tenants_id');
  const [data, setData] = useState<HistorialResp | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);
  const [verTodo, setVerTodo] = useState(false);

  async function cargar() {
    setCargando(true);
    setError(false);
    try {
      setData(await api<HistorialResp>(`/tenants/${tenantId}/payment-history`));
    } catch {
      setError(true);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const ESTADO: Record<
    PagoHistorial['estado'],
    { label: string; cls: string }
  > = {
    PAGADO: { label: t('phPaid'), cls: 'badge-ok' },
    RECHAZADO: { label: t('phRejected'), cls: 'badge-bad' },
    REEMBOLSADO: { label: t('phRefunded'), cls: 'badge-warn' },
    CONTRACARGO: { label: t('phChargeback'), cls: 'badge-bad' },
    EXPIRADO: { label: t('phExpired'), cls: 'badge-warn' },
    PENDIENTE: { label: t('phPending'), cls: 'badge-warn' },
    CANCELADO: { label: t('phCanceled'), cls: 'badge-warn' },
  };
  const ORIGEN: Record<PagoHistorial['origen'], string> = {
    HOTMART: t('phHotmart'),
    STRIPE: t('phStripe'),
    MANUAL: t('phManual'),
    CREDITO: t('phCredit'),
  };

  const pagos = data?.pagos ?? [];
  const visibles = verTodo ? pagos : pagos.slice(0, VISIBLES_POR_DEFECTO);
  const r = data?.resumen;

  return (
    <div className="mt-6 pt-5 border-t border-line">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold m-0">{t('phTitle')}</h3>
          <p className="text-xs text-mute mt-0.5">{t('phSubtitle')}</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost text-xs"
          onClick={() => void cargar()}
          disabled={cargando}
        >
          {t('phReload')}
        </button>
      </div>

      {cargando && <p className="text-xs text-mute mt-3">{t('phLoading')}</p>}

      {error && !cargando && (
        <p className="text-xs text-danger mt-3">
          {t('phError')}{' '}
          <button
            type="button"
            className="underline"
            onClick={() => void cargar()}
          >
            {t('phRetry')}
          </button>
        </p>
      )}

      {!cargando && !error && r && (
        <>
          {r.cobrosFallidos > 0 && (
            <div className="mt-3 rounded-input border-2 border-danger/40 bg-danger/5 p-3">
              <div className="text-sm font-semibold text-danger">
                {t('phFailedOpen', { n: r.cobrosFallidos })}
              </div>
              {r.ultimoRechazoMotivo && (
                <div className="text-xs text-ink mt-1">
                  {r.ultimoRechazoMotivo}
                  {r.ultimoRechazoEn && <> · {fechaCorta(r.ultimoRechazoEn)}</>}
                </div>
              )}
            </div>
          )}

          <p className="text-xs text-mute mt-3">
            {t('phOkPayments', { n: r.pagosCorrectos })}
            {r.ultimoPagoEn && (
              <>
                {' '}
                · {t('phLastPayment')}{' '}
                <strong className="text-ink">
                  {fechaCorta(r.ultimoPagoEn)}
                </strong>
              </>
            )}
            {r.reembolsos > 0 && <> · {t('phRefundsN', { n: r.reembolsos })}</>}
            {r.contracargos > 0 && (
              <> · {t('phChargebacksN', { n: r.contracargos })}</>
            )}
          </p>

          {pagos.length === 0 ? (
            <p className="text-xs text-mute mt-3">{t('phEmpty')}</p>
          ) : (
            <>
              <ul className="mt-3 flex flex-col gap-2 list-none p-0 m-0">
                {visibles.map((p) => (
                  <li
                    key={p.id}
                    className="rounded-input border border-line p-2.5 flex flex-wrap items-center gap-x-3 gap-y-1"
                  >
                    <span className="text-xs text-mute tabular-nums w-[92px] shrink-0">
                      {fechaCorta(p.fecha)}
                    </span>
                    <span
                      className={`badge ${ESTADO[p.estado].cls} text-[10px]`}
                    >
                      {ESTADO[p.estado].label}
                    </span>
                    <span className="text-sm font-semibold text-ink tabular-nums">
                      {importe(p.monto, p.moneda) ?? '—'}
                    </span>
                    {p.montoUsd != null && p.moneda !== 'USD' && (
                      <span className="text-[11px] text-mute">
                        ({importe(p.montoUsd, 'USD')})
                      </span>
                    )}
                    <span className="text-[11px] text-mute">
                      {ORIGEN[p.origen]}
                      {p.metodo && <> · {p.metodo}</>}
                      {p.numeroDeCobro != null && (
                        <> · {t('phCharge', { n: p.numeroDeCobro })}</>
                      )}
                    </span>
                    {p.cubreDesde && p.cubreHasta && (
                      <span className="text-[11px] text-mute basis-full">
                        {t('phCovers', {
                          from: fechaCorta(p.cubreDesde),
                          to: fechaCorta(p.cubreHasta),
                        })}
                      </span>
                    )}
                    {p.motivo && (
                      <span className="text-[11px] text-danger basis-full">
                        {p.motivo}
                      </span>
                    )}
                    {p.nota && (
                      <span className="text-[11px] text-mute basis-full">
                        {p.nota}
                      </span>
                    )}
                  </li>
                ))}
              </ul>

              {pagos.length > VISIBLES_POR_DEFECTO && (
                <button
                  type="button"
                  className="btn btn-ghost text-xs mt-2"
                  onClick={() => setVerTodo((v) => !v)}
                >
                  {verTodo ? t('phLess') : t('phMore', { n: pagos.length })}
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
