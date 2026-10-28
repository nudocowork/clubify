'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { FileUploader } from '@/components/FileUploader';
import { badgeDeEstado, fecha, fechaHora, usd, type Estado } from './lib';
import { CampoMotivo, Modal } from './Modal';

type Detalle = {
  id: string;
  descripcion: string;
  fecha: string;
  disponibleEl: string | null;
  pagadaEl: string | null;
  montoUsd: number;
  pagadoUsd: number;
  baseUsd: number | null;
  porcentaje: number | null;
  estado: Estado | null;
  estadoEtiqueta: string;
  colaborador: { codeId: string; nombre: string; rol: string | null } | null;
  negocio: { id: string | null; nombre: string; esGrupo: boolean } | null;
  cliente: { nombre: string; correo: string } | null;
  estadoCliente: string;
  proximaRenovacion: string | null;
  transaccion: string | null;
  corte: { code: string; status: string; paymentDate: string | null; reference: string | null } | null;
  observaciones: string | null;
  venta: { id: string; fecha: string; valorUsd: number; pasarela: string; estado: string; esPrimerPago: boolean } | null;
  participantes: Array<{ id: string; nombre: string; rol: string | null; montoUsd: number; porcentaje: number | null; estadoEtiqueta: string }>;
  notas: Array<{
    id: string;
    texto: string;
    adjuntoUrl: string | null;
    adjuntoMime: string | null;
    autor: string | null;
    fecha: string;
    anulada: { fecha: string; motivo: string | null } | null;
  }>;
  comprobantes: Array<{ origen: string; url: string; mime: string | null; fecha: string | null }>;
  pagosManuales: Array<{ id: string; fecha: string; metodo: string; valor: number | null; moneda: string | null; referencia: string | null; nota: string | null; registradoPor: string | null }>;
  devoluciones: Array<{ id: string; fecha: string; valorUsd: number; estado: string; pasarela: string; nota: string | null }>;
  ajustes: Array<{ id: string; tipo: string; baseUsd: number; porcentaje: number | null; montoFijoUsd: number | null; descripcion: string; esEsta: boolean }>;
  historial: Array<{ id: string; fecha: string; accion: string; motivo: string | null; antes: unknown; despues: unknown; usuario: string | null; origen: string }>;
  avisos: string[];
};

const ACCION_ETIQUETA: Record<string, string> = {
  APROBAR: 'Aprobada',
  ENVIAR_A_REVISION: 'Enviada a revisión',
  RETENER: 'Retenida',
  REVERSAR: 'Reversada',
  CREAR_MANUAL: 'Creada a mano',
  CREAR_EN_REVISION: 'Creada a mano, en revisión',
  NOTA_AGREGADA: 'Nota agregada',
  NOTA_ANULADA: 'Nota anulada',
  PAGO_PERSONA: 'Pago registrado',
  'commission.manually_enabled': 'Habilitada a mano',
};

type AccionId = 'APROBAR' | 'ENVIAR_A_REVISION' | 'RETENER' | 'REVERSAR';
const ACCIONES: Array<{ id: AccionId; etiqueta: string; clase: string; para: Array<Estado> }> = [
  { id: 'APROBAR', etiqueta: 'Aprobar', clase: 'btn-primary', para: ['GENERADA', 'EN_REVISION', 'RETENIDA'] },
  { id: 'ENVIAR_A_REVISION', etiqueta: 'Enviar a revisión', clase: 'btn-ghost', para: ['GENERADA', 'APROBADA', 'PENDIENTE_PAGO', 'RETENIDA'] },
  { id: 'RETENER', etiqueta: 'Retener', clase: 'btn-ghost', para: ['GENERADA', 'APROBADA', 'PENDIENTE_PAGO', 'EN_REVISION'] },
  { id: 'REVERSAR', etiqueta: 'Reversar', clase: 'btn-danger', para: ['GENERADA', 'APROBADA', 'PENDIENTE_PAGO', 'EN_REVISION', 'RETENIDA'] },
];

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-mute mb-2">{titulo}</h4>
      {children}
    </section>
  );
}

function Dato({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-mute">{k}</div>
      <div className="text-sm text-ink break-words">{v ?? '—'}</div>
    </div>
  );
}

