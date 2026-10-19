'use client';
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { descargarCsv, descargarXlsx, type Celda, type Hoja } from '@/lib/exportar-hoja';
import { diaCorto } from './Graficas';

/**
 * Detalle POR NEGOCIO de una tarjeta de «Métricas generales» (pedido del dueño,
 * 2026-10-19). Viendo «PREMIOS CANJEADOS 708» quería confirmar el número y ver
 * qué negocios lo forman. Por eso el panel enseña, además de la tabla, si la
 * suma CUADRA con la tarjeta: un detalle que no cuadra no confirma nada.
 *
 * Los datos vienen de `GET /admin/metricas/desglose`, con el mismo alcance y el
 * mismo rango que la tarjeta.
 */

export type MetricaDesglose = 'pases' | 'clientes' | 'sellos' | 'canjes' | 'pedidos' | 'tarjetas' | 'push' | 'wallet' | 'uso';

type Variacion = { pct: number | null; tendencia: 'sube' | 'baja' | 'igual' | 'nuevo' };
type Estado = 'ACTIVE' | 'TRIAL' | 'SUSPENDED';
type ValorCelda = number | string | null;
type Columna = { clave: string; etiqueta: string; tipo: 'numero' | 'texto' | 'fecha' | 'porcentaje' | 'dinero'; sumable?: boolean };
type TipoCanje = 'STAMPS' | 'VISITS' | 'COUPON' | 'POINTS' | 'CASHBACK' | 'MEMBERSHIP' | 'OTRO';

type Fila = {
  id: string;
  nombre: string;
  estado: Estado;
  valor: number;
  anterior: number;
  variacion: Variacion;
  extra: Record<string, ValorCelda>;
  detalle?: Array<Record<string, ValorCelda>>;
};

type Respuesta = {
  metrica: MetricaDesglose;
  rango: { desde: string; hasta: string; dias: number };
  anterior: { desde: string; hasta: string; dias: number };
  titulo: string;
  ayuda: string;
  etiquetaValor: string;
  columnas: Columna[];
  columnasDetalle: Columna[] | null;
  negociosEnAlcance: number;
  filas: Fila[];
  totales: { valor: number; anterior: number; variacion: Variacion; extra: Record<string, number> };
  sinMovimiento: number;
  resumen: Array<{ etiqueta: string; valor: string }>;
  canjes: {
    total: number;
    porTipo: Array<{ tipo: TipoCanje; etiqueta: string; canjes: number; porcentaje: number | null }>;
    sinClasificar: number;
    frase: string;
  } | null;
  porMoneda: Array<{ moneda: string; pedidos: number; cobrados: number; valor: number; valorAnterior: number }> | null;
};

const ESTADO: Record<Estado, { etiqueta: string; badge: string }> = {
  ACTIVE: { etiqueta: 'Activo', badge: 'badge-ok' },
  TRIAL: { etiqueta: 'En prueba', badge: 'badge-warn' },
  SUSPENDED: { etiqueta: 'Suspendido', badge: 'badge-bad' },
};

/** Tipos de tarjeta y de canje en palabras: el panel no enseña enums. */
const TIPO: Record<string, string> = {
  STAMPS: 'Sellos',
  VISITS: 'Visitas',
  COUPON: 'Cupón',
  POINTS: 'Puntos',
  CASHBACK: 'Cashback',
  MEMBERSHIP: 'Membresía',
  DISCOUNT: 'Descuento',
  GIFT: 'Regalo',
  MULTI: 'Múltiple',
  HYBRID: 'Híbrida',
  INFO: 'Informativa',
  OTRO: 'Otra',
};

const COLOR_CANJE: Record<TipoCanje, string> = {
  STAMPS: '#22C55E',
  VISITS: '#0D9488',
  COUPON: '#D97706',
  POINTS: '#2563EB',
  CASHBACK: '#7C3AED',
  MEMBERSHIP: '#DB2777',
  OTRO: '#9CA3AF',
};

const num = (v: number) => v.toLocaleString('es-CO', { maximumFractionDigits: 2 });
const fmtFecha = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', year: 'numeric' });
const ymd = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(iso));

function dinero(v: number, moneda: string) {
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: moneda,
      maximumFractionDigits: moneda === 'USD' || moneda === 'EUR' ? 2 : 0,
    }).format(v);
  } catch {
    return `${num(Math.round(v))} ${moneda}`;
  }
}

