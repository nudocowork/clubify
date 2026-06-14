'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

type Reservation = {
  id: string;
  customerName: string;
  party: number;
  date: string;
  time: string;
  zone: string | null;
  status: string;
  brandName: string;
  primaryColor: string | null;
  logoUrl: string | null;
};

export default function CancelReservation() {
  const { token } = useParams<{ token: string }>();
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const API = process.env.NEXT_PUBLIC_API_URL ?? '';
    fetch(`${API}/api/public/reservations/cancel/${token}`)
      .then((r) => {
        if (!r.ok) throw new Error('Link inválido o expirado');
        return r.json();
      })
      .then((data) => setReservation(data))
      .catch((e) => setError(e.message));
  }, [token]);

  async function cancel() {
    setCancelling(true);
    try {
      const API = process.env.NEXT_PUBLIC_API_URL ?? '';
      const r = await fetch(`${API}/api/public/reservations/cancel/${token}`, {
        method: 'POST',
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.message || 'No se pudo cancelar');
      }
      setDone(true);
    } catch (e: any) {
      alert(e.message || 'Error');
    } finally {
      setCancelling(false);
    }
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-bg2">
        <div className="card card-pad max-w-md text-center">
          <h1 className="text-lg font-semibold">Link no válido</h1>
          <p className="text-sm text-mute mt-2">{error}</p>
          <p className="text-xs text-mute mt-3">
            Si la reserva todavía no pasó, contacta al negocio directamente.
          </p>
        </div>
      </main>
    );
  }

  if (!reservation) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="text-sm text-mute">Cargando…</div>
      </main>
    );
  }

  const primary = reservation.primaryColor || '#22C55E';
  const alreadyCancelled = ['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(reservation.status);

  return (
    <main className="min-h-screen bg-bg2 p-4 flex items-start justify-center">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg overflow-hidden">
        <div
          className="px-5 py-4 border-b border-line"
          style={{ background: `linear-gradient(135deg, ${primary}15, transparent)` }}
        >
          <div className="flex items-center gap-3">
            {reservation.logoUrl && (
              <img src={reservation.logoUrl} alt="" className="w-10 h-10 rounded-lg object-cover" />
            )}
            <div>
              <h1 className="text-base font-bold m-0">{reservation.brandName}</h1>
              <p className="text-xs text-mute m-0">
                {done || alreadyCancelled ? 'Estado de tu reserva' : 'Cancelar reserva'}
              </p>
            </div>
          </div>
        </div>

        <div className="p-5">
          {done || alreadyCancelled ? (
            <div className="text-center">
              <div
                className="w-16 h-16 mx-auto rounded-full flex items-center justify-center text-white text-3xl mb-3"
                style={{ background: '#9ca3af' }}
              >
                ✕
              </div>
              <h2 className="text-lg font-bold">
                {alreadyCancelled && !done ? 'Reserva ya cancelada' : 'Reserva cancelada'}
              </h2>
              <p className="text-sm text-mute mt-1">
                El slot vuelve a estar disponible. ¡Esperamos verte pronto!
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm text-mute mb-3">
                Hola <strong className="text-ink">{reservation.customerName}</strong>, esta es tu reserva:
              </p>
              <div className="card card-pad bg-bg2/40">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-[10px] text-mute font-bold">FECHA</div>
                    <div className="text-sm font-bold">{reservation.date}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-mute font-bold">HORA</div>
                    <div className="text-sm font-bold">{reservation.time}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-mute font-bold">PAX</div>
                    <div className="text-sm font-bold">{reservation.party}</div>
                  </div>
                </div>
                {reservation.zone && (
                  <p className="text-xs text-mute mt-3 text-center">
                    Zona: <strong>{reservation.zone}</strong>
                  </p>
                )}
              </div>

              <p className="text-sm text-mute mt-4 leading-relaxed">
                ¿Confirmas que quieres cancelar? El negocio será notificado y el slot
                quedará disponible para otros clientes.
              </p>

              <button
                onClick={cancel}
                disabled={cancelling}
                className="w-full mt-4 py-3 rounded-lg font-bold text-white disabled:opacity-50"
                style={{ background: '#dc2626' }}
              >
                {cancelling ? 'Cancelando…' : 'Cancelar mi reserva'}
              </button>
              <p className="text-[11px] text-mute mt-3 text-center">
                Si fue un error, cierra esta página y no pasará nada.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
