'use client';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { useParams, useRouter } from 'next/navigation';
import { BrandBadge, type BrandBadgeBrand } from '@/components/BrandBadge';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useLocale, useT, type MessageKey } from '@/lib/i18n';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Card = {
  id: string;
  name: string;
  type: string;
  description: string;
  rewardText: string;
  terms: string;
  // PDF Software(8): si true (default), muestra la casilla de políticas de datos.
  dataPolicyEnabled?: boolean;
  primaryColor: string;
  secondaryColor: string;
  stampsRequired: number | null;
  tenant: {
    brandName: string;
    logoUrl: string | null;
    primaryColor: string;
    slug: string;
    // País ISO del negocio (ej "CO", "VE"). Define el prefijo telefónico
    // por defecto del formulario. Puede faltar en caches viejos.
    country?: string | null;
    // PDF Software(8): documento propio del negocio. Null → default /legal/privacy.
    dataPolicyUrl?: string | null;
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
  { code: 'BZ', flag: '🇧🇿', name: 'Belice', dial: '501' },
  { code: 'DO', flag: '🇩🇴', name: 'R. Dominicana', dial: '1' },
  { code: 'SV', flag: '🇸🇻', name: 'El Salvador', dial: '503' },
  { code: 'HN', flag: '🇭🇳', name: 'Honduras', dial: '504' },
  { code: 'NI', flag: '🇳🇮', name: 'Nicaragua', dial: '505' },
  { code: 'ES', flag: '🇪🇸', name: 'España', dial: '34' },
  { code: 'US', flag: '🇺🇸', name: 'USA', dial: '1' },
];

// Tipo de tarjeta → clave i18n (se traduce con tt según el idioma activo).
// Antes era un mapa hardcodeado en español → no se traducía en /en, /pt, /it.
const TYPE_LABEL_KEY: Record<string, MessageKey> = {
  STAMPS: 'card.type_stamps',
  POINTS: 'card.type_points',
  DISCOUNT: 'card.type_discount',
  MEMBERSHIP: 'card.type_membership',
  COUPON: 'card.type_coupon',
  GIFT: 'card.type_gift',
  MULTI: 'card.type_multi',
};

// Cache SWR en localStorage: la primera visita paga el fetch; visitas
// siguientes muestran el form decorado con marca/colores en el primer
// paint y revalidan en background. TTL 5 min — datos del card cambian
// raramente y el campo `isActive` lo verificamos vía revalidación.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cacheKey = (cardId: string, locale: string) =>
  `clubify:enroll:${cardId}:${locale}`;

function readCache(cardId: string, locale: string): Card | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(cacheKey(cardId, locale));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.card || typeof parsed.cachedAt !== 'number') return null;
    if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) return null;
    return parsed.card as Card;
  } catch {
    return null;
  }
}

function writeCache(cardId: string, locale: string, card: Card) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      cacheKey(cardId, locale),
      JSON.stringify({ card, cachedAt: Date.now() }),
    );
  } catch {
    // localStorage lleno o bloqueado — no es fatal, seguimos sin cache.
  }
}

function clearCache(cardId: string, locale: string) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(cacheKey(cardId, locale));
  } catch {}
}

/**
 * Cabecera de marca memoizada. NO se re-renderiza cuando cambia el form
 * state (fullName, phone, etc.) — solo cuando llega el card del backend.
 * Sin este memo, cada keystroke re-reconciliaba la cabecera entera
 * (gradiente, logo, animaciones) y rompía la respuesta del teclado en
 * móviles flojos.
 */
