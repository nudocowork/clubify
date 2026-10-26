'use client';
import { useCallback, useEffect, useState } from 'react';
import { EnlaceNegocio, useFuenteMetricas } from '@/lib/fuente-metricas';
import { descargarCsv, descargarXlsx, type Celda } from '@/lib/exportar-hoja';
import { GraficaCombinada, GraficaSerie, diaCorto } from './Graficas';
import { DesgloseMetrica, type MetricaDesglose } from './DesgloseMetrica';

// ── Tipos de la respuesta de GET /admin/metricas/generales ─────────────────

type Variacion = { pct: number | null; tendencia: 'sube' | 'baja' | 'igual' | 'nuevo' };
type Kpi = { valor: number; anterior: number; variacion: Variacion };
type RangoResp = { desde: string; hasta: string; dias: number };
type Estado = 'ACTIVE' | 'TRIAL' | 'SUSPENDED';

type Respuesta = {
  zonaHoraria: string;
  generadoEn: string;
  rango: RangoResp;
  anterior: RangoResp;
  granularidad: 'dia' | 'semana';
  serie: Array<{ desde: string; hasta: string; pases: number; sellos: number; pedidos: number; clientes: number }>;
  pases: Kpi;
  tarjetas: { total: number; creadas: number; anterior: number; variacion: Variacion };
  pedidos: Kpi & {
    cancelados: number;
    porMoneda: Array<{
      moneda: string;
      pedidos: number;
      cobrados: number;
      valor: number;
      ticketPromedio: number | null;
      valorAnterior: number;
      variacion: Variacion;
    }>;
    totalUsd: number | null;
  };
  clientes: Kpi;
  sellos: Kpi & { canjes: Kpi };
  wallet: {
    emitidos: number;
    guardados: number;
    apple: number;
    google: number;
    sinPlataforma: number;
    porcentajeGuardados: number | null;
    porcentajeAnterior: number | null;
  };
  push: { envios: Kpi; entregados: number; destinatarios: number; enviosConEstadisticas: number };
  negocios: {
    enAlcance: number;
    activos: number;
    enPrueba: number;
    suspendidos: number;
    usan: number;
    sinUso: Array<{ id: string; nombre: string; estado: Estado; ultimoMovimientoEn: string | null; ultimoPedidoEn: string | null }>;
    promedioPasesEnRango: number;
    promedioPasesHistorico: number;
    topCrecimiento: Array<{ id: string; nombre: string; enRango: number; anterior: number; variacion: Variacion }>;
  };
  sinClientesNuevos: Array<{
    id: string;
    nombre: string;
    estado: Estado;
    enPrueba: boolean;
    diasSinClienteNuevo: number | null;
    diasQuedado: number;
    ultimoClienteEn: string | null;
    totalClientes: number;
    ultimoSelloEn: string | null;
  }>;
};

type Preset = 'hoy' | '7d' | '30d' | '90d' | 'mes' | 'mesAnterior' | 'personalizado';
const PRESETS: Array<{ id: Preset; etiqueta: string }> = [
  { id: 'hoy', etiqueta: 'Hoy' },
  { id: '7d', etiqueta: '7 días' },
  { id: '30d', etiqueta: '30 días' },
  { id: '90d', etiqueta: '90 días' },
  { id: 'mes', etiqueta: 'Este mes' },
  { id: 'mesAnterior', etiqueta: 'Mes anterior' },
  { id: 'personalizado', etiqueta: 'Personalizado' },
];

const COLORES = { pases: '#22C55E', sellos: '#2563EB', pedidos: '#D97706', clientes: '#0D9488' };

// ── Formato ────────────────────────────────────────────────────────────────

const num = (v: number) => v.toLocaleString('es-CO');
const fmtFecha = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
const fecha = (iso: string | null) => (iso ? fmtFecha.format(new Date(iso)) : '—');
const ymd = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(iso)) : '';
const hoyBogota = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());

function dinero(v: number, moneda: string) {
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: moneda,
      maximumFractionDigits: moneda === 'USD' || moneda === 'EUR' ? 2 : 0,
    }).format(v);
  } catch {
    // Código de moneda raro en la base: se muestra tal cual, sin adivinar.
    return `${num(Math.round(v))} ${moneda}`;
  }
}

