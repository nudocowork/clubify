'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, setSession, clearSession } from '@/lib/api';
import { primaryHrefForUser } from '@/lib/modules';
import { isNativeApp, useHidesPurchases } from '@/lib/native';
import { useAuthBrand, BrandMark, BrandAuthTheme } from '@/components/AuthBrand';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';

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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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

        {/* .solo-web: dentro de la app se oculta por CSS. Google bloquea su
            OAuth en webviews embebidos, así que este botón no puede funcionar
            ahí — se quedaba en "Cargando Google…" para siempre. */}
        <div className="solo-web">
          <GoogleSignInButton onCredential={loginWithGoogle} disabled={loading} />
        </div>

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
