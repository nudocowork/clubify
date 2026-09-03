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
                <td className="py-2 pr-3">{r.operator ?? '—'}</td>
                <td className="py-2 pr-3 text-mute">
                  {[r.note, r.location].filter(Boolean).join(' · ') || '—'}
                </td>
                {data.showAudit && (
                  <td className="py-2 pr-3 text-[11px] text-mute max-w-[220px] truncate" title={r.device ?? ''}>
                    {[r.ip, r.device].filter(Boolean).join(' · ') || '—'}
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
