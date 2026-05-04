'use client';
import Link from 'next/link';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App error:', error);
  }, [error]);

  return (
    <main className="min-h-screen bg-bg flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <div className="text-6xl">⚠️</div>
        <h1 className="text-2xl font-bold mt-3">Algo salió mal</h1>
        <p className="text-mute mt-2 leading-relaxed">
          Tuvimos un problema cargando esta página. Reintenta o vuelve al
          inicio. Si pasa de nuevo, escríbenos.
        </p>
        {error.digest && (
          <div className="text-[10px] text-mute2 mt-3 font-mono">
            Ref: {error.digest}
          </div>
        )}
        <div className="flex gap-2 justify-center mt-6">
          <button onClick={reset} className="btn-primary">
            Reintentar
          </button>
          <Link href="/" className="btn-ghost">
            Inicio
          </Link>
        </div>
        <a
          href="https://wa.me/573000000000?text=Error%20en%20Clubify"
          className="block text-xs text-brand hover:underline mt-4"
        >
          Avisar por WhatsApp →
        </a>
      </div>
    </main>
  );
}
