'use client';

/**
 * «Cómo se ve y cuándo se reserva»: los ajustes de la agenda pública del equipo
 * (título, subtítulo, duración, días hacia adelante, antelación mínima, fechas
 * bloqueadas y «Volver al sitio»).
 *
 * Es la tarjeta «Evento» + «Disponibilidad» de TeamClubify. El horario por día
 * vive en «¿Cuándo atiende el equipo?», el formulario en «Formularios», y el
 * enlace no se cambia una vez repartido.
 *
 * Cambiarlos es del líder o un admin de la marca. Colores por tokens: bajo
 * `.brand-panel` / `.brand-auth` la marca pone los suyos.
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type Ajustes = {
  titulo: string | null;
  subtitulo: string | null;
  duracionMin: number;
  diasHaciaAdelante: number;
  antelacionMin: number;
  fechasBloqueadas: string[];
  volverAlSitio: string | null;
  redirigirEnSegundos: number;
};

type Datos = {
  puedeConfigurar: boolean;
  nombreDelEquipo: string;
  ajustes: Ajustes;
  opciones: { duraciones: number[]; antelaciones: number[]; maxDias: number; redirecciones: number[] };
};

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

export function AjustesDeLaAgenda({ teamId }: { teamId: string }) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [a, setA] = useState<Ajustes | null>(null);
  const [nuevaFecha, setNuevaFecha] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    api<Datos>(`/sales-teams/${teamId}/agenda/ajustes`)
      .then((d) => {
        if (!vivo) return;
        setDatos(d);
        setA(d.ajustes);
      })
      .catch((e: any) => toast(e?.message || 'No se pudieron cargar los ajustes de la agenda', 'error'));
    return () => {
      vivo = false;
    };
  }, [teamId]);

  if (!datos || !a) return null;
  const ro = !datos.puedeConfigurar;
  const cambiar = (p: Partial<Ajustes>) => setA((x) => (x ? { ...x, ...p } : x));
  const diasValidos =
    Number.isInteger(a.diasHaciaAdelante) && a.diasHaciaAdelante >= 1 && a.diasHaciaAdelante <= datos.opciones.maxDias;

  function bloquear() {
    if (!a || !nuevaFecha) return;
    if (!a.fechasBloqueadas.includes(nuevaFecha)) cambiar({ fechasBloqueadas: [...a.fechasBloqueadas, nuevaFecha].sort() });
    setNuevaFecha('');
  }

  async function guardar() {
    if (!a) return;
    setGuardando(true);
    try {
      await api(`/sales-teams/${teamId}/agenda/ajustes`, {
        method: 'PUT',
        body: JSON.stringify({
          ...a,
          titulo: a.titulo?.trim() || null,
          subtitulo: a.subtitulo?.trim() || null,
          volverAlSitio: a.volverAlSitio?.trim() || null,
        }),
      });
    } catch (e: any) {
      toast(e?.message || 'No se pudieron guardar los ajustes', 'error');
      setGuardando(false);
      return;
    }
    toast('Ajustes de la agenda guardados.', 'success');
    // Se relee lo que quedó (el servidor limpia y ordena). Si falla, lo guardado
    // ya entró: no se avisa como si no.
    try {
      const d = await api<Datos>(`/sales-teams/${teamId}/agenda/ajustes`);
      setDatos(d);
      setA(d.ajustes);
    } catch {
      /* lo guardado ya entró */
    }
    setGuardando(false);
  }

  return (
    <section className="card card-pad mb-4">
      <h2 className="text-sm font-semibold mb-1">Cómo se ve y cuándo se reserva</h2>
      <p className="text-xs text-mute mb-3">
        Lo que ve el prospecto al abrir el enlace, y con cuánta antelación puede reservar.
        {ro && ' Los cambia el líder del equipo o un admin de la marca.'}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="agenda-titulo">Título</label>
          <input
            id="agenda-titulo"
            className="input"
            value={a.titulo ?? ''}
            placeholder="Agenda una cita"
            maxLength={80}
            disabled={ro}
            onChange={(e) => cambiar({ titulo: e.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="agenda-subtitulo">Subtítulo</label>
          <input
            id="agenda-subtitulo"
            className="input"
            value={a.subtitulo ?? ''}
            placeholder={`con ${datos.nombreDelEquipo}`}
            maxLength={200}
            disabled={ro}
            onChange={(e) => cambiar({ subtitulo: e.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="agenda-duracion">Duración de la cita</label>
          <select
            id="agenda-duracion"
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
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="agenda-dias">Días hacia adelante</label>
            <input
              id="agenda-dias"
              type="number"
              className="input"
              min={1}
              max={datos.opciones.maxDias}
              step={1}
              // Vacío mientras se reescribe: con `Number('')` el campo saltaba a 0 y
              // no se podía borrar (Fable, 2026-09-15).
              value={Number.isNaN(a.diasHaciaAdelante) ? '' : a.diasHaciaAdelante}
              disabled={ro}
              onChange={(e) => cambiar({ diasHaciaAdelante: e.target.value === '' ? NaN : Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="label" htmlFor="agenda-antelacion">Antelación mínima</label>
            <select
              id="agenda-antelacion"
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
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="agenda-volver">Volver al sitio (opcional)</label>
          <input
            id="agenda-volver"
            type="url"
            className="input"
            value={a.volverAlSitio ?? ''}
            placeholder="https://tusitio.com"
            maxLength={300}
            disabled={ro}
            onChange={(e) => cambiar({ volverAlSitio: e.target.value })}
          />
          <p className="m-0 mt-1 text-[11px] text-mute">Tras reservar, un enlace para volver a tu página.</p>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="agenda-redireccion">Llevar solo a ese sitio</label>
          <select
            id="agenda-redireccion"
            className="input"
            value={a.redirigirEnSegundos}
            // Sin sitio al que volver no hay a dónde llevar a nadie.
            disabled={ro || !a.volverAlSitio?.trim()}
            onChange={(e) => cambiar({ redirigirEnSegundos: Number(e.target.value) })}
          >
            {/* Con un backend anterior no viene la lista: mejor sin opciones que roto. */}
            {(datos.opciones.redirecciones ?? [0]).map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'No, solo el enlace' : `Sí, a los ${n} segundos`}
              </option>
            ))}
          </select>
          <p className="m-0 mt-1 text-[11px] text-mute">
            Con la cita ya reservada, la página lleva sola a tu sitio pasado ese tiempo. Quien quiera, puede ir antes.
          </p>
        </div>
        <div className="sm:col-span-2">
          <span className="label">Fechas bloqueadas</span>
          <p className="m-0 mb-2 text-[11px] text-mute">Festivos o días en que el equipo no atiende aunque el horario diga que sí.</p>
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
      </div>

      {!ro && !diasValidos && (
        <p className="m-0 mt-3 text-xs text-bad-ink">Los días hacia adelante van de 1 a {datos.opciones.maxDias}.</p>
      )}
      {!ro && (
        <button type="button" className="btn mt-4" disabled={guardando || !diasValidos} onClick={() => void guardar()}>
          {guardando ? 'Guardando…' : 'Guardar ajustes'}
        </button>
      )}
    </section>
  );
}
