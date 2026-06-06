'use client';

/**
 * Card reusable de KPI para los previews de dashboard.
 * NO toca el panel admin real — solo se usa en /admin/dashboard-preview.
 *
 * Props:
 *  - label: texto pequeño arriba (uppercase wrapper aplica visualmente).
 *  - value: número o string destacado en grande.
 *  - sub:   subtítulo o hint debajo del valor.
 *  - icon:  emoji o ReactNode al lado izquierdo (libre, sin lib).
 *  - trend: { dir: 'up' | 'down' | 'flat'; label: string } opcional —
 *           pinta una flecha con color de acuerdo a la dirección.
 *  - tone:  paleta para el valor (verde / ámbar / rojo / azul / neutro).
 *  - variant: 'card' default | 'glass' usa backdrop-blur + bg-white/80 |
 *             'dark' card oscura para el preview MAPA.
 */

import { ReactNode } from 'react';

type Trend = { dir: 'up' | 'down' | 'flat'; label: string };
type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'bad' | 'info';
type Variant = 'card' | 'glass' | 'dark';

export function KpiCard({
  label,
  value,
  sub,
  icon,
  trend,
  tone = 'neutral',
  variant = 'card',
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  icon?: ReactNode;
  trend?: Trend;
  tone?: Tone;
  variant?: Variant;
}) {
  const toneCls: Record<Tone, string> = {
    neutral: 'text-ink',
    brand: 'text-brand',
    ok: 'text-ok',
    warn: 'text-warn',
    bad: 'text-bad',
    info: 'text-info',
  };
  const labelCls: Record<Tone, string> = {
    neutral: 'text-mute',
    brand: 'text-brand',
    ok: 'text-ok',
    warn: 'text-warn',
    bad: 'text-bad',
    info: 'text-info',
  };

  const wrap =
    variant === 'glass'
      ? 'rounded-2xl p-5 backdrop-blur bg-white/80 border border-white/60 shadow-md2 hover:shadow-lg transition-shadow'
      : variant === 'dark'
      ? 'rounded-2xl p-5 bg-slate-800/70 border border-slate-700 text-slate-100'
      : 'rounded-xl p-5 bg-white border border-line2 shadow-sm hover:shadow-md transition-shadow';

  const labelColor = variant === 'dark' ? 'text-slate-300' : labelCls[tone];
  const valueColor = variant === 'dark' ? 'text-white' : toneCls[tone];
  const subColor = variant === 'dark' ? 'text-slate-400' : 'text-mute';

  return (
    <div className={wrap}>
      <div className="flex items-start justify-between gap-3">
        <div className={`text-[11px] uppercase tracking-wider font-semibold ${labelColor}`}>
          {label}
        </div>
        {icon ? <div className="text-base shrink-0 leading-none">{icon}</div> : null}
      </div>
      <div className={`mt-2 text-3xl font-bold tracking-tight ${valueColor}`}>{value}</div>
      <div className="mt-1 flex items-center gap-2 text-[11px]">
        {trend ? <TrendBadge trend={trend} /> : null}
        {sub ? <span className={subColor}>{sub}</span> : null}
      </div>
    </div>
  );
}

function TrendBadge({ trend }: { trend: Trend }) {
  const arrow = trend.dir === 'up' ? '▲' : trend.dir === 'down' ? '▼' : '·';
  const cls =
    trend.dir === 'up'
      ? 'bg-ok-soft text-ok-ink'
      : trend.dir === 'down'
      ? 'bg-bad-soft text-bad-ink'
      : 'bg-gray-100 text-gray-700';
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-pill text-[10px] font-semibold ${cls}`}
    >
      <span aria-hidden>{arrow}</span>
      {trend.label}
    </span>
  );
}
