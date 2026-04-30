'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setSession } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@clubify.local');
  const [password, setPassword] = useState('Clubify123!');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      router.push(data.user.role === 'SUPER_ADMIN' ? '/admin' : '/app');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-bg">
      <form onSubmit={submit} className="card card-pad w-full max-w-md">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-9 h-9 rounded-lg bg-brand text-white flex items-center justify-center font-bold">
            C
          </div>
          <div className="font-bold text-lg">Clubify</div>
        </div>
        <h2 className="text-[22px] font-bold m-0">Inicia sesión</h2>
        <p className="text-sm text-mute mt-1">Accede a tu panel de control.</p>

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
          <label className="label">Contraseña</label>
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

        <div className="mt-4 text-center text-xs text-mute leading-relaxed">
          Demo: <code>admin@clubify.local</code> / <code>Clubify123!</code>
          <br />
          Tenant: <code>demo@clubify.local</code> / <code>Demo123!</code>
        </div>
      </form>
    </div>
  );
}
