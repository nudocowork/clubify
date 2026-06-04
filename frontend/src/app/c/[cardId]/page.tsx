'use client';
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react';
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
}: {
  card: Card | null;
  verifying: boolean;
}) {
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
          {ready && card?.tenant.logoUrl ? (
            <img
              src={card.tenant.logoUrl}
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
                ? TYPE_LABEL[card!.type] || 'Tarjeta'
                : 'Programa de fidelización'}
            </div>
            <div className="font-bold text-base sm:text-lg leading-tight truncate">
              {ready ? card!.tenant.brandName : verifying ? 'Verificando…' : ' '}
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
const MONTH_NAMES = [
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
];
const MONTH_OPTIONS = MONTH_NAMES.map((m, i) => (
  <option key={m} value={i + 1}>
    {m}
  </option>
));

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
  onFirstInput,
  onSubmit,
}: {
  primary: string;
  ready: boolean;
  onFirstInput: () => void;
  onSubmit: (data: SubmitPayload) => Promise<void>;
}) {
  const tt = useT();
  const [country, setCountry] = useState('CO');
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [bdayDay, setBdayDay] = useState<string>('');
  const [bdayMonth, setBdayMonth] = useState<string>('');
  const [accept, setAccept] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // País actual (datos read-only del array estático). Recalcular en cada
  // render es O(20) — irrelevante.
  const selectedCountry = COUNTRIES.find((c) => c.code === country);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!ready) {
      setErr('Verificando tu tarjeta, intenta de nuevo en un segundo.');
      return;
    }
    if (!accept) {
      setErr('Tienes que aceptar para continuar');
      return;
    }
    // Validaciones de submit (NUNCA en cada keystroke). Phone replace
    // del onChange es cosmético — la validación de longitud va acá.
    const dial = selectedCountry?.dial ?? '57';
    const phoneFull = `+${dial}${phone.replace(/\D/g, '')}`;
    if (phoneFull.length < 10) {
      setErr('Teléfono inválido');
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
      });
    } catch (e: any) {
      setErr(e?.message || 'Error');
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
              onChange={(e) => setCountry(e.target.value)}
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
          <label className="label">{tt('card.email')}</label>
          <input
            className="input"
            type="email"
            placeholder="tucorreo@ejemplo.com"
            value={email}
            onChange={(e) => {
              onFirstInput();
              setEmail(e.target.value);
            }}
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            enterKeyHint="next"
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
              {DAY_OPTIONS}
            </select>
            <select
              className="input"
              value={bdayMonth}
              onChange={(e) => setBdayMonth(e.target.value)}
            >
              <option value="">{tt('card.birth_month')}</option>
              {MONTH_OPTIONS}
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
          <span>Acepto recibir notificaciones vía Push.</span>
        </label>

        {err && (
          <div className="rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink">
            {err}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !fullName || !phone || !accept || !ready}
          className="w-full justify-center text-sm sm:text-base py-3.5 rounded-pill font-semibold text-white shadow-md transition disabled:opacity-50 hover:opacity-95 active:scale-[0.97] mt-1 touch-manipulation [-webkit-tap-highlight-color:transparent]"
          style={{ background: primary }}
          title={!ready ? 'Verificando datos del negocio…' : undefined}
        >
          {submitting
            ? tt('card.submitting')
            : !ready
            ? 'Verificando…'
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

  // El card empieza con cache si hay; sino null. El form se renderiza
  // SIEMPRE — los campos no esperan al fetch. La cabecera de marca se
  // anima cuando llegan datos.
  const [card, setCard] = useState<Card | null>(() =>
    typeof window !== 'undefined' && cardId
      ? readCache(cardId as string, locale)
      : null,
  );
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
      const res = await fetch(`${API}/api/passes/enroll/${cardId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, utmSlug }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || 'No pudimos crear tu tarjeta');
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
          <h1 className="text-xl font-bold">Conexión lenta</h1>
          <p className="text-mute text-sm mt-2">
            No pudimos cargar la tarjeta. Revisa tu conexión y reintenta.
          </p>
          <button
            type="button"
            className="btn-primary mt-4 w-full"
            onClick={() => {
              setNetworkError(false);
              setRetryCount((c) => c + 1);
            }}
          >
            🔄 Reintentar
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

  return (
    <main className="min-h-screen bg-bg pb-8 sm:pb-12">
      <BrandHeader card={card} verifying={verifying} />

      <div className="max-w-md mx-auto px-4 sm:px-5 -mt-10">
        <FormFields
          primary={primary}
          ready={ready}
          onFirstInput={onFirstInput}
          onSubmit={onSubmitForm}
        />

        {ready && card!.terms && (
          <details className="mt-4 text-xs text-mute px-2 animate-in fade-in duration-300">
            <summary className="cursor-pointer hover:text-ink">
              Términos y condiciones
            </summary>
            <p className="mt-2 leading-relaxed">{card!.terms}</p>
          </details>
        )}

        <ClubifyBadge />
        <LanguageSwitcher />
      </div>
    </main>
  );
}
