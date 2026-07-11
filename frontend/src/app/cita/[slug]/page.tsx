'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

// Fase 3 (PDF245 P7): reserva PÚBLICA de servicios (cliente). Elige servicio →
// fecha → horario disponible → datos → confirma. Consume /public/service-
// reservations/:slug (sin auth). 404 si el negocio no tiene el módulo activo.

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Service = {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number | null;
};
type Slot = { startAt: string; label: string };
type Provider = { id: string; name: string; serviceIds: string[] };
type Info = {
  businessName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  timezone: string;
  services: Service[];
  providers: Provider[];
};

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtPrice = (c: number | null) =>
  c == null ? '' : `$${(c / 100).toFixed(2)}`;

export default function CitaPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug as string;
  const [info, setInfo] = useState<Info | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'notfound'>('loading');
  const [serviceId, setServiceId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slot, setSlot] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [booking, setBooking] = useState(false);
  const [done, setDone] = useState<{ startAt: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    fetch(`${API}/api/public/service-reservations/${slug}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: Info) => {
        setInfo(d);
        setServiceId(d.services[0]?.id ?? '');
        setProviderId(d.providers?.[0]?.id ?? '');
        setState('ok');
      })
      .catch(() => setState('notfound'));
  }, [slug]);

  const accent = info?.primaryColor || '#0ea5e9';
  const service = info?.services.find((s) => s.id === serviceId) || null;

  // Profesionales que hacen el servicio elegido (serviceIds vacío = todos).
  const providersForService = (info?.providers ?? []).filter(
    (p) => p.serviceIds.length === 0 || p.serviceIds.includes(serviceId),
  );
  const hasProviders = providersForService.length > 0;
  // Si el profesional elegido no hace el nuevo servicio, resetea al primero.
  useEffect(() => {
    if (
      hasProviders &&
      (!providerId || !providersForService.some((p) => p.id === providerId))
    ) {
      setProviderId(providersForService[0].id);
    }
    if (!hasProviders && providerId) setProviderId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId, info]);

  const loadSlots = useCallback(async () => {
    if (!serviceId || !date) return;
    if (hasProviders && !providerId) return;
    setLoadingSlots(true);
    setSlot('');
    try {
      const q = `serviceId=${serviceId}&date=${date}${providerId ? `&providerId=${providerId}` : ''}`;
      const r = await fetch(
        `${API}/api/public/service-reservations/${slug}/slots?${q}`,
      );
      const d = r.ok ? await r.json() : { slots: [] };
      setSlots(d?.slots ?? []);
    } catch {
      setSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  }, [slug, serviceId, date, providerId, hasProviders]);
  useEffect(() => {
    if (state === 'ok') loadSlots();
  }, [state, loadSlots]);

  async function book() {
    setErr(null);
    if (!serviceId || !slot) {
      setErr('Elige un servicio y un horario.');
      return;
    }
    if (!name.trim() || phone.trim().length < 6) {
      setErr('Escribe tu nombre y un teléfono válido.');
      return;
    }
    setBooking(true);
    try {
      const r = await fetch(
        `${API}/api/public/service-reservations/${slug}/book`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serviceId,
            providerId: providerId || undefined,
            startAt: slot,
            customerName: name.trim(),
            customerPhone: phone.trim(),
          }),
        },
      );
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(d?.message || 'No se pudo reservar. Intenta con otro horario.');
        loadSlots();
        return;
      }
      setDone({ startAt: d.startAt || slot });
    } catch {
      setErr('Error de conexión. Intenta de nuevo.');
    } finally {
      setBooking(false);
    }
  }

  if (state === 'loading') {
    return (
      <Shell>
        <div className="text-sm text-center py-16" style={{ color: '#9aa4af' }}>
          Cargando…
        </div>
      </Shell>
    );
  }
  if (state === 'notfound') {
    return (
      <Shell>
        <div className="text-center py-16">
          <div className="text-4xl mb-2">📅</div>
          <div className="font-bold text-lg">Reservas no disponibles</div>
          <div className="text-sm mt-1" style={{ color: '#9aa4af' }}>
            Este negocio no tiene la agenda de servicios habilitada.
          </div>
        </div>
      </Shell>
    );
  }

  if (done) {
    const when = new Intl.DateTimeFormat('es-CO', {
      timeZone: info?.timezone || 'America/Bogota',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(done.startAt));
    return (
      <Shell info={info} accent={accent}>
        <div className="text-center py-10">
          <div className="text-5xl mb-3">✅</div>
          <div className="font-bold text-lg">¡Cita confirmada!</div>
          <div className="text-sm mt-2" style={{ color: '#475569' }}>
            {service?.name}
          </div>
          <div className="text-base font-semibold mt-1" style={{ color: accent }}>
            {when}
          </div>
          <div className="text-xs mt-4" style={{ color: '#9aa4af' }}>
            {name} · {phone}
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell info={info} accent={accent}>
      <div className="space-y-5">
        {/* Servicio */}
        <div>
          <div className="text-xs font-bold uppercase mb-2" style={{ color: '#6b7280' }}>
            1. Elige el servicio
          </div>
          {info!.services.length === 0 ? (
            <div className="text-sm" style={{ color: '#9aa4af' }}>
              No hay servicios disponibles por ahora.
            </div>
          ) : (
            <div className="space-y-1.5">
              {info!.services.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setServiceId(s.id)}
                  className="w-full text-left p-3 rounded-[12px] flex items-center justify-between gap-2"
                  style={{
                    border: `1.5px solid ${serviceId === s.id ? accent : '#e7e9ec'}`,
                    background: serviceId === s.id ? `${accent}0d` : 'white',
                  }}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold" style={{ color: '#16241c' }}>
                      {s.name}
                    </div>
                    <div className="text-[12px]" style={{ color: '#6b7785' }}>
                      {s.durationMin} min{s.priceCents != null ? ` · ${fmtPrice(s.priceCents)}` : ''}
                    </div>
                  </div>
                  {serviceId === s.id && <span style={{ color: accent }}>●</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Profesional (si el negocio tiene) */}
        {hasProviders && (
          <div>
            <div className="text-xs font-bold uppercase mb-2" style={{ color: '#6b7280' }}>
              Con quién
            </div>
            <div className="flex flex-wrap gap-1.5">
              {providersForService.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setProviderId(p.id)}
                  className="text-[13px] font-semibold rounded-[10px] px-3 py-1.5"
                  style={
                    providerId === p.id
                      ? { background: accent, color: 'white' }
                      : { background: '#f1f5f9', color: '#334155' }
                  }
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Fecha + horario */}
        <div>
          <div className="text-xs font-bold uppercase mb-2" style={{ color: '#6b7280' }}>
            2. Elige fecha y hora
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
              No hay horarios disponibles ese día. Prueba otra fecha.
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              {slots.map((s) => (
                <button
                  key={s.startAt}
                  onClick={() => setSlot(s.startAt)}
                  className="text-[13px] font-semibold rounded-[8px] py-2"
                  style={
                    slot === s.startAt
                      ? { background: accent, color: 'white' }
                      : { background: '#f1f5f9', color: '#334155' }
                  }
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Datos */}
        <div>
          <div className="text-xs font-bold uppercase mb-2" style={{ color: '#6b7280' }}>
            3. Tus datos
          </div>
          <input
            className="w-full rounded-[10px] border border-[#dfe3e8] px-3 py-2 text-sm mb-2"
            placeholder="Tu nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="w-full rounded-[10px] border border-[#dfe3e8] px-3 py-2 text-sm"
            placeholder="Tu teléfono / WhatsApp"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>

        {err && (
          <div className="text-[13px] rounded-[10px] px-3 py-2" style={{ background: '#fef2f2', color: '#b91c1c' }}>
            {err}
          </div>
        )}

        <button
          onClick={book}
          disabled={booking || !slot}
          className="w-full text-sm font-bold text-white rounded-[12px] py-3"
          style={{ background: accent, opacity: booking || !slot ? 0.6 : 1 }}
        >
          {booking ? 'Reservando…' : 'Confirmar reserva'}
        </button>
      </div>
    </Shell>
  );
}

function Shell({
  children,
  info,
  accent = '#0ea5e9',
}: {
  children: React.ReactNode;
  info?: Info | null;
  accent?: string;
}) {
  return (
    <div style={{ background: '#f6f7f9', minHeight: '100vh' }}>
      <div className="max-w-md mx-auto px-4 py-6">
        {info && (
          <div className="flex items-center gap-3 mb-5">
            {info.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={info.logoUrl} alt="" className="w-11 h-11 rounded-full object-cover" />
            ) : (
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold"
                style={{ background: accent }}
              >
                {info.businessName?.[0] ?? '·'}
              </div>
            )}
            <div>
              <div className="font-bold text-[15px]" style={{ color: '#16241c' }}>
                {info.businessName}
              </div>
              <div className="text-[12px]" style={{ color: '#9aa4af' }}>
                Agenda tu cita
              </div>
            </div>
          </div>
        )}
        <div className="bg-white rounded-[16px] p-4" style={{ border: '1px solid #e7e9ec' }}>
          {children}
        </div>
        <div className="text-center text-[11px] mt-4" style={{ color: '#c0c6cd' }}>
          Reservas con Clubify
        </div>
      </div>
    </div>
  );
}
