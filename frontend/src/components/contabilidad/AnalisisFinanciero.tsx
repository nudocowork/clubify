'use client';

/**
 * ANÁLISIS FINANCIERO — los meses lado a lado.
 *
 * Las gráficas que comparan meses vivían al final del Resumen de CADA mes: para
 * comparar había que abrir los meses uno por uno y bajar hasta el fondo
 * (Javier, 2026-11-27). Aquí viven una sola vez, con el rango de meses que se
 * elija, y con las cifras que sirven para decidir: tendencia, margen, ticket,
 * mezcla nuevas/renovaciones, clientes que entran y que se van.
 *
 * Cada mes sale de la MISMA cascada que su Resumen (`serieDeMeses` en el
 * backend): si una cifra no coincidiera entre las dos pantallas, ninguna de las
 * dos serviría para cuadrar.
 *
 * Colores: la misma paleta categórica que el Resumen (PanoramaPeriodo). La
 * utilidad es un estado, no una categoría: verde si queda, rojo si falta.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@/lib/api';
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
  negociosQuePagaron: number;
  negociosNuevos: number;
  cancelaciones: number;
  devueltoUsd: number;
  devueltoCount: number;
  comisionesGeneradasUsd: number;
  porCategoria: Desglose;
  porPasarela: Desglose;
};

const ETIQUETA_CATEGORIA: Record<string, string> = {
  NUEVA: 'Suscripción nueva',
  RENOVACION: 'Renovación',
  UPGRADE: 'Upgrade',
  OTRO: 'Otro ingreso',
  MARCA_BLANCA: 'Venta de marca blanca',
  SIN_CATEGORIA: 'Sin clasificar',
};
const COLOR_CATEGORIA: Record<string, string> = {
  NUEVA: '#1baf7a',
  RENOVACION: '#2a78d6',
  UPGRADE: '#eda100',
  OTRO: '#eb6834',
  MARCA_BLANCA: '#8b6fd6',
  SIN_CATEGORIA: '#9aa0a6',
};
/** Pasarelas: se reparten los colores de la paleta en orden de importe. */
const PALETA = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#8b6fd6', '#d6457a', '#9aa0a6'];

const COSTOS = [
  { k: 'feeImp', label: 'Fee + impuestos', color: '#2a78d6' },
  { k: 'egresosUsd', label: 'Egresos', color: '#eb6834' },
  { k: 'gastosOperativosUsd', label: 'Gastos operativos', color: '#d6457a' },
  { k: 'nominaUsd', label: 'Nómina', color: '#1baf7a' },
  { k: 'comisionesUsd', label: 'Comisiones pagadas', color: '#eda100' },
  { k: 'socioUsd', label: 'Socio', color: '#8b6fd6' },
] as const;

/** El primer aviso de pago que guarda el sistema es de junio de 2026. */
const EMPIEZA_EL_LIBRO = '2026-06';

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

