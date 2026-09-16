'use client';

/**
 * «Banco» del equipo: la cola de CITAS antes de la llamada.
 *
 * Antes esta pestaña era la lista de leads sin vendedor. En TeamClubify el banco
 * es otra cosa, y es la que se pidió: el sitio donde quien coordina reparte las
 * citas entre los closers y persigue que el cliente confirme. Por eso aquí manda
 * la cita (`SalesMeeting`), no el lead.
 *
 * Qué enseña, en el orden en que se mira:
 *  1. La alerta de citas que empiezan en ≤10 min y nadie tiene asignadas.
 *  2. La carga de cada closer hoy y en la semana, con el sugerido marcado.
 *  3. Las pestañas: por asignar · por confirmar · seguimiento · no asistió ·
 *     canceladas · ganadas · perdidas.
 *
 * El semáforo de confirmación y el orden de la cola los calcula el SERVIDOR: si
 * los calculara la pantalla, dos personas con el reloj del móvil desfasado
 * verían colas distintas.
 *
 * Colores por tokens: bajo `.brand-panel` Sellea pone su coral sin tocar esto.
 */

import Link from 'next/link';
import { useBaseDeEquipos } from '@/components/ventas/rutas-de-equipos';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { CabeceraDeEquipo } from '@/components/ventas/CabeceraDeEquipo';
import { BotonDeWhatsapp } from '@/components/ventas/BotonDeWhatsapp';

type EstadoDeVentana = 'confirmada' | 'vencida' | 'pendiente';

type Cita = {
  id: string;
  startAt: string;
  durationMin: number;
  status: string;
  hostUserId: string | null;
  host: { id: string; nombre: string } | null;
  conf1h: boolean;
  conf30min: boolean;
  confirmada: boolean;
  confirmacion: { h1: EstadoDeVentana; m30: EstadoDeVentana; hayQuePerseguir: boolean };
  minutosParaEmpezar: number;
  lead: {
    id: string;
    nombre: string | null;
    empresa: string | null;
    telefono: string | null;
    email: string | null;
    origen: string | null;
    instagram?: string | null;
  } | null;
  /** «Pregunta: respuesta» del formulario de la agenda, si el equipo las enseña. */
  respuestas: string[] | null;
  /** Puntaje del formulario de la cita («Lead Score»), si el equipo lo enseña. */
  puntaje?: number | null;
  /** El siguiente seguimiento pendiente del lead: «Próxima acción» y «Nota de seguimiento». */
  proximoPaso?: { cuando: string; canal: string | null; nota: string | null } | null;
  /** Enlace de Google Meet de la cita (calendario del equipo conectado), para {{sala}}. */
  sala?: string | null;
};

type LeadDelBanco = {
  id: string;
  nombre: string | null;
  empresa: string | null;
  valor: number | null;
  proximoSeguimiento: string | null;
};

type Banco = {
  team: { id: string; name: string };
  puedeEscribir: boolean;
  puedeAsignar: boolean;
  closers: { id: string; nombre: string }[];
  carga: { id: string; nombre: string; hoy: number; semana: number }[];
  sugerido: string | null;
  sinAsignarPronto: Cita[];
  por_asignar: Cita[];
  por_confirmar: Cita[];
  no_show: Cita[];
  canceladas: Cita[];
  seguimiento: LeadDelBanco[];
  ganadas: LeadDelBanco[];
  perdidas: LeadDelBanco[];
  /** Totales reales: las listas se cortan en 500, los contadores no. */
  totales: { seguimiento: number; ganadas: number; perdidas: number };
  /** «Configuración» del equipo: nombres de las pestañas, datos de la ficha y mensaje de WhatsApp. */
  etiquetas: Record<string, string>;
  campos: string[];
  mensajeWhatsapp: string;
  /** Quien usa la pantalla: firma el WhatsApp. */
  yo?: { nombre: string | null };
};

const PESTANAS = [
  { key: 'por_asignar', etiqueta: 'Por asignar', icono: '📥' },
  { key: 'por_confirmar', etiqueta: 'Por confirmar', icono: '🕓' },
  { key: 'seguimiento', etiqueta: 'Seguimiento', icono: '🔁' },
  { key: 'no_show', etiqueta: 'No asistió', icono: '🚫' },
  { key: 'canceladas', etiqueta: 'Canceladas', icono: '✖️' },
  { key: 'ganadas', etiqueta: 'Ganadas', icono: '🏆' },
  { key: 'perdidas', etiqueta: 'Perdidas', icono: '💔' },
] as const;
type Pestana = (typeof PESTANAS)[number]['key'];

