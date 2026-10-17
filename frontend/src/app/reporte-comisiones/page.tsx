'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { BusinessFilterPicker, type BusinessOption } from '@/components/BusinessFilterPicker';
import { descargarCsv, descargarXlsx, type Celda } from '@/lib/exportar-hoja';
import {
  ESTADOS,
  ETIQUETA_EQUIPO,
  FILTROS_VACIOS,
  PERIODICIDADES,
  PRESETS,
  aQuery,
  rangoDe,
  usd,
  ymd,
  type ColaboradorResumen,
  type Equipo,
  type Estado,
  type Fila,
  type Filtros,
  type Preset,
  type Resumen,
  type SocioContabilidad,
  type Totales,
} from './_lib';
import { GraficaBarras, BarrasPorEquipo } from './_components/GraficaBarras';
import { TablaComisiones } from './_components/TablaComisiones';
import { Descripcion } from './_components/Descripcion';
import { NuevaComision, type OpcionColaborador } from './_components/NuevaComision';
import { Liquidaciones } from './_components/Liquidaciones';
import { PagoPersona } from './_components/PagoPersona';
import { Modal } from './_components/Modal';

type Pestana = 'resumen' | 'colaboradores' | 'equipos' | 'cierre' | 'liquidaciones';
const PESTANAS: Array<{ id: Pestana; etiqueta: string }> = [
  { id: 'resumen', etiqueta: 'Resumen' },
  { id: 'colaboradores', etiqueta: 'Colaboradores' },
  { id: 'equipos', etiqueta: 'Equipos' },
  { id: 'cierre', etiqueta: 'Cierre de comisiones' },
  { id: 'liquidaciones', etiqueta: 'Historial de liquidaciones' },
];
const EQUIPOS: Equipo[] = ['CLOSERS', 'SOCIOS', 'ADMINISTRACION'];

/** Una tarjeta del resumen. Si tiene `onClick`, abre la lista filtrada. */
function Tarjeta({
  titulo,
  valor,
  sub,
  onClick,
  activa,
}: {
  titulo: string;
  valor: string;
  sub?: string;
  onClick?: () => void;
  activa?: boolean;
}) {
  const Cmp = onClick ? 'button' : 'div';
  return (
    <Cmp
      onClick={onClick}
      className={`kpi text-left w-full ${onClick ? 'hover-lift cursor-pointer' : ''} ${activa ? 'ring-2 ring-brand' : ''}`}
    >
      <div className="kpi-lbl">{titulo}</div>
      <div className="kpi-val text-2xl sm:text-3xl mt-2">{valor}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </Cmp>
  );
}

function filasDeCierre(colaboradores: ColaboradorResumen[], general: Totales): Celda[][] {
  return [
    ['Colaborador', 'Rol', 'Equipo', 'Ventas asociadas', 'Monto vendido USD', 'Comisiones USD', 'Ajustes USD', 'Pagado USD', 'Saldo USD', 'Liquidación'],
    ...colaboradores.map((c) => [
      c.nombre,
      c.rolEtiqueta,
      c.equipoDeVenta ?? c.equipoEtiqueta,
      c.totales.ventas,
      c.totales.vendidoUsd,
      c.totales.comisionesUsd,
      c.totales.ajustesUsd,
      c.totales.pagadoUsd,
      c.totales.saldoUsd,
      c.totales.liquidacionEtiqueta,
    ]),
    ['TOTAL', '', '', general.ventas, general.vendidoUsd, general.comisionesUsd, general.ajustesUsd, general.pagadoUsd, general.saldoUsd, ''],
  ];
}

function filasDeDetalle(filas: Fila[]): Celda[][] {
  return [
    ['Fecha', 'Colaborador', 'Rol', 'Equipo', 'Negocio', 'Cliente', 'Plan', 'Tipo', 'Venta USD', '% o fijo', 'Comisión USD', 'Pagado USD', 'Próxima renovación', 'Pago del cliente', 'Estado', 'Corte'],
    ...filas.map((f) => [
      ymd(f.fecha),
      f.colaborador.nombre,
      f.colaborador.rolEtiqueta,
      ETIQUETA_EQUIPO[f.colaborador.equipo],
      f.negocio.nombre,
      f.cliente,
      f.plan,
      f.esDeEquipo ? 'Comisión de equipo' : f.esManual ? `Manual${f.tipoManual ? ` · ${f.tipoManual}` : ''}` : f.tipoVentaEtiqueta,
      f.ventaUsd,
      f.porcentaje != null && !f.esFijo ? `${f.porcentaje}%` : 'Fijo',
      f.montoUsd,
      f.pagadoUsd,
      ymd(f.proximaRenovacion),
      f.estadoCliente,
      f.estadoEtiqueta,
      f.corte?.code ?? '',
    ]),
  ];
}

