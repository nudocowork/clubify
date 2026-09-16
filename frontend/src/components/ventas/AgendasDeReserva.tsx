'use client';

/**
 * «Agendas de reserva del equipo» (Configuración): las agendas públicas del
 * equipo, «+ Nueva agenda», y en cada una «Abrir» y «Configurar».
 *
 * Es la sección de TeamClubify. Cada agenda es un enlace distinto con su propio
 * horario, formulario y ajustes, y lo que se reserva en cualquiera entra al Banco
 * del mismo equipo. «Configurar» abre `AjustesDeLaAgenda` debajo de su fila.
 *
 * Props: `teamId` (el id del equipo). Carga lo suyo con
 * `GET /sales-teams/:teamId/agendas` y no depende de la pantalla que la monta.
 *
 * La ve cualquiera del equipo; crear y cambiar es del líder o un admin de la
 * marca (lo decide el servidor: `puedeConfigurar`). Colores por tokens; el color
 * de cada agenda es un dato suyo y va en línea, como el del equipo.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { useBaseDeEquipos } from '@/components/ventas/rutas-de-equipos';
import {
  AjustesDeLaAgenda,
  enlaceTecleado,
  type Agenda,
  type DatosDeAgendas,
} from '@/components/ventas/AjustesDeLaAgenda';

export function AgendasDeReserva({ teamId }: { teamId: string }) {
  const rutaEquipos = useBaseDeEquipos();
  const [datos, setDatos] = useState<DatosDeAgendas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(async () => {
    if (!teamId) return;
    try {
      setDatos(await api<DatosDeAgendas>(`/sales-teams/${teamId}/agendas`));
      setError(null);
    } catch (e: unknown) {
      setError((e as { message?: string } | null)?.message || 'No se pudieron cargar las agendas de reserva');
    }
  }, [teamId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <section className="card card-pad">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-sm font-semibold text-ink">Agendas de reserva del equipo</h2>
          <p className="m-0 mt-0.5 text-xs text-mute">
            Cada agenda es un enlace público distinto, con su propio horario y formulario. Lo que se reserve en
            cualquiera entra al banco de este equipo.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Link href={`${rutaEquipos}/${teamId}/formularios`} className="text-sm font-semibold text-brand hover:underline">
            Formularios →
          </Link>
          {datos?.puedeConfigurar && !creando && (
            <button type="button" onClick={() => setCreando(true)} className="btn-primary text-sm">
              + Nueva agenda
            </button>
          )}
        </div>
      </div>

      {error && !datos && <p className="m-0 mt-3 text-sm text-mute">{error}</p>}
      {!datos && !error && <div className="mt-3 h-16 animate-shimmer rounded bg-bg2" />}

      {datos && creando && (
        <NuevaAgenda
          teamId={teamId}
          onCancelar={() => setCreando(false)}
          onCreada={async (id) => {
            setCreando(false);
            await cargar();
            setAbierta(id);
          }}
        />
      )}

      {datos &&
        (datos.agendas.length === 0 ? (
          <p className="m-0 mt-3 text-sm text-mute">
            Todavía no hay ninguna agenda: sin una, nadie puede reservar solo.
            {datos.puedeConfigurar ? ' Crea la primera con «+ Nueva agenda».' : ''}
          </p>
        ) : (
          <ul className="m-0 mt-3 flex list-none flex-col divide-y divide-line2 p-0">
            {datos.agendas.map((a) => (
              <li key={a.id} className="py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full bg-mute2"
                    style={a.color ? { background: a.color } : undefined}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                      <span className="truncate">{a.nombre}</span>
                      {!a.activa && (
                        <span className="rounded-pill bg-bg2 px-1.5 py-0.5 text-[11px] font-normal text-mute">Inactiva</span>
                      )}
                    </p>
                    <p className="m-0 truncate text-xs text-mute">
                      /agenda/{a.slug} · {a.ajustes.duracionMin} min · {a.horario ?? 'sin horario'}
                    </p>
                  </div>
                  <a href={`/agenda/${a.slug}`} target="_blank" rel="noreferrer" className="btn-ghost text-sm">
                    Abrir
                  </a>
                  <button
                    type="button"
                    onClick={() => setAbierta(abierta === a.id ? null : a.id)}
                    className="btn-ghost text-sm"
                    aria-expanded={abierta === a.id}
                  >
                    Configurar
                  </button>
                </div>
                {abierta === a.id && (
                  <AjustesDeLaAgenda
                    // Se vuelve a montar con lo que devuelve el servidor tras guardar.
                    key={JSON.stringify(a)}
                    teamId={teamId}
                    agenda={a}
                    datos={datos}
                    onGuardada={cargar}
                    onBorrada={async () => {
                      setAbierta(null);
                      await cargar();
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}

/** «+ Nueva agenda»: nombre y enlace. El resto se ajusta después en «Configurar». */
function NuevaAgenda({
  teamId,
  onCancelar,
  onCreada,
}: {
  teamId: string;
  onCancelar: () => void;
  onCreada: (id: string) => void | Promise<void>;
}) {
  const [nombre, setNombre] = useState('');
  const [enlace, setEnlace] = useState('');
  // Mientras no se toque, el enlace sigue al nombre; en cuanto se escribe, manda lo escrito.
  const [enlaceEscrito, setEnlaceEscrito] = useState(false);
  const [guardando, setGuardando] = useState(false);

  async function crear() {
    if (!nombre.trim()) return;
    setGuardando(true);
    try {
      const creada = await api<Agenda>(`/sales-teams/${teamId}/agendas`, {
        method: 'POST',
        body: JSON.stringify({ nombre: nombre.trim(), slug: enlace.replace(/^-+|-+$/g, '') || null }),
      });
      toast('Agenda creada. Revisa su horario y su formulario.', 'success');
      await onCreada(creada.id);
    } catch (e: unknown) {
      toast((e as { message?: string } | null)?.message || 'No se pudo crear la agenda', 'error');
      setGuardando(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-line p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="nueva-agenda-nombre">
            Nombre de la agenda
          </label>
          <input
            id="nueva-agenda-nombre"
            className="input"
            value={nombre}
            maxLength={80}
            autoFocus
            placeholder="Agenda Instagram"
            onChange={(e) => {
              setNombre(e.target.value);
              if (!enlaceEscrito) setEnlace(enlaceTecleado(e.target.value).replace(/^-+|-+$/g, ''));
            }}
          />
        </div>
        <div>
          <label className="label" htmlFor="nueva-agenda-enlace">
            Enlace
          </label>
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-xs text-mute">/agenda/</span>
            <input
              id="nueva-agenda-enlace"
              className="input font-mono"
              value={enlace}
              maxLength={60}
              placeholder="agenda-instagram"
              onChange={(e) => {
                setEnlaceEscrito(true);
                setEnlace(enlaceTecleado(e.target.value));
              }}
            />
          </div>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancelar} className="btn-ghost text-sm">
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => void crear()}
          disabled={guardando || !nombre.trim()}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {guardando ? 'Creando…' : 'Crear agenda'}
        </button>
      </div>
    </div>
  );
}
