'use client';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { api } from '@/lib/api';
import { cleanDomain } from '@/lib/public-domain';
import { AcademyButton } from '@/components/AcademyButton';
import { toast } from '@/components/Toast';
import { fmtLongDate, todayISO, to12h } from '../_shared';

type Tenant = {
  slug: string;
  brandName?: string;
  // Dominio público de la marca del negocio (ej. selleala.com). Null = Clubify.
  brandPublicDomain?: string | null;
  // Dominio propio del negocio (ej. birrialeon.com). Tiene prioridad. PDF 2026-07-25.
  customDomain?: string | null;
};

export default function ReservaOnlinePage() {
  const t = useTranslations('app_reservations_online');
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    api<Tenant>('/tenants/me')
      .then(setTenant)
      .catch(() => null);
  }, []);

  // La URL pública de reservas usa el dominio PROPIO del negocio si lo tiene
  // (birrialeon.com), luego el PÚBLICO de la marca (selleala.com), y por último
  // soyclubify.com. Mantiene el orden histórico (público de marca), anteponiendo
  // el customDomain.
  const publicDomain =
    cleanDomain(tenant?.customDomain) ||
    cleanDomain(tenant?.brandPublicDomain) ||
    'soyclubify.com';
  const publicUrl = tenant?.slug
    ? `https://${publicDomain}/reserva/${tenant.slug}`
    : '';

  function copyLink() {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl).then(
      () => toast(t('toastLinkCopied'), 'success'),
      () => toast(t('toastCouldNotCopy'), 'error'),
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="page-title m-0">
              {t('pageTitle')} <span className="page-crumb text-mute font-normal">/ {fmtLongDate(todayISO())}</span>
            </h1>
            <AcademyButton moduleKey="reservas-online" />
          </div>
          <p className="text-xs text-mute mt-1">{t('subtitle')}</p>
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-ok-soft text-ok-ink text-xs font-semibold">
          <span className="relative inline-block w-2 h-2">
            <span className="absolute inset-0 rounded-full bg-ok animate-ping opacity-75" />
            <span className="absolute inset-0 rounded-full bg-ok" />
          </span>
          {t('realTime')}
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-8 items-start">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-ok-soft text-ok-ink text-xs font-semibold mb-3">
            📱 {t('customerExperience')}
          </div>
          <h2 className="text-3xl font-extrabold m-0 leading-tight">
            {t('heroTitle')}
          </h2>
          <p className="text-sm text-mute mt-3 leading-relaxed max-w-md">
            {t('heroBody')}
          </p>

          <div className="space-y-4 mt-6 max-w-md">
            {[
              {
                icon: '📐',
                title: t('feature1Title'),
                body: t('feature1Body'),
              },
              {
                icon: '💬',
                title: t('feature2Title'),
                body: t('feature2Body'),
              },
              {
                icon: '🎟',
                title: t('feature3Title'),
                body: t('feature3Body'),
              },
              {
                icon: '👥',
                title: t('feature4Title'),
                body: t('feature4Body'),
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

          {/* Días habilitados + observaciones para las reservas */}
          <BookingRulesCard />

          <div className="card card-pad mt-6 max-w-md">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-xl bg-ink/90 flex items-center justify-center text-white shrink-0">
                <span className="text-xl">🔳</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">{t('shareTitle')}</div>
                <div className="text-xs text-mute leading-snug mt-0.5">
                  {t('shareBody')}
                </div>
                {publicUrl && (
                  <div className="mt-3 flex items-center gap-2">
                    <code className="text-[11px] bg-bg2 px-2 py-1.5 rounded flex-1 truncate">
                      {publicUrl}
                    </code>
                    <button onClick={copyLink} className="btn-ghost text-xs px-3 py-1.5">
                      {t('copy')}
                    </button>
                    <a
                      href={publicUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-primary text-xs px-3 py-1.5"
                    >
                      {t('open')}
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
                <div className="font-bold text-base mt-1">{tenant?.brandName ?? t('yourBusiness')}</div>
                <div className="text-[11px] text-mute mt-0.5">{t('bookATable')}</div>
                <div className="flex gap-1 mt-3">
                  <div className="flex-1 h-1 rounded-full bg-ok" />
                  <div className="flex-1 h-1 rounded-full bg-line" />
                  <div className="flex-1 h-1 rounded-full bg-line" />
                  <div className="flex-1 h-1 rounded-full bg-line" />
                </div>
              </div>
              <div className="p-4">
                <div className="text-xs font-semibold mb-2">{t('howManyPeople')}</div>
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
                <div className="text-xs font-semibold mb-2">{t('dateLabel')}</div>
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
                <div className="text-xs font-semibold mb-2">{t('availableTime')}</div>
                <MockSlots />
                <div className="mt-5 text-center py-2.5 rounded-xl text-white font-bold text-sm bg-ok">
                  {t('continue')}
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
  const t = useTranslations('app_reservations_online');
  const [slots, setSlots] = useState<string[]>([]);
  useEffect(() => {
    api<{ slots: string[] }>(`/reservations/config/slots`)
      .then((d) => setSlots(d.slots))
      .catch(() => setSlots(['13:00', '13:30', '14:00', '21:00', '21:30', '22:00']));
  }, []);
  const shown = slots.slice(0, 6);
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {shown.map((slot, i) => (
        <div
          key={slot}
          className={`text-center py-1.5 rounded-lg text-[10px] font-semibold border ${
            i === 0
              ? 'bg-ink text-white border-ink'
              : i === 2
              ? 'border-line text-mute line-through opacity-50'
              : 'border-line'
          }`}
        >
          {to12h(slot)}
        </div>
      ))}
      {shown.length === 0 && (
        <div className="col-span-3 text-center text-[10px] text-mute italic py-2">
          {t('noSlotsConfigured')}
        </div>
      )}
    </div>
  );
}

function SlotsConfigCard() {
  const t = useTranslations('app_reservations_online');
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
      toast(t('toastSlotsSaved'), 'success');
    } catch (e: any) {
      toast(e.message || t('toastCouldNotSave'), 'error');
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
        <div className="text-sm text-mute">{t('loadingSlots')}</div>
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
          <div className="font-semibold text-sm">{t('availableSlotsTitle')}</div>
          <div className="text-xs text-mute leading-snug mt-0.5">
            {t('availableSlotsDesc')}
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
              ? `🍽 ${t('presetLunchOnly')}`
              : p === 'cena'
              ? `🍷 ${t('presetDinnerOnly')}`
              : p === 'completo'
              ? `☀️🌙 ${t('presetFull')}`
              : `↺ ${t('presetDefault')}`}
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
                title={t('remove')}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-mute italic mb-3 px-2">
          {t('noSlotsHint')}
        </p>
      )}

      <button
        onClick={() => setShowAll((v) => !v)}
        className="text-xs font-semibold text-ok-ink hover:underline mb-2"
      >
        {showAll ? `▴ ${t('hide')}` : `▾ ${t('chooseSlotsOneByOne')}`}
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
        {busy ? t('saving') : t('saveSlots')}
      </button>
    </div>
  );
}

// Orden de display Lun→Dom; el número es JS getDay() (0=Dom..6=Sáb) que se
// persiste en Tenant.reservationDays.
const WEEKDAYS: { n: number; key: string }[] = [
  { n: 1, key: 'wdMon' },
  { n: 2, key: 'wdTue' },
  { n: 3, key: 'wdWed' },
  { n: 4, key: 'wdThu' },
  { n: 5, key: 'wdFri' },
  { n: 6, key: 'wdSat' },
  { n: 0, key: 'wdSun' },
];

function BookingRulesCard() {
  const t = useTranslations('app_reservations_online');
  const [days, setDays] = useState<number[]>([]);
  const [terms, setTerms] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ days: number[]; terms: string | null }>(`/reservations/config/booking`)
      .then((d) => {
        // Vacío en backend = todos los días abiertos. En la UI mostramos los 7
        // activos para que el negocio deseleccione los que cierra.
        setDays(d.days && d.days.length > 0 ? d.days : [0, 1, 2, 3, 4, 5, 6]);
        setTerms(d.terms ?? '');
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  function toggleDay(n: number) {
    setDays((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]));
  }

  async function save() {
    if (days.length === 0) {
      toast(t('daysAllWarning'), 'error');
      return;
    }
    setBusy(true);
    try {
      await api(`/reservations/config/booking`, {
        method: 'PATCH',
        body: JSON.stringify({ days, terms: terms.trim() || null }),
      });
      toast(t('toastBookingSaved'), 'success');
    } catch (e: any) {
      toast(e.message || t('toastCouldNotSave'), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <div className="card card-pad mt-6 max-w-md">
        <div className="text-sm text-mute">{t('loadingSlots')}</div>
      </div>
    );
  }

  return (
    <div className="card card-pad mt-6 max-w-md">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-12 h-12 rounded-xl bg-ok-soft text-ok-ink flex items-center justify-center shrink-0">
          <span className="text-xl">📅</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">{t('bookingRulesTitle')}</div>
          <div className="text-xs text-mute leading-snug mt-0.5">
            {t('bookingRulesDesc')}
          </div>
        </div>
      </div>

      {/* Días habilitados */}
      <div className="text-xs font-semibold mb-2">{t('daysLabel')}</div>
      <div className="flex gap-1.5 flex-wrap mb-1.5">
        {WEEKDAYS.map(({ n, key }) => {
          const active = days.includes(n);
          return (
            <button
              key={n}
              onClick={() => toggleDay(n)}
              className={`text-[11px] font-bold w-11 py-2 rounded-lg border transition ${
                active
                  ? 'bg-ok text-white border-ok'
                  : 'bg-white border-line text-mute hover:text-ink'
              }`}
            >
              {t(key)}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-mute mb-4">{t('daysHint')}</p>

      {/* Observaciones para las reservas */}
      <div className="text-xs font-semibold mb-1">{t('observationsLabel')}</div>
      <p className="text-[11px] text-mute mb-2 leading-snug">{t('observationsDesc')}</p>
      <textarea
        className="input mb-3 leading-relaxed"
        rows={7}
        value={terms}
        onChange={(e) => setTerms(e.target.value)}
        placeholder={t('observationsPlaceholder')}
      />

      <button onClick={save} disabled={busy} className="btn-primary w-full justify-center text-sm">
        {busy ? t('saving') : t('saveBookingRules')}
      </button>
    </div>
  );
}

