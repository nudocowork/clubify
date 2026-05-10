'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, setSession } from '@/lib/api';
import { Logo } from '@/components/Logo';
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
      const data = await api<{ accessToken: string; user: any }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setSession(data.accessToken, data.user);
      router.push(
        data.user.role === 'SUPER_ADMIN'
          ? '/admin'
          : data.user.role === 'AFFILIATE_INFLUENCER' ||
            data.user.role === 'AFFILIATE_AMBASSADOR'
          ? '/affiliate'
          : '/app',
      );
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
      const data = await api<{ accessToken: string; user: any }>(
        '/auth/google',
        { method: 'POST', body: JSON.stringify({ idToken }) },
      );
      setSession(data.accessToken, data.user);
      router.push(
        data.user.role === 'SUPER_ADMIN'
          ? '/admin'
          : data.user.role === 'AFFILIATE_INFLUENCER' ||
            data.user.role === 'AFFILIATE_AMBASSADOR'
          ? '/affiliate'
          : '/app',
      );
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-bg">
      <form onSubmit={submit} className="card card-pad w-full max-w-md">
        <div className="flex items-center mb-3">
          <Logo size={32} />
        </div>
        <h2 className="text-[22px] font-bold m-0">Inicia sesión</h2>
        <p className="text-sm text-mute mt-1">Accede a tu panel de control.</p>

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

        <GoogleSignInButton onCredential={loginWithGoogle} disabled={loading} />

        <div className="mt-4 text-center text-xs text-mute">
          ¿No tienes cuenta?{' '}
          <Link href="/signup" className="text-brand hover:underline font-medium">
            Crea una gratis
          </Link>
        </div>
      </form>
    </div>
  );
}
