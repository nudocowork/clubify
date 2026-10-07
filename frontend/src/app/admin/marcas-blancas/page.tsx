'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

/**
 * «Marcas blancas»: lo que cada marca blanca le paga a la plataforma y cuál
 * ingresa más. Lee y escribe en el mismo libro que Contabilidad.
 *
 * Solo dos cosas son ingreso de Clubify (Sara, 2026-10-06): la compra de la
 * marca blanca —que puede ir en cuotas, y por eso cada marca tiene su venta
 * configurable— y los créditos. Los servicios (automatización de WhatsApp)
 * pasan por Clubify pero son de otro: se guardan y se ven aparte, sin sumar.
 */

type Concepto = 'REBRANDING' | 'CREDITOS' | 'SERVICIO' | 'OTRO';
type Marca = {
  whiteLabelId: string;
  nombre: string;
  logoUrl: string | null;
  totalUsd: number;
  porConcepto: Record<Concepto, number>;
  pagos: number;
  ultimoPago: string | null;
  participacion: number;
  creditosComprados: number;
  serviciosUsd: number;
  venta: Venta | null;
};
type Frecuencia = 'MENSUAL' | 'QUINCENAL' | 'SEMANAL';
type EstadoVenta = 'ACTIVA' | 'PAUSADA' | 'PAGADA' | 'CANCELADA';
type Venta = {
  totalUsd: number | null;
  cuotas: number;
  frecuencia: Frecuencia;
  primeraCuota: string | null;
  estado: EstadoVenta;
  nota: string | null;
  pagadoUsd: number;
  faltaUsd: number | null;
  montoCuotaUsd: number | null;
  cuotasPagadas: number;
  proximaCuota: string | null;
  vencida: boolean;
};
type Resumen = { periodo: string; totalUsd: number; serviciosUsd: number; marcas: Marca[] };
type Movimiento = {
  id: string;
  externalTxId: string;
  gateway: string;
  productName: string | null;
  grossUsd: number;
  saleDate: string;
  status: string;
  note: string | null;
  concepto: Concepto;
  creditos: number | null;
};

const CONCEPTO: Record<Concepto, { label: string; color: string }> = {
  REBRANDING: { label: 'Compra marca blanca', color: 'bg-brand' },
  CREDITOS: { label: 'Créditos', color: 'bg-sky-500' },
  SERVICIO: { label: 'Servicio adicional', color: 'bg-amber-500' },
  OTRO: { label: 'Otros', color: 'bg-slate-400' },
};
/** Lo que es ingreso de Clubify, en el orden de la barra. */
const ORDEN: Concepto[] = ['REBRANDING', 'CREDITOS', 'OTRO'];
/** Lo que se puede registrar (el servicio se guarda, pero no suma). */
const REGISTRABLES: Concepto[] = ['REBRANDING', 'CREDITOS', 'SERVICIO', 'OTRO'];
const FRECUENCIA: Record<Frecuencia, string> = { MENSUAL: 'Mensual', QUINCENAL: 'Quincenal', SEMANAL: 'Semanal' };
const ESTADO_VENTA: Record<EstadoVenta, { label: string; cls: string }> = {
  ACTIVA: { label: 'En curso', cls: 'bg-emerald-100 text-emerald-700' },
  PAUSADA: { label: 'Pausada', cls: 'bg-amber-100 text-amber-800' },
  PAGADA: { label: 'Pagada', cls: 'bg-sky-100 text-sky-700' },
  CANCELADA: { label: 'Cancelada', cls: 'bg-slate-200 text-slate-600' },
};

