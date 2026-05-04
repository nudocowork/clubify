'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Logo } from '@/components/Logo';

export default function ResetPage() {
  const router = useRouter();
  const { token } = useParams<{ token: string }>();
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (pwd.length < 8) {
      setErr('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    if (pwd !== confirm) {
      setErr('Las contraseñas no coinciden');
      return;
    }
    setSubmitting(true);
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword: pwd }),
      });
      setDone(true);
      setTimeout(() => router.push('/login?reset=1'), 2500);
    } catch (e: any) {
      setErr(e.message || 'No se pudo restablecer');
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-md card card-pad">
        <Link href="/" className="flex items-center mb-5">
          <Logo size={32} />
        </Link>

        {done ? (
          <>
            <h1 className="text-xl font-bold text-ok">¡Contraseña actualizada!</h1>
            <p className="text-sm text-mute mt-2">
              Ya puedes ingresar con tu nueva contraseña. Te llevamos al login…
            </p>
          </>
        ) : (
          <form onSubmit={submit}>
            <h1 className="text-xl font-bold">Crear nueva contraseña</h1>
            <p className="text-sm text-mute mt-2">
              Elige una contraseña segura, mínimo 8 caracteres.
            </p>
            <div className="mt-5">
              <label className="label">Nueva contraseña</label>
              <input
                className="input"
                type="password"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                required
                minLength={8}
                autoFocus
                autoComplete="new-password"
              />
            </div>
            <div className="mt-3">
              <label className="label">Confirmar nueva</label>
              <input
                className="input"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            {err && (
              <div className="rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink mt-4">
                {err}
              </div>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary w-full justify-center mt-5"
            >
              {submitting ? 'Guardando…' : 'Guardar nueva contraseña'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
