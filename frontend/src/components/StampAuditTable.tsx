'use client';
/**
 * Wallet V3 — Historial / Auditoría de ajustes de sellos.
 * Reutilizado por el negocio (/app/historial-sellos) y el Master Admin
 * (/admin/tenants/[id], pasando tenantId). El backend gatea por marca:
 * showHistory (si off → enabled:false) y showAudit (ip/device).
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type AuditRow = {
  id: string;
  createdAt: string;
  action: string;
  amount: number;
  note: string | null;
  operator: string | null;
  customer: string | null;
  location: string | null;
  ip: string | null;
  device: string | null;
  /** Ausente en respuestas de un backend anterior: se trata como desconocido. */
  origin?: 'STAFF' | 'ORDER' | 'AUTOMATION' | 'SYSTEM';
  giftReason?: string | null;
  redeemKind?: string | null;
};

type AuditResp = { enabled: boolean; showAudit: boolean; rows: AuditRow[] };

function actionBadge(action: string, amount: number) {
  switch (action) {
    case 'STAMP':
      return { label: `+${amount} sello${amount === 1 ? '' : 's'}`, bg: '#dcfce7', fg: '#15803d' };
    case 'STAMP_REMOVE':
      return { label: `−${amount} sello${amount === 1 ? '' : 's'}`, bg: '#fee2e2', fg: '#b91c1c' };
    case 'REFUND':
      return { label: `−${amount} (ajuste)`, bg: '#fee2e2', fg: '#b91c1c' };
    case 'REDEEM':
      return { label: 'Canje', bg: '#ede9fe', fg: '#6d28d9' };
    case 'VISIT':
      return { label: `+${amount} visita${amount === 1 ? '' : 's'}`, bg: '#e0f2fe', fg: '#0369a1' };
    default:
      return { label: action, bg: '#f3f4f6', fg: '#6b7280' };
  }
}

// Los «—» en Empleado, Motivo e IP se leían como «falta un dato» (o algo
// raro) cuando en realidad el movimiento lo hizo el sistema: un pedido
// entregado, un reverso por cancelación, una automatización. Cada celda vacía
// ahora dice POR QUÉ está vacía (pedido del cliente, PDF 5).

/** Notas que escribe el propio sistema, con un texto legible para el negocio. */
const NOTAS_DEL_SISTEMA: Record<string, string> = {
  'Por automation': 'Automatización',
};

function esAutomatico(r: AuditRow) {
  if (r.origin) return r.origin !== 'STAFF';
  return !r.operator;
}

function quien(r: AuditRow): { texto: string; tenue: boolean } {
  if (r.operator) return { texto: r.operator, tenue: false };
  switch (r.origin) {
    case 'ORDER':
      return { texto: 'Automático (pedido)', tenue: true };
    case 'AUTOMATION':
      return { texto: 'Automático (regla)', tenue: true };
    case 'SYSTEM':
      return { texto: 'Sistema', tenue: true };
    case 'STAFF':
      // Tenía operador y la cuenta se borró después.
      return { texto: 'Empleado eliminado', tenue: true };
    default:
      return { texto: 'Sistema', tenue: true };
  }
}

function motivo(r: AuditRow): { texto: string; tenue: boolean } {
  const partes: string[] = [];
  if (r.note) partes.push(NOTAS_DEL_SISTEMA[r.note] ?? r.note);
  if (r.giftReason === 'COURTESY') partes.push('Cortesía');
  if (r.giftReason === 'SPECIAL_DATE') partes.push('Fecha especial');
  if (r.action === 'REDEEM' && !r.note) {
    if (r.redeemKind === 'COUPON') partes.push('Canje de cupón');
    else if (r.redeemKind === 'REWARD') partes.push('Canje de premio');
  }
  if (r.location) partes.push(r.location);
  if (partes.length > 0) return { texto: partes.join(' · '), tenue: false };
  // Sin motivo ni sede: decir qué fue, no dejar un guion.
  if (!esAutomatico(r)) {
    if (r.action === 'STAMP' || r.action === 'VISIT') return { texto: 'Escaneo en caja', tenue: true };
    if (r.action === 'REDEEM') return { texto: 'Canje en caja', tenue: true };
    return { texto: 'Ajuste manual sin motivo', tenue: true };
  }
  return { texto: 'Movimiento automático', tenue: true };
}

function dispositivo(r: AuditRow): { texto: string; tenue: boolean } {
  const v = [r.ip, r.device].filter(Boolean).join(' · ');
  if (v) return { texto: v, tenue: false };
  // Un movimiento del sistema no pasa por ningún teléfono ni navegador.
  if (esAutomatico(r)) return { texto: 'No aplica', tenue: true };
  return { texto: 'No registrado', tenue: true };
}

function fmt(ts: string) {
  try {
    const d = new Date(ts);
    return d.toLocaleString('es-CO', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

export function StampAuditTable({ tenantId }: { tenantId?: string }) {
  const [data, setData] = useState<AuditResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams();
    if (tenantId) qs.set('tenantId', tenantId);
    qs.set('limit', '200');
    api<AuditResp>(`/stamps/audit?${qs.toString()}`)
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e) => { if (!cancelled) setErr(e?.message ?? 'Error'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId]);

  if (loading) return <div className="text-sm text-mute">Cargando historial…</div>;
  if (err) return <div className="text-sm text-red-500">{err}</div>;
  if (!data) return null;
  if (!data.enabled) {
    return (
      <div className="text-sm text-mute">
        El historial de sellos no está habilitado para tu marca.
      </div>
    );
  }
  if (data.rows.length === 0) {
    return <div className="text-sm text-mute">Aún no hay movimientos de sellos registrados.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse min-w-[640px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-mute border-b border-line">
            <th className="py-2 pr-3 font-semibold">Fecha</th>
            <th className="py-2 pr-3 font-semibold">Cliente</th>
            <th className="py-2 pr-3 font-semibold">Acción</th>
            <th className="py-2 pr-3 font-semibold">Empleado</th>
            <th className="py-2 pr-3 font-semibold">Motivo / sede</th>
            {data.showAudit && <th className="py-2 pr-3 font-semibold">IP / dispositivo</th>}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => {
            const b = actionBadge(r.action, r.amount);
            const q = quien(r);
            const m = motivo(r);
            const d = dispositivo(r);
            return (
              <tr key={r.id} className="border-b border-line/60 align-top">
                <td className="py-2 pr-3 whitespace-nowrap text-mute">{fmt(r.createdAt)}</td>
                <td className="py-2 pr-3">{r.customer ?? '—'}</td>
                <td className="py-2 pr-3">
                  <span
                    className="inline-block text-[11px] font-bold px-2 py-0.5 rounded-[7px] whitespace-nowrap"
                    style={{ background: b.bg, color: b.fg }}
                  >
                    {b.label}
                  </span>
                </td>
                <td className={`py-2 pr-3 ${q.tenue ? 'text-mute italic' : ''}`}>{q.texto}</td>
                <td className={`py-2 pr-3 ${m.tenue ? 'text-mute2 italic' : 'text-mute'}`}>
                  {m.texto}
                </td>
                {data.showAudit && (
                  <td
                    className={`py-2 pr-3 text-[11px] max-w-[220px] truncate ${d.tenue ? 'text-mute2 italic' : 'text-mute'}`}
                    title={d.tenue ? '' : r.device ?? ''}
                  >
                    {d.texto}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