/** Hoy en Bogotá: el mes contable y el día. El servidor corre en UTC. */
function hoyEnBogota(): { mes: string; dia: number; diasDelMes: number } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  const y = Number(v('year'));
  const m = Number(v('month'));
  return {
    mes: `${v('year')}-${v('month')}`,
    dia: Number(v('day')),
    diasDelMes: new Date(Date.UTC(y, m, 0)).getUTCDate(),
  };
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);
const ejeUsd = (v: number) => (Math.abs(v) >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`);
const costosDe = (m: MesAnalisis) => m.grossUsd - m.utilidadUsd;

function Caja({ titulo, nota, children }: { titulo: string; nota?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card card-pad mb-4">
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
        <div className="text-xs uppercase tracking-wider text-mute font-semibold">{titulo}</div>
        {nota && <span className="text-[11px] text-mute">{nota}</span>}
      </div>
      {children}
    </div>
  );
}

function Cifra({ label, valor, sub, tono }: { label: string; valor: string; sub?: React.ReactNode; tono?: 'ok' | 'bad' }) {
  return (
    <div className="card card-pad">
      <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-1">{label}</div>
      <div className={`text-2xl font-bold tabular-nums leading-tight ${tono === 'ok' ? 'text-ok' : tono === 'bad' ? 'text-red-600' : ''}`}>{valor}</div>
      {sub && <div className="text-[11px] text-mute mt-0.5">{sub}</div>}
    </div>
  );
}

const TOOLTIP = { fontSize: 12, borderRadius: 8, border: '1px solid #E8E8E4' };

export function AnalisisFinanciero({
  scope,
  onIrAMes,
}: {
  scope: 'clubify' | 'all';
  onIrAMes: (periodo: string) => void;
}) {
  const [cuantos, setCuantos] = useState<6 | 12 | 24>(12);
  const [meses, setMeses] = useState<MesAnalisis[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setMeses(null);
    setError(null);
    api<{ meses: MesAnalisis[] }>(`/admin/contabilidad/analisis?scope=${scope}&meses=${cuantos}`)
      .then((r) => vivo && setMeses(r.meses))
      .catch((e: Error) => vivo && setError(e.message || 'No se pudo cargar el análisis.'));
    return () => {
      vivo = false;
    };
  }, [scope, cuantos]);

  const hoy = useMemo(hoyEnBogota, []);

  const a = useMemo(() => {
    if (!meses) return null;
    const enCurso = meses.find((m) => m.period === hoy.mes) ?? null;
    // Para promedios y tendencias cuentan los meses CERRADOS con el libro ya
    // abierto: un mes a medias o uno sin registro de cobros hunde el promedio.
    const cerrados = meses.filter((m) => m.period < hoy.mes && m.period >= EMPIEZA_EL_LIBRO);
    const conVentas = cerrados.filter((m) => m.grossUsd > 0);

    const suma = (xs: MesAnalisis[], f: (m: MesAnalisis) => number) => xs.reduce((s, m) => s + f(m), 0);
    const total = {
      ventas: suma(meses, (m) => m.grossUsd),
      utilidad: suma(meses, (m) => m.utilidadUsd),
      cobros: suma(meses, (m) => m.cobros),
      comisiones: suma(meses, (m) => m.comisionesUsd),
      comisionesGeneradas: suma(meses, (m) => m.comisionesGeneradasUsd),
      devuelto: suma(meses, (m) => m.devueltoUsd),
      nuevos: suma(meses, (m) => m.negociosNuevos),
      cancelaciones: suma(meses, (m) => m.cancelaciones),
      renovacion: suma(meses, (m) => m.porCategoria.RENOVACION?.grossUsd ?? 0),
      nueva: suma(meses, (m) => m.porCategoria.NUEVA?.grossUsd ?? 0),
    };
    const promedioVentas = conVentas.length ? suma(conVentas, (m) => m.grossUsd) / conVentas.length : null;
    const promedioUtilidad = conVentas.length ? suma(conVentas, (m) => m.utilidadUsd) / conVentas.length : null;

    // Tendencia: los últimos 3 meses cerrados contra los 3 anteriores. Con
    // menos de 6 meses cerrados no se compara: sería ruido con apariencia de dato.
    let tendencia: { ahora: number; antes: number } | null = null;
    if (cerrados.length >= 6) {
      const ult = cerrados.slice(-3);
      const prev = cerrados.slice(-6, -3);
      tendencia = { ahora: suma(ult, (m) => m.grossUsd), antes: suma(prev, (m) => m.grossUsd) };
    }

    const ultimo = cerrados[cerrados.length - 1] ?? null;
    const penultimo = cerrados[cerrados.length - 2] ?? null;

    const ordenUtilidad = [...conVentas].sort((x, y) => y.utilidadUsd - x.utilidadUsd);
    const mejor = ordenUtilidad[0] ?? null;
    const peor = ordenUtilidad.length > 1 ? ordenUtilidad[ordenUtilidad.length - 1] : null;

    // Proyección lineal del mes en curso: lo vendido hasta hoy al ritmo de hoy.
    // Es una referencia, no un pronóstico: las renovaciones no caen parejas.
    const proyeccion =
      enCurso && hoy.dia > 0 ? (enCurso.grossUsd / hoy.dia) * hoy.diasDelMes : null;

    // Pasarelas del rango, de mayor a menor (para colores y concentración).
    const pasarelas = new Map<string, number>();
    for (const m of meses) {
      for (const [g, v] of Object.entries(m.porPasarela)) pasarelas.set(g, (pasarelas.get(g) ?? 0) + v.grossUsd);
    }
    const listaPasarelas = [...pasarelas.entries()].sort((x, y) => y[1] - x[1]);
    // Orden fijo para las conocidas y, detrás, cualquier clase nueva que
    // aparezca en la base: una clase sin etiqueta se pinta con su nombre en
    // vez de desaparecer de la gráfica (así salió MARCA_BLANCA en junio 2026).
    const conocidas = ['NUEVA', 'RENOVACION', 'UPGRADE', 'MARCA_BLANCA', 'OTRO', 'SIN_CATEGORIA'];
    const todas = new Set<string>(meses.flatMap((m) => Object.keys(m.porCategoria)));
    const categorias = [...conocidas.filter((k) => todas.has(k)), ...[...todas].filter((k) => !conocidas.includes(k))].filter(
      (k) => meses.some((m) => (m.porCategoria[k]?.grossUsd ?? 0) > 0),
    );

    return {
      enCurso,
      cerrados,
      total,
      promedioVentas,
      promedioUtilidad,
      tendencia,
      ultimo,
      penultimo,
      mejor,
      peor,
      proyeccion,
      listaPasarelas,
      categorias,
    };
  }, [meses, hoy]);

  const datosGrafica = useMemo(
    () =>
      (meses ?? []).map((m) => {
        const fila: Record<string, number | string> = {
          period: m.period,
          label: corto(m.period),
          grossUsd: m.grossUsd,
          utilidadUsd: m.utilidadUsd,
          feeImp: Math.round((m.gatewayFeeUsd + m.taxUsd) * 100) / 100,
          egresosUsd: m.egresosUsd,
          gastosOperativosUsd: m.gastosOperativosUsd,
          nominaUsd: m.nominaUsd,
          comisionesUsd: m.comisionesUsd,
          socioUsd: m.socioUsd,
          margen: m.grossUsd > 0 ? Math.round((m.utilidadUsd / m.grossUsd) * 100) : 0,
        };
        for (const [k, v] of Object.entries(m.porCategoria)) fila[`cat_${k}`] = v.grossUsd;
        for (const [k, v] of Object.entries(m.porPasarela)) fila[`gw_${k}`] = v.grossUsd;
        return fila;
      }),
    [meses],
  );

  const abrirMes = (d: unknown) => {
    const p = (d as { payload?: { period?: string } })?.payload?.period;
    if (p) onIrAMes(p);
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <p className="text-sm text-mute m-0 max-w-[65ch]">
          Los meses lado a lado. Cada cifra sale de la misma cuenta que el Resumen de ese mes.
          Toca una barra para abrir ese mes.
        </p>
        <div className="flex items-center gap-1 rounded-pill border border-line2 p-1 bg-surface" role="group" aria-label="Cuántos meses comparar">
          {([6, 12, 24] as const).map((n) => (
            <button
              key={n}
              onClick={() => setCuantos(n)}
              className={`px-3 py-1 rounded-pill text-xs font-semibold transition ${cuantos === n ? 'bg-brand text-white' : 'text-mute hover:text-ink'}`}
            >
              {n} meses
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="card card-pad text-center text-red-600">{error}</div>
      ) : !meses || !a ? (
        <div className="card card-pad text-center text-mute">Cargando análisis…</div>
      ) : (
        <>
          {/* ── Cifras del rango ── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
            <Cifra
              label="Ventas del rango"
              valor={money(a.total.ventas)}
              sub={`${a.total.cobros} cobros en ${meses.length} meses`}
            />
            <Cifra
              label="Utilidad del rango"
              valor={money(a.total.utilidad)}
              tono={a.total.utilidad >= 0 ? 'ok' : 'bad'}
              sub={pct(a.total.utilidad, a.total.ventas) == null ? 'sin ventas' : `margen ${pct(a.total.utilidad, a.total.ventas)}%`}
            />
            <Cifra
              label="Promedio mensual"
              valor={money(a.promedioVentas)}
              sub={a.promedioUtilidad == null ? 'sin meses cerrados con ventas' : `utilidad ${money(a.promedioUtilidad)} / mes`}
            />
            <Cifra
              label="Ticket promedio"
              valor={a.total.cobros > 0 ? money(a.total.ventas / a.total.cobros) : '—'}
              sub="ventas ÷ cobros"
            />
            <Cifra
              label="Renovaciones"
              valor={pct(a.total.renovacion, a.total.ventas) == null ? '—' : `${pct(a.total.renovacion, a.total.ventas)}%`}
              sub={`de las ventas · nuevas ${pct(a.total.nueva, a.total.ventas) ?? 0}%`}
            />
            <Cifra
              label="Clientes netos"
              valor={`${a.total.nuevos - a.total.cancelaciones >= 0 ? '+' : ''}${a.total.nuevos - a.total.cancelaciones}`}
              tono={a.total.nuevos - a.total.cancelaciones >= 0 ? 'ok' : 'bad'}
              sub={`${a.total.nuevos} nuevos · ${a.total.cancelaciones} cancelaciones`}
            />
          </div>

          {/* ── Lecturas para decidir ── */}
          <Caja titulo="Para decidir">
            <ul className="flex flex-col gap-2 text-sm m-0 p-0 list-none">
              {a.enCurso && (
                <li>
                  <strong className="capitalize">{largo(a.enCurso.period)}</strong> va en{' '}
                  <strong>{money(a.enCurso.grossUsd)}</strong> al día {hoy.dia} de {hoy.diasDelMes}. A este ritmo
                  cerraría cerca de <strong>{money(a.proyeccion)}</strong>
                  {a.promedioVentas != null && (
                    <>
                      , {a.proyeccion != null && a.proyeccion >= a.promedioVentas ? 'por encima' : 'por debajo'} del promedio
                      mensual ({money(a.promedioVentas)})
                    </>
                  )}
                  . <span className="text-mute">Es una referencia lineal: las renovaciones no caen parejas en el mes.</span>
                </li>
              )}
              {a.ultimo && a.penultimo && (
                <li>
                  <strong className="capitalize">{largo(a.ultimo.period)}</strong> cerró con{' '}
                  <strong>{money(a.ultimo.grossUsd)}</strong> en ventas,{' '}
                  {(() => {
                    const p = pct(a.ultimo.grossUsd - a.penultimo.grossUsd, a.penultimo.grossUsd);
                    if (p == null) return <>sin base para comparar con {largo(a.penultimo.period)}</>;
                    return (
                      <span className={p >= 0 ? 'text-ok font-semibold' : 'text-red-600 font-semibold'}>
                        {p >= 0 ? '▲' : '▼'} {Math.abs(p)}% vs {largo(a.penultimo.period)}
                      </span>
                    );
                  })()}
                  , y una utilidad de <strong>{money(a.ultimo.utilidadUsd)}</strong>.
                </li>
              )}
              {a.tendencia && (
                <li>
                  Últimos 3 meses cerrados: <strong>{money(a.tendencia.ahora)}</strong> contra{' '}
                  <strong>{money(a.tendencia.antes)}</strong> los 3 anteriores
                  {(() => {
                    const p = pct(a.tendencia.ahora - a.tendencia.antes, a.tendencia.antes);
                    return p == null ? '.' : (
                      <>
                        {' '}
                        (<span className={p >= 0 ? 'text-ok font-semibold' : 'text-red-600 font-semibold'}>{p >= 0 ? '+' : ''}{p}%</span>).
                      </>
                    );
                  })()}
                </li>
              )}
              {a.mejor && a.peor && a.mejor.period !== a.peor.period && (
                <li>
                  Mejor mes por utilidad: <strong className="capitalize">{largo(a.mejor.period)}</strong> ({money(a.mejor.utilidadUsd)}). El más
                  flojo: <strong className="capitalize">{largo(a.peor.period)}</strong> ({money(a.peor.utilidadUsd)}).
                </li>
              )}
              {a.total.ventas > 0 && (
                <li>
                  De cada $100 vendidos, <strong>{money(((a.total.ventas - a.total.utilidad) / a.total.ventas) * 100)}</strong> se
                  van en costos; las comisiones pagadas son <strong>{pct(a.total.comisiones, a.total.ventas)}%</strong> de las ventas
                  {a.total.comisionesGeneradas > a.total.comisiones + 0.01 && (
                    <> y quedan <strong>{money(a.total.comisionesGeneradas - a.total.comisiones)}</strong> generadas sin pagar en el rango</>
                  )}
                  .
                </li>
              )}
              {a.listaPasarelas.length > 0 && a.total.ventas > 0 && (
                <li>
                  <strong>{a.listaPasarelas[0][0]}</strong> trae el {pct(a.listaPasarelas[0][1], a.total.ventas)}% del dinero
                  {pct(a.listaPasarelas[0][1], a.total.ventas)! >= 80 && <>: si esa pasarela falla, casi todo el ingreso se detiene</>}.
                </li>
              )}
              {a.total.devuelto > 0 && (
                <li>
                  Devuelto en el rango: <strong>{money(a.total.devuelto)}</strong>
                  {pct(a.total.devuelto, a.total.ventas + a.total.devuelto) != null && <> ({pct(a.total.devuelto, a.total.ventas + a.total.devuelto)}% de lo cobrado)</>}.
                </li>
              )}
            </ul>
          </Caja>

          {/* ── Mes a mes ── */}
          <Caja titulo="Mes a mes" nota="Ventas en barras, utilidad en la línea">
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <ComposedChart data={datosGrafica} margin={{ top: 12, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#E8E8E4" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#8A8A80' }} />
                  <YAxis tickLine={false} axisLine={false} width={64} tick={{ fontSize: 11, fill: '#8A8A80' }} tickFormatter={ejeUsd} />
                  <Tooltip formatter={(v, n) => [money(Number(v)), String(n)]} labelFormatter={(l) => `Mes de ${String(l)}`} contentStyle={TOOLTIP} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar name="Ventas realizadas" dataKey="grossUsd" fill="#2a78d6" radius={[4, 4, 0, 0]} maxBarSize={44} cursor="pointer" onClick={abrirMes} />
                  <Line name="Utilidad" type="monotone" dataKey="utilidadUsd" stroke="#1F2933" strokeWidth={2} dot={{ r: 4, fill: '#1F2933' }} activeDot={{ r: 6 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Caja>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* ── Por qué entró ── */}
            <Caja titulo="Por qué entró" nota="Ventas por clase, cada mes">
              {a.categorias.length === 0 ? (
                <p className="text-sm text-mute m-0">Sin ventas en el rango.</p>
              ) : (
                <div style={{ width: '100%', height: 260 }}>
                  <ResponsiveContainer>
                    <BarChart data={datosGrafica} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#E8E8E4" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#8A8A80' }} />
                      <YAxis tickLine={false} axisLine={false} width={56} tick={{ fontSize: 11, fill: '#8A8A80' }} tickFormatter={ejeUsd} />
                      <Tooltip formatter={(v, n) => [money(Number(v)), String(n)]} contentStyle={TOOLTIP} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {a.categorias.map((k, i) => (
                        <Bar
                          key={k}
                          name={ETIQUETA_CATEGORIA[k] ?? k}
                          dataKey={`cat_${k}`}
                          stackId="cat"
                          fill={COLOR_CATEGORIA[k] ?? '#9aa0a6'}
                          maxBarSize={44}
                          radius={i === a.categorias.length - 1 ? [4, 4, 0, 0] : undefined}
                          cursor="pointer"
                          onClick={abrirMes}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Caja>

            {/* ── De dónde entró ── */}
            <Caja titulo="De dónde entró" nota="Ventas por pasarela, cada mes">
              {a.listaPasarelas.length === 0 ? (
                <p className="text-sm text-mute m-0">Sin ventas en el rango.</p>
              ) : (
                <div style={{ width: '100%', height: 260 }}>
                  <ResponsiveContainer>
                    <BarChart data={datosGrafica} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#E8E8E4" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#8A8A80' }} />
                      <YAxis tickLine={false} axisLine={false} width={56} tick={{ fontSize: 11, fill: '#8A8A80' }} tickFormatter={ejeUsd} />
                      <Tooltip formatter={(v, n) => [money(Number(v)), String(n)]} contentStyle={TOOLTIP} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {a.listaPasarelas.map(([g], i) => (
                        <Bar
                          key={g}
                          name={g}
                          dataKey={`gw_${g}`}
                          stackId="gw"
                          fill={PALETA[i % PALETA.length]}
                          maxBarSize={44}
                          radius={i === a.listaPasarelas.length - 1 ? [4, 4, 0, 0] : undefined}
                          cursor="pointer"
                          onClick={abrirMes}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Caja>
          </div>

          {/* ── En qué se va ── */}
          <Caja titulo="En qué se va lo que entra" nota="Costos de cada mes, apilados">
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={datosGrafica} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#E8E8E4" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#8A8A80' }} />
                  <YAxis tickLine={false} axisLine={false} width={56} tick={{ fontSize: 11, fill: '#8A8A80' }} tickFormatter={ejeUsd} />
                  <Tooltip formatter={(v, n) => [money(Number(v)), String(n)]} contentStyle={TOOLTIP} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {COSTOS.map((c, i) => (
                    <Bar
                      key={c.k}
                      name={c.label}
                      dataKey={c.k}
                      stackId="costo"
                      fill={c.color}
                      maxBarSize={44}
                      radius={i === COSTOS.length - 1 ? [4, 4, 0, 0] : undefined}
                      cursor="pointer"
                      onClick={abrirMes}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Caja>

          {/* ── La tabla: todos los números, mes por mes ── */}
          <Caja titulo="Mes por mes" nota="Toca un mes para abrir su Resumen">
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm tabular-nums min-w-[1100px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-mute text-right">
                    <th className="text-left font-semibold py-2 px-2">Mes</th>
                    <th className="font-semibold py-2 px-2">Ventas</th>
                    <th className="font-semibold py-2 px-2">vs mes ant.</th>
                    <th className="font-semibold py-2 px-2">Neto</th>
                    <th className="font-semibold py-2 px-2">Costos</th>
                    <th className="font-semibold py-2 px-2">Utilidad</th>
                    <th className="font-semibold py-2 px-2">Margen</th>
                    <th className="font-semibold py-2 px-2">Cobros</th>
                    <th className="font-semibold py-2 px-2">Ticket</th>
                    <th className="font-semibold py-2 px-2" title="Negocios distintos que pagaron en el mes">Pagaron</th>
                    <th className="font-semibold py-2 px-2" title="Negocios con su primer pago en el mes">Nuevos</th>
                    <th className="font-semibold py-2 px-2">Cancelaron</th>
                    <th className="font-semibold py-2 px-2">Devuelto</th>
                    <th className="font-semibold py-2 px-2" title="Comisiones generadas en el mes, pagadas o no">Comis. generadas</th>
                  </tr>
                </thead>
                <tbody>
                  {meses.map((m, i) => {
                    const prev = i > 0 ? meses[i - 1] : null;
                    const v = prev ? pct(m.grossUsd - prev.grossUsd, prev.grossUsd) : null;
                    const margen = pct(m.utilidadUsd, m.grossUsd);
                    const sinLibro = m.period < EMPIEZA_EL_LIBRO;
                    return (
                      <tr key={m.period} className="border-t border-line2 text-right hover:bg-bg2 cursor-pointer" onClick={() => onIrAMes(m.period)}>
                        <td className="text-left py-2 px-2 font-medium capitalize whitespace-nowrap">
                          {largo(m.period)}
                          {m.period === hoy.mes && <span className="ml-1.5 text-[10px] font-semibold text-brand normal-case">en curso</span>}
                          {sinLibro && <span className="ml-1.5 text-[10px] text-mute normal-case" title="El primer aviso de pago que guarda el sistema es de junio de 2026">sin registro de cobros</span>}
                        </td>
                        <td className="py-2 px-2 font-medium">{money(m.grossUsd)}</td>
                        <td className={`py-2 px-2 text-xs ${v == null ? 'text-mute2' : v >= 0 ? 'text-ok' : 'text-red-600'}`}>
                          {v == null ? '—' : `${v >= 0 ? '▲' : '▼'} ${Math.abs(v)}%`}
                        </td>
                        <td className="py-2 px-2">{money(m.netUsd)}</td>
                        <td className="py-2 px-2 text-mute">{money(costosDe(m))}</td>
                        <td className={`py-2 px-2 font-semibold ${m.utilidadUsd >= 0 ? 'text-ok' : 'text-red-600'}`}>{money(m.utilidadUsd)}</td>
                        <td className="py-2 px-2">{margen == null ? '—' : `${margen}%`}</td>
                        <td className="py-2 px-2">{m.cobros}</td>
                        <td className="py-2 px-2">{m.cobros > 0 ? money(m.grossUsd / m.cobros) : '—'}</td>
                        <td className="py-2 px-2">{m.negociosQuePagaron}</td>
                        <td className="py-2 px-2">{m.negociosNuevos}</td>
                        <td className={`py-2 px-2 ${m.cancelaciones > 0 ? 'text-red-600' : ''}`}>{m.cancelaciones}</td>
                        <td className="py-2 px-2">{m.devueltoUsd > 0 ? money(m.devueltoUsd) : '—'}</td>
                        <td className="py-2 px-2">{money(m.comisionesGeneradasUsd)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line2 text-right font-semibold">
                    <td className="text-left py-2 px-2">Total</td>
                    <td className="py-2 px-2">{money(a.total.ventas)}</td>
                    <td className="py-2 px-2" />
                    <td className="py-2 px-2">{money(meses.reduce((s, m) => s + m.netUsd, 0))}</td>
                    <td className="py-2 px-2 text-mute">{money(a.total.ventas - a.total.utilidad)}</td>
                    <td className={`py-2 px-2 ${a.total.utilidad >= 0 ? 'text-ok' : 'text-red-600'}`}>{money(a.total.utilidad)}</td>
                    <td className="py-2 px-2">{pct(a.total.utilidad, a.total.ventas) == null ? '—' : `${pct(a.total.utilidad, a.total.ventas)}%`}</td>
                    <td className="py-2 px-2">{a.total.cobros}</td>
                    <td className="py-2 px-2">{a.total.cobros > 0 ? money(a.total.ventas / a.total.cobros) : '—'}</td>
                    <td className="py-2 px-2 text-mute2" title="Un negocio paga varios meses: sumar meses lo contaría varias veces">—</td>
                    <td className="py-2 px-2">{a.total.nuevos}</td>
                    <td className="py-2 px-2">{a.total.cancelaciones}</td>
                    <td className="py-2 px-2">{a.total.devuelto > 0 ? money(a.total.devuelto) : '—'}</td>
                    <td className="py-2 px-2">{money(a.total.comisionesGeneradas)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-[11px] text-mute mt-2 mb-0">
              Costos = fee, impuestos, egresos, gastos operativos, nómina, comisiones pagadas y socio (lo mismo que resta la cascada).
              Nuevos = negocios con su primer pago en el mes. Las comisiones se restan cuando se pagan; las generadas se muestran aparte.
            </p>
          </Caja>
        </>
      )}
    </>
  );
}
