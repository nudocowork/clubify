'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PhoneInput } from '@/components/PhoneInput';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

type Evento = {
  id: string;
  nombre: string;
  descripcion: string | null;
  portada: string | null;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  precio: number | null;
  moneda: string;
  cancelado: boolean;
  terminado: boolean;
  capacidad: number;
  disponibles: number;
  sede: { nombre: string; direccion: string | null } | null;
  negocio: { nombre: string; logoUrl: string | null; color: string | null };
};

/** «viernes 11 de septiembre». El día de la semana importa: es lo que la gente
 *  mira para saber si puede ir. */
function fechaLarga(iso: string): string {
  const d = new Date(iso);
  const s = new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** «6:00 p. m.» en vez de «18:00». */
function hora12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'p. m.' : 'a. m.';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export default function EventoPublicoPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [ev, setEv] = useState<Evento | null>(null);
  const [cargando, setCargando] = useState(true);

  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [personas, setPersonas] = useState(1);
  const [enviando, setEnviando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [listo, setListo] = useState<{ personas: number; yaEstabas: boolean } | null>(
    null,
  );

  useEffect(() => {
    fetch(`${API}/api/public/events/${eventId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setEv)
      .catch(() => setEv(null))
      .finally(() => setCargando(false));
  }, [eventId]);

  const color = ev?.negocio.color || '#16A34A';

  async function reservar(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (telefono.replace(/\D/g, '').length < 8) {
      setErr('Escribe tu número de WhatsApp para que puedan confirmarte.');
      return;
    }
    setEnviando(true);
    try {
      const r = await fetch(`${API}/api/public/events/${eventId}/reservar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: nombre.trim(),
          customerPhone: telefono,
          customerEmail: email.trim() || undefined,
          party: personas,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message ?? 'No se pudo apartar el cupo.');
      setListo({ personas: j.personas ?? personas, yaEstabas: !!j.yaEstabas });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setEnviando(false);
    }
  }

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center text-mute text-sm">
        Cargando…
      </div>
    );
  }

  if (!ev) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 text-center">
        <div>
          <div className="text-lg font-bold">Este evento no está disponible</div>
          <p className="text-sm text-mute mt-1">
            Puede que el enlace esté mal escrito o que el evento ya no exista.
          </p>
        </div>
      </div>
    );
  }

  const agotado = ev.disponibles <= 0;
  const cerrado = ev.cancelado || ev.terminado || agotado;

  return (
    <div className="min-h-screen bg-gradient-to-b from-bg via-bg to-bg2/30">
      <div className="max-w-md mx-auto px-5 py-7">
        {/* Quién invita, antes que nada. */}
        <div className="flex items-center justify-center gap-2 mb-4">
          {ev.negocio.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={ev.negocio.logoUrl}
              alt=""
              className="w-8 h-8 rounded-lg object-contain bg-white"
            />
          ) : null}
          <div className="text-[13px] font-bold uppercase tracking-wide">
            {ev.negocio.nombre}
          </div>
        </div>

        {ev.portada && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ev.portada}
            alt={ev.nombre}
            className="w-full rounded-2xl object-cover max-h-64 shadow-sm"
          />
        )}

        <h1 className="text-[22px] font-extrabold tracking-tight mt-4 leading-tight">
          {ev.nombre}
        </h1>

        <div className="mt-2 space-y-1 text-[14px]">
          <div>
            <strong>{fechaLarga(ev.fecha)}</strong>
          </div>
          <div className="text-mute">
            {hora12(ev.horaInicio)} — {hora12(ev.horaFin)}
          </div>
          {ev.sede && (
            <div className="text-mute">
              {ev.sede.nombre}
              {ev.sede.direccion ? ` · ${ev.sede.direccion}` : ''}
            </div>
          )}
          {ev.precio != null && ev.precio > 0 && (
            <div className="font-semibold" style={{ color }}>
              {ev.precio.toLocaleString('es-CO')} {ev.moneda}
            </div>
          )}
        </div>

        {ev.descripcion && (
          <p className="text-[14px] text-mute mt-3 leading-relaxed whitespace-pre-line">
            {ev.descripcion}
          </p>
        )}

        {/* Ya reservó */}
        {listo ? (
          <div className="mt-6 rounded-2xl border border-line bg-white p-5 text-center">
            <div className="text-2xl">✓</div>
            <div className="text-[16px] font-bold mt-1">
              {listo.yaEstabas ? 'Ya tenías tu cupo' : '¡Cupo apartado!'}
            </div>
            <p className="text-[13px] text-mute mt-1">
              {listo.personas === 1
                ? 'Quedaste en la lista.'
                : `Quedaron ${listo.personas} personas en la lista.`}{' '}
              {ev.negocio.nombre} te escribe al WhatsApp para confirmarte.
            </p>
          </div>
        ) : cerrado ? (
          <div className="mt-6 rounded-2xl border border-line bg-white p-5 text-center">
            <div className="text-[15px] font-bold">
              {ev.cancelado
                ? 'Este evento se canceló'
                : ev.terminado
                  ? 'Este evento ya pasó'
                  : 'Se agotaron los cupos'}
            </div>
            <p className="text-[13px] text-mute mt-1">
              {ev.cancelado || ev.terminado
                ? `Escríbele a ${ev.negocio.nombre} para saber de los próximos.`
                : `Escríbele a ${ev.negocio.nombre} por si se libera alguno.`}
            </p>
          </div>
        ) : (
          <form
            onSubmit={reservar}
            className="mt-6 rounded-2xl border border-line bg-white p-4 sm:p-5"
          >
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[15px] font-bold">Aparta tu cupo</div>
              <div className="text-[12px] text-mute">
                {ev.disponibles === 1
                  ? 'Queda 1 cupo'
                  : `Quedan ${ev.disponibles} cupos`}
              </div>
            </div>

            <div className="space-y-3 mt-3">
              <div>
                <label className="label">Tu nombre</label>
                <input
                  className="input"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Nombre y apellido"
                  autoComplete="name"
                  autoCapitalize="words"
                  required
                />
              </div>

              <div>
                <label className="label">WhatsApp</label>
                <PhoneInput value={telefono} onChange={setTelefono} />
              </div>

              <div>
                <label className="label">¿Cuántas personas van?</label>
                <select
                  className="input"
                  value={personas}
                  onChange={(e) => setPersonas(Number(e.target.value))}
                >
                  {/* No se ofrecen más cupos de los que quedan: elegir 6 cuando
                      quedan 2 solo sirve para que el servidor lo rechace. */}
                  {Array.from(
                    { length: Math.min(20, ev.disponibles) },
                    (_, i) => i + 1,
                  ).map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? '1 persona' : `${n} personas`}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Correo (opcional)</label>
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tucorreo@ejemplo.com"
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="none"
                />
              </div>
            </div>

            {err && <div className="text-[12px] text-bad mt-3">{err}</div>}

            <button
              className="w-full mt-4 rounded-xl py-3 font-semibold text-white disabled:opacity-60 active:scale-[0.99] transition"
              style={{ background: color }}
              disabled={enviando}
            >
              {enviando ? 'Apartando…' : 'Apartar mi cupo'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
