'use client';

/**
 * Donde el prospecto elige su hora. Sin cuenta, sin sesión, sin nada.
 *
 * Se entra por el slug del equipo. La respuesta ya viene filtrada: si la marca
 * tiene el módulo apagado, esto responde «agenda no disponible» — apagar un
 * módulo tiene que cerrar también la puerta de la calle, no solo esconder el
 * menú de dentro.
 *
 * Al reservar se devuelve un token, NUNCA el id de la cita. Con el id, cambiar
 * un número en la URL cancelaría la cita de otro.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

type Hueco = { startAt: string; label: string };
type Dia = { fecha: string; huecos: Hueco[] };
type Calendario = { team: { name: string }; zona: string; dias: Dia[] };

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** «martes 8 de septiembre» */
function diaLargo(fecha: string, zona: string): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: zona,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(d);
}

export default function AgendaPublica() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? '';

  const [cal, setCal] = useState<Calendario | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elegido, setElegido] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', notes: '' });
  const [enviando, setEnviando] = useState(false);
  // Se guarda el `manageToken` que devuelve la API. Antes se tiraba: la
  // pantalla de gestión (`/cita/gestion/<token>`) existía y **nadie recibía
  // nunca el enlace**, así que quien reservaba no podía cancelar ni cambiar la
  // hora. El token ES la autorización; no hace falta cuenta.
  const [listo, setListo] = useState<{ startAt: string; manageToken?: string } | null>(
    null,
  );

  useEffect(() => {
    if (!slug) return;
    fetch(`${API}/api/public/agenda/${encodeURIComponent(slug)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error('no');
        return r.json();
      })
      .then(setCal)
      .catch(() =>
        setError(
          'Esta agenda no está disponible. Puede que el enlace haya cambiado.',
        ),
      );
  }, [slug]);

  async function reservar() {
    if (!elegido) return;
    if (!form.name.trim() && !form.phone.trim()) {
      setError('Déjanos al menos tu nombre o tu teléfono.');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const r = await fetch(
        `${API}/api/public/agenda/${encodeURIComponent(slug)}/reservar`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ startAt: elegido, ...form }),
        },
      );
      if (!r.ok) {
        // 409 = alguien cogió ese hueco mientras tanto. Es lo más probable, y
        // hay que decirlo con palabras, no con un número.
        // El backend revalida el hueco y responde con un texto ya escrito para
        // una persona («Ese horario ya no está disponible. Elige otro.»).
        // Enseñarlo gana al genérico, que no dice qué hacer.
        const dicho = await r
          .json()
          .then((j) => (typeof j?.message === 'string' ? j.message : null))
          .catch(() => null);
        setError(
          r.status === 409
            ? 'Esa hora acaba de ocuparse. Elige otra, por favor.'
            : dicho ?? 'No se pudo reservar. Intenta de nuevo.',
        );
        setElegido(null);
        // Se recarga el calendario: el hueco que falló ya no debe verse libre.
        fetch(`${API}/api/public/agenda/${encodeURIComponent(slug)}`)
          .then((x) => x.json())
          .then(setCal)
          .catch(() => null);
        return;
      }
      const datos = await r.json();
      setListo({ startAt: datos.startAt, manageToken: datos.manageToken });
    } catch {
      setError('No se pudo reservar. Intenta de nuevo.');
    } finally {
      setEnviando(false);
    }
  }

  if (listo) {
    return (
      <main className="min-h-screen grid place-items-center p-6">
        <div className="max-w-sm text-center">
          <div className="text-4xl mb-3">✅</div>
          <h1 className="text-xl font-semibold mb-2">Listo, quedamos así</h1>
          <p className="text-sm text-mute">
            {new Intl.DateTimeFormat('es-CO', {
              timeZone: cal?.zona ?? 'America/Bogota',
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit',
            }).format(new Date(listo.startAt))}
          </p>
          <p className="text-xs text-mute mt-4">
            Te escribimos un recordatorio antes de la cita.
          </p>
          {listo.manageToken && (
            <a
              // `/agenda/cita/<token>`, NO `/cita/gestion/<token>`: esa
              // segunda es de Reservas de Servicios y habla con otra API.
              href={`/agenda/cita/${encodeURIComponent(listo.manageToken)}`}
              className="inline-block mt-4 text-sm underline underline-offset-4"
            >
              Ver o cancelar mi cita
            </a>
          )}
        </div>
      </main>
    );
  }

  if (error && !cal) {
    return (
      <main className="min-h-screen grid place-items-center p-6">
        <p className="text-sm text-mute max-w-sm text-center">{error}</p>
      </main>
    );
  }

  if (!cal) {
    return (
      <main className="min-h-screen grid place-items-center p-6">
        <p className="text-mute">Cargando…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-5 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold">Agenda una cita</h1>
      <p className="text-sm text-mute mb-5">con {cal.team.name}</p>

      {!cal.dias.length && (
        <p className="text-sm text-mute">
          Ahora mismo no hay horas libres. Vuelve a intentarlo en unos días.
        </p>
      )}

      {!elegido &&
        cal.dias.map((d) => (
          <section key={d.fecha} className="mb-5">
            <h2 className="text-sm font-semibold capitalize mb-2">
              {diaLargo(d.fecha, cal.zona)}
            </h2>
            <div className="flex flex-wrap gap-2">
              {d.huecos.map((h) => (
                <button
                  key={h.startAt}
                  type="button"
                  className="px-3 py-2 rounded-lg border border-line text-sm hover:border-brand transition"
                  onClick={() => setElegido(h.startAt)}
                >
                  {h.label}
                </button>
              ))}
            </div>
          </section>
        ))}

      {elegido && (
        <section className="card card-pad">
          <p className="text-sm mb-3">
            <strong className="capitalize">
              {new Intl.DateTimeFormat('es-CO', {
                timeZone: cal.zona,
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                hour: '2-digit',
                minute: '2-digit',
              }).format(new Date(elegido))}
            </strong>
          </p>
          <div className="flex flex-col gap-3">
            <input
              className="input"
              placeholder="Tu nombre"
              autoFocus
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              className="input"
              placeholder="Tu teléfono"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <textarea
              className="input"
              rows={2}
              placeholder="¿Algo que debamos saber? (opcional)"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          {error && <p className="text-sm text-rose-600 mt-3">{error}</p>}
          <div className="flex gap-2 mt-4">
            <button className="btn-ghost flex-1" onClick={() => setElegido(null)}>
              Cambiar hora
            </button>
            <button className="btn flex-1" disabled={enviando} onClick={reservar}>
              {enviando ? 'Reservando…' : 'Confirmar'}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
