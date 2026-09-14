'use client';

/**
 * La rejilla del día de la Agenda: closers en columnas, franjas en filas.
 *
 * La Agenda del equipo tenía el enlace público, el horario y una lista de
 * próximas citas. Para repartir el día hace falta verlo de un vistazo —quién
 * está libre a las 10:00, qué citas siguen sin confirmar—, y eso es la rejilla
 * de TeamClubify. Se añade encima; lo demás se queda.
 *
 * El semáforo lo calcula el SERVIDOR (verde = confirmó o ya se hizo, rojo =
 * canceló o no asistió, gris = sin confirmar), igual que el del Banco: si lo
 * calculara la pantalla, dos personas podrían ver colores distintos.
 *
 * Colores por tokens (ok/bad/bg2): bajo `.brand-panel` la marca pone los suyos.
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type Semaforo = 'verde' | 'rojo' | 'gris';

type Cita = {
  id: string;
  hostUserId: string | null;
  startAt: string;
  hora: string;
  franja: string;
  durationMin: number;
  status: string;
  semaforo: Semaforo;
  lead: { id: string; nombre: string | null; empresa: string | null } | null;
};

type Dia = {
  fecha: string;
  zona: string;
  puedeEscribir: boolean;
  /** Los closers activos y, con `activo: false`, quien tiene cita ese día sin serlo. */
  closers: { id: string; nombre: string; activo?: boolean }[];
  franjas: string[];
  citas: Cita[];
};

const PUNTO: Record<Semaforo, string> = { verde: '🟢', rojo: '🔴', gris: '⚪' };
const CELDA: Record<Semaforo, string> = {
  verde: 'bg-ok-soft text-ok-ink',
  rojo: 'bg-bad-soft text-bad-ink',
  gris: 'bg-bg2 text-ink hover:bg-line2',
};

const ESTADOS = [
  { valor: 'PENDIENTE', label: 'Pendiente' },
  { valor: 'CONFIRMADA', label: 'Confirmada' },
  { valor: 'REALIZADA', label: 'Realizada' },
  { valor: 'NO_ASISTIO', label: 'No asistió' },
  { valor: 'CANCELADA', label: 'Cancelada' },
];

/** Suma días a una fecha YYYY-MM-DD sin que la zona del navegador la corra. */
function moverFecha(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** «09:30» → «9:30 a. m.», como se lee una agenda. */
function hora12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const sufijo = h < 12 ? 'a. m.' : 'p. m.';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${sufijo}`;
}

function titulo(fecha: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${fecha}T12:00:00Z`));
}

