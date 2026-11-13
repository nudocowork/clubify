'use client';
import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/lib/api';

// ===========================================================================
//  Recompra por negocio (/superadmin → General). Solo PLATFORM_OWNER (el
//  layout y el endpoint lo exigen). Cifras agregadas por negocio: nada de
//  clientes finales. Gráficas al estilo de los paneles de Whop: número grande
//  arriba, curva suave con degradado, sin rejilla pesada.
// ===========================================================================

type Fila = {
  unicos: number;
  recurrentes: number;
  visitas: number;
  diasEntre: number | null;
  ingresos: number | null;
  conMonto: number;
  recompra: number | null;
  frecuencia: number | null;
};
type Mes = { mes: string; clientes: number; regresan: number; visitas: number; tasa?: number | null };
type Negocio = {
  id: string;
  nombre: string;
  marca: string;
  status: string;
  currency: string;
  alta: string;
  fuera: string | null;
  montoDudoso: boolean;
  historico: Fila | null;
  ultimos90: Fila | null;
  serie: Mes[];
};
type Promedio = { negocios: number; recompra: number | null; frecuencia: number | null; diasEntre: number | null };
type Resumen = {
  generado: string;
  definiciones: { minClientes: number; minDias: number; visitaHoras: number };
  promedio: { historico: Promedio; ultimos90: Promedio };
  serie: Mes[];
  negocios: Negocio[];
};
type Ventana = 'ultimos90' | 'historico';

const CARD: React.CSSProperties = {
  background: 'white',
  border: '1px solid #e7e9ec',
  boxShadow: '0 1px 2px rgba(16,24,40,.04)',
};
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const etiquetaMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const f1 = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('es-CO', { maximumFractionDigits: 1 }));
const entero = (v: number | null | undefined) => (v == null ? '—' : Math.round(v).toLocaleString('es-CO'));

/** Mismo color que la barra lateral del superadmin (configurable). */
function colorDelPanel() {
  try {
    const c = JSON.parse(window.localStorage.getItem('superadmin_cfg_v1') || 'null');
    if (c?.primaryColor) return c.primaryColor as string;
  } catch {
    /* sin localStorage: color por defecto */
  }
  return '#0a90bd';
}

function hace(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return `hace ${h} h`;
}

