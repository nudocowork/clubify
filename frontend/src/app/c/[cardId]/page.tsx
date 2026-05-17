'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ClubifyBadge } from '@/components/ClubifyBadge';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useLocale, useT } from '@/lib/i18n';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Card = {
  id: string;
  name: string;
  type: string;
  description: string;
  rewardText: string;
  terms: string;
  primaryColor: string;
  secondaryColor: string;
  stampsRequired: number | null;
  tenant: {
    brandName: string;
    logoUrl: string | null;
    primaryColor: string;
    slug: string;
  };
};

// Países LATAM + USA + España. El usuario elige y se prefija el código.
const COUNTRIES = [
  { code: 'CO', flag: '🇨🇴', name: 'Colombia', dial: '57' },
  { code: 'MX', flag: '🇲🇽', name: 'México', dial: '52' },
  { code: 'AR', flag: '🇦🇷', name: 'Argentina', dial: '54' },
  { code: 'CL', flag: '🇨🇱', name: 'Chile', dial: '56' },
  { code: 'PE', flag: '🇵🇪', name: 'Perú', dial: '51' },
  { code: 'EC', flag: '🇪🇨', name: 'Ecuador', dial: '593' },
  { code: 'BR', flag: '🇧🇷', name: 'Brasil', dial: '55' },
  { code: 'VE', flag: '🇻🇪', name: 'Venezuela', dial: '58' },
  { code: 'BO', flag: '🇧🇴', name: 'Bolivia', dial: '591' },
  { code: 'PY', flag: '🇵🇾', name: 'Paraguay', dial: '595' },
  { code: 'UY', flag: '🇺🇾', name: 'Uruguay', dial: '598' },
  { code: 'CR', flag: '🇨🇷', name: 'Costa Rica', dial: '506' },
  { code: 'GT', flag: '🇬🇹', name: 'Guatemala', dial: '502' },
  { code: 'PA', flag: '🇵🇦', name: 'Panamá', dial: '507' },
  { code: 'DO', flag: '🇩🇴', name: 'R. Dominicana', dial: '1' },
  { code: 'SV', flag: '🇸🇻', name: 'El Salvador', dial: '503' },
  { code: 'HN', flag: '🇭🇳', name: 'Honduras', dial: '504' },
  { code: 'NI', flag: '🇳🇮', name: 'Nicaragua', dial: '505' },
  { code: 'ES', flag: '🇪🇸', name: 'España', dial: '34' },
  { code: 'US', flag: '🇺🇸', name: 'USA', dial: '1' },
];

const TYPE_LABEL: Record<string, string> = {
  STAMPS: 'Tarjeta de sellos',
  POINTS: 'Tarjeta de puntos',
  DISCOUNT: 'Tarjeta de descuento',
  MEMBERSHIP: 'Membresía',
  COUPON: 'Cupón',
  GIFT: 'Regalo',
  MULTI: 'Múltiple',
};