export function AgendaDelDia({ teamId }: { teamId: string }) {
  const [fecha, setFecha] = useState<string | null>(null);
  const [dia, setDia] = useState<Dia | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [crearEn, setCrearEn] = useState<{ hostUserId: string; hora: string } | null>(null);
  const [detalle, setDetalle] = useState<Cita | null>(null);
  const secuencia = useRef(0);

  const cargar = useCallback(
    async (f: string | null) => {
      if (!teamId) return;
      const esta = ++secuencia.current;
      try {
        const r = await api<Dia>(`/sales-teams/${teamId}/agenda/dia${f ? `?fecha=${f}` : ''}`);
        if (esta !== secuencia.current) return;
        setDia(r);
        setFecha(r.fecha);
        setError(null);
      } catch (e: any) {
        if (esta !== secuencia.current) return;
        setError(e?.message || 'No se pudo cargar el día');
      }
    },
    [teamId],
  );

  useEffect(() => {
    void cargar(null);
  }, [cargar]);

  const ir = (f: string | null) => void cargar(f);

  if (error) {
    return <section className="card card-pad mb-4 text-sm text-mute">{error}</section>;
  }
  if (!dia || !fecha) {
    return <section className="card card-pad mb-4 h-40 animate-shimmer bg-bg2" />;
  }

  // `filter` y no `find`: en una franja de 30 minutos caben dos citas del mismo
  // closer (10:00 y 10:15 de 15 minutos, o la que no asistió y la reagendada a
  // esa hora), y con `find` la segunda no se pintaba (Fable, 2026-09-14).
  const citasEn = (closerId: string, franja: string) =>
    dia.citas.filter((c) => c.hostUserId === closerId && c.franja === franja);
  // Red por si el servidor no trajera la columna de algún anfitrión: la cita se
  // enseña en el aviso en vez de desaparecer.
  const sinCloser = dia.citas.filter((c) => !c.hostUserId || !dia.closers.some((k) => k.id === c.hostUserId));
  const nombreDe = (id: string | null) => dia.closers.find((c) => c.id === id)?.nombre ?? '—';

  return (
    <section className="card card-pad mb-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="m-0 mr-auto text-sm font-semibold capitalize">{titulo(fecha)}</h2>
        <button onClick={() => ir(moverFecha(fecha, -1))} className="btn-ghost px-2.5 py-1 text-sm" aria-label="Día anterior">
          ←
        </button>
        <input
          type="date"
          value={fecha}
          onChange={(e) => e.target.value && ir(e.target.value)}
          className="input h-8 w-auto text-sm"
          aria-label="Elegir día"
        />
        <button onClick={() => ir(moverFecha(fecha, 1))} className="btn-ghost px-2.5 py-1 text-sm" aria-label="Día siguiente">
          →
        </button>
        <button onClick={() => ir(null)} className="btn-ghost px-2.5 py-1 text-xs">
          Hoy
        </button>
      </div>

      <div className="mb-3 flex flex-wrap gap-3 text-[11px] text-mute">
        <span>🟢 Confirmó o ya se hizo</span>
        <span>🔴 Canceló o no asistió</span>
        <span>⚪ Sin confirmar</span>
      </div>

      {sinCloser.length > 0 && (
        <div className="mb-3 rounded-lg border border-line bg-warn-soft px-3 py-2 text-xs text-warn-ink">
          {sinCloser.length} cita(s) de este día sin closer:{' '}
          {sinCloser.map((c) => `${hora12(c.hora)} ${c.lead?.nombre ?? 'Lead'}`).join(' · ')}.{' '}
          <Link href={`/admin/sales-teams/${teamId}/banco`} className="font-semibold underline">
            Asignarlas en el Banco →
          </Link>
        </div>
      )}

      {dia.closers.length === 0 ? (
        <p className="py-6 text-center text-sm text-mute">
          Este equipo todavía no tiene closers activos. La rejilla se arma con ellos.
        </p>
      ) : (
        <>
          {/* Móvil: solo las franjas con cita. Ver el día desde el teléfono sí;
              repartir la semana es trabajo de escritorio. */}
          <div className="flex flex-col gap-2 md:hidden">
            {dia.franjas.filter((f) => dia.closers.some((c) => citasEn(c.id, f).length > 0)).length === 0 ? (
              <p className="py-4 text-center text-sm text-mute">Sin citas este día.</p>
            ) : (
              dia.franjas
                .filter((f) => dia.closers.some((c) => citasEn(c.id, f).length > 0))
                .map((f) => (
                  <div key={f} className="rounded-lg border border-line">
                    <p className="border-b border-line px-3 py-1.5 text-xs font-semibold text-mute">{hora12(f)}</p>
                    {dia.closers.flatMap((c) =>
                      citasEn(c.id, f).map((cita) => (
                        <button
                          key={cita.id}
                          onClick={() => setDetalle(cita)}
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                            {PUNTO[cita.semaforo]} {cita.lead?.nombre ?? 'Lead'}
                          </span>
                          <span className="shrink-0 text-xs text-mute">
                            {hora12(cita.hora)} · {c.nombre.split(' ')[0]}
                          </span>
                        </button>
                      )),
                    )}
                  </div>
                ))
            )}
          </div>

          {/* Escritorio: filas = franjas, columnas = closers. */}
          <div className="hidden overflow-x-auto rounded-lg border border-line md:block">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="bg-bg2">
                  <th className="sticky left-0 z-10 border-b border-r border-line bg-bg2 px-2 py-2 text-left text-xs font-medium text-mute">
                    Hora
                  </th>
                  {dia.closers.map((c) => (
                    <th key={c.id} className="border-b border-line px-2 py-2 text-center text-xs font-semibold text-ink">
                      {c.nombre}
                      {c.activo === false && (
                        <span className="block text-[10px] font-normal text-mute">no es closer activo</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dia.franjas.map((f) => (
                  <tr key={f}>
                    <td className="sticky left-0 z-10 border-b border-r border-line bg-white px-2 py-1 text-xs font-medium text-mute whitespace-nowrap">
                      {hora12(f)}
                    </td>
                    {dia.closers.map((c) => {
                      const citas = citasEn(c.id, f);
                      return (
                        <td key={c.id} className="border-b border-line2 p-1 align-top">
                          {citas.length > 0 ? (
                            <div className="flex flex-col gap-1">
                              {citas.map((cita) => (
                                <button
                                  key={cita.id}
                                  onClick={() => setDetalle(cita)}
                                  className={`w-full rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${CELDA[cita.semaforo]}`}
                                >
                                  <span className="block truncate font-medium">
                                    {PUNTO[cita.semaforo]} {cita.lead?.nombre ?? 'Lead'}
                                  </span>
                                  {citas.length > 1 && <span className="block opacity-70">{hora12(cita.hora)}</span>}
                                  {cita.lead?.empresa && <span className="block truncate opacity-70">{cita.lead.empresa}</span>}
                                </button>
                              ))}
                            </div>
                          ) : dia.puedeEscribir && c.activo !== false ? (
                            <button
                              onClick={() => setCrearEn({ hostUserId: c.id, hora: f })}
                              className="w-full rounded-lg px-2 py-1.5 text-center text-[11px] text-mute2 transition-colors hover:bg-bg2 hover:text-ink"
                            >
                              + Disponible
                            </button>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {crearEn && (
        <AgendarCita
          teamId={teamId}
          fecha={fecha}
          closers={dia.closers.filter((c) => c.activo !== false)}
          preset={crearEn}
          onCerrar={() => setCrearEn(null)}
          onCreada={() => {
            setCrearEn(null);
            void cargar(fecha);
          }}
        />
      )}
      {detalle && (
        <DetalleDeCita
          teamId={teamId}
          cita={detalle}
          closer={nombreDe(detalle.hostUserId)}
          puedeEscribir={dia.puedeEscribir}
          onCerrar={() => {
            setDetalle(null);
            void cargar(fecha);
          }}
        />
      )}
    </section>
  );
}

function Modal({ titulo: t, onCerrar, children }: { titulo: string; onCerrar: () => void; children: React.ReactNode }) {
  // z-50 y no más: los avisos (z-60) tienen que verse encima del modal.
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={t}>
      <div className="absolute inset-0 bg-ink/50" onClick={onCerrar} />
      <div className="relative w-full max-w-md card card-pad">
        <h3 className="m-0 mb-3 text-base font-semibold text-ink">{t}</h3>
        {children}
      </div>
    </div>
  );
}

/** Agendar desde una celda: closer y hora vienen puestos; se elige el lead. */
function AgendarCita({
  teamId,
  fecha,
  closers,
  preset,
  onCerrar,
  onCreada,
}: {
  teamId: string;
  fecha: string;
  closers: { id: string; nombre: string }[];
  preset: { hostUserId: string; hora: string };
  onCerrar: () => void;
  onCreada: () => void;
}) {
  const [buscar, setBuscar] = useState('');
  const [resultados, setResultados] = useState<{ id: string; nombre: string | null; empresa: string | null; telefono: string | null }[]>([]);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [hostUserId, setHostUserId] = useState(preset.hostUserId);
  const [hora, setHora] = useState(preset.hora);
  const [duracion, setDuracion] = useState(30);
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    const q = buscar.trim();
    if (q.length < 2) {
      setResultados([]);
      return;
    }
    // Se espera a que deje de escribir: una consulta por tecla castiga la base.
    const t = setTimeout(() => {
      api<{ filas: { id: string; nombre: string | null; empresa: string | null; telefono: string | null }[] }>(
        `/sales-teams/${teamId}/contactos?q=${encodeURIComponent(q)}`,
      )
        .then((r) => setResultados(r.filas.slice(0, 8)))
        .catch(() => setResultados([]));
    }, 300);
    return () => clearTimeout(t);
  }, [buscar, teamId]);

  async function guardar() {
    setGuardando(true);
    try {
      // La agenda del equipo es de Bogotá: la fecha y la hora que se ven se
      // guardan como ese instante, pase lo que pase con el reloj del navegador.
      const startAt = new Date(`${fecha}T${hora}:00-05:00`).toISOString();
      await api(`/sales-teams/${teamId}/agenda/citas`, {
        method: 'POST',
        body: JSON.stringify({ leadId, hostUserId, startAt, durationMin: duracion, notes: notas.trim() || null }),
      });
      toast('Cita agendada.', 'success');
      onCreada();
    } catch (e: any) {
      toast(e?.message || 'No se pudo agendar', 'error');
    } finally {
      setGuardando(false);
    }
  }

  const elegido = resultados.find((r) => r.id === leadId);

  return (
    <Modal titulo="Agendar una cita" onCerrar={onCerrar}>
      <div className="flex flex-col gap-2">
        <label className="label">Lead</label>
        {leadId && elegido ? (
          <div className="flex items-center justify-between rounded-lg bg-bg2 px-3 py-2 text-sm">
            <span className="truncate">
              {elegido.nombre ?? 'Sin nombre'}
              {elegido.empresa ? <span className="text-mute"> · {elegido.empresa}</span> : null}
            </span>
            <button onClick={() => setLeadId(null)} className="text-xs text-mute hover:underline">
              Cambiar
            </button>
          </div>
        ) : (
          <>
            <input
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
              placeholder="Buscar por nombre, empresa o teléfono…"
              className="input"
              autoFocus
            />
            {resultados.length > 0 && (
              <ul className="max-h-40 overflow-auto rounded-lg border border-line">
                {resultados.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() => setLeadId(r.id)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-bg2"
                    >
                      <span className="truncate">{r.nombre ?? 'Sin nombre'}</span>
                      <span className="shrink-0 text-xs text-mute">{r.telefono ?? r.empresa ?? ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-mute">Opcional: una cita puede agendarse sin lead y enlazarse después.</p>
          </>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Closer</label>
            <select value={hostUserId} onChange={(e) => setHostUserId(e.target.value)} className="input">
              {closers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Hora</label>
            <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className="input" step={300} />
          </div>
        </div>
        <div>
          <label className="label">Duración</label>
          <select value={duracion} onChange={(e) => setDuracion(Number(e.target.value))} className="input">
            {[15, 30, 45, 60, 90].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </div>
        <textarea
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          placeholder="Notas para el closer (opcional)"
          className="input min-h-[60px]"
          maxLength={2000}
        />
        <div className="mt-2 flex justify-end gap-2">
          <button onClick={onCerrar} className="btn-ghost text-sm">
            Cancelar
          </button>
          <button onClick={() => void guardar()} disabled={guardando} className="btn-primary text-sm disabled:opacity-50">
            {guardando ? 'Agendando…' : 'Agendar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DetalleDeCita({
  teamId,
  cita,
  closer,
  puedeEscribir,
  onCerrar,
}: {
  teamId: string;
  cita: Cita;
  closer: string;
  puedeEscribir: boolean;
  onCerrar: () => void;
}) {
  const [estado, setEstado] = useState(cita.status);
  const [guardando, setGuardando] = useState(false);

  async function cambiar(nuevo: string) {
    const antes = estado;
    setEstado(nuevo);
    setGuardando(true);
    try {
      await api(`/sales-teams/${teamId}/agenda/citas/${cita.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nuevo }),
      });
      toast('Estado actualizado.', 'success');
    } catch (e: any) {
      setEstado(antes);
      toast(e?.message || 'No se pudo cambiar el estado', 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={cita.lead?.nombre ?? 'Cita sin lead'} onCerrar={onCerrar}>
      <div className="flex flex-col gap-3 text-sm">
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-bg2 p-3 text-xs">
          <Dato etiqueta="Hora" valor={`${hora12(cita.hora)} · ${cita.durationMin} min`} />
          <Dato etiqueta="Closer" valor={closer} />
          <Dato etiqueta="Empresa" valor={cita.lead?.empresa} />
          <Dato etiqueta="Semáforo" valor={`${PUNTO[cita.semaforo]} ${cita.semaforo === 'verde' ? 'Confirmó' : cita.semaforo === 'rojo' ? 'Canceló / no asistió' : 'Sin confirmar'}`} />
        </div>
        {puedeEscribir && (
          <div>
            <label className="label">Estado</label>
            <select value={estado} onChange={(e) => void cambiar(e.target.value)} disabled={guardando} className="input">
              {ESTADOS.map((e) => (
                <option key={e.valor} value={e.valor}>
                  {e.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {cita.lead && (
            <Link href={`/admin/sales-teams/${teamId}/board?lead=${cita.lead.id}`} className="btn-ghost text-sm">
              Abrir ficha en el CRM →
            </Link>
          )}
          <button onClick={onCerrar} className="btn-primary text-sm">
            Listo
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor?: string | null }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-mute">{etiqueta}</p>
      <p className="truncate text-ink">{valor || '—'}</p>
    </div>
  );
}
