'use client';
/**
 * Banner global que aparece en TODO el panel admin cuando el modo
 * mantenimiento está ACTIVO. Sirve para que el SUPER_ADMIN no se olvide
 * de desactivar después del deploy.
 *
 * Polling cada 60s para detectar cambios hechos desde otra pestaña.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';

type MaintenanceStatus = {
  enabled: boolean;
  message: string | null;
  until: string | null;
};

export function MaintenanceAdminBanner() {
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const pathname = usePathname() ?? '';

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const s = await api<MaintenanceStatus>('/admin/maintenance');
        if (!cancelled) setStatus(s);
      } catch {
        // Si el endpoint falla (no logueado, network), no mostramos
        // nada — el chequeo es best-effort.
      }
    }
    load();
    const interval = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  if (!status?.enabled) return null;
  // Si ya estamos en /admin/maintenance, no duplicamos el banner — la
  // página ya muestra el toggle prominently.
  if (pathname.startsWith('/admin/maintenance')) return null;

  return (
    <div className="bg-amber-500 text-white px-4 py-2.5 flex items-center justify-center gap-3 text-sm font-medium border-b border-amber-600">
      <span className="text-lg">🛠</span>
      <span>
        Modo mantenimiento ACTIVO — los clientes ven "Volvemos en un rato".
      </span>
      <Link
        href="/admin/maintenance"
        className="bg-white text-amber-700 px-3 py-1 rounded-full text-xs font-bold hover:bg-amber-50 transition"
      >
        Apagar →
      </Link>
    </div>
  );
}