const usd = (n: number) =>
  `US$ ${new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
const fecha = (d: string) =>
  new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Bogota' });

/** Una línea con cómo va la venta: lo que pagó, lo que falta y la próxima cuota. */
function lineaDeVenta(v: Venta | null): string {
  if (!v) return 'Venta sin configurar';
  const partes = [
    v.totalUsd != null ? `Compra: ${usd(v.pagadoUsd)} de ${usd(v.totalUsd)}` : `Compra: ${usd(v.pagadoUsd)} pagado, valor por definir`,
  ];
  if (v.totalUsd != null && v.cuotas > 1) partes.push(`${v.cuotasPagadas}/${v.cuotas} cuotas`);
  if (v.estado !== 'ACTIVA') partes.push(ESTADO_VENTA[v.estado].label.toLowerCase());
  else if (v.proximaCuota) partes.push(`${v.vencida ? 'cuota vencida' : 'próxima cuota'} ${fecha(v.proximaCuota)}`);
  return partes.join(' · ');
}

/** Todo, los últimos trimestres y los últimos seis meses, en hora de Bogotá. */
function periodos() {
  const hoy = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date()));
  const out: Array<{ v: string; label: string }> = [{ v: 'todo', label: 'Todo' }];
  const y = hoy.getUTCFullYear();
  const q = Math.floor(hoy.getUTCMonth() / 3) + 1;
  for (let i = 0; i < 3; i++) {
    const qq = ((q - 1 - i + 12) % 4) + 1;
    const yy = q - i <= 0 ? y - 1 : y;
    out.push({ v: `${yy}-T${qq}`, label: `${['1er', '2º', '3er', '4º'][qq - 1]} trimestre ${yy}` });
  }
  for (let i = 0; i < 6; i++) {
    const d = new Date(Date.UTC(y, hoy.getUTCMonth() - i, 1));
    const v = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    out.push({ v, label: label.charAt(0).toUpperCase() + label.slice(1) });
  }
  return out;
}

export default function MarcasBlancas() {
  const opciones = useMemo(periodos, []);
  const [periodo, setPeriodo] = useState('todo');
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [registrando, setRegistrando] = useState(false);

  const cargar = useCallback(async () => {
    setResumen(null);
    setResumen(await api<Resumen>(`/admin/marcas-blancas/ingresos?periodo=${periodo}`).catch(() => ({ periodo, totalUsd: 0, serviciosUsd: 0, marcas: [] })));
  }, [periodo]);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  const maximo = Math.max(1, ...(resumen?.marcas.map((m) => m.totalUsd) ?? [1]));
  const conPagos = resumen?.marcas.filter((m) => m.totalUsd > 0).length ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink">Marcas blancas</h1>
          <p className="text-sm text-mute mt-1 max-w-2xl">
            Lo que cada marca blanca le paga a Clubify: la compra de la marca blanca (en cuotas si se pactó así) y los
            créditos con los que activa sus negocios. Los servicios adicionales se registran aparte y no suman a los
            ingresos.
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <select className="input h-9 text-sm w-auto" value={periodo} onChange={(e) => setPeriodo(e.target.value)} aria-label="Período">
            {opciones.map((o) => (
              <option key={o.v} value={o.v}>{o.label}</option>
            ))}
          </select>
          <button type="button" className="btn-primary" onClick={() => setRegistrando(true)}>
            Registrar pago
          </button>
        </div>
      </div>

      {resumen === null ? (
        <div className="card card-pad text-mute text-sm">Cargando…</div>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <Cifra titulo="Ingresado por marcas blancas" valor={usd(resumen.totalUsd)} />
            <Cifra titulo="Marcas que pagaron" valor={`${conPagos} de ${resumen.marcas.length}`} />
            <Cifra
              titulo="La que más ingresa"
              valor={resumen.marcas[0]?.totalUsd ? resumen.marcas[0].nombre : '—'}
              nota={resumen.marcas[0]?.totalUsd ? `${resumen.marcas[0].participacion}% del total` : undefined}
            />
            <Cifra
              titulo="Servicios adicionales (automatizaciones)"
              valor={usd(resumen.serviciosUsd ?? 0)}
              nota="Pasan por Clubify, no suman a sus ingresos"
            />
          </div>

          <div className="card p-0 overflow-hidden">
            <div className="px-5 py-3 border-b border-line flex items-center justify-between gap-3 flex-wrap">
              <div className="font-semibold text-ink">Comparación</div>
              <div className="flex gap-3 flex-wrap text-[11px] text-mute">
                {ORDEN.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1.5">
                    <span className={`w-2.5 h-2.5 rounded-sm ${CONCEPTO[c].color}`} /> {CONCEPTO[c].label}
                  </span>
                ))}
              </div>
            </div>
            {resumen.marcas.length === 0 ? (
              <div className="p-6 text-center text-sm text-mute">Aún no hay marcas blancas.</div>
            ) : (
              <ul className="divide-y divide-line2">
                {resumen.marcas.map((m, i) => (
                  <li key={m.whiteLabelId}>
                    <button
                      type="button"
                      onClick={() => setAbierta(abierta === m.whiteLabelId ? null : m.whiteLabelId)}
                      className="w-full text-left px-4 sm:px-5 py-4 hover:bg-bg2/40 transition grid grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,1fr)_auto] gap-x-4 gap-y-2 items-center"
                      aria-expanded={abierta === m.whiteLabelId}
                    >
                      <span className="w-6 text-sm font-bold text-mute tabular-nums">{i + 1}</span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          {m.logoUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.logoUrl} alt="" className="w-6 h-6 rounded object-contain bg-surface border border-line" />
                          )}
                          <span className="font-semibold text-ink truncate">{m.nombre}</span>
                          {m.totalUsd > 0 && <span className="text-xs text-mute">{m.participacion}%</span>}
                        </span>
                        <span className="mt-2 flex h-2.5 rounded-full overflow-hidden bg-bg2" style={{ width: `${Math.max(2, (m.totalUsd / maximo) * 100)}%` }}>
                          {ORDEN.map((c) =>
                            m.porConcepto[c] > 0 ? (
                              <span key={c} className={CONCEPTO[c].color} style={{ width: `${(m.porConcepto[c] / m.totalUsd) * 100}%` }} title={`${CONCEPTO[c].label}: ${usd(m.porConcepto[c])}`} />
                            ) : null,
                          )}
                        </span>
                        <span className="mt-1.5 block text-[11px] text-mute">
                          {m.pagos} pago{m.pagos === 1 ? '' : 's'}
                          {m.creditosComprados > 0 && ` · ${m.creditosComprados} créditos comprados`}
                          {m.ultimoPago && ` · último ${fecha(m.ultimoPago)}`}
                          {m.serviciosUsd > 0 && ` · servicios adicionales ${usd(m.serviciosUsd)} (no suman)`}
                        </span>
                        <span className={`mt-1 block text-[11px] font-medium ${m.venta?.vencida ? 'text-bad' : 'text-ink2'}`}>
                          {lineaDeVenta(m.venta)}
                        </span>
                      </span>
                      <span className="col-start-2 sm:col-start-auto sm:text-right">
                        <span className="block font-bold text-ink tabular-nums">{usd(m.totalUsd)}</span>
                        <span className="block text-[11px] text-mute tabular-nums">
                          {ORDEN.filter((c) => m.porConcepto[c] > 0)
                            .map((c) => `${CONCEPTO[c].label} ${usd(m.porConcepto[c])}`)
                            .join(' · ') || 'sin pagos'}
                        </span>
                      </span>
                    </button>
                    {abierta === m.whiteLabelId && (
                      <>
                        <VentaDeLaMarca whiteLabelId={m.whiteLabelId} venta={m.venta} onGuardada={cargar} />
                        <Movimientos whiteLabelId={m.whiteLabelId} periodo={periodo} onCambio={cargar} />
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {registrando && resumen && (
        <RegistrarPago
          marcas={resumen.marcas}
          onClose={() => setRegistrando(false)}
          onGuardado={() => {
            setRegistrando(false);
            void cargar();
          }}
        />
      )}
    </div>
  );
}

function Cifra({ titulo, valor, nota }: { titulo: string; valor: string; nota?: string }) {
  return (
    <div className="card card-pad">
      <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">{titulo}</div>
      <div className="mt-1 text-xl font-bold text-ink tabular-nums truncate">{valor}</div>
      {nota && <div className="text-xs text-mute">{nota}</div>}
    </div>
  );
}

function Movimientos({ whiteLabelId, periodo, onCambio }: { whiteLabelId: string; periodo: string; onCambio: () => void }) {
  const [filas, setFilas] = useState<Movimiento[] | null>(null);
  const cargar = useCallback(() => {
    api<{ movimientos: Movimiento[] }>(`/admin/marcas-blancas/ingresos/${whiteLabelId}?periodo=${periodo}`)
      .then((r) => setFilas(r.movimientos))
      .catch(() => setFilas([]));
  }, [whiteLabelId, periodo]);
  useEffect(cargar, [cargar]);

  async function anular(m: Movimiento) {
    try {
      await api(`/admin/marcas-blancas/ingresos/${m.id}/anular`, { method: 'POST' });
      toast('Pago anulado: ya no suma', 'success');
      cargar();
      onCambio();
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo anular', 'error');
    }
  }

  if (filas === null) return <div className="px-5 pb-4 text-sm text-mute">Cargando pagos…</div>;
  if (filas.length === 0) return <div className="px-5 pb-4 text-sm text-mute">Sin pagos en este período.</div>;
  return (
    <div className="px-4 sm:px-5 pb-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-[11px] uppercase tracking-wider text-mute">
          <tr>
            {['Fecha', 'Concepto', 'Detalle', 'Pasarela', 'Monto', ''].map((h) => (
              <th key={h} className="py-2 pr-3 font-semibold whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((m) => {
            const intermediado = m.status === 'INTERMEDIADO';
            const anulada = m.status !== 'PAGADO' && !intermediado;
            return (
              <tr key={m.id} className={`border-t border-line2 ${anulada ? 'opacity-50' : ''}`}>
                <td className="py-2 pr-3 whitespace-nowrap">{fecha(m.saleDate)}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{CONCEPTO[m.concepto].label}</td>
                <td className="py-2 pr-3 text-mute">
                  {m.creditos != null ? `${m.creditos} crédito${m.creditos === 1 ? '' : 's'}` : (m.productName ?? '—')}
                  {m.note && <div className="text-[11px]">{m.note}</div>}
                </td>
                <td className="py-2 pr-3 text-mute text-xs whitespace-nowrap">{m.gateway} · {m.externalTxId.startsWith('marca-') ? 'a mano' : m.externalTxId}</td>
                <td className={`py-2 pr-3 text-right tabular-nums font-semibold ${anulada ? 'line-through' : ''}`}>{usd(m.grossUsd)}</td>
                <td className="py-2 text-right">
                  {intermediado && (
                    <span className="block text-[11px] text-amber-700 whitespace-nowrap mb-0.5">No suma a ingresos</span>
                  )}
                  {m.externalTxId.startsWith('marca-') && !anulada && (
                    <button type="button" className="text-xs text-bad font-semibold hover:underline" onClick={() => anular(m)}>
                      Anular
                    </button>
                  )}
                  {anulada && <span className="text-xs text-mute">Anulado</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RegistrarPago({ marcas, onClose, onGuardado }: { marcas: Marca[]; onClose: () => void; onGuardado: () => void }) {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
  const [f, setF] = useState({
    whiteLabelId: '',
    concepto: 'REBRANDING' as Concepto,
    descripcion: '',
    montoUsd: '',
    fecha: hoy,
    metodo: 'TRANSFERENCIA',
    referencia: '',
    nota: '',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const r = await api<{ marca: string; montoUsd: number }>('/admin/marcas-blancas/ingresos', {
        method: 'POST',
        body: JSON.stringify(f),
      });
      toast(`Registrado: ${usd(r.montoUsd)} de ${r.marca}`, 'success');
      onGuardado();
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo registrar');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Registrar pago de una marca blanca"
        className="bg-surface w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-xl p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-lg font-bold text-ink">Registrar pago de una marca blanca</h3>
          <p className="text-sm text-mute">Queda en Contabilidad en la fecha del pago.</p>
        </div>
        <label className="block">
          <span className="label">Marca blanca</span>
          <select className="input w-full" value={f.whiteLabelId} onChange={(e) => set('whiteLabelId', e.target.value)}>
            <option value="">Elige la marca…</option>
            {marcas.map((m) => (
              <option key={m.whiteLabelId} value={m.whiteLabelId}>{m.nombre}</option>
            ))}
          </select>
        </label>
        <div>
          <span className="label">Concepto</span>
          <div className="grid grid-cols-2 gap-2">
            {REGISTRABLES.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={f.concepto === c}
                onClick={() => set('concepto', c)}
                className={`h-10 rounded-xl border text-sm font-semibold transition ${f.concepto === c ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-ink hover:border-brand/60'}`}
              >
                {c === 'OTRO' ? 'Otro' : CONCEPTO[c].label}
              </button>
            ))}
          </div>
          {f.concepto === 'CREDITOS' && (
            <p className="text-xs text-mute mt-1.5">Solo los que NO entraron por Hotmart: esos ya se cuentan solos.</p>
          )}
          {f.concepto === 'REBRANDING' && (
            <p className="text-xs text-mute mt-1.5">
              Una cuota de la compra. El valor total y las cuotas se configuran en la marca, al abrirla en la lista.
            </p>
          )}
          {f.concepto === 'SERVICIO' && (
            <p className="text-xs text-amber-700 mt-1.5">
              Se guarda como servicio adicional: Clubify solo hace de intermediario, así que NO suma a sus ingresos.
            </p>
          )}
        </div>
        {f.concepto === 'SERVICIO' && (
          <label className="block">
            <span className="label">¿Qué servicio?</span>
            <input className="input w-full" value={f.descripcion} onChange={(e) => set('descripcion', e.target.value)} placeholder="Ej.: Automatización de WhatsApp" />
          </label>
        )}
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Monto (USD)</span>
            <input className="input w-full tabular-nums" inputMode="decimal" value={f.montoUsd} onChange={(e) => set('montoUsd', e.target.value)} placeholder="1200" />
          </label>
          <label className="block">
            <span className="label">Fecha del pago</span>
            <input className="input w-full" type="date" max={hoy} value={f.fecha} onChange={(e) => set('fecha', e.target.value)} />
          </label>
        </div>
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Cómo pagó</span>
            <select className="input w-full" value={f.metodo} onChange={(e) => set('metodo', e.target.value)}>
              <option value="TRANSFERENCIA">Transferencia</option>
              <option value="HOTMART">Hotmart</option>
              <option value="STRIPE">Stripe</option>
              <option value="EFECTIVO">Efectivo</option>
              <option value="OTRO">Otro</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Referencia (opcional)</span>
            <input className="input w-full" value={f.referencia} onChange={(e) => set('referencia', e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className="label">Nota (opcional)</span>
          <textarea className="input w-full min-h-[64px]" value={f.nota} onChange={(e) => set('nota', e.target.value)} />
        </label>
        {error && <div role="alert" className="rounded-xl bg-bad-soft text-bad-ink px-4 py-3 text-sm">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button type="button" className="btn-primary" onClick={guardar} disabled={guardando || !f.whiteLabelId || !f.montoUsd}>
            {guardando ? 'Registrando…' : 'Registrar pago'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * La venta de la marca: por cuánto se vendió, en cuántas cuotas y cada cuánto.
 * Lo pagado sale de los pagos «Compra marca blanca» registrados; esto solo
 * guarda el acuerdo. El valor puede quedar vacío mientras se define (Fideliso
 * pagó una parte y se pausó: eso cuenta como ingreso aunque falte el total).
 */
function VentaDeLaMarca({ whiteLabelId, venta, onGuardada }: { whiteLabelId: string; venta: Venta | null; onGuardada: () => void }) {
  const [editando, setEditando] = useState(false);
  const [f, setF] = useState({
    totalUsd: venta?.totalUsd != null ? String(venta.totalUsd) : '',
    cuotas: String(venta?.cuotas ?? 1),
    frecuencia: (venta?.frecuencia ?? 'MENSUAL') as Frecuencia,
    primeraCuota: venta?.primeraCuota ? venta.primeraCuota.slice(0, 10) : '',
    estado: (venta?.estado ?? 'ACTIVA') as EstadoVenta,
    nota: venta?.nota ?? '',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const total = Number(f.totalUsd.replace(',', '.'));
  const cuotas = Math.max(1, Math.floor(Number(f.cuotas) || 1));
  const cuota = total > 0 ? total / cuotas : null;

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await api(`/admin/marcas-blancas/ingresos/${whiteLabelId}/venta`, { method: 'PUT', body: JSON.stringify(f) });
      toast('Venta guardada', 'success');
      setEditando(false);
      onGuardada();
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  }

  if (!editando) {
    return (
      <div className="mx-4 sm:mx-5 mb-3 rounded-xl border border-line bg-bg2/40 px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">Compra de la marca blanca</div>
          {venta ? (
            <div className="text-ink">
              <span className="font-semibold tabular-nums">{usd(venta.pagadoUsd)}</span> pagado
              {venta.totalUsd != null ? (
                <>
                  {' '}de <span className="tabular-nums">{usd(venta.totalUsd)}</span>
                  {venta.faltaUsd != null && venta.faltaUsd > 0 && (
                    <>
                      {' '}· falta <span className="tabular-nums">{usd(venta.faltaUsd)}</span>
                    </>
                  )}
                </>
              ) : (
                ' · valor de venta por definir'
              )}
            </div>
          ) : (
            <div className="text-mute">Aún no se ha configurado por cuánto se vendió ni en cuántas cuotas.</div>
          )}
        </div>
        {venta && (
          <div className="text-xs text-mute space-y-0.5">
            <div>
              {venta.cuotas} cuota{venta.cuotas === 1 ? '' : 's'} · {FRECUENCIA[venta.frecuencia].toLowerCase()}
              {venta.montoCuotaUsd != null && ` · ${usd(venta.montoCuotaUsd)} c/u`}
            </div>
            {venta.proximaCuota && (
              <div className={venta.vencida ? 'text-bad font-semibold' : ''}>
                {venta.vencida ? 'Cuota vencida desde el' : 'Próxima cuota:'} {fecha(venta.proximaCuota)}
              </div>
            )}
          </div>
        )}
        {venta && (
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${ESTADO_VENTA[venta.estado].cls}`}>
            {ESTADO_VENTA[venta.estado].label}
          </span>
        )}
        <button type="button" className="btn-ghost h-8 text-xs ml-auto" onClick={() => setEditando(true)}>
          {venta ? 'Editar venta' : 'Configurar venta'}
        </button>
        {venta?.nota && <div className="basis-full text-xs text-mute">{venta.nota}</div>}
      </div>
    );
  }

  return (
    <div className="mx-4 sm:mx-5 mb-3 rounded-xl border border-brand/40 bg-surface px-4 py-4 space-y-3">
      <div className="text-sm font-semibold text-ink">Venta de la marca blanca</div>
      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-3">
        <label className="block">
          <span className="label">Valor de venta (USD)</span>
          <input
            className="input w-full tabular-nums"
            inputMode="decimal"
            value={f.totalUsd}
            onChange={(e) => set('totalUsd', e.target.value)}
            placeholder="Vacío si aún no se define"
          />
        </label>
        <label className="block">
          <span className="label">Cuotas</span>
          <input className="input w-full tabular-nums" type="number" min={1} max={60} value={f.cuotas} onChange={(e) => set('cuotas', e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Cada cuánto</span>
          <select className="input w-full" value={f.frecuencia} onChange={(e) => set('frecuencia', e.target.value)}>
            {(Object.keys(FRECUENCIA) as Frecuencia[]).map((k) => (
              <option key={k} value={k}>{FRECUENCIA[k]}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Primera cuota</span>
          <input className="input w-full" type="date" value={f.primeraCuota} onChange={(e) => set('primeraCuota', e.target.value)} />
        </label>
      </div>
      <div className="grid grid-cols-1 min-[420px]:grid-cols-[200px_minmax(0,1fr)] gap-3">
        <label className="block">
          <span className="label">Estado</span>
          <select className="input w-full" value={f.estado} onChange={(e) => set('estado', e.target.value)}>
            {(Object.keys(ESTADO_VENTA) as EstadoVenta[]).map((k) => (
              <option key={k} value={k}>{ESTADO_VENTA[k].label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Nota (opcional)</span>
          <input className="input w-full" value={f.nota} onChange={(e) => set('nota', e.target.value)} placeholder="Ej.: pagó una parte y se pausó" />
        </label>
      </div>
      <p className="text-xs text-mute">
        {cuota != null
          ? `${cuotas} cuota${cuotas === 1 ? '' : 's'} de ${usd(cuota)}. `
          : 'Sin valor de venta todavía: lo pagado cuenta igual como ingreso. '}
        Cada cuota se registra con «Registrar pago» → «Compra marca blanca».
      </p>
      {error && <div role="alert" className="rounded-xl bg-bad-soft text-bad-ink px-4 py-3 text-sm">{error}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={() => setEditando(false)} disabled={guardando}>Cancelar</button>
        <button type="button" className="btn-primary" onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar venta'}
        </button>
      </div>
    </div>
  );
}
