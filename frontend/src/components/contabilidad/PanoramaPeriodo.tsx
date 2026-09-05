'use client';

/**
 * PANORAMA DEL PERÍODO — lo primero que se ve al abrir Contabilidad.
 *
 * Responde tres preguntas en este orden: cuánto entró y cuánto quedó, en qué se
 * fue lo que no quedó, y cómo viene la cosa mes a mes. Todo del período que
 * manda arriba: se COMPARA con el anterior (variación al lado de cada cifra),
 * pero los dos períodos nunca se suman.
 *
 * Colores: los cuatro costos van en la paleta categórica validada del proyecto
 * (azul, naranja, aguamarina, amarillo — separación CVD comprobada). La UTILIDAD
 * no es una categoría más sino un estado —verde si queda, rojo si falta— y por
 * eso lleva el color de estado del panel. Aguamarina y amarillo quedan por
 * debajo de 3:1 contra el blanco, así que cada segmento va SIEMPRE con su
 * etiqueta y su cifra: el color acompaña, nunca es el único dato.
 */

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export const money = (n: number | null | undefined) =>
  n == null
    ? '—'
    : (n < 0 ? '-$' : '$') +
      Math.abs(n).toLocaleString('es-CO', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

export type Cascada = {
  grossUsd: number;
  gatewayFeeUsd: number;
  taxUsd: number;
  netUsd: number;
  netReceivedUsd: number;
  egresosUsd: number;
  nominaUsd: number;
  comisionesUsd: number;
  utilidadUsd: number;
  ingresosCount: number;
};

export type Panorama = {
  period: string;
  resumen: Cascada;
  anterior: { period: string; resumen: Cascada | null } | null;
  serie: Array<{
    period: string;
    grossUsd: number;
    netUsd: number;
    egresosUsd: number;
    nominaUsd: number;
    comisionesUsd: number;
    utilidadUsd: number;
  }>;
  porPasarela: Array<{ gateway: string; grossUsd: number; count: number }>;
};

const COSTO = [
  { k: 'feeImp', label: 'Fee + impuestos', color: '#2a78d6' },
  { k: 'egresosUsd', label: 'Egresos', color: '#eb6834' },
  { k: 'nominaUsd', label: 'Nómina', color: '#1baf7a' },
  { k: 'comisionesUsd', label: 'Comisiones', color: '#eda100' },
] as const;

const MES_CORTO = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];
const etiquetaMes = (p: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(p);
  return m ? `${MES_CORTO[Number(m[2]) - 1]} ${m[1].slice(2)}` : p;
};

/** Variación contra el período anterior. `null` cuando no hay con qué comparar. */
function Variacion({
  actual,
  previo,
  contra,
  masEsMejor = true,
}: {
  actual: number;
  previo: number | null | undefined;
  contra: string;
  masEsMejor?: boolean;
}) {
  if (previo == null) return null;
  const dif = actual - previo;
  // Sin base no hay porcentaje que valga: de $0 a $200 no es "+∞%".
  const pct = previo === 0 ? null : Math.round((dif / Math.abs(previo)) * 100);
  if (Math.abs(dif) < 0.01) {
    return <span className="text-[11px] text-mute">igual que {contra}</span>;
  }
  const bueno = masEsMejor ? dif > 0 : dif < 0;
  return (
    <span className={`text-[11px] font-semibold ${bueno ? 'text-ok' : 'text-red-600'}`}>
      {dif > 0 ? '▲' : '▼'} {pct == null ? money(Math.abs(dif)) : `${Math.abs(pct)}%`}{' '}
      <span className="font-normal text-mute">vs {contra}</span>
    </span>
  );
}

function Tarjeta({
  label,
  valor,
  sub,
  children,
  destacada,
}: {
  label: string;
  valor: string;
  sub?: string;
  children?: React.ReactNode;
  destacada?: boolean;
}) {
  return (
    <div className={`card card-pad ${destacada ? 'border-brand' : ''}`}>
      <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-1">{label}</div>
      <div className="text-2xl font-bold tabular-nums leading-tight">{valor}</div>
      {sub && <div className="text-[11px] text-mute mt-0.5">{sub}</div>}
      {children && <div className="mt-1">{children}</div>}
    </div>
  );
}

