'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Botón "Continuar con Google" usando Google Identity Services (GIS).
 * Si NEXT_PUBLIC_GOOGLE_CLIENT_ID no está configurado, el componente
 * renderiza null silenciosamente (el login con email/password sigue
 * funcionando).
 *
 * Props:
 * - onCredential: callback con el ID token cuando el user completa el login.
 * - disabled: bloquea el render mientras hay otro request en progreso.
 */
export function GoogleSignInButton({
  onCredential,
  disabled,
}: {
  onCredential: (idToken: string) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  // Carga el script GIS una sola vez.
  useEffect(() => {
    if (!clientId) return;
    if (typeof window === 'undefined') return;
    const w = window as any;
    if (w.google?.accounts?.id) {
      setReady(true);
      return;
    }
    const existing = document.getElementById('google-gis-script');
    if (existing) {
      existing.addEventListener('load', () => setReady(true));
      return;
    }
    const script = document.createElement('script');
    script.id = 'google-gis-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => setReady(true);
    document.body.appendChild(script);
  }, [clientId]);

  // Inicializa + renderiza el botón cuando GIS está listo.
  useEffect(() => {
    if (!ready || !clientId || !ref.current) return;
    const w = window as any;
    try {
      w.google.accounts.id.initialize({
        client_id: clientId,
        callback: (resp: { credential: string }) => {
          if (resp?.credential) onCredential(resp.credential);
        },
      });
      ref.current.innerHTML = '';
      w.google.accounts.id.renderButton(ref.current, {
        theme: 'outline',
        size: 'large',
        type: 'standard',
        shape: 'pill',
        text: 'continue_with',
        logo_alignment: 'left',
        width: 320,
      });
    } catch (e) {
      // no-op: si el SDK no carga, el botón email/password sigue
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, clientId]);

  if (!clientId) return null;

  return (
    <div className="flex flex-col items-center mt-4">
      <div className="flex items-center w-full mb-3">
        <div className="flex-1 h-px bg-line" />
        <span className="px-3 text-[11px] uppercase tracking-wider text-mute font-semibold">
          o
        </span>
        <div className="flex-1 h-px bg-line" />
      </div>
      <div
        ref={ref}
        className={`flex justify-center min-h-[40px] ${
          disabled ? 'pointer-events-none opacity-50' : ''
        }`}
      />
      {!ready && (
        <div className="text-[11px] text-mute mt-1">Cargando Google…</div>
      )}
    </div>
  );
}
