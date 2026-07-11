'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

// Fase 5 (PDF245 P7): gestión de cita por el cliente (reagendar / cancelar) vía
// token. Consume /public/service-reservations/manage/:token (sin auth).

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Slot = { startAt: string; label: string };
type Appt = {
  status: string;
  startAt: string;
  endAt: string;
  customerName: string;
  serviceId: string;
  serviceName: string | null;
  providerId: string | null;
  providerName: string | null;
  businessName: string | null;
  slug: string | null;
  timezone: string;
  primaryColor: string | null;
  logoUrl: string | null;
};

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function GestionCitaPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token as string;
  const [appt, setAppt] = useState<Appt | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'notfound'>('loading');
  const [rescheduling, setRescheduling] = useState(false);
  const [date, setDate] = useState(todayStr());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slot, setSlot] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`${API}/api/public/service-reservations/manage/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: Appt) => {
        setAppt(d);
        setState('ok');
      })
      .catch(() => setState('notfound'));
  }, [token]);
  useEffect(() => {
    if (token) load();
  }, [token, load]);

  const accent = appt?.primaryColor || '#0ea5e9';
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat('es-CO', {
      timeZone: appt?.timezone || 'America/Bogota',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));

  const loadSlots = useCallback(async () => {
    if (!appt?.slug || !appt?.serviceId || !date) return;
    setLoadingSlots(true);
    setSlot('');
    try {
      const q = `serviceId=${appt.serviceId}&date=${date}${appt.providerId ? `&providerId=${appt.providerId}` : ''}`;
      const r = await fetch(
        `${API}/api/public/service-reservations/${appt.slug}/slots?${q}`,
      );
      const d = r.ok ? await r.json() : { slots: [] };
      setSlots(d?.slots ?? []);
    } catch {
      setSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  }, [appt?.slug, appt?.serviceId, appt?.providerId, date]);
  useEffect(() => {
    if (rescheduling) loadSlots();
  }, [rescheduling, loadSlots]);

  async function cancel() {
    if (!confirm('¿Cancelar tu cita?')) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(
        `${API}/api/public/service-reservations/manage/${token}/cancel`,
        { method: 'POST' },
      );
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setMsg(d?.message || 'No se pudo cancelar.');
        return;
      }
      load();
    } catch {
      setMsg('Error de conexión.');
    } finally {
      setBusy(false);
    }
  }

  async function reschedule() {
    if (!slot) {
      setMsg('Elige un nuevo horario.');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(
        `${API}/api/public/service-reservations/manage/${token}/reschedule`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ startAt: slot }),
        },
      );
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d?.message || 'No se pudo reagendar. Prueba otro horario.');
        loadSlots();
        return;
      }
      setRescheduling(false);
      load();
    } catch {
      setMsg('Error de conexión.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: '#f6f7f9', minHeight: '100vh' }}>
      <div className="max-w-md mx-auto px-4 py-6">
        {appt && (
          <div className="flex items-center gap-3 mb-5">
            {appt.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={appt.logoUrl} alt="" className="w-11 h-11 rounded-full object-cover" />
            ) : (
              <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold" style={{ background: accent }}>
                {appt.businessName?.[0] ?? '·'}
              </div>
            )}
            <div>
              <div className="font-bold text-[15px]" style={{ color: '#16241c' }}>{appt.businessName}</div>
              <div className="text-[12px]" style={{ color: '#9aa4af' }}>Tu cita</div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-[16px] p-4" style={{ border: '1px solid #e7e9ec' }}>
          {state === 'loading' && (
            <div className="text-sm text-center py-10" style={{ color: '#9aa4af' }}>Cargando…</div>
          )}
          {state === 'notfound' && (
            <div className="text-center py-10">
              <div className="text-4xl mb-2">🔍</div>
              <div className="font-bold">Cita no encontrada</div>
              <div className="text-sm mt-1" style={{ color: '#9aa4af' }}>El enlace no es válido o expiró.</div>
            </div>
          )}
          {state === 'ok' && appt && (
            <>
              {appt.status === 'cancelled' ? (
                <div className="text-center py-6">
                  <div className="text-4xl mb-2">🚫</div>
                  <div className="font-bold">Cita cancelada</div>
                </div>
              ) : (
                <>
                  <div className="text-sm" style={{ color: '#475569' }}>{appt.serviceName}</div>
                  <div className="text-base font-bold mt-1" style={{ color: accent }}>{fmt(appt.startAt)}</div>
                  {appt.providerName && (
                    <div className="text-[13px] mt-1" style={{ color: '#6b7785' }}>👤 {appt.providerName}</div>
                  )}
                  <div className="text-[12px] mt-1" style={{ color: '#9aa4af' }}>{appt.customerName}</div>

                  {!rescheduling ? (
                    <div className="flex gap-2 mt-4">
                      <button
                        onClick={() => { setRescheduling(true); setMsg(null); }}
                        disabled={busy}
                        className="flex-1 text-sm font-semibold text-white rounded-[10px] py-2.5"
                        style={{ background: accent }}
                      >
                        Reagendar
                      </button>
                      <button
                        onClick={cancel}
                        disabled={busy}
                        className="text-sm font-semibold rounded-[10px] py-2.5 px-4"
                        style={{ background: '#fef2f2', color: '#ef4444' }}
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <div className="mt-4">
                      <div className="text-xs font-bold uppercase mb-2" style={{ color: '#6b7280' }}>
                        Elige un nuevo horario
                      </div>
                      <input
                        type="date"
                        value={date}
                        min={todayStr()}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full rounded-[10px] border border-[#dfe3e8] px-3 py-2 text-sm mb-2"
                      />
                      {loadingSlots ? (
                        <div className="text-[13px]" style={{ color: '#9aa4af' }}>Buscando horarios…</div>
                      ) : slots.length === 0 ? (
                        <div className="text-[13px] rounded-[10px] px-3 py-2" style={{ color: '#a16207', background: '#fef9c3' }}>
                          Sin horarios disponibles ese día.
                        </div>
                      ) : (
                        <div className="grid grid-cols-4 gap-1.5">
                          {slots.map((s) => (
                            <button
                              key={s.startAt}
                              onClick={() => setSlot(s.startAt)}
                              className="text-[13px] font-semibold rounded-[8px] py-2"
                              style={slot === s.startAt ? { background: accent, color: 'white' } : { background: '#f1f5f9', color: '#334155' }}
                            >
                              {s.label}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => { setRescheduling(false); setMsg(null); }}
                          className="flex-1 text-sm font-semibold rounded-[10px] py-2.5"
                          style={{ border: '1px solid #e5e7eb', color: '#475569' }}
                        >
                          Volver
                        </button>
                        <button
                          onClick={reschedule}
                          disabled={busy || !slot}
                          className="flex-1 text-sm font-semibold text-white rounded-[10px] py-2.5"
                          style={{ background: accent, opacity: busy || !slot ? 0.6 : 1 }}
                        >
                          {busy ? '…' : 'Confirmar cambio'}
                        </button>
                      </div>
                    </div>
                  )}

                  {msg && (
                    <div className="text-[13px] rounded-[10px] px-3 py-2 mt-3" style={{ background: '#fef2f2', color: '#b91c1c' }}>
                      {msg}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
        <div className="text-center text-[11px] mt-4" style={{ color: '#c0c6cd' }}>Reservas con Clubify</div>
      </div>
    </div>
  );
}
