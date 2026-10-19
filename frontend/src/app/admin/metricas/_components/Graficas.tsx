'use client';
import { useState } from 'react';

/**
 * Gráficas de /admin/metricas en SVG propio, como `GraficaBarras` de
 * /reporte-comisiones: el panel no tiene librería de gráficas y para esto no
 * hace falta una. Se escalan al ancho (viewBox) y se leen en el celular.
 *
 * Los tramos son días o semanas (lo decide el backend según el largo del
 * rango); la etiqueta del eje X se adapta a eso.
 */

export type Tramo = { desde: string; hasta: string };

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function diaCorto(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number);
  return `${d} ${MESES[m - 1]}`;
}

export function etiquetaTramo(t: Tramo): string {
  return t.desde === t.hasta ? diaCorto(t.desde) : `${diaCorto(t.desde)} – ${diaCorto(t.hasta)}`;
}

const fmt = (v: number) =>
  v >= 10_000 ? `${(v / 1000).toFixed(0)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));

/** Máximo «redondo» para el eje Y, con 4 divisiones enteras. */
function techo(max: number): number {
  if (max <= 4) return 4;
  const paso = Math.pow(10, Math.floor(Math.log10(max / 4)));
  for (const k of [1, 2, 2.5, 5, 10]) {
    const cand = Math.ceil(max / 4 / (paso * k)) * paso * k * 4;
    if (cand >= max) return cand;
  }
  return max;
}

const ANCHO = 720;
const ALTO = 240;
const IZQ = 40;
const DER = 12;
const ARRIBA = 14;
const PIE = 30;

function Ejes({ max, n, tramos }: { max: number; n: number; tramos: Tramo[] }) {
  const alto = ALTO - ARRIBA - PIE;
  const hueco = (ANCHO - IZQ - DER) / Math.max(n, 1);
  // Como mucho ~8 etiquetas en X: con 30 días, una cada 4.
  const cada = Math.max(1, Math.ceil(n / 8));
  return (
    <g>
      {[0, 1, 2, 3, 4].map((i) => {
        const y = ARRIBA + alto - (alto * i) / 4;
        return (
          <g key={i}>
            <line x1={IZQ} x2={ANCHO - DER} y1={y} y2={y} stroke={i === 0 ? '#D1D5DB' : '#EEF0F3'} />
            <text x={IZQ - 6} y={y + 4} textAnchor="end" fontSize={11} fill="#6B7280">
              {fmt((max * i) / 4)}
            </text>
          </g>
        );
      })}
      {tramos.map((t, i) =>
        i % cada === 0 ? (
          <text
            key={t.desde}
            x={IZQ + hueco * i + hueco / 2}
            y={ALTO - 10}
            textAnchor="middle"
            fontSize={11}
            fill="#6B7280"
          >
            {diaCorto(t.desde)}
          </text>
        ) : null,
      )}
    </g>
  );
}

/** Barras de una sola serie (pases, clientes, pedidos…). */
export function GraficaSerie({
  tramos,
  valores,
  color = '#22C55E',
  unidad,
}: {
  tramos: Tramo[];
  valores: number[];
  color?: string;
  unidad: string;
}) {
  if (tramos.length === 0) return null;
  const max = techo(Math.max(...valores, 0));
  const alto = ALTO - ARRIBA - PIE;
  const hueco = (ANCHO - IZQ - DER) / tramos.length;
  const barra = Math.max(2, Math.min(36, hueco * 0.7));
  return (
    <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} className="w-full h-auto" role="img" aria-label={`${unidad} por tramo`}>
      <Ejes max={max} n={tramos.length} tramos={tramos} />
      {tramos.map((t, i) => {
        const h = (alto * valores[i]) / max;
        const x = IZQ + hueco * i + (hueco - barra) / 2;
        return (
          <g key={t.desde}>
            <title>{`${etiquetaTramo(t)}: ${valores[i].toLocaleString('es-CO')} ${unidad}`}</title>
            {/* Franja invisible para que el tooltip salga también en los días en 0. */}
            <rect x={IZQ + hueco * i} y={ARRIBA} width={hueco} height={alto} fill="transparent" />
            <rect x={x} y={ARRIBA + alto - h} width={barra} height={h} rx={Math.min(3, barra / 2)} fill={color} />
          </g>
        );
      })}
    </svg>
  );
}

export type Serie = { clave: string; etiqueta: string; color: string; valores: number[] };

/**
 * Líneas de varias series sobre el mismo eje (pases, sellos y pedidos por
 * día). Cada serie se puede apagar desde la leyenda: los sellos suelen ser
 * diez veces más que los pedidos y aplastan la línea de abajo; al apagarlos el
 * eje se reescala.
 */
export function GraficaCombinada({ tramos, series }: { tramos: Tramo[]; series: Serie[] }) {
  const [apagadas, setApagadas] = useState<Set<string>>(new Set());
  if (tramos.length === 0) return null;
  const visibles = series.filter((s) => !apagadas.has(s.clave));
  const max = techo(Math.max(0, ...visibles.flatMap((s) => s.valores)));
  const alto = ALTO - ARRIBA - PIE;
  const hueco = (ANCHO - IZQ - DER) / tramos.length;
  const x = (i: number) => IZQ + hueco * i + hueco / 2;
  const y = (v: number) => ARRIBA + alto - (alto * v) / max;

  return (
    <div>
      <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} className="w-full h-auto" role="img" aria-label="Pases, sellos y pedidos por tramo">
        <Ejes max={max} n={tramos.length} tramos={tramos} />
        {visibles.map((s) => (
          <g key={s.clave}>
            <polyline
              points={s.valores.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth={2.25}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {tramos.length <= 45 &&
              s.valores.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={2.75} fill={s.color} />)}
          </g>
        ))}
        {tramos.map((t, i) => (
          <rect key={t.desde} x={IZQ + hueco * i} y={ARRIBA} width={hueco} height={alto} fill="transparent">
            <title>
              {`${etiquetaTramo(t)}\n` +
                series.map((s) => `${s.etiqueta}: ${s.valores[i].toLocaleString('es-CO')}`).join('\n')}
            </title>
          </rect>
        ))}
      </svg>
      <div className="flex gap-2 flex-wrap mt-2">
        {series.map((s) => {
          const off = apagadas.has(s.clave);
          return (
            <button
              key={s.clave}
              type="button"
              aria-pressed={!off}
              onClick={() =>
                setApagadas((prev) => {
                  const n = new Set(prev);
                  if (n.has(s.clave)) n.delete(s.clave);
                  else n.add(s.clave);
                  return n;
                })
              }
              className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${
                off ? 'border-line text-mute2 line-through' : 'border-line text-ink'
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: off ? '#D1D5DB' : s.color }} />
              {s.etiqueta}
            </button>
          );
        })}
      </div>
    </div>
  );
}
