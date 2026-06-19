'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuthBrand, BrandMark, BrandAuthTheme } from '@/components/AuthBrand';
import { PhoneInput } from '@/components/PhoneInput';

type Mode = 'email' | 'sms';
type SmsStep = 'request' | 'verify';

export default function ForgotPage() {
  const router = useRouter();
  const { brand } = useAuthBrand();
  const [mode, setMode] = useState<Mode>('email');

  // Email flow
  const [email, setEmail] = useState('');
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  // SMS flow
  const [smsStep, setSmsStep] = useState<SmsStep>('request');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [smsSubmitting, setSmsSubmitting] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);
  const [smsDone, setSmsDone] = useState(false);

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setEmailSubmitting(true);
    try {
      await api('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setEmailSent(true);
    } catch {
      setEmailSent(true);
    } finally {
      setEmailSubmitting(false);
    }
  }

  async function submitSmsRequest(e: React.FormEvent) {
    e.preventDefault();
    setSmsError(null);
    setSmsSubmitting(true);
    try {
      await api('/auth/forgot-password-sms', {
        method: 'POST',
        body: JSON.stringify({ phone }),
      });
      setSmsStep('verify');
    } catch (err: any) {
      setSmsError(err?.message || 'No se pudo enviar el código');
    } finally {
      setSmsSubmitting(false);
    }
  }

  async function submitSmsVerify(e: React.FormEvent) {
    e.preventDefault();
    setSmsError(null);
    if (newPassword !== confirm) {
      setSmsError('Las contraseñas no coinciden');
      return;
    }
    setSmsSubmitting(true);
    try {
      await api('/auth/reset-password-sms', {
        method: 'POST',
        body: JSON.stringify({ phone, code: code.trim(), newPassword }),
      });
      setSmsDone(true);
      setTimeout(() => router.push('/login'), 1500);
    } catch (err: any) {
      setSmsError(err?.message || 'Código inválido o vencido');
    } finally {
      setSmsSubmitting(false);
    }
  }

  return (
    <main className={`min-h-screen bg-bg flex items-center justify-center px-4 ${brand ? 'brand-auth' : ''}`}>
      <BrandAuthTheme brand={brand} />
      <div className="w-full max-w-md card card-pad">
        <Link href="/" className="flex items-center mb-5">
          <BrandMark brand={brand} size={32} />
        </Link>

        {/* Toggle Email / SMS — solo visible si no estamos en estado final */}
        {!emailSent && !smsDone && (
          <div className="flex gap-1 p-1 bg-bg2 rounded-lg mb-5">
            <button
              onClick={() => setMode('email')}
              className={`flex-1 text-sm font-semibold py-2 rounded-md transition ${
                mode === 'email' ? 'bg-white shadow-sm text-ink' : 'text-mute'
              }`}
            >
              ✉ Email
            </button>
            <button
              onClick={() => setMode('sms')}
              className={`flex-1 text-sm font-semibold py-2 rounded-md transition ${
                mode === 'sms' ? 'bg-white shadow-sm text-ink' : 'text-mute'
              }`}
            >
              💬 SMS
            </button>
          </div>
        )}

        {/* EMAIL FLOW */}
        {mode === 'email' &&
          (emailSent ? (
            <>
              <h1 className="text-xl font-bold">Revisa tu email</h1>
              <p className="text-sm text-mute mt-2 leading-relaxed">
                Si existe una cuenta con{' '}
                <span className="font-medium text-ink">{email}</span>, te enviamos
                un link para restablecer tu contraseña. El link vence en 30 minutos.
              </p>
              <p className="text-xs text-mute mt-4">
                ¿No te llegó? Revisa la carpeta de spam o{' '}
                <button
                  onClick={() => setEmailSent(false)}
                  className="text-brand hover:underline"
                >
                  intenta con otro email
                </button>
                .
              </p>
              <Link href="/login" className="btn-ghost w-full justify-center mt-6">
                ← Volver a ingresar
              </Link>
            </>
          ) : (
            <form onSubmit={submitEmail}>
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
                disabled={emailSubmitting || !email}
                className="btn-primary w-full justify-center mt-5"
              >
                {emailSubmitting ? 'Enviando…' : 'Enviar link de recuperación'}
              </button>
              <Link
                href="/login"
                className="block text-center text-sm text-mute hover:text-ink mt-4"
              >
                ← Volver a ingresar
              </Link>
            </form>
          ))}

        {/* SMS FLOW */}
        {mode === 'sms' &&
          (smsDone ? (
            <>
              <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-ok-soft text-ok-ink mx-auto text-2xl">
                ✓
              </div>
              <h1 className="text-xl font-bold text-center mt-3">
                Contraseña actualizada
              </h1>
              <p className="text-sm text-mute mt-2 text-center">
                Te redirigimos al login…
              </p>
            </>
          ) : smsStep === 'request' ? (
            <form onSubmit={submitSmsRequest}>
              <h1 className="text-xl font-bold">Restablecer por SMS</h1>
              <p className="text-sm text-mute mt-2">
                Te enviamos un código de 6 dígitos al teléfono asociado a tu
                cuenta. Vence en 10 minutos.
              </p>
              <div className="mt-5">
                <label className="label">Teléfono</label>
                <PhoneInput
                  value={phone}
                  onChange={(v) => setPhone(v)}
                  placeholder="3001234567"
                />
              </div>
              {smsError && (
                <div className="mt-3 text-sm text-bad-ink bg-bad-soft rounded-lg px-3 py-2">
                  {smsError}
                </div>
              )}
              <button
                type="submit"
                disabled={smsSubmitting || !phone}
                className="btn-primary w-full justify-center mt-5"
              >
                {smsSubmitting ? 'Enviando…' : 'Enviar código'}
              </button>
              <Link
                href="/login"
                className="block text-center text-sm text-mute hover:text-ink mt-4"
              >
                ← Volver a ingresar
              </Link>
            </form>
          ) : (
            <form onSubmit={submitSmsVerify}>
              <h1 className="text-xl font-bold">Código enviado</h1>
              <p className="text-sm text-mute mt-2">
                Ingresa el código que recibiste al{' '}
                <span className="font-medium text-ink">{phone}</span> y elige tu
                nueva contraseña.
              </p>
              <div className="mt-5 space-y-3">
                <div>
                  <label className="label">Código de 6 dígitos</label>
                  <input
                    className="input font-mono text-center text-lg tracking-[0.5em]"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label className="label">Nueva contraseña</label>
                  <input
                    className="input"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    minLength={8}
                    placeholder="Mínimo 8 caracteres"
                    required
                  />
                </div>
                <div>
                  <label className="label">Confirmar contraseña</label>
                  <input
                    className="input"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    minLength={8}
                    required
                  />
                </div>
              </div>
              {smsError && (
                <div className="mt-3 text-sm text-bad-ink bg-bad-soft rounded-lg px-3 py-2">
                  {smsError}
                </div>
              )}
              <button
                type="submit"
                disabled={smsSubmitting || code.length < 6 || newPassword.length < 8}
                className="btn-primary w-full justify-center mt-5"
              >
                {smsSubmitting ? 'Cambiando…' : 'Cambiar contraseña'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSmsStep('request');
                  setCode('');
                  setNewPassword('');
                  setConfirm('');
                  setSmsError(null);
                }}
                className="block text-center text-sm text-mute hover:text-ink mt-4 w-full"
              >
                ← Usar otro teléfono
              </button>
            </form>
          ))}
      </div>
    </main>
  );
}
