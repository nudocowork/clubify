'use client';

/**
 * ANÁLISIS FINANCIERO — la vista con la que abre Contabilidad: todos los meses
 * juntos, sin pestañas y sin elegir un mes (Software Clubify 17, 2026-11-27).
 * Al tocar un mes se entra a la pantalla de siempre, con su barra de pestañas.
 *
 * Una gráfica por pregunta, y ninguna cuenta nueva: cada mes sale de la MISMA
 * cascada que su Resumen (`serieDeMeses` en el backend). Los costos se suman
 * con las mismas seis líneas que «Costos del período» del Resumen, no como
 * «ventas − ganancia», para que las dos pantallas den el mismo número.
 *
 * Solo lectura: no hay ninguna acción que cambie datos.
 *
 * Colores: la misma paleta categórica que el Resumen (PanoramaPeriodo). La
 * ganancia es un estado, no una categoría: verde si queda, rojo si falta.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@/lib/api';
import { descargarXlsx } from '@/lib/exportar-hoja';
import { money } from './PanoramaPeriodo';

type Desglose = Record<string, { count: number; grossUsd: number }>;

type MesAnalisis = {
  period: string;
  grossUsd: number;
  gatewayFeeUsd: number;
  taxUsd: number;
  netUsd: number;
  egresosUsd: number;
  gastosOperativosUsd: number;
  nominaUsd: number;
  comisionesUsd: number;
  socioUsd: number;
  utilidadUsd: number;
  cobros: number;
  cancelaciones: number;
  devueltoUsd: number;
  devueltoCount: number;
  porCategoria: Desglose;
  porPasarela: Desglose;
};

type Rango = '6' | '12' | 'anio';

/** Las tres clases que pide la pregunta. Upgrade, marca blanca y lo suelto van
 *  en «Otros»: siguen sumando, solo no tienen barra propia. */
const CLASES = [
  { k: 'nueva', label: 'Venta nueva', color: '#1baf7a' },
  { k: 'renovacion', label: 'Renovación', color: '#2a78d6' },
  { k: 'otros', label: 'Otros', color: '#eda100' },
] as const;
const claseDe = (categoria: string) =>
  categoria === 'NUEVA' ? 'nueva' : categoria === 'RENOVACION' ? 'renovacion' : 'otros';

/** Pasarelas: Hotmart y Manual con color fijo; las demás, de la paleta. */
const COLOR_PASARELA: Record<string, string> = { HOTMART: '#eb6834', MANUAL: '#2a78d6' };
const PALETA = ['#1baf7a', '#eda100', '#8b6fd6', '#d6457a', '#9aa0a6'];
const NOMBRE_PASARELA: Record<string, string> = {
  HOTMART: 'Hotmart',
  MANUAL: 'Manual',
  STRIPE: 'Stripe',
  CROSS: 'Cross',
  WHOP: 'Whop',
  MERCADOPAGO: 'Mercado Pago',
};

/** Las líneas de costo, en el orden de la cascada del Resumen. */
const COSTOS = [
  { k: 'feeImp', label: 'Comisión de pasarela e impuestos', color: '#2a78d6' },
  { k: 'egresosUsd', label: 'Egresos', color: '#eb6834' },
  { k: 'gastosOperativosUsd', label: 'Gastos operativos', color: '#d6457a' },
  { k: 'nominaUsd', label: 'Nómina', color: '#1baf7a' },
  { k: 'comisionesUsd', label: 'Comisiones', color: '#eda100' },
  { k: 'socioUsd', label: 'Socio', color: '#8b6fd6' },
] as const;

const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const corto = (p: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(p);
  return m ? `${MES_CORTO[Number(m[2]) - 1]} ${m[1].slice(2)}` : p;
};
const largo = (p: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(p);
  return m ? `${MES_LARGO[Number(m[2]) - 1]} ${m[1]}` : p;
};

/** El mes contable de hoy, en hora de Bogotá (el servidor corre en UTC). */
function mesDeHoy(): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return `${v('year')}-${v('month')}`;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Igual que «Costos del período» en el Resumen: las seis líneas sumadas. */
const costosDe = (m: MesAnalisis) =>
  r2(m.gatewayFeeUsd + m.taxUsd + m.egresosUsd + m.gastosOperativosUsd + m.nominaUsd + m.comisionesUsd + m.socioUsd);
