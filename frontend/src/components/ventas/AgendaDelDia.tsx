'use client';

/**
 * La pestaña Agenda del equipo: la cuadrícula del día, y nada más.
 *
 * Es la agenda de TeamClubify: flechas, fecha y «Hoy»; una columna por closer y
 * una fila cada 30 minutos; «+ Disponible» en lo libre, que abre «Nueva
 * reunión»; y cada cita con el color de su confirmación, que abre «Reunión».
 * Aquí estaban también el enlace público, el horario, los ajustes y la lista de
 * próximas citas; Javier comparó con la referencia y no van en esta pestaña. El
 * enlace, el horario y los ajustes son ahora de cada agenda de reserva
 * («Configuración»).
 *
 * Dos cosas que la referencia no hace y se quedan, porque esconderlas es perder
 * citas: dos citas en la misma celda se apilan, y la cita de alguien que ya no es
 * closer activo abre su propia columna.
 *
 * El semáforo lo calcula el SERVIDOR (verde = confirmó o ya se hizo, rojo =
 * canceló o no asistió, sin punto = sin confirmar), igual que el del Banco: si lo
 * calculara la pantalla, dos personas podrían ver colores distintos.
 *
 * Colores por tokens. Bajo `.brand-panel` todo lo que lleva `bg-brand` o
 * `text-brand` en la clase se pinta con el color de la marca aunque vaya detrás
 * de `hover:`; por eso aquí no hay `hover:text-brand`.
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { CabeceraDeEquipo, type EquipoDeCabecera } from '@/components/ventas/CabeceraDeEquipo';
import { useBaseDeEquipos } from '@/components/ventas/rutas-de-equipos';

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
  confirmada: boolean;
  notes: string | null;
  lead: {
    id: string;
    nombre: string | null;
    empresa: string | null;
    telefono: string | null;
    origen: string | null;
  } | null;
};

type Closer = { id: string; nombre: string; activo?: boolean };

type Dia = {
  team: EquipoDeCabecera;
  fecha: string;
  zona: string;
  puedeEscribir: boolean;
  /** Reasignar: líder o admin de la marca, como en el Banco. */
  puedeAsignar: boolean;
  /** Los closers activos y, con `activo: false`, quien tiene cita ese día sin serlo. */
  closers: Closer[];
  franjas: string[];
  citas: Cita[];
  /** La duración de la primera agenda del equipo: con ella nace la reunión. */
  duracionMin: number;
};

/** El semáforo de la referencia (`APPT_COLOR_META`). Sin amarillo: aquí no hay estado «reagendada». */
const SEMAFORO: Record<Semaforo, { punto: string; etiqueta: string; celda: string; chip: string }> = {
  verde: { punto: '🟢', etiqueta: 'Confirmó', celda: 'bg-ok-soft text-ok-ink', chip: 'bg-ok-soft text-ok-ink' },
  rojo: { punto: '🔴', etiqueta: 'Canceló / no asistió', celda: 'bg-bad-soft text-bad-ink', chip: 'bg-bad-soft text-bad-ink' },
  gris: { punto: '⚪', etiqueta: 'Sin confirmar', celda: 'bg-brand-soft text-brand', chip: 'bg-bg2 text-mute' },
};

const ESTADO: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  CONFIRMADA: 'Confirmada',
  REALIZADA: 'Realizada',
  NO_ASISTIO: 'No asistió',
  CANCELADA: 'Cancelada',
};

/** «Resultado» del detalle: lo que ya se registró de esa reunión. */
const RESULTADO: Record<string, string> = {
  REALIZADA: 'Se realizó',
  NO_ASISTIO: 'No asistió',
};

/** Las de la referencia (`LEAD_SOURCES`). */
const FUENTES = ['WhatsApp', 'Instagram', 'Facebook', 'TikTok', 'Referido', 'Sitio web', 'Publicidad', 'Otro'];

