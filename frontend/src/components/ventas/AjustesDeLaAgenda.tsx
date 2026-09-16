'use client';

/**
 * «Configurar» de UNA agenda de reserva: su nombre, enlace, color y formulario, y
 * cómo se ve y cuándo se reserva (horario, duración, bloques, reservas por
 * horario, días hacia adelante, antelación, fechas bloqueadas y «Volver al sitio»).
 *
 * Es «Evento» + «Disponibilidad» de TeamClubify (`AgendaSettings`). Antes era la
 * tarjeta de ajustes de la única agenda del equipo, y el horario vivía aparte
 * («¿Cuándo atiende el equipo?»); ahora todo es de cada agenda y se abre desde
 * «Agendas de reserva del equipo» (`AgendasDeReserva`).
 *
 * Solo la cambia quien `puedeConfigurar`; los demás la ven sin poder tocarla.
 * Colores por tokens: bajo `.brand-panel` / `.brand-auth` la marca pone los suyos.
 */

import { useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

export type FranjaDeAgenda = { weekday: number; startMin: number; endMin: number };

export type AjustesDeAgenda = {
  titulo: string | null;
  subtitulo: string | null;
  duracionMin: number;
  diasHaciaAdelante: number;
  antelacionMin: number;
  fechasBloqueadas: string[];
  volverAlSitio: string | null;
  redirigirEnSegundos: number;
  franjas: FranjaDeAgenda[];
  pasoMin: number;
  cuposPorHorario: number;
};

export type Agenda = {
  id: string;
  nombre: string;
  slug: string;
  color: string | null;
  activa: boolean;
  formularioId: string | null;
  ajustes: AjustesDeAgenda;
  /** «09:00–17:30», o null sin horario. */
  horario: string | null;
};

export type DatosDeAgendas = {
  puedeConfigurar: boolean;
  nombreDelEquipo: string;
  /** El enlace de siempre del equipo (`/agenda/<slug del equipo>`), o null si no tenía. */
  slugDelEquipo: string | null;
  agendas: Agenda[];
  /** `usable` = activo y con un dato de contacto: solo esos se pueden elegir. */
  formularios: { id: string; nombre: string; usable: boolean }[];
  opciones: {
    duraciones: number[];
    antelaciones: number[];
    maxDias: number;
    redirecciones: number[];
    pasos: number[];
    maxCupos: number;
    colores: string[];
  };
};

/** Lunes primero, como la referencia. `d` es el día de la semana del servidor (0 = domingo). */
const DIAS = [
  { d: 1, nombre: 'Lunes' },
  { d: 2, nombre: 'Martes' },
  { d: 3, nombre: 'Miércoles' },
  { d: 4, nombre: 'Jueves' },
  { d: 5, nombre: 'Viernes' },
  { d: 6, nombre: 'Sábado' },
  { d: 0, nombre: 'Domingo' },
];

const aHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const aMinutos = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Lo que se escribe en un enlace mientras se teclea: minúsculas, sin tildes y con guiones. El servidor lo remata. */
export function enlaceTecleado(v: string): string {
  return v
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 60);
}

function antelacionLegible(min: number): string {
  if (min === 0) return 'Sin antelación';
  if (min < 60) return `${min} min`;
  if (min % 1440 === 0) return min === 1440 ? '1 día' : `${min / 1440} días`;
  return `${min / 60} h`;
}

/** «jue, 25 dic 2026». La fecha es un día, no un instante: se pinta en UTC para que no se corra. */
const fechaLegible = (f: string) =>
  new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(`${f}T12:00:00Z`),
  );

type Tramo = { desde: string; hasta: string } | null;

