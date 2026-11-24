'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

/**
 * Estado de la suscripción de un negocio, con su POR QUÉ.
 *
 * Javier, 2026-11-23: cancelar y suspender no son lo mismo. Esta tarjeta dice
 * en cuál está el negocio y por qué (cancelado por el cliente, por un
 * colaborador, por reembolso, por contracargo; suspendido por falta de pago…),
 * si se le avisó por SMS que verificara la cancelación en Hotmart y si ese SMS
 * salió, sus cobros con su estado en Contabilidad, y qué comisiones se
 * revirtieron por cada devolución.
 *
 * Y desde aquí el equipo cancela una suscripción o registra una devolución.
 * Las dos cosas hacen lo mismo que hace el sistema cuando llega el aviso de
 * Hotmart (mismo endpoint de fondo), así que da igual qué pase primero.
 */

type Estado = {
  estadoComercial: 'ACTIVO' | 'TRIAL' | 'SUSPENDIDO' | 'SUSPENDIDO_TRIAL' | 'CANCELADO';
  nota: string | null;
  canceledAt: string | null;
  avisoDeCancelacion: { enviadoEl: string; plantilla: string } | null;
  mensajes: Array<{ id: string; createdAt: string; status: string; toPhone: string | null; templateId: string | null; error: string | null }>;
  ingresos: Array<{
    id: string;
    externalTxId: string;
    gateway: string;
    grossUsd: number;
    status: string;
    category: string | null;
    saleDate: string;
    refundedAt: string | null;
  }>;
  reversiones: Array<{
    id: string;
    tipo: 'AJUSTE_POR_RECUPERAR' | 'ANULADA';
    montoUsd: number;
    aplicadoUsd: number;
    pago: string;
    tx: string | null;
    colaborador: string;
    creada: string;
  }>;
};

const BADGE: Record<Estado['estadoComercial'], string> = {
  ACTIVO: 'badge-ok',
  TRIAL: 'badge-info',
  SUSPENDIDO: 'badge-bad',
  SUSPENDIDO_TRIAL: 'badge-warn',
  CANCELADO: 'badge-mute',
};

const fecha = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Bogota' }) : '—';
const usd = (n: number) => `$${n.toFixed(2)}`;

