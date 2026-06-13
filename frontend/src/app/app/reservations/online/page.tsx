'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { fmtLongDate, todayISO, to12h } from '../_shared';

type Tenant = {
  slug: string;
  brandName?: string;
};

export default function ReservaOnlinePage() {
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    api<Tenant>('/tenants/me')
      .then(setTenant)
      .catch(() => null);
  }, []);

  const publicUrl = tenant?.slug ? `https://soyclubify.com/reserva/${tenant.slug}` : '';

  function copyLink() {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl).then(
      () => toast('Enlace copiado', 'success'),
      () => toast('No se pudo copiar', 'error'),
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="page-title m-0">
            Reserva online <span className="page-crumb text-mute font-normal">/ {fmtLongDate(todayISO())}</span>
          </h1>
          <p className="text-xs text-mute mt-1">Experiencia de reserva del cliente</p>
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-ok-soft text-ok-ink text-xs font-semibold">
          <span className="relative inline-block w-2 h-2">
            <span className="absolute inset-0 rounded-full bg-ok animate-ping opacity-75" />
            <span className="absolute inset-0 rounded-full bg-ok" />
          </span>
          Tiempo real
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-8 items-start">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-ok-soft text-ok-ink text-xs font-semibold mb-3">
            📱 Experiencia del cliente
          </div>
          <h2 className="text-3xl font-extrabold m-0 leading-tight">
            Reserva online, dentro de la web de Clubify
          </h2>
          <p className="text-sm text-mute mt-3 leading-relaxed max-w-md">
            Sin apps externas. El cliente reserva en 4 pasos; tu negocio recibe el aviso al
            instante por WhatsApp y confirma manualmente. El pase digital queda con QR para
            mostrar al llegar.
          </p>

          <div className="space-y-4 mt-6 max-w-md">
            {[
              {
                icon: '📐',
                title: 'Disponibilidad real',
                body: 'Validación de capacidad sincronizada con el plano admin al segundo.',
              },
              {
                icon: '💬',
                title: 'Aviso al negocio',
                body: 'El negocio recibe la reserva al instante por WhatsApp y contacta al cliente.',
              },
              {
                icon: '🎟',
                title: 'Pase digital con QR',
                body: 'El cliente confirmado recibe link al pase web con su QR. Próximamente Apple/Google Wallet.',
              },
              {
                icon: '👥',
                title: 'Alimenta el CRM',
                body: 'Cada reserva crea o enriquece la ficha del cliente con tag "reserva" y stamps.',
              },
            ].map((f) => (
              <div key={f.title} className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-ok-soft flex items-center justify-center shrink-0 text-base">
                  {f.icon}
                </div>
                <div>
                  <div className="font-semibold text-sm">{f.title}</div>
                  <div className="text-xs text-mute leading-snug">{f.body}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Configuración de horarios disponibles */}
          <SlotsConfigCard />

          <div className="card card-pad mt-6 max-w-md">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-xl bg-ink/90 flex items-center justify-center text-white shrink-0">
                <span className="text-xl">🔳</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">Comparte por QR o enlace directo</div>
                <div className="text-xs text-mute leading-snug mt-0.5">
                  Pégalo en mesas, redes o el menú digital. Cada sede tiene su propio enlace.
                </div>
                {publicUrl && (
                  <div className="mt-3 flex items-center gap-2">
                    <code className="text-[11px] bg-bg2 px-2 py-1.5 rounded flex-1 truncate">
                      {publicUrl}
                    </code>
                    <button onClick={copyLink} className="btn-ghost text-xs px-3 py-1.5">
                      Copiar
                    </button>
                    <a
                      href={publicUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-primary text-xs px-3 py-1.5"
                    >
                      Abrir
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* iPhone mockup */}
        <div className="flex justify-center">
          <div
            className="relative rounded-[40px] p-3 shadow-2xl"
            style={{ background: '#0f172a', width: 320 }}
          >
            <div
              className="rounded-[28px] overflow-hidden"
              style={{ background: 'white', minHeight: 580 }}
            >
              <div className="px-5 py-4 border-b border-line">
                <div className="text-xs text-mute">21:04</div>
                <div className="font-bold text-base mt-1">{tenant?.brandName ?? 'Tu negocio'}</div>
                <div className="text-[11px] text-mute mt-0.5">Reserva una mesa</div>
                <div className="flex gap-1 mt-3">
                  <div className="flex-1 h-1 rounded-full bg-ok" />
                  <div className="flex-1 h-1 rounded-full bg-line" />
                  <div className="flex-1 h-1 rounded-full bg-line" />
                  <div className="flex-1 h-1 rounded-full bg-line" />
                </div>
              </div>
              <div className="p-4">
                <div className="text-xs font-semibold mb-2">¿Cuántas personas?</div>
                <div className="grid grid-cols-4 gap-1.5 mb-4">
                  {[1, 2, 3, 4, 5, 6, 7, '8+'].map((p, i) => (
                    <div
                      key={i}
                      className={`text-center py-2 rounded-lg text-xs font-bold ${
                        p === 2
                          ? 'bg-ink text-white'
                          : 'bg-white border border-line'
                      }`}
                    >
                      {p}
                    </div>
                  ))}
                </div>
                <div className="text-xs font-semibold mb-2">Fecha</div>
                <div className="flex gap-1.5 mb-4 overflow-x-auto">
                  {['VIE 12', 'SÁB 13', 'DOM 14', 'LUN 15', 'MAR 16'].map((d, i) => (
                    <div
                      key={i}
                      className={`shrink-0 px-2.5 py-1.5 rounded-lg text-[10px] font-bold border ${
                        i === 0 ? 'border-ok bg-ok-soft text-ok-ink' : 'border-line'
                      }`}
                    >
                      {d}
                    </div>
                  ))}
                </div>
                <div className="text-xs font-semibold mb-2">Hora disponible</div>
                <MockSlots />
                <div className="mt-5 text-center py-2.5 rounded-xl text-white font-bold text-sm bg-ok">
                  Continuar
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MockSlots() {
  const [slots, setSlots] = useState<string[]>([]);
  useEffect(() => {
    api<{ slots: string[] }>(`/reservations/config/slots`)
      .then((d) => setSlots(d.slots))
      .catch(() => setSlots(['13:00', '13:30', '14:00', '21:00', '21:30', '22:00']));
  }, []);
  const shown = slots.slice(0, 6);
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {shown.map((t, i) => (
        <div
          key={t}
          className={`text-center py-1.5 rounded-lg text-[10px] font-semibold border ${
            i === 0
              ? 'bg-ink text-white border-ink'
              : i === 2
              ? 'border-line text-mute line-through opacity-50'
              : 'border-line'
          }`}
        >
          {to12h(t)}
        </div>
      ))}
      {shown.length === 0 && (
        <div className="col-span-3 text-center text-[10px] text-mute italic py-2">
          Sin horarios configurados
        </div>
      )}
    </div>
  );
}

function SlotsConfigCard() {
  const [slots, setSlots] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    api<{ slots: string[] }>(`/reservations/config/slots`)
      .then((d) => {
        setSlots(d.slots);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  // Generar la grilla de slots posibles (cada 30 min)
  const ALL_SLOTS = useMemo(() => {
    const arr: string[] = [];
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 30]) {
        arr.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
    }
    return arr;
  }, []);

  function toggleSlot(s: string) {
    setSlots((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s].sort()));
  }

  async function save() {
    setBusy(true);
    try {
      await api(`/reservations/config/slots`, {
        method: 'PATCH',
        body: JSON.stringify({ slots }),
      });
      toast('Horarios guardados', 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar', 'error');
    } finally {
      setBusy(false);
    }
  }

  function applyPreset(preset: 'almuerzo' | 'cena' | 'completo' | 'default') {
    let next: string[] = [];
    if (preset === 'almuerzo') next = ['12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00'];
    else if (preset === 'cena') next = ['19:00', '19:30', '20:00', '20:30', '21:00', '21:30', '22:00'];
    else if (preset === 'completo')
      next = [
        '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00',
        '19:00', '19:30', '20:00', '20:30', '21:00', '21:30', '22:00',
      ];
    else next = ['13:00', '13:30', '14:00', '14:30', '21:00', '21:30', '22:00'];
    setSlots(next);
  }

  if (!loaded) {
    return (
      <div className="card card-pad mt-6 max-w-md">
        <div className="text-sm text-mute">Cargando horarios…</div>
      </div>
    );
  }

  return (
    <div className="card card-pad mt-6 max-w-md">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-12 h-12 rounded-xl bg-ok-soft text-ok-ink flex items-center justify-center shrink-0">
          <span className="text-xl">🕐</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">Horarios disponibles</div>
          <div className="text-xs text-mute leading-snug mt-0.5">
            Elige las horas en que aceptas reservas online. El cliente solo verá estos
            horarios al reservar (en formato 12h).
          </div>
        </div>
      </div>

      <div className="flex gap-1 flex-wrap mb-3">
        {(['almuerzo', 'cena', 'completo', 'default'] as const).map((p) => (
          <button
            key={p}
            onClick={() => applyPreset(p)}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-line text-mute hover:text-ink"
          >
            {p === 'almuerzo'
              ? '🍽 Solo almuerzo'
              : p === 'cena'
              ? '🍷 Solo cena'
              : p === 'completo'
              ? '☀️🌙 Completo'
              : '↺ Default'}
          </button>
        ))}
      </div>

      {slots.length > 0 ? (
        <div className="flex gap-1 flex-wrap mb-3 p-2 bg-bg2/40 rounded-lg">
          {slots.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded bg-ok-soft text-ok-ink"
            >
              {to12h(s)}
              <button
                onClick={() => toggleSlot(s)}
                className="text-base leading-none opacity-60 hover:opacity-100"
                title="Quitar"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-mute italic mb-3 px-2">
          Sin horarios configurados. Si guardas vacío, el cliente verá los 7 horarios por
          defecto (almuerzo + cena).
        </p>
      )}

      <button
        onClick={() => setShowAll((v) => !v)}
        className="text-xs font-semibold text-ok-ink hover:underline mb-2"
      >
        {showAll ? '▴ Ocultar' : '▾ Elegir horarios uno por uno'}
      </button>

      {showAll && (
        <div className="grid grid-cols-4 gap-1 mb-3 max-h-72 overflow-y-auto p-2 bg-bg2/40 rounded-lg">
          {ALL_SLOTS.map((s) => {
            const active = slots.includes(s);
            return (
              <button
                key={s}
                onClick={() => toggleSlot(s)}
                className={`text-[10px] font-semibold py-1.5 rounded transition ${
                  active
                    ? 'bg-ok text-white'
                    : 'bg-white border border-line text-mute hover:text-ink'
                }`}
              >
                {to12h(s)}
              </button>
            );
          })}
        </div>
      )}

      <button onClick={save} disabled={busy} className="btn-primary w-full justify-center text-sm">
        {busy ? 'Guardando…' : 'Guardar horarios'}
      </button>
    </div>
  );
}

