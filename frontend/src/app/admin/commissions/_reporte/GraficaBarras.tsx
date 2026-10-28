'use client';
import { usd } from './lib';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Barras por mes: comisiones del mes y, encima, la parte ya pagada. SVG propio:
 * el panel no tiene librería de gráficas y para dos series no hace falta una.
 * Se escala al ancho del contenedor (viewBox) y se puede leer en el celular.
 */
export function GraficaBarras({ datos }: { datos: Array<{ mes: string; comisionesUsd: number; pagadoUsd: number }> }) {
  if (datos.length === 0) {
    return <p className="text-sm text-mute py-6 text-center">Sin comisiones en el período.</p>;
  }
  const ultimos = datos.slice(-12);
  const max = Math.max(...ultimos.map((d) => d.comisionesUsd), 1);
  const ancho = 640;
  const alto = 220;
  const pie = 28;
  const arriba = 18;
  const hueco = ancho / ultimos.length;
  const barra = Math.min(48, hueco * 0.6);
  const escala = (v: number) => ((alto - pie - arriba) * v) / max;

  return (
    <div>
      <svg viewBox={`0 0 ${ancho} ${alto}`} className="w-full h-auto" role="img" aria-label="Comisiones por mes">
        <line x1={0} x2={ancho} y1={alto - pie} y2={alto - pie} stroke="#E5E7EB" />
        {ultimos.map((d, i) => {
          const x = i * hueco + (hueco - barra) / 2;
          const hC = escala(d.comisionesUsd);
          const hP = escala(Math.min(d.pagadoUsd, d.comisionesUsd));
          const [y, m] = d.mes.split('-');
          return (
            <g key={d.mes}>
              <title>{`${MESES[Number(m) - 1]} ${y}: ${usd(d.comisionesUsd)} en comisiones, ${usd(d.pagadoUsd)} pagado`}</title>
              <rect x={x} y={alto - pie - hC} width={barra} height={hC} rx={4} fill="#BBF7D0" />
              <rect x={x} y={alto - pie - hP} width={barra} height={hP} rx={4} fill="#22C55E" />
              <text x={x + barra / 2} y={alto - pie - hC - 5} textAnchor="middle" fontSize={11} fill="#374151">
                {d.comisionesUsd >= 1000 ? `${(d.comisionesUsd / 1000).toFixed(1)}k` : Math.round(d.comisionesUsd)}
              </text>
              <text x={x + barra / 2} y={alto - 9} textAnchor="middle" fontSize={11} fill="#6B7280">
                {MESES[Number(m) - 1]}
                {ultimos.length <= 6 ? ` ${y.slice(2)}` : ''}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex gap-4 text-xs text-mute mt-1">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm" style={{ background: '#BBF7D0' }} /> Comisiones
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm" style={{ background: '#22C55E' }} /> Pagado
        </span>
      </div>
    </div>
  );
}

/** Barras horizontales por equipo (comisionado y pagado). */
export function BarrasPorEquipo({
  equipos,
}: {
  equipos: Array<{ etiqueta: string; comisionesUsd: number; pagadoUsd: number }>;
}) {
  const max = Math.max(...equipos.map((e) => e.comisionesUsd), 1);
  return (
    <div className="space-y-3">
      {equipos.map((e) => (
        <div key={e.etiqueta}>
          <div className="flex justify-between text-xs mb-1 gap-2">
            <span className="font-medium text-ink truncate">{e.etiqueta}</span>
            <span className="text-mute whitespace-nowrap">
              {usd(e.comisionesUsd)} · pagado {usd(e.pagadoUsd)}
            </span>
          </div>
          <div className="h-3 rounded-full bg-bg2 overflow-hidden relative">
            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(e.comisionesUsd / max) * 100}%`, background: '#BBF7D0' }} />
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${(Math.min(e.pagadoUsd, e.comisionesUsd) / max) * 100}%`, background: '#22C55E' }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
