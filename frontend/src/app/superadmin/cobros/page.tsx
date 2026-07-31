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

type RenewalSummary = {
  considered: number;
  renewed: number;
  grace: number;
  suspended: number;
  skipped: number;
  details: Array<{ tenantId: string; brandName: string; action: string; reason?: string }>;
};

export default function CobrosPage() {
  const [data, setData] = useState<BillingData | null>(null);
  const [preview, setPreview] = useState<RenewalSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // PDF 1256 §2/§7: período de gracia (días de mora antes de pausar) configurable.
  const [graceInput, setGraceInput] = useState<string>('');
  const [graceSaving, setGraceSaving] = useState(false);

  function flashToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  }

  async function loadBilling() {
    const d = await api<BillingData>('/superadmin/billing');
    setData(d);
  }
  useEffect(() => {
    loadBilling().catch((e) => console.error(e));
    api<{ graceDays: number }>('/billing/grace-days')
      .then((g) => setGraceInput(String(g.graceDays)))
      .catch(() => null);
  }, []);

  async function saveGrace() {
    const n = parseInt(graceInput, 10);
    if (!Number.isFinite(n) || n < 1 || n > 30) {
      flashToast('Ingresa un número entre 1 y 30');
      return;
    }
    setGraceSaving(true);
    try {
      const g = await api<{ graceDays: number }>('/billing/grace-days', {
        method: 'PATCH',
        body: JSON.stringify({ graceDays: n }),
      });
      setGraceInput(String(g.graceDays));
      flashToast(`Período de gracia: ${g.graceDays} días`);
    } catch (e: any) {
      flashToast(e.message ?? 'Error');
    } finally {
      setGraceSaving(false);
    }
  }

  async function loadPreview() {
    setBusy(true);
    try {
      const p = await api<RenewalSummary>('/superadmin/renewals/preview');
      setPreview(p);
    } catch (e: any) {
      flashToast(e.message ?? 'Error');
    } finally {
      setBusy(false);
    }
  }

  async function runReal() {
    if (!confirm('¿Correr el cron de renovaciones AHORA? Va a consumir créditos y suspender tenants vencidos.')) return;
    setBusy(true);
    try {
      const r = await api<RenewalSummary>('/superadmin/renewals/run', { method: 'POST' });
      flashToast(`Renovaciones: ${r.renewed} renovadas · ${r.grace} en gracia · ${r.suspended} suspendidas`);
      setPreview(r);
      loadBilling();
    } catch (e: any) {
      flashToast(e.message ?? 'Error');
    } finally {
      setBusy(false);
    }
  }

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

      {/* PDF 1256 §2/§7: período de gracia configurable */}
      <div
        className="rounded-[14px] p-5 mb-6 flex flex-wrap items-end gap-4"
        style={{ background: 'white', border: '1px solid #e7e9ec', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}
      >
        <div>
          <div className="text-[12px] font-bold uppercase mb-1" style={{ letterSpacing: 0.6, color: '#9aa4af' }}>
            Período de gracia (días)
          </div>
          <div className="text-xs mb-2" style={{ color: '#6b7785' }}>
            Días de mora antes de pausar una cuenta por falta de pago. Ej: 1, 3, 5, 7.
          </div>
          <input
            type="number"
            min={1}
            max={30}
            value={graceInput}
            onChange={(e) => setGraceInput(e.target.value)}
            className="rounded-[10px] px-3 py-2 text-sm"
            style={{ border: '1px solid #d7dbe0', width: 120 }}
          />
        </div>
        <button
          onClick={saveGrace}
          disabled={graceSaving}
          className="px-4 py-2 rounded-[10px] text-sm font-bold text-white disabled:opacity-60"
          style={{ background: 'linear-gradient(180deg, #28c95f, #16a34a)' }}
        >
          {graceSaving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>

      {/* Cron de renovaciones automáticas */}
      <div
        className="rounded-[14px] p-5 mb-6"
        style={{
          background: 'linear-gradient(135deg, #064e3b, #0a2c1a)',
          color: 'white',
          boxShadow: '0 4px 20px rgba(6,78,59,.25)',
        }}
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-[10.5px] font-bold uppercase opacity-80" style={{ letterSpacing: 0.8 }}>
              Auto-Renovaciones
            </div>
            <div className="text-lg font-extrabold mt-1">
              Cron diario · 02:00 UTC
            </div>
            <div className="text-xs opacity-80 mt-1 leading-snug max-w-xl">
              Cada día consume 1 crédito por tenant que cumple ciclo. 5 días de gracia
              si la marca queda sin créditos. Después, suspensión automática.
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={loadPreview}
              disabled={busy}
              className="text-sm font-semibold px-3 py-2 rounded-[10px]"
              style={{
                background: 'rgba(255,255,255,.12)',
                color: 'white',
                border: '1px solid rgba(255,255,255,.2)',
              }}
            >
              👁 Preview (dry-run)
            </button>
            <button
              onClick={runReal}
              disabled={busy}
              className="text-sm font-bold px-4 py-2 rounded-[10px] text-white"
              style={{
                background: 'linear-gradient(180deg, #28c95f, #16a34a)',
                boxShadow: '0 2px 6px rgba(22,163,74,.35)',
              }}
            >
              ▶ Correr ahora
            </button>
          </div>
        </div>

        {preview && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            <PreviewCard label="Considerados" value={preview.considered} />
            <PreviewCard label="Renovados" value={preview.renewed} color="#86efac" />
            <PreviewCard label="En gracia" value={preview.grace} color="#fcd34d" />
            <PreviewCard label="Suspendidos" value={preview.suspended} color="#fca5a5" />
          </div>
        )}

        {preview && preview.details.length > 0 && (
          <div className="mt-4 max-h-60 overflow-y-auto rounded-lg" style={{ background: 'rgba(0,0,0,.15)' }}>
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0" style={{ background: 'rgba(0,0,0,.4)' }}>
                <tr>
                  <th className="px-3 py-2 font-semibold opacity-80">Tenant</th>
                  <th className="px-3 py-2 font-semibold opacity-80">Acción</th>
                  <th className="px-3 py-2 font-semibold opacity-80">Razón</th>
                </tr>
              </thead>
              <tbody>
                {preview.details.slice(0, 50).map((d, i) => (
                  <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,.05)' }}>
                    <td className="px-3 py-1.5 font-semibold">{d.brandName}</td>
                    <td className="px-3 py-1.5">
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded"
                        style={{
                          background:
                            d.action === 'RENEWED'
                              ? 'rgba(34,197,94,.25)'
                              : d.action === 'GRACE'
                              ? 'rgba(251,191,36,.25)'
                              : d.action === 'SUSPENDED'
                              ? 'rgba(239,68,68,.25)'
                              : 'rgba(156,163,175,.25)',
                          color:
                            d.action === 'RENEWED'
                              ? '#86efac'
                              : d.action === 'GRACE'
                              ? '#fcd34d'
                              : d.action === 'SUSPENDED'
                              ? '#fca5a5'
                              : '#d1d5db',
                        }}
                      >
                        {d.action}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 opacity-80">{d.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.details.length > 50 && (
              <div className="text-center text-[11px] py-2 opacity-60">
                Mostrando 50 de {preview.details.length}.
              </div>
            )}
          </div>
        )}
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

      {toast && (
        <div
          className="fixed left-1/2 bottom-7 -translate-x-1/2 px-4 py-2.5 rounded-[10px] text-sm font-semibold shadow-lg z-50"
          style={{ background: '#0f172a', color: 'white', boxShadow: '0 12px 30px rgba(0,0,0,.25)' }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function PreviewCard({ label, value, color = 'white' }: { label: string; value: number; color?: string }) {
  return (
    <div
      className="rounded-[10px] p-3"
      style={{ background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)' }}
    >
      <div className="text-[10px] font-bold uppercase opacity-80" style={{ letterSpacing: 0.5 }}>
        {label}
      </div>
      <div className="text-2xl font-extrabold mt-1" style={{ color }}>
        {value}
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
