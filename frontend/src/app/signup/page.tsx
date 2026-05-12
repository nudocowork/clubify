'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api, setSession } from '@/lib/api';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type PromoResolved = {
  type: 'coupon' | 'referral' | 'mixed' | 'invalid';
  message: string;
  discountPercent?: number;
  duration?: 'FIRST_MONTH' | 'RECURRING';
  attribution?: { role: string; ownerName: string; code: string } | null;
  couponId?: string;
  referralCodeId?: string;
};
import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';
import {
  BUSINESS_CATEGORIES,
  DEFAULT_CATEGORY_SLUG,
} from '@/lib/business-categories';

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="p-8 text-mute">Cargando…</div>}>
      <SignupInner />
    </Suspense>
  );
}

function SignupInner() {
  const router = useRouter();
  const params = useSearchParams();
  const planParam = (params.get('plan') || 'elite').toLowerCase();
  const isPro = planParam === 'pro';
  const planLabel = isPro ? 'Pro' : 'Elite';
  const planPriceUsd = isPro ? 99 : 50;

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
  const [promoCode, setPromoCode] = useState('');
  const [promoResolved, setPromoResolved] = useState<PromoResolved | null>(null);
  const [validatingPromo, setValidatingPromo] = useState(false);

  // Pre-rellenar promo si vino por URL ?ref=X o ?promo=X
  useEffect(() => {
    const fromUrl = params.get('promo') || params.get('ref') || '';
    if (fromUrl) {
      setPromoCode(fromUrl.toUpperCase());
    } else if (typeof window !== 'undefined') {
      const cached = localStorage.getItem('clubify:ref') || localStorage.getItem('clubify:promo') || '';
      if (cached) setPromoCode(cached.toUpperCase());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Capturar qt (quoteToken) del URL — viene del CTA de /q/<token> y se
  // usa para closed-loop de conversion tracking. Persistimos en
  // sessionStorage (no localStorage) por si el usuario abre signup desde
  // otra pestaña entre que ve la cotización y se registra.
  const [quoteToken, setQuoteToken] = useState<string | null>(null);
  useEffect(() => {
    const fromUrl = params.get('qt');
    if (fromUrl && fromUrl.length >= 8 && fromUrl.length <= 64) {
      setQuoteToken(fromUrl);
      try {
        sessionStorage.setItem('clubify:qt', fromUrl);
      } catch {}
    } else if (typeof window !== 'undefined') {
      try {
        const cached = sessionStorage.getItem('clubify:qt');
        if (cached) setQuoteToken(cached);
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Validación live del promo (debounced 350ms)
  useEffect(() => {
    if (!promoCode || promoCode.trim().length < 3) {
      setPromoResolved(null);
      return;
    }
    const t = setTimeout(async () => {
      setValidatingPromo(true);
      try {
        const r = await fetch(
          `${API}/api/public/promo/validate?code=${encodeURIComponent(promoCode)}&plan=${planLabel}`,
        );
        const data: PromoResolved = await r.json();
        setPromoResolved(data);
      } catch {
        setPromoResolved({ type: 'invalid', message: 'No se pudo validar' });
      } finally {
        setValidatingPromo(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [promoCode, planLabel]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!form.accept) {
      setErr('Tienes que aceptar los términos para continuar');
      return;
    }
    setSubmitting(true);
    // Si la validación reconoció el código como cupón o mixto lo enviamos
    // como couponCode; si fue solo referral, como referralCode. Si vino
    // del URL/localStorage sin validar, también va como referralCode (el
    // backend resuelve igual).
    const trimmedPromo = promoCode.trim().toUpperCase() || undefined;
    let referralCode: string | undefined;
    let couponCode: string | undefined;
    if (promoResolved && trimmedPromo) {
      if (promoResolved.type === 'coupon' || promoResolved.type === 'mixed') {
        couponCode = trimmedPromo;
      } else if (promoResolved.type === 'referral') {
        referralCode = trimmedPromo;
      }
    } else if (trimmedPromo) {
      referralCode = trimmedPromo;
    }
    try {
      const r = await api<{
        accessToken: string;
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
          couponCode,
          plan: isPro ? 'pro' : 'elite',
          quoteToken: quoteToken || undefined,
        }),
      });
      setSession(r.accessToken, r.user);
      try {
        localStorage.removeItem('clubify:ref');
        sessionStorage.removeItem('clubify:qt');
      } catch {}

      // Tanto Elite como Pro pasan por Hotmart antes de entrar al panel:
      // Pro → cobro inmediato; Elite → registro de tarjeta para activar el
      // trial de 10 días gratis. Solo después de dejar la tarjeta entran
      // oficialmente a la plataforma (lockscreen en AppShell).
      try {
        const c = await api<{ url: string | null }>('/billing/hotmart/checkout-url');
        if (c?.url) {
          window.location.href = c.url;
          return;
        }
      } catch {}
      // Fallback: si por alguna razón no hay checkout URL configurada,
      // mandamos a billing donde verán cómo completar la activación.
      router.push('/app/billing');
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
              Plan {planLabel} · USD {planPriceUsd}/mes · activación inmediata
            </div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              {isPro ? 'Activa Pro y empieza ahora' : 'Crea tu negocio en Clubify'}
            </h1>
            <p className="text-mute mt-2 leading-relaxed">
              {isPro
                ? 'Creas tu cuenta y te llevamos al pago seguro. Apenas el cobro se aprueba quedas activo con todas las automatizaciones de WhatsApp.'
                : 'Creas tu cuenta y te llevamos al pago seguro de Hotmart. Apenas se confirme el pago entras al panel y empiezas a vender.'}
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
                <label className="label">Email</label>
                <input
                  className="input"
                  type="email"
                  placeholder="tucorreo@ejemplo.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  autoComplete="email"
                  required
                />
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

              <div>
                <label className="label">
                  Código promocional
                  <span className="text-mute font-normal ml-1">(opcional)</span>
                </label>
                <input
                  className="input"
                  placeholder="JUAN10"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                  autoComplete="off"
                />
                {validatingPromo && (
                  <div className="text-xs text-mute mt-1">Validando…</div>
                )}
                {promoResolved && !validatingPromo && (
                  <div
                    className={`text-xs mt-1.5 px-2.5 py-1.5 rounded-lg ${
                      promoResolved.type === 'invalid'
                        ? 'bg-bad-soft text-bad-ink'
                        : 'bg-ok-soft text-ok'
                    }`}
                  >
                    {promoResolved.message}
                  </div>
                )}
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
                  .{' '}
                  Al continuar te llevamos al checkout para cobrarte USD {planPriceUsd}/mes
                  (equivalente en tu moneda local). Apenas se apruebe el pago entras
                  al panel. Puedes cancelar en cualquier momento desde tu panel.
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
                  'Llevándote al pago…'
                ) : (
                  <>
                    <Icon name="spark" /> Continuar al pago →
                  </>
                )}
              </button>

              <p className="text-center text-xs text-mute pt-1">
                Pago seguro con tarjeta · cancelas cuando quieras
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
                {
                  n: '1',
                  t: 'Tu marca',
                  d: 'Logo, colores y datos básicos',
                },
                {
                  n: '2',
                  t: 'WhatsApp + redes',
                  d: 'Por dónde te llegan los pedidos',
                },
                {
                  n: '3',
                  t: 'Tu primer producto',
                  d: 'Foto, precio y descripción',
                },
                {
                  n: '4',
                  t: 'Tu tarjeta de fidelización',
                  d: 'Sellos, recompensas, colores',
                },
                {
                  n: '5',
                  t: 'Tu link público',
                  d: 'Comparte y empieza a vender',
                },
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