function rangoTexto(r: RangoResp) {
  return r.desde === r.hasta ? diaCorto(r.desde) : `${diaCorto(r.desde)} – ${diaCorto(r.hasta)}`;
}

const ESTADO: Record<Estado, { etiqueta: string; badge: string }> = {
  ACTIVE: { etiqueta: 'Activo', badge: 'badge-ok' },
  TRIAL: { etiqueta: 'En prueba', badge: 'badge-warn' },
  SUSPENDED: { etiqueta: 'Suspendido', badge: 'badge-bad' },
};

// ── Piezas ─────────────────────────────────────────────────────────────────

function Cambio({ v, anterior }: { v: Variacion; anterior?: string }) {
  const titulo = anterior ? `Período anterior: ${anterior}` : undefined;
  if (v.tendencia === 'nuevo') {
    return (
      <span className="text-xs font-semibold text-ok-ink" title={titulo}>
        ▲ nuevo (antes 0)
      </span>
    );
  }
  if (v.tendencia === 'igual') {
    return (
      <span className="text-xs font-semibold text-mute" title={titulo}>
        = sin cambio
      </span>
    );
  }
  const sube = v.tendencia === 'sube';
  return (
    <span className={`text-xs font-semibold ${sube ? 'text-ok-ink' : 'text-bad-ink'}`} title={titulo}>
      {sube ? '▲' : '▼'} {Math.abs(v.pct ?? 0).toLocaleString('es-CO')} %
    </span>
  );
}

function Tarjeta({
  titulo,
  valor,
  variacion,
  anterior,
  sub,
  onAbrir,
}: {
  titulo: string;
  valor: string;
  variacion?: Variacion;
  anterior?: string;
  sub?: React.ReactNode;
  /** Abre el detalle por negocio. Con él, la tarjeta entera es un botón. */
  onAbrir?: () => void;
}) {
  // `span` y no `div` dentro: un botón solo admite contenido en línea.
  const cuerpo = (
    <>
      <span className="kpi-lbl">{titulo}</span>
      <span className="kpi-val block text-2xl sm:text-3xl mt-2 tabular-nums">{valor}</span>
      <span className="mt-1 flex items-center gap-2 flex-wrap">
        {variacion && <Cambio v={variacion} anterior={anterior} />}
        {anterior && <span className="text-[11px] text-mute">vs {anterior}</span>}
      </span>
      {sub && <span className="kpi-sub block mt-1">{sub}</span>}
    </>
  );
  if (!onAbrir) return <div className="kpi">{cuerpo}</div>;
  return (
    <button
      type="button"
      onClick={onAbrir}
      aria-haspopup="dialog"
      aria-label={`${titulo}: ${valor}. Ver el detalle por negocio`}
      className="kpi group block w-full text-left cursor-pointer transition-colors hover:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
    >
      {cuerpo}
      <span className="block mt-2 text-[11px] font-semibold text-brand opacity-70 group-hover:opacity-100 group-focus-visible:opacity-100">
        Ver por negocio →
      </span>
    </button>
  );
}