const URGENCIAS = [
  { clave: 'alta', etiqueta: 'Alta' },
  { clave: 'media', etiqueta: 'Media' },
  { clave: 'baja', etiqueta: 'Baja' },
];

/** Suma días a una fecha AAAA-MM-DD sin que la zona del navegador la corra. */
function moverFecha(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** «09:30» → «9:30 AM», como la referencia. */
function hora12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

/**
 * La agenda cuenta en hora de Bogotá: la fecha y la hora que se ven se guardan
 * como ese instante, diga lo que diga el reloj del navegador.
 */
const instanteEnBogota = (fecha: string, hhmm: string) => new Date(`${fecha}T${hhmm}:00-05:00`).toISOString();

const mensaje = (e: unknown, porDefecto: string) => (e as { message?: string } | null)?.message || porDefecto;

/** «martes, 15 de septiembre», en hora de Bogotá: la fecha ISO cruda no se lee. */
const fechaLegible = (iso: string) =>
  new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(iso),
  );

export function AgendaDelDia({ teamId }: { teamId: string }) {
  const rutaEquipos = useBaseDeEquipos();
  const [dia, setDia] = useState<Dia | null>(null);
  // La fecha del selector cambia al pulsar, antes de que llegue el día: si
  // esperara a la respuesta, el campo saltaba atrás mientras carga.
  const [fechaVista, setFechaVista] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [crearEn, setCrearEn] = useState<{ hostUserId: string; hora: string } | null>(null);
  const [detalle, setDetalle] = useState<Cita | null>(null);
  const [resultado, setResultado] = useState<Cita | null>(null);
  const secuencia = useRef(0);
  const hayDia = useRef(false);

  const cargar = useCallback(
    async (fecha: string | null) => {
      if (!teamId) return;
      // Si se pulsa rápido, solo cuenta la última respuesta: una lenta que llega
      // después pintaría otro día.
      const esta = ++secuencia.current;
      if (fecha) setFechaVista(fecha);
      setCargando(true);
      try {
        const r = await api<Dia>(`/sales-teams/${teamId}/agenda/dia${fecha ? `?fecha=${fecha}` : ''}`);
        if (esta !== secuencia.current) return;
        setDia(r);
        setFechaVista(r.fecha);
        hayDia.current = true;
        setError(null);
      } catch (e: unknown) {
        if (esta !== secuencia.current) return;
        const texto =
          (e as { status?: number } | null)?.status === 404
            ? 'Este equipo no existe, o el módulo «Equipos de ventas» está apagado para esta marca.'
            : mensaje(e, 'No se pudo cargar la agenda.');
        // Con un día ya pintado se avisa y se queda: no se tira la pantalla.
        if (hayDia.current) toast(texto, 'error');
        else setError(texto);
      } finally {
        if (esta === secuencia.current) setCargando(false);
      }
    },
    [teamId],
  );

  useEffect(() => {
    void cargar(null);
  }, [cargar]);

  if (error && !dia) {
    return (
      <div className="card card-pad py-12 text-center">
        <div className="mb-1 font-semibold">No se pudo cargar</div>
        <div className="mb-4 text-sm text-mute">{error}</div>
        <Link href={rutaEquipos} className="btn-ghost inline-flex text-sm">
          Volver a los equipos
        </Link>
      </div>
    );
  }
  if (!dia) return <div className="h-32 animate-shimmer rounded bg-bg2" />;

  const fecha = dia.fecha;
  const fechaDelSelector = fechaVista ?? fecha;
  // `filter` y no `find`: en una franja de 30 minutos caben dos citas del mismo
  // closer (10:00 y 10:15 de 15 minutos, o la que no asistió y la reagendada a
  // esa hora), y con `find` la segunda no se pintaba (Fable, 2026-09-14).
  const citasEn = (closerId: string, franja: string) =>
    dia.citas.filter((c) => c.hostUserId === closerId && c.franja === franja);
  const closersActivos = dia.closers.filter((c) => c.activo !== false);
  const nombreDe = (id: string | null) => dia.closers.find((c) => c.id === id)?.nombre ?? '—';
  const recargar = () => void cargar(fecha);

  return (
    <div>
      <CabeceraDeEquipo equipo={{ ...dia.team, id: teamId }} soloLectura={!dia.puedeEscribir} />

      {dia.closers.length === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-surface p-8 text-center">
          <p className="m-0 text-sm font-medium text-ink">Este equipo todavía no tiene closers</p>
          <p className="mx-auto mb-0 mt-1 max-w-md text-sm text-mute">
            La agenda se arma con los closers del equipo. Agrega al menos uno para empezar a agendar.
          </p>
          <Link href={`${rutaEquipos}/${teamId}/colaboradores`} className="btn-primary mt-4 inline-flex text-sm">
            Agregar colaboradores
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void cargar(moverFecha(fechaDelSelector, -1))}
              className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink hover:bg-bg2"
              aria-label="Día anterior"
            >
              ←
            </button>
            <input
              type="date"
              value={fechaDelSelector}
              onChange={(e) => {
                if (e.target.value) void cargar(e.target.value);
              }}
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
              aria-label="Elegir día"
            />
            <button
              type="button"
              onClick={() => void cargar(moverFecha(fechaDelSelector, 1))}
              className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink hover:bg-bg2"
              aria-label="Día siguiente"
            >
              →
            </button>
            <button
              type="button"
              onClick={() => void cargar(null)}
              className="rounded-lg bg-bg2 px-2.5 py-1.5 text-xs text-ink hover:bg-line"
            >
              Hoy
            </button>
            {cargando && <span className="text-xs text-mute">Cargando…</span>}
          </div>

          {/* Filas = horarios, columnas = closers. En el teléfono se desliza de
              lado dentro de su caja, sin romper la página. */}
          <div className="overflow-x-auto rounded-2xl border border-line">
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
                    <td className="sticky left-0 z-10 whitespace-nowrap border-b border-r border-line bg-surface px-2 py-1 text-xs font-medium text-mute">
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
                                  type="button"
                                  onClick={() => setDetalle(cita)}
                                  className={`w-full rounded-lg px-2 py-1.5 text-left text-xs transition-opacity hover:opacity-80 ${SEMAFORO[cita.semaforo].celda}`}
                                >
                                  <span className="block truncate font-medium">
                                    {cita.semaforo === 'gris' ? '' : `${SEMAFORO[cita.semaforo].punto} `}
                                    {cita.lead?.nombre ?? 'Lead'}
                                  </span>
                                  {citas.length > 1 && <span className="block opacity-70">{hora12(cita.hora)}</span>}
                                  {cita.lead?.empresa && <span className="block truncate opacity-70">{cita.lead.empresa}</span>}
                                </button>
                              ))}
                            </div>
                          ) : dia.puedeEscribir && c.activo !== false ? (
                            <button
                              type="button"
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
        <NuevaReunion
          teamId={teamId}
          fecha={fecha}
          closers={closersActivos}
          franjas={dia.franjas}
          preset={crearEn}
          duracionMin={dia.duracionMin}
          onCerrar={() => setCrearEn(null)}
          onCreada={() => {
            setCrearEn(null);
            recargar();
          }}
        />
      )}
      {detalle && !resultado && (
        <DetalleDeReunion
          teamId={teamId}
          fecha={fecha}
          cita={detalle}
          closer={nombreDe(detalle.hostUserId)}
          closers={closersActivos}
          franjas={dia.franjas}
          puedeEscribir={dia.puedeEscribir}
          puedeAsignar={dia.puedeAsignar}
          onCerrar={() => {
            setDetalle(null);
            recargar();
          }}
          onResultado={() => setResultado(detalle)}
        />
      )}
      {resultado && (
        <ResultadoDeReunion
          teamId={teamId}
          cita={resultado}
          onCerrar={() => {
            setResultado(null);
            setDetalle(null);
            recargar();
          }}
        />
      )}
    </div>
  );
}

