'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Logo } from '@/components/Logo';

export default function ForgotPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } catch {
      // No revelamos errores: igual mostramos el mismo mensaje
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-md card card-pad">
        <Link href="/" className="flex items-center mb-5">
          <Logo size={32} />
        </Link>

        {sent ? (
          <>
            <h1 className="text-xl font-bold">Revisa tu email</h1>
            <p className="text-sm text-mute mt-2 leading-relaxed">
              Si existe una cuenta con <span className="font-medium text-ink">{email}</span>,
              te enviamos un link para restablecer tu contraseña. El link vence
              en 30 minutos.
            </p>
            <p className="text-xs text-mute mt-4">
              ¿No te llegó? Revisa la carpeta de spam o{' '}
              <button
                onClick={() => setSent(false)}
                className="text-brand hover:underline"
              >
                intenta con otro email
              </button>
              .
            </p>
            <Link
              href="/login"
              className="btn-ghost w-full justify-center mt-6"
            >
              ← Volver a ingresar
            </Link>
          </>
        ) : (
          <form onSubmit={submit}>
            <h1 className="text-xl font-bold">¿Olvidaste tu contraseña?</h1>
            <p className="text-sm text-mute mt-2">
              Te enviamos un link para crear una nueva.
            </p>
            <div className="mt-5">
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tucorreo@ejemplo.com"
                required
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={submitting || !email}
              className="btn-primary w-full justify-center mt-5"
            >
              {submitting ? 'Enviando…' : 'Enviar link de recuperación'}
            </button>
            <Link
              href="/login"
              className="block text-center text-sm text-mute hover:text-ink mt-4"
            >
              ← Volver a ingresar
            </Link>
          </form>
        )}
      </div>
    </main>
  );
}
