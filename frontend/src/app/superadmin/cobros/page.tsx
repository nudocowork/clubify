'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Renewal = {
  id: string;
  brandName: string;
  slug: string;
  whiteLabel: { id: string; name: string; primaryColor: string; initial: string | null } | null;
  currentPeriodEnd: string | null;
  creditsRequired: number;
  state: 'POR_RENOVAR' | 'PENDIENTE' | 'EN_GRACIA';
};

type BillingData = {
  summary: {
    upcoming: number;
    pending: number;
    inGrace: number;
    suspended: number;
  };
  renewals: Renewal[];
};

const STATE_META: Record<string, { label: string; bg: string; fg: string; dot: string }> = {
  POR_RENOVAR: { label: 'Por renovar', bg: '#dcfce7', fg: '#15803d', dot: '#16a34a' },
  PENDIENTE: { label: 'Pendiente', bg: '#fee2e2', fg: '#b91c1c', dot: '#dc2626' },
  EN_GRACIA: { label: 'En gracia', bg: '#fef3c7', fg: '#b45309', dot: '#f59e0b' },
};

function fmt(n: number) {
  return n.toLocaleString('es-MX');
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function CobrosPage() {
  const [data, setData] = useState<BillingData | null>(null);

  useEffect(() => {
    api<BillingData>('/superadmin/billing')
      .then(setData)
      .catch((e) => console.error(e));
  }, []);

  if (!data) return <div className="text-sm" style={{ color: '#9aa4af' }}>Cargando…</div>;
  const s = data.summary;

  return (
    <div>
      <h1 className="m-0" style={{ fontSize: 26, fontWeight: 800, color: '#16241c', letterSpacing: -0.6 }}>
        Centro de Cobros
      </h1>
      <p className="text-sm mt-1 mb-5" style={{ color: '#6b7785' }}>
        Renovaciones automáticas, período de gracia y negocios suspendidos
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label="Próximas renovaciones" value={fmt(s.upcoming)} color="#16a34a" />
        <Stat label="Pendientes de renov." value={fmt(s.pending)} color="#b91c1c" />
        <Stat label="En gracia" value={fmt(s.inGrace)} color="#b45309" />
        <Stat label="Suspendidos" value={fmt(s.suspended)} color="#6b7785" />
      </div>

      <div
        className="rounded-[14px] overflow-hidden"
        style={{
          background: 'white',
          border: '1px solid #e7e9ec',
          boxShadow: '0 1px 2px rgba(16,24,40,.04)',
        }}
      >
        <div className="px-5 py-4 border-b" style={{ borderColor: '#eef0f2' }}>
          <div className="text-[15px] font-bold" style={{ color: '#18221d' }}>
            Próximas renovaciones
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left" style={{ minWidth: 720, borderCollapse: 'collapse' }}>
            <thead style={{ background: '#fafbfc', borderBottom: '1px solid #eef0f2' }}>
              <tr>
                {[
                  { l: 'Cliente / Negocio', align: 'left' },
                  { l: 'Marca Blanca', align: 'left' },
                  { l: 'Vencimiento', align: 'left' },
                  { l: 'Créditos req.', align: 'center' },
                  { l: 'Estado', align: 'right' },
                ].map((h) => (
                  <th
                    key={h.l}
                    className="text-[11px] font-bold uppercase whitespace-nowrap"
                    style={{
                      padding: '14px 18px',
                      letterSpacing: 0.5,
                      color: '#9aa4af',
                      textAlign: h.align as any,
                    }}
                  >
                    {h.l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.renewals.map((r) => {
                const sm = STATE_META[r.state];
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #eef0f2' }}>
                    <td style={{ padding: '14px 18px', color: '#16241c', fontWeight: 600 }}>
                      {r.brandName}
                    </td>
                    <td style={{ padding: '14px 18px' }}>
                      {r.whiteLabel ? (
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block w-2 h-2 rounded-full"
                            style={{ background: r.whiteLabel.primaryColor }}
                          />
                          <span className="text-sm" style={{ color: '#16241c' }}>
                            {r.whiteLabel.name}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs italic" style={{ color: '#9aa4af' }}>
                          Sin marca
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '14px 18px', color: '#16241c' }}>
                      {fmtDate(r.currentPeriodEnd)}
                    </td>
                    <td style={{ padding: '14px 18px', textAlign: 'center', color: '#2563eb', fontWeight: 700 }}>
                      {r.creditsRequired}
                    </td>
                    <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                      <span
                        className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-[7px]"
                        style={{ background: sm.bg, color: sm.fg }}
                      >
                        <span
                          className="inline-block w-1.5 h-1.5 rounded-full"
                          style={{ background: sm.dot }}
                        />
                        {sm.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {data.renewals.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 30, textAlign: 'center', color: '#9aa4af' }}>
                    Sin renovaciones próximas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      className="rounded-[14px] p-5"
      style={{ background: 'white', border: '1px solid #e7e9ec', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}
    >
      <div className="text-[11.5px] font-bold uppercase" style={{ color, letterSpacing: 0.5 }}>
        {label}
      </div>
      <div className="m-0 mt-1" style={{ fontSize: 30, fontWeight: 800, letterSpacing: -1, color }}>
        {value}
      </div>
    </div>
  );
}