export default function ReporteComisionesPage() {
  const [pestana, setPestana] = useState<Pestana>('resumen');
  const [preset, setPreset] = useState<Preset>('mes');
  const [filtros, setFiltros] = useState<Filtros>(() => ({ ...FILTROS_VACIOS, ...(rangoDe('mes') ?? {}) }));
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [cargando, setCargando] = useState(true);
  const [prohibido, setProhibido] = useState<string | null>(null);
  const [colaboradores, setColaboradores] = useState<OpcionColaborador[]>([]);
  const [negocios, setNegocios] = useState<BusinessOption[]>([]);
  const [detalleEstado, setDetalleEstado] = useState<Estado | 'TODAS' | null>(null);
  const [detalle, setDetalle] = useState<{ items: Fila[]; total: number; page: number; pageSize: number } | null>(null);
  const [paginaDetalle, setPaginaDetalle] = useState(1);
  const [descripcionId, setDescripcionId] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [filasColab, setFilasColab] = useState<Record<string, Fila[] | 'cargando'>>({});
  const [verColab, setVerColab] = useState<ColaboradorResumen | null>(null);
  const [pago, setPago] = useState<{ c: ColaboradorResumen; corte: ColaboradorResumen['cortesAbiertos'][number] } | null>(null);
  const [equipoAbierto, setEquipoAbierto] = useState<Equipo | null>('CLOSERS');
  const [exportando, setExportando] = useState(false);

  const query = useMemo(() => aQuery(filtros), [filtros]);

  const cargar = useCallback(() => {
    setCargando(true);
    api<Resumen>(`/admin/reporte-comisiones/resumen${query}`)
      .then((r) => {
        setResumen(r);
        setProhibido(null);
      })
      .catch((e: any) => {
        const msg = e?.message ?? 'No se pudo cargar el reporte';
        if (/plataforma|permis|forbidden/i.test(msg)) setProhibido(msg);
        else toast(msg, 'error');
      })
      .finally(() => setCargando(false));
    // Lo abierto del período anterior ya no vale.
    setFilasColab({});
  }, [query]);

  useEffect(() => cargar(), [cargar]);

  useEffect(() => {
    api<{ colaboradores: OpcionColaborador[] }>('/admin/reporte-comisiones/opciones')
      .then((r) => setColaboradores(r.colaboradores))
      .catch(() => setColaboradores([]));
    api<BusinessOption[]>('/admin/commissions/businesses')
      .then((r) => setNegocios(Array.isArray(r) ? r : []))
      .catch(() => setNegocios([]));
  }, []);

  // Lista filtrada de la tarjeta elegida (paginada en el servidor).
  useEffect(() => {
    if (!detalleEstado) {
      setDetalle(null);
      return;
    }
    const estado = detalleEstado === 'TODAS' ? undefined : detalleEstado;
    api<{ items: Fila[]; total: number; page: number; pageSize: number }>(
      `/admin/reporte-comisiones/comisiones${aQuery({ ...filtros, estado: estado ?? filtros.estado, page: paginaDetalle, pageSize: 50 })}`,
    )
      .then(setDetalle)
      .catch((e) => toast(e?.message ?? 'No se pudo cargar la lista', 'error'));
  }, [detalleEstado, paginaDetalle, filtros]);

  function elegirPreset(p: Preset) {
    setPreset(p);
    const r = rangoDe(p);
    if (r) setFiltros((f) => ({ ...f, ...r }));
  }

  function filtro<K extends keyof Filtros>(k: K, v: Filtros[K]) {
    setFiltros((f) => ({ ...f, [k]: v }));
    setPaginaDetalle(1);
  }

  async function abrirColaborador(codeId: string) {
    if (abierto === codeId) {
      setAbierto(null);
      return;
    }
    setAbierto(codeId);
    if (filasColab[codeId] && filasColab[codeId] !== 'cargando') return;
    setFilasColab((m) => ({ ...m, [codeId]: 'cargando' }));
    try {
      const r = await api<{ filas: Fila[] }>(`/admin/reporte-comisiones/colaboradores/${codeId}${query}`);
      setFilasColab((m) => ({ ...m, [codeId]: r.filas }));
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo cargar el colaborador', 'error');
      setFilasColab((m) => {
        const n = { ...m };
        delete n[codeId];
        return n;
      });
    }
  }

  const nombreArchivo = (base: string, ext: string) =>
    `${base}-${filtros.desde || 'inicio'}_a_${filtros.hasta || 'hoy'}.${ext}`;

  async function todasLasFilas(): Promise<Fila[]> {
    const r = await api<{ items: Fila[] }>(`/admin/reporte-comisiones/comisiones${aQuery({ ...filtros, page: 1, pageSize: 5000 })}`);
    return r.items;
  }

  async function reporteGeneral() {
    if (!resumen) return;
    setExportando(true);
    try {
      const filas = await todasLasFilas();
      const g = resumen.general;
      descargarXlsx(nombreArchivo('reporte-comisiones', 'xlsx'), [
        {
          nombre: 'Resumen',
          filas: [
            ['Reporte de comisiones'],
            ['Desde', filtros.desde || 'Inicio'],
            ['Hasta', filtros.hasta || 'Hoy'],
            [],
            ['Ventas del período (Contabilidad) USD', resumen.ventas.totalUsd],
            ['Cantidad de ventas', resumen.ventas.cantidad],
            ['Comisiones USD', g.comisionesUsd],
            ['Ajustes USD', g.ajustesUsd],
            ['Pagado USD', g.pagadoUsd],
            ['Saldo USD', g.saldoUsd],
            ['Colaboradores comisionando', resumen.colaboradoresComisionando],
            [],
            ['Estado', 'Cantidad', 'Monto USD'],
            ...ESTADOS.map((e) => [e.etiqueta, g.porEstado[e.id].cantidad, g.porEstado[e.id].montoUsd]),
            [],
            ['Equipo', 'Vendido USD', 'Comisiones USD', 'Pagado USD', 'Saldo USD'],
            ...EQUIPOS.map((e) => [
              ETIQUETA_EQUIPO[e],
              resumen.porEquipo[e].vendidoUsd,
              resumen.porEquipo[e].comisionesUsd + resumen.porEquipo[e].ajustesUsd,
              resumen.porEquipo[e].pagadoUsd,
              resumen.porEquipo[e].saldoUsd,
            ]),
          ],
        },
        { nombre: 'Por colaborador', filas: filasDeCierre(resumen.colaboradores, g) },
        { nombre: 'Detalle', filas: filasDeDetalle(filas) },
      ]);
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo armar el reporte', 'error');
    } finally {
      setExportando(false);
    }
  }

  if (prohibido) {
    return (
      <div className="card card-pad max-w-xl">
        <h1 className="page-title">Reporte de comisiones</h1>
        <p className="text-sm text-mute mt-2">Esta sección es de la plataforma Clubify y no está disponible para tu cuenta.</p>
        <Link href="/admin" className="btn-ghost mt-4">
          Volver al panel
        </Link>
      </div>
    );
  }

  const g = resumen?.general;

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* Imprimir / PDF: solo la zona del reporte, sin menú ni filtros. */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #zona-impresion, #zona-impresion * { visibility: visible !important; }
          #zona-impresion { position: absolute; left: 0; top: 0; width: 100%; padding: 0 12px; }
          #zona-impresion .no-print { display: none !important; }
          #zona-impresion .overflow-x-auto { overflow: visible !important; }
          #zona-impresion table { min-width: 0 !important; font-size: 10px; }
          @page { size: landscape; margin: 12mm; }
        }
      `}</style>

      <div className="page-head">
        <div>
          <h1 className="page-title">Reporte de comisiones</h1>
          <p className="text-sm text-mute mt-1">Ventas, comisiones y pagos de la plataforma. Fechas en hora de Bogotá.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/commissions" className="btn-ghost">
            Ir a Comisiones
          </Link>
          <button className="btn-primary" onClick={() => setNueva(true)}>
            + Nueva comisión
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="card card-pad mb-4 space-y-3">
        <div className="tabs w-full sm:w-fit">
          {PRESETS.map((p) => (
            <button key={p.id} className={`tab ${preset === p.id ? 'tab-active' : ''}`} onClick={() => elegirPreset(p.id)}>
              {p.etiqueta}
            </button>
          ))}
        </div>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Desde</label>
              <input
                type="date"
                className="input"
                value={filtros.desde}
                onChange={(e) => {
                  setPreset('rango');
                  filtro('desde', e.target.value);
                }}
              />
            </div>
            <div>
              <label className="label">Hasta</label>
              <input
                type="date"
                className="input"
                value={filtros.hasta}
                onChange={(e) => {
                  setPreset('rango');
                  filtro('hasta', e.target.value);
                }}
              />
            </div>
          </div>
          <div>
            <label className="label">Colaborador</label>
            <select className="input" value={filtros.colaborador} onChange={(e) => filtro('colaborador', e.target.value)}>
              <option value="">Todos</option>
              {colaboradores.map((c) => (
                <option key={c.codeId} value={c.codeId}>
                  {c.etiqueta}
                  {c.activo ? '' : ' (inactivo)'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Equipo</label>
            <select className="input" value={filtros.equipo} onChange={(e) => filtro('equipo', e.target.value)}>
              <option value="">Todos</option>
              {EQUIPOS.map((e) => (
                <option key={e} value={e}>
                  {ETIQUETA_EQUIPO[e]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Negocio</label>
            <BusinessFilterPicker businesses={negocios} value={filtros.negocio} onChange={(id) => filtro('negocio', id)} />
          </div>
          <div>
            <label className="label">Periodicidad</label>
            <select className="input" value={filtros.periodicidad} onChange={(e) => filtro('periodicidad', e.target.value)}>
              <option value="">Todas</option>
              {PERIODICIDADES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.etiqueta}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Tipo de venta</label>
            <select className="input" value={filtros.tipoVenta} onChange={(e) => filtro('tipoVenta', e.target.value)}>
              <option value="">Todas</option>
              <option value="NUEVA">Venta nueva</option>
              <option value="RENOVACION">Renovación</option>
            </select>
          </div>
          <div>
            <label className="label">Estado</label>
            <select className="input" value={filtros.estado} onChange={(e) => filtro('estado', e.target.value)}>
              <option value="">Todos</option>
              {ESTADOS.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.etiqueta}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              className="btn-ghost w-full justify-center"
              onClick={() => {
                setPreset('mes');
                setFiltros({ ...FILTROS_VACIOS, ...(rangoDe('mes') ?? {}) });
              }}
            >
              Limpiar filtros
            </button>
          </div>
        </div>
      </div>

      {resumen?.avisos?.length ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {resumen.avisos.map((a) => (
            <p key={a}>{a}</p>
          ))}
        </div>
      ) : null}

      <div className="tabs mb-4">
        {PESTANAS.map((p) => (
          <button key={p.id} className={`tab ${pestana === p.id ? 'tab-active' : ''}`} onClick={() => setPestana(p.id)}>
            {p.etiqueta}
          </button>
        ))}
      </div>

      {cargando && !resumen && <div className="pulse-soft h-64" />}

      {resumen && g && pestana === 'resumen' && (
        <div className={`space-y-4 ${cargando ? 'opacity-60' : ''}`}>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Tarjeta titulo="Ventas del período" valor={usd(resumen.ventas.totalUsd)} sub={`${resumen.ventas.cantidad} cobros pagados (Contabilidad)`} />
            <Tarjeta
              titulo="Comisiones del período"
              valor={usd(g.comisionesUsd + g.ajustesUsd)}
              sub={`${g.comisiones} comisiones${g.ajustesUsd ? ` · ajustes ${usd(g.ajustesUsd)}` : ''}`}
              onClick={() => {
                setDetalleEstado('TODAS');
                setPaginaDetalle(1);
              }}
              activa={detalleEstado === 'TODAS'}
            />
            <Tarjeta titulo="Colaboradores comisionando" valor={String(resumen.colaboradoresComisionando)} sub="Con comisiones vivas en el período" />
            <Tarjeta titulo="Saldo por pagar" valor={usd(g.saldoUsd)} sub={`Pagado ${usd(g.pagadoUsd)}`} />
          </div>

          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
            {ESTADOS.map((e) => (
              <Tarjeta
                key={e.id}
                titulo={e.etiqueta}
                valor={usd(g.porEstado[e.id].montoUsd)}
                sub={`${g.porEstado[e.id].cantidad} · ${e.ayuda}`}
                onClick={() => {
                  setDetalleEstado(e.id);
                  setPaginaDetalle(1);
                }}
                activa={detalleEstado === e.id}
              />
            ))}
          </div>

          <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
            {EQUIPOS.map((e) => (
              <Tarjeta
                key={e}
                titulo={ETIQUETA_EQUIPO[e]}
                valor={usd(resumen.porEquipo[e].comisionesUsd + resumen.porEquipo[e].ajustesUsd)}
                sub={`${resumen.porEquipo[e].colaboradores} colaboradores · pagado ${usd(resumen.porEquipo[e].pagadoUsd)}`}
                onClick={() => {
                  setPestana('equipos');
                  setEquipoAbierto(e);
                }}
              />
            ))}
          </div>

          {detalleEstado && (
            <div className="card">
              <div className="card-h">
                <h3>
                  {detalleEstado === 'TODAS' ? 'Todas las comisiones' : ESTADOS.find((x) => x.id === detalleEstado)?.etiqueta}
                  {detalle ? ` · ${detalle.total}` : ''}
                </h3>
                <button className="text-xs text-mute hover:text-ink" onClick={() => setDetalleEstado(null)}>
                  Cerrar lista
                </button>
              </div>
              <div className="p-4">
                {!detalle ? (
                  <div className="pulse-soft h-32" />
                ) : (
                  <>
                    <TablaComisiones filas={detalle.items} onDescripcion={setDescripcionId} />
                    {detalle.total > detalle.pageSize && (
                      <div className="flex items-center justify-end gap-2 mt-3 text-sm">
                        <button className="btn-ghost" disabled={paginaDetalle <= 1} onClick={() => setPaginaDetalle((p) => p - 1)}>
                          Anterior
                        </button>
                        <span className="text-mute">
                          {paginaDetalle} de {Math.ceil(detalle.total / detalle.pageSize)}
                        </span>
                        <button
                          className="btn-ghost"
                          disabled={paginaDetalle >= Math.ceil(detalle.total / detalle.pageSize)}
                          onClick={() => setPaginaDetalle((p) => p + 1)}
                        >
                          Siguiente
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card lg:col-span-2">
              <div className="card-h">
                <h3>Comisiones por mes</h3>
              </div>
              <div className="p-4">
                <GraficaBarras datos={resumen.porMes} />
              </div>
            </div>
            <div className="card">
              <div className="card-h">
                <h3>Por equipo</h3>
              </div>
              <div className="p-4">
                <BarrasPorEquipo
                  equipos={EQUIPOS.map((e) => ({
                    etiqueta: ETIQUETA_EQUIPO[e],
                    comisionesUsd: resumen.porEquipo[e].comisionesUsd + resumen.porEquipo[e].ajustesUsd,
                    pagadoUsd: resumen.porEquipo[e].pagadoUsd,
                  }))}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {resumen && pestana === 'colaboradores' && (
        <div className="space-y-2">
          {resumen.colaboradores.length === 0 && <div className="card card-pad text-sm text-mute">Nadie comisionó en este período.</div>}
          {resumen.colaboradores.map((c) => {
            const k = c.codeId ?? '—';
            const filas = filasColab[k];
            return (
              <div key={k} className="card">
                <button
                  className="w-full text-left px-4 py-3 flex flex-wrap items-center justify-between gap-2"
                  onClick={() => c.codeId && abrirColaborador(c.codeId)}
                  disabled={!c.codeId}
                >
                  <span className="min-w-0">
                    <span className="font-semibold text-ink">{c.nombre}</span>
                    <span className="text-mute text-sm">
                      {' '}
                      — {c.rolEtiqueta} / {c.equipoDeVenta ?? c.equipoEtiqueta}
                    </span>
                  </span>
                  <span className="text-sm text-mute whitespace-nowrap">
                    {usd(c.totales.comisionesUsd + c.totales.ajustesUsd)} · {abierto === c.codeId ? '▲' : '▼'}
                  </span>
                </button>
                {abierto === c.codeId && (
                  <div className="border-t border-line2 p-4 space-y-3">
                    <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 text-sm">
                      <Mini k="Ventas" v={String(c.totales.ventas)} />
                      <Mini k="Monto vendido" v={usd(c.totales.vendidoUsd)} />
                      <Mini k="Comisiones generadas" v={usd(c.totales.comisionesUsd + c.totales.ajustesUsd)} />
                      <Mini k="Pagadas" v={usd(c.totales.porEstado.PAGADA.montoUsd)} />
                      <Mini
                        k="Pendientes"
                        v={usd(
                          c.totales.porEstado.GENERADA.montoUsd + c.totales.porEstado.APROBADA.montoUsd + c.totales.porEstado.PENDIENTE_PAGO.montoUsd,
                        )}
                      />
                      <Mini k="En revisión" v={usd(c.totales.porEstado.EN_REVISION.montoUsd)} />
                    </div>
                    {filas === 'cargando' || !filas ? (
                      <div className="pulse-soft h-24" />
                    ) : (
                      <TablaComisiones filas={filas} onDescripcion={setDescripcionId} mostrarColaborador={false} />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {resumen && pestana === 'equipos' && (
        <div className="space-y-3">
          {EQUIPOS.map((e) => {
            const t = resumen.porEquipo[e];
            const miembros = resumen.colaboradores.filter((c) => c.equipo === e);
            return (
              <div key={e} className="card">
                <button className="w-full text-left px-4 py-3 flex flex-wrap items-center justify-between gap-2" onClick={() => setEquipoAbierto(equipoAbierto === e ? null : e)}>
                  <span className="font-semibold text-ink">{ETIQUETA_EQUIPO[e]}</span>
                  <span className="text-sm text-mute">
                    {miembros.length} colaboradores · {equipoAbierto === e ? '▲' : '▼'}
                  </span>
                </button>
                {equipoAbierto === e && (
                  <div className="border-t border-line2 p-4 space-y-3">
                    <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 text-sm">
                      <Mini k="Total vendido" v={usd(t.vendidoUsd)} />
                      <Mini k="Comisionado" v={usd(t.comisionesUsd + t.ajustesUsd)} />
                      <Mini k="Pagado" v={usd(t.pagadoUsd)} />
                      <Mini k="Pendiente" v={usd(t.saldoUsd)} />
                    </div>
                    {e === 'CLOSERS' && <p className="text-[11px] text-mute">Lo vendido cuenta cada venta una sola vez aunque la compartan varios del equipo.</p>}
                    <div className="overflow-x-auto rounded-lg border border-line2">
                      <table className="min-w-[640px] w-full text-sm">
                        <thead className="bg-bg2 text-[11px] uppercase tracking-wide text-mute">
                          <tr>
                            <th className="text-left px-3 py-2">Colaborador</th>
                            <th className="text-right px-3 py-2">Vendido</th>
                            <th className="text-right px-3 py-2">Comisionado</th>
                            <th className="text-right px-3 py-2">Pagado</th>
                            <th className="text-right px-3 py-2">Pendiente</th>
                          </tr>
                        </thead>
                        <tbody>
                          {miembros.map((c) => (
                            <tr key={c.codeId ?? '—'} className="border-t border-line2">
                              <td className="px-3 py-2">
                                {c.nombre} <span className="text-mute text-xs">· {c.rolEtiqueta}</span>
                              </td>
                              <td className="px-3 py-2 text-right">{usd(c.totales.vendidoUsd)}</td>
                              <td className="px-3 py-2 text-right">{usd(c.totales.comisionesUsd + c.totales.ajustesUsd)}</td>
                              <td className="px-3 py-2 text-right">{usd(c.totales.pagadoUsd)}</td>
                              <td className="px-3 py-2 text-right font-semibold">{usd(c.totales.saldoUsd)}</td>
                            </tr>
                          ))}
                          {miembros.length === 0 && (
                            <tr>
                              <td colSpan={5} className="px-3 py-4 text-center text-mute">
                                Sin movimiento en el período.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    {e === 'SOCIOS' && resumen.socioContabilidad && <SocioDeContabilidad s={resumen.socioContabilidad} />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {resumen && g && pestana === 'cierre' && (
        <div id="zona-impresion" className="card">
          <div className="card-h">
            <div>
              <h3>Cierre de comisiones</h3>
              <p className="text-xs text-mute mt-0.5">
                {filtros.desde || 'Desde el inicio'} a {filtros.hasta || 'hoy'} · hora de Bogotá
              </p>
            </div>
            <div className="flex flex-wrap gap-2 no-print">
              <button className="btn-ghost" onClick={() => descargarXlsx(nombreArchivo('cierre-comisiones', 'xlsx'), [{ nombre: 'Cierre', filas: filasDeCierre(resumen.colaboradores, g) }])}>
                Exportar Excel
              </button>
              <button className="btn-ghost" onClick={() => descargarCsv(nombreArchivo('cierre-comisiones', 'csv'), filasDeCierre(resumen.colaboradores, g))}>
                Exportar CSV
              </button>
              <button
                className="btn-ghost"
                onClick={() => {
                  toast('En la ventana de impresión elige «Guardar como PDF».', 'info');
                  window.print();
                }}
              >
                Descargar PDF
              </button>
              <button className="btn-ghost" onClick={() => window.print()}>
                Imprimir
              </button>
              <button className="btn-primary" onClick={reporteGeneral} disabled={exportando}>
                {exportando ? 'Armando…' : 'Reporte general del período'}
              </button>
            </div>
          </div>
          <div className="p-4">
            <div
              className={`mb-3 rounded-lg px-3 py-2 text-xs ${resumen.cuadre.ok ? 'bg-ok-soft text-ok-ink' : 'bg-bad-soft text-bad-ink'}`}
            >
              {resumen.cuadre.ok
                ? `Cuadra: el total general (${usd(g.comisionesUsd + g.ajustesUsd)}) es la suma de los colaboradores.`
                : `No cuadra: la suma de los colaboradores da ${usd(resumen.cuadre.sumaDeIndividuales.comisionesUsd)} y el total ${usd(g.comisionesUsd)}. Avisa al equipo técnico.`}
            </div>
            <div className="overflow-x-auto rounded-lg border border-line2">
              <table className="min-w-[1000px] w-full text-sm">
                <thead className="bg-bg2 text-[11px] uppercase tracking-wide text-mute">
                  <tr>
                    <th className="text-left px-3 py-2">Colaborador</th>
                    <th className="text-left px-3 py-2">Equipo</th>
                    <th className="text-right px-3 py-2">Ventas</th>
                    <th className="text-right px-3 py-2">Comisiones</th>
                    <th className="text-right px-3 py-2">Ajustes</th>
                    <th className="text-right px-3 py-2">Pagado</th>
                    <th className="text-right px-3 py-2">Saldo</th>
                    <th className="text-left px-3 py-2">Liquidación</th>
                    <th className="px-3 py-2 no-print" />
                  </tr>
                </thead>
                <tbody>
                  {resumen.colaboradores.map((c) => (
                    <tr key={c.codeId ?? '—'} className="border-t border-line2 align-top">
                      <td className="px-3 py-2">
                        <div className="font-medium">{c.nombre}</div>
                        <div className="text-[11px] text-mute">{c.rolEtiqueta}</div>
                      </td>
                      <td className="px-3 py-2">{c.equipoDeVenta ?? c.equipoEtiqueta}</td>
                      <td className="px-3 py-2 text-right">{c.totales.ventas}</td>
                      <td className="px-3 py-2 text-right">{usd(c.totales.comisionesUsd)}</td>
                      <td className="px-3 py-2 text-right">{usd(c.totales.ajustesUsd)}</td>
                      <td className="px-3 py-2 text-right">{usd(c.totales.pagadoUsd)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{usd(c.totales.saldoUsd)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{c.totales.liquidacionEtiqueta}</td>
                      <td className="px-3 py-2 text-right no-print">
                        <div className="flex flex-col items-end gap-1">
                          {c.codeId && (
                            <button className="btn-link text-xs whitespace-nowrap" onClick={() => setVerColab(c)}>
                              Ver detalle
                            </button>
                          )}
                          {c.codeId &&
                            c.cortesAbiertos.map((k) => (
                              <button key={k.batchId} className="btn-link text-xs whitespace-nowrap" onClick={() => setPago({ c, corte: k })}>
                                Registrar pago ({k.code})
                              </button>
                            ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line bg-bg2 font-semibold">
                    <td className="px-3 py-2" colSpan={2}>
                      Total general
                    </td>
                    <td className="px-3 py-2 text-right">{g.ventas}</td>
                    <td className="px-3 py-2 text-right">{usd(g.comisionesUsd)}</td>
                    <td className="px-3 py-2 text-right">{usd(g.ajustesUsd)}</td>
                    <td className="px-3 py-2 text-right">{usd(g.pagadoUsd)}</td>
                    <td className="px-3 py-2 text-right">{usd(g.saldoUsd)}</td>
                    <td className="px-3 py-2" colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-[11px] text-mute mt-2 no-print">
              Aprobar o retener se hace en «Ver detalle» → «Ver descripción» de cada comisión. Cerrar el corte completo (confirmar que salió la
              transferencia) sigue en <Link href="/admin/commissions" className="btn-link">Comisiones → Corte actual</Link>.
            </p>
          </div>
        </div>
      )}

      {pestana === 'liquidaciones' && <Liquidaciones />}

      {verColab && (
        <ColaboradorModal
          c={verColab}
          query={query}
          onCerrar={() => setVerColab(null)}
          onDescripcion={(id) => setDescripcionId(id)}
        />
      )}
      {pago && (
        <PagoPersona
          nombre={pago.c.nombre}
          codeId={pago.c.codeId!}
          corte={pago.corte}
          onCerrar={() => setPago(null)}
          onListo={() => {
            setPago(null);
            cargar();
          }}
        />
      )}
      {descripcionId && <Descripcion id={descripcionId} onCerrar={() => setDescripcionId(null)} onCambio={cargar} />}
      {nueva && (
        <NuevaComision
          colaboradores={colaboradores}
          onCerrar={() => setNueva(false)}
          onCreada={(id) => {
            setNueva(false);
            cargar();
            setDescripcionId(id);
          }}
        />
      )}
    </div>
  );
}

function Mini({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-bg2 px-3 py-2 min-w-0">
      <div className="text-[11px] text-mute">{k}</div>
      <div className="font-semibold text-ink break-words">{v}</div>
    </div>
  );
}

/**
 * La línea «Socio» de Contabilidad, aparte de la tabla y con borde punteado a
 * propósito: no es una comisión del corte y no entra en ningún total de esta
 * página. Se paga desde Contabilidad; sumarla aquí pagaría dos veces.
 */
function SocioDeContabilidad({ s }: { s: SocioContabilidad }) {
  return (
    <div className="rounded-lg border border-dashed border-line2 p-3 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold text-ink">
          {s.nombre} <span className="text-mute text-xs font-normal">· informativo</span>
        </span>
        <span className="font-semibold text-ink">{usd(s.montoUsd)}</span>
      </div>
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-3 text-sm">
        <Mini k="Porcentaje aplicado" v={`${s.porcentaje} %`} />
        <Mini k="Base" v={usd(s.baseUsd)} />
        <Mini k="Sobre qué se calcula" v={s.baseEtiqueta} />
      </div>
      <p className="text-[11px] text-mute">
        {s.nota} No se suma al comisionado, al pendiente ni al cierre. Sale de todas las ventas de Clubify del
        período, sin los demás filtros.
      </p>
    </div>
  );
}

function ColaboradorModal({
  c,
  query,
  onCerrar,
  onDescripcion,
}: {
  c: ColaboradorResumen;
  query: string;
  onCerrar: () => void;
  onDescripcion: (id: string) => void;
}) {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  useEffect(() => {
    api<{ filas: Fila[] }>(`/admin/reporte-comisiones/colaboradores/${c.codeId}${query}`)
      .then((r) => setFilas(r.filas))
      .catch((e) => toast(e?.message ?? 'No se pudo cargar', 'error'));
  }, [c.codeId, query]);
  return (
    <Modal titulo={c.nombre} subtitulo={`${c.rolEtiqueta} / ${c.equipoDeVenta ?? c.equipoEtiqueta} · saldo ${usd(c.totales.saldoUsd)}`} onCerrar={onCerrar} ancho="max-w-6xl">
      {!filas ? <div className="pulse-soft h-40" /> : <TablaComisiones filas={filas} onDescripcion={onDescripcion} mostrarColaborador={false} />}
    </Modal>
  );
}
