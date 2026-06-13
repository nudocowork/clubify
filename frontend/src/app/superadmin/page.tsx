'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

type DashboardData = {
  summary: {
    whiteLabels: number;
    whiteLabelsActive: number;
    whiteLabelsSuspended: number;
    tenantsActive: number;
    tenantsSuspended: number;
    tenantsPending: number;
    creditsAvailable: number;
    creditsCommitted: number;
    creditsUsed: number;
    renewals7d: number;
  };
  alerts: { type: string; title: string; body: string; link: string; kind: 'warning' | 'success' }[];
  whiteLabels: any[];
};

function fmt(n: number) {
  return n.toLocaleString('es-MX');
}

function fmtLongDate(d = new Date()) {
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', weekday: 'long' });
}

export default function SuperAdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<DashboardData>('/superadmin/dashboard')
      .then(setData)
      .catch((e: any) => setError(e.message ?? 'Error'));
  }, []);

  if (error)
    return (
      <div className="text-sm" style={{ color: '#b91c1c' }}>
        {error}
      </div>
    );
  if (!data) return <div className="text-sm" style={{ color: '#6b7785' }}>Cargando…</div>;

  const s = data.summary;

  return (
    <div>
      <div className="text-[11.5px] font-bold mb-3" style={{ letterSpacing: 0.8, color: '#9aa4af' }}>
        PANORAMA GLOBAL
        <span className="float-right" style={{ color: '#9aa4af', fontWeight: 600 }}>
          {data.alerts.length} ALERTAS
        </span>
      </div>

      {/* Alertas (2 cards) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {data.alerts.length === 0 && (
          <div className="rounded-[14px] p-4 text-sm" style={{ background: 'white', border: '1px solid #e7e9ec', color: '#6b7785' }}>
            Sin alertas activas.
          </div>
        )}
        {data.alerts.map((a, i) => {
          const isWarning = a.kind === 'warning';
          return (
            <div
              key={i}
              className="rounded-[14px] p-4"
              style={{
                background: 'white',
                border: `1.5px solid ${isWarning ? '#f5b545' : '#bbf7d0'}`,
                boxShadow: '0 1px 2px rgba(16,24,40,.04)',
              }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-10 h-10 rounded-[10px] flex items-center justify-center text-base"
                  style={{
                    background: isWarning ? '#fef3c7' : '#dcfce7',
                    color: isWarning ? '#b45309' : '#15803d',
                  }}
                >
                  {isWarning ? '⚠' : '💡'}
                </div>
                <div className="flex-1 min-w-0">
                  <span
                    className="inline-block text-[10.5px] font-bold px-2 py-0.5 rounded-full uppercase mb-1.5"
                    style={{
                      background: isWarning ? '#fef3c7' : '#dcfce7',
                      color: isWarning ? '#b45309' : '#15803d',
                      letterSpacing: 0.5,
                    }}
                  >
                    {a.type}
                  </span>
                  <div className="font-bold text-[15.5px] leading-tight" style={{ color: '#16241c' }}>
                    {a.title}
                  </div>
                  <div className="text-sm mt-1.5 leading-snug" style={{ color: '#2b3a30' }}>
                    {a.body}
                  </div>
                  <Link
                    href={a.link}
                    className="inline-block mt-2 text-sm font-semibold"
                    style={{ color: '#16a34a' }}
                  >
                    {isWarning ? 'Ver pendientes →' : 'Ver créditos →'}
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Header */}
      <div className="flex items-end justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h1
            className="m-0"
            style={{ fontSize: 26, fontWeight: 800, color: '#16241c', letterSpacing: -0.6 }}
          >
            Panel Super Admin{' '}
            <span style={{ color: '#9aa4af', fontWeight: 500 }}>/ {fmtLongDate()}</span>
          </h1>
        </div>
        <div className="flex gap-2">
          <Link
            href="/superadmin/historial"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-sm font-semibold"
            style={{ background: 'white', border: '1px solid #d7dbe0', color: '#2b3a30' }}
          >
            🕒 Historial
          </Link>
          <Link
            href="/superadmin/marcas?crear=1"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] text-sm font-bold text-white"
            style={{
              background: 'linear-gradient(180deg, #28c95f, #16a34a)',
              boxShadow: '0 2px 6px rgba(22,163,74,.35)',
            }}
          >
            + Crear Marca Blanca
          </Link>
        </div>
      </div>

      <div className="text-[12px] font-bold uppercase mb-3" style={{ letterSpacing: 0.8, color: '#9aa4af' }}>
        Resumen de la Plataforma
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCardLarge
          label="Marcas Blancas"
          value={fmt(s.whiteLabels)}
          color="#16a34a"
          sub={`${s.whiteLabelsActive} activa${s.whiteLabelsActive === 1 ? '' : 's'} · ${s.whiteLabelsSuspended} suspendida${s.whiteLabelsSuspended === 1 ? '' : 's'}`}
          icon="🏛"
        />
        <StatCardLarge
          label="Negocios Activos"
          value={fmt(s.tenantsActive)}
          color="#16a34a"
          sub={`${s.tenantsSuspended} suspendidos en total`}
          icon="🏪"
        />
        <StatCardLarge
          label="Créditos en Red"
          value={fmt(s.creditsAvailable)}
          color="#2563eb"
          sub={`${fmt(s.creditsCommitted)} comprometidos`}
          icon="💳"
        />
        <StatCardLarge
          label="Facturación 30D"
          value="$0"
          color="#16a34a"
          sub="(pendiente — datos de Hotmart)"
          icon="📈"
        />
      </div>

      <div className="text-[12px] font-bold uppercase mb-3" style={{ letterSpacing: 0.8, color: '#9aa4af' }}>
        Créditos y Renovaciones
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5 mb-6">
        <StatCardSmall label="Vendidos (mes)" value={fmt(s.creditsUsed)} color="#16a34a" />
        <StatCardSmall label="Consumidos" value={fmt(s.creditsUsed)} color="#16a34a" />
        <StatCardSmall label="Comprometidos" value={fmt(s.creditsCommitted)} color="#2563eb" />
        <StatCardSmall label="Renov. 7d" value={fmt(s.renewals7d)} color="#16a34a" />
        <StatCardSmall label="En gracia" value={fmt(s.tenantsPending)} color="#b45309" />
        <StatCardSmall label="Pendientes" value={fmt(s.tenantsPending)} color="#b91c1c" />
      </div>

      {/* Top marcas + Actividad */}
      <div className="grid lg:grid-cols-[1.15fr_1fr] gap-4">
        <div className="rounded-[14px]" style={{ background: 'white', border: '1px solid #e7e9ec', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}>
          <div className="px-5 py-4 border-b" style={{ borderColor: '#eef0f2' }}>
            <div className="text-[15px] font-bold" style={{ color: '#18221d' }}>
              Top marcas blancas · 30 días
            </div>
          </div>
          <div className="p-5 space-y-3">
            {data.whiteLabels.slice(0, 6).map((w) => {
              const total = w.creditsAvailable + w.creditsUsed;
              const pct = total > 0 ? Math.round((w.creditsUsed / total) * 100) : 0;
              return (
                <div key={w.id} className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-[10px] flex items-center justify-center text-white text-sm font-bold shrink-0"
                    style={{ background: w.primaryColor }}
                  >
                    {w.initial ?? w.name[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-semibold truncate" style={{ color: '#2b3a30' }}>
                        {w.name}
                      </span>
                      <span className="text-xs" style={{ color: '#6b7785' }}>
                        {fmt(w.creditsUsed)} usados
                      </span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: '#eef0f2' }}>
                      <div
                        className="h-full transition-all"
                        style={{ width: `${pct}%`, background: '#22c55e' }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            {data.whiteLabels.length === 0 && (
              <p className="text-sm" style={{ color: '#9aa4af' }}>
                Sin marcas blancas creadas todavía.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-[14px]" style={{ background: 'white', border: '1px solid #e7e9ec', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}>
          <div className="px-5 py-4 border-b" style={{ borderColor: '#eef0f2' }}>
            <div className="text-[15px] font-bold" style={{ color: '#18221d' }}>
              Actividad reciente
            </div>
          </div>
          <div className="p-5 space-y-3 text-sm" style={{ color: '#6b7785' }}>
            <p className="italic">
              Timeline de actividad pendiente — vendría del log de eventos:
              creaciones de marca, asignaciones de créditos, suspensiones, etc.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCardLarge({
  label,
  value,
  color,
  sub,
  icon,
}: {
  label: string;
  value: string;
  color: string;
  sub: string;
  icon: string;
}) {
  return (
    <div
      className="rounded-[14px] p-5"
      style={{ background: 'white', border: '1px solid #e7e9ec', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}
    >
      <div className="flex items-start justify-between mb-2">
        <div
          className="text-[11.5px] font-bold uppercase"
          style={{ color, letterSpacing: 0.5 }}
        >
          {label}
        </div>
        <span className="text-base">{icon}</span>
      </div>
      <div
        className="m-0"
        style={{ fontSize: 30, fontWeight: 800, letterSpacing: -1, color }}
      >
        {value}
      </div>
      <div className="text-xs mt-1.5" style={{ color: '#6b7785' }}>
        {sub}
      </div>
    </div>
  );
}

function StatCardSmall({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      className="rounded-[14px] p-4"
      style={{ background: 'white', border: '1px solid #e7e9ec', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}
    >
      <div className="text-[11px] font-bold uppercase" style={{ color, letterSpacing: 0.5 }}>
        {label}
      </div>
      <div className="m-0 mt-1" style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.5, color }}>
        {value}
      </div>
    </div>
  );
}
