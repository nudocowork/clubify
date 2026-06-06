'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api, setSession } from '@/lib/api';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';
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

  const [planPeriod, setPlanPeriod] = useState<PlanPeriodId | null>(null);
  const [planData, setPlanData] = useState<LandingPlanLite | null>(null);

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

  // Plan elegido: persistido por el picker en localStorage. Si no hay nada
  // (ej. llegó desde el email de recuperación sin pasar por el picker) lo
  // dejamos null → badge genérico, no asumimos un plan que podría ser
  // incorrecto (el billing real lo dicta Hotmart, esto es informativo).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let raw = '';
    try {
      raw = (localStorage.getItem('clubify:plan-period') || '').toLowerCase();
    } catch {}
    const valid: PlanPeriodId[] = ['mensual', 'trimestral', 'semestral', 'anual'];
    setPlanPeriod(valid.includes(raw as PlanPeriodId) ? (raw as PlanPeriodId) : null);
  }, []);

  // Precio del plan para el badge informativo.
  useEffect(() => {
    if (!planPeriod) return;
    let cancelled = false;
    fetch(`${API}/api/landing-plans`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: any) => {
        if (cancelled || !d) return;
        const v = d[planPeriod];
        if (!v) return;
        setPlanData({
          id: planPeriod,
          name: PLAN_PERIOD_MAP[planPeriod].label,
          price: Number.isFinite(v.price) && v.price > 0 ? v.price : 0,
        });
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [planPeriod]);

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

    let attribution: {
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
    <main className="min-h-screen bg-bg flex flex-col">
      <header className="border-b border-line bg-white px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center">
            <Logo size={32} />
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
            <div className="inline-flex items-center gap-2 bg-brand-soft text-brand-700 text-xs font-semibold px-3 py-1 rounded-full mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-brand" />
              {planPeriod && planData
                ? `Pago confirmado · Plan ${PLAN_PERIOD_MAP[planPeriod].label} · USD ${planData.price}`
                : 'Pago confirmado · activa tu cuenta'}
            </div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              Crea tu cuenta en Clubify
            </h1>
            <p className="text-mute mt-2 leading-relaxed">
              Ya pagaste 🎉. Completa estos datos y entras al panel para
              empezar a vender. Usa el <strong>mismo correo con el que
              pagaste</strong> para activar tu cuenta al instante.
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
              Ya hay 200+ negocios en LATAM usando Clubify para vender por
              WhatsApp y fidelizar clientes.
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
