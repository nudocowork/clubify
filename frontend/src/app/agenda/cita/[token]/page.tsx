'use client';
/* =====================================================================
 *  Mi cita — la pantalla del prospecto, sin cuenta.
 * ---------------------------------------------------------------------
 *  El backend ya devolvía un `manageToken` al reservar y tenía sus dos
 *  rutas públicas (`/public/agenda/cita/:token` y `.../cancelar`), pero
 *  **no había pantalla**: el token se tiraba en el formulario de reserva y
 *  quien agendaba se quedaba sin forma de cancelar.
 *
 *  OJO: `/cita/gestion/<token>` NO sirve para esto. Esa pantalla es de
 *  Reservas de Servicios y habla con `/public/service-reservations/...`.
 *  Son dos funciones distintas con dos APIs distintas; enlazar la una desde
 *  la otra da un 404 silencioso.
 *
 *  El token ES la autorización: quien tiene el enlace es quien reservó. Por
 *  eso el id de la cita no sale nunca de la API.
 * =================================================================== */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Cita = {
  equipo: string;
  startAt: string;
  durationMin: number;
  status: string;
  zona: string;
};

const CANCELABLE = new Set(['PENDIENTE', 'CONFIRMADA']);

export default function MiCitaPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token as string;
  const [cita, setCita] = useState<Cita | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [cancelada, setCancelada] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(
        `${API}/api/public/agenda/cita/${encodeURIComponent(token)}`,
      );
      if (!r.ok) throw new Error('no');
      setCita(await r.json());
    } catch {
      // Un token que no existe y uno de una marca con el módulo apagado dan
      // lo mismo a propósito: no se confirma qué citas hay.
      setError('No encontramos esta cita. Puede que el enlace haya caducado.');
    }
  }, [token]);

  useEffect(() => {
    if (token) void cargar();
  }, [token, cargar]);

  async function cancelar() {
    setCancelando(true);
    try {
      const r = await fetch(
        `${API}/api/public/agenda/cita/${encodeURIComponent(token)}/cancelar`,
        { method: 'POST' },
      );
      if (!r.ok) throw new Error('no');
      setCancelada(true);
      await cargar();
    } catch {
      setError('No se pudo cancelar. Intenta de nuevo.');
    } finally {
      setCancelando(false);
    }
  }

  if (error && !cita) {
    return (
      <main className="min-h-screen grid place-items-center p-6">
        <p className="text-sm text-mute max-w-sm text-center">{error}</p>
      </main>
    );
  }

  if (!cita) {
    return (
      <main className="min-h-screen grid place-items-center p-6">
        <p className="text-sm text-mute">Cargando…</p>
      </main>
    );
  }

  const cuando = new Intl.DateTimeFormat('es-CO', {
    timeZone: cita.zona,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(cita.startAt));
  const yaNoVa = !CANCELABLE.has(cita.status);

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="max-w-sm w-full text-center">
        <div className="text-4xl mb-3">{yaNoVa ? '🗓' : '✅'}</div>
        <h1 className="text-xl font-semibold mb-1">Tu cita</h1>
        <p className="text-sm text-mute mb-1">con {cita.equipo}</p>
        <p className="text-base font-medium">{cuando}</p>
        <p className="text-xs text-mute mt-1">{cita.durationMin} minutos</p>

        {cancelada || cita.status === 'CANCELADA' ? (
          <p className="text-sm mt-6">
            Esta cita quedó <strong>cancelada</strong>. Si fue un error,
            escríbenos y la volvemos a agendar.
          </p>
        ) : yaNoVa ? (
          <p className="text-sm text-mute mt-6">
            Esta cita ya no se puede cambiar desde aquí.
          </p>
        ) : (
          <>
            <button
              type="button"
              onClick={cancelar}
              disabled={cancelando}
              className="btn-ghost text-sm mt-6"
            >
              {cancelando ? 'Cancelando…' : 'Cancelar mi cita'}
            </button>
            <p className="text-xs text-mute mt-3">
              Si necesitas otra hora, cancela y vuelve a reservar.
            </p>
          </>
        )}

        {error && cita ? (
          <p className="text-xs text-bad mt-4">{error}</p>
        ) : null}
      </div>
    </main>
  );
}