function Bloque({
  titulo,
  ayuda,
  acciones,
  children,
}: {
  titulo: string;
  ayuda?: string;
  acciones?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-0 overflow-hidden">
      <div className="card-h">
        <div className="min-w-0">
          <h3>{titulo}</h3>
          {ayuda && <p className="text-xs text-mute mt-0.5">{ayuda}</p>}
        </div>
        {acciones}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

// ── Exportar ───────────────────────────────────────────────────────────────

function filasSinClientes(d: Respuesta): Celda[][] {
  return [
    ['Negocio', 'Estado', 'Días desde su último cliente nuevo', 'Último cliente nuevo', 'Total de clientes', 'Último sello', 'Ficha'],
    ...d.sinClientesNuevos.map((f) => [
      f.nombre,
      ESTADO[f.estado].etiqueta,
      f.diasSinClienteNuevo ?? `Nunca (alta hace ${f.diasQuedado} días)`,
      ymd(f.ultimoClienteEn),
      f.totalClientes,
      ymd(f.ultimoSelloEn),
      `${typeof window !== 'undefined' ? window.location.origin : ''}/admin/tenants/${f.id}`,
    ]),
  ];
}

// ── Componente ─────────────────────────────────────────────────────────────

export function MetricasGenerales() {
  const [preset, setPreset] = useState<Preset>('30d');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  // El rango personalizado se aplica con un botón: consultar a cada tecla de
  // la fecha dispararía una consulta pesada por cada dígito.
  const [aplicado, setAplicado] = useState<{ desde: string; hasta: string } | null>(null);
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verSinUso, setVerSinUso] = useState(false);
  const [desglose, setDesglose] = useState<MetricaDesglose | null>(null);
  const cerrarDesglose = useCallback(() => setDesglose(null), []);

  // La MISMA consulta para la tarjeta y para su detalle: si el detalle pidiera
  // otro rango, su suma no cuadraría con el número que se quiere confirmar.
  const q = new URLSearchParams({ preset });
  if (preset === 'personalizado' && aplicado) {
    q.set('desde', aplicado.desde);
    q.set('hasta', aplicado.hasta);
  }
  const consulta = q.toString();

  const fuente = useFuenteMetricas();
  useEffect(() => {
    if (preset === 'personalizado' && !aplicado) return;
    let vivo = true;
    setCargando(true);
    setError(null);
    fuente.get<Respuesta>(`/admin/metricas/generales?${consulta}`)
      .then((r) => vivo && setDatos(r))
      .catch((e: unknown) => vivo && setError(e instanceof Error ? e.message : 'No se pudieron cargar las métricas.'))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [preset, aplicado, consulta]);

  const hoy = hoyBogota();
  const puedeAplicar = !!desde && !!hasta && desde <= hasta;

  return (
    <div className="space-y-4">
      {/* Selector de rango */}
      <div className="card card-pad space-y-3">
        <div className="flex gap-1.5 flex-wrap">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset(p.id)}
              className={`px-3 py-1 text-xs rounded-full border ${
                preset === p.id ? 'border-brand text-brand font-semibold bg-brand-soft' : 'border-line text-mute'
              }`}
            >
              {p.etiqueta}
            </button>
          ))}
        </div>
        {preset === 'personalizado' && (
          <div className="flex items-end gap-2 flex-wrap">
            <label className="text-xs text-mute">
              Desde
              <input type="date" className="input h-9 text-sm block mt-1" value={desde} max={hoy} onChange={(e) => setDesde(e.target.value)} />
            </label>
            <label className="text-xs text-mute">
              Hasta
              <input type="date" className="input h-9 text-sm block mt-1" value={hasta} max={hoy} onChange={(e) => setHasta(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn-primary h-9"
              disabled={!puedeAplicar}
              onClick={() => setAplicado({ desde, hasta })}
            >
              Aplicar
            </button>
          </div>
        )}
        {datos && (
          <p className="text-xs text-mute">
            Del <b className="text-ink">{rangoTexto(datos.rango)}</b> ({datos.rango.dias}{' '}
            {datos.rango.dias === 1 ? 'día' : 'días'}), comparado con <b className="text-ink">{rangoTexto(datos.anterior)}</b>. Hora
            de Bogotá.
            {preset === 'hoy' && ' Hoy aún no termina: la comparación con ayer completo se irá emparejando.'}
          </p>
        )}
      </div>

      {preset === 'personalizado' && !aplicado ? (
        <div className="card card-pad text-sm text-mute">Elige las dos fechas y pulsa «Aplicar».</div>
      ) : error ? (
        <div className="card card-pad text-sm text-bad-ink">{error}</div>
      ) : !datos ? (
        <div className="card card-pad text-sm text-mute">Cargando…</div>
      ) : (
        <div className={`space-y-4 ${cargando ? 'opacity-60 pointer-events-none' : ''}`} aria-busy={cargando}>
          <Contenido d={datos} verSinUso={verSinUso} setVerSinUso={setVerSinUso} abrir={setDesglose} />
        </div>
      )}

      {desglose && datos && (
        <DesgloseMetrica
          metrica={desglose}
          consulta={consulta}
          totalTarjeta={totalDeTarjeta(datos, desglose)}
          onCerrar={cerrarDesglose}
        />
      )}
    </div>
  );
}

