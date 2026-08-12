'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { setSession } from '@/lib/api';
import { Logo } from '@/components/Logo';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// Mismas opciones que /c/[cardId] enroll — LATAM + USA + España.
const COUNTRIES = [
  { code: 'CO', flag: '🇨🇴', dial: '57' },
  { code: 'MX', flag: '🇲🇽', dial: '52' },
  { code: 'AR', flag: '🇦🇷', dial: '54' },
  { code: 'CL', flag: '🇨🇱', dial: '56' },
  { code: 'PE', flag: '🇵🇪', dial: '51' },
  { code: 'EC', flag: '🇪🇨', dial: '593' },
  { code: 'BR', flag: '🇧🇷', dial: '55' },
  { code: 'VE', flag: '🇻🇪', dial: '58' },
  { code: 'BO', flag: '🇧🇴', dial: '591' },
  { code: 'PY', flag: '🇵🇾', dial: '595' },
  { code: 'UY', flag: '🇺🇾', dial: '598' },
  { code: 'CR', flag: '🇨🇷', dial: '506' },
  { code: 'GT', flag: '🇬🇹', dial: '502' },
  { code: 'PA', flag: '🇵🇦', dial: '507' },
  { code: 'BZ', flag: '🇧🇿', dial: '501' },
  { code: 'DO', flag: '🇩🇴', dial: '1' },
  { code: 'SV', flag: '🇸🇻', dial: '503' },
  { code: 'HN', flag: '🇭🇳', dial: '504' },
  { code: 'NI', flag: '🇳🇮', dial: '505' },
  { code: 'ES', flag: '🇪🇸', dial: '34' },
  { code: 'US', flag: '🇺🇸', dial: '1' },
];

const VALID_SOURCES = new Set([
  'LANDING',
  'AMBASSADOR',
  'INFLUENCER',
  'CAMPAIGN',
  'DIRECT',
]);

export default function TrialSignupClient() {
  return (
    <Suspense fallback={<div className="p-8 text-mute">Cargando…</div>}>
      <TrialInner />
    </Suspense>
  );
}

