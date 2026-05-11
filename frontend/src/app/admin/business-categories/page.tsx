'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import {
  BUSINESS_CATEGORIES,
  type BusinessModule,
} from '@/lib/business-categories';

const MODULE_INFO: Record<BusinessModule, { emoji: string; label: string }> = {
  cards: { emoji: '💳', label: 'Tarjetas fid.' },
  customers: { emoji: '👥', label: 'Clientes' },
  scanner: { emoji: '🔍', label: 'Escáner' },
  push: { emoji: '🔔', label: 'Push wallet' },
  menu: { emoji: '📋', label: 'Menú/catálogo' },
  orders: { emoji: '🛒', label: 'Pedidos' },
  analytics: { emoji: '📊', label: 'Analítica' },
  staff: { emoji: '👤', label: 'Equipo de trabajo' },
  info_links: { emoji: '🔗', label: 'InfoLinks' },
  services: { emoji: '🛠', label: 'Servicios' },
};

type CategoryCounts = Record<string, number>;

export default function BusinessCategoriesPage() {
  const [counts, setCounts] = useState<CategoryCounts>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<any[]>('/tenants')
      .then((tenants) => {
        const c: CategoryCounts = {};
        for (const t of tenants) {
          const slug = t.businessCategorySlug ?? '_unset';
          c[slug] = (c[slug] ?? 0) + 1;
        }
        setCounts(c);
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Categorías de negocio{' '}
          <span className="page-crumb">/ {BUSINESS_CATEGORIES.length} disponibles</span>
        </h1>
      </div>

      <div className="card card-pad mb-5">
        <h3 className="text-base font-semibold m-0 flex items-center gap-2">
          🎯 Personalización del panel por rubro
        </h3>
        <p className="text-sm text-mute mt-2 leading-relaxed">
          Cada cliente elige su categoría al pagar el plan. El sidebar y los
          módulos del panel se ajustan automáticamente al rubro: un{' '}
          <b>autolavado</b> ve "Servicios" en vez de "Menú" y no tiene
          "Pedidos"; una <b>cafetería</b> sí ve menú y pedidos. La lista de
          módulos por categoría está hardcoded en{' '}
          <code className="text-xs bg-bg2 px-1.5 py-0.5 rounded">
            frontend/src/lib/business-categories.ts
          </code>{' '}
          y la copia idéntica en backend. Para agregar/editar categorías,
          modificá ambos archivos y redeployá.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {BUSINESS_CATEGORIES.map((c) => (
          <div key={c.slug} className="card card-pad flex flex-col">
            <div className="flex items-start gap-3">
              <div className="text-3xl flex-none">{c.emoji}</div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold leading-tight">{c.name}</div>
                <div className="text-[10px] uppercase tracking-wider text-mute font-mono mt-0.5">
                  {c.slug}
                </div>
              </div>
              {counts[c.slug] > 0 && (
                <span
                  className="badge badge-info text-[10px]"
                  title={`${counts[c.slug]} negocios en esta categoría`}
                >
                  {counts[c.slug]}
                </span>
              )}
            </div>
            <p className="text-xs text-mute mt-2 leading-relaxed">
              {c.description}
            </p>
            <div className="mt-3 pt-3 border-t border-line2">
              <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1.5">
                Módulos habilitados
              </div>
              <div className="flex flex-wrap gap-1">
                {c.modules.map((m) => (
                  <span
                    key={m}
                    className="text-[10px] bg-bg2 text-ink px-1.5 py-0.5 rounded font-medium"
                    title={MODULE_INFO[m].label}
                  >
                    {MODULE_INFO[m].emoji} {MODULE_INFO[m].label}
                  </span>
                ))}
              </div>
              <div className="text-[10px] text-mute mt-2">
                Item del catálogo en el sidebar:{' '}
                <b className="text-ink">
                  {c.catalogLabel === 'services'
                    ? 'Servicios'
                    : c.catalogLabel === 'catalog'
                    ? 'Catálogo'
                    : 'Menú'}
                </b>
              </div>
            </div>
          </div>
        ))}
      </div>

      {!loading && counts['_unset'] > 0 && (
        <div className="mt-5 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          ⚠ Hay <b>{counts['_unset']}</b> negocios sin categoría asignada.
          Caen al default <code>restaurant</code> en runtime.{' '}
          <Link href="/admin/tenants" className="underline">
            Revisar tenants →
          </Link>
        </div>
      )}
    </div>
  );
}