const BrandHeader = memo(function BrandHeader({
  card,
  verifying,
  brandLogoUrl,
}: {
  card: Card | null;
  verifying: boolean;
  /** Logo de la marca blanca (Nivel 2): se usa si el negocio no tiene logo
   *  propio, para no mostrar la inicial pelada. Nunca Clubify para otra marca. */
  brandLogoUrl?: string | null;
}) {
  const tt = useT();
  const ready = !!card;
  const primary = card?.primaryColor || card?.tenant.primaryColor || '#22C55E';
  const secondary = card?.secondaryColor || '#15803D';
  return (
    <div
      className="px-4 sm:px-5 pt-8 sm:pt-10 pb-14 sm:pb-16 text-white transition-[background] duration-500"
      style={{
        background: ready
          ? `linear-gradient(135deg, ${primary}, ${secondary})`
          : 'linear-gradient(135deg, #1F2937, #374151)',
      }}
    >
      <div className="max-w-md mx-auto">
        <div className="flex items-center gap-2.5 sm:gap-3 mb-4 sm:mb-5">
          {ready && (card?.tenant.logoUrl || brandLogoUrl) ? (
            <img
              src={(card?.tenant.logoUrl || brandLogoUrl) as string}
              alt=""
              loading="lazy"
              decoding="async"
              className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl object-cover bg-white p-1 flex-none animate-in fade-in duration-300"
            />
          ) : (
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-white/20 flex items-center justify-center font-bold text-lg sm:text-xl flex-none">
              {ready ? card!.tenant.brandName.charAt(0) : '·'}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[10px] sm:text-xs uppercase tracking-wider opacity-80">
              {ready
                ? tt(TYPE_LABEL_KEY[card!.type] ?? 'card.type_default')
                : tt('card.program_default')}
            </div>
            <div className="font-bold text-base sm:text-lg leading-tight truncate">
              {ready ? card!.tenant.brandName : verifying ? tt('card.verifying') : ' '}
            </div>
          </div>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight leading-tight break-words min-h-[2.25rem]">
          {ready ? card!.name : ' '}
        </h1>
        {ready && card!.description && (
          <p className="text-white/85 mt-2 leading-relaxed text-sm sm:text-base break-words animate-in fade-in duration-300">
            {card!.description}
          </p>
        )}
        {ready && card!.rewardText && (
          <div className="mt-4 sm:mt-5 inline-flex max-w-full items-center bg-white/15 backdrop-blur rounded-pill px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-medium animate-in fade-in duration-300">
            <span className="mr-1.5 flex-none">🎁</span>
            <span className="break-words">{card!.rewardText}</span>
          </div>
        )}
      </div>
    </div>
  );
});

/**
 * Las 20 options del dropdown de país son siempre las mismas. Memoizar
 * el JSX evita re-crearlo en cada keystroke.
 */
const COUNTRY_OPTIONS = COUNTRIES.map((c) => (
  <option key={c.code} value={c.code}>
    {c.flag} +{c.dial}
  </option>
));

/**
 * Las 31 options de días y 12 de meses también son estáticas.
 */
const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
  <option key={d} value={d}>
    {d}
  </option>
));
// Nombres de mes traducidos según el idioma activo (Intl) — antes estaban
// hardcodeados en español y no se traducían en /en, /pt, /it.
function monthOptionsFor(locale: string) {
  const fmt = new Intl.DateTimeFormat(locale || 'es', { month: 'long' });
  return Array.from({ length: 12 }, (_, i) => {
    const name = fmt.format(new Date(2020, i, 1));
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    return (
      <option key={i + 1} value={i + 1}>
        {label}
      </option>
    );
  });
}

// =============================================================
//  FormFields — TODO el state del formulario vive ACÁ
// =============================================================

/**
 * Tipo del payload que FormFields entrega al padre al hacer submit.
 * El padre solo conoce datos ya normalizados — no la "raw" string del
 * teléfono ni el country code, sino el `phoneFull` ya con prefijo.
 */
type SubmitPayload = {
  fullName: string;
  email: string | undefined;
  phone: string;
  birthday: string | undefined;
  // PDF Software(8): el cliente marcó la casilla de políticas de datos.
  dataPolicyAccepted: boolean;
};

