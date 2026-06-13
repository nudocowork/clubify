'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

type Info = {
  brandName: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  zones: { id: string; name: string; slug: string; type: string }[];
  defaultSlots: string[];
};

function formatDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nextDates(n = 7) {
  const out: { iso: string; dow: string; day: string }[] = [];
  const dows = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    out.push({ iso: formatDate(d), dow: dows[d.getDay()], day: String(d.getDate()) });
  }
  return out;
}

type SlotAvailability = { time: string; available: boolean; remaining: number };

export default function PublicReservation() {
  const { slug } = useParams<{ slug: string }>();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [party, setParty] = useState(2);
  const [date, setDate] = useState(formatDate(new Date()));
  const [time, setTime] = useState<string | null>(null);
  const [zoneSlug, setZoneSlug] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<any>(null);
  const [availability, setAvailability] = useState<SlotAvailability[] | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);

  useEffect(() => {
    const API = process.env.NEXT_PUBLIC_API_URL ?? '';
    fetch(`${API}/api/public/reservations/${slug}`)
      .then((r) => {
        if (!r.ok) throw new Error('Reservas no disponibles');
        return r.json();
      })
      .then((data) => setInfo(data))
      .catch(() => setError('Este negocio aún no tiene reservas online activadas.'));
  }, [slug]);

  /** Refetch availability cuando cambian (party, date). Si el slot
   *  actualmente elegido queda no-disponible se deselecciona. */
  useEffect(() => {
    if (!info) return;
    const API = process.env.NEXT_PUBLIC_API_URL ?? '';
    setLoadingSlots(true);
    const url = `${API}/api/public/reservations/${slug}/availability?date=${date}&party=${party}${
      zoneSlug ? `&zoneSlug=${zoneSlug}` : ''
    }`;
    fetch(url)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.slots) {
          setAvailability(data.slots);
          if (time && !data.slots.find((s: SlotAvailability) => s.time === time && s.available)) {
            setTime(null);
          }
        }
      })
      .catch(() => setAvailability(null))
      .finally(() => setLoadingSlots(false));
  }, [info, slug, date, party, zoneSlug]);

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-bg2">
        <div className="card card-pad max-w-md text-center">
          <h1 className="text-lg font-semibold">No disponible</h1>
          <p className="text-sm text-mute mt-2">{error}</p>
        </div>
      </main>
    );
  }

  if (!info) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="text-sm text-mute">Cargando…</div>
      </main>
    );
  }

  const dates = nextDates(7);
  const primary = info.primaryColor || '#22C55E';

  async function submit() {
    if (!name.trim() || !phone.trim() || !time) return;
    setSubmitting(true);
    try {
      const API = process.env.NEXT_PUBLIC_API_URL ?? '';
      const r = await fetch(`${API}/api/public/reservations/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: name.trim(),
          customerPhone: phone.trim(),
          party,
          date,
          time,
          notes: notes.trim() || undefined,
          zoneSlug: zoneSlug || undefined,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message || 'No se pudo enviar la solicitud');
      }
      const data = await r.json();
      setConfirmation(data);
      setStep(4);
    } catch (e: any) {
      alert(e.message || 'No se pudo enviar la solicitud');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-bg2 p-4 flex items-start justify-center">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg overflow-hidden">
        <div
          className="px-5 py-4 border-b border-line"
          style={{ background: `linear-gradient(135deg, ${primary}15, transparent)` }}
        >
          <div className="flex items-center gap-3">
            {info.logoUrl && (
              <img src={info.logoUrl} alt="" className="w-10 h-10 rounded-lg object-cover" />
            )}
            <div>
              <h1 className="text-base font-bold m-0">{info.brandName}</h1>
              <p className="text-xs text-mute m-0">Reserva una mesa</p>
            </div>
          </div>
          <div className="flex gap-1 mt-3">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="flex-1 h-1 rounded-full"
                style={{ background: i <= step ? primary : '#e6e8eb' }}
              />
            ))}
          </div>
        </div>

        <div className="p-5">
          {step === 1 && (
            <>
              <h2 className="text-sm font-semibold mb-2">¿Cuántas personas?</h2>
              <div className="grid grid-cols-4 gap-2 mb-4">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((p) => (
                  <button
                    key={p}
                    onClick={() => setParty(p)}
                    className={`py-3 rounded-lg font-bold text-sm ${
                      party === p
                        ? 'text-white'
                        : 'bg-white border border-line text-ink'
                    }`}
                    style={party === p ? { background: primary } : {}}
                  >
                    {p}
                  </button>
                ))}
              </div>

              <h2 className="text-sm font-semibold mb-2">Fecha</h2>
              <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
                {dates.map((d) => (
                  <button
                    key={d.iso}
                    onClick={() => setDate(d.iso)}
                    className={`shrink-0 w-14 py-2 rounded-lg text-center border ${
                      date === d.iso ? 'border-2' : 'border border-line'
                    }`}
                    style={date === d.iso ? { borderColor: primary, background: `${primary}15` } : {}}
                  >
                    <div className="text-[10px] font-bold text-mute">{d.dow}</div>
                    <div className="text-lg font-extrabold">{d.day}</div>
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold m-0">Hora</h2>
                {loadingSlots && (
                  <span className="text-[10px] text-mute">Verificando…</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 mb-2">
                {info.defaultSlots.map((s) => {
                  const slotMeta = availability?.find((a) => a.time === s);
                  const isFull = slotMeta ? !slotMeta.available : false;
                  return (
                    <button
                      key={s}
                      onClick={() => !isFull && setTime(s)}
                      disabled={isFull}
                      className={`py-2 rounded-lg font-semibold text-sm relative ${
                        time === s
                          ? 'text-white'
                          : isFull
                          ? 'bg-bg2 border border-line text-mute cursor-not-allowed line-through opacity-60'
                          : 'bg-white border border-line text-ink'
                      }`}
                      style={time === s ? { background: primary } : {}}
                      title={isFull ? 'Sin lugares disponibles' : ''}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
              {availability && availability.every((a) => !a.available) && (
                <div className="text-xs text-mute mt-1 text-center">
                  Sin lugares disponibles para {party} {party === 1 ? 'persona' : 'personas'} ese día. Probá con otra fecha.
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="text-sm font-semibold mb-3">Elige zona (opcional)</h2>
              <button
                onClick={() => setZoneSlug(null)}
                className={`w-full text-left p-3 rounded-lg mb-2 border ${
                  zoneSlug === null ? 'border-2' : 'border-line'
                }`}
                style={zoneSlug === null ? { borderColor: primary, background: `${primary}15` } : {}}
              >
                <div className="font-semibold text-sm">Sin preferencia</div>
                <div className="text-xs text-mute">El negocio asigna la mejor mesa disponible</div>
              </button>
              {info.zones.map((z) => (
                <button
                  key={z.id}
                  onClick={() => setZoneSlug(z.slug)}
                  className={`w-full text-left p-3 rounded-lg mb-2 border ${
                    zoneSlug === z.slug ? 'border-2' : 'border-line'
                  }`}
                  style={zoneSlug === z.slug ? { borderColor: primary, background: `${primary}15` } : {}}
                >
                  <div className="font-semibold text-sm">{z.name}</div>
                  <div className="text-xs text-mute">{z.type}</div>
                </button>
              ))}
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="text-sm font-semibold mb-3">Tus datos</h2>
              <input
                className="input mb-2"
                placeholder="Nombre completo"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                className="input mb-2"
                placeholder="Teléfono · +52 55 0000 0000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <textarea
                className="input mb-2"
                rows={2}
                placeholder="Notas (alergias, cumpleaños, etc)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <div className="text-xs text-mute mt-2 leading-relaxed">
                El restaurante recibirá tu solicitud y <b>te contactará para confirmar</b> tu mesa.
              </div>
            </>
          )}

          {step === 4 && confirmation && (
            <div className="text-center">
              <div
                className="w-16 h-16 mx-auto rounded-full flex items-center justify-center text-white text-3xl mb-3"
                style={{ background: primary }}
              >
                ✓
              </div>
              <h2 className="text-lg font-bold">¡Solicitud enviada!</h2>
              <p className="text-sm text-mute mt-1">
                El restaurante te contactará para confirmar.
              </p>
              <div className="card card-pad mt-4 text-left">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-[10px] text-mute font-bold">FECHA</div>
                    <div className="text-sm font-bold">{date}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-mute font-bold">HORA</div>
                    <div className="text-sm font-bold">{time}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-mute font-bold">PAX</div>
                    <div className="text-sm font-bold">{party}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step < 4 && (
            <button
              onClick={() => {
                if (step === 3) {
                  submit();
                } else {
                  setStep((step + 1) as 2 | 3);
                }
              }}
              disabled={
                submitting ||
                (step === 1 && !time) ||
                (step === 3 && (!name.trim() || !phone.trim()))
              }
              className="w-full mt-4 py-3 rounded-lg font-bold text-white disabled:opacity-50"
              style={{ background: primary }}
            >
              {submitting ? 'Enviando…' : step === 3 ? 'Confirmar reserva' : 'Continuar'}
            </button>
          )}

          {step === 4 && (
            <button
              onClick={() => {
                setStep(1);
                setName('');
                setPhone('');
                setNotes('');
                setTime(null);
                setZoneSlug(null);
                setConfirmation(null);
              }}
              className="w-full mt-4 py-3 rounded-lg font-semibold border border-line"
            >
              Hacer otra reserva
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
