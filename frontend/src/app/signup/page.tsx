'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api, setSession } from '@/lib/api';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
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
  const planLabel = 'Elite';
  const planPriceUsd = 50;

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

  // Atribución oculta: el cliente puede haber llegado por un link de
  // afiliado /ref/<slug>?ref=X o tenerlo cached en localStorage. NO
  // exponemos quién atribuye en UI — se manda en el payload sin que
  // el cliente sepa que su signup beneficia a algún afiliado.
  const [refCode, setRefCode] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const refUrl = params.get('ref');
    const cachedRef = localStorage.getItem('clubify:ref');
    const winner = refUrl || cachedRef || '';
    if (winner) setRefCode(winner.toUpperCase());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Capturar qt (quoteToken) del URL — viene del CTA de /q/<token> y se
  // usa para closed-loop de conversion tracking. Persistimos en
  // sessionStorage (no localStorage) por si el usuario abre signup desde
  // otra pestaña entre que ve la cotización y se registra.
  const [quoteToken, setQuoteToken] = useState<string | null>(null);
  useEffect(() => {
    const fromUrl = params.get('qt');
    let token: string | null = null;
    if (fromUrl && fromUrl.length >= 8 && fromUrl.length <= 64) {
      token = fromUrl;
      setQuoteToken(fromUrl);
      try {
        sessionStorage.setItem('clubify:qt', fromUrl);
      } catch {}
    } else if (typeof window !== 'undefined') {
      try {
        const cached = sessionStorage.getItem('clubify:qt');
        if (cached) {
          token = cached;
          setQuoteToken(cached);
        }
      } catch {}
    }
    // Bump CTA click solo si vino directo del URL (no del cache de sessionStorage),
    // así no contamos refresh de la página de signup.
    if (fromUrl && token) {
      // sendBeacon-style: fire-and-forget, no esperamos response.
      fetch(`${API}/api/public/quote/${encodeURIComponent(token)}/cta-click`, {
        method: 'POST',
        keepalive: true,
      }).catch(() => null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Atribución capturada por RefCapture (slug `/ref/<slug>` + UTMs + referer).
    let attribution: {
      viaSlug?: string;
      utmSource?: string;
      utmMedium?: string;
      utmCampaign?: string;
      referer?: string;
    } = {};
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
          quoteToken: quoteToken || undefined,
          attribution: Object.keys(attribution).length ? attribution : undefined,
        }),
      });
      setSession(r.accessToken, r.user, { refreshToken: r.refreshToken });
      try {
        // Limpiamos las keys de atribución post-signup — ya quedaron
        // atadas a este tenant en el backend, no tiene sentido cargarlas
        // en futuras visitas de otra cuenta desde el mismo browser.
        localStorage.removeItem('clubify:ref');
        localStorage.removeItem('clubify:via');
        localStorage.removeItem('clubify:utm');
        localStorage.removeItem('clubify:referer');
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
              Crea tu negocio en Clubify
            </h1>
            <p className="text-mute mt-2 leading-relaxed">
              Creas tu cuenta y te llevamos al pago seguro de Hotmart. Apenas se
              confirme el pago entras al panel y empiezas a vender.
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