/**
 * FormFields memoizado: todo el state del formulario (fullName, phone,
 * email, country, etc.) vive ACÁ adentro. El padre NUNCA se re-renderiza
 * cuando el cliente tipea, y FormFields NUNCA se re-renderiza por cambios
 * del padre (fetch del card, verifying, etc.) gracias al memo + props
 * estables.
 *
 * Esto significa: cada keystroke solo re-renderiza FormFields, y dentro
 * de FormFields React reconcilia solo el input que cambió (~1ms). El
 * BrandHeader nunca se reconcilia por escritura.
 *
 * Props estables (memoizar en el padre con useCallback):
 *  - onSubmit: callback al padre con el payload normalizado.
 *  - onFirstInput: callback que marca TTI en el primer keystroke.
 *
 * Props que cambian raramente (1 vez cuando llega el card):
 *  - primary: color del botón submit.
 *  - ready: gate del submit.
 */
const FormFields = memo(function FormFields({
  primary,
  ready,
  defaultCountry,
  dataPolicyEnabled,
  dataPolicyHref,
  requireContactFields,
  onFirstInput,
  onSubmit,
}: {
  primary: string;
  ready: boolean;
  defaultCountry: string;
  // PDF Software(8): mostrar la casilla de políticas de datos + enlace al doc.
  dataPolicyEnabled: boolean;
  dataPolicyHref: string;
  // Sellea exige correo + cumpleaños obligatorios (decisión del dueño,
  // 2026-08-30). Solo Sellea — en las demás marcas siguen siendo opcionales.
  requireContactFields: boolean;
  onFirstInput: () => void;
  onSubmit: (data: SubmitPayload) => Promise<void>;
}) {
  const tt = useT();
  const [locale] = useLocale();
  const monthOptions = useMemo(() => monthOptionsFor(locale), [locale]);
  // El prefijo telefónico arranca en el país del negocio. El cliente puede
  // cambiarlo, pero el default refleja la ubicación de la subcuenta.
  const [country, setCountry] = useState(defaultCountry);
  // Cuando el card carga async, defaultCountry pasa del fallback 'CO' al
  // país real del negocio. Sincronizamos SOLO si el cliente no eligió país
  // todavía — nunca pisamos una selección manual.
  const countryTouched = useRef(false);
  useEffect(() => {
    if (!countryTouched.current) setCountry(defaultCountry);
  }, [defaultCountry]);
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [bdayDay, setBdayDay] = useState<string>('');
  const [bdayMonth, setBdayMonth] = useState<string>('');
  const [accept, setAccept] = useState(false);
  // PDF Software(8): casilla opcional de políticas de tratamiento de datos.
  const [acceptDataPolicy, setAcceptDataPolicy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // País actual (datos read-only del array estático). Recalcular en cada
  // render es O(20) — irrelevante.
  const selectedCountry = COUNTRIES.find((c) => c.code === country);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!ready) {
      setErr(tt('card.verify_retry'));
      return;
    }
    if (!accept) {
      setErr(tt('card.must_accept'));
      return;
    }
    // Validaciones de submit (NUNCA en cada keystroke). Phone replace
    // del onChange es cosmético — la validación de longitud va acá.
    const dial = selectedCountry?.dial ?? '57';
    const phoneFull = `+${dial}${phone.replace(/\D/g, '')}`;
    if (phoneFull.length < 10) {
      setErr(tt('card.invalid_phone'));
      return;
    }
    // Sellea: correo y cumpleaños son obligatorios. El backend también lo exige
    // (defensa en profundidad); acá cortamos antes para dar el mensaje claro.
    if (requireContactFields && !email.trim()) {
      setErr(tt('card.email_required_err'));
      return;
    }
    if (requireContactFields && !(bdayDay && bdayMonth)) {
      setErr(tt('card.birthday_required_err'));
      return;
    }
    let birthday: string | undefined;
    if (bdayDay && bdayMonth) {
      const dd = String(bdayDay).padStart(2, '0');
      const mm = String(bdayMonth).padStart(2, '0');
      birthday = `2000-${mm}-${dd}`;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        fullName: fullName.trim(),
        email: email.trim() || undefined,
        phone: phoneFull,
        birthday,
        dataPolicyAccepted: acceptDataPolicy,
      });
    } catch (e: any) {
      setErr(e?.message || tt('common.error'));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="card shadow-xl p-4 sm:p-6">
      <h2 className="text-base sm:text-lg font-bold">
        {tt('card.join_title')}
      </h2>
      <p className="text-xs text-mute mt-1">{tt('card.join_sub')}</p>

      <div className="mt-4 sm:mt-5 space-y-3">
        <div>
          <label className="label">{tt('card.full_name')}</label>
          <input
            className="input"
            placeholder={tt('card.full_name')}
            value={fullName}
            onChange={(e) => {
              onFirstInput();
              setFullName(e.target.value);
            }}
            required
            autoComplete="name"
            autoCapitalize="words"
            enterKeyHint="next"
          />
        </div>

        <div>
          <label className="label">{tt('card.phone')}</label>
          <div className="flex gap-2">
            <select
              className="input w-24 sm:w-32 flex-none"
              value={country}
              onChange={(e) => {
                countryTouched.current = true;
                setCountry(e.target.value);
              }}
            >
              {COUNTRY_OPTIONS}
            </select>
            <input
              className="input flex-1 min-w-0"
              type="tel"
              inputMode="numeric"
              placeholder="3001234567"
              value={phone}
              onChange={(e) => {
                onFirstInput();
                setPhone(e.target.value.replace(/\D/g, ''));
              }}
              required
              autoComplete="tel"
              enterKeyHint="next"
            />
          </div>
          <div className="text-[11px] text-mute mt-1 truncate">
            {selectedCountry?.name} · {selectedCountry?.flag} código +
            {selectedCountry?.dial}
          </div>
        </div>

        <div>
          <label className="label">
            {requireContactFields ? tt('card.email_required') : tt('card.email')}
          </label>
          <input
            className="input"
            type="email"
            placeholder="tucorreo@ejemplo.com"
            value={email}
            onChange={(e) => {
              onFirstInput();
              setEmail(e.target.value);
            }}
            required={requireContactFields}
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            enterKeyHint="next"
          />
        </div>

        <div>
          <label className="label">
            🎂{' '}
            {requireContactFields
              ? tt('card.birthday_required')
              : tt('card.birthday')}
          </label>
          <div className="grid grid-cols-2 gap-2">
            <select
              className="input"
              value={bdayDay}
              onChange={(e) => setBdayDay(e.target.value)}
              required={requireContactFields}
            >
              <option value="">{tt('card.birth_day')}</option>
              {DAY_OPTIONS}
            </select>
            <select
              className="input"
              value={bdayMonth}
              onChange={(e) => setBdayMonth(e.target.value)}
              required={requireContactFields}
            >
              <option value="">{tt('card.birth_month')}</option>
              {monthOptions}
            </select>
          </div>
          <div className="text-[11px] text-mute mt-1">
            {tt('card.birthday_gift_hint')}
          </div>
        </div>

        <label className="flex items-start gap-2 text-xs text-mute pt-1">
          <input
            type="checkbox"
            className="mt-0.5 accent-brand"
            checked={accept}
            onChange={(e) => {
              setAccept(e.target.checked);
              // PDF Software(8): al marcar la primera (push) se marcan ambas.
              if (e.target.checked) setAcceptDataPolicy(true);
            }}
          />
          <span>{tt('card.push_consent')}</span>
        </label>

        {dataPolicyEnabled && (
          <label className="flex items-start gap-2 text-xs text-mute">
            <input
              type="checkbox"
              className="mt-0.5 accent-brand"
              checked={acceptDataPolicy}
              onChange={(e) => setAcceptDataPolicy(e.target.checked)}
            />
            <span>
              {tt('card.data_policy_pre')}{' '}
              <a
                href={dataPolicyHref}
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-medium"
                style={{ color: primary }}
              >
                {tt('card.data_policy_link')}
              </a>
            </span>
          </label>
        )}

        {err && (
          <div className="rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink">
            {err}
          </div>
        )}

        <button
          type="submit"
          disabled={
            submitting ||
            !fullName ||
            !phone ||
            !accept ||
            !ready ||
            (requireContactFields &&
              (!email.trim() || !bdayDay || !bdayMonth))
          }
          className="w-full justify-center text-sm sm:text-base py-3.5 rounded-pill font-semibold text-white shadow-md transition disabled:opacity-50 hover:opacity-95 active:scale-[0.97] mt-1 touch-manipulation [-webkit-tap-highlight-color:transparent]"
          style={{ background: primary }}
          title={!ready ? tt('card.verifying_business') : undefined}
        >
          {submitting
            ? tt('card.submitting')
            : !ready
            ? tt('card.verifying')
            : tt('card.submit') + ' →'}
        </button>
      </div>
    </form>
  );
});

