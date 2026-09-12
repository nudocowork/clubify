'use client';

/**
 * La agenda del equipo de ventas — fase 4.
 *
 * Dos cosas en una pantalla, porque son las dos que se miran juntas: el
 * horario en el que el equipo atiende, y lo que ya tiene agendado.
 *
 * El enlace público NO se crea solo. Se crea cuando alguien lo pide, y desde
 * entonces no cambia: un enlace que ya se repartió y deja de funcionar es peor
 * que no tenerlo.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { CabeceraDeEquipo } from '@/components/ventas/CabeceraDeEquipo';
import { toast } from '@/components/Toast';

type Franja = {
  id: string;
  userId: string | null;
  weekday: number;
  startMin: number;
  endMin: number;
};

type Horario = {
  team: { id: string; name: string };
  puedeEscribir: boolean;
  franjas: Franja[];
  slug: string | null;
};

type Cita = {
  id: string;
  leadId: string | null;
  startAt: string;
  durationMin: number;
  status: string;
  manageToken: string;
  notes: string | null;
  lead: { id: string; name: string | null; phone: string | null } | null;
};

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const ESTADOS: { valor: string; label: string; color: string }[] = [
  { valor: 'PENDIENTE', label: 'Pendiente', color: 'bg-slate-100 text-slate-700' },
  { valor: 'CONFIRMADA', label: 'Confirmada', color: 'bg-sky-100 text-sky-800' },
  { valor: 'REALIZADA', label: 'Realizada', color: 'bg-emerald-100 text-emerald-800' },
  { valor: 'NO_ASISTIO', label: 'No asistió', color: 'bg-amber-100 text-amber-800' },
  { valor: 'CANCELADA', label: 'Cancelada', color: 'bg-rose-100 text-rose-800' },
];

const aHHMM = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const aMinutos = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** «mar 8 sep · 09:30», en hora de Bogotá pase lo que pase en el navegador. */
function cuando(iso: string): string {
  const d = new Date(iso);
  const fecha = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(d);
  const hora = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
  return `${fecha} · ${hora}`;
}