export function AjustesDeLaAgenda({
  teamId,
  agenda,
  datos,
  onGuardada,
  onBorrada,
}: {
  teamId: string;
  agenda: Agenda;
  datos: DatosDeAgendas;
  onGuardada: () => void | Promise<void>;
  onBorrada: () => void | Promise<void>;
}) {
  const ro = !datos.puedeConfigurar;
  const pre = `agenda-${agenda.id}`;
  const [nombre, setNombre] = useState(agenda.nombre);
  const [enlace, setEnlace] = useState(agenda.slug);
  const [color, setColor] = useState<string | null>(agenda.color);
  const [activa, setActiva] = useState(agenda.activa);
  const [formularioId, setFormularioId] = useState(agenda.formularioId ?? '');
  const [a, setA] = useState<AjustesDeAgenda>(agenda.ajustes);
  // Un tramo por día, como el «¿Cuándo atiende el equipo?» de antes. null = ese día no se ofrece.
  const [tramos, setTramos] = useState<Record<number, Tramo>>(() => {
    const m: Record<number, Tramo> = {};
    for (const { d } of DIAS) {
      const f = agenda.ajustes.franjas.find((x) => x.weekday === d);
      m[d] = f ? { desde: aHHMM(f.startMin), hasta: aHHMM(f.endMin) } : null;
    }
    return m;
  });
  const [nuevaFecha, setNuevaFecha] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cambiar = (p: Partial<AjustesDeAgenda>) => setA((x) => ({ ...x, ...p }));
  const diasValidos =
    Number.isInteger(a.diasHaciaAdelante) && a.diasHaciaAdelante >= 1 && a.diasHaciaAdelante <= datos.opciones.maxDias;
  const cuposValidos =
    Number.isInteger(a.cuposPorHorario) && a.cuposPorHorario >= 1 && a.cuposPorHorario <= datos.opciones.maxCupos;
  // Los tramos de más que ya tuviera un día (esta pantalla enseña uno) se
  // conservan al guardar: si no, guardar cualquier otro ajuste los borraba.
  const extras = agenda.ajustes.franjas.filter(
    (f, i, todas) => todas.findIndex((x) => x.weekday === f.weekday) !== i,
  );
  const elegibles = datos.formularios.filter((f) => f.usable || f.id === agenda.formularioId);
  const enlacePublico = `${typeof window !== 'undefined' ? window.location.origin : ''}/agenda/${agenda.slug}`;

  function bloquear() {
    if (!nuevaFecha) return;
    if (!a.fechasBloqueadas.includes(nuevaFecha)) cambiar({ fechasBloqueadas: [...a.fechasBloqueadas, nuevaFecha].sort() });
    setNuevaFecha('');
  }

  async function guardar() {
    const franjas: FranjaDeAgenda[] = [];
    for (const { d, nombre: dia } of DIAS) {
      const t = tramos[d];
      if (!t) continue;
      const startMin = aMinutos(t.desde);
      const endMin = aMinutos(t.hasta);
      if (endMin <= startMin) {
        toast(`El ${dia.toLowerCase()}, la hora de cierre tiene que ser posterior a la de apertura.`, 'error');
        return;
      }
      franjas.push({ weekday: d, startMin, endMin }, ...extras.filter((f) => f.weekday === d));
    }
    setGuardando(true);
    try {
      await api(`/sales-teams/${teamId}/agendas/${agenda.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          nombre: nombre.trim(),
          // El enlace solo viaja si cambió: así guardar otra cosa no lo revalida.
          ...(enlace !== agenda.slug ? { slug: enlace } : {}),
          color,
          activa,
          formularioId: formularioId || null,
          titulo: a.titulo?.trim() || null,
          subtitulo: a.subtitulo?.trim() || null,
          duracionMin: a.duracionMin,
          diasHaciaAdelante: a.diasHaciaAdelante,
          antelacionMin: a.antelacionMin,
          fechasBloqueadas: a.fechasBloqueadas,
          volverAlSitio: a.volverAlSitio?.trim() || null,
          redirigirEnSegundos: a.redirigirEnSegundos,
          franjas,
          pasoMin: a.pasoMin,
          cuposPorHorario: a.cuposPorHorario,
        }),
      });
    } catch (e: unknown) {
      toast((e as { message?: string } | null)?.message || 'No se pudo guardar la agenda', 'error');
      setGuardando(false);
      return;
    }
    toast('Agenda guardada.', 'success');
    setGuardando(false);
    // Se relee lo que quedó (el servidor limpia y ordena). Un fallo al releer no
    // deshace lo guardado.
    try {
      await onGuardada();
    } catch {
      /* lo guardado ya entró */
    }
  }

  async function borrar() {
    if (!confirm(`¿Eliminar la agenda «${agenda.nombre}»? Su enlace dejará de funcionar. Las citas ya reservadas se quedan.`)) {
      return;
    }
    try {
      await api(`/sales-teams/${teamId}/agendas/${agenda.id}`, { method: 'DELETE' });
    } catch (e: unknown) {
      toast((e as { message?: string } | null)?.message || 'No se pudo eliminar la agenda', 'error');
      return;
    }
    toast('Agenda eliminada.', 'success');
    await onBorrada();
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-line bg-bg p-3">
      {ro && (
        <p className="m-0 text-xs text-mute">Solo el líder del equipo o un admin de la marca pueden cambiar esta agenda.</p>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="card card-pad flex flex-col gap-3">
          <h3 className="m-0 text-sm font-semibold text-ink">Evento</h3>

          <Campo id={`${pre}-publico`} etiqueta="Enlace público">
            <div className="flex flex-wrap items-center gap-2">
              <input id={`${pre}-publico`} className="input flex-1 font-mono text-xs" readOnly value={enlacePublico} />
              <button
                type="button"
                className="btn-ghost text-sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(enlacePublico);
                  toast('Copiado.', 'success');
                }}
              >
                Copiar
              </button>
            </div>
          </Campo>

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="accent-brand"
              checked={activa}
              disabled={ro}
              onChange={(e) => setActiva(e.target.checked)}
            />
            Agenda activa (visible al público)
          </label>
          {/* Esta agenda lleva el enlace que el equipo repartió cuando tenía una
              sola. Apagada, ese enlace no cae a otra agenda: deja de abrir. */}
          {agenda.activa && !activa && !!datos.slugDelEquipo && agenda.slug === datos.slugDelEquipo && (
            <p className="m-0 text-xs text-warn-ink">
              Esta agenda usa el enlace de siempre del equipo (/agenda/{agenda.slug}). Si la apagas, quien ya lo tenga no
              llegará a ninguna agenda.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo id={`${pre}-nombre`} etiqueta="Nombre de la agenda">
              <input
                id={`${pre}-nombre`}
                className="input"
                value={nombre}
                maxLength={80}
                disabled={ro}
                onChange={(e) => setNombre(e.target.value)}
              />
            </Campo>
            <Campo id={`${pre}-enlace`} etiqueta="URL de la agenda (/agenda/…)">
              <input
                id={`${pre}-enlace`}
                className="input font-mono"
                value={enlace}
                maxLength={60}
                disabled={ro}
                onChange={(e) => setEnlace(enlaceTecleado(e.target.value))}
              />
            </Campo>
          </div>
          {enlace !== agenda.slug && (
            <p className="m-0 text-xs text-warn-ink">Quien ya tenga el enlace anterior puede dejar de llegar a esta agenda.</p>
          )}

          <div>
            <span className="label">Color</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={ro}
                onClick={() => setColor(null)}
                aria-pressed={color === null}
                className={`h-7 rounded-pill border px-2.5 text-xs ${color === null ? 'border-ink text-ink' : 'border-line text-mute'}`}
              >
                Sin color
              </button>
              {datos.opciones.colores.map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={ro}
                  onClick={() => setColor(c)}
                  aria-label={`Color ${c}`}
                  aria-pressed={color === c}
                  className={`h-7 w-7 rounded-full border-2 ${color === c ? 'border-ink' : 'border-transparent'}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo id={`${pre}-titulo`} etiqueta="Nombre del evento">
              <input
                id={`${pre}-titulo`}
                className="input"
                value={a.titulo ?? ''}
                placeholder="Agenda una cita"
                maxLength={80}
                disabled={ro}
                onChange={(e) => cambiar({ titulo: e.target.value })}
              />
            </Campo>
            <Campo id={`${pre}-subtitulo`} etiqueta="Subtítulo / descripción">
              <input
                id={`${pre}-subtitulo`}
                className="input"
                value={a.subtitulo ?? ''}
                placeholder={`con ${datos.nombreDelEquipo}`}
                maxLength={200}
                disabled={ro}
                onChange={(e) => cambiar({ subtitulo: e.target.value })}
              />
            </Campo>
          </div>

          <Campo
            id={`${pre}-formulario`}
            etiqueta="Formulario del agendamiento"
            ayuda="Solo se pueden elegir formularios activos que pidan un nombre, un WhatsApp o un correo."
          >
            <select
              id={`${pre}-formulario`}
              className="input"
              value={formularioId}
              disabled={ro}
              onChange={(e) => setFormularioId(e.target.value)}
            >
              <option value="">— Nombre y teléfono (sin formulario)</option>
              {elegibles.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nombre}
                  {f.usable ? '' : ' (no disponible)'}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id={`${pre}-volver`} etiqueta="Volver al sitio (opcional)" ayuda="Tras reservar, un enlace para volver a tu página.">
            <input
              id={`${pre}-volver`}
              type="url"
              className="input"
              value={a.volverAlSitio ?? ''}
              placeholder="https://tusitio.com"
              maxLength={300}
              disabled={ro}
              onChange={(e) => cambiar({ volverAlSitio: e.target.value })}
            />
          </Campo>
          <Campo
            id={`${pre}-redireccion`}
            etiqueta="Llevar solo a ese sitio"
            ayuda="Con la cita ya reservada, la página lleva sola a tu sitio pasado ese tiempo. Quien quiera, puede ir antes."
          >
            <select
              id={`${pre}-redireccion`}
              className="input"
              value={a.redirigirEnSegundos}
              // Sin sitio al que volver no hay a dónde llevar a nadie.
              disabled={ro || !a.volverAlSitio?.trim()}
              onChange={(e) => cambiar({ redirigirEnSegundos: Number(e.target.value) })}
            >
              {datos.opciones.redirecciones.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'No, solo el enlace' : `Sí, a los ${n} segundos`}
                </option>
              ))}
            </select>
          </Campo>
        </section>

        <section className="card card-pad flex flex-col gap-3">
          <h3 className="m-0 text-sm font-semibold text-ink">Disponibilidad</h3>

          <div className="grid grid-cols-2 gap-3">
            <Campo id={`${pre}-duracion`} etiqueta="Duración de la cita">
              <select
                id={`${pre}-duracion`}
                className="input"
                value={a.duracionMin}
                disabled={ro}
                onChange={(e) => cambiar({ duracionMin: Number(e.target.value) })}
              >
                {datos.opciones.duraciones.map((n) => (
                  <option key={n} value={n}>
                    {n} min
                  </option>
                ))}
              </select>
            </Campo>
            <Campo id={`${pre}-paso`} etiqueta="Bloques de">
              <select
                id={`${pre}-paso`}
                className="input"
                value={a.pasoMin}
                disabled={ro}
                onChange={(e) => cambiar({ pasoMin: Number(e.target.value) })}
              >
                {datos.opciones.pasos.map((n) => (
                  <option key={n} value={n}>
                    {n} min
                  </option>
                ))}
              </select>
            </Campo>
            <Campo id={`${pre}-cupos`} etiqueta="Reservas por horario">
              <input
                id={`${pre}-cupos`}
                type="number"
                className="input"
                min={1}
                max={datos.opciones.maxCupos}
                step={1}
                // Vacío mientras se reescribe: con `Number('')` saltaba a 0 y no se podía borrar.
                value={Number.isNaN(a.cuposPorHorario) ? '' : a.cuposPorHorario}
                disabled={ro}
                onChange={(e) => cambiar({ cuposPorHorario: e.target.value === '' ? NaN : Number(e.target.value) })}
              />
            </Campo>
            <Campo id={`${pre}-dias`} etiqueta="Días hacia adelante">
              <input
                id={`${pre}-dias`}
                type="number"
                className="input"
                min={1}
                max={datos.opciones.maxDias}
                step={1}
                value={Number.isNaN(a.diasHaciaAdelante) ? '' : a.diasHaciaAdelante}
                disabled={ro}
                onChange={(e) => cambiar({ diasHaciaAdelante: e.target.value === '' ? NaN : Number(e.target.value) })}
              />
            </Campo>
            <Campo id={`${pre}-antelacion`} etiqueta="Antelación mínima">
              <select
                id={`${pre}-antelacion`}
                className="input"
                value={a.antelacionMin}
                disabled={ro}
                onChange={(e) => cambiar({ antelacionMin: Number(e.target.value) })}
              >
                {datos.opciones.antelaciones.map((n) => (
                  <option key={n} value={n}>
                    {antelacionLegible(n)}
                  </option>
                ))}
              </select>
            </Campo>
          </div>

          <div>
            <span className="label">Días y horario</span>
            <p className="m-0 mb-2 text-[11px] text-mute">
              De aquí salen las horas que ve quien reserva. Un día sin marcar no se ofrece. Hora de Bogotá.
            </p>
            <div className="flex flex-col gap-2">
              {DIAS.map(({ d, nombre: dia }) => {
                const t = tramos[d];
                return (
                  <div key={d} className="flex flex-wrap items-center gap-2">
                    <label className="flex w-28 shrink-0 cursor-pointer items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        className="accent-brand"
                        disabled={ro}
                        checked={!!t}
                        onChange={(e) =>
                          setTramos((x) => ({ ...x, [d]: e.target.checked ? { desde: '09:00', hasta: '18:00' } : null }))
                        }
                      />
                      {dia}
                    </label>
                    {t ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="time"
                          className="input w-28"
                          aria-label={`${dia}, abre`}
                          disabled={ro}
                          value={t.desde}
                          onChange={(e) => setTramos((x) => ({ ...x, [d]: { ...t, desde: e.target.value } }))}
                        />
                        <span className="text-sm text-mute">a</span>
                        <input
                          type="time"
                          className="input w-28"
                          aria-label={`${dia}, cierra`}
                          disabled={ro}
                          value={t.hasta}
                          onChange={(e) => setTramos((x) => ({ ...x, [d]: { ...t, hasta: e.target.value } }))}
                        />
                      </div>
                    ) : (
                      <span className="text-xs text-mute">No se ofrece</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <span className="label">Fechas bloqueadas</span>
            <p className="m-0 mb-2 text-[11px] text-mute">Festivos o días en que no se atiende aunque el horario diga que sí.</p>
            {!ro && (
              <div className="mb-2 flex gap-2">
                <input
                  type="date"
                  className="input w-auto"
                  value={nuevaFecha}
                  aria-label="Fecha que se bloquea"
                  onChange={(e) => setNuevaFecha(e.target.value)}
                />
                <button type="button" className="btn-ghost text-sm" disabled={!nuevaFecha} onClick={bloquear}>
                  Bloquear
                </button>
              </div>
            )}
            {a.fechasBloqueadas.length === 0 ? (
              <p className="m-0 text-xs text-mute">Ninguna.</p>
            ) : (
              <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                {a.fechasBloqueadas.map((f) => (
                  <li key={f} className="flex items-center gap-1 rounded-pill bg-bg2 px-2.5 py-1 text-xs text-ink">
                    <span className="capitalize">{fechaLegible(f)}</span>
                    {!ro && (
                      <button
                        type="button"
                        className="text-mute hover:text-bad-ink"
                        aria-label={`Desbloquear ${f}`}
                        onClick={() => cambiar({ fechasBloqueadas: a.fechasBloqueadas.filter((x) => x !== f) })}
                      >
                        ✕
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {!ro && !diasValidos && (
        <p className="m-0 text-xs text-bad-ink">Los días hacia adelante van de 1 a {datos.opciones.maxDias}.</p>
      )}
      {!ro && !cuposValidos && (
        <p className="m-0 text-xs text-bad-ink">Las reservas por horario van de 1 a {datos.opciones.maxCupos}.</p>
      )}
      {!ro && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="text-xs text-bad-ink underline" onClick={() => void borrar()}>
            Eliminar agenda
          </button>
          <button
            type="button"
            className="btn-primary text-sm disabled:opacity-50"
            disabled={guardando || !diasValidos || !cuposValidos || !nombre.trim()}
            onClick={() => void guardar()}
          >
            {guardando ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      )}
    </div>
  );
}

function Campo({ id, etiqueta, ayuda, children }: { id: string; etiqueta: string; ayuda?: string; children: ReactNode }) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {etiqueta}
      </label>
      {children}
      {ayuda && <p className="m-0 mt-1 text-[11px] text-mute">{ayuda}</p>}
    </div>
  );
}