export default function EnrollPage() {
  const tt = useT();
  const [locale] = useLocale();
  const router = useRouter();
  const { cardId } = useParams<{ cardId: string }>();
  const [card, setCard] = useState<Card | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  // Trackeamos primer load para mostrar spinner full-screen solo entonces.
  // En refetches por cambio de locale ya tenemos el card renderizado —
  // refrescamos silencioso y evitamos parpadear toda la pantalla.
  const isFirstLoad = useRef(true);

  const [country, setCountry] = useState('CO');
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [bdayDay, setBdayDay] = useState<string>('');
  const [bdayMonth, setBdayMonth] = useState<string>('');
  const [accept, setAccept] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (isFirstLoad.current) setLoading(true);
    fetch(`${API}/api/passes/enroll/${cardId}?locale=${locale}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (!data?.available) setUnavailable(true);
        else setCard(data.card);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        isFirstLoad.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [cardId, locale]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!accept) {
      setErr('Tienes que aceptar para continuar');
      return;
    }
    const dial = COUNTRIES.find((c) => c.code === country)?.dial ?? '57';
    const phoneFull = `+${dial}${phone.replace(/\D/g, '')}`;
    if (phoneFull.length < 10) {
      setErr('Teléfono inválido');
      return;
    }
    setSubmitting(true);
    // Si el cliente vino vía /c/u/{slug} (UTM) el query string trae ?utm=<slug>
    // y se lo pasamos al backend para aplicar el bonus de bienvenida.
    const utmSlug =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('utm') ?? undefined
        : undefined;
    try {
      // Birthday: usamos año "ficticio" 2000 para tener una fecha completa
      // (Customer.birthday es @db.Date). El año NO se usa, solo día/mes —
      // el cron BIRTHDAY filtra por EXTRACT(MONTH/DAY FROM birthday).
      let birthday: string | undefined;
      if (bdayDay && bdayMonth) {
        const dd = String(bdayDay).padStart(2, '0');
        const mm = String(bdayMonth).padStart(2, '0');
        birthday = `2000-${mm}-${dd}`;
      }
      const res = await fetch(`${API}/api/passes/enroll/${cardId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: email.trim() || undefined,
          phone: phoneFull,
          birthday,
          utmSlug,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || 'No pudimos crear tu tarjeta');
      }
      const data: { passId: string } = await res.json();
      // Redirect inmediato a /w/[passId] donde puede instalar Wallet
      router.push(`/w/${data.passId}?welcome=1`);
    } catch (e: any) {
      setErr(e.message || 'Error');
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-bg flex items-center justify-center px-5">
        <div className="text-mute animate-pulse">{tt('common.loading')}</div>
      </main>
    );
  }

  if (unavailable || !card) {
    return (
      <main className="min-h-screen bg-bg flex items-center justify-center px-5">
        <div className="card card-pad text-center max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="text-5xl mb-3">😞</div>
          <h1 className="text-xl font-bold">{tt('card.unavailable_title')}</h1>
          <p className="text-mute text-sm mt-2">
            {tt('card.unavailable_msg')}
          </p>
        </div>
        <LanguageSwitcher />
      </main>
    );
  }

  const primary = card.primaryColor || card.tenant.primaryColor || '#22C55E';

  return (
    <main className="min-h-screen bg-bg pb-8 sm:pb-12">
      <div
        className="px-4 sm:px-5 pt-8 sm:pt-10 pb-14 sm:pb-16 text-white"
        style={{
          background: `linear-gradient(135deg, ${primary}, ${card.secondaryColor || '#15803D'})`,
        }}
      >
        <div className="max-w-md mx-auto">
          <div className="flex items-center gap-2.5 sm:gap-3 mb-4 sm:mb-5">
            {card.tenant.logoUrl ? (
              <img
                src={card.tenant.logoUrl}
                alt=""
                className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl object-cover bg-white p-1 flex-none"
              />
            ) : (
              <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-white/20 flex items-center justify-center font-bold text-lg sm:text-xl flex-none">
                {card.tenant.brandName.charAt(0)}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[10px] sm:text-xs uppercase tracking-wider opacity-80">
                {TYPE_LABEL[card.type] || 'Tarjeta'}
              </div>
              <div className="font-bold text-base sm:text-lg leading-tight truncate">
                {card.tenant.brandName}
              </div>
            </div>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight leading-tight break-words">
            {card.name}
          </h1>
          {card.description && (
            <p className="text-white/85 mt-2 leading-relaxed text-sm sm:text-base break-words">
              {card.description}
            </p>
          )}
          {card.rewardText && (
            <div className="mt-4 sm:mt-5 inline-flex max-w-full items-center bg-white/15 backdrop-blur rounded-pill px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-medium">
              <span className="mr-1.5 flex-none">🎁</span>
              <span className="break-words">{card.rewardText}</span>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 sm:px-5 -mt-10">
        <form
          onSubmit={submit}
          className="card shadow-xl p-4 sm:p-6"
        >
          <h2 className="text-base sm:text-lg font-bold">{tt('card.join_title')}</h2>
          <p className="text-xs text-mute mt-1">
            {tt('card.join_sub')}
          </p>

          <div className="mt-4 sm:mt-5 space-y-3">
            <div>
              <label className="label">{tt('card.full_name')}</label>
              <input
                className="input"
                placeholder={tt('card.full_name')}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                autoComplete="name"
              />
            </div>

            <div>
              <label className="label">{tt('card.phone')}</label>
              <div className="flex gap-2">
                <select
                  className="input w-24 sm:w-32 flex-none"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.flag} +{c.dial}
                    </option>
                  ))}
                </select>
                <input
                  className="input flex-1 min-w-0"
                  type="tel"
                  inputMode="numeric"
                  placeholder="3001234567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                  required
                  autoComplete="tel"
                />
              </div>
              <div className="text-[11px] text-mute mt-1 truncate">
                {COUNTRIES.find((c) => c.code === country)?.name} ·{' '}
                {COUNTRIES.find((c) => c.code === country)?.flag} código +
                {COUNTRIES.find((c) => c.code === country)?.dial}
              </div>
            </div>

            <div>
              <label className="label">{tt('card.email')}</label>
              <input
                className="input"
                type="email"
                placeholder="tucorreo@ejemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            <div>
              <label className="label">🎂 {tt('card.birthday')}</label>
              <div className="grid grid-cols-2 gap-2">
                <select
                  className="input"
                  value={bdayDay}
                  onChange={(e) => setBdayDay(e.target.value)}
                >
                  <option value="">{tt('card.birth_day')}</option>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <select
                  className="input"
                  value={bdayMonth}
                  onChange={(e) => setBdayMonth(e.target.value)}
                >
                  <option value="">{tt('card.birth_month')}</option>
                  {[
                    'Enero',
                    'Febrero',
                    'Marzo',
                    'Abril',
                    'Mayo',
                    'Junio',
                    'Julio',
                    'Agosto',
                    'Septiembre',
                    'Octubre',
                    'Noviembre',
                    'Diciembre',
                  ].map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="text-[11px] text-mute mt-1">
                Te enviamos un regalo el día de tu cumple 🎁
              </div>
            </div>

            <label className="flex items-start gap-2 text-xs text-mute pt-1">
              <input
                type="checkbox"
                className="mt-0.5 accent-brand"
                checked={accept}
                onChange={(e) => setAccept(e.target.checked)}
              />
              <span>
                Acepto recibir notificaciones vía Push.
              </span>
            </label>

            {err && (
              <div className="rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink">
                {err}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !fullName || !phone || !accept}
              className="w-full justify-center text-sm sm:text-base py-3.5 rounded-pill font-semibold text-white shadow-md transition disabled:opacity-50 hover:opacity-95 active:scale-[0.98] mt-1"
              style={{ background: primary }}
            >
              {submitting ? tt('card.submitting') : tt('card.submit') + ' →'}
            </button>
          </div>
        </form>

        {card.terms && (
          <details className="mt-4 text-xs text-mute px-2">
            <summary className="cursor-pointer hover:text-ink">
              Términos y condiciones
            </summary>
            <p className="mt-2 leading-relaxed">{card.terms}</p>
          </details>
        )}

        <ClubifyBadge />
        <LanguageSwitcher />
      </div>
    </main>
  );
}