const margenDe = (m: MesAnalisis) => (m.grossUsd > 0 ? Math.round((m.utilidadUsd / m.grossUsd) * 100) : null);
const ejeUsd = (v: number) => (Math.abs(v) >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`);

const TOOLTIP = { fontSize: 12, borderRadius: 8, border: '1px solid #E8E8E4' };
const EJE = { fontSize: 11, fill: '#8A8A80' };

function Pregunta({ titulo, nota, children }: { titulo: string; nota?: string; children: React.ReactNode }) {
  return (
    <section className="card card-pad mb-4">
      <h2 className="text-base font-semibold m-0" style={{ textWrap: 'balance' }}>{titulo}</h2>
      {nota && <p className="text-[11px] text-mute mt-0.5 mb-0">{nota}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function AnalisisFinanciero({
  scope,
  onIrAMes,
}: {
  scope: 'clubify' | 'all';
  onIrAMes: (periodo: string) => void;
}) {
  const [rango, setRango] = useState<Rango>('6');
  const [meses, setMeses] = useState<MesAnalisis[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hoy = useMemo(mesDeHoy, []);

  // «Este año» = de enero hasta el mes en curso.
  const cuantos = rango === 'anio' ? Number(hoy.slice(5, 7)) : Number(rango);

  useEffect(() => {
    let vivo = true;
    setMeses(null);
    setError(null);
    api<{ meses: MesAnalisis[] }>(`/admin/contabilidad/analisis?scope=${scope}&meses=${cuantos}&hasta=${hoy}`)
      .then((r) => vivo && setMeses(r.meses))
      .catch((e: Error) => vivo && setError(e.message || 'No se pudo cargar el análisis financiero.'));
    return () => {
      vivo = false;
    };
  }, [scope, cuantos, hoy]);

  const hayIncompleto = !!meses?.some((m) => m.period === hoy);
  const etiqueta = (p: string) => (p === hoy ? `${corto(p)}*` : corto(p));
  const titulo = (p: string) => `${largo(p)}${p === hoy ? ' · mes incompleto' : ''}`;

  const { filas, pasarelas } = useMemo(() => {
    const lista = meses ?? [];
    const totales = new Map<string, number>();
    for (const m of lista) {
      for (const [g, v] of Object.entries(m.porPasarela)) totales.set(g, (totales.get(g) ?? 0) + v.grossUsd);
    }
    const pasarelas = [...totales.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
    const filas = lista.map((m) => {
      const f: Record<string, number | string | null> = {
        period: m.period,
        label: etiqueta(m.period),
        grossUsd: m.grossUsd,
        utilidadUsd: m.utilidadUsd,
        margen: margenDe(m),
        feeImp: r2(m.gatewayFeeUsd + m.taxUsd),
        egresosUsd: m.egresosUsd,
        gastosOperativosUsd: m.gastosOperativosUsd,
        nominaUsd: m.nominaUsd,
        comisionesUsd: m.comisionesUsd,
        socioUsd: m.socioUsd,
        devueltoUsd: m.devueltoUsd,
        cancelaciones: m.cancelaciones,
        nueva: 0,
        renovacion: 0,
        otros: 0,
      };
      for (const [k, v] of Object.entries(m.porCategoria)) {
        const c = claseDe(k);
        f[c] = r2(Number(f[c]) + v.grossUsd);
      }
      for (const [g, v] of Object.entries(m.porPasarela)) f[`gw_${g}`] = v.grossUsd;
      return f;
    });
    return { filas, pasarelas };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meses, hoy]);

  const colorPasarela = (g: string, i: number) => COLOR_PASARELA[g] ?? PALETA[i % PALETA.length];

  /** recharts entrega el punto con su payload; de ahí sale el mes. */
  const abrir = (d: unknown) => {
    const p = (d as { payload?: { period?: string } })?.payload?.period;
    if (p) onIrAMes(p);
  };
  const tooltipUsd = {
    formatter: (v: unknown, n: unknown) => [money(Number(v)), String(n)] as [string, string],
    labelFormatter: (_: unknown, items: ReadonlyArray<{ payload?: { period?: string } }>) =>
      titulo(items?.[0]?.payload?.period ?? ''),
    contentStyle: TOOLTIP,
  };

  function descargar() {
    if (!meses) return;
    const cab = ['Mes', 'Ventas (USD)', 'Costos (USD)', 'Ganancia (USD)', 'Cobros', 'Nota'];
    const cuerpo = meses.map((m) => [
      largo(m.period),
      m.grossUsd,
      costosDe(m),
      m.utilidadUsd,
      m.cobros,
      m.period === hoy ? 'mes incompleto' : '',
    ]);
    const total = [
      'Total',
      r2(meses.reduce((s, m) => s + m.grossUsd, 0)),
      r2(meses.reduce((s, m) => s + costosDe(m), 0)),
      r2(meses.reduce((s, m) => s + m.utilidadUsd, 0)),
      meses.reduce((s, m) => s + m.cobros, 0),
      '',
    ];
    const marca = scope === 'all' ? 'todas-las-marcas' : 'clubify';
    descargarXlsx(`analisis-financiero-${marca}-${meses[0].period}_${meses[meses.length - 1].period}.xlsx`, [
      { nombre: 'Análisis financiero', filas: [cab, ...cuerpo, total] },
    ]);
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="inline-flex bg-bg2 border border-line rounded-pill p-1" role="group" aria-label="Qué meses ver">
          {([
            ['6', 'Últimos 6 meses'],
            ['12', 'Últimos 12 meses'],
            ['anio', 'Este año'],
          ] as [Rango, string][]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setRango(id)}
              aria-pressed={rango === id}
              className={`px-3 py-1.5 rounded-pill text-xs font-semibold ${rango === id ? 'bg-white shadow-sm2 text-ink' : 'text-mute'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => onIrAMes(hoy)} className="btn-primary text-sm">
          Ver un mes
        </button>
      </div>

      {error ? (
        <div className="card card-pad text-center text-red-600">{error}</div>
      ) : !meses ? (
        <div className="card card-pad text-center text-mute">Cargando el análisis financiero…</div>
      ) : (
        <>
          <p className="text-xs text-mute mb-3">
            Toca un mes en cualquier gráfica o en la tabla para abrirlo.
            {hayIncompleto && <> El asterisco (*) marca {largo(hoy)}: <strong className="text-ink">mes incompleto</strong>.</>}
          </p>

          {/* 1 ── Ventas y ganancia */}
          <Pregunta titulo="¿Cuánto vendimos y cuánto ganamos cada mes?">
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <ComposedChart data={filas} margin={{ top: 12, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#E8E8E4" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={EJE} />
                  <YAxis tickLine={false} axisLine={false} width={64} tick={EJE} tickFormatter={ejeUsd} />
                  <Tooltip {...tooltipUsd} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar name="Ventas realizadas" dataKey="grossUsd" fill="#2a78d6" radius={[4, 4, 0, 0]} maxBarSize={44} cursor="pointer" onClick={abrir} />
                  <Line name="Ganancia" type="monotone" dataKey="utilidadUsd" stroke="#1F2933" strokeWidth={2} dot={{ r: 4, fill: '#1F2933' }} activeDot={{ r: 6 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Pregunta>

          {/* 2 ── Margen */}
          <Pregunta
            titulo="¿Qué porcentaje de lo que vendimos nos quedó de ganancia cada mes?"
            nota="Ganancia ÷ ventas del mes. Un mes sin ventas no tiene margen."
          >
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={filas} margin={{ top: 12, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#E8E8E4" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={EJE} />
                  <YAxis tickLine={false} axisLine={false} width={48} tick={EJE} tickFormatter={(v: number) => `${v}%`} />
                  <ReferenceLine y={0} stroke="#C9C9C2" />
                  <Tooltip
                    formatter={(v) => [`${v}%`, 'Margen']}
                    labelFormatter={tooltipUsd.labelFormatter}
                    contentStyle={TOOLTIP}
                  />
                  <Bar name="Margen" dataKey="margen" maxBarSize={44} radius={[4, 4, 0, 0]} cursor="pointer" onClick={abrir}>
                    {filas.map((f) => (
                      <Cell key={String(f.period)} fill={Number(f.margen ?? 0) >= 0 ? '#16A34A' : '#DC2626'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Pregunta>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* 3 ── Nuevos o renovaciones */}
            <Pregunta
              titulo="¿La plata viene de clientes nuevos o de renovaciones?"
              nota="«Otros» junta upgrades, ventas de marca blanca y cobros sueltos."
            >
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={filas} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#E8E8E4" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={EJE} />
                    <YAxis tickLine={false} axisLine={false} width={56} tick={EJE} tickFormatter={ejeUsd} />
                    <Tooltip {...tooltipUsd} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {CLASES.map((c, i) => (
                      <Bar key={c.k} name={c.label} dataKey={c.k} stackId="clase" fill={c.color} maxBarSize={44}
                        radius={i === CLASES.length - 1 ? [4, 4, 0, 0] : undefined} cursor="pointer" onClick={abrir} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Pregunta>

            {/* 4 ── Pasarelas */}
            <Pregunta titulo="¿Por dónde nos pagaron?">
              {pasarelas.length === 0 ? (
                <p className="text-sm text-mute m-0">Sin cobros en estos meses.</p>
              ) : (
                <div style={{ width: '100%', height: 260 }}>
                  <ResponsiveContainer>
                    <BarChart data={filas} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#E8E8E4" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} tick={EJE} />
                      <YAxis tickLine={false} axisLine={false} width={56} tick={EJE} tickFormatter={ejeUsd} />
                      <Tooltip {...tooltipUsd} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {pasarelas.map((g, i) => (
                        <Bar key={g} name={NOMBRE_PASARELA[g] ?? g} dataKey={`gw_${g}`} stackId="gw" fill={colorPasarela(g, i)} maxBarSize={44}
                          radius={i === pasarelas.length - 1 ? [4, 4, 0, 0] : undefined} cursor="pointer" onClick={abrir} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Pregunta>
          </div>

          {/* 5 ── Costos */}
          <Pregunta
            titulo="¿En qué se nos va la plata cada mes?"
            nota="Las mismas líneas que resta el Resumen de cada mes. Las comisiones cuentan el mes en que se pagan."
          >
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={filas} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#E8E8E4" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={EJE} />
                  <YAxis tickLine={false} axisLine={false} width={56} tick={EJE} tickFormatter={ejeUsd} />
                  <Tooltip {...tooltipUsd} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {COSTOS.map((c, i) => (
                    <Bar key={c.k} name={c.label} dataKey={c.k} stackId="costo" fill={c.color} maxBarSize={44}
                      radius={i === COSTOS.length - 1 ? [4, 4, 0, 0] : undefined} cursor="pointer" onClick={abrir} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Pregunta>

          {/* 6 ── Devoluciones y cancelaciones */}
          <Pregunta
            titulo="¿Cuánta plata devolvimos y cuántos clientes cancelaron cada mes?"
            nota="Devuelto: reembolsos y contracargos, por la fecha de la venta. Cancelaciones: negocios que cancelaron en el mes."
          >
            <div style={{ width: '100%', height: 240 }}>
              <ResponsiveContainer>
                <ComposedChart data={filas} margin={{ top: 12, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#E8E8E4" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={EJE} />
                  <YAxis yAxisId="usd" tickLine={false} axisLine={false} width={56} tick={EJE} tickFormatter={ejeUsd} />
                  <YAxis yAxisId="n" orientation="right" allowDecimals={false} tickLine={false} axisLine={false} width={32} tick={EJE} />
                  <Tooltip
                    formatter={(v, n) => (String(n) === 'Cancelaciones' ? [String(v), 'Cancelaciones'] : [money(Number(v)), String(n)])}
                    labelFormatter={tooltipUsd.labelFormatter}
                    contentStyle={TOOLTIP}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="usd" name="Devuelto" dataKey="devueltoUsd" fill="#eb6834" radius={[4, 4, 0, 0]} maxBarSize={44} cursor="pointer" onClick={abrir} />
                  <Line yAxisId="n" name="Cancelaciones" type="monotone" dataKey="cancelaciones" stroke="#DC2626" strokeWidth={2} dot={{ r: 4, fill: '#DC2626' }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Pregunta>

          {/* Tabla: un mes por fila */}
          <section className="card card-pad mb-4">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
              <h2 className="text-base font-semibold m-0">Mes por mes</h2>
              <button type="button" onClick={descargar} className="btn-ghost text-sm">
                Descargar en Excel
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-mute text-right">
                    <th className="text-left font-semibold py-2 px-2">Mes</th>
                    <th className="font-semibold py-2 px-2">Ventas</th>
                    <th className="font-semibold py-2 px-2">Costos</th>
                    <th className="font-semibold py-2 px-2">Ganancia</th>
                    <th className="font-semibold py-2 px-2">Cobros</th>
                  </tr>
                </thead>
                <tbody>
                  {meses.map((m) => (
                    <tr
                      key={m.period}
                      className="border-t border-line2 text-right hover:bg-bg2 cursor-pointer"
                      onClick={() => onIrAMes(m.period)}
                    >
                      <td className="text-left py-2 px-2 font-medium whitespace-nowrap">
                        <span className="capitalize">{largo(m.period)}</span>
                        {m.period === hoy && (
                          <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-amber-700">mes incompleto</span>
                        )}
                      </td>
                      <td className="py-2 px-2 font-medium">{money(m.grossUsd)}</td>
                      <td className="py-2 px-2 text-mute">{money(costosDe(m))}</td>
                      <td className={`py-2 px-2 font-semibold ${m.utilidadUsd >= 0 ? 'text-ok' : 'text-red-600'}`}>{money(m.utilidadUsd)}</td>
                      <td className="py-2 px-2">{m.cobros}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line2 text-right font-semibold">
                    <td className="text-left py-2 px-2">Total</td>
                    <td className="py-2 px-2">{money(meses.reduce((s, m) => s + m.grossUsd, 0))}</td>
                    <td className="py-2 px-2 text-mute">{money(meses.reduce((s, m) => s + costosDe(m), 0))}</td>
                    <td className="py-2 px-2">{money(meses.reduce((s, m) => s + m.utilidadUsd, 0))}</td>
                    <td className="py-2 px-2">{meses.reduce((s, m) => s + m.cobros, 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