/** El número que enseña cada tarjeta, para que el detalle diga si cuadra con ella. */
function totalDeTarjeta(d: Respuesta, m: MetricaDesglose): number {
  switch (m) {
    case 'pases':
      return d.pases.valor;
    case 'clientes':
      return d.clientes.valor;
    case 'sellos':
      return d.sellos.valor;
    case 'canjes':
      return d.sellos.canjes.valor;
    case 'pedidos':
      return d.pedidos.valor;
    case 'tarjetas':
      return d.tarjetas.creadas;
    case 'push':
      return d.push.envios.valor;
    case 'wallet':
      return d.wallet.guardados;
    case 'uso':
      return d.negocios.usan;
  }
}

function Contenido({
  d,
  verSinUso,
  setVerSinUso,
  abrir,
}: {
  d: Respuesta;
  verSinUso: boolean;
  setVerSinUso: (v: boolean) => void;
  abrir: (m: MetricaDesglose) => void;
}) {
  const ant = rangoTexto(d.anterior);
  const porSemana = d.granularidad === 'semana';
  const tramo = porSemana ? 'por semana' : 'por día';
  const pctUso = d.negocios.activos > 0 ? Math.round((d.negocios.usan / d.negocios.activos) * 100) : 0;
  const nombreArchivo = `negocios-sin-clientes-nuevos-${d.rango.desde}_${d.rango.hasta}`;

  return (
    <>
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 xl:grid-cols-4 gap-3">
        <Tarjeta
          titulo="Pases emitidos"
          valor={num(d.pases.valor)}
          variacion={d.pases.variacion}
          anterior={num(d.pases.anterior)}
          onAbrir={() => abrir('pases')}
        />
        <Tarjeta
          titulo="Clientes nuevos"
          valor={num(d.clientes.valor)}
          variacion={d.clientes.variacion}
          anterior={num(d.clientes.anterior)}
          onAbrir={() => abrir('clientes')}
        />
        <Tarjeta
          titulo="Sellos otorgados"
          valor={num(Math.round(d.sellos.valor))}
          variacion={d.sellos.variacion}
          anterior={num(Math.round(d.sellos.anterior))}
          onAbrir={() => abrir('sellos')}
        />
        {/* Cuenta TODAS las filas REDEEM: premios de sellos y también cupones.
            El detalle los separa por tipo de tarjeta. */}
        <Tarjeta
          titulo="Premios canjeados"
          valor={num(d.sellos.canjes.valor)}
          variacion={d.sellos.canjes.variacion}
          anterior={num(d.sellos.canjes.anterior)}
          sub="Premios de sellos y cupones"
          onAbrir={() => abrir('canjes')}
        />
        <Tarjeta
          titulo="Pedidos por el menú"
          valor={num(d.pedidos.valor)}
          variacion={d.pedidos.variacion}
          anterior={num(d.pedidos.anterior)}
          sub={d.pedidos.cancelados > 0 ? `${num(d.pedidos.cancelados)} cancelados aparte` : undefined}
          onAbrir={() => abrir('pedidos')}
        />
        <Tarjeta
          titulo="Tarjetas creadas"
          valor={num(d.tarjetas.creadas)}
          variacion={d.tarjetas.variacion}
          anterior={num(d.tarjetas.anterior)}
          sub={`${num(d.tarjetas.total)} tarjetas en total`}
          onAbrir={() => abrir('tarjetas')}
        />
        <Tarjeta
          titulo="Push enviados"
          valor={num(d.push.envios.valor)}
          variacion={d.push.envios.variacion}
          anterior={num(d.push.envios.anterior)}
          sub={
            d.push.enviosConEstadisticas > 0
              ? `${num(d.push.entregados)} entregas registradas`
              : 'Sin entregas registradas'
          }
          onAbrir={() => abrir('push')}
        />
        <Tarjeta
          titulo="Guardados en Wallet"
          valor={d.wallet.porcentajeGuardados == null ? '—' : `${d.wallet.porcentajeGuardados.toLocaleString('es-CO')} %`}
          sub={`${num(d.wallet.guardados)} de ${num(d.wallet.emitidos)} pases emitidos`}
          anterior={d.wallet.porcentajeAnterior == null ? undefined : `${d.wallet.porcentajeAnterior.toLocaleString('es-CO')} %`}
          onAbrir={() => abrir('wallet')}
        />
      </div>

      <Bloque titulo={`Pases, sellos y pedidos ${tramo}`} ayuda="Toca una serie en la leyenda para ocultarla y reescalar el eje.">
        <GraficaCombinada
          tramos={d.serie}
          series={[
            { clave: 'pases', etiqueta: 'Pases', color: COLORES.pases, valores: d.serie.map((s) => s.pases) },
            { clave: 'sellos', etiqueta: 'Sellos', color: COLORES.sellos, valores: d.serie.map((s) => s.sellos) },
            { clave: 'pedidos', etiqueta: 'Pedidos', color: COLORES.pedidos, valores: d.serie.map((s) => s.pedidos) },
          ]}
        />
      </Bloque>

      <div className="grid lg:grid-cols-2 gap-4">
        <Bloque titulo={`Pases emitidos ${tramo}`} ayuda={`${num(d.pases.valor)} en el rango · ${num(d.pases.anterior)} en ${ant}`}>
          <GraficaSerie tramos={d.serie} valores={d.serie.map((s) => s.pases)} color={COLORES.pases} unidad="pases" />
        </Bloque>
        <Bloque titulo={`Clientes nuevos ${tramo}`} ayuda={`${num(d.clientes.valor)} registrados en el rango`}>
          <GraficaSerie tramos={d.serie} valores={d.serie.map((s) => s.clientes)} color={COLORES.clientes} unidad="clientes" />
        </Bloque>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Bloque
          titulo="Pedidos por el menú"
          ayuda="Se cuentan todos menos los cancelados; el valor y el ticket, solo los confirmados, listos o entregados."
        >
          <GraficaSerie tramos={d.serie} valores={d.serie.map((s) => s.pedidos)} color={COLORES.pedidos} unidad="pedidos" />
          {d.pedidos.porMoneda.length === 0 ? (
            <p className="text-sm text-mute mt-3">Sin pedidos en el rango.</p>
          ) : (
            <div className="table-wrap mt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-mute border-b border-line">
                    <th className="py-2 pr-3 font-semibold">Moneda</th>
                    <th className="py-2 pr-3 font-semibold text-right">Pedidos</th>
                    <th className="py-2 pr-3 font-semibold text-right">Valor</th>
                    <th className="py-2 font-semibold text-right">Ticket promedio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line2">
                  {d.pedidos.porMoneda.map((m) => (
                    <tr key={m.moneda}>
                      <td className="py-2 pr-3 font-medium">{m.moneda}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{num(m.pedidos)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                        {dinero(m.valor, m.moneda)}
                        <div>
                          <Cambio v={m.variacion} anterior={dinero(m.valorAnterior, m.moneda)} />
                        </div>
                      </td>
                      <td className="py-2 text-right tabular-nums whitespace-nowrap">
                        {m.ticketPromedio == null ? '—' : dinero(m.ticketPromedio, m.moneda)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-mute mt-2">
            {d.pedidos.totalUsd != null
              ? `Total: ${dinero(d.pedidos.totalUsd, 'USD')}.`
              : 'Cada negocio cobra en su moneda y el sistema no guarda tasas de cambio, así que no se suma en USD: se muestra el total de cada moneda.'}
          </p>
        </Bloque>

        <Bloque
          titulo="Pases guardados en Wallet"
          ayuda="De los pases emitidos en el rango, cuántos terminaron guardados en el teléfono."
          acciones={
            <button type="button" className="btn-ghost text-xs" aria-haspopup="dialog" onClick={() => abrir('wallet')}>
              Por negocio
            </button>
          }
        >
          <BarraWallet w={d.wallet} />
        </Bloque>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Bloque
          titulo="Negocios que usan el sistema"
          ayuda="Activos con al menos un movimiento del escáner (sello, puntos, visita o canje) o un pedido en el rango."
          acciones={
            <div className="flex gap-2 flex-wrap">
              {d.negocios.sinUso.length > 0 && (
                <button type="button" className="btn-ghost text-xs" onClick={() => setVerSinUso(!verSinUso)}>
                  {verSinUso ? 'Ocultar lista' : `Ver los ${num(d.negocios.sinUso.length)} sin uso`}
                </button>
              )}
              <button type="button" className="btn-ghost text-xs" aria-haspopup="dialog" onClick={() => abrir('uso')}>
                Detalle por negocio
              </button>
            </div>
          }
        >
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-3xl font-bold text-ink tabular-nums">{num(d.negocios.usan)}</span>
            <span className="text-sm text-mute">
              de {num(d.negocios.activos)} activos ({pctUso} %) · {num(d.negocios.activos - d.negocios.usan)} sin uso
            </span>
          </div>
          <div className="h-3 rounded-full bg-bg2 overflow-hidden mt-3" aria-hidden>
            <div className="h-full rounded-full bg-brand" style={{ width: `${pctUso}%` }} />
          </div>
          <p className="text-[11px] text-mute mt-2">
            {num(d.negocios.enPrueba)} en prueba y {num(d.negocios.suspendidos)} suspendidos no entran en esta cuenta.
          </p>
          {verSinUso && (
            <ul className="divide-y divide-line2 mt-3 max-h-80 overflow-y-auto">
              {d.negocios.sinUso.map((x) => (
                <li key={x.id}>
                  <EnlaceNegocio id={x.id} className="flex items-center gap-3 py-2 hover:bg-bg2 rounded-lg px-2">
                    <span className="flex-1 min-w-0 truncate font-medium">{x.nombre}</span>
                    <span className="text-[11px] text-mute text-right whitespace-nowrap">
                      último movimiento {fecha(x.ultimoMovimientoEn)}
                      <br />
                      último pedido {fecha(x.ultimoPedidoEn)}
                    </span>
                  </EnlaceNegocio>
                </li>
              ))}
            </ul>
          )}
        </Bloque>

        <Bloque
          titulo="Pases por negocio activo"
          ayuda="Top 5 por pases emitidos en el rango, con la variación frente al período anterior."
          acciones={
            <button type="button" className="btn-ghost text-xs" aria-haspopup="dialog" onClick={() => abrir('pases')}>
              Ver todos
            </button>
          }
        >
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <div className="text-2xl font-bold text-ink tabular-nums">{d.negocios.promedioPasesEnRango.toLocaleString('es-CO')}</div>
              <div className="text-[11px] text-mute">promedio en el rango</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-ink tabular-nums">{d.negocios.promedioPasesHistorico.toLocaleString('es-CO')}</div>
              <div className="text-[11px] text-mute">promedio histórico</div>
            </div>
          </div>
          {d.negocios.topCrecimiento.length === 0 ? (
            <p className="text-sm text-mute">Ningún negocio emitió pases en el rango.</p>
          ) : (
            <ol className="space-y-1">
              {d.negocios.topCrecimiento.map((x, i) => (
                <li key={x.id}>
                  <EnlaceNegocio id={x.id} className="flex items-center gap-3 py-1.5 px-2 hover:bg-bg2 rounded-lg">
                    <span className="w-5 text-sm font-bold text-mute tabular-nums">{i + 1}</span>
                    <span className="flex-1 min-w-0 truncate font-medium">{x.nombre}</span>
                    <span className="text-right whitespace-nowrap">
                      <span className="font-bold text-brand tabular-nums">{num(x.enRango)}</span>
                      <span className="block">
                        <Cambio v={x.variacion} anterior={num(x.anterior)} />
                      </span>
                    </span>
                  </EnlaceNegocio>
                </li>
              ))}
            </ol>
          )}
        </Bloque>
      </div>

      <Bloque
        titulo={`Negocios sin clientes nuevos (${num(d.sinClientesNuevos.length)})`}
        ayuda="Activos y en prueba que no registraron ningún cliente nuevo en el rango, del que lleva más tiempo quieto al que menos."
        acciones={
          d.sinClientesNuevos.length > 0 ? (
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => descargarXlsx(`${nombreArchivo}.xlsx`, [{ nombre: 'Sin clientes nuevos', filas: filasSinClientes(d) }])}
              >
                Excel
              </button>
              <button type="button" className="btn-ghost text-xs" onClick={() => descargarCsv(`${nombreArchivo}.csv`, filasSinClientes(d))}>
                CSV
              </button>
            </div>
          ) : undefined
        }
      >
        {d.sinClientesNuevos.length === 0 ? (
          <p className="text-sm text-mute">Todos los negocios activos y en prueba registraron clientes nuevos en el rango.</p>
        ) : (
          <div className="table-wrap">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-mute border-b border-line">
                  <th className="py-2 pr-3 font-semibold">Negocio</th>
                  <th className="py-2 pr-3 font-semibold">Estado</th>
                  <th className="py-2 pr-3 font-semibold text-right">Días sin cliente nuevo</th>
                  <th className="py-2 pr-3 font-semibold text-right">Clientes</th>
                  <th className="py-2 pr-3 font-semibold">Último sello</th>
                  <th className="py-2 font-semibold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line2">
                {d.sinClientesNuevos.map((f) => (
                  <tr key={f.id}>
                    <td className="py-2 pr-3 font-medium max-w-[220px] truncate">{f.nombre}</td>
                    <td className="py-2 pr-3">
                      <span className={`badge ${ESTADO[f.estado].badge}`}>{ESTADO[f.estado].etiqueta}</span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                      {f.diasSinClienteNuevo == null ? (
                        <span title={`Dado de alta hace ${f.diasQuedado} días`}>
                          nunca <span className="text-mute">({num(f.diasQuedado)} d de alta)</span>
                        </span>
                      ) : (
                        <>
                          <b>{num(f.diasSinClienteNuevo)}</b>
                          <span className="block text-[11px] text-mute">{fecha(f.ultimoClienteEn)}</span>
                        </>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{num(f.totalClientes)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{fecha(f.ultimoSelloEn)}</td>
                    <td className="py-2 text-right">
                      <EnlaceNegocio id={f.id} className="btn-link text-xs whitespace-nowrap">
                        Ver ficha →
                      </EnlaceNegocio>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloque>
    </>
  );
}

function BarraWallet({ w }: { w: Respuesta['wallet'] }) {
  if (w.emitidos === 0) return <p className="text-sm text-mute">No se emitieron pases en el rango.</p>;
  const pct = (v: number) => (w.emitidos > 0 ? (v / w.emitidos) * 100 : 0);
  const sinGuardar = Math.max(0, w.emitidos - w.guardados);
  const partes = [
    { etiqueta: 'Apple Wallet', valor: w.apple, color: '#0F172A' },
    { etiqueta: 'Google Wallet', valor: w.google, color: '#22C55E' },
    ...(w.sinPlataforma > 0 ? [{ etiqueta: 'Guardado (sin plataforma)', valor: w.sinPlataforma, color: '#9CA3AF' }] : []),
    { etiqueta: 'Sin guardar', valor: sinGuardar, color: '#EEF0F3' },
  ];
  return (
    <div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-3xl font-bold text-ink tabular-nums">
          {w.porcentajeGuardados == null ? '—' : `${w.porcentajeGuardados.toLocaleString('es-CO')} %`}
        </span>
        <span className="text-sm text-mute">
          {num(w.guardados)} de {num(w.emitidos)} guardados
          {w.porcentajeAnterior != null && ` · antes ${w.porcentajeAnterior.toLocaleString('es-CO')} %`}
        </span>
      </div>
      <div className="h-4 rounded-full bg-bg2 overflow-hidden mt-3 flex" aria-hidden>
        {partes.map((p) => (
          <div key={p.etiqueta} style={{ width: `${pct(p.valor)}%`, background: p.color }} title={`${p.etiqueta}: ${num(p.valor)}`} />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {partes.map((p) => (
          <li key={p.etiqueta} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm border border-line" style={{ background: p.color }} />
            <span className="flex-1">{p.etiqueta}</span>
            <span className="tabular-nums font-medium">{num(p.valor)}</span>
            <span className="tabular-nums text-mute w-14 text-right">{Math.round(pct(p.valor))} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