export default function AgendaDelEquipo() {
  const params = useParams<{ id: string }>();
  const teamId = params?.id ?? '';

  const [horario, setHorario] = useState<Horario | null>(null);
  const [citas, setCitas] = useState<Cita[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  // El horario que se está editando, por día. Vacío = ese día no se atiende.
  const [tramos, setTramos] = useState<Record<number, { desde: string; hasta: string } | null>>({});

  const cargar = useCallback(async () => {
    if (!teamId) return;
    try {
      const [h, c] = await Promise.all([
        api<Horario>(`/sales-teams/${teamId}/agenda/horario`),
        api<{ citas: Cita[] }>(`/sales-teams/${teamId}/agenda/citas`),
      ]);
      setHorario(h);
      setCitas(c.citas ?? []);
      const mapa: Record<number, { desde: string; hasta: string } | null> = {};
      for (let d = 0; d < 7; d++) {
        // Solo el horario del EQUIPO (userId nulo). El de cada vendedor se
        // edita desde su ficha; mezclarlos aquí sería ilegible.
        const f = h.franjas.find((x) => x.weekday === d && x.userId === null);
        mapa[d] = f ? { desde: aHHMM(f.startMin), hasta: aHHMM(f.endMin) } : null;
      }
      setTramos(mapa);
      setError(null);
    } catch (e: any) {
      setError(
        e?.status === 404
          ? 'Este equipo no existe, o el módulo «Equipos de ventas» está apagado para esta marca.'
          : (e?.message ?? 'No se pudo cargar la agenda.'),
      );
    } finally {
      setCargando(false);
    }
  }, [teamId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function guardarHorario() {
    const franjas: { weekday: number; startMin: number; endMin: number }[] = [];
    for (let d = 0; d < 7; d++) {
      const t = tramos[d];
      if (!t) continue;
      const startMin = aMinutos(t.desde);
      const endMin = aMinutos(t.hasta);
      if (endMin <= startMin) {
        toast(`En ${DIAS[d]}, la hora de cierre tiene que ser posterior.`, 'error');
        return;
      }
      franjas.push({ weekday: d, startMin, endMin });
    }
    setGuardando(true);
    try {
      await api(`/sales-teams/${teamId}/agenda/horario`, {
        method: 'POST',
        body: JSON.stringify({ userId: null, franjas }),
      });
      toast('Horario guardado.', 'success');
      await cargar();
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo guardar.', 'error');
    } finally {
      setGuardando(false);
    }
  }

  async function crearEnlace() {
    try {
      const r = await api<{ slug: string }>(`/sales-teams/${teamId}/agenda/enlace`, {
        method: 'POST',
      });
      toast('Enlace creado.', 'success');
      setHorario((h) => (h ? { ...h, slug: r.slug } : h));
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo crear el enlace.', 'error');
    }
  }

  async function cambiarEstado(citaId: string, status: string) {
    try {
      await api(`/sales-teams/${teamId}/agenda/citas/${citaId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setCitas((cs) => cs.map((c) => (c.id === citaId ? { ...c, status } : c)));
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo cambiar.', 'error');
    }
  }

  if (cargando) return <div className="text-mute">Cargando la agenda…</div>;
  if (error) {
    return (
      <div className="card p-6">
        <p className="text-sm">{error}</p>
        <Link href="/admin/sales-teams" className="btn-ghost mt-4 inline-flex">
          Volver a los equipos
        </Link>
      </div>
    );
  }
  if (!horario) return null;

  const puede = horario.puedeEscribir;
  const enlace =
    horario.slug && typeof window !== 'undefined'
      ? `${window.location.origin}/agenda/${horario.slug}`
      : null;

  return (
    <div className="max-w-4xl">
      <CabeceraDeEquipo equipo={{ ...horario.team, id: teamId }} />

      {/* ── Enlace público ─────────────────────────────────────────────── */}
      <section className="card card-pad mb-4">
        <h2 className="text-sm font-semibold mb-1">Enlace para que reserven solos</h2>
        {enlace ? (
          <>
            <p className="text-xs text-mute mb-2">
              Compártelo y el prospecto elige hora sin llamar a nadie. Al reservar
              entra en el tablero automáticamente.
            </p>
            <div className="flex gap-2">
              <input className="input font-mono text-xs" readOnly value={enlace} />
              <button
                className="btn-ghost shrink-0"
                onClick={() => {
                  navigator.clipboard?.writeText(enlace);
                  toast('Copiado.', 'success');
                }}
              >
                Copiar
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-mute mb-2">
              Este equipo todavía no tiene enlace. Se crea una sola vez y no
              cambia después.
            </p>
            <button className="btn text-sm" disabled={!puede} onClick={crearEnlace}>
              Crear el enlace
            </button>
          </>
        )}
      </section>

      {/* ── Horario ────────────────────────────────────────────────────── */}
      <section className="card card-pad mb-4">
        <h2 className="text-sm font-semibold mb-1">¿Cuándo atiende el equipo?</h2>
        <p className="text-xs text-mute mb-3">
          De aquí salen las horas que ve el prospecto. Un día sin marcar no se
          ofrece. Hora de Bogotá.
        </p>
        <div className="flex flex-col gap-2">
          {DIAS.map((nombre, d) => {
            const t = tramos[d];
            return (
              <div key={d} className="flex items-center gap-3">
                <label className="flex items-center gap-2 w-32 shrink-0 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!puede}
                    checked={!!t}
                    onChange={(e) =>
                      setTramos({
                        ...tramos,
                        [d]: e.target.checked ? { desde: '09:00', hasta: '18:00' } : null,
                      })
                    }
                  />
                  {nombre}
                </label>
                {t ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      className="input w-28"
                      disabled={!puede}
                      value={t.desde}
                      onChange={(e) => setTramos({ ...tramos, [d]: { ...t, desde: e.target.value } })}
                    />
                    <span className="text-mute text-sm">a</span>
                    <input
                      type="time"
                      className="input w-28"
                      disabled={!puede}
                      value={t.hasta}
                      onChange={(e) => setTramos({ ...tramos, [d]: { ...t, hasta: e.target.value } })}
                    />
                  </div>
                ) : (
                  <span className="text-xs text-mute">No se atiende</span>
                )}
              </div>
            );
          })}
        </div>
        {puede && (
          <button className="btn mt-4" disabled={guardando} onClick={guardarHorario}>
            {guardando ? 'Guardando…' : 'Guardar horario'}
          </button>
        )}
      </section>

      {/* ── Citas ──────────────────────────────────────────────────────── */}
      <section className="card card-pad">
        <h2 className="text-sm font-semibold mb-3">Próximas citas</h2>
        {!citas.length ? (
          <p className="text-sm text-mute">
            Todavía no hay ninguna. En cuanto alguien reserve por el enlace,
            aparece aquí y en el tablero.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {citas.map((c) => {
              const estado = ESTADOS.find((e) => e.valor === c.status);
              return (
                <li key={c.id} className="py-3 flex items-center gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">
                      {c.lead?.name || c.lead?.phone || 'Sin nombre'}
                    </div>
                    <div className="text-xs text-mute">
                      {cuando(c.startAt)} · {c.durationMin} min
                      {c.lead?.phone && ` · ${c.lead.phone}`}
                    </div>
                  </div>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-pill font-semibold ${estado?.color ?? ''}`}
                  >
                    {estado?.label ?? c.status}
                  </span>
                  {puede && (
                    <select
                      className="input w-36 text-xs"
                      value={c.status}
                      onChange={(e) => cambiarEstado(c.id, e.target.value)}
                    >
                      {ESTADOS.map((e) => (
                        <option key={e.valor} value={e.valor}>
                          {e.label}
                        </option>
                      ))}
                    </select>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
