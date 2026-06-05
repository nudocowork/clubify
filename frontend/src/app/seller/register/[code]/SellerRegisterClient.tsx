'use client';
/**
 * /seller/register/<ambassadorCode> — registro público de vendedores.
 *
 * Flow:
 *  1. Mount → GET /seller/register/lookup/<code> para validar embajador.
 *  2. Si valid=false → mostrar bloqueo amigable.
 *  3. Si valid=true → form (nombre, correo, teléfono, password).
 *  4. Submit → POST /seller/register → recibe accessToken+refreshToken+user.
 *  5. setSession + redirect a /affiliate (panel del vendedor).
 *
 * No usamos `api()` helper acá porque no requiere JWT (es público) y
 * queremos un fetch directo con manejo de errores explícito.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { setSession } from '@/lib/api';
import { Logo } from '@/components/Logo';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// Países del flow /prueba — LATAM + USA + España.
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
  { code: 'DO', flag: '🇩🇴', dial: '1' },
  { code: 'SV', flag: '🇸🇻', dial: '503' },
  { code: 'HN', flag: '🇭🇳', dial: '504' },
  { code: 'NI', flag: '🇳🇮', dial: '505' },
  { code: 'ES', flag: '🇪🇸', dial: '34' },
  { code: 'US', flag: '🇺🇸', dial: '1' },
];

type LookupOk = {
  valid: true;
  ambassador: { code: string; ownerName: string; slug: string };
  hasAvailableCommission: boolean;
  defaultVendorCommissionPercent: number;
};
type LookupFail = {
  valid: false;
  reason: 'INVALID_CODE' | 'NOT_FOUND' | 'INACTIVE' | 'NOT_ALLOWED';
};
type Lookup = LookupOk | LookupFail;

export default function SellerRegisterClient({ code }: { code: string }) {
  const router = useRouter();
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    accept: false,
  });
  const [country, setCountry] = useState('CO');
  const [showPwd, setShowPwd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${API}/api/seller/register/lookup/${encodeURIComponent(code)}`)
      .then(async (res) => {
        if (!res.ok) {
          // 5xx o 404: tratamos como NOT_FOUND para no filtrar detalles.
          return { valid: false, reason: 'NOT_FOUND' } as LookupFail;
        }
        return (await res.json()) as Lookup;
      })
      .then((data) => {
        if (!alive) return;
        setLookup(data);
      })
      .catch(() => {
        if (!alive) return;
        setLookup({ valid: false, reason: 'NOT_FOUND' });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [code]);

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
      const res = await fetch(`${API}/api/seller/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ambassadorCode: code,
          fullName: form.fullName.trim(),
          email: form.email.trim().toLowerCase(),
          phone: phoneFull,
          password: form.password,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || 'No pudimos crear tu cuenta.');
      }
      setSession(data.accessToken, data.user, {
        refreshToken: data.refreshToken,
      });
      router.push('/affiliate?welcome=vendor');
    } catch (e: any) {
      setErr(e?.message || 'Error inesperado.');
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-bg flex items-center justify-center p-6">
        <div className="text-mute text-sm">Cargando…</div>
      </main>
    );
  }

  if (!lookup || lookup.valid === false) {
    return (
      <main className="min-h-screen bg-bg flex flex-col items-center px-4 sm:px-6 py-10">
        <div className="w-full max-w-md">
          <div className="flex justify-center mb-6">
            <Logo />
          </div>
          <div className="card shadow-xl p-6 sm:p-8 text-center">
            <div className="text-5xl mb-3">🔒</div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight mb-2">
              Link no disponible
            </h1>
            <p className="text-sm text-mute leading-relaxed">
              Este embajador no tiene habilitado el registro de vendedores.
            </p>
            <p className="text-xs text-mute mt-3 leading-snug">
              Si esperabas registrarte, pedile a tu embajador que confirme
              que su link sigue activo.
            </p>
            <Link
              href="/"
              className="inline-block mt-5 btn-ghost text-sm"
            >
              ← Volver al inicio
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const ambassador = lookup.ambassador;
  const pct = lookup.defaultVendorCommissionPercent;

  return (
    <main className="min-h-screen bg-bg flex flex-col items-center px-4 sm:px-6 py-10">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-6">
          <Logo />
        </div>

        <div className="card shadow-xl p-6 sm:p-8">
          <div className="text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-pill bg-brand-soft text-brand text-xs font-semibold uppercase tracking-wider">
              👥 Suma al equipo
            </div>
            <h1 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight">
              Registrate como vendedor
            </h1>
            <p className="mt-1.5 text-sm text-mute leading-relaxed">
              Te suma al equipo de{' '}
              <strong className="text-ink">{ambassador.ownerName}</strong>.
              {pct > 0 && (
                <>
                  {' '}Cobras <strong className="text-ink">{pct}%</strong> de
                  comisión por cada venta que cierres.
                </>
              )}
            </p>
          </div>

          <form onSubmit={submit} className="mt-6 space-y-3">
            <div>
              <label className="label">Nombre completo</label>
              <input
                className="input"
                value={form.fullName}
                onChange={(e) =>
                  setForm({ ...form, fullName: e.target.value })
                }
                required
                minLength={2}
                maxLength={80}
                autoComplete="name"
                placeholder="Ej: Camila Pérez"
              />
            </div>

            <div>
              <label className="label">Correo</label>
              <input
                className="input"
                type="email"
                value={form.email}
                onChange={(e) =>
                  setForm({ ...form, email: e.target.value })
                }
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
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-mute px-2 py-1 rounded hover:bg-bg2 cursor-pointer touch-manipulation select-none active:scale-[0.97] transition-transform duration-150 [-webkit-tap-highlight-color:transparent]"
                >
                  {showPwd ? 'Ocultar' : 'Ver'}
                </button>
              </div>
            </div>

            <label className="flex items-start gap-2 mt-2 text-xs text-mute cursor-pointer select-none">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={form.accept}
                onChange={(e) =>
                  setForm({ ...form, accept: e.target.checked })
                }
              />
              <span>
                Acepto los{' '}
                <Link href="/legal/terms" className="underline">
                  términos
                </Link>{' '}
                y la{' '}
                <Link href="/legal/privacy" className="underline">
                  privacidad
                </Link>
                .
              </span>
            </label>

            {err && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {err}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="btn-primary w-full text-sm cursor-pointer touch-manipulation select-none active:scale-[0.97] transition-transform duration-150 [-webkit-tap-highlight-color:transparent]"
            >
              {submitting ? 'Creando cuenta…' : 'Crear cuenta y entrar'}
            </button>

            <div className="text-[11px] text-mute text-center pt-1 leading-snug">
              Al registrarte, te creamos una cuenta de vendedor bajo{' '}
              {ambassador.ownerName} y entrás directo a tu panel.
            </div>
          </form>
        </div>

        <div className="text-center mt-5 text-xs text-mute">
          ¿Ya tenés cuenta?{' '}
          <Link href="/login" className="underline">
            Iniciá sesión
          </Link>
        </div>
      </div>
    </main>
  );
}