export function EstadoDeSuscripcionCard({ tenantId, onChanged }: { tenantId: string; onChanged?: () => void }) {
  const t = useTranslations('admin_estado_suscripcion');
  const [estado, setEstado] = useState<Estado | null>(null);
  const [oculto, setOculto] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [desconectarYa, setDesconectarYa] = useState(false);
  const [devolviendo, setDevolviendo] = useState<string | null>(null);
  const [tipo, setTipo] = useState<'REEMBOLSO' | 'CONTRACARGO'>('REEMBOLSO');
  const [notaDev, setNotaDev] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function cargar() {
    try {
      setEstado(await api<Estado>(`/billing/admin/tenants/${tenantId}/estado`));
    } catch {
      // 403 para las marcas blancas: esto es solo de la plataforma.
      setOculto(true);
    }
  }
  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function cancelar() {
    if (!motivo.trim()) {
      toast(t('motivoObligatorio'), 'error');
      return;
    }
    setEnviando(true);
    try {
      const r = await api<{ desconectadoAhora: boolean; aviso: { resultado: string }; pasarela: { intentada: boolean; ok: boolean; motivo?: string } }>(
        `/billing/admin/tenants/${tenantId}/cancelar`,
        { method: 'POST', body: JSON.stringify({ motivo: motivo.trim(), desconectarYa }) },
      );
      toast(
        [
          r.desconectadoAhora ? t('canceladoYDesconectado') : t('canceladoConservaServicio'),
          t(`aviso_${r.aviso.resultado}` as any),
          r.pasarela.intentada ? (r.pasarela.ok ? t('hotmartCancelada') : t('hotmartFallo', { motivo: r.pasarela.motivo ?? '' })) : '',
        ]
          .filter(Boolean)
          .join(' '),
        r.pasarela.intentada && !r.pasarela.ok ? 'error' : 'success',
      );
      setCancelando(false);
      setMotivo('');
      await cargar();
      onChanged?.();
    } catch (e: any) {
      toast(e.message || t('error'), 'error');
    } finally {
      setEnviando(false);
    }
  }

  async function registrarDevolucion(externalTxId: string) {
    setEnviando(true);
    try {
      const r = await api<{
        esDelPeriodoActual: boolean;
        comisionesAnuladas: number;
        ajustes: Array<{ montoUsd: number; resultado: string }>;
      }>(`/billing/admin/tenants/${tenantId}/devolucion`, {
        method: 'POST',
        body: JSON.stringify({ externalTxId, tipo, nota: notaDev.trim() || undefined }),
      });
      const nuevos = r.ajustes.filter((a) => a.resultado === 'creado');
      toast(
        t('devolucionRegistrada', {
          anuladas: r.comisionesAnuladas,
          ajustes: nuevos.length,
          monto: usd(nuevos.reduce((a, x) => a + x.montoUsd, 0)),
        }) + (r.esDelPeriodoActual ? ` ${t('negocioCancelado')}` : ` ${t('cobroAnterior')}`),
        'success',
      );
      setDevolviendo(null);
      setNotaDev('');
      await cargar();
      onChanged?.();
    } catch (e: any) {
      toast(e.message || t('error'), 'error');
    } finally {
      setEnviando(false);
    }
  }

  if (oculto) return null;
  if (!estado) {
    return (
      <div className="card card-pad mb-4">
        <div className="h-12 bg-bg2 rounded animate-shimmer" />
      </div>
    );
  }

  const ultimoAviso = estado.mensajes[0];
  return (
    <div className="card card-pad mb-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="text-base font-semibold m-0 flex items-center gap-2">
          {t('titulo')}
          <span className={BADGE[estado.estadoComercial]}>{t(`estado_${estado.estadoComercial}` as any)}</span>
        </h2>
        {!estado.canceledAt && !cancelando && (
          <button className="btn-ghost text-sm text-bad" onClick={() => setCancelando(true)}>
            {t('cancelarSuscripcion')}
          </button>
        )}
      </div>

      {estado.nota && <p className="text-sm m-0 mb-2">{estado.nota}</p>}

      {(estado.avisoDeCancelacion || ultimoAviso) && (
        <p className="text-xs text-mute m-0 mb-3">
          {t('avisoSms')}{' '}
          {ultimoAviso ? (
            <>
              <span className={ultimoAviso.status === 'sent' ? 'text-ok' : 'text-bad'}>
                {ultimoAviso.status === 'sent' ? t('smsEnviado') : t('smsFallido')}
              </span>{' '}
              {fecha(ultimoAviso.createdAt)} · {ultimoAviso.toPhone ?? '—'}
              {ultimoAviso.error ? ` · ${ultimoAviso.error}` : ''}
            </>
          ) : (
            <>{t('smsEnviado')} {fecha(estado.avisoDeCancelacion!.enviadoEl)}</>
          )}
        </p>
      )}

      {cancelando && (
        <div className="rounded-lg border border-line p-3 mb-3 space-y-2">
          <label className="label">{t('motivoLabel')}</label>
          <textarea
            className="input w-full"
            rows={2}
            maxLength={500}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder={t('motivoPlaceholder')}
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={desconectarYa} onChange={(e) => setDesconectarYa(e.target.checked)} />
            {t('desconectarYa')}
          </label>
          <p className="text-xs text-mute m-0">{t('cancelarExplica')}</p>
          <div className="flex gap-2">
            <button className="btn-danger text-sm" disabled={enviando} onClick={cancelar}>
              {t('confirmarCancelacion')}
            </button>
            <button className="btn-ghost text-sm" disabled={enviando} onClick={() => setCancelando(false)}>
              {t('volver')}
            </button>
          </div>
        </div>
      )}

      {estado.ingresos.length > 0 && (
        <div className="overflow-x-auto mb-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-mute">
                <th className="py-1 pr-2">{t('thFecha')}</th>
                <th className="py-1 pr-2">{t('thTransaccion')}</th>
                <th className="py-1 pr-2 text-right">{t('thMonto')}</th>
                <th className="py-1 pr-2">{t('thEstado')}</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {estado.ingresos.map((i) => (
                <tr key={i.id} className="border-t border-line align-top">
                  <td className="py-1.5 pr-2 whitespace-nowrap">{fecha(i.saleDate)}</td>
                  <td className="py-1.5 pr-2 font-mono text-xs">
                    {i.externalTxId}
                    <span className="text-mute"> · {i.gateway}</span>
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{usd(i.grossUsd)}</td>
                  <td className="py-1.5 pr-2">
                    <span className={i.status === 'PAGADO' ? 'badge-ok' : i.status === 'EN_DISPUTA' ? 'badge-warn' : 'badge-mute'}>
                      {t(`ingreso_${i.status}` as any)}
                    </span>
                  </td>
                  <td className="py-1.5 text-right">
                    {(i.status === 'PAGADO' || i.status === 'EN_DISPUTA') && devolviendo !== i.id && (
                      <button className="btn-ghost text-xs" onClick={() => setDevolviendo(i.id)}>
                        {t('registrarDevolucion')}
                      </button>
                    )}
                    {devolviendo === i.id && (
                      <div className="flex flex-col items-end gap-1.5 min-w-[220px]">
                        <select className="input text-xs" value={tipo} onChange={(e) => setTipo(e.target.value as any)}>
                          <option value="REEMBOLSO">{t('tipoReembolso')}</option>
                          <option value="CONTRACARGO">{t('tipoContracargo')}</option>
                        </select>
                        <input
                          className="input text-xs w-full"
                          value={notaDev}
                          onChange={(e) => setNotaDev(e.target.value)}
                          placeholder={t('notaPlaceholder')}
                          maxLength={500}
                        />
                        <p className="text-[11px] text-mute m-0 text-right">{t('devolucionExplica')}</p>
                        <div className="flex gap-1.5">
                          <button className="btn-danger text-xs" disabled={enviando} onClick={() => registrarDevolucion(i.externalTxId)}>
                            {t('confirmarDevolucion')}
                          </button>
                          <button className="btn-ghost text-xs" disabled={enviando} onClick={() => setDevolviendo(null)}>
                            {t('volver')}
                          </button>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {estado.reversiones.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold m-0 mb-1">{t('reversionesTitulo')}</h3>
          <ul className="text-sm m-0 pl-0 list-none space-y-1">
            {estado.reversiones.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 border-t border-line pt-1">
                <span>
                  {r.tipo === 'ANULADA' ? t('reversionAnulada') : t('reversionAjuste')} · {r.colaborador}
                  <span className="text-mute font-mono text-xs"> · {r.tx}</span>
                </span>
                <span className="tabular-nums">
                  {usd(Math.abs(r.montoUsd))}{' '}
                  <span className="text-xs text-mute">
                    {r.tipo === 'ANULADA'
                      ? t('noSePago')
                      : r.pago === 'PAID'
                        ? t('yaDescontado')
                        : t('porDescontar')}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