export function PanoramaPeriodo({
  datos,
  nombrePeriodo,
  nombreAnterior,
  onIrAMes,
}: {
  datos: Panorama;
  nombrePeriodo: string;
  nombreAnterior: string | null;
  onIrAMes: (periodo: string) => void;
}) {
  const r = datos.resumen;
  const prev = datos.anterior?.resumen ?? null;
  const contra = nombreAnterior ?? '';
  const feeImp = r.gatewayFeeUsd + r.taxUsd;
  const costos = feeImp + r.egresosUsd + r.nominaUsd + r.comisionesUsd;
  const margen = r.grossUsd > 0 ? Math.round((r.utilidadUsd / r.grossUsd) * 100) : null;

  const partes = [
    { label: COSTO[0].label, color: COSTO[0].color, valor: feeImp },
    { label: COSTO[1].label, color: COSTO[1].color, valor: r.egresosUsd },
    { label: COSTO[2].label, color: COSTO[2].color, valor: r.nominaUsd },
    { label: COSTO[3].label, color: COSTO[3].color, valor: r.comisionesUsd },
    {
      label: 'Utilidad',
      color: r.utilidadUsd >= 0 ? '#16A34A' : '#DC2626',
      valor: Math.max(r.utilidadUsd, 0),
    },
  ].filter((p) => p.valor > 0);
  const totalBarra = partes.reduce((a, p) => a + p.valor, 0);

  const serie = datos.serie.map((s) => ({ ...s, label: etiquetaMes(s.period) }));
  const hayAlgo = r.grossUsd > 0 || costos > 0;

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Tarjeta
          label="Ventas brutas"
          valor={money(r.grossUsd)}
          sub={`${r.ingresosCount} ${r.ingresosCount === 1 ? 'cobro' : 'cobros'}`}
        >
          <Variacion actual={r.grossUsd} previo={prev?.grossUsd} contra={contra} />
        </Tarjeta>
        <Tarjeta label="Neto esperado" valor={money(r.netUsd)} sub="después de fee e impuestos">
          <Variacion actual={r.netUsd} previo={prev?.netUsd} contra={contra} />
        </Tarjeta>
        <Tarjeta label="Costos del período" valor={money(costos)} sub="fee, impuestos, egresos, nómina y comisiones">
          <Variacion actual={costos} previo={prev ? prev.gatewayFeeUsd + prev.taxUsd + prev.egresosUsd + prev.nominaUsd + prev.comisionesUsd : null} contra={contra} masEsMejor={false} />
        </Tarjeta>
        <Tarjeta
          destacada
          label="Utilidad"
          valor={money(r.utilidadUsd)}
          sub={margen == null ? 'sin ventas en el período' : `margen ${margen}% de lo bruto`}
        >
          <Variacion actual={r.utilidadUsd} previo={prev?.utilidadUsd} contra={contra} />
        </Tarjeta>
      </div>

      {!hayAlgo ? (
        <div className="card card-pad text-center text-mute">
          No hubo movimiento en <span className="capitalize">{nombrePeriodo}</span>.
        </div>
      ) : (
        <>
          <div className="grid lg:grid-cols-2 gap-4 mb-4">
            {/* ── En qué se va lo que entra ── */}
            <div className="card card-pad">
              <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-1">
                En qué se va lo que entra
              </div>
              <p className="text-[11px] text-mute mb-3">
                De <strong className="text-ink">{money(r.grossUsd)}</strong> brutos en{' '}
                <span className="capitalize">{nombrePeriodo}</span>.
              </p>
              {totalBarra === 0 ? (
                <p className="text-sm text-mute">Sin costos ni utilidad que repartir.</p>
              ) : (
                <>
                  {/* 2px de separación entre segmentos: el corte se ve aunque
                      dos colores contiguos se parezcan. */}
                  <div className="flex gap-[2px] h-7 rounded-md overflow-hidden mb-3">
                    {partes.map((p) => (
                      <div
                        key={p.label}
                        style={{ width: `${(p.valor / totalBarra) * 100}%`, background: p.color }}
                        title={`${p.label}: ${money(p.valor)}`}
                      />
                    ))}
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {partes.map((p) => (
                      <li key={p.label} className="flex items-center gap-2 text-sm">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: p.color }} />
                        <span className="flex-1 text-mute">{p.label}</span>
                        <span className="tabular-nums font-medium">{money(p.valor)}</span>
                        <span className="tabular-nums text-mute2 text-xs w-12 text-right">
                          {Math.round((p.valor / totalBarra) * 100)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                  {r.utilidadUsd < 0 && (
                    <p className="text-xs text-red-600 mt-3 font-semibold">
                      El período cierra en pérdida: {money(r.utilidadUsd)}.
                    </p>
                  )}
                </>
              )}
            </div>

            {/* ── Cascada de utilidad ── */}
            <div className="card card-pad">
              <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-3">
                Cascada de utilidad · <span className="capitalize">{nombrePeriodo}</span>
              </div>
              <div className="flex justify-between py-1.5 text-sm"><span className="text-mute">Ingresos brutos</span><span className="tabular-nums font-medium">{money(r.grossUsd)}</span></div>
              <div className="flex justify-between py-1.5 text-sm"><span className="text-mute">− Fee pasarela + impuestos</span><span className="tabular-nums text-red-600">−{money(feeImp)}</span></div>
              <div className="flex justify-between py-1.5 text-sm border-t border-line2"><span className="font-semibold">= Neto</span><span className="tabular-nums font-semibold">{money(r.netUsd)}</span></div>
              <div className="flex justify-between py-1.5 text-sm"><span className="text-mute">− Egresos</span><span className="tabular-nums text-red-600">−{money(r.egresosUsd)}</span></div>
              <div className="flex justify-between py-1.5 text-sm"><span className="text-mute">− Nómina</span><span className="tabular-nums text-red-600">−{money(r.nominaUsd)}</span></div>
              <div className="flex justify-between py-1.5 text-sm"><span className="text-mute">− Comisiones afiliados</span><span className="tabular-nums text-red-600">−{money(r.comisionesUsd)}</span></div>
              <div className="flex justify-between py-2.5 mt-1 border-t-2 border-line2"><span className="font-bold">= UTILIDAD</span><span className={`tabular-nums font-bold text-lg ${r.utilidadUsd >= 0 ? 'text-ok' : 'text-red-600'}`}>{money(r.utilidadUsd)}</span></div>
              <p className="text-[11px] text-mute mt-2">
                Neto recibido y conciliado: <strong className="text-ink">{money(r.netReceivedUsd)}</strong>.
              </p>
            </div>
          </div>

          {/* ── Evolución mes a mes ── */}
          <div className="card card-pad mb-4">
            <div className="flex items-baseline justify-between gap-2 flex-wrap mb-1">
              <div className="text-xs uppercase tracking-wider text-mute font-semibold">Mes a mes</div>
              <span className="text-[11px] text-mute">Toca una barra para abrir ese mes</span>
            </div>
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <ComposedChart data={serie} margin={{ top: 12, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#E8E8E4" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#8A8A80' }} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={64}
                    tick={{ fontSize: 11, fill: '#8A8A80' }}
                    tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`)}
                  />
                  <Tooltip
                    formatter={(v, n) => [money(Number(v)), String(n)]}
                    labelFormatter={(l) => `Mes de ${String(l)}`}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E8E8E4' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    name="Ingresos brutos"
                    dataKey="grossUsd"
                    fill="#2a78d6"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={44}
                    cursor="pointer"
                    onClick={(d) => {
                      // recharts entrega el punto con su payload; de ahí sale el mes.
                      const p = (d as { payload?: { period?: string } })?.payload?.period;
                      if (p) onIrAMes(p);
                    }}
                  />
                  <Line
                    name="Utilidad"
                    type="monotone"
                    dataKey="utilidadUsd"
                    stroke="#1F2933"
                    strokeWidth={2}
                    dot={{ r: 4, fill: '#1F2933' }}
                    activeDot={{ r: 6 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── De dónde entró ── */}
          {datos.porPasarela.length > 0 && (
            <div className="card card-pad mb-4">
              <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-3">
                De dónde entró · <span className="capitalize">{nombrePeriodo}</span>
              </div>
              <ul className="flex flex-col gap-2">
                {datos.porPasarela.map((p) => {
                  const tope = datos.porPasarela[0].grossUsd || 1;
                  return (
                    <li key={p.gateway} className="flex items-center gap-3 text-sm">
                      <span className="w-28 shrink-0 font-medium">{p.gateway}</span>
                      <span className="flex-1 h-2.5 bg-bg2 rounded-pill overflow-hidden">
                        <span
                          className="block h-full rounded-pill"
                          style={{ width: `${Math.max((p.grossUsd / tope) * 100, 2)}%`, background: '#2a78d6' }}
                        />
                      </span>
                      <span className="tabular-nums font-medium w-24 text-right">{money(p.grossUsd)}</span>
                      <span className="tabular-nums text-mute text-xs w-16 text-right">
                        {p.count} {p.count === 1 ? 'cobro' : 'cobros'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </>
  );
}
