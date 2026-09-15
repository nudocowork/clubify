'use client';

/**
 * «Seguimientos» del equipo: la lista de trabajo del día, por grupos.
 *
 * Era una tabla plana con un filtro de estado y ninguna forma de registrar qué
 * pasó. En TeamClubify se trabaja por grupos —vencidos, para hoy, programados—
 * y cada paso se cierra con un RESULTADO que decide lo siguiente. Es lo que se
 * pidió y lo que hace esta pantalla.
 *
 * «Abrir chat» lleva a la ficha del lead en el CRM, que ya tiene la
 * conversación: una segunda ventana de chat aquí sería otra copia que mantener.
 *
 * Colores por tokens: bajo `.brand-panel` la marca pone los suyos.
 */

import Link from 'next/link';
import { useBaseDeEquipos } from '@/components/ventas/rutas-de-equipos';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { CabeceraDeEquipo } from '@/components/ventas/CabeceraDeEquipo';

type Item = {
  id: string;
  dueAt: string;
  channel: string | null;
  note: string | null;
  outcome: string | null;
  doneAt: string | null;
  paso: number;
  intento: number;
  closer: string | null;
  lead: { id: string; nombre: string | null; empresa: string | null; telefono: string | null } | null;
};

type Respuesta = {
  team: { id: string; name: string };
  puedeEscribir: boolean;
  puedeBorrar: boolean;
  estado: 'pendientes' | 'hechos';
  grupos?: { vencidos: Item[]; hoy: Item[]; programados: Item[] };
  /** Hay más de 300: la lista enseña los primeros. */
  truncado?: boolean;
  hechos?: Item[];
};

const RESULTADOS = [
  { key: 'compro', label: 'Compró', emoji: '🎉' },
  { key: 'continuar', label: 'Respondió y desea continuar', emoji: '➡️' },
  { key: 'mas_tiempo', label: 'Pidió más tiempo', emoji: '⏳' },
  { key: 'no_respondio', label: 'No respondió', emoji: '📵' },
  { key: 'no_calificado', label: 'Lead no calificado', emoji: '🚷' },
] as const;
type Resultado = (typeof RESULTADOS)[number]['key'];

const etiquetaDe = (k: string | null) => RESULTADOS.find((r) => r.key === k)?.label ?? '—';

/** «15 sep · 09:30» en hora de Bogotá, pase lo que pase en el navegador. */
const cuando = (iso: string) =>
  new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

/** Hoy en Bogotá, YYYY-MM-DD, para el mínimo del selector de fecha. */
const hoyBogota = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());