export default function EnrollPage() {
  const tt = useT();
  const [locale] = useLocale();
  const router = useRouter();
  const { cardId } = useParams<{ cardId: string }>();

  // El card empieza siempre null en el primer render para evitar
  // hydration mismatch (server ve null porque no hay window, client
  // ve cache → árboles distintos en el primer paint → bug visual).
  // El useEffect de abajo hidrata desde cache después del mount; el
  // form se renderiza SIEMPRE — los campos no esperan al fetch.
  const [card, setCard] = useState<Card | null>(null);
  // Marca blanca del negocio (per marca). El badge "Hecho con {marca}" la usa.
  const [brand, setBrand] = useState<BrandBadgeBrand | null>(null);

  // HOTFIX 2026-06-05 (bug P): hidratar cache solo POST-mount para
  // mantener el primer render idéntico entre SSR y CSR.
  useEffect(() => {
    if (!cardId) return;
    const cached = readCache(cardId as string, locale);
    if (cached) setCard(cached);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [unavailable, setUnavailable] = useState(false);
  const [networkError, setNetworkError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [verifying, setVerifying] = useState(false);

  // startTransition marca updates como BAJA PRIORIDAD. Cuando el fetch
  // del card resuelve mientras el cliente está tipeando, React no
  // bloquea los keystrokes para reconciliar el header brand: prioriza
  // el input. Sin esto, en móviles flojos se perdían letras en el
  // momento exacto en que llegaba la respuesta del backend.
  const [, startCardTransition] = useTransition();
  // OJO: TODO el state del formulario (fullName, phone, email, country,
  // birthday, etc.) vive ahora dentro de FormFields. EnrollPage NO se
  // re-renderiza por keystrokes — solo por estados de carga del card.

  // Performance tracking: TTI = tiempo desde mount hasta primer keystroke.
  // El backend loguea WARN si > 3s para alertar regresiones.
  const mountedAt = useRef<number>(0);
  const loadFinishedAt = useRef<number | null>(null);
  const ttiReported = useRef(false);
  const initialSource = useRef<'cache' | 'network'>('network');

  useEffect(() => {
    mountedAt.current = performance.now();
    // Si arrancamos con cache hidratada, el "load" técnicamente terminó
    // en t=0. Si no, marcamos al recibir respuesta del fetch.
    if (card) {
      loadFinishedAt.current = mountedAt.current;
      initialSource.current = 'cache';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reportTti = useCallback(() => {
    if (ttiReported.current) return;
    ttiReported.current = true;
    const now = performance.now();
    const ttiMs = Math.round(now - (mountedAt.current || now));
    const loadMs =
      loadFinishedAt.current !== null
        ? Math.round(loadFinishedAt.current - mountedAt.current)
        : undefined;
    // Beacon fire-and-forget. keepalive permite que el browser lo mande
    // aún si la página navega antes de que termine el request.
    try {
      fetch(`${API}/api/metrics/enroll-perf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardId,
          ttiMs,
          loadMs,
          source: initialSource.current,
          userAgent:
            typeof navigator !== 'undefined'
              ? navigator.userAgent.slice(0, 200)
              : undefined,
        }),
        keepalive: true,
      }).catch(() => null);
    } catch {
      // navigator no disponible (SSR) — no es fatal.
    }
  }, [cardId]);

  // Fetch del card. Stale-while-revalidate: si hay cache, el form ya está
  // renderizado decorado — revalidamos silencioso. Si NO hay cache,
  // mostramos cabecera neutra hasta llegar (el form sigue editable).
  useEffect(() => {
    if (!cardId) return;
    let cancelled = false;
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 10_000);
    setNetworkError(false);
    // Solo mostramos el indicador "verificando" si no hay cache;
    // visitas repetidas no parpadean.
    if (!card) setVerifying(true);
    fetch(`${API}/api/passes/enroll/${cardId}?locale=${locale}`, {
      signal: ctrl.signal,
      // No "no-store" — queremos que el browser/CDN sirvan cache si está
      // dentro del max-age del backend (60s). El stale-while-revalidate
      // hace que sea instantáneo.
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (!data?.available) {
          // Card desactivada/suspendida — invalidamos cache para que el
          // próximo load no vuelva a mostrarla.
          clearCache(cardId as string, locale);
          setUnavailable(true);
          startCardTransition(() => setCard(null));
          return;
        }
        // setCard como transition: NO bloquea keystrokes del input. El
        // header brand se renderiza cuando el browser tenga tiempo
        // libre, no compitiendo con el teclado.
        startCardTransition(() => setCard(data.card));
        if (data.brand) setBrand(data.brand as BrandBadgeBrand);
        // writeCache hace JSON.stringify de un objeto grande — diferimos
        // a la siguiente microtask para no robar tiempo al render actual.
        queueMicrotask(() => writeCache(cardId as string, locale, data.card));
        if (loadFinishedAt.current === null) {
          loadFinishedAt.current = performance.now();
        }
      })
      .catch((e) => {
        if (cancelled) return;
        if (e?.name === 'AbortError' || e?.message === 'Failed to fetch') {
          // Si tenemos cache válido, no mostramos error de red — el form
          // sigue siendo usable con los datos del cache. Solo bloqueamos
          // si el cache no existe.
          if (!card) setNetworkError(true);
        } else if (!card) {
          setUnavailable(true);
        }
      })
      .finally(() => {
        clearTimeout(timeoutId);
        // setVerifying es cosmético (solo afecta texto "Verificando…" en
        // el header). Wrapeado en transition para consistencia con setCard
        // — los keystrokes mantienen prioridad sobre cualquier flash del
        // header al terminar el fetch.
        if (!cancelled) startCardTransition(() => setVerifying(false));
      });
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      ctrl.abort();
    };
  }, [cardId, locale, retryCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Callback estable pasado a FormFields. La identidad NO cambia entre
  // renders (deps solo cambian con cardId), así el memo de FormFields
  // se mantiene válido — el form NUNCA se re-renderiza por cambios del
  // padre, solo por sus propios setState internos.
  const onFirstInput = useCallback(() => {
    reportTti();
  }, [reportTti]);

  /**
   * Handler de submit estable. Hace la llamada POST y navega al wallet.
   * Si falla, lanza el Error y FormFields lo captura en su catch interno
   * (setErr local). Identidad estable: deps solo cardId y router.
   */
  const onSubmitForm = useCallback(
    async (data: SubmitPayload) => {
      const utmSlug =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('utm') ?? undefined
          : undefined;
      // ?locale= → el backend persiste Customer.locale para localizar el pase
      // de wallet (Apple/Google) en el idioma que el cliente eligió aquí.
      const res = await fetch(
        `${API}/api/passes/enroll/${cardId}?locale=${encodeURIComponent(locale)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...data, utmSlug }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || tt('card.create_failed'));
      }
      const body: { passId: string } = await res.json();
      router.push(`/w/${body.passId}?welcome=1`);
    },
    [cardId, router],
  );

  // ---- Render ----

  // Caso de error de red SIN cache disponible: pantalla con retry.
  if (networkError && !card) {
    return (
      <main className="min-h-screen bg-bg flex items-center justify-center px-5">
        <div className="card card-pad text-center max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="text-5xl mb-3">📡</div>
          <h1 className="text-xl font-bold">{tt('card.slow_title')}</h1>
          <p className="text-mute text-sm mt-2">
            {tt('card.slow_msg')}
          </p>
          <button
            type="button"
            className="btn-primary mt-4 w-full"
            onClick={() => {
              setNetworkError(false);
              setRetryCount((c) => c + 1);
            }}
          >
            {tt('card.retry')}
          </button>
        </div>
        <LanguageSwitcher />
      </main>
    );
  }

  // Caso de tarjeta no disponible.
  if (unavailable) {
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

  // Render principal: SIEMPRE muestra el form. Si no hay card todavía,
  // el header se renderiza neutro y se anima al llegar datos.
  const primary = card?.primaryColor || card?.tenant.primaryColor || '#22C55E';
  const ready = !!card;
  // País del negocio → default del prefijo telefónico. Si el país no está
  // en la lista soportada o aún no cargó el card, caemos a 'CO'.
  const tenantCountry = (card?.tenant.country || 'CO').toUpperCase();
  const defaultCountry = COUNTRIES.some((c) => c.code === tenantCountry)
    ? tenantCountry
    : 'CO';
  // Sellea exige correo y cumpleaños en el registro de la tarjeta (decisión del
  // dueño, 2026-08-30). SOLO Sellea — las demás marcas los dejan opcionales.
  // Mientras la marca no ha cargado (brand=null) quedan opcionales; al resolver
  // el fetch, si es Sellea, FormFields re-renderiza con los campos requeridos.
  const requireContactFields =
    brand?.slug === 'sellea' || brand?.slug === 'selleala';

  return (
    <main className="min-h-screen bg-bg pb-8 sm:pb-12">
      <BrandHeader
        card={card}
        verifying={verifying}
        brandLogoUrl={brand?.logoUrl ?? brand?.iconUrl ?? null}
      />

      <div className="max-w-md mx-auto px-4 sm:px-5 -mt-10">
        <FormFields
          primary={primary}
          ready={ready}
          defaultCountry={defaultCountry}
          // PDF Software(8): la casilla se muestra solo cuando el card cargó y
          // no está desactivada (default true). El enlace apunta al documento
          // del negocio o al default para el cliente final /legal/tratamiento-datos.
          dataPolicyEnabled={!!card && card.dataPolicyEnabled !== false}
          dataPolicyHref={card?.tenant?.dataPolicyUrl || '/legal/tratamiento-datos'}
          requireContactFields={requireContactFields}
          onFirstInput={onFirstInput}
          onSubmit={onSubmitForm}
        />

        {ready && card!.terms && (
          <details className="mt-4 text-xs text-mute px-2 animate-in fade-in duration-300">
            <summary className="cursor-pointer hover:text-ink">
              {tt('card.terms')}
            </summary>
            <p className="mt-2 leading-relaxed">{card!.terms}</p>
          </details>
        )}

        {/* Marca del negocio (per marca blanca). Fallback Clubify mientras
            el backend propaga el deploy. */}
        {/* Sin marca resuelta NO se pinta nada. Antes caía a Clubify por
            defecto: el cliente de un negocio Sellea veía «Hecho con Clubify»
            en su tarjeta. Un pie ausente no delata a nadie; uno inventado sí. */}
        {brand && <BrandBadge brand={brand} />}
        {/* Sellea ofrece italiano además de los idiomas por defecto. */}
        <LanguageSwitcher
          extraLocales={
            /sellea/i.test(`${brand?.name ?? ''} ${brand?.websiteUrl ?? ''}`)
              ? ['it']
              : undefined
          }
        />
      </div>
    </main>
  );
}