function celda(c: Columna, v: ValorCelda, fila?: Record<string, ValorCelda>): string {
  if (v === null || v === undefined || v === '') return '—';
  if (c.tipo === 'fecha') return typeof v === 'string' ? fmtFecha.format(new Date(v)) : String(v);
  if (c.tipo === 'porcentaje') return `${num(Number(v))} %`;
  if (c.tipo === 'dinero') return dinero(Number(v), String(fila?.moneda ?? 'USD'));
  if (c.tipo === 'numero') return num(Number(v));
  if (c.clave === 'tipo') return TIPO[String(v)] ?? String(v);
  return String(v);
}

/** Valor crudo para la hoja: números como números (Excel los suma), fechas AAAA-MM-DD. */
function celdaHoja(c: Columna, v: ValorCelda): Celda {
  if (v === null || v === undefined) return '';
  if (c.tipo === 'fecha' && typeof v === 'string') return ymd(v);
  if (c.clave === 'tipo') return TIPO[String(v)] ?? String(v);
  return v;
}

function Cambio({ v }: { v: Variacion }) {
  if (v.tendencia === 'nuevo') return <span className="text-[11px] font-semibold text-ok-ink">▲ nuevo</span>;
  if (v.tendencia === 'igual') return <span className="text-[11px] text-mute">=</span>;
  const sube = v.tendencia === 'sube';
  return (
    <span className={`text-[11px] font-semibold ${sube ? 'text-ok-ink' : 'text-bad-ink'}`}>
      {sube ? '▲' : '▼'} {Math.abs(v.pct ?? 0).toLocaleString('es-CO')} %
    </span>
  );
}

const rangoTexto = (r: { desde: string; hasta: string }) =>
  r.desde === r.hasta ? diaCorto(r.desde) : `${diaCorto(r.desde)} – ${diaCorto(r.hasta)}`;