/** «Ver descripción» de una comisión: todo lo que explica de dónde sale y qué le pasó. */
export function Descripcion({ id, onCerrar, onCambio }: { id: string; onCerrar: () => void; onCambio: () => void }) {
  const [d, setD] = useState<Detalle | null>(null);
  const [cargando, setCargando] = useState(true);
  const [accion, setAccion] = useState<AccionId | null>(null);
  const [motivo, setMotivo] = useState('');
  const [cascada, setCascada] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [nota, setNota] = useState('');
  const [adjunto, setAdjunto] = useState<string | null>(null);
  const [adjuntoMime, setAdjuntoMime] = useState<string | null>(null);
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivoAnular, setMotivoAnular] = useState('');

  const cargar = useCallback(() => {
    setCargando(true);
    api<Detalle>(`/admin/reporte-comisiones/comision/${id}`)
      .then(setD)
      .catch((e) => toast(e?.message ?? 'No se pudo cargar la comisión', 'error'))
      .finally(() => setCargando(false));
  }, [id]);

  useEffect(() => cargar(), [cargar]);

  async function aplicar() {
    if (!accion) return;
    setGuardando(true);
    try {
      await api(`/admin/reporte-comisiones/comision/${id}/accion`, {
        method: 'POST',
        body: JSON.stringify({ accion, motivo, cascada: accion === 'REVERSAR' ? cascada : undefined }),
      });
      toast('Listo: el cambio quedó en el historial.', 'success');
      setAccion(null);
      setMotivo('');
      cargar();
      onCambio();
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo aplicar el cambio', 'error');
    } finally {
      setGuardando(false);
    }
  }

  async function guardarNota() {
    setGuardando(true);
    try {
      await api(`/admin/reporte-comisiones/comision/${id}/notas`, {
        method: 'POST',
        body: JSON.stringify({ texto: nota, adjuntoUrl: adjunto ?? undefined, adjuntoMime: adjuntoMime ?? undefined }),
      });
      setNota('');
      setAdjunto(null);
      setAdjuntoMime(null);
      toast('Nota guardada.', 'success');
      cargar();
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo guardar la nota', 'error');
    } finally {
      setGuardando(false);
    }
  }

  async function anular(notaId: string) {
    setGuardando(true);
    try {
      await api(`/admin/reporte-comisiones/notas/${notaId}/anular`, {
        method: 'POST',
        body: JSON.stringify({ motivo: motivoAnular }),
      });
      setAnulando(null);
      setMotivoAnular('');
      toast('Nota anulada. Sigue visible en el historial.', 'success');
      cargar();
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo anular', 'error');
    } finally {
      setGuardando(false);
    }
  }

  const disponibles = d?.estado && d.pagadoUsd <= 0 ? ACCIONES.filter((a) => a.para.includes(d.estado as Estado)) : [];

  return (
    <Modal titulo="Descripción de la comisión" subtitulo={d ? `${d.colaborador?.nombre ?? ''} · ${usd(d.montoUsd)}` : undefined} onCerrar={onCerrar} ancho="max-w-3xl">
      {cargando && !d && <div className="pulse-soft h-40" />}
      {d && (
        <div className="text-sm">
          {d.avisos.length > 0 && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{d.avisos.join(' ')}</div>
          )}
          <p className="text-ink leading-relaxed">{d.descripcion}</p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className={`badge ${badgeDeEstado(d.estado)}`}>{d.estadoEtiqueta}</span>
            {d.corte && <span className="badge badge-mute">{d.corte.code}{d.corte.status === 'CLOSED' ? ' · cerrado' : ' · abierto'}</span>}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
            <Dato k="Fecha del cobro" v={fecha(d.fecha)} />
            <Dato k="Disponible desde" v={fecha(d.disponibleEl)} />
            <Dato k="Pagada el" v={fecha(d.pagadaEl)} />
            <Dato k="Base de la venta" v={usd(d.baseUsd)} />
            <Dato k="% aplicado" v={d.porcentaje != null ? `${d.porcentaje}%` : 'Monto fijo'} />
            <Dato k="Comisión / pagado" v={`${usd(d.montoUsd)} / ${usd(d.pagadoUsd)}`} />
            <Dato k="Negocio" v={d.negocio?.nombre} />
            <Dato k="Cliente (dueño)" v={d.cliente ? `${d.cliente.nombre}` : null} />
            <Dato k="Pago del cliente" v={d.estadoCliente} />
            <Dato k="Próxima renovación" v={fecha(d.proximaRenovacion)} />
            <Dato k="Transacción" v={d.transaccion} />
            <Dato k="Venta en Contabilidad" v={d.venta ? `${fecha(d.venta.fecha)} · ${usd(d.venta.valorUsd)} · ${d.venta.pasarela}` : null} />
          </div>

          {disponibles.length > 0 && (
            <Seccion titulo="Cambiar estado">
              {!accion ? (
                <div className="flex flex-wrap gap-2">
                  {disponibles.map((a) => (
                    <button key={a.id} className={a.clase} onClick={() => setAccion(a.id)}>
                      {a.etiqueta}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-line2 p-3 space-y-3">
                  <div className="font-medium">{ACCIONES.find((a) => a.id === accion)?.etiqueta} esta comisión</div>
                  {accion === 'REVERSAR' && (
                    <label className="flex items-start gap-2 text-xs text-ink">
                      <input type="checkbox" checked={cascada} onChange={(e) => setCascada(e.target.checked)} className="mt-0.5" />
                      Reversar también las demás comisiones de esta misma venta (la venta se cayó). Las ya pagadas no se tocan.
                    </label>
                  )}
                  <CampoMotivo value={motivo} onChange={setMotivo} />
                  <div className="flex gap-2 justify-end">
                    <button className="btn-ghost" onClick={() => setAccion(null)} disabled={guardando}>
                      Cancelar
                    </button>
                    <button className="btn-primary" onClick={aplicar} disabled={guardando || motivo.trim().length < 5}>
                      {guardando ? 'Guardando…' : 'Confirmar'}
                    </button>
                  </div>
                </div>
              )}
            </Seccion>
          )}

          <Seccion titulo={`Participantes de esta venta (${d.participantes.length + 1})`}>
            {d.participantes.length === 0 ? (
              <p className="text-xs text-mute">Solo esta comisión sale de esta venta.</p>
            ) : (
              <ul className="divide-y divide-line2 rounded-lg border border-line2">
                {d.participantes.map((p) => (
                  <li key={p.id} className="px-3 py-2 flex flex-wrap justify-between gap-2">
                    <span>
                      <span className="font-medium">{p.nombre}</span>
                      {p.rol && <span className="text-mute"> · {p.rol}</span>}
                    </span>
                    <span className="text-mute">
                      {p.porcentaje != null ? `${p.porcentaje}% · ` : ''}
                      {usd(p.montoUsd)} · {p.estadoEtiqueta}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Seccion>

          <Seccion titulo="Observaciones">
            <p className="text-sm text-ink whitespace-pre-wrap">{d.observaciones || <span className="text-mute">Sin observaciones del sistema.</span>}</p>
          </Seccion>

          <Seccion titulo="Notas y comprobantes">
            {d.notas.length === 0 && <p className="text-xs text-mute mb-2">Todavía no hay notas.</p>}
            <ul className="space-y-2 mb-3">
              {d.notas.map((n) => (
                <li key={n.id} className={`rounded-lg border px-3 py-2 ${n.anulada ? 'border-line2 bg-bg2 opacity-70' : 'border-line2'}`}>
                  <div className={`whitespace-pre-wrap ${n.anulada ? 'line-through' : ''}`}>{n.texto}</div>
                  {n.adjuntoUrl && (
                    <a href={n.adjuntoUrl} target="_blank" rel="noreferrer" className="btn-link text-xs">
                      Ver comprobante
                    </a>
                  )}
                  <div className="text-[11px] text-mute mt-1">
                    {n.autor ?? '—'} · {fechaHora(n.fecha)}
                    {n.anulada && ` · anulada el ${fechaHora(n.anulada.fecha)}: ${n.anulada.motivo ?? ''}`}
                  </div>
                  {!n.anulada &&
                    (anulando === n.id ? (
                      <div className="mt-2 space-y-2">
                        <CampoMotivo value={motivoAnular} onChange={setMotivoAnular} />
                        <div className="flex gap-2 justify-end">
                          <button className="btn-ghost" onClick={() => setAnulando(null)}>
                            Cancelar
                          </button>
                          <button className="btn-danger" disabled={guardando || motivoAnular.trim().length < 5} onClick={() => anular(n.id)}>
                            Anular nota
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button className="text-[11px] text-mute hover:text-bad mt-1" onClick={() => setAnulando(n.id)}>
                        Anular
                      </button>
                    ))}
                </li>
              ))}
            </ul>
            <div className="rounded-lg border border-line2 p-3 space-y-2">
              <label className="label">Nueva nota</label>
              <textarea className="input" rows={2} value={nota} maxLength={4000} onChange={(e) => setNota(e.target.value)} placeholder="Qué pasó con esta comisión" />
              <FileUploader
                value={adjunto}
                contentType={adjuntoMime}
                onChange={(u, meta) => {
                  setAdjunto(u);
                  setAdjuntoMime(meta?.contentType ?? null);
                }}
                folder="comprobantes"
                kind="imageOrPdf"
                label="Comprobante (opcional)"
              />
              <div className="flex justify-end">
                <button className="btn-primary" disabled={guardando || nota.trim().length < 3} onClick={guardarNota}>
                  Guardar nota
                </button>
              </div>
            </div>
            {d.comprobantes.filter((c) => c.origen !== 'Nota').length > 0 && (
              <ul className="mt-3 space-y-1 text-xs">
                {d.comprobantes
                  .filter((c) => c.origen !== 'Nota')
                  .map((c) => (
                    <li key={c.url}>
                      <a href={c.url} target="_blank" rel="noreferrer" className="btn-link">
                        {c.origen}
                      </a>
                      {c.fecha && <span className="text-mute"> · {fecha(c.fecha)}</span>}
                    </li>
                  ))}
              </ul>
            )}
          </Seccion>

          <Seccion titulo="Pagos manuales del cliente (cerca de esta fecha)">
            {d.pagosManuales.length === 0 ? (
              <p className="text-xs text-mute">Ninguno.</p>
            ) : (
              <ul className="space-y-1">
                {d.pagosManuales.map((p) => (
                  <li key={p.id} className="text-xs">
                    {fecha(p.fecha)} · {p.metodo} · {p.valor != null ? `${p.valor} ${p.moneda ?? ''}` : 'sin valor'}
                    {p.referencia && ` · ref. ${p.referencia}`}
                    {p.registradoPor && <span className="text-mute"> · registró {p.registradoPor}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Seccion>

          <Seccion titulo="Devoluciones del negocio">
            {d.devoluciones.length === 0 ? (
              <p className="text-xs text-mute">Ninguna.</p>
            ) : (
              <ul className="space-y-1">
                {d.devoluciones.map((r) => (
                  <li key={r.id} className="text-xs">
                    {fecha(r.fecha)} · {usd(r.valorUsd)} · {r.estado === 'REEMBOLSADO' ? 'Reembolsado' : 'Cancelado'} · {r.pasarela}
                  </li>
                ))}
              </ul>
            )}
          </Seccion>

          <Seccion titulo="Ajustes (comisiones manuales del negocio)">
            {d.ajustes.length === 0 ? (
              <p className="text-xs text-mute">Ninguno.</p>
            ) : (
              <ul className="space-y-1">
                {d.ajustes.map((a) => (
                  <li key={a.id} className="text-xs">
                    {a.esEsta && <span className="badge badge-info mr-1">Esta</span>}
                    {a.tipo} · {a.porcentaje != null ? `${a.porcentaje}% sobre ${usd(a.baseUsd)}` : `fijo ${usd(a.montoFijoUsd)}`} · {a.descripcion}
                  </li>
                ))}
              </ul>
            )}
          </Seccion>

          <Seccion titulo="Historial de cambios">
            {d.historial.length === 0 ? (
              <p className="text-xs text-mute">Sin cambios registrados.</p>
            ) : (
              <ol className="space-y-2">
                {d.historial.map((h) => (
                  <li key={h.id} className="rounded-lg border border-line2 px-3 py-2">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-medium">{ACCION_ETIQUETA[h.accion] ?? h.accion}</span>
                      <span className="text-[11px] text-mute">
                        {fechaHora(h.fecha)} · {h.usuario ?? '—'}
                      </span>
                    </div>
                    {h.motivo && <div className="text-xs text-ink mt-1">Motivo: {h.motivo}</div>}
                    {(h.antes != null || h.despues != null) && (
                      <details className="mt-1">
                        <summary className="text-[11px] text-mute cursor-pointer">Antes / después</summary>
                        <pre className="text-[11px] bg-bg2 rounded p-2 overflow-x-auto mt-1">
                          {JSON.stringify({ antes: h.antes, despues: h.despues }, null, 2)}
                        </pre>
                      </details>
                    )}
                    <div className="text-[10px] text-mute2 mt-1">{h.origen}</div>
                  </li>
                ))}
              </ol>
            )}
          </Seccion>
        </div>
      )}
    </Modal>
  );
}