function TrialInner() {
  const router = useRouter();
  const params = useSearchParams();

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    company: '',
    city: '',
    accept: false,
  });
  const [country, setCountry] = useState('CO');
  const [submitting, setSubmitting] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Atribución: ?ref=<code> y ?source=<type> en el URL. Si el embajador
  // comparte /prueba?ref=JUAN123, el ref se manda al backend y atribuye
  // el trial. Si manda ?source=INFLUENCER explícito, lo sobrescribe;
  // sino el backend lo infiere del rol del code.
  const [refCode, setRefCode] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const refUrl = params.get('ref');
    const cachedRef = localStorage.getItem('clubify:ref');
    const winner = refUrl || cachedRef || '';
    if (winner) setRefCode(winner.toUpperCase());

    const srcUrl = params.get('source')?.toUpperCase();
    if (srcUrl && VALID_SOURCES.has(srcUrl)) setSource(srcUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Modo checkout: si el super admin configuró la URL de checkout de Hotmart para
  // la prueba con tarjeta (Setting landing.trial.checkoutUrl, en /admin/branding),
  // /trial REDIRIGE ahí pasando ?src=<ref> en vez de crear la cuenta gratis directo.
  // Si NO está configurada, se mantiene el flujo actual (prueba gratis sin tarjeta)
  // → así el cambio no rompe nada y se activa solo cuando el fundador pega la URL.
  const [trialCheckoutUrl, setTrialCheckoutUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Reintenta una vez: un fallo transitorio de /branding NO debe degradar el
      // funnel de pago a alta gratis (saltarse el paywall del trial con tarjeta).
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await fetch(`${API}/api/branding`);
          if (r.ok) {
            const b = await r.json();
            if (!cancelled && b?.trialCheckoutUrl) setTrialCheckoutUrl(b.trialCheckoutUrl);
            break;
          }
        } catch { /* reintenta */ }
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);
  // Modo explícito por link — los paneles de embajador/vendedor comparten DOS
  // links: `?mode=card` fuerza la prueba CON tarjeta (checkout Hotmart; si la URL
  // no está configurada aún, cae con gracia al form sin tarjeta para no dejar al
  // prospecto sin salida) y `?mode=free` fuerza la prueba SIN tarjeta. Sin `?mode`
  // se mantiene el comportamiento por Setting (compat con links ya compartidos).
  const modeParam = (params.get('mode') || '').toLowerCase();
  const forceFree = ['free', 'nocard', 'sin-tarjeta'].includes(modeParam);
  const checkoutMode = forceFree ? false : !!trialCheckoutUrl;

  function goToCheckout() {
    if (!trialCheckoutUrl) return;
    // El ref sobrevive el ida-y-vuelta a Hotmart en localStorage (mismo origen) →
    // /activar lo lee tras el pago y atribuye la venta al referido. Además va como
    // ?src=<ref> en la URL para el tracking propio de Hotmart.
    try { if (refCode) localStorage.setItem('clubify:ref', refCode); } catch {}
    let url = trialCheckoutUrl;
    if (refCode) {
      try {
        // URL API: agrega src como query REAL (antes del fragmento #) sin duplicar.
        const u = new URL(trialCheckoutUrl);
        if (!u.searchParams.has('src')) u.searchParams.set('src', refCode);
        url = u.toString();
      } catch {
        // URL relativa/inválida: fallback respetando el fragmento.
        const [base, hash = ''] = trialCheckoutUrl.split('#');
        const sep = base.includes('?') ? '&' : '?';
        url = `${base}${sep}src=${encodeURIComponent(refCode)}${hash ? '#' + hash : ''}`;
      }
    }
    window.location.href = url;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!form.accept) {
      setErr('Tienes que aceptar los términos para continuar.');
      return;
    }
    if (form.password.length < 8) {
      setErr('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    const dial = COUNTRIES.find((c) => c.code === country)?.dial ?? '57';
    const phoneFull = `+${dial}${form.phone.replace(/\D/g, '')}`;
    if (phoneFull.length < 10) {
      setErr('Teléfono inválido.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API}/api/auth/trial-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim().toLowerCase(),
          password: form.password,
          phone: phoneFull,
          company: form.company.trim() || undefined,
          city: form.city.trim() || undefined,
          referralCode: refCode ?? undefined,
          source: source ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || 'No pudimos crear tu prueba.');
      }
      // Auto-login y redirect al panel.
      setSession(data.accessToken, data.user, {
        refreshToken: data.refreshToken,
      });
      router.push('/app?welcome=trial');
    } catch (e: any) {
      setErr(e?.message || 'Error inesperado.');
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-bg flex flex-col items-center px-4 sm:px-6 py-10">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-6">
          <Logo />
        </div>

        <div className="card shadow-xl p-6 sm:p-8">
          {!loaded ? (
            <div className="py-12 text-center text-sm text-mute">Cargando…</div>
          ) : (
          <>
          <div className="text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-pill bg-brand-soft text-brand text-xs font-semibold uppercase tracking-wider">
              🎁 Prueba · 5 días
            </div>
            <h1 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight">
              {checkoutMode ? 'Activa tu prueba gratuita' : 'Prueba Clubify gratis'}
            </h1>
            <p className="mt-1.5 text-sm text-mute leading-relaxed">
              {checkoutMode
                ? 'Comienza hoy y prueba Clubify durante 5 días.'
                : 'Sin tarjeta. Sin compromiso. Activa tu cuenta al final de los 5 días si te convence.'}
            </p>
          </div>

          {checkoutMode ? (
            <div className="mt-6 space-y-4">
              {refCode && (
                <div className="rounded-lg bg-brand-soft/40 px-3 py-2 text-xs text-brand-ink text-center">
                  Te referenció: <strong>{refCode}</strong>
                </div>
              )}
              <button
                type="button"
                onClick={goToCheckout}
                className="btn-primary w-full justify-center py-3.5 text-base font-semibold"
              >
                Activar mi prueba →
              </button>
              <p className="text-center text-xs text-mute">
                Pago seguro con Hotmart · activación inmediata.
              </p>
              <p className="text-center text-xs text-mute">
                ¿Ya tienes cuenta?{' '}
                <Link href="/login" className="text-brand hover:underline">
                  Inicia sesión
                </Link>
              </p>
            </div>
          ) : (
          <form onSubmit={submit} className="mt-6 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Nombre</label>
                <input
                  className="input"
                  value={form.firstName}
                  onChange={(e) =>
                    setForm({ ...form, firstName: e.target.value })
                  }
                  required
                  maxLength={60}
                  autoComplete="given-name"
                />
              </div>
              <div>
                <label className="label">Apellido</label>
                <input
                  className="input"
                  value={form.lastName}
                  onChange={(e) =>
                    setForm({ ...form, lastName: e.target.value })
                  }
                  required
                  maxLength={60}
                  autoComplete="family-name"
                />
              </div>
            </div>

            <div>
              <label className="label">Correo</label>
              <input
                className="input"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
                autoComplete="email"
                placeholder="tucorreo@ejemplo.com"
              />
            </div>

            <div>
              <label className="label">Teléfono</label>
              <div className="flex gap-2">
                <select
                  className="input w-24 sm:w-28 flex-none"
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
                  value={form.phone}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      phone: e.target.value.replace(/\D/g, ''),
                    })
                  }
                  required
                  autoComplete="tel-national"
                />
              </div>
            </div>

            <div>
              <label className="label">Contraseña</label>
              <div className="relative">
                <input
                  className="input pr-12"
                  type={showPwd ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="Mín. 8 caracteres"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-mute px-2 py-1 rounded hover:bg-bg2"
                >
                  {showPwd ? 'Ocultar' : 'Ver'}
                </button>
              </div>
            </div>

            {/* Campos opcionales — útiles para que el equipo comercial haga
                follow-up y para métricas geo/segmento. */}
            <details className="rounded-lg border border-line2 px-3 py-2 text-sm">
              <summary className="cursor-pointer text-mute hover:text-ink select-none">
                Empresa y ciudad (opcional)
              </summary>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="label">Empresa o negocio</label>
                  <input
                    className="input"
                    value={form.company}
                    onChange={(e) =>
                      setForm({ ...form, company: e.target.value })
                    }
                    maxLength={120}
                    placeholder="Café del barrio, Pizzería La Nona, etc."
                  />
                  <div className="text-[11px] text-mute mt-1">
                    Si no la pones, usamos tu nombre completo como marca.
                  </div>
                </div>
                <div>
                  <label className="label">Ciudad</label>
                  <input
                    className="input"
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    maxLength={80}
                    placeholder="Bogotá, CDMX, Buenos Aires…"
                  />
                </div>
              </div>
            </details>

            <label className="flex items-start gap-2 text-xs text-mute pt-1">
              <input
                type="checkbox"
                className="mt-0.5 accent-brand"
                checked={form.accept}
                onChange={(e) =>
                  setForm({ ...form, accept: e.target.checked })
                }
              />
              <span>
                Acepto los{' '}
                <Link href="/terminos" className="underline">
                  términos
                </Link>{' '}
                y entiendo que mi prueba dura 5 días.
              </span>
            </label>

            {err && (
              <div className="rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink">
                {err}
              </div>
            )}

            {refCode && (
              <div className="rounded-lg bg-brand-soft/40 px-3 py-2 text-xs text-brand-ink">
                Te referenció: <strong>{refCode}</strong>
              </div>
            )}

            <button
              type="submit"
              disabled={
                submitting ||
                !form.firstName ||
                !form.lastName ||
                !form.email ||
                !form.phone ||
                !form.password ||
                !form.accept
              }
              className="btn-primary w-full justify-center py-3.5 text-base font-semibold disabled:opacity-50 mt-2"
            >
              {submitting ? 'Creando tu prueba…' : 'Empezar mi prueba gratis →'}
            </button>

            <p className="text-center text-xs text-mute">
              ¿Ya tienes cuenta?{' '}
              <Link href="/login" className="text-brand hover:underline">
                Inicia sesión
              </Link>
            </p>
          </form>
          )}
          </>
          )}
        </div>

        <p className="text-center text-[11px] text-mute mt-4">
          Acceso privado · No compartas este enlace públicamente.
        </p>
      </div>
    </main>
  );
}
