'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import QRCode from 'qrcode';

type Pass = {
  id: string;
  customerName: string;
  party: number;
  date: string;
  time: string;
  zone: string | null;
  tableNumber: string | null;
  status: string;
  brandName: string;
  primaryColor: string | null;
  logoUrl: string | null;
  whatsappPhone: string | null;
  qrPayload: string;
};

export default function ReservationPass() {
  const { token } = useParams<{ token: string }>();
  const [pass, setPass] = useState<Pass | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [isAndroid, setIsAndroid] = useState(false);
  const [addingToWallet, setAddingToWallet] = useState(false);

  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setIsAndroid(/android/i.test(navigator.userAgent));
    }
  }, []);

  async function addToGoogleWallet() {
    if (addingToWallet) return;
    setAddingToWallet(true);
    try {
      const API = process.env.NEXT_PUBLIC_API_URL ?? '';
      const r = await fetch(
        `${API}/api/public/reservations/pase/${token}/google-wallet`,
      );
      if (!r.ok) throw new Error('No se pudo generar el pase');
      const data = (await r.json()) as { url: string };
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      alert(e?.message || 'No se pudo añadir a Google Wallet');
    } finally {
      setAddingToWallet(false);
    }
  }

  useEffect(() => {
    const API = process.env.NEXT_PUBLIC_API_URL ?? '';
    fetch(`${API}/api/public/reservations/pase/${token}`)
      .then((r) => {
        if (!r.ok) throw new Error('Link inválido o expirado');
        return r.json();
      })
      .then((data) => setPass(data))
      .catch((e) => setError(e.message));
  }, [token]);

  useEffect(() => {
    if (!pass) return;
    QRCode.toDataURL(pass.qrPayload, {
      margin: 1,
      width: 320,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then(setQrDataUrl)
      .catch(() => null);
  }, [pass]);

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-bg2">
        <div className="card card-pad max-w-md text-center">
          <h1 className="text-lg font-semibold">Pase no disponible</h1>
          <p className="text-sm text-mute mt-2">{error}</p>
        </div>
      </main>
    );
  }
  if (!pass) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="text-sm text-mute">Cargando pase…</div>
      </main>
    );
  }

  const primary = pass.primaryColor || '#22C55E';
  const fmtDate = (d: string) => {
    const [y, m, day] = d.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
    const opts: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    };
    return date.toLocaleDateString('es-CO', opts);
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white py-6 px-4 flex items-start justify-center">
      <div className="w-full max-w-sm">
        {/* Pass ticket */}
        <div
          className="relative rounded-3xl shadow-2xl overflow-hidden"
          style={{ background: 'white' }}
        >
          {/* Header gradient */}
          <div
            className="px-6 pt-6 pb-5 text-white"
            style={{ background: `linear-gradient(135deg, ${primary}, ${primary}DD)` }}
          >
            <div className="flex items-center gap-3">
              {pass.logoUrl && (
                <img
                  src={pass.logoUrl}
                  alt=""
                  className="w-12 h-12 rounded-xl object-cover bg-white/20 backdrop-blur"
                />
              )}
              <div>
                <div className="text-[10px] uppercase tracking-widest opacity-80 font-bold">
                  Reserva confirmada
                </div>
                <div className="text-xl font-extrabold">{pass.brandName}</div>
              </div>
            </div>

            <div className="mt-5">
              <div className="text-[10px] uppercase tracking-wider opacity-80 font-semibold">
                Titular
              </div>
              <div className="text-lg font-bold">{pass.customerName}</div>
            </div>
          </div>

          {/* Body */}
          <div className="px-6 py-5">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                  Personas
                </div>
                <div className="text-2xl font-extrabold mt-1">{pass.party}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                  Hora
                </div>
                <div className="text-2xl font-extrabold mt-1">{pass.time}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                  {pass.tableNumber ? 'Mesa' : 'Zona'}
                </div>
                <div className="text-sm font-bold mt-2">
                  {pass.tableNumber
                    ? pass.tableNumber
                    : pass.zone ?? 'Asignada'}
                </div>
              </div>
            </div>

            <div
              className="mt-5 p-3 rounded-xl text-center"
              style={{ background: `${primary}10` }}
            >
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                Fecha
              </div>
              <div className="text-sm font-bold capitalize mt-1">{fmtDate(pass.date)}</div>
            </div>
          </div>

          {/* Perforated separator */}
          <div className="relative h-6 -my-3">
            <div className="absolute left-0 top-1/2 w-4 h-4 -translate-y-1/2 rounded-full bg-bg2" />
            <div className="absolute right-0 top-1/2 w-4 h-4 -translate-y-1/2 rounded-full bg-bg2" />
            <div
              className="absolute left-4 right-4 top-1/2 -translate-y-1/2 border-t-2 border-dashed"
              style={{ borderColor: '#e2e8f0' }}
            />
          </div>

          {/* QR section */}
          <div className="px-6 py-6 text-center">
            <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-3">
              Mostrá este QR al llegar
            </div>
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="QR de la reserva"
                className="w-56 h-56 mx-auto rounded-2xl"
              />
            ) : (
              <div className="w-56 h-56 mx-auto bg-slate-100 rounded-2xl animate-pulse" />
            )}
            <div className="text-[10px] text-slate-400 mt-3 font-mono">
              ID: {pass.id.slice(0, 8).toUpperCase()}
            </div>
          </div>

          {/* Footer */}
          {pass.whatsappPhone && (
            <div className="px-6 py-4 bg-slate-50 text-center">
              <a
                href={`https://wa.me/${pass.whatsappPhone.replace(/\D/g, '')}`}
                className="text-sm font-semibold inline-flex items-center gap-2"
                style={{ color: primary }}
              >
                💬 Contactar al restaurante
              </a>
            </div>
          )}
        </div>

        {isAndroid && (
          <button
            type="button"
            onClick={addToGoogleWallet}
            disabled={addingToWallet}
            className="w-full mt-4 py-3 rounded-2xl bg-black text-white text-sm font-semibold shadow-md active:scale-[0.97] transition-transform disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {addingToWallet ? (
              <>Generando pase…</>
            ) : (
              <>
                <span>🪪</span>
                <span>Añadir a Google Wallet</span>
              </>
            )}
          </button>
        )}

        <p className="text-xs text-slate-500 text-center mt-4">
          Agrega este pase a la pantalla de inicio de tu celular para tenerlo a mano.
        </p>
      </div>
    </main>
  );
}
