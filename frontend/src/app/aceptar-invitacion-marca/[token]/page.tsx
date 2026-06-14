'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Lookup = {
  email: string;
  fullName: string;
  expiresAt: string;
  whiteLabel: { name: string; primaryColor: string };
};

export default function AcceptWhiteLabelInvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params.token;

  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'done' | 'saving'>('loading');
  const [info, setInfo] = useState<Lookup | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`${API}/api/superadmin-public/white-label-admin-invites/${token}`);
        if (!res.ok) {
          const txt = await res.text();
          try {
            const j = JSON.parse(txt);
            throw new Error(j.message ?? txt);
          } catch {
            throw new Error(txt || 'Invitación inválida');
          }
        }
        setInfo(await res.json());
        setState('ready');
      } catch (e: any) {
        setErrorMsg(e?.message ?? 'Invitación inválida');
        setState('invalid');
      }
    })();
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      alert('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    if (password !== confirm) {
      alert('Las contraseñas no coinciden');
      return;
    }
    setState('saving');
    try {
      const res = await fetch(`${API}/api/superadmin-public/white-label-admin-invites/${token}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const txt = await res.text();
        try {
          const j = JSON.parse(txt);
          throw new Error(j.message ?? txt);
        } catch {
          throw new Error(txt || 'No se pudo aceptar la invitación');
        }
      }
      setState('done');
      setTimeout(() => router.push('/login'), 1500);
    } catch (e: any) {
      alert('Error: ' + (e?.message ?? e));
      setState('ready');
    }
  }

  const brandColor = info?.whiteLabel?.primaryColor ?? '#16a34a';

  return (
    <div
      className="min-h-screen flex items-center justify-center p-5"
      style={{
        background: info
          ? `radial-gradient(circle at 20% 10%, ${brandColor}33 0%, #11442a 60%, #061b10 100%)`
          : 'radial-gradient(circle at 20% 10%, #1a5c38 0%, #11442a 40%, #0a2c1a 80%, #061b10 100%)',
        fontFamily: 'Figtree, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div
        className="w-full max-w-md rounded-[18px] overflow-hidden"
        style={{ background: 'white', boxShadow: '0 30px 60px rgba(0,0,0,.4)' }}
      >
        <div
          className="px-7 py-6 text-white"
          style={{ background: `linear-gradient(135deg, ${brandColor}, ${brandColor}cc)` }}
        >
          <div className="text-[11px] font-bold uppercase opacity-90" style={{ letterSpacing: 1.2 }}>
            {info?.whiteLabel?.name ?? 'Cuenta de administrador'}
          </div>
          <h1 className="m-0 mt-1.5" style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.4 }}>
            Aceptar invitación
          </h1>
        </div>

        <div className="px-7 py-6">
          {state === 'loading' && (
            <div className="text-sm" style={{ color: '#6b7785' }}>
              Verificando invitación…
            </div>
          )}

          {state === 'invalid' && (
            <div>
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl mb-3 mx-auto"
                style={{ background: '#fee2e2', color: '#b91c1c' }}
              >
                ✕
              </div>
              <h2 className="m-0 text-center" style={{ fontSize: 17, fontWeight: 800, color: '#16241c' }}>
                Invitación no válida
              </h2>
              <p className="text-sm mt-2 text-center" style={{ color: '#6b7785' }}>
                {errorMsg || 'El enlace que abriste no es válido, ya fue usado o expiró.'}
              </p>
            </div>
          )}

          {state === 'done' && (
            <div>
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl mb-3 mx-auto"
                style={{ background: '#dcfce7', color: '#15803d' }}
              >
                ✓
              </div>
              <h2 className="m-0 text-center" style={{ fontSize: 17, fontWeight: 800, color: '#16241c' }}>
                Cuenta activada
              </h2>
              <p className="text-sm mt-2 text-center" style={{ color: '#6b7785' }}>
                Te estamos redirigiendo al login…
              </p>
            </div>
          )}

          {(state === 'ready' || state === 'saving') && info && (
            <form onSubmit={submit}>
              <p className="text-sm mb-4" style={{ color: '#16241c' }}>
                Hola <strong>{info.fullName}</strong>, definí tu contraseña para activar tu cuenta de
                administrador de <strong>{info.whiteLabel.name}</strong> ({info.email}).
              </p>

              <label className="block mb-3">
                <div
                  className="text-[11px] font-bold uppercase mb-1.5"
                  style={{ letterSpacing: 0.6, color: '#6b7785' }}
                >
                  Contraseña
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  required
                  minLength={8}
                  className="w-full"
                  style={{ padding: '10px 12px', borderRadius: 9, border: '1px solid #d7dbe0', fontSize: 14, outline: 'none' }}
                />
              </label>

              <label className="block mb-5">
                <div
                  className="text-[11px] font-bold uppercase mb-1.5"
                  style={{ letterSpacing: 0.6, color: '#6b7785' }}
                >
                  Confirmar contraseña
                </div>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repetí tu contraseña"
                  required
                  minLength={8}
                  className="w-full"
                  style={{ padding: '10px 12px', borderRadius: 9, border: '1px solid #d7dbe0', fontSize: 14, outline: 'none' }}
                />
              </label>

              <button
                type="submit"
                disabled={state === 'saving' || password.length < 8 || password !== confirm}
                className="w-full text-sm font-bold transition"
                style={{
                  padding: '12px 16px',
                  borderRadius: 10,
                  background: state === 'saving' || password.length < 8 || password !== confirm ? '#cbd5d2' : brandColor,
                  color: 'white',
                  border: 'none',
                  cursor: state === 'saving' ? 'wait' : 'pointer',
                }}
              >
                {state === 'saving' ? 'Activando…' : 'Activar mi cuenta'}
              </button>

              <p className="text-[11px] mt-3 text-center" style={{ color: '#9aa4af' }}>
                Esta invitación vence el{' '}
                {new Date(info.expiresAt).toLocaleDateString('es-MX', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
                .
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