function Modal({
  titulo,
  onCerrar,
  ancho = 'max-w-md',
  children,
}: {
  titulo: string;
  onCerrar: () => void;
  ancho?: string;
  children: ReactNode;
}) {
  // z-50 y no más: los avisos (z-60) tienen que verse encima del modal.
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="absolute inset-0 bg-ink/50" onClick={onCerrar} />
      <div className={`card card-pad relative max-h-[90vh] w-full overflow-y-auto ${ancho}`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="m-0 text-base font-semibold text-ink">{titulo}</h3>
          <button type="button" onClick={onCerrar} className="text-mute hover:text-ink" aria-label="Cerrar">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <span className="label">{etiqueta}</span>
      {children}
    </div>
  );
}

/** «Nueva reunión»: los campos de la referencia, con el closer y la hora de la celda ya puestos. */
function NuevaReunion({
  teamId,
  fecha,
  closers,
  franjas,
  preset,
  duracionMin,
  onCerrar,
  onCreada,
}: {
  teamId: string;
  fecha: string;
  closers: Closer[];
  franjas: string[];
  preset: { hostUserId: string; hora: string };
  duracionMin: number;
  onCerrar: () => void;
  onCreada: () => void;
}) {
  const [nombre, setNombre] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [servicio, setServicio] = useState('');
  const [fuente, setFuente] = useState('');
  const [urgencia, setUrgencia] = useState('media');
  const [closerId, setCloserId] = useState(preset.hostUserId);
  const [hora, setHora] = useState(preset.hora);
  const [elDia, setElDia] = useState(fecha);
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const horas = franjas.includes(preset.hora) ? franjas : [...franjas, preset.hora].sort();

  async function agendar() {
    if (!nombre.trim()) return setError('El nombre del lead es obligatorio.');
    if (!closerId || !elDia || !hora) return setError('Closer, fecha y hora son obligatorios.');
    setGuardando(true);
    setError(null);
    // «Servicio de interés» y «Nivel de urgencia» no tienen columna en el lead:
    // van al principio de las observaciones, que es lo que el closer lee al abrir
    // la reunión.
    const observaciones = [
      servicio.trim() && `Servicio de interés: ${servicio.trim()}`,
      `Nivel de urgencia: ${URGENCIAS.find((u) => u.clave === urgencia)?.etiqueta ?? urgencia}`,
      notas.trim(),
    ]
      .filter(Boolean)
      .join('\n');
    try {
      await api(`/sales-teams/${teamId}/agenda/citas`, {
        method: 'POST',
        body: JSON.stringify({
          hostUserId: closerId,
          startAt: instanteEnBogota(elDia, hora),
          durationMin: duracionMin,
          notes: observaciones,
          lead: {
            nombre: nombre.trim(),
            whatsapp: whatsapp.trim() || null,
            empresa: empresa.trim() || null,
            fuente: fuente || null,
          },
        }),
      });
      toast('Reunión agendada.', 'success');
      onCreada();
    } catch (e) {
      setError(mensaje(e, 'No se pudo agendar la reunión.'));
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Nueva reunión" onCerrar={onCerrar} ancho="max-w-lg">
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo etiqueta="Nombre del lead *">
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className="input"
              placeholder="Nombre y apellido"
              maxLength={120}
              autoFocus
            />
          </Campo>
          <Campo etiqueta="WhatsApp">
            <input
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              className="input"
              placeholder="+57…"
              inputMode="tel"
              maxLength={40}
            />
          </Campo>
          <Campo etiqueta="Empresa">
            <input value={empresa} onChange={(e) => setEmpresa(e.target.value)} className="input" maxLength={160} />
          </Campo>
          <Campo etiqueta="Servicio de interés">
            <input
              value={servicio}
              onChange={(e) => setServicio(e.target.value)}
              className="input"
              placeholder="¿Qué le interesa?"
              maxLength={120}
            />
          </Campo>
          <Campo etiqueta="Fuente del lead">
            <select value={fuente} onChange={(e) => setFuente(e.target.value)} className="input">
              <option value="">—</option>
              {FUENTES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Nivel de urgencia">
            <select value={urgencia} onChange={(e) => setUrgencia(e.target.value)} className="input">
              {URGENCIAS.map((u) => (
                <option key={u.clave} value={u.clave}>
                  {u.etiqueta}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Closer asignado *">
            <select value={closerId} onChange={(e) => setCloserId(e.target.value)} className="input">
              {closers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Hora *">
            <select value={hora} onChange={(e) => setHora(e.target.value)} className="input">
              {horas.map((h) => (
                <option key={h} value={h}>
                  {hora12(h)}
                </option>
              ))}
            </select>
          </Campo>
        </div>
        <Campo etiqueta="Fecha *">
          <input type="date" value={elDia} onChange={(e) => setElDia(e.target.value)} className="input" />
        </Campo>
        <Campo etiqueta="Observaciones iniciales">
          <textarea
            rows={2}
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            className="input"
            placeholder="Contexto para el closer…"
            maxLength={1500}
          />
        </Campo>

        {error && <p className="m-0 text-sm text-bad-ink">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCerrar} className="btn-ghost text-sm">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void agendar()}
            disabled={guardando}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {guardando ? 'Agendando…' : 'Agendar reunión'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** «Reunión»: el detalle de la referencia. Confirmar y reasignar usan las mismas puertas del Banco. */
function DetalleDeReunion({
  teamId,
  fecha,
  cita,
  closer,
  closers,
  franjas,
  puedeEscribir,
  puedeAsignar,
  onCerrar,
  onResultado,
}: {
  teamId: string;
  fecha: string;
  cita: Cita;
  closer: string;
  closers: Closer[];
  franjas: string[];
  puedeEscribir: boolean;
  puedeAsignar: boolean;
  onCerrar: () => void;
  onResultado: () => void;
}) {
  const [modo, setModo] = useState<'ver' | 'reagendar' | 'reasignar'>('ver');
  const [nuevaFecha, setNuevaFecha] = useState(fecha);
  const [nuevaHora, setNuevaHora] = useState(cita.hora);
  const [nuevoCloser, setNuevoCloser] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const semaforo = SEMAFORO[cita.semaforo];
  const horas = franjas.includes(cita.hora) ? franjas : [...franjas, cita.hora].sort();
  const otros = closers.filter((c) => c.id !== cita.hostUserId);

  async function correr(accion: () => Promise<unknown>, hecho: string) {
    setOcupado(true);
    setError(null);
    try {
      await accion();
      toast(hecho, 'success');
      onCerrar();
    } catch (e) {
      setError(mensaje(e, 'No se pudo hacer el cambio.'));
      setOcupado(false);
    }
  }

  const reagendar = () =>
    correr(
      () =>
        api(`/sales-teams/${teamId}/agenda/citas/${cita.id}/reagendar`, {
          method: 'PATCH',
          body: JSON.stringify({ startAt: instanteEnBogota(nuevaFecha, nuevaHora) }),
        }),
      'Reunión reagendada.',
    );
  const reasignar = () =>
    correr(
      () =>
        api(`/sales-teams/${teamId}/banco/citas/${cita.id}/asignar`, {
          method: 'PATCH',
          body: JSON.stringify({ hostUserId: nuevoCloser }),
        }),
      'Reunión reasignada.',
    );
  const confirmar = () =>
    correr(
      () =>
        api(`/sales-teams/${teamId}/banco/citas/${cita.id}/confirmar`, {
          method: 'PATCH',
          body: JSON.stringify({ on: !cita.confirmada }),
        }),
      cita.confirmada ? 'Se quitó la confirmación.' : 'Asistencia confirmada.',
    );
  const volver = () => {
    setModo('ver');
    setError(null);
  };

  return (
    <Modal titulo="Reunión" onCerrar={onCerrar}>
      <div className="flex flex-col gap-3 text-sm">
        <div className="rounded-xl bg-bg2 p-3">
          <p className="m-0 text-base font-semibold text-ink">{cita.lead?.nombre ?? 'Lead'}</p>
          {cita.lead?.empresa && <p className="m-0 text-mute">{cita.lead.empresa}</p>}
          <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-mute">
            <span>
              📅 {fechaLegible(cita.startAt)} · {hora12(cita.hora)}
            </span>
            <span>👤 {closer}</span>
            {cita.lead?.telefono && <span>📱 {cita.lead.telefono}</span>}
            {cita.lead?.origen && <span>🌐 {cita.lead.origen}</span>}
          </div>
          <p className="m-0 mt-2 flex flex-wrap items-center gap-1 text-xs">
            <span className="rounded-pill bg-surface px-2 py-0.5 font-medium text-ink">{ESTADO[cita.status] ?? cita.status}</span>
            <span className={`rounded-pill px-2 py-0.5 font-medium ${semaforo.chip}`}>
              {semaforo.punto} {semaforo.etiqueta}
            </span>
          </p>
        </div>

        {cita.notes && (
          <div>
            <p className="m-0 text-xs font-medium text-mute">Observaciones</p>
            <p className="m-0 whitespace-pre-wrap text-sm text-ink">{cita.notes}</p>
          </div>
        )}
        {RESULTADO[cita.status] && (
          <div>
            <p className="m-0 text-xs font-medium text-mute">Resultado</p>
            <p className="m-0 text-sm text-ink">{RESULTADO[cita.status]}</p>
          </div>
        )}

        {!puedeEscribir ? null : modo === 'reagendar' ? (
          <div className="rounded-xl border border-line p-3">
            <p className="m-0 mb-2 text-xs font-medium text-ink">Reagendar</p>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={nuevaFecha}
                onChange={(e) => setNuevaFecha(e.target.value)}
                className="input"
                aria-label="Nueva fecha"
              />
              <select value={nuevaHora} onChange={(e) => setNuevaHora(e.target.value)} className="input" aria-label="Nueva hora">
                {horas.map((h) => (
                  <option key={h} value={h}>
                    {hora12(h)}
                  </option>
                ))}
              </select>
            </div>
            {error && <p className="m-0 mt-2 text-xs text-bad-ink">{error}</p>}
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={volver} className="btn-ghost text-sm">
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void reagendar()}
                disabled={ocupado || !nuevaFecha}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {ocupado ? '…' : 'Confirmar'}
              </button>
            </div>
          </div>
        ) : modo === 'reasignar' ? (
          <div className="rounded-xl border border-line p-3">
            <p className="m-0 mb-1 text-xs font-medium text-ink">Reasignar a otro closer</p>
            <p className="m-0 mb-2 text-xs text-mute">La reunión pasa a su columna, con el lead y el horario.</p>
            <select value={nuevoCloser} onChange={(e) => setNuevoCloser(e.target.value)} className="input">
              <option value="">Elige un closer…</option>
              {otros.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
            {error && <p className="m-0 mt-2 text-xs text-bad-ink">{error}</p>}
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={volver} className="btn-ghost text-sm">
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void reasignar()}
                disabled={ocupado || !nuevoCloser}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {ocupado ? '…' : 'Reasignar'}
              </button>
            </div>
          </div>
        ) : (
          <>
            {error && <p className="m-0 text-xs text-bad-ink">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button type="button" onClick={() => void confirmar()} disabled={ocupado} className="btn-ghost text-sm">
                {cita.confirmada ? 'Quitar confirmación' : 'Confirmar asistencia'}
              </button>
              {puedeAsignar && otros.length > 0 && (
                <button type="button" onClick={() => setModo('reasignar')} className="btn-ghost text-sm">
                  Reasignar
                </button>
              )}
              <button type="button" onClick={() => setModo('reagendar')} className="btn-ghost text-sm">
                Reagendar
              </button>
              <button type="button" onClick={onResultado} className="btn-primary text-sm">
                Registrar resultado
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * «Resultado de la reunión». De la referencia se trae lo que el modelo de datos
 * de aquí sostiene: si se realizó o no asistió, y las observaciones. El estado
 * del lead (venta, perdido, seguimiento) se registra en Seguimientos y en el CRM.
 */
function ResultadoDeReunion({
  teamId,
  cita,
  onCerrar,
}: {
  teamId: string;
  cita: Cita;
  onCerrar: () => void;
}) {
  const [realizada, setRealizada] = useState(true);
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finalizar() {
    setGuardando(true);
    setError(null);
    const observaciones = notas.trim();
    try {
      if (realizada) {
        await api(`/sales-teams/${teamId}/agenda/citas/${cita.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'REALIZADA', nota: observaciones || null }),
        });
      } else {
        // La puerta del Banco: además de marcarla deja el seguimiento para
        // reagendar y dispara el aviso de plantón. Solo acepta citas que ya pasaron.
        await api(`/sales-teams/${teamId}/banco/citas/${cita.id}/no-asistio`, { method: 'PATCH' });
        if (observaciones && cita.lead) {
          // Esa puerta no lleva nota: las observaciones van aparte al historial
          // del lead. Si esto falla, lo importante ya quedó.
          await api(`/sales-teams/${teamId}/leads/${cita.lead.id}/notes`, {
            method: 'POST',
            body: JSON.stringify({ body: observaciones }),
          }).catch(() => toast('Se registró, pero no se guardaron las observaciones.', 'error'));
        }
      }
    } catch (e) {
      setError(mensaje(e, 'No se pudo registrar el resultado.'));
      setGuardando(false);
      return;
    }
    toast('Resultado registrado.', 'success');
    onCerrar();
  }

  return (
    <Modal titulo="Resultado de la reunión" onCerrar={onCerrar}>
      <div className="flex flex-col gap-3">
        <div className="rounded-xl bg-bg2 p-3 text-sm">
          <p className="m-0 font-medium text-ink">
            {cita.lead?.nombre ?? 'Lead'}
            {cita.lead?.empresa ? ` · ${cita.lead.empresa}` : ''}
          </p>
          <p className="m-0 text-xs text-mute">
            {fechaLegible(cita.startAt)} · {hora12(cita.hora)}
          </p>
        </div>

        <Campo etiqueta="¿La reunión se realizó?">
          <div className="grid grid-cols-2 gap-2">
            <Opcion activa={realizada} onClick={() => setRealizada(true)}>
              ✅ Sí, se realizó
            </Opcion>
            <Opcion activa={!realizada} onClick={() => setRealizada(false)}>
              🚫 No asistió
            </Opcion>
          </div>
          {!realizada && cita.lead && (
            <p className="m-0 mt-1 text-xs text-warn-ink">Se creará automáticamente un seguimiento para reagendarla.</p>
          )}
        </Campo>

        <Campo etiqueta="Observaciones (opcional)">
          <textarea
            rows={2}
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            className="input"
            placeholder="Notas de la reunión"
            maxLength={2000}
          />
        </Campo>

        {error && <p className="m-0 text-sm text-bad-ink">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCerrar} className="btn-ghost text-sm">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void finalizar()}
            disabled={guardando}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : 'Finalizar reporte'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Opcion({ activa, onClick, children }: { activa: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
        activa ? 'border-transparent bg-brand text-white' : 'border-line bg-surface text-mute hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