export function SeguimientosDelEquipo() {
  const rutaEquipos = useBaseDeEquipos();
  const params = useParams<{ id: string }>();
  const teamId = params?.id ?? '';
  const [estado, setEstado] = useState<'pendientes' | 'hechos'>('pendientes');
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cerrando, setCerrando] = useState<Item | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);
  const secuencia = useRef(0);

  const cargar = useCallback(async () => {
    if (!teamId) return;
    const esta = ++secuencia.current;
    try {
      const r = await api<Respuesta>(`/sales-teams/${teamId}/seguimientos/agrupados?estado=${estado}`);
      if (esta !== secuencia.current) return;
      setDatos(r);
      setError(null);
    } catch (e: any) {
      if (esta !== secuencia.current) return;
      setError(
        e?.status === 404
          ? 'Este equipo no existe, o el módulo «Equipos de ventas» está apagado para esta marca.'
          : e?.message || 'No se pudieron cargar los seguimientos',
      );
    }
  }, [teamId, estado]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function eliminar(it: Item) {
    if (
      !confirm(
        `Se eliminará el paso ${it.paso} (${cuando(it.dueAt)}) de ${it.lead?.nombre ?? 'este lead'}.\n\n` +
          'El contacto queda sin próximo seguimiento hasta que alguien registre un resultado. No se puede deshacer.',
      )
    )
      return;
    setBorrando(it.id);
    try {
      await api(`/sales-teams/${teamId}/seguimientos/${it.id}`, { method: 'DELETE' });
      toast('Seguimiento eliminado.', 'success');
      void cargar();
    } catch (e: any) {
      toast(e?.message || 'No se pudo eliminar', 'error');
    } finally {
      setBorrando(null);
    }
  }

  if (error) {
    return (
      <div className="card card-pad text-center py-12">
        <div className="text-3xl mb-2">⚠️</div>
        <div className="font-semibold mb-1">No se pudo cargar</div>
        <div className="text-sm text-mute mb-4">{error}</div>
        <Link href={rutaEquipos} className="btn-ghost text-sm inline-flex">
          Volver a los equipos
        </Link>
      </div>
    );
  }

  const grupos = datos?.grupos;
  const total = grupos ? grupos.vencidos.length + grupos.hoy.length + grupos.programados.length : 0;

  return (
    <div className="flex flex-col gap-4">
      {datos && <CabeceraDeEquipo equipo={datos.team} soloLectura={!datos.puedeEscribir} />}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-semibold">Seguimientos</div>
          <p className="mt-0.5 text-xs text-mute">A quién hay que volver a escribir, y qué pasó cuando se le escribió.</p>
        </div>
        <div className="flex items-center gap-1 rounded-pill bg-bg2 p-1" role="tablist">
          {(['pendientes', 'hechos'] as const).map((e) => (
            <button
              key={e}
              role="tab"
              aria-selected={estado === e}
              onClick={() => setEstado(e)}
              className={`rounded-pill px-3.5 py-1.5 text-sm font-semibold transition ${
                estado === e ? 'bg-white text-ink shadow-sm' : 'text-mute hover:text-ink'
              }`}
            >
              {e === 'pendientes' ? 'Pendientes' : 'Hechos'}
            </button>
          ))}
        </div>
      </div>

      {!datos ? (
        <div className="h-32 rounded bg-bg2 animate-shimmer" />
      ) : estado === 'pendientes' ? (
        total === 0 ? (
          <div className="card card-pad py-10 text-center">
            <p className="text-sm font-medium text-ink">Este equipo no tiene seguimientos pendientes</p>
            <p className="mt-1 text-sm text-mute">
              Los pasos se crean al registrar un resultado, o al marcar que alguien no asistió a su cita.
            </p>
          </div>
        ) : (
          <>
            {datos?.truncado && (
              <p className="mt-0 mb-3 text-xs text-mute">
                Se muestran los primeros 300 pasos. Cierra o reprograma los vencidos para ver el resto.
              </p>
            )}
            <Grupo titulo="Vencidos" tono="text-bad-ink" items={grupos!.vencidos} vencido datos={datos} teamId={teamId} borrando={borrando} onResultado={setCerrando} onEliminar={eliminar} />
            <Grupo titulo="Para hoy" tono="text-warn-ink" items={grupos!.hoy} datos={datos} teamId={teamId} borrando={borrando} onResultado={setCerrando} onEliminar={eliminar} />
            <Grupo titulo="Programados" tono="text-mute" items={grupos!.programados} datos={datos} teamId={teamId} borrando={borrando} onResultado={setCerrando} onEliminar={eliminar} />
          </>
        )
      ) : !datos.hechos?.length ? (
        <p className="card card-pad py-8 text-center text-sm text-mute">Todavía no hay seguimientos cerrados.</p>
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-bg2 text-left text-[11px] uppercase tracking-wider text-mute">
                <tr>
                  <th className="px-3 py-2 font-semibold">Cerrado</th>
                  <th className="px-3 py-2 font-semibold">Contacto</th>
                  <th className="px-3 py-2 font-semibold">Resultado</th>
                  <th className="px-3 py-2 font-semibold">Nota</th>
                </tr>
              </thead>
              <tbody>
                {datos.hechos.map((it) => (
                  <tr key={it.id} className="border-t border-line2">
                    <td className="px-3 py-2.5 whitespace-nowrap text-mute tabular-nums">{it.doneAt ? cuando(it.doneAt) : '—'}</td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-ink">{it.lead?.nombre ?? 'Sin nombre'}</div>
                      {it.lead?.empresa && <div className="text-xs text-mute">{it.lead.empresa}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-xs">{etiquetaDe(it.outcome)}</td>
                    <td className="px-3 py-2.5 text-xs text-mute">{it.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {cerrando && (
        <RegistrarResultado
          teamId={teamId}
          item={cerrando}
          onCerrar={() => setCerrando(null)}
          onGuardado={() => {
            setCerrando(null);
            void cargar();
          }}
        />
      )}
    </div>
  );
}

function Grupo({
  titulo,
  tono,
  items,
  vencido = false,
  datos,
  teamId,
  borrando,
  onResultado,
  onEliminar,
}: {
  titulo: string;
  tono: string;
  items: Item[];
  vencido?: boolean;
  datos: Respuesta;
  teamId: string;
  borrando: string | null;
  onResultado: (it: Item) => void;
  onEliminar: (it: Item) => void;
}) {
  const rutaEquipos = useBaseDeEquipos();
  if (!items.length) return null;
  const pasoDe = (it: Item) =>
    `Paso ${it.paso}${it.channel ? ` · ${it.channel}` : ''}${it.intento > 1 ? ` · intento ${it.intento}` : ''}`;
  return (
    <section>
      <h2 className={`mb-2 text-xs font-semibold uppercase tracking-wide ${tono}`}>
        {titulo} · {items.length}
      </h2>
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg2 text-left text-[11px] uppercase tracking-wide text-mute">
              <tr>
                <th className="px-3 py-2 font-semibold">Contacto</th>
                <th className="hidden px-3 py-2 font-semibold md:table-cell">Paso</th>
                <th className="px-3 py-2 font-semibold">Cuándo</th>
                <th className="hidden px-3 py-2 font-semibold sm:table-cell">Closer</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t border-line2">
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-ink">{it.lead?.nombre ?? 'Sin nombre'}</div>
                    {it.lead?.empresa && <div className="text-xs text-mute">{it.lead.empresa}</div>}
                    {/* En el teléfono Paso y Closer se esconden: su dato va aquí. */}
                    <div className="text-xs text-mute md:hidden">
                      {pasoDe(it)}
                      <span className="sm:hidden"> · {it.closer ?? 'Sin asignar'}</span>
                    </div>
                  </td>
                  <td className="hidden px-3 py-2.5 text-mute md:table-cell">
                    {pasoDe(it)}
                    {it.note && <div className="text-xs text-mute">{it.note}</div>}
                  </td>
                  <td className={`px-3 py-2.5 tabular-nums whitespace-nowrap ${vencido ? 'font-semibold text-bad-ink' : 'text-mute'}`}>
                    {cuando(it.dueAt)}
                  </td>
                  <td className="hidden px-3 py-2.5 text-mute sm:table-cell">{it.closer ?? 'Sin asignar'}</td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex flex-col items-end gap-1.5 sm:flex-row sm:justify-end">
                      {it.lead && (
                        <Link href={`${rutaEquipos}/${teamId}/board?lead=${it.lead.id}`} className="btn-ghost px-2.5 py-1 text-xs">
                          Abrir chat
                        </Link>
                      )}
                      {datos.puedeEscribir && (
                        <button onClick={() => onResultado(it)} className="btn-primary px-2.5 py-1 text-xs">
                          Resultado
                        </button>
                      )}
                      {datos.puedeBorrar && (
                        <button
                          onClick={() => onEliminar(it)}
                          disabled={borrando === it.id}
                          aria-busy={borrando === it.id}
                          className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-bad-ink hover:bg-bad-soft disabled:opacity-50"
                        >
                          {borrando === it.id ? 'Eliminando…' : 'Eliminar'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/**
 * Cerrar un paso con su resultado. Cada resultado pide lo suyo: fecha del
 * próximo paso para «continuar» y «más tiempo», motivo para «no calificado».
 * La regla la valida el servidor; aquí solo se pide lo que hace falta.
 */
function RegistrarResultado({
  teamId,
  item,
  onCerrar,
  onGuardado,
}: {
  teamId: string;
  item: Item;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [fecha, setFecha] = useState('');
  const [hora, setHora] = useState('09:00');
  const [motivo, setMotivo] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  const pideFecha = resultado === 'continuar' || resultado === 'mas_tiempo' || resultado === 'no_respondio';
  const fechaObligatoria = resultado === 'continuar' || resultado === 'mas_tiempo';

  async function guardar() {
    if (!resultado) return;
    if (fechaObligatoria && !fecha) {
      toast('Elige la fecha del próximo paso', 'error');
      return;
    }
    if (resultado === 'no_calificado' && !motivo.trim()) {
      toast('Escribe el motivo', 'error');
      return;
    }
    setGuardando(true);
    try {
      await api(`/sales-teams/${teamId}/seguimientos/${item.id}/resultado`, {
        method: 'PATCH',
        body: JSON.stringify({
          outcome: resultado,
          // La fecha y la hora que se ven son de Bogotá: se envían como ese instante.
          proximaFecha: pideFecha && fecha ? new Date(`${fecha}T${hora || '09:00'}:00-05:00`).toISOString() : null,
          motivo: resultado === 'no_calificado' ? motivo.trim() : null,
          nota: nota.trim() || null,
        }),
      });
      toast('Resultado guardado.', 'success');
      onGuardado();
    } catch (e: any) {
      toast(e?.message || 'No se pudo guardar el resultado', 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/50" onClick={onCerrar} />
      <div className="relative w-full max-w-md card card-pad">
        <h3 className="m-0 text-base font-semibold text-ink">¿Qué pasó con {item.lead?.nombre ?? 'este lead'}?</h3>
        <p className="mt-0.5 text-xs text-mute">
          Paso {item.paso}
          {item.intento > 1 ? ` · intento ${item.intento}` : ''} · {cuando(item.dueAt)}
        </p>

        <div className="mt-3 flex flex-col gap-1.5">
          {RESULTADOS.map((r) => (
            <button
              key={r.key}
              onClick={() => setResultado(r.key)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-medium transition ${
                resultado === r.key ? 'border-brand bg-brand-soft text-ink' : 'border-line text-mute hover:bg-bg2'
              }`}
            >
              <span aria-hidden>{r.emoji}</span> {r.label}
            </button>
          ))}
        </div>

        {pideFecha && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <label className="label">Próximo paso {fechaObligatoria ? '' : '(opcional)'}</label>
              <input type="date" value={fecha} min={hoyBogota()} onChange={(e) => setFecha(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">Hora</label>
              <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className="input" />
            </div>
            {resultado === 'mas_tiempo' && (
              <p className="col-span-2 text-[11px] text-mute">
                Hasta esa fecha el lead no aparece en la lista del día; vuelve solo.
              </p>
            )}
            {resultado === 'no_respondio' && !fecha && (
              <p className="col-span-2 text-[11px] text-mute">
                Si no eliges fecha, se reprograma solo a las 9:00: a los 3 días, luego a los 7 y después cada 14.
              </p>
            )}
          </div>
        )}

        {resultado === 'no_calificado' && (
          <div className="mt-3">
            <label className="label">Motivo</label>
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Sin presupuesto, no es el perfil…" className="input" maxLength={200} />
          </div>
        )}

        {resultado && (
          <div className="mt-3">
            <label className="label">Observación {resultado === 'no_respondio' ? '(opcional)' : ''}</label>
            <textarea value={nota} onChange={(e) => setNota(e.target.value)} className="input min-h-[60px]" maxLength={2000} />
          </div>
        )}

        {resultado === 'compro' && (
          <p className="mt-3 rounded-lg bg-ok-soft px-3 py-2 text-xs text-ok-ink">
            El lead pasa a Clientes y arranca su implementación.
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCerrar} className="btn-ghost text-sm">
            Cancelar
          </button>
          <button onClick={() => void guardar()} disabled={guardando || !resultado} className="btn-primary text-sm disabled:opacity-50">
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}
