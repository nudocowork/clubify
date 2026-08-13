'use client';
// PDF Soft(9) A4: destino del magic-link "entrar al negocio" desde TeamClubify.
// Recibe ?t=<token corto>, lo intercambia por una sesión (POST /tenants/enter-
// exchange), la deja como sesión real (cookie) y entra a /app del negocio.
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { setSession } from '@/lib/api';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function EntrarPage() {
  return (
    <Suspense fallback={<Screen msg="Cargando…" />}>
      <EntrarInner />
    </Suspense>
  );
}

function EntrarInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = params.get('t');
    if (!t) {
      setErr('Enlace inválido.');
      return;
    }
    (async () => {
      try {
        const res = await fetch(`${API}/api/tenants/enter-exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: t }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.message || 'El enlace es inválido o venció.');
        }
        const data = await res.json(); // { accessToken, user, tenant }
        // Sesión real (cookie) para que el middleware permita /app.
        setSession(data.accessToken, data.user);
        router.replace('/app');
      } catch (e: any) {
        setErr(e?.message || 'No pudimos abrir el negocio.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (err) return <Screen msg={err} error />;
  return <Screen msg="Entrando al negocio…" />;
}

function Screen({ msg, error }: { msg: string; error?: boolean }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-bg px-6">
      <div className="card card-pad text-center max-w-sm animate-in fade-in duration-300">
        <div className="text-4xl mb-3">{error ? '⚠️' : '🔐'}</div>
        <p className={`text-sm ${error ? 'text-bad-ink' : 'text-mute'}`}>{msg}</p>
        {error && (
          <a href="/login" className="btn-primary mt-4 inline-block">
            Ir a iniciar sesión
          </a>
        )}
      </div>
    </main>
  );
}
