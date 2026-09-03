'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api, setSession } from '@/lib/api';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
import { Icon } from '@/components/Icon';
import { useAuthBrand, BrandMark, BrandAuthTheme } from '@/components/AuthBrand';
import { RefCapture } from '@/components/RefCapture';
import {
  BUSINESS_CATEGORIES,
  DEFAULT_CATEGORY_SLUG,
} from '@/lib/business-categories';

export default function ActivarPage() {
  return (
    <Suspense fallback={<div className="p-8 text-mute">Cargando…</div>}>
      <RefCapture />
      <ActivarInner />
    </Suspense>
  );
}

type PlanPeriodId = 'mensual' | 'trimestral' | 'semestral' | 'anual';
type LandingPlanLite = {
  id: PlanPeriodId;
  name: string;
  price: number;
};

const PLAN_PERIOD_MAP: Record<
  PlanPeriodId,
  { label: string; cadence: string; periodicityCode: 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL' }
> = {
  mensual: { label: 'Mensual', cadence: 'cada mes', periodicityCode: 'MENSUAL' },
  trimestral: { label: 'Trimestral', cadence: 'cada 3 meses', periodicityCode: 'TRIMESTRAL' },
  semestral: { label: 'Semestral', cadence: 'cada 6 meses', periodicityCode: 'SEMESTRAL' },
  anual: { label: 'Anual', cadence: 'una vez al año', periodicityCode: 'ANUAL' },
};

/**
 * Página de activación post-pago (flujo "pago → datos", 2026-06-06).
 *
 * El cliente llega aquí DESPUÉS de pagar en Hotmart (la página de gracias
 * de Hotmart redirige a /activar). Llena sus datos → POST /auth/signup
 * crea la cuenta y, como el webhook ya guardó el PendingHotmartPayment por
 * su email, el backend la activa al instante (status ACTIVE). Si el pago
 * aún no llegó, la cuenta queda en TRIAL y el webhook la activa al llegar.
 *
 * El plan elegido viene de localStorage (lo persiste el picker /signup),
 * y la atribución del referido de localStorage (RefCapture).
 */
function ActivarInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Branding por marca del host (selleala.com → Sellea). Sin marca = Clubify.
  const { brand } = useAuthBrand();
  const brandName = brand?.name || 'Clubify';

  const [planPeriod, setPlanPeriod] = useState<PlanPeriodId | null>(null);
  const [planData, setPlanData] = useState<LandingPlanLite | null>(null);
  // Fix 2026-06-11: si el cliente llegó vía WhatsApp/SMS/email post-pago
  // con `?email=X`, hacemos lookup del PendingHotmartPayment para
  // pre-llenar el form (nombre, teléfono, plan derivado del producto
  // comprado). Eso resuelve el caso donde el cliente perdió
  // localStorage (cambió de dispositivo, no pasó por /signup).
  const [pendingDetected, setPendingDetected] = useState(false);
  const [pendingPrice, setPendingPrice] = useState<number | null>(null);
  const [pendingCurrency, setPendingCurrency] = useState<string | null>(null);
  /**
   * Estado de la COMPROBACIÓN del pago contra el servidor.
   *
   * Fix 2026-08-24: el cartel decía «Pago confirmado · Plan Mensual · USD 68»
   * a partir del plan que el visitante había elegido en el selector — o sea,
   * de `localStorage`, sin comprobar nada. Quien entraba directo a /activar
   * (por ejemplo desde «¿Ya pagaste? Completar mi cuenta») leía que su pago
   * estaba confirmado sin haber pagado.
   *
   * La cuenta nunca se activaba de verdad —el backend la crea en TRIAL y solo
   * la pasa a ACTIVE si el webhook registró un pago con ese correo—, pero la
   * página afirmaba algo falso y creaba cuentas basura. Ahora quien decide el
   * mensaje es el servidor: `GET /auth/check-pending`.
   *
   * 'idle' = todavía no hay un correo que valga la pena consultar.
   */
  const [pagoCheck, setPagoCheck] = useState<
    'idle' | 'checking' | 'found' | 'not-found'
  >('idle');

  const [form, setForm] = useState({
    fullName: '',
    brandName: '',
    email: '',
    whatsappPhone: '',
    password: '',
    businessCategorySlug: DEFAULT_CATEGORY_SLUG,
    accept: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showPwd, setShowPwd] = useState(false);

  // Lookup del PendingHotmartPayment si vino ?email=. Carga primero
  // este antes que el localStorage para que el plan del pago real
  // tenga prioridad sobre el plan del picker (que pudo haber sido
  // editado o ser de una sesión vieja).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const emailParam = (searchParams?.get('email') ?? '').trim();
    if (!emailParam) return;
    let cancelled = false;
    setPagoCheck('checking');
    fetch(
      `${API}/api/auth/check-pending?email=${encodeURIComponent(emailParam)}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((d: any) => {
        if (cancelled) return;
        if (!d?.found) {
          setPagoCheck('not-found');
          return;
        }
        setPagoCheck('found');
        setPendingDetected(true);
        setPendingPrice(
          typeof d.purchaseValue === 'number' ? d.purchaseValue : null,
        );
        setPendingCurrency(
          typeof d.purchaseCurrency === 'string' ? d.purchaseCurrency : null,
        );
        setForm((f) => ({
          ...f,
          email: emailParam,
          fullName: f.fullName || d.buyerName || '',
          whatsappPhone: f.whatsappPhone || d.buyerPhone || '',
        }));
        if (d.periodicity) {
          const map: Record<string, PlanPeriodId> = {
            MENSUAL: 'mensual',
            TRIMESTRAL: 'trimestral',
            SEMESTRAL: 'semestral',
            ANUAL: 'anual',
          };
          const p = map[d.periodicity as string];
          if (p) setPlanPeriod(p);
        }
      })
      .catch(() => {
        // Si la consulta falla (red del cliente, backend caído) NO afirmamos
        // que no hay pago: volvemos a 'idle' y el formulario sigue su curso.
        // El backend es quien decide de verdad al crear la cuenta.
        if (!cancelled) setPagoCheck('idle');
      });
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  /**
   * Lo mismo, pero con el correo que la persona ESCRIBE.
   *
   * Es el caso normal: casi nadie llega con `?email=` en la URL — llegan de la
   * página de gracias de Hotmart o del enlace «¿Ya pagaste?». Sin esto, el
   * único camino que comprobaba el pago era el que casi nunca se usa.
   *
   * Espera a que deje de teclear (600 ms) para no consultar en cada letra.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // El de `?email=` ya resolvió y rellenó el formulario: no lo pisamos.
    if (searchParams?.get('email')) return;
    const email = form.email.trim().toLowerCase();
    if (!email.includes('@') || email.length < 6) {
      setPagoCheck('idle');
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      setPagoCheck('checking');
      fetch(`${API}/api/auth/check-pending?email=${encodeURIComponent(email)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: any) => {
          if (cancelled) return;
          if (!d?.found) {
            setPendingDetected(false);
            setPagoCheck('not-found');
            return;
          }
          setPagoCheck('found');
          setPendingDetected(true);
          setPendingPrice(
            typeof d.purchaseValue === 'number' ? d.purchaseValue : null,
          );
          setPendingCurrency(
            typeof d.purchaseCurrency === 'string' ? d.purchaseCurrency : null,
          );
          // El plan del pago REAL manda sobre el que se eligió en el selector.
          if (d.periodicity) {
            const map: Record<string, PlanPeriodId> = {
              MENSUAL: 'mensual',
              TRIMESTRAL: 'trimestral',
              SEMESTRAL: 'semestral',
              ANUAL: 'anual',
            };
            const p = map[d.periodicity as string];
            if (p) setPlanPeriod(p);
          }
        })
        .catch(() => {
          if (!cancelled) setPagoCheck('idle');
        });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [form.email, searchParams]);

  // Plan elegido: persistido por el picker en localStorage. Si no hay nada
  // (ej. llegó desde el email de recuperación sin pasar por el picker) lo
  // dejamos null → badge genérico, no asumimos un plan que podría ser
  // incorrecto (el billing real lo dicta Hotmart, esto es informativo).
  // Fix 2026-06-11: solo aplicamos el localStorage si NO detectamos un
  // PendingHotmartPayment (cuyo plan tiene prioridad por ser el real).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (pendingDetected) return;
    let raw = '';
    try {
      raw = (localStorage.getItem('clubify:plan-period') || '').toLowerCase();
    } catch {}
    const valid: PlanPeriodId[] = ['mensual', 'trimestral', 'semestral', 'anual'];
    setPlanPeriod(valid.includes(raw as PlanPeriodId) ? (raw as PlanPeriodId) : null);
  }, [pendingDetected]);

  // Precio del plan para el badge informativo. En una marca blanca (ej. Sellea)
  // el precio es el del plan de la marca (WhiteLabelPaymentLink, ej. USD 80), NO
  // el precio global de Clubify de `/landing-plans` (ej. USD 68) — eran fuentes
  // distintas y por eso /activar mostraba 68 en un dominio de Sellea.
  useEffect(() => {
    if (!planPeriod) return;
    let cancelled = false;
    const setPrice = (price: number) =>
      setPlanData({
        id: planPeriod,
        name: PLAN_PERIOD_MAP[planPeriod].label,
        price,
      });
    const globalFallback = () =>
      fetch(`${API}/api/landing-plans`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: any) => {
          if (cancelled || !d) return;
          const v = d[planPeriod];
          if (!v) return;
          setPrice(Number.isFinite(v.price) && v.price > 0 ? v.price : 0);
        })
        .catch(() => null);

    if (brand) {
      const host =
        typeof window !== 'undefined' ? window.location.host : '';
      fetch(
        `${API}/api/superadmin-public/white-labels/payment-links-by-host?host=${encodeURIComponent(host)}`,
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((d: any) => {
          if (cancelled) return;
          const link = d?.links?.find(
            (l: any) =>
              // Excluimos upgrades por entitlement (INFOLINK_PRO/FULL): un plan
              // MENSUAL no debe tomar el precio del InfoLink PRO ($14.99).
              !l.productKey &&
              String(l.periodicity || '').toUpperCase() ===
                planPeriod.toUpperCase(),
          );
          if (link && Number(link.amountUsd) > 0) {
            setPrice(Number(link.amountUsd));
          } else {
            void globalFallback();
          }
        })
        .catch(() => globalFallback());
    } else {
      void globalFallback();
    }
    return () => {
      cancelled = true;
    };
  }, [planPeriod, brand]);

  // Atribución oculta del referido (ref/via/utm/referer) + quoteToken.
  const [refCode, setRefCode] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const cachedRef = localStorage.getItem('clubify:ref');
      if (cachedRef) setRefCode(cachedRef.toUpperCase());
    } catch {}
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!form.accept) {
      setErr('Tienes que aceptar los términos para continuar');
      return;
    }
    setSubmitting(true);
    const referralCode = refCode ?? undefined;

    const attribution: {
      viaSlug?: string;
      utmSource?: string;
      utmMedium?: string;
      utmCampaign?: string;
      referer?: string;
    } = {};
    let quoteToken: string | undefined;
    try {
      const via = localStorage.getItem('clubify:via');
      if (via) attribution.viaSlug = via;
      const utmRaw = localStorage.getItem('clubify:utm');
      if (utmRaw) {
        const parsed = JSON.parse(utmRaw) as { source?: string; medium?: string; campaign?: string };
        if (parsed.source) attribution.utmSource = parsed.source;
        if (parsed.medium) attribution.utmMedium = parsed.medium;
        if (parsed.campaign) attribution.utmCampaign = parsed.campaign;
      }
      const ref = localStorage.getItem('clubify:referer');
      if (ref) attribution.referer = ref;
      const qt = sessionStorage.getItem('clubify:qt');
      if (qt) quoteToken = qt;
    } catch {}

    try {
      const r = await api<{
        accessToken: string;
        refreshToken?: string;
        user: any;
      }>('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          fullName: form.fullName,
          brandName: form.brandName,
          whatsappPhone: form.whatsappPhone || undefined,
          businessCategorySlug: form.businessCategorySlug,
          referralCode,
          plan: 'elite',
          planPeriodicity: planPeriod
            ? PLAN_PERIOD_MAP[planPeriod].periodicityCode
            : undefined,
          quoteToken: quoteToken || undefined,
          attribution: Object.keys(attribution).length ? attribution : undefined,
        }),
      });
      setSession(r.accessToken, r.user, { refreshToken: r.refreshToken });
      try {
        // Limpiamos las keys de atribución + plan elegido post-signup —
        // ya quedaron atadas a este tenant en el backend.
        localStorage.removeItem('clubify:ref');
        localStorage.removeItem('clubify:via');
        localStorage.removeItem('clubify:utm');
        localStorage.removeItem('clubify:referer');
        localStorage.removeItem('clubify:plan-period');
        sessionStorage.removeItem('clubify:qt');
      } catch {}

      // Ya pagó: lo mandamos directo al panel. Si por alguna razón el pago
      // todavía no se reflejó (webhook lento o email distinto al del pago),
      // el lockscreen de /app le ofrece completar la activación.
      router.push('/app');
    } catch (e: any) {
      setErr(e.message || 'No se pudo crear la cuenta');
      setSubmitting(false);
    }
  }

  const valid =
    form.fullName.trim().length >= 2 &&
    form.brandName.trim().length >= 2 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email) &&
    form.password.length >= 8;

  return (
    <main className={`min-h-screen bg-bg flex flex-col ${brand ? 'brand-auth' : ''}`}>
      <BrandAuthTheme brand={brand} />
      <header className="border-b border-line bg-white px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center">
            <BrandMark brand={brand} size={32} />
          </Link>
          <Link href="/login" className="text-sm text-mute hover:text-ink">
            ¿Ya tienes cuenta? Ingresar →
          </Link>
        </div>
      </header>

      <section className="flex-1 grid lg:grid-cols-2 gap-0 max-w-6xl mx-auto w-full">
        {/* Form */}
        <div className="px-6 lg:px-12 py-10 lg:py-16">
          <div className="max-w-md mx-auto lg:mx-0">
            {/* El cartel NUNCA afirma un pago que no vimos. «Pago detectado»
                sale solo de check-pending; el plan que la persona eligió en el
                selector se nombra como lo que es —una elección— y no como un
                cobro confirmado. */}
            <div
              className={`inline-flex items-center gap-2 text-xs font-semibold px-3 py-1 rounded-full mb-5 ${
                pendingDetected
                  ? 'bg-ok-soft text-ok-ink'
                  : 'bg-brand-soft text-brand-700'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${pendingDetected ? 'bg-ok' : 'bg-brand'}`}
              />
              {pendingDetected
                ? `Pago detectado${planPeriod ? ` · Plan ${PLAN_PERIOD_MAP[planPeriod].label}` : ''}${pendingPrice ? ` · ${pendingCurrency ?? 'USD'} ${pendingPrice}` : ''}`
                : pagoCheck === 'checking'
                  ? 'Comprobando tu pago…'
                  : planPeriod && planData
                    ? `Plan ${PLAN_PERIOD_MAP[planPeriod].label} elegido · USD ${planData.price}`
                    : 'Activa tu cuenta'}
            </div>
            {pendingDetected && (
              <div className="mb-4 rounded-lg bg-ok-soft border border-ok/30 text-ok-ink px-3 py-2 text-sm">
                ✅ Encontramos tu pago. Completa los datos faltantes y entra
                al panel al instante.
              </div>
            )}
            {/* Ni tampoco lo negamos de golpe: un pago recién hecho tarda unos
                minutos en llegar por el webhook, y el error más común es haber
                puesto un correo distinto al de la compra. */}
            {pagoCheck === 'not-found' && (
              <div className="mb-4 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 px-3 py-2 text-sm leading-relaxed">
                Todavía no vemos un pago con <strong>{form.email.trim()}</strong>.
                <ul className="mt-1.5 ml-4 list-disc space-y-0.5 text-[13px]">
                  <li>
                    Revisa que sea el <strong>mismo correo</strong> con el que
                    pagaste.
                  </li>
                  <li>
                    Si acabas de pagar, puede tardar unos minutos en llegar.
                  </li>
                </ul>
                <div className="mt-1.5 text-[13px]">
                  Puedes crear tu cuenta igual: queda lista y se activa sola en
                  cuanto entre el pago.
                </div>
              </div>
            )}
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              Crea tu cuenta en {brandName}
            </h1>
            {/* «Ya pagaste 🎉» solo cuando de verdad vimos el pago. Antes se
                le decía a cualquiera que entrara, incluso sin haber comprado. */}
            <p className="text-mute mt-2 leading-relaxed">
              {pendingDetected ? (
                <>
                  Ya pagaste 🎉. Completa estos datos y entras al panel para
                  empezar a vender.
                </>
              ) : (
                <>
                  Completa estos datos para entrar al panel. Usa el{' '}
                  <strong>mismo correo con el que pagaste</strong>: así
                  reconocemos tu compra y tu cuenta se activa al instante.
                </>
              )}
            </p>

            <form onSubmit={submit} className="mt-8 space-y-4">
              <div>
                <label className="label">Tu nombre</label>
                <input
                  className="input"
                  placeholder="Ej: Juan Pérez"
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  autoComplete="name"
                  required
                />
              </div>
              <div>
                <label className="label">Nombre del negocio</label>
                <input
                  className="input"
                  placeholder="Ej: Café del Día"
                  value={form.brandName}
                  onChange={(e) => setForm({ ...form, brandName: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label">Email (el que usaste al pagar)</label>
                <input
                  className="input"
                  type="email"
                  placeholder="tucorreo@ejemplo.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  autoComplete="email"
                  required
                />
                <div className="text-xs text-mute mt-1.5">
                  Importante: debe ser el mismo correo del pago para activar al
                  instante.
                </div>
              </div>
              <div>
                <label className="label">WhatsApp del negocio (opcional)</label>
                <input
                  className="input"
                  placeholder="+57 300 000 0000"
                  value={form.whatsappPhone}
                  onChange={(e) =>
                    setForm({ ...form, whatsappPhone: e.target.value })
                  }
                  autoComplete="tel"
                />
                <div className="text-xs text-mute mt-1.5">
                  Se puede agregar después.
                </div>
              </div>
              <div>
                <label className="label">Categoría del negocio</label>
                <select
                  className="input"
                  value={form.businessCategorySlug}
                  onChange={(e) =>
                    setForm({ ...form, businessCategorySlug: e.target.value })
                  }
                  required
                >
                  {BUSINESS_CATEGORIES.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.emoji} {c.name}
                    </option>
                  ))}
                </select>
                <div className="text-xs text-mute mt-1.5">
                  Personalizamos tu panel según el rubro: un autolavado no ve
                  pedidos de comida, una cafetería sí.
                </div>
              </div>
              <div>
                <label className="label">Contraseña</label>
                <div className="relative">
                  <input
                    className="input pr-12"
                    type={showPwd ? 'text' : 'password'}
                    placeholder="Mínimo 8 caracteres"
                    value={form.password}
                    onChange={(e) =>
                      setForm({ ...form, password: e.target.value })
                    }
                    autoComplete="new-password"
                    required
                    minLength={8}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-mute hover:text-ink"
                  >
                    {showPwd ? 'ocultar' : 'mostrar'}
                  </button>
                </div>
              </div>

              <label className="flex items-start gap-2.5 text-sm cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={form.accept}
                  onChange={(e) =>
                    setForm({ ...form, accept: e.target.checked })
                  }
                  className="mt-1 accent-brand"
                />
                <span className="text-mute">
                  Acepto los{' '}
                  <Link href="/legal/terms" target="_blank" className="text-brand hover:underline">
                    Términos
                  </Link>{' '}
                  y la{' '}
                  <Link href="/legal/privacy" target="_blank" className="text-brand hover:underline">
                    Política de privacidad
                  </Link>
                  . Puedes cancelar en cualquier momento desde tu panel.
                </span>
              </label>

              {err && (
                <div className="rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink">
                  {err}
                </div>
              )}

              <button
                type="submit"
                disabled={!valid || submitting}
                className="btn-primary w-full justify-center text-base py-3 disabled:opacity-50"
              >
                {submitting ? (
                  'Creando tu cuenta…'
                ) : (
                  <>
                    <Icon name="spark" /> Crear mi cuenta y entrar →
                  </>
                )}
              </button>

              <p className="text-center text-xs text-mute pt-1">
                Entras al panel apenas confirmamos tu pago.
              </p>
            </form>
          </div>
        </div>

        {/* Side panel */}
        <aside className="hidden lg:flex bg-gradient-to-br from-brand-400 via-brand-500 to-brand-700 text-white px-12 py-16 items-center">
          <div className="max-w-md">
            <div className="text-xs uppercase tracking-[0.18em] font-semibold text-white/80 mb-3">
              Lo que viene después
            </div>
            <h2 className="text-2xl font-bold leading-tight">
              5 pasos visuales para tener tu negocio en línea
            </h2>
            <ol className="mt-8 space-y-4">
              {[
                { n: '1', t: 'Tu marca', d: 'Logo, colores y datos básicos' },
                { n: '2', t: 'WhatsApp + redes', d: 'Por dónde te llegan los pedidos' },
                { n: '3', t: 'Tu primer producto', d: 'Foto, precio y descripción' },
                { n: '4', t: 'Tu tarjeta de fidelización', d: 'Sellos, recompensas, colores' },
                { n: '5', t: 'Tu link público', d: 'Comparte y empieza a vender' },
              ].map((s) => (
                <li key={s.n} className="flex gap-4">
                  <div className="w-9 h-9 flex-none rounded-full bg-white/15 backdrop-blur flex items-center justify-center font-bold">
                    {s.n}
                  </div>
                  <div>
                    <div className="font-semibold">{s.t}</div>
                    <div className="text-sm text-white/75">{s.d}</div>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-10 text-sm text-white/70 border-t border-white/20 pt-6">
              Ya hay 200+ negocios en LATAM usando {brandName} para vender por
              WhatsApp y fidelizar clientes.
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
