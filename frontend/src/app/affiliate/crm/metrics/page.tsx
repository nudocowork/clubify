'use client';

/**
 * /affiliate/crm/metrics — KPIs personales del afiliado (C8).
 * Calculados on-the-fly por el backend desde CrmContact + CrmActivity.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type Metrics = {
  totalContacts: number;
  clientCount: number;
  notInterestedCount: number;
  conversionRate: number;
  avgCloseDays: number | null;
  createdLast30: number;
  byStage: {
    id: string;
    name: string;
    color: string;
    kind: string;
    count: number;
  }[];
  topButtons: { name: string; count: number }[];
};

export default function CrmMetricsPage() {
  const [m, setM] = useState<Metrics | null>(null);

  async function load() {
    try {
      const r = await api<Metrics>('/crm/metrics');
      setM(r);
    } catch (e: any) {
      toast(e?.message || 'Error cargando métricas', 'error');
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (!m) {
    return (
      <div className="space-y-3">
        <div className="h-10 bg-bg2 rounded animate-shimmer" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="h-24 bg-bg2 rounded animate-shimmer" />
          <div className="h-24 bg-bg2 rounded animate-shimmer" />
          <div className="h-24 bg-bg2 rounded animate-shimmer" />
        </div>
      </div>
    );
  }

  const maxStageCount = Math.max(1, ...m.byStage.map((s) => s.count));

  return (
    <div className="max-w-4xl">
      <div className="page-head">
        <h1 className="page-title">
          Métricas <span className="page-crumb">/ CRM</span>
        </h1>
        <Link href="/affiliate/crm" className="btn-ghost text-sm">
          ← Kanban
        </Link>
      </div>

      {/* KPIs principales */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <KpiCard
          label="Contactos totales"
          value={m.totalContacts}
          accent="text-ink"
        />
        <KpiCard
          label="Clientes cerrados"
          value={m.clientCount}
          accent="text-ok-ink"
        />
        <KpiCard
          label="Conversión"
          value={`${m.conversionRate}%`}
          accent="text-brand"
          hint={`${m.clientCount}/${m.totalContacts}`}
        />
        <KpiCard
          label="Tiempo prom. cierre"
          value={m.avgCloseDays != null ? `${m.avgCloseDays}d` : '—'}
          accent="text-ink"
          hint="Días desde creación hasta cierre"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
        <div className="card card-pad">
          <h2 className="font-semibold text-sm mb-3">Contactos por columna</h2>
          <div className="space-y-2">
            {m.byStage.length === 0 ? (
              <div className="text-xs text-mute italic">Sin datos.</div>
            ) : (
              m.byStage.map((s) => (
                <div key={s.id} className="text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2 h-2 rounded-full flex-none"
                        style={{ background: s.color }}
                      />
                      <span className="truncate">{s.name}</span>
                    </div>
                    <strong className="text-mute">{s.count}</strong>
                  </div>
                  <div className="h-1.5 rounded-full bg-bg2 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${(s.count / maxStageCount) * 100}%`,
                        background: s.color,
                      }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card card-pad">
          <h2 className="font-semibold text-sm mb-3">
            🏆 Botones más usados (últimos 90 días)
          </h2>
          {m.topButtons.length === 0 ? (
            <div className="text-xs text-mute italic leading-relaxed">
              Aún no ejecutaste botones. Configurá los tuyos en{' '}
              <Link href="/affiliate/crm/buttons" className="text-brand hover:underline">
                Botones automáticos
              </Link>{' '}
              para ver el ranking acá.
            </div>
          ) : (
            <ol className="space-y-2">
              {m.topButtons.map((b, idx) => (
                <li
                  key={b.name}
                  className="flex items-center justify-between text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] uppercase tracking-wider text-mute font-semibold w-5">
                      {idx + 1}
                    </span>
                    <span className="truncate">{b.name}</span>
                  </div>
                  <strong>{b.count}</strong>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div className="card card-pad">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-mute font-semibold">
              Últimos 30 días
            </div>
            <div className="text-2xl font-bold mt-1">{m.createdLast30}</div>
            <div className="text-xs text-mute">contactos nuevos creados</div>
          </div>
          {m.notInterestedCount > 0 && (
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-mute font-semibold">
                No interesados
              </div>
              <div className="text-2xl font-bold mt-1 text-bad">
                {m.notInterestedCount}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: string | number;
  accent: string;
  hint?: string;
}) {
  return (
    <div className="card card-pad">
      <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
        {label}
      </div>
      <div className={`text-2xl font-bold mt-1 ${accent}`}>{value}</div>
      {hint && <div className="text-[11px] text-mute mt-0.5">{hint}</div>}
    </div>
  );
}
