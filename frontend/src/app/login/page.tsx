'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, setSession, clearSession } from '@/lib/api';
import { primaryHrefForUser } from '@/lib/modules';
import { isNativeApp, useHidesPurchases } from '@/lib/native';
import { useAuthBrand, BrandMark, BrandAuthTheme } from '@/components/AuthBrand';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';
import { hayGoogleNativo, loginGoogleNativo } from '@/lib/google-nativo';

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-8 text-mute">Cargando…</div>}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { brand } = useAuthBrand();
  const sinCompras = useHidesPurchases();
  // El botón web de Google no funciona dentro de la app: Google bloquea su
  // OAuth en webviews embebidos y se queda cargando para siempre. Se resuelve
  // tras montar porque depende del puente nativo.
  const [googleNativo, setGoogleNativo] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setGoogleNativo(hayGoogleNativo());
  }, []);

  const justReset = params.get('reset') === '1';
  const justCanceled = params.get('canceled') === '1';
  const sessionExpired = params.get('expired') === '1';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const data = await api<{ accessToken: string; refreshToken?: string; user: any }>(
        '/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        },
      );
      // Limpiamos cualquier sesión/impersonación previa ANTES de escribir la
      // nueva. Sin esto, un `clubify_admin_backup` viejo dejaba el banner de
      // impersonación colgado y, si la sesión activa era un tenant, el guard
      // de AppShell te tiraba a /app (una subcuenta) tras loguear.
      clearSession();
      setSession(data.accessToken, data.user, { refreshToken: data.refreshToken });
      // A dónde entra según el rol: el mapa vive en lib/modules.ts (lo comparte
      // el lanzador /hub). En la app instalada la entrada es SIEMPRE el
      // lanzador, que a su vez entra directo si la cuenta tiene un solo
      // módulo; en el navegador se mantiene el destino directo de siempre.
      router.push(isNativeApp() ? '/hub' : primaryHrefForUser(data.user));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loginWithGoogle(idToken: string) {
    setErr(null);
    setLoading(true);
    try {
      const data = await api<{ accessToken: string; refreshToken?: string; user: any }>(
        '/auth/google',
        { method: 'POST', body: JSON.stringify({ idToken }) },
      );
      // Limpiamos cualquier sesión/impersonación previa ANTES de escribir la
      // nueva. Sin esto, un `clubify_admin_backup` viejo dejaba el banner de
      // impersonación colgado y, si la sesión activa era un tenant, el guard
      // de AppShell te tiraba a /app (una subcuenta) tras loguear.
      clearSession();
      setSession(data.accessToken, data.user, { refreshToken: data.refreshToken });
      // A dónde entra según el rol: el mapa vive en lib/modules.ts (lo comparte
      // el lanzador /hub). En la app instalada la entrada es SIEMPRE el
      // lanzador, que a su vez entra directo si la cuenta tiene un solo
      // módulo; en el navegador se mantiene el destino directo de siempre.
      router.push(isNativeApp() ? '/hub' : primaryHrefForUser(data.user));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`min-h-screen flex items-center justify-center px-6 bg-bg ${brand ? 'brand-auth' : ''}`}>
      <BrandAuthTheme brand={brand} />
      <form onSubmit={submit} className="card card-pad w-full max-w-md">
        <div className="flex justify-center mb-4">
          <BrandMark brand={brand} size={brand ? 56 : 36} />
        </div>
        <h2 className="text-[22px] font-bold m-0 text-center">Inicia sesión</h2>
        <p className="text-sm text-mute mt-1 text-center">
          Accede a tu panel de control.
        </p>

        {justReset && (
          <div className="mt-4 rounded-lg bg-ok-soft px-3 py-2.5 text-sm text-ok">
            ✓ Tu contraseña fue restablecida. Inicia sesión con la nueva.
          </div>
        )}
        {justCanceled && (
          <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-sm text-amber-900">
            Tu cuenta fue cancelada. Puedes reactivarla iniciando sesión —
            tendrás 3 días bonus para retomar.
          </div>
        )}
        {sessionExpired && (
          <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-sm text-amber-900">
            Tu sesión expiró. Inicia sesión nuevamente.
          </div>
        )}

        <div className="mt-6">
          <label className="label">Email</label>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="mt-3">
          <div className="flex justify-between items-baseline">
            <label className="label">Contraseña</label>
            <Link href="/forgot" className="text-xs text-brand hover:underline">
              ¿Olvidaste tu contraseña?
            </Link>
          </div>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {err && (
          <div className="mt-4 rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink">
            {err}
          </div>
        )}

        <button
          className="btn-primary mt-4 w-full justify-center"
          disabled={loading}
        >
          {loading ? 'Entrando…' : 'Entrar'}
        </button>

        {googleNativo ? (
          <button
            type="button"
            disabled={loading}
            onClick={async () => {
              setErr(null);
              setLoading(true);
              try {
                await loginWithGoogle(await loginGoogleNativo());
              } catch (e: any) {
                setErr(e?.message ?? 'No se pudo iniciar sesión con Google.');
                setLoading(false);
              }
            }}
            className="w-full mt-3 flex items-center justify-center gap-2.5 border border-line rounded-pill py-3 text-sm font-medium text-ink bg-white hover:bg-bg2 transition disabled:opacity-50"
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
              <path fill="#4285F4" d="M45 24c0-1.6-.1-2.7-.4-3.9H24v7.5h12c-.2 1.9-1.5 4.7-4.4 6.6l6.7 5.2C42.2 35.9 45 30.5 45 24z" />
              <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.4c-1.9 1.3-4.4 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-7.1 5.5C8 41.1 15.4 46 24 46z" />
              <path fill="#FBBC05" d="M11.5 28.4c-.5-1.4-.7-2.9-.7-4.4s.3-3 .7-4.4l-7.1-5.5C2.9 17 2 20.4 2 24s.9 7 2.4 9.9l7.1-5.5z" />
              <path fill="#EA4335" d="M24 10.6c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 4.4 29.9 2 24 2 15.4 2 8 6.9 4.4 14.1l7.1 5.5c1.8-5.3 6.7-9 12.5-9z" />
            </svg>
            Continuar con Google
          </button>
        ) : (
          <GoogleSignInButton onCredential={loginWithGoogle} disabled={loading} />
        )}

        {/* "Adquiérelo aquí" lleva a /signup, que es el checkout de los planes.
            En iOS eso es una compra externa a dos toques del login: motivo de
            rechazo por la guideline 3.1.1. La app es para cuentas existentes. */}
        {!sinCompras && (
          <div className="mt-4 text-center text-xs text-mute">
            ¿No tienes cuenta?{' '}
            <Link href="/signup" className="text-brand hover:underline font-medium">
              Adquiérelo aquí
            </Link>
          </div>
        )}
      </form>
    </div>
  );
}