export default function RecompraPage() {
  const [datos, setDatos] = useState<Resumen | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [ventana, setVentana] = useState<Ventana>('ultimos90');
  const [elegido, setElegido] = useState<string | null>(null);
  const [buscar, setBuscar] = useState('');
  const [verFuera, setVerFuera] = useState(false);
  const [color, setColor] = useState('#0a90bd');

  async function cargar(refrescar = false) {
    setCargando(true);
    setErr(null);
    try {
      setDatos(await api<Resumen>(`/superadmin/recompra${refrescar ? '?refrescar=1' : ''}`));
    } catch (e: any) {
      setErr(e?.message ?? 'No se pudo calcular la recompra.');
    } finally {
      setCargando(false);
    }
  }
  useEffect(() => {
    setColor(colorDelPanel());
    cargar();
  }, []);

  const negocioElegido = datos?.negocios.find((n) => n.id === elegido) ?? null;
  const prom = datos?.promedio[ventana];
  const otro = datos?.promedio[ventana === 'ultimos90' ? 'historico' : 'ultimos90'];

  const ranking = useMemo(() => {
    if (!datos) return [];
    return datos.negocios
      .filter((n) => !n.fuera && (n[ventana]?.unicos ?? 0) > 0)
      .sort((a, b) => (b[ventana]?.recompra ?? 0) - (a[ventana]?.recompra ?? 0));
  }, [datos, ventana]);

  const tabla = useMemo(() => {
    if (!datos) return [];
    const q = buscar.trim().toLowerCase();
    return datos.negocios
      .filter((n) => (verFuera ? true : !n.fuera))
      .filter((n) => !q || `${n.nombre} ${n.marca}`.toLowerCase().includes(q))
      .sort((a, b) => {
        if (!!a.fuera !== !!b.fuera) return a.fuera ? 1 : -1;
        return (b[ventana]?.recompra ?? -1) - (a[ventana]?.recompra ?? -1);
      });
  }, [datos, ventana, buscar, verFuera]);

  const serie = useMemo(() => {
    const base = negocioElegido ? negocioElegido.serie : datos?.serie ?? [];
    return base.map((m) => ({
      ...m,
      etiqueta: etiquetaMes(m.mes),
      tasa: m.clientes ? Math.round((1000 * m.regresan) / m.clientes) / 10 : 0,
    }));
  }, [datos, negocioElegido]);
  const ultimo = serie[serie.length - 1];
  const anterior = serie[serie.length - 2];
  const cambio = ultimo && anterior ? Math.round(10 * (ultimo.tasa - anterior.tasa)) / 10 : null;
  const maxRanking = Math.max(1, ...ranking.map((n) => n[ventana]?.recompra ?? 0));

  return (
    <div className="p-6 md:p-8 max-w-[1280px] mx-auto" style={{ color: '#101828' }}>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Recompra por negocio</h1>
          <p className="text-sm mt-1" style={{ color: '#667085' }}>
            Qué porcentaje de los clientes de cada negocio vuelve a comprar.
            {datos && <> Calculado {hace(datos.generado)}.</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex p-1 rounded-xl" style={{ background: '#eceef1' }} role="tablist">
            {(
              [
                ['ultimos90', 'Últimos 90 días'],
                ['historico', 'Histórico'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={ventana === k}
                onClick={() => setVentana(k)}
                className="px-3.5 py-1.5 text-sm font-semibold rounded-lg transition"
                style={ventana === k ? { background: 'white', boxShadow: '0 1px 2px rgba(16,24,40,.12)' } : { color: '#667085' }}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => cargar(true)}
            disabled={cargando}
            className="px-3.5 py-2 text-sm font-semibold rounded-xl border disabled:opacity-50"
            style={{ borderColor: '#d0d5dd', background: 'white' }}
          >
            {cargando ? 'Calculando…' : 'Recalcular'}
          </button>
        </div>
      </div>

      {err && (
        <div className="mb-4 rounded-xl px-4 py-3 text-sm" style={{ background: '#fee2e2', color: '#b91c1c' }}>
          {err}
        </div>
      )}
      {!datos && !err && (
        <div className="rounded-2xl p-10 text-center text-sm" style={{ ...CARD, color: '#667085' }}>
          Calculando la recompra de todos los negocios… puede tardar unos segundos.
        </div>
      )}

      {datos && prom && (
        <>
          {/* ── Cifras del negocio típico ─────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <Kpi
              titulo="Recompra promedio"
              valor={prom.recompra == null ? '—' : `${f1(prom.recompra)} %`}
              nota={otro?.recompra != null ? `${ventana === 'ultimos90' ? 'Histórico' : 'Últimos 90 días'}: ${f1(otro.recompra)} %` : undefined}
              color={color}
              destacado
            />
            <Kpi titulo="Visitas por cliente" valor={f1(prom.frecuencia)} nota="Promedio de los negocios" color={color} />
            <Kpi
              titulo="Días entre visitas"
              valor={prom.diasEntre == null ? '—' : `${f1(prom.diasEntre)} d`}
              nota="De quien vuelve"
              color={color}
            />
            <Kpi
              titulo="Negocios en el promedio"
              valor={String(prom.negocios)}
              nota={`${datos.definiciones.minClientes}+ clientes y ${datos.definiciones.minDias}+ días`}
              color={color}
            />
          </div>

          {/* ── Curva mensual ────────────────────────────────────────── */}
          <div className="rounded-2xl p-5 mb-4" style={CARD}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[13px] font-semibold" style={{ color: '#667085' }}>
                  Clientes que regresan · {negocioElegido ? negocioElegido.nombre : 'todos los negocios del promedio'}
                </div>
                <div className="flex items-baseline gap-3 mt-1">
                  <span className="text-[34px] font-extrabold tracking-tight tabular-nums">
                    {ultimo ? `${f1(ultimo.tasa)} %` : '—'}
                  </span>
                  {cambio != null && (
                    <span
                      className="text-xs font-bold px-2 py-0.5 rounded-full tabular-nums"
                      style={cambio >= 0 ? { background: '#dcfce7', color: '#15803d' } : { background: '#fee2e2', color: '#b91c1c' }}
                    >
                      {cambio >= 0 ? '▲' : '▼'} {f1(Math.abs(cambio))} pts vs. mes anterior
                    </span>
                  )}
                </div>
                <div className="text-xs mt-1" style={{ color: '#98a2b3' }}>
                  De los clientes que vinieron cada mes, cuántos ya habían venido antes.
                  {ultimo && ' El mes en curso aún no ha cerrado.'}
                </div>
              </div>
              {negocioElegido && (
                <button
                  onClick={() => setElegido(null)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                  style={{ background: '#f2f4f7', color: '#344054' }}
                >
                  Ver todos los negocios
                </button>
              )}
            </div>
            <div className="mt-4" style={{ height: 260 }}>
              {serie.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={serie} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                    <defs>
                      <linearGradient id="recompraGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={color} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="#f2f4f7" />
                    <XAxis dataKey="etiqueta" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#98a2b3' }} />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 12, fill: '#98a2b3' }}
                      tickFormatter={(v) => `${v} %`}
                      domain={[0, (max: number) => Math.min(100, Math.ceil((max + 5) / 10) * 10)]}
                    />
                    <Tooltip
                      cursor={{ stroke: '#d0d5dd', strokeDasharray: '4 4' }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const m = payload[0].payload as Mes & { etiqueta: string; tasa: number };
                        return (
                          <div className="rounded-xl px-3 py-2 text-xs" style={{ background: '#101828', color: 'white' }}>
                            <div className="font-bold mb-1">{m.etiqueta}</div>
                            <div className="tabular-nums">Regresan: {f1(m.tasa)} %</div>
                            <div className="tabular-nums opacity-80">
                              {entero(m.regresan)} de {entero(m.clientes)} clientes · {entero(m.visitas)} visitas
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="tasa"
                      stroke={color}
                      strokeWidth={2.5}
                      fill="url(#recompraGrad)"
                      dot={false}
                      activeDot={{ r: 5, strokeWidth: 2, stroke: 'white', fill: color }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-sm" style={{ color: '#98a2b3' }}>
                  Sin visitas en los últimos 12 meses.
                </div>
              )}
            </div>
          </div>

          {/* ── Ranking ─────────────────────────────────────────────── */}
          <div className="rounded-2xl p-5 mb-4" style={CARD}>
            <div className="flex items-baseline justify-between mb-3">
              <div className="text-[15px] font-bold">Los que más recompra tienen</div>
              <div className="text-xs" style={{ color: '#98a2b3' }}>
                Toca un negocio para ver su curva
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-x-8 gap-y-1">
              {ranking.slice(0, 20).map((n, i) => {
                const v = n[ventana]?.recompra ?? 0;
                const activo = n.id === elegido;
                return (
                  <button
                    key={n.id}
                    onClick={() => {
                      setElegido(activo ? null : n.id);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-lg text-left hover:bg-[#f9fafb]"
                    style={activo ? { background: '#f2f4f7' } : undefined}
                  >
                    <span className="w-5 text-xs font-bold tabular-nums text-right" style={{ color: '#98a2b3' }}>
                      {i + 1}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold truncate">{n.nombre}</span>
                        <span className="text-sm font-bold tabular-nums">{f1(v)} %</span>
                      </span>
                      <span className="block h-1.5 mt-1.5 rounded-full" style={{ background: '#f2f4f7' }}>
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${(100 * v) / maxRanking}%`, background: color, opacity: 0.35 + (0.65 * v) / maxRanking }}
                        />
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Tabla completa ──────────────────────────────────────── */}
          <div className="rounded-2xl mb-4 overflow-hidden" style={CARD}>
            <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
              <div className="text-[15px] font-bold">Todos los negocios</div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs font-semibold" style={{ color: '#475467' }}>
                  <input type="checkbox" checked={verFuera} onChange={(e) => setVerFuera(e.target.checked)} />
                  Ver también los que no entran al promedio
                </label>
                <input
                  value={buscar}
                  onChange={(e) => setBuscar(e.target.value)}
                  placeholder="Buscar negocio o marca"
                  className="text-sm px-3 py-1.5 rounded-lg border outline-none"
                  style={{ borderColor: '#d0d5dd', width: 210 }}
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: '#f9fafb', color: '#667085' }} className="text-xs">
                    {['Negocio', 'Clientes', 'Regresan', 'Recompra', 'Visitas por cliente', 'Días entre visitas', 'Ventas registradas'].map((h, i) => (
                      <th key={h} className={`px-4 py-2.5 font-semibold whitespace-nowrap ${i ? 'text-right' : 'text-left'}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tabla.map((n) => {
                    const f = n[ventana];
                    return (
                      <tr
                        key={n.id}
                        onClick={() => {
                          setElegido(n.id);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="cursor-pointer hover:bg-[#f9fafb]"
                        style={{ borderTop: '1px solid #f2f4f7', opacity: n.fuera ? 0.6 : 1 }}
                      >
                        <td className="px-4 py-2.5">
                          <div className="font-semibold">{n.nombre}</div>
                          <div className="text-xs flex flex-wrap gap-x-2" style={{ color: '#98a2b3' }}>
                            <span>{n.marca}</span>
                            {n.fuera && <span style={{ color: '#b45309' }}>Fuera del promedio: {n.fuera}</span>}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{entero(f?.unicos)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{entero(f?.recurrentes)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-bold">
                          {f?.recompra == null ? '—' : `${f1(f.recompra)} %`}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{f1(f?.frecuencia)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{f?.diasEntre == null ? '—' : `${f1(f.diasEntre)} d`}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                          {f?.ingresos == null ? '—' : `${entero(f.ingresos)} ${n.currency}`}
                          {n.montoDudoso && (
                            <span
                              className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full align-middle"
                              style={{ background: '#fef3c7', color: '#b45309' }}
                              title="El cajero escribe montos que no parecen el valor real de la compra (por ejemplo, 1 peso)."
                            >
                              Monto dudoso
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Cómo se cuenta ──────────────────────────────────────── */}
          <div className="rounded-2xl p-5 text-xs leading-relaxed" style={{ ...CARD, color: '#475467' }}>
            <div className="text-[13px] font-bold mb-2" style={{ color: '#101828' }}>
              Cómo se cuenta
            </div>
            <ul className="space-y-1 list-disc pl-4">
              <li>
                <b>Visita:</b> los sellos de un mismo cliente con menos de {datos.definiciones.visitaHoras} horas entre sí cuentan
                como una sola. Así, quien tiene dos tarjetas del negocio y recibe un sello en cada una no cuenta como recompra.
              </li>
              <li>
                <b>Recompra:</b> clientes con 2 o más visitas, sobre los clientes del negocio. En «Últimos 90 días» solo cuentan los
                clientes que vinieron en esos 90 días, y las visitas de ese periodo.
              </li>
              <li>
                <b>Promedio:</b> cada negocio pesa igual. Entran los que tienen {datos.definiciones.minClientes} o más clientes,{' '}
                {datos.definiciones.minDias} o más días en Clubify y no están suspendidos.
              </li>
              <li>No cuentan los sellos regalados (cortesías y fechas especiales).</li>
              <li>
                <b>Ventas registradas:</b> la suma de los montos que escribe el cajero al sellar, en la moneda de cada negocio. No se
                suman entre negocios porque las monedas son distintas.
              </li>
              <li>Estas cifras no se usan en material de venta hasta que Javier las apruebe.</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({
  titulo,
  valor,
  nota,
  color,
  destacado,
}: {
  titulo: string;
  valor: string;
  nota?: string;
  color: string;
  destacado?: boolean;
}) {
  return (
    <div className="rounded-2xl p-5" style={CARD}>
      <div className="text-[13px] font-semibold" style={{ color: '#667085' }}>
        {titulo}
      </div>
      <div className="text-[30px] font-extrabold tracking-tight tabular-nums mt-1" style={destacado ? { color } : undefined}>
        {valor}
      </div>
      {nota && (
        <div className="text-xs mt-0.5" style={{ color: '#98a2b3' }}>
          {nota}
        </div>
      )}
    </div>
  );
}
