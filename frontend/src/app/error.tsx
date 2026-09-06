'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { isChunkError, reloadForNewVersion } from '@/components/ChunkReloadGuard';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App error:', error);
    // Pestaña vieja + despliegue nuevo = el trozo de JS de la ruta ya no existe
    // con ese nombre y la navegación revienta aquí. `reset()` NO lo arregla:
    // vuelve a montar la misma ruta y a pedir el mismo fichero que ya no está,
    // así que el usuario se queda dando a «Reintentar» contra una pared. Lo
    // único que cura es recargar. `global-error.tsx` ya lo hacía; este
    // boundary, que es el que de verdad atrapa los fallos de navegación, no.
    //
    // Pasó de verdad: 06-09, La Gloriosa, al abrir un pedido desde el tablero
    // con la pestaña abierta desde antes del despliegue de la víspera.
    if (isChunkError(error?.message)) reloadForNewVersion();
  }, [error]);

  return (
    <main className="min-h-screen bg-bg flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <div className="text-6xl">⚠️</div>
        <h1 className="text-2xl font-bold mt-3">Algo salió mal</h1>
        <p className="text-mute mt-2 leading-relaxed">
          Tuvimos un problema cargando esta página. Si vuelve a pasar, recarga
          con Ctrl+R (o Cmd+R): suele ser una versión vieja abierta en la
          pestaña.
        </p>
        {error.digest && (
          <div className="text-[10px] text-mute2 mt-3 font-mono">
            Ref: {error.digest}
          </div>
        )}
        <div className="flex gap-2 justify-center mt-6">
          <button onClick={() => window.location.reload()} className="btn-primary">
            Recargar
          </button>
          <button onClick={reset} className="btn-ghost">
            Reintentar
          </button>
          <Link href="/" className="btn-ghost">
            Inicio
          </Link>
        </div>
      </div>
    </main>
  );
}
