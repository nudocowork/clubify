'use client';
import { useEffect, useState } from 'react';
import { setSession } from '@/lib/api';

/**
 * Auto-login dev. SOLO funciona en localhost — en producción muestra error.
 * Pensado para review rápido sin tipear credenciales del seed.
 *
 * Default: demo tenant owner (Café del Día). Cambia ?as=admin para super
 * admin, ?as=staff (no implementado todavía).
 */
const ACCOUNTS = {
  owner: { email: 'demo@clubify.local', password: 'Demo123!', redirect: '/app/admin/reminders' },
  admin: { email: 'admin@clubify.local', password: 'Clubify123!', redirect: '/admin' },
} as const;

export default function DevLoginPage() {
  const [status, setStatus] = useState<string>('Cargando…');

  useEffect(() => {
    const isLocal =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1');
    if (!isLocal) {
      setStatus('❌ /dev-login solo disponible en localhost');
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const as = (params.get('as') ?? 'owner') as keyof typeof ACCOUNTS;
    const acc = ACCOUNTS[as] ?? ACCOUNTS.owner;
    const target = params.get('to') ?? acc.redirect;

    const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';
    setStatus(`Logeando como ${acc.email}…`);

    fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: acc.email, password: acc.password }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.accessToken) {
          throw new Error(d.message || `HTTP ${r.status}`);
        }
        setSession(d.accessToken, d.user, { refreshToken: d.refreshToken });
        setStatus(`✓ Sesión iniciada — redirigiendo a ${target}`);
        window.location.href = target;
      })
      .catch((e) => {
        setStatus(
          `❌ ${e.message}\n\n` +
            `Posibles causas:\n` +
            `1. Backend no está corriendo en ${API}\n` +
            `2. El seed no se aplicó — corré:\n   cd backend && npm run seed\n` +
            `3. Credenciales cambiaron (acá usamos ${acc.email})`,
        );
      });
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-6">
      <div className="card card-pad max-w-md w-full">
        <h1 className="text-xl font-bold mb-2">🔓 Auto-login dev</h1>
        <pre className="text-sm text-mute whitespace-pre-wrap font-sans">{status}</pre>
        <hr className="my-4 border-line" />
        <div className="text-xs text-mute space-y-1.5">
          <p>Cuentas disponibles (local seed):</p>
          <ul className="list-disc ml-5">
            <li>
              <code>?as=owner</code> → Café del Día (TENANT_OWNER)
              <span className="text-ink/70"> · default</span>
            </li>
            <li>
              <code>?as=admin</code> → Super admin
            </li>
          </ul>
          <p className="pt-2">
            <code>?to=/ruta</code> redirige a otra URL después del login.
          </p>
          <p className="pt-2 text-amber-600">
            Esta página NO funciona en producción.
          </p>
        </div>
      </div>
    </div>
  );
}