const ESTADO_DE_CITA: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  CONFIRMADA: 'Confirmada',
  REALIZADA: 'Realizada',
  NO_ASISTIO: 'No asistió',
  CANCELADA: 'Cancelada',
};

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-CO', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  });
const dia = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CO', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'America/Bogota',
  });

/** «en 25 min», «en 2 h 10», «hace 5 min». */
function faltan(min: number): string {
  if (!Number.isFinite(min)) return '—';
  const a = Math.abs(min);
  const h = Math.floor(a / 60);
  const t = h > 0 ? `${h} h ${a % 60}` : `${a} min`;
  return min < 0 ? `hace ${t}` : `en ${t}`;
}

const dinero = (n: number) =>
  '$' + n.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function BancoDelEquipo() {
  const rutaEquipos = useBaseDeEquipos();
  const params = useParams<{ id: string }>();
  const teamId = params?.id ?? '';
  const [banco, setBanco] = useState<Banco | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pestana, setPestana] = useState<Pestana>('por_asignar');
  const [ocupada, setOcupada] = useState<string | null>(null);
  /**
   * Cada carga lleva su número y solo pinta la última. Si el refresco de cada
   * minuto sale justo antes de una acción, su respuesta VIEJA podía llegar
   * después de la recarga de la acción y enseñar el estado anterior hasta el
   * minuto siguiente.
   */
  const secuencia = useRef(0);

  const cargar = useCallback(async () => {
    if (!teamId) return;
    const esta = ++secuencia.current;
    try {
      const b = await api<Banco>(`/sales-teams/${teamId}/banco`);
      if (esta !== secuencia.current) return;
      setBanco(b);
      setError(null);
    } catch (e: any) {
      if (esta !== secuencia.current) return;
      setError(
        e?.status === 404
          ? 'Este equipo no existe, o el módulo «Equipos de ventas» está apagado para esta marca.'
          : e?.message || 'No se pudo cargar el banco',
      );
    }
  }, [teamId]);

  useEffect(() => {
    void cargar();
    // El banco es una cola que cambia sola (alguien agenda, pasa la hora): se
    // refresca cada minuto para que «en 10 min» no se quede diciendo 10.
    const t = setInterval(() => void cargar(), 60_000);
    return () => clearInterval(t);
  }, [cargar]);

  /** Una acción sobre una cita: bloquea esa tarjeta, avisa si falla, recarga. */
  async function accion(citaId: string, ruta: string, body?: unknown) {
    setOcupada(citaId);
    try {
      await api(`/sales-teams/${teamId}/banco/citas/${citaId}/${ruta}`, {
        method: 'PATCH',
        body: JSON.stringify(body ?? {}),
      });
      await cargar();
    } catch (e: any) {
      toast(e?.message || 'No se pudo completar la acción', 'error');
    } finally {
      setOcupada(null);
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

  if (!banco) {
    return <div className="card card-pad text-sm text-mute text-center py-10">Cargando banco…</div>;
  }

  const cuenta: Record<Pestana, number> = {
    por_asignar: banco.por_asignar.length,
    por_confirmar: banco.por_confirmar.length,
    seguimiento: banco.totales.seguimiento,
    no_show: banco.no_show.length,
    canceladas: banco.canceladas.length,
    ganadas: banco.totales.ganadas,
    perdidas: banco.totales.perdidas,
  };
  const nombreDe = (id: string | null) => banco.closers.find((c) => c.id === id)?.nombre ?? null;

  return (
    <div className="flex flex-col gap-4">
      <CabeceraDeEquipo equipo={banco.team} soloLectura={!banco.puedeEscribir} />

      {/* Los accesos de la referencia: desde el Banco se llega a lo que decide
          cómo se ve (Configuración) y qué pregunta la agenda (Formularios). */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="m-0 flex-1 text-sm text-mute">
          Banco de agendamientos: reparte las citas y asegura que el cliente confirme antes de la llamada.
        </p>
        <Link href={`${rutaEquipos}/${teamId}/configuracion`} className="btn-ghost text-sm">
          ⚙ Configurar
        </Link>
        <Link href={`${rutaEquipos}/${teamId}/formularios`} className="btn-ghost text-sm">
          📝 Formularios
        </Link>
      </div>

      {banco.sinAsignarPronto.length > 0 && (
        <div className="rounded-card border border-bad/40 bg-bad-soft p-4" role="alert">
          <h3 className="mb-2 text-sm font-semibold text-bad-ink">
            🚨 Citas sin asignar a punto de empezar ({banco.sinAsignarPronto.length})
          </h3>
          <div className="flex flex-col gap-1.5">
            {banco.sinAsignarPronto.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-1.5 text-sm"
              >
                <span className="min-w-0 truncate font-medium text-ink">
                  {c.lead?.nombre ?? 'Lead'} · {hora(c.startAt)} · {faltan(c.minutosParaEmpezar)}
                </span>
                {banco.puedeAsignar && (
                  <button
                    onClick={() =>
                      banco.sugerido
                        ? void accion(c.id, 'asignar', { hostUserId: banco.sugerido })
                        : setPestana('por_asignar')
                    }
                    disabled={ocupada === c.id}
                    className="btn-primary text-xs shrink-0 disabled:opacity-50"
                  >
                    {ocupada === c.id ? 'Asignando…' : banco.sugerido ? 'Asignar ahora' : 'Elegir closer'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card card-pad">
        <h3 className="mb-3 text-sm font-semibold">Disponibilidad de closers</h3>
        {banco.carga.length === 0 ? (
          <p className="py-2 text-center text-sm text-mute">
            Este equipo no tiene closers activos. Añádelos en «Colaboradores».
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {banco.carga.map((c) => {
              const esSugerido = c.id === banco.sugerido;
              return (
                <div
                  key={c.id}
                  className={`rounded-lg border p-3 text-center ${
                    esSugerido ? 'border-brand bg-brand-soft' : 'border-line bg-white'
                  }`}
                >
                  <p className="truncate text-sm font-medium text-ink">
                    {c.nombre}{' '}
                    {esSugerido && <span className="text-[10px] text-brand">★ sugerido</span>}
                  </p>
                  <p className="mt-1 text-xs text-mute tabular-nums">
                    Hoy <b className="text-ink">{c.hoy}</b> · Semana <b className="text-ink">{c.semana}</b>
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div
        className="flex flex-wrap gap-1 rounded-lg border border-line bg-white p-1 text-sm"
        role="tablist"
        aria-label="Estado de las citas"
      >
        {PESTANAS.map((p) => (
          <button
            key={p.key}
            role="tab"
            aria-selected={pestana === p.key}
            onClick={() => setPestana(p.key)}
            className={`rounded-md px-2.5 py-1 transition-colors ${
              pestana === p.key ? 'bg-brand text-white' : 'text-mute hover:text-ink'
            }`}
          >
            {p.icono} {banco.etiquetas?.[p.key] || p.etiqueta}{' '}
            <span className={`tabular-nums ${pestana === p.key ? 'text-white/80' : 'text-mute'}`}>
              {cuenta[p.key]}
            </span>
          </button>
        ))}
      </div>

      {(pestana === 'por_asignar' || pestana === 'por_confirmar') && (
        <TarjetasDeCita
          filas={pestana === 'por_asignar' ? banco.por_asignar : banco.por_confirmar}
          modo={pestana}
          banco={banco}
          ocupada={ocupada}
          nombreDe={nombreDe}
          accion={accion}
        />
      )}

      {(pestana === 'no_show' || pestana === 'canceladas') && (
        <ListaSimpleDeCitas filas={pestana === 'no_show' ? banco.no_show : banco.canceladas} nombreDe={nombreDe} />
      )}

      {(pestana === 'seguimiento' || pestana === 'ganadas' || pestana === 'perdidas') && (
        <ListaDeLeadsDelBanco
          filas={
            pestana === 'seguimiento' ? banco.seguimiento : pestana === 'ganadas' ? banco.ganadas : banco.perdidas
          }
          teamId={teamId}
        />
      )}
    </div>
  );
}

function TarjetasDeCita({
  filas,
  modo,
  banco,
  ocupada,
  nombreDe,
  accion,
}: {
  filas: Cita[];
  modo: 'por_asignar' | 'por_confirmar';
  banco: Banco;
  ocupada: string | null;
  nombreDe: (id: string | null) => string | null;
  accion: (citaId: string, ruta: string, body?: unknown) => Promise<void>;
}) {
  if (!filas.length) {
    return <Vacio texto={modo === 'por_asignar' ? 'No hay citas por asignar. 🎉' : 'Nada por confirmar.'} />;
  }
  return (
    <div className="flex flex-col gap-2">
      {filas.map((c) => (
        <TarjetaDeCita
          key={c.id}
          c={c}
          modo={modo}
          banco={banco}
          ocupada={ocupada === c.id}
          nombreDe={nombreDe}
          accion={accion}
        />
      ))}
    </div>
  );
}

function TarjetaDeCita({
  c,
  modo,
  banco,
  ocupada,
  nombreDe,
  accion,
}: {
  c: Cita;
  modo: 'por_asignar' | 'por_confirmar';
  banco: Banco;
  ocupada: boolean;
  nombreDe: (id: string | null) => string | null;
  accion: (citaId: string, ruta: string, body?: unknown) => Promise<void>;
}) {
  const [abierta, setAbierta] = useState(false);
  const pronto = c.minutosParaEmpezar <= 10 && c.minutosParaEmpezar >= -5;
  const dos = c.conf1h && c.conf30min;
  // Sin «Configuración» guardada (o con un backend anterior), los de siempre.
  const campos = banco.campos?.length ? banco.campos : ['whatsapp', 'email', 'empresa', 'origen', 'closer', 'duracion'];

  /**
   * Tres estados y no dos: confirmado, todavía puede confirmar, y VENCIDO (se le
   * pidió y pasó la ventana sin respuesta) → tachado. Si «aún no confirma» y «ya
   * se le pasó» se vieran igual, no se sabría a quién perseguir.
   */
  // Función que devuelve JSX y no un componente: definido aquí dentro, React lo
  // veía como un componente NUEVO en cada render y desmontaba los botones (se
  // perdía el foco del teclado al marcar).
  const chip = (cual: '1h' | '30min') => {
    const estado = cual === '1h' ? c.confirmacion.h1 : c.confirmacion.m30;
    const marcado = cual === '1h' ? c.conf1h : c.conf30min;
    const etiqueta = cual === '1h' ? '1 h' : '30 min';
    const clase =
      estado === 'confirmada'
        ? 'bg-ok-soft text-ok-ink'
        : estado === 'vencida'
          ? 'border border-line bg-white text-mute line-through'
          : 'border border-line bg-white text-mute hover:border-mute2';
    return (
      <button
        onClick={() => void accion(c.id, 'confirmacion', { cual, on: !marcado })}
        disabled={ocupada || !banco.puedeEscribir}
        title={
          estado === 'confirmada'
            ? 'Confirmó — clic para quitar'
            : estado === 'vencida'
              ? 'No confirmó en esta ventana — clic para marcarlo a mano'
              : 'Marcar que confirmó'
        }
        className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition disabled:opacity-50 ${clase}`}
      >
        {estado === 'confirmada' ? '✅' : estado === 'vencida' ? '✕' : '○'} {etiqueta}
      </button>
    );
  };

  return (
    <div className={`card card-pad py-3 ${pronto ? 'border-bad/50' : ''}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button onClick={() => setAbierta((v) => !v)} className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-semibold text-ink">
            {c.lead?.nombre ?? 'Lead'}
            {c.lead?.empresa ? <span className="font-normal text-mute"> · {c.lead.empresa}</span> : null}
          </p>
          <p className="text-[11px] text-mute">
            {dia(c.startAt)} · {hora(c.startAt)} ·{' '}
            <span className={pronto ? 'font-medium text-bad-ink' : ''}>{faltan(c.minutosParaEmpezar)}</span>
          </p>
        </button>

        <div className="flex items-center gap-1">
          {chip('1h')}
          {chip('30min')}
        </div>
        {dos && (
          <span className="rounded-full bg-ok-soft px-2 py-0.5 text-[10px] font-medium text-ok-ink">Prioridad alta</span>
        )}
        {c.confirmacion.hayQuePerseguir && (
          <span
            className="rounded-full bg-warn-soft px-2 py-0.5 text-[10px] font-medium text-warn-ink"
            title="No respondió ninguno de los dos recordatorios"
          >
            ⚠️ Hacer seguimiento
          </span>
        )}

        <div className="flex items-center gap-1.5">
          {banco.puedeAsignar && (
            <select
              value={c.hostUserId ?? ''}
              disabled={ocupada}
              onChange={(e) => e.target.value && void accion(c.id, 'asignar', { hostUserId: e.target.value })}
              className="input text-xs py-1 w-auto"
              aria-label={`Closer de la cita de ${c.lead?.nombre ?? 'este lead'}`}
            >
              <option value="">{modo === 'por_asignar' ? 'Asignar…' : 'Reasignar…'}</option>
              {banco.closers.map((cl) => (
                <option key={cl.id} value={cl.id}>
                  {cl.nombre}
                  {cl.id === banco.sugerido ? ' ★' : ''}
                </option>
              ))}
            </select>
          )}
          {modo === 'por_confirmar' && banco.puedeEscribir && (
            <button
              onClick={() => void accion(c.id, 'confirmar', { on: true })}
              disabled={ocupada}
              className="btn-primary text-xs disabled:opacity-50"
            >
              Confirmar
            </button>
          )}
          {c.minutosParaEmpezar <= 0 && banco.puedeEscribir && (
            <button
              onClick={() => {
                if (
                  confirm(
                    `¿Marcar que ${c.lead?.nombre ?? 'el lead'} NO asistió?\n\nSe crea un seguimiento para reagendar la cita.`,
                  )
                ) {
                  void accion(c.id, 'no-asistio');
                }
              }}
              disabled={ocupada}
              title="Marcar que no asistió"
              className="rounded-lg border border-warn/40 px-2 py-1 text-xs font-medium text-warn-ink hover:bg-warn-soft disabled:opacity-50"
            >
              No asistió
            </button>
          )}
          <BotonDeWhatsapp
            telefono={c.lead?.telefono}
            plantilla={banco.mensajeWhatsapp}
            nombre={c.lead?.nombre}
            // {{closer}} es quien escribe (la persona en sesión), como en la
            // referencia; si no se sabe su nombre, el closer de la cita.
            closer={banco.yo?.nombre || c.host?.nombre}
            equipo={banco.team.name}
            sala={c.sala}
            className="rounded-lg border border-line px-2 py-1 text-xs font-medium text-ok-ink hover:bg-ok-soft"
          />
          {banco.puedeEscribir && (
            <button
              onClick={() => {
                if (confirm(`¿Cancelar la cita de ${c.lead?.nombre ?? 'este lead'}?`)) void accion(c.id, 'cancelar');
              }}
              disabled={ocupada}
              title="Cancelar la cita"
              className="rounded-lg border border-line px-2 py-1 text-xs text-bad-ink hover:bg-bad-soft disabled:opacity-50"
            >
              ✕
            </button>
          )}
          <button
            onClick={() => setAbierta((v) => !v)}
            aria-expanded={abierta}
            className="rounded-lg border border-line px-2 py-1 text-xs text-mute hover:bg-bg2"
          >
            {abierta ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {modo === 'por_asignar' && banco.sugerido && !c.hostUserId && banco.puedeAsignar && (
        <p className="mt-1.5 text-[11px] text-brand">
          Sugerido: {nombreDe(banco.sugerido) ?? '—'} (el menos cargado). Puedes elegir otro.
        </p>
      )}

      {abierta && (
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 text-xs sm:grid-cols-3">
          {/* Lo que el equipo eligió en «Configuración», en el orden y con los
              nombres del catálogo (`CAMPOS_DEL_BANCO`): con otro nombre aquí no
              se sabría qué casilla enseña qué. */}
          {campos.includes('whatsapp') && <Dato etiqueta="WhatsApp" valor={c.lead?.telefono} />}
          {campos.includes('email') && <Dato etiqueta="Email" valor={c.lead?.email} />}
          {campos.includes('empresa') && <Dato etiqueta="Empresa" valor={c.lead?.empresa} />}
          {campos.includes('instagram') && <Dato etiqueta="Sitio web / Instagram" valor={c.lead?.instagram} />}
          {campos.includes('origen') && <Dato etiqueta="Fuente del lead" valor={c.lead?.origen} />}
          {campos.includes('puntaje') && (
            // 0 es lo que guarda un formulario que no puntúa: pintarlo parecería
            // un lead malo en todas las tarjetas, así que se lee como «sin puntaje».
            <Dato etiqueta="Lead Score" valor={c.puntaje ? String(c.puntaje) : null} />
          )}
          {campos.includes('proxima_accion') && (
            <Dato
              etiqueta="Próxima acción"
              valor={
                c.proximoPaso
                  ? `${c.proximoPaso.canal || 'Seguimiento'} · ${dia(c.proximoPaso.cuando)} · ${hora(c.proximoPaso.cuando)}`
                  : null
              }
            />
          )}
          {campos.includes('nota_seguimiento') && <Dato etiqueta="Nota de seguimiento" valor={c.proximoPaso?.nota} />}
          {campos.includes('closer') && <Dato etiqueta="Closer asignado" valor={c.host?.nombre} />}
          {campos.includes('duracion') && <Dato etiqueta="Duración" valor={`${c.durationMin} min`} />}
          {campos.includes('respuestas') && (
            <div className="col-span-2 sm:col-span-3">
              <p className="text-[10px] uppercase tracking-wide text-mute">Respuestas del formulario</p>
              {c.respuestas?.length ? (
                <ul className="m-0 list-none p-0 text-ink">
                  {c.respuestas.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-ink">—</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor?: string | null }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-mute">{etiqueta}</p>
      {/* Una nota larga se corta a una línea; el texto entero queda al pasar el ratón. */}
      <p className="truncate text-ink" title={valor || undefined}>
        {valor || '—'}
      </p>
    </div>
  );
}

function ListaSimpleDeCitas({ filas, nombreDe }: { filas: Cita[]; nombreDe: (id: string | null) => string | null }) {
  if (!filas.length) return <Vacio texto="Sin registros en los últimos 30 días." />;
  return (
    <div className="flex flex-col gap-1.5">
      {filas.map((c) => (
        <div key={c.id} className="card flex items-center gap-3 px-3 py-2.5 text-sm">
          <span className="whitespace-nowrap text-mute">
            {dia(c.startAt)} · {hora(c.startAt)}
          </span>
          <span className="flex-1 truncate font-medium text-ink">
            {c.lead?.nombre ?? '—'}
            {c.lead?.empresa ? ` · ${c.lead.empresa}` : ''}
          </span>
          <span className="whitespace-nowrap rounded-full bg-bg2 px-2 py-0.5 text-[11px] text-mute">
            {ESTADO_DE_CITA[c.status] ?? c.status}
          </span>
          {c.hostUserId && <span className="whitespace-nowrap text-xs text-mute">{nombreDe(c.hostUserId)}</span>}
        </div>
      ))}
    </div>
  );
}

function ListaDeLeadsDelBanco({ filas, teamId }: { filas: LeadDelBanco[]; teamId: string }) {
  const rutaEquipos = useBaseDeEquipos();
  if (!filas.length) return <Vacio texto="Sin registros." />;
  return (
    <div className="flex flex-col gap-1.5">
      {filas.map((l) => (
        <Link
          key={l.id}
          href={`${rutaEquipos}/${teamId}/board?lead=${l.id}`}
          className="card flex items-center gap-3 px-3 py-2.5 text-sm hover:border-mute2"
        >
          <span className="flex-1 truncate font-medium text-ink">
            {l.nombre ?? 'Sin nombre'}
            {l.empresa ? ` · ${l.empresa}` : ''}
          </span>
          {l.valor ? <span className="whitespace-nowrap font-semibold text-ok-ink tabular-nums">{dinero(l.valor)}</span> : null}
          {l.proximoSeguimiento && (
            <span className="whitespace-nowrap text-xs text-mute">{dia(l.proximoSeguimiento)}</span>
          )}
        </Link>
      ))}
    </div>
  );
}

function Vacio({ texto }: { texto: string }) {
  return <p className="py-8 text-center text-sm text-mute">{texto}</p>;
}
