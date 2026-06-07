'use client';
/**
 * Dashboard admin (oficial — Premium). Promovido del set de propuestas
 * el 2026-06-07. El layout y los KPIs viven en
 * `components/admin-dashboard/PremiumDashboard.tsx` y reusan los mismos
 * endpoints de métricas globales / dashboard / tenants / trials.
 *
 * El alert de expiringSoon se mantiene como hero por sobre el dashboard
 * (es accionable y aparece arriba si hay pendientes).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { PremiumDashboard } from '@/components/admin-dashboard/PremiumDashboard';

type Metrics = { expiringSoon: number };

export default function AdminDashboard() {
  const [m, setM] = useState<Metrics | null>(null);
  useEffect(() => {
    api<Metrics>('/metrics/global').then(setM).catch(() => null);
  }, []);

  const today = new Date().toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Dashboard <span className="page-crumb">/ {today}</span>
        </h1>
      </div>

      {m && m.expiringSoon > 0 && (
        <div className="card card-pad bg-amber-50 border-amber-200 mb-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
            <Icon name="bell" size={16} />
          </div>
          <div className="flex-1 text-sm">
            <span className="font-semibold">{m.expiringSoon}</span> negocio
            {m.expiringSoon === 1 ? '' : 's'} sin confirmar pago hace más de 3 días.
          </div>
          <Link
            href="/admin/tenants"
            className="text-sm font-semibold text-amber-800 hover:underline"
          >
            Ver →
          </Link>
        </div>
      )}

      <PremiumDashboard />
    </div>
  );
}