export function DesgloseMetrica({
  metrica,
  consulta,
  totalTarjeta,
  onCerrar,
}: {
  metrica: MetricaDesglose;
  /** `preset=…&desde=…&hasta=…`, exactamente la de la tarjeta. */
  consulta: string;
  /** El número que muestra la tarjeta, para decir si el detalle cuadra. */
  totalTarjeta: number;
  onCerrar: () => void;
}) {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buscar, setBuscar] = useState('');
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivo = true;
    setDatos(null);
    setError(null);
    api<Respuesta>(`/admin/metricas/desglose?metrica=${metrica}&${consulta}`)
      .then((r) => vivo && setDatos(r))
      .catch((e: unknown) => vivo && setError(e instanceof Error ? e.message : 'No se pudo cargar el detalle.'));
    return () => {
      vivo = false;
    };
  }, [metrica, consulta]);

  useEffect(() => {
    const alTeclado = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    document.addEventListener('keydown', alTeclado);
    return () => document.removeEventListener('keydown', alTeclado);
  }, [onCerrar]);

  // Bloqueo del scroll y foco en su propio efecto sin dependencias (mismo
  // motivo que en DetalleDeMensaje): si dependiera de `onCerrar`, cada render
  // del padre guardaría como «previo» el 'hidden' que puso él mismo y la página
  // quedaría sin scroll al cerrar. El foco vuelve a la tarjeta que lo abrió.
  useEffect(() => {
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const veniaDe = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => {
      document.body.style.overflow = previo;
      veniaDe?.focus?.();
    };
  }, []);

  // El Tab no se escapa por detrás del velo.
  const atraparElTab = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panel.current) return;
    const f = panel.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!f.length) return;
    const primero = f[0];
    const ultimo = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === primero || document.activeElement === panel.current)) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  }, []);

  const filas = useMemo(() => {
    if (!datos) return [];
    const q = buscar.trim().toLocaleLowerCase('es');
    if (!q) return datos.filas;
    // Sin tildes: «cafe» tiene que encontrar «Café Central».
    const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('es');
    const qq = sinTildes(q);
    return datos.filas.filter((f) => sinTildes(f.nombre).includes(qq));
  }, [datos, buscar]);

  // En «uso» la tarjeta cuenta NEGOCIOS que usan el sistema, no movimientos.
  const comparable = datos
    ? metrica === 'uso'
      ? datos.filas.filter((f) => f.extra.usa === 'Sí').length
      : datos.totales.valor
    : 0;
  const cuadra = Math.abs(comparable - totalTarjeta) < 0.01;

  const exportar = (formato: 'xlsx' | 'csv') => {
    if (!datos) return;
    const origen = typeof window !== 'undefined' ? window.location.origin : '';
    const cab = ['Negocio', 'Estado', datos.etiquetaValor, 'Período anterior', ...datos.columnas.map((c) => c.etiqueta), 'Ficha'];
    const cuerpo: Celda[][] = datos.filas.map((f) => [
      f.nombre,
      ESTADO[f.estado].etiqueta,
      f.valor,
      f.anterior,
      ...datos.columnas.map((c) => celdaHoja(c, f.extra[c.clave] ?? null)),
      `${origen}/admin/tenants/${f.id}`,
    ]);
    const total: Celda[] = [
      'Total',
      '',
      datos.totales.valor,
      datos.totales.anterior,
      ...datos.columnas.map((c) => (c.clave in datos.totales.extra ? datos.totales.extra[c.clave] : '')),
      '',
    ];
    const principal: Celda[][] = [cab, ...cuerpo, total];
    const hojas: Hoja[] = [{ nombre: 'Por negocio', filas: principal }];
    if (datos.columnasDetalle) {
      const cd = datos.columnasDetalle;
      hojas.push({
        nombre: metrica === 'canjes' ? 'Por tarjeta' : 'Tarjetas',
        filas: [
          ['Negocio', ...cd.map((c) => c.etiqueta)],
          ...datos.filas.flatMap((f) => (f.detalle ?? []).map((d) => [f.nombre, ...cd.map((c) => celdaHoja(c, d[c.clave] ?? null))])),
        ],
      });
    }
    if (datos.canjes) {
      hojas.push({
        nombre: 'Por tipo de canje',
        filas: [['Tipo', 'Canjes', '%'], ...datos.canjes.porTipo.map((t) => [t.etiqueta, t.canjes, t.porcentaje])],
      });
    }
    const nombre = `${metrica}-por-negocio-${datos.rango.desde}_${datos.rango.hasta}`;
    if (formato === 'xlsx') descargarXlsx(`${nombre}.xlsx`, hojas);
    else descargarCsv(`${nombre}.csv`, principal);
  };

  const alternar = (id: string) =>
    setAbiertos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const colSpan = 5 + (datos?.columnas.length ?? 0);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/30" onClick={onCerrar} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-desglose"
        tabIndex={-1}
        onKeyDown={atraparElTab}
        className="fixed inset-0 sm:inset-6 lg:inset-x-[max(1.5rem,calc((100vw-72rem)/2))] z-50 flex flex-col bg-white sm:rounded-card shadow-md2 outline-none overflow-hidden"
      >
        <header className="shrink-0 border-b border-line px-4 py-3 sm:px-5 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="titulo-desglose" className="m-0 text-base sm:text-lg font-bold text-ink leading-snug">
              {datos?.titulo ?? 'Detalle por negocio'}
            </h2>
            {datos && (
              <p className="text-xs text-mute mt-0.5">
                {rangoTexto(datos.rango)} · comparado con {rangoTexto(datos.anterior)} · hora de Bogotá
              </p>
            )}
          </div>
          <button type="button" className="btn-ghost text-sm shrink-0" onClick={onCerrar} aria-label="Cerrar el detalle">
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5 space-y-4">
          {error ? (
            <p className="text-sm text-bad-ink">{error}</p>
          ) : !datos ? (
            <p className="text-sm text-mute" aria-live="polite">
              Cargando el detalle…
            </p>
          ) : (
            <>
              <p className="text-xs text-mute max-w-3xl">{datos.ayuda}</p>

              <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="kpi">
                  <span className="kpi-lbl">{metrica === 'uso' ? 'Negocios que usan el sistema' : `Total · ${datos.etiquetaValor}`}</span>
                  <span className="kpi-val block text-2xl mt-2 tabular-nums">{num(comparable)}</span>
                  {metrica !== 'uso' && (
                    <span className="mt-1 flex items-center gap-2">
                      <Cambio v={datos.totales.variacion} />
                      <span className="text-[11px] text-mute">vs {num(datos.totales.anterior)}</span>
                    </span>
                  )}
                </div>
                <div className="kpi">
                  <span className="kpi-lbl">¿Cuadra con la tarjeta?</span>
                  <span className={`block text-lg font-bold mt-2 ${cuadra ? 'text-ok-ink' : 'text-bad-ink'}`}>
                    {cuadra ? `Sí, ${num(totalTarjeta)}` : `No: la tarjeta dice ${num(totalTarjeta)}`}
                  </span>
                  {!cuadra && (
                    <span className="kpi-sub block">
                      Puede haber entrado un movimiento entre las dos consultas: cierra y vuelve a abrir.
                    </span>
                  )}
                </div>
                <div className="kpi">
                  <span className="kpi-lbl">Negocios</span>
                  <span className="kpi-val block text-2xl mt-2 tabular-nums">{num(datos.filas.length)}</span>
                  <span className="kpi-sub block">
                    {metrica === 'uso'
                      ? 'negocios activos (los de prueba y suspendidos no entran)'
                      : `con movimiento, de ${num(datos.negociosEnAlcance)} · ${num(datos.sinMovimiento)} sin nada`}
                  </span>
                </div>
                {datos.resumen.map((r) => (
                  <div className="kpi" key={r.etiqueta}>
                    <span className="kpi-lbl">{r.etiqueta}</span>
                    <span className="kpi-val block text-2xl mt-2 tabular-nums">{r.valor}</span>
                  </div>
                ))}
              </div>

              {datos.canjes && datos.canjes.total > 0 && <ResumenCanjes c={datos.canjes} />}

              {datos.porMoneda && datos.porMoneda.length > 0 && (
                <div className="card card-pad">
                  <p className="text-xs font-semibold text-ink mb-2">Valor cobrado por moneda (no se convierte: no hay tasas de cambio)</p>
                  <ul className="text-sm space-y-1">
                    {datos.porMoneda.map((m) => (
                      <li key={m.moneda} className="flex flex-wrap gap-x-3">
                        <b className="w-12">{m.moneda}</b>
                        <span className="tabular-nums">{num(m.pedidos)} pedidos</span>
                        <span className="tabular-nums">{num(m.cobrados)} cobrados</span>
                        <span className="tabular-nums font-semibold">{dinero(m.valor, m.moneda)}</span>
                        <span className="text-mute tabular-nums">antes {dinero(m.valorAnterior, m.moneda)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="search"
                  className="input h-9 text-sm flex-1 min-w-[180px] max-w-sm"
                  placeholder="Buscar negocio…"
                  aria-label="Buscar negocio por nombre"
                  value={buscar}
                  onChange={(e) => setBuscar(e.target.value)}
                />
                <button type="button" className="btn-ghost text-xs" onClick={() => exportar('xlsx')} disabled={datos.filas.length === 0}>
                  Excel
                </button>
                <button type="button" className="btn-ghost text-xs" onClick={() => exportar('csv')} disabled={datos.filas.length === 0}>
                  CSV
                </button>
              </div>

              {datos.filas.length === 0 ? (
                <p className="text-sm text-mute">Ningún negocio tuvo movimiento en el rango ni en el período anterior.</p>
              ) : (
                <div className="table-wrap">
                  <table className="w-full text-sm min-w-[720px]">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-mute border-b border-line">
                        <th className="py-2 pr-2 font-semibold w-8">#</th>
                        <th className="py-2 pr-3 font-semibold">Negocio</th>
                        <th className="py-2 pr-3 font-semibold text-right">{datos.etiquetaValor}</th>
                        <th className="py-2 pr-3 font-semibold text-right">Antes</th>
                        {datos.columnas.map((c) => (
                          <th key={c.clave} className={`py-2 pr-3 font-semibold ${c.tipo === 'texto' || c.tipo === 'fecha' ? '' : 'text-right'}`}>
                            {c.etiqueta}
                          </th>
                        ))}
                        <th className="py-2 font-semibold" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line2">
                      {filas.map((f, i) => {
                        const abierto = abiertos.has(f.id);
                        const hayDetalle = !!f.detalle?.length && !!datos.columnasDetalle;
                        return (
                          <Fragment key={f.id}>
                            <tr className="align-top">
                              <td className="py-2 pr-2 text-mute tabular-nums">{i + 1}</td>
                              <td className="py-2 pr-3 max-w-[240px]">
                                <Link href={`/admin/tenants/${f.id}`} className="font-medium text-ink hover:text-brand truncate block">
                                  {f.nombre}
                                </Link>
                                <span className={`badge ${ESTADO[f.estado].badge} mt-0.5`}>{ESTADO[f.estado].etiqueta}</span>
                              </td>
                              <td className="py-2 pr-3 text-right tabular-nums font-bold text-ink">{num(f.valor)}</td>
                              <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                                <span className="text-mute">{num(f.anterior)}</span>
                                <span className="block">
                                  <Cambio v={f.variacion} />
                                </span>
                              </td>
                              {datos.columnas.map((c) => (
                                <td
                                  key={c.clave}
                                  className={`py-2 pr-3 whitespace-nowrap ${c.tipo === 'texto' || c.tipo === 'fecha' ? '' : 'text-right tabular-nums'}`}
                                >
                                  {celda(c, f.extra[c.clave] ?? null, f.extra)}
                                </td>
                              ))}
                              <td className="py-2 text-right whitespace-nowrap">
                                {hayDetalle && (
                                  <button
                                    type="button"
                                    className="btn-link text-xs"
                                    aria-expanded={abierto}
                                    aria-controls={`detalle-${f.id}`}
                                    onClick={() => alternar(f.id)}
                                  >
                                    {abierto ? 'Ocultar' : `Ver ${f.detalle!.length === 1 ? '1 tarjeta' : `${f.detalle!.length} tarjetas`}`}
                                  </button>
                                )}
                              </td>
                            </tr>
                            {hayDetalle && abierto && (
                              <tr id={`detalle-${f.id}`}>
                                <td />
                                <td colSpan={colSpan - 1} className="pb-3">
                                  <table className="w-full text-xs bg-bg2 rounded-lg">
                                    <thead>
                                      <tr className="text-left text-mute">
                                        {datos.columnasDetalle!.map((c) => (
                                          <th key={c.clave} className={`px-3 py-1.5 font-semibold ${c.tipo === 'numero' ? 'text-right' : ''}`}>
                                            {c.etiqueta}
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {f.detalle!.map((d, j) => (
                                        <tr key={j} className="border-t border-line2">
                                          {datos.columnasDetalle!.map((c) => (
                                            <td key={c.clave} className={`px-3 py-1.5 ${c.tipo === 'numero' ? 'text-right tabular-nums' : ''}`}>
                                              {celda(c, d[c.clave] ?? null, d)}
                                            </td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-line font-semibold">
                        <td />
                        <td className="py-2 pr-3">
                          Total{buscar.trim() ? ' (todos los negocios, sin el filtro)' : ''}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{num(datos.totales.valor)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-mute">{num(datos.totales.anterior)}</td>
                        {datos.columnas.map((c) => (
                          <td key={c.clave} className="py-2 pr-3 text-right tabular-nums">
                            {c.clave in datos.totales.extra ? num(datos.totales.extra[c.clave]) : ''}
                          </td>
                        ))}
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                  {buscar.trim() && filas.length === 0 && (
                    <p className="text-sm text-mute mt-3">Ningún negocio se llama así.</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function ResumenCanjes({ c }: { c: NonNullable<Respuesta['canjes']> }) {
  return (
    <div className="card card-pad">
      <p className="text-sm font-semibold text-ink">{c.frase}</p>
      <div className="h-3 rounded-full bg-bg2 overflow-hidden mt-3 flex" aria-hidden>
        {c.porTipo.map((t) => (
          <div key={t.tipo} style={{ width: `${t.porcentaje ?? 0}%`, background: COLOR_CANJE[t.tipo] }} title={`${t.etiqueta}: ${num(t.canjes)}`} />
        ))}
      </div>
      <ul className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        {c.porTipo.map((t) => (
          <li key={t.tipo} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: COLOR_CANJE[t.tipo] }} />
            <span className="flex-1 first-letter:uppercase">{t.etiqueta}</span>
            <span className="tabular-nums font-medium">{num(t.canjes)}</span>
            <span className="tabular-nums text-mute w-14 text-right">{t.porcentaje == null ? '—' : `${num(t.porcentaje)} %`}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-mute mt-3">
        Un premio de sellos solo se puede canjear con la tarjeta completa: el sistema lo comprueba y descuenta los sellos. Un cupón
        se canjea sin sellos.
        {c.sinClasificar > 0 &&
          ` ${num(c.sinClasificar)} ${c.sinClasificar === 1 ? 'canje no traía' : 'canjes no traían'} su clase (copias de un negocio duplicado) y se clasificaron por el tipo de la tarjeta.`}
      </p>
    </div>
  );
}
