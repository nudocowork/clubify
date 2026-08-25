'use client';
import { useEffect, useState } from 'react';
import { safeBrandColor, autoTextColor } from '@/lib/contrast';
import { useParams } from 'next/navigation';
import { PhoneInput } from '@/components/PhoneInput';

type Info = {
  brandName: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  zones: { id: string; name: string; slug: string; type: string; locationId?: string | null }[];
  // F2: sedes del negocio. Si hay >1, el cliente elige a cuál reservar primero.
  locations?: { id: string; name: string; address?: string | null }[];
  // F3: cantidad máxima que entra en la mesa más grande. Un grupo mayor se
  // deriva a WhatsApp para atención personalizada.
  maxPartyOnline?: number;
  whatsapp?: string | null;
  defaultSlots: string[];
  // Días de la semana habilitados (0=Dom..6=Sáb). Vacío/undefined = todos.
  reservationDays?: number[];
  // Observaciones/términos que el negocio muestra antes de reservar.
  reservationTerms?: string | null;
};

function formatDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "13:00" → "1:00 p.m." */
function to12h(time: string): string {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return time;
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'p.m.' : 'a.m.';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/** Próximas `count` fechas reservables. Si el negocio configuró días
 *  habilitados (0=Dom..6=Sáb), salta los días cerrados mirando hasta
 *  `lookAhead` días adelante para juntar igual `count` opciones. */
function nextDates(allowedDays?: number[], count = 7, lookAhead = 30) {
  const out: { iso: string; dow: string; day: string }[] = [];
  const dows = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
  const hasFilter = Array.isArray(allowedDays) && allowedDays.length > 0;
  for (let i = 0; i < lookAhead && out.length < count; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    if (hasFilter && !allowedDays!.includes(d.getDay())) continue;
    out.push({ iso: formatDate(d), dow: dows[d.getDay()], day: String(d.getDate()) });
  }
  return out;
}

type SlotAvailability = { time: string; available: boolean; remaining: number };

type TableLite = {
  id: string;
  number: string;
  seats: number;
  shape: string;
  posX: number;
  posY: number;
  width: number | null;
  height: number | null;
  isBlocked: boolean;
  taken: boolean;
};

/** Dimensiones visuales de una mesa según forma/capacidad (espejo del panel). */
function tableDims(t: TableLite) {
  const round = t.shape === 'ROUND';
  const w =
    t.width ??
    (round ? (t.seats <= 2 ? 54 : t.seats <= 4 ? 66 : 80) : t.shape === 'BAR' ? 130 : 100);
  const h = t.height ?? (round ? w : t.shape === 'BAR' ? 50 : 60);
  return { w, h, round };
}

/** Plano visual de las mesas de una zona (popup). Escala el bounding box de las
 *  mesas para caber en el modal; cada mesa es seleccionable si está libre. */
function PlanCanvas({
  tables,
  selected,
  party,
  primary,
  onPick,
}: {
  tables: TableLite[];
  selected: string | null;
  party: number;
  primary: string;
  onPick: (id: string) => void;
}) {
  const PAD = 20;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const t of tables) {
    const d = tableDims(t);
    minX = Math.min(minX, t.posX);
    minY = Math.min(minY, t.posY);
    maxX = Math.max(maxX, t.posX + d.w);
    maxY = Math.max(maxY, t.posY + d.h);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 300;
    maxY = 200;
  }
  const boxW = maxX - minX + PAD * 2;
  const boxH = maxY - minY + PAD * 2;
  const scale = Math.min(1, 320 / boxW);
  return (
    <div
      className="relative mx-auto rounded-xl border border-line bg-bg2/40 overflow-hidden"
      style={{ width: boxW * scale, height: boxH * scale }}
    >
      {tables.map((tb) => {
        const d = tableDims(tb);
        const disabled = tb.isBlocked || tb.taken || tb.seats < party;
        const sel = selected === tb.id;
        return (
          <button
            key={tb.id}
            disabled={disabled}
            onClick={() => onPick(tb.id)}
            className="absolute flex flex-col items-center justify-center text-center"
            style={{
              left: (tb.posX - minX + PAD) * scale,
              top: (tb.posY - minY + PAD) * scale,
              width: d.w * scale,
              height: d.h * scale,
              borderRadius: d.round ? '50%' : 8 * scale,
              background: sel ? primary : disabled ? '#f1f5f9' : '#fff',
              color: sel ? '#fff' : disabled ? '#94a3b8' : '#0f172a',
              border: `1.5px solid ${sel ? primary : '#cbd5e1'}`,
              opacity: disabled ? 0.6 : 1,
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
            title={
              tb.isBlocked
                ? 'No disponible'
                : tb.taken
                  ? 'Ya reservada'
                  : tb.seats < party
                    ? `Capacidad ${tb.seats}`
                    : `Mesa ${tb.number}`
            }
          >
            <span style={{ fontWeight: 800, fontSize: 12 * scale }}>{tb.number}</span>
            <span style={{ fontSize: 9 * scale, opacity: 0.8 }}>{tb.seats}p</span>
          </button>
        );
      })}
    </div>
  );
}

export default function PublicReservation() {
  const { slug } = useParams<{ slug: string }>();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [party, setParty] = useState(2);
  // F3: modo de cantidad — botones fijos o "Otro" (input libre).
  const [partyMode, setPartyMode] = useState<'preset' | 'otro'>('preset');
  const [customParty, setCustomParty] = useState('');
  // F2: sede elegida (null = negocio de 1 sede o sin elegir todavía).
  const [locationId, setLocationId] = useState<string | null>(null);
  const [date, setDate] = useState(formatDate(new Date()));
  const [time, setTime] = useState<string | null>(null);
  const [zoneSlug, setZoneSlug] = useState<string | null>(null);
  const [tableId, setTableId] = useState<string | null>(null);
  const [tables, setTables] = useState<TableLite[] | null>(null);
  const [loadingTables, setLoadingTables] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
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

  // Si el negocio restringe días y la fecha por default (hoy) cae en un día
  // cerrado, saltar a la primera fecha reservable para no arrancar en inválido.
  useEffect(() => {
    if (!info) return;
    const allowed = info.reservationDays;
    if (!Array.isArray(allowed) || allowed.length === 0) return;
    const [y, m, d] = date.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    if (!allowed.includes(dow)) {
      const first = nextDates(allowed, 1)[0];
      if (first) setDate(first.iso);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  /** Refetch availability cuando cambian (party, date). Si el slot
   *  actualmente elegido queda no-disponible se deselecciona. */
  useEffect(() => {
    if (!info) return;
    const API = process.env.NEXT_PUBLIC_API_URL ?? '';
    setLoadingSlots(true);
    const url = `${API}/api/public/reservations/${slug}/availability?date=${date}&party=${party}${
      zoneSlug ? `&zoneSlug=${zoneSlug}` : ''
    }${locationId ? `&locationId=${locationId}` : ''}`;
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
  }, [info, slug, date, party, zoneSlug, locationId]);

  /** Mesas de la zona elegida (PDF Software 2026-06-29). Solo cuando hay una
   *  zona específica seleccionada (no en "asignación automática"). Recalcula al
   *  cambiar zona/fecha/hora para reflejar mesas tomadas. */
  useEffect(() => {
    setTableId(null);
    if (!info || !zoneSlug) {
      setTables(null);
      return;
    }
    const API = process.env.NEXT_PUBLIC_API_URL ?? '';
    setLoadingTables(true);
    const url = `${API}/api/public/reservations/${slug}/tables?zoneSlug=${zoneSlug}&date=${date}${
      time ? `&time=${time}` : ''
    }${locationId ? `&locationId=${locationId}` : ''}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setTables(d?.tables ?? []))
      .catch(() => setTables(null))
      .finally(() => setLoadingTables(false));
  }, [info, slug, zoneSlug, date, time]);

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

  const dates = nextDates(info.reservationDays, 7);
  // Validado, no solo «no vacío»: un negocio tenía el NOMBRE escrito en el
  // campo del color, el navegador ignoraba el `background` y el botón
  // seleccionado quedaba blanco sobre blanco — invisible. Se veía como si la
  // pantalla no reaccionara al clic.
  const primary = safeBrandColor(info.primaryColor);
  // El texto de lo seleccionado NO puede ser blanco fijo: hay marcas con color
  // claro (una con #ffffff) donde quedaría igual de ilegible.
  const onPrimary = autoTextColor(primary);

  // F2: negocio con >1 sede → primero elige sede, luego zonas de esa sede.
  const multiSede = (info.locations?.length ?? 0) > 1;
  const visibleZones = locationId
    ? info.zones.filter((z) => z.locationId === locationId)
    : info.zones;

  // F3: cantidad. presets 1..min(8, maxSeat); "Otro" abre input libre; si supera
  // la mesa más grande (maxSeat), se deriva a WhatsApp.
  const maxSeat = info.maxPartyOnline && info.maxPartyOnline > 0 ? info.maxPartyOnline : 20;
  const presetMax = Math.min(8, maxSeat);
  const presets = Array.from({ length: presetMax }, (_, i) => i + 1);
  const otroNum = parseInt(customParty, 10);
  const overflow =
    partyMode === 'otro' && Number.isFinite(otroNum) && otroNum > maxSeat;
  const otroValid =
    partyMode !== 'otro' ||
    (Number.isFinite(otroNum) && otroNum >= 1 && !overflow);
  const waDigits = (info.whatsapp || '').replace(/\D/g, '');
  const waOverflowHref = waDigits
    ? `https://wa.me/${waDigits}?text=${encodeURIComponent(
        `Hola, quiero reservar para ${customParty || party} personas el ${date}. ¿Me ayudan a coordinar una mesa?`,
      )}`
    : null;

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
          tableId: tableId || undefined,
          locationId: locationId || undefined,
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
              {info.reservationTerms?.trim() && (
                <div
                  className="mb-4 rounded-xl p-3.5 flex items-start gap-2.5 text-left"
                  style={{ background: `${primary}0f`, border: `1px solid ${primary}44` }}
                >
                  <span className="text-base shrink-0">📋</span>
                  <div className="text-xs leading-relaxed whitespace-pre-line text-ink/90 min-w-0">
                    {info.reservationTerms}
                  </div>
                </div>
              )}
              <h2 className="text-sm font-semibold mb-2">¿Cuántas personas?</h2>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {presets.map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setPartyMode('preset');
                      setParty(p);
                    }}
                    className={`py-3 rounded-lg font-bold text-sm ${
                      partyMode === 'preset' && party === p
                        ? 'text-white'
                        : 'bg-white border border-line text-ink'
                    }`}
                    style={
                      partyMode === 'preset' && party === p
                        ? { background: primary, color: onPrimary }
                        : {}
                    }
                  >
                    {p}
                  </button>
                ))}
                <button
                  onClick={() => setPartyMode('otro')}
                  className={`py-3 rounded-lg font-bold text-sm ${
                    partyMode === 'otro'
                      ? 'text-white'
                      : 'bg-white border border-line text-ink'
                  }`}
                  style={
                    partyMode === 'otro'
                      ? { background: primary, color: onPrimary }
                      : {}
                  }
                >
                  Otro
                </button>
              </div>
              {partyMode === 'otro' && (
                <div className="mb-4">
                  <input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={customParty}
                    onChange={(e) => {
                      const v = e.target.value;
                      setCustomParty(v);
                      const n = parseInt(v, 10);
                      if (Number.isFinite(n) && n >= 1 && n <= maxSeat) setParty(n);
                    }}
                    placeholder="Escribe la cantidad de personas"
                    className="w-full py-3 px-3 rounded-lg border border-line text-sm mb-2"
                  />
                  {overflow && (
                    <div
                      className="p-3 rounded-lg"
                      style={{ background: `${primary}0f`, border: `1px solid ${primary}44` }}
                    >
                      <div className="font-semibold text-sm mb-1">Grupo grande 🎉</div>
                      <div className="text-xs text-mute mb-2">
                        Para {otroNum} personas coordinamos la mesa de forma
                        personalizada. Escríbenos y te acomodamos.
                      </div>
                      {waOverflowHref ? (
                        <a
                          href={waOverflowHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg font-bold text-white text-sm"
                          style={{ background: '#25D366' }}
                        >
                          💬 Coordinar por WhatsApp
                        </a>
                      ) : (
                        <div className="text-xs text-mute">
                          Contacta al negocio para coordinar tu reserva.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

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
                      style={
                        time === s ? { background: primary, color: onPrimary } : {}
                      }
                      title={isFull ? 'Sin lugares disponibles' : ''}
                    >
                      {to12h(s)}
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

          {step === 2 && multiSede && !locationId && (
            <>
              <h2 className="text-sm font-semibold mb-3">Elige tu sede</h2>
              <p className="text-xs text-mute mb-3">
                ¿En cuál de nuestras sedes querés reservar?
              </p>
              {(info.locations ?? []).map((loc) => (
                <button
                  key={loc.id}
                  onClick={() => {
                    setLocationId(loc.id);
                    setZoneSlug(null);
                    setTableId(null);
                  }}
                  className="w-full text-left p-3 rounded-2xl mb-2 border-2 transition flex items-center gap-3"
                  style={{ borderColor: '#e2e8f0', background: 'white' }}
                >
                  <div className="w-10 h-10 rounded-xl bg-bg2 flex items-center justify-center text-base shrink-0">
                    📍
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm">{loc.name}</div>
                    {loc.address && (
                      <div className="text-xs text-mute truncate">{loc.address}</div>
                    )}
                  </div>
                </button>
              ))}
            </>
          )}

          {step === 2 && (!multiSede || !!locationId) && (
            <>
              {multiSede && (
                <button
                  onClick={() => {
                    setLocationId(null);
                    setZoneSlug(null);
                    setTableId(null);
                  }}
                  className="text-xs font-semibold mb-2"
                  style={{ color: primary }}
                >
                  ← Cambiar sede
                </button>
              )}
              <h2 className="text-sm font-semibold mb-3">Elige tu lugar</h2>
              <button
                onClick={() => setZoneSlug(null)}
                className={`w-full text-left p-3 rounded-2xl mb-3 border-2 transition flex items-center gap-3 ${
                  zoneSlug === null ? 'shadow-md' : ''
                }`}
                style={
                  zoneSlug === null
                    ? { borderColor: primary, background: `${primary}10` }
                    : { borderColor: '#e2e8f0', background: 'white' }
                }
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-base shrink-0"
                  style={{ background: primary, color: onPrimary }}
                >
                  ✨
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">Asignación automática</div>
                  <div className="text-xs text-mute">Te damos la mejor mesa disponible</div>
                </div>
                {zoneSlug === null && (
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs shrink-0"
                    style={{ background: primary, color: onPrimary }}
                  >
                    ✓
                  </div>
                )}
              </button>

              {visibleZones.length > 0 && (
                <>
                  <div className="text-[10px] uppercase tracking-wider text-mute font-bold mb-2 mt-4">
                    O elige zona
                  </div>
                  {visibleZones.map((z) => {
                    const zoneIcons: Record<string, string> = {
                      OUTDOOR: '☀️',
                      INDOOR: '🏠',
                      BAR: '🍸',
                      PRIVATE: '👑',
                    };
                    const zoneLabel: Record<string, string> = {
                      OUTDOOR: 'Mesas al aire libre',
                      INDOOR: 'Mesas interiores',
                      BAR: 'En la barra',
                      PRIVATE: 'Bajo solicitud',
                    };
                    return (
                      <button
                        key={z.id}
                        onClick={() => setZoneSlug(z.slug)}
                        className={`w-full text-left p-3 rounded-2xl mb-2 border-2 transition flex items-center gap-3`}
                        style={
                          zoneSlug === z.slug
                            ? { borderColor: primary, background: `${primary}10` }
                            : { borderColor: '#e2e8f0', background: 'white' }
                        }
                      >
                        <div className="w-10 h-10 rounded-xl bg-bg2 flex items-center justify-center text-base shrink-0">
                          {zoneIcons[z.type] ?? '·'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm">{z.name}</div>
                          <div className="text-xs text-mute">
                            {zoneLabel[z.type] ?? z.type}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </>
              )}

              {/* PDF Software 2026-06-29: al elegir una zona, mostramos sus mesas
                  para que el cliente elija una (opcional) + botón "Ver plano". */}
              {zoneSlug && (
                <div className="mt-5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] uppercase tracking-wider text-mute font-bold">
                      Elige tu mesa (opcional)
                    </div>
                    {tables && tables.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowPlan(true)}
                        className="text-xs font-semibold"
                        style={{ color: primary }}
                      >
                        🗺️ Ver plano
                      </button>
                    )}
                  </div>
                  {loadingTables ? (
                    <div className="text-xs text-mute py-2">Cargando mesas…</div>
                  ) : !tables || tables.length === 0 ? (
                    <div className="text-xs text-mute py-2">
                      Esta zona no tiene mesas configuradas. Se asignará automáticamente.
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 gap-2">
                      {tables.map((tb) => {
                        const disabled = tb.isBlocked || tb.taken || tb.seats < party;
                        const sel = tableId === tb.id;
                        return (
                          <button
                            key={tb.id}
                            type="button"
                            disabled={disabled}
                            onClick={() => setTableId(sel ? null : tb.id)}
                            className={`py-2 rounded-lg border text-center ${
                              disabled ? 'opacity-40 cursor-not-allowed line-through' : ''
                            }`}
                            style={
                              sel
                                ? { background: primary, color: onPrimary, borderColor: primary }
                                : { borderColor: '#e2e8f0', background: 'white' }
                            }
                            title={
                              tb.isBlocked
                                ? 'No disponible'
                                : tb.taken
                                  ? 'Ya reservada'
                                  : tb.seats < party
                                    ? `Capacidad ${tb.seats}`
                                    : `Mesa ${tb.number}`
                            }
                          >
                            <div className="text-sm font-bold">{tb.number}</div>
                            <div className="text-[10px] opacity-80">{tb.seats}p</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
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
              <div className="mb-2">
                <PhoneInput value={phone} onChange={setPhone} />
              </div>
              <textarea
                className="input mb-2"
                rows={3}
                placeholder="Notas (alergias, cumpleaños, silla bebé...)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <div
                className="mt-2 rounded-xl p-3 flex items-start gap-2.5 text-left text-xs"
                style={{ background: `${primary}10`, border: `1px solid ${primary}40` }}
              >
                <span className="text-base shrink-0">📞</span>
                <div className="leading-snug">
                  El restaurante recibirá tu solicitud y{' '}
                  <strong>te contactará para confirmar</strong> tu mesa. No necesitas instalar nada.
                </div>
              </div>
            </>
          )}

          {step === 4 && confirmation && (
            <div className="text-center">
              <div
                className="w-16 h-16 mx-auto rounded-full flex items-center justify-center text-white text-3xl mb-3"
                style={{ background: primary, color: onPrimary }}
              >
                ✓
              </div>
              <h2 className="text-lg font-bold">¡Reserva enviada!</h2>
              <p className="text-sm text-mute mt-1 leading-snug">
                {info.brandName} te contactará para confirmar.
              </p>

              {/* Ticket */}
              <div className="bg-white border border-line rounded-2xl mt-4 overflow-hidden text-left">
                <div className="p-4 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-mute font-bold">
                      Tu reserva
                    </div>
                    <div className="text-sm font-semibold truncate">{info.brandName}</div>
                  </div>
                  {confirmation.passUrl && (
                    <a
                      href={confirmation.passUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="w-12 h-12 rounded-xl bg-ink text-white flex items-center justify-center text-xl shrink-0"
                      title="Ver pase digital con QR"
                    >
                      🔳
                    </a>
                  )}
                </div>
                <div className="border-t border-dashed border-line px-4 py-3 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-[10px] text-mute font-bold">FECHA</div>
                    <div className="text-sm font-bold">{date}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-mute font-bold">HORA</div>
                    <div className="text-sm font-bold">{time ? to12h(time) : ''}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-mute font-bold">PAX</div>
                    <div className="text-sm font-bold">{party}</div>
                  </div>
                </div>
                <div className="border-t border-dashed border-line px-4 py-3">
                  <div className="text-[10px] text-mute font-bold">MESA</div>
                  <div className="text-sm font-bold">
                    {(() => {
                      const zoneName = zoneSlug
                        ? info.zones.find((z) => z.slug === zoneSlug)?.name ?? null
                        : null;
                      const tbl =
                        tableId && tables ? tables.find((tt) => tt.id === tableId) : null;
                      if (tbl)
                        return `Mesa ${tbl.number}${zoneName ? ` · ${zoneName}` : ''}`;
                      return zoneName ?? 'Asignación automática';
                    })()}
                  </div>
                </div>
              </div>

              {/* Pase digital CTA */}
              {confirmation.passUrl && (
                <a
                  href={confirmation.passUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 w-full block py-3 rounded-xl font-bold text-white text-sm"
                  style={{ background: '#0f172a' }}
                >
                  📱 Ver pase digital
                </a>
              )}

              {/* Sello conversion teaser */}
              <div
                className="mt-3 rounded-2xl p-3 flex items-start gap-2.5 text-left"
                style={{ background: '#f5f3ff', border: '1px solid #ddd6fe' }}
              >
                <span className="text-base shrink-0">🎁</span>
                <div className="text-xs leading-snug text-purple-900">
                  Cuando llegues, tu reserva se convierte en{' '}
                  <strong>+1 sello</strong> en la tarjeta de fidelización de{' '}
                  <strong>{info.brandName}</strong>.
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
                (step === 1 && (!time || !otroValid)) ||
                (step === 2 && multiSede && !locationId) ||
                (step === 3 && (!name.trim() || !phone.trim()))
              }
              className="w-full mt-4 py-3 rounded-lg font-bold text-white disabled:opacity-50"
              style={{ background: primary, color: onPrimary }}
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
                setTableId(null);
                setLocationId(null);
                setPartyMode('preset');
                setCustomParty('');
                setParty(2);
                setShowPlan(false);
                setConfirmation(null);
              }}
              className="w-full mt-4 py-3 rounded-lg font-semibold border border-line"
            >
              Hacer otra reserva
            </button>
          )}
        </div>
      </div>

      {/* Popup del plano de mesas (PDF Software 2026-06-29) */}
      {showPlan && tables && tables.length > 0 && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setShowPlan(false)}
        >
          <div
            className="bg-white rounded-2xl p-4 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm m-0">Plano de mesas</h3>
              <button
                onClick={() => setShowPlan(false)}
                className="text-mute text-lg leading-none"
              >
                ✕
              </button>
            </div>
            <PlanCanvas
              tables={tables}
              selected={tableId}
              party={party}
              primary={primary}
              onPick={(id) => {
                setTableId(id);
                setShowPlan(false);
              }}
            />
            <p className="text-[11px] text-mute mt-3 text-center">
              Toca una mesa disponible para elegirla.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
