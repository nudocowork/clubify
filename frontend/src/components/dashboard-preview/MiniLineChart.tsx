'use client';

/**
 * Wrapper de Recharts simplificado para los previews del dashboard.
 * Sirve para mini-line y mini-area. Si se pasa `area`, dibuja un área con
 * gradiente; sino, una línea simple. Tooltip y ejes opcionales.
 *
 * Solo se usa en /admin/dashboard-preview. NO toca panel admin oficial.
 */

import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

export type SeriesPoint = { label: string; value: number };

export function MiniLineChart({
  data,
  height = 160,
  area = false,
  color = '#22C55E',
  showAxes = true,
  showGrid = false,
  showTooltip = true,
  valueFormatter,
}: {
  data: SeriesPoint[];
  height?: number;
  area?: boolean;
  color?: string;
  showAxes?: boolean;
  showGrid?: boolean;
  showTooltip?: boolean;
  valueFormatter?: (n: number) => string;
}) {
  const fmt = valueFormatter ?? ((n: number) => `${n}`);

  if (!data || data.length === 0) {
    return (
      <div
        className="text-xs text-mute flex items-center justify-center"
        style={{ height }}
      >
        Sin datos disponibles
      </div>
    );
  }

  if (area) {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="mlcGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.45} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />}
          {showAxes && (
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              fontSize={11}
              stroke="#9CA3AF"
            />
          )}
          {showAxes && (
            <YAxis
              tickLine={false}
              axisLine={false}
              fontSize={11}
              stroke="#9CA3AF"
              tickFormatter={(v) => fmt(Number(v))}
              width={42}
            />
          )}
          {showTooltip && (
            <Tooltip
              formatter={(v) => fmt(Number(v))}
              contentStyle={{
                borderRadius: 8,
                border: '1px solid #E5E7EB',
                fontSize: 12,
              }}
            />
          )}
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill="url(#mlcGrad)"
          />
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />}
        {showAxes && (
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            fontSize={11}
            stroke="#9CA3AF"
          />
        )}
        {showAxes && (
          <YAxis
            tickLine={false}
            axisLine={false}
            fontSize={11}
            stroke="#9CA3AF"
            tickFormatter={(v) => fmt(Number(v))}
            width={42}
          />
        )}
        {showTooltip && (
          <Tooltip
            formatter={(v) => fmt(Number(v))}
            contentStyle={{
              borderRadius: 8,
              border: '1px solid #E5E7EB',
              fontSize: 12,
            }}
          />
        )}
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2.5}
          dot={{ r: 3, fill: color }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
