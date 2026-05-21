'use client';
/**
 * Página pública de mantenimiento. El middleware Next.js rewritea acá
 * cualquier request mientras el flag está activo (excepto admin panel,
 * SUPER_ADMIN cookie y rutas del sistema).
 *
 * Auto-refresca cada 30s — cuando el SUPER_ADMIN apaga el flag, el
 * cliente ve la página normal de nuevo sin tener que recargar manual.
 */
import { useEffect, useState } from 'react';

type Status = {
  enabled: boolean;
  message: string | null;
  until: string | null;
};

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

function fmtCountdown(untilIso: string | null): string | null {
  if (!untilIso) return null;
  const target = new Date(untilIso).getTime();
  if (!Number.isFinite(target)) return null;
  const diff = target - Date.now();
  if (diff <= 0) return 'pronto';
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'menos de 1 minuto';
  if (mins < 60) return `${mins} ${mins === 1 ? 'minuto' : 'minutos'}`;
  const hours = Math.floor(mins / 60);
  const remM = mins % 60;
  if (hours < 24)
    return `${hours} h${remM > 0 ? ` ${remM} min` : ''}`;
  const days = Math.floor(hours / 24);
  return `${days} día${days === 1 ? '' : 's'}`;
}

export default function MaintenancePage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [tick, setTick] = useState(0); // re-render para countdown

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch(`${API}/api/public/maintenance/status`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const s: Status = await res.json();
        if (cancelled) return;
        setStatus(s);
        // Si ya está apagado, recargamos para volver al sitio normal.
        if (!s.enabled) {
          window.location.href = '/';
        }
      } catch {
        // Ignorar — seguimos mostrando la página estática.
      }
    }
    check();
    const interval = window.setInterval(check, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    // Tick cada 30s para refrescar el countdown — separado del fetch.
    const t = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const countdown = status?.until ? fmtCountdown(status.until) : null;
  const message =
    status?.message ||
    'Estamos actualizando el sistema para mejorar tu experiencia. Volvemos en unos minutos.';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-emerald-50 px-4">
      <div className="max-w-md text-center">
        <div className="text-7xl mb-6 animate-pulse">🛠️</div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
          Volvemos en un rato
        </h1>
        <p className="mt-4 text-base md:text-lg text-slate-600 leading-relaxed whitespace-pre-line">
          {message}
        </p>
        {countdown && (
          <div className="mt-6 inline-flex items-center gap-2 bg-white rounded-full px-4 py-2 shadow-sm border border-slate-200">
            <span className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
              Tiempo estimado
            </span>
            <span className="text-sm font-bold text-emerald-700">
              {countdown}
            </span>
          </div>
        )}
        <div className="mt-10 text-xs text-slate-400">
          Esta página se actualiza sola — no hace falta recargar.
        </div>
        <div className="mt-6">
          <a
            href="https://wa.me/?text=Hola%2C%20necesito%20soporte"
            className="text-sm text-emerald-700 hover:underline"
          >
            ¿Algo urgente? Escribinos por WhatsApp →
          </a>
        </div>
      </div>
    </div>
  );
}
