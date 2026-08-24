'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { resolveMainSectionLabel } from '@/lib/business-categories';

const QrPosterEditor = dynamic(
  () => import('@/components/marketing/QrPosterEditor'),
  { ssr: false, loading: () => <div className="text-mute py-8 text-center">Cargando editor…</div> },
);

type MenuResumen = {
  id: string | null;
  name: string;
  locationId: string | null;
  locationName: string | null;
  esPrincipal: boolean;
};

export default function QrMenuPage() {
  const [tenant, setTenant] = useState<any>(null);
  // Mesa = QR pegado en la mesa (informativo).
  // Delivery = QR para compartir, con carrito + WhatsApp.
  const [target, setTarget] = useState<'mesa' | 'delivery'>('mesa');
  // Carta a la que apunta el cartel. null = menu principal.
  //
  // Un negocio con varias sedes imprime un cartel POR SEDE: cada uno abre la
  // carta de esa sede. Sin esto solo se podia imprimir el del principal, y las
  // demas sedes se quedaban sin QR aunque tuvieran su propia carta.
  const [carta, setCarta] = useState<string | null>(null);
  const [menus, setMenus] = useState<MenuResumen[]>([]);

  useEffect(() => {
    api<any>('/tenants/me').then(setTenant).catch(() => null);
    api<{ habilitado: boolean; menus: MenuResumen[] }>('/catalog/menus')
      // Solo se ofrecen las cartas cuando la funcion esta habilitada; si no,
      // el negocio tiene una sola y no debe ver un selector con una opcion.
      .then((r) => setMenus(r?.habilitado ? (r.menus ?? []) : []))
      .catch(() => setMenus([]));
  }, []);

  if (!tenant) return <div className="text-mute">Cargando…</div>;

  const slug = tenant.slug ?? 'demo';
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://soyclubify.com';
  const cartaElegida = menus.find((m) => m.id === carta) ?? null;
  // El menu principal va SIN parametro: los carteles ya impresos siguen
  // funcionando exactamente igual.
  const sedeQ =
    cartaElegida && cartaElegida.id
      ? `?sede=${encodeURIComponent(cartaElegida.locationId ?? cartaElegida.id)}`
      : '';
  const qrUrl =
    target === 'delivery'
      ? `${origin}/d/${slug}${sedeQ}`
      : `${origin}/m/${slug}${sedeQ}`;
  const mainLabel = resolveMainSectionLabel(
    tenant.mainSectionLabelOverride,
    tenant.businessCategorySlug,
  );

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          <Link href="/app/marketing" className="text-mute hover:text-ink">
            Marketing
          </Link>{' '}
          <span className="page-crumb">/ QR {mainLabel}</span>
        </h1>
      </div>

      <p className="text-sm text-mute max-w-2xl mb-3 leading-relaxed">
        Diseñá tu cartel QR para imprimir. Elegí qué versión apunta:
      </p>

      <div className="inline-flex bg-bg2 rounded-pill p-1 mb-5 text-sm font-semibold">
        <button
          type="button"
          onClick={() => setTarget('mesa')}
          className={`px-4 py-1.5 rounded-pill transition ${
            target === 'mesa' ? 'bg-white shadow-sm' : 'text-mute hover:text-ink'
          }`}
        >
          🍽 Mesa <span className="text-[10px] text-mute">/m/</span>
        </button>
        <button
          type="button"
          onClick={() => setTarget('delivery')}
          className={`px-4 py-1.5 rounded-pill transition ${
            target === 'delivery' ? 'bg-white shadow-sm' : 'text-mute hover:text-ink'
          }`}
        >
          🛵 Delivery <span className="text-[10px] text-mute">/d/</span>
        </button>
      </div>

      {/* Selector de carta. Solo si el negocio tiene mas de una: con una sola
          no hay nada que elegir y el selector solo estorbaria. */}
      {menus.length > 1 && (
        <div className="mb-4">
          <div className="text-xs font-semibold text-mute mb-1.5">
            ¿De qué carta es este cartel?
          </div>
          <div className="flex gap-2 flex-wrap">
            {menus.map((m) => (
              <button
                key={m.id ?? 'principal'}
                type="button"
                onClick={() => setCarta(m.id)}
                className={`px-3 py-2 rounded-lg border text-left transition ${
                  carta === m.id
                    ? 'border-brand bg-brand/5'
                    : 'border-line hover:bg-bg2'
                }`}
              >
                <div className="text-sm font-semibold">{m.name}</div>
                <div className="text-[11px] text-mute">
                  {m.locationName ?? (m.esPrincipal ? 'Todas las sedes' : 'Sin sede')}
                </div>
              </button>
            ))}
          </div>
          {cartaElegida && !cartaElegida.esPrincipal && !cartaElegida.locationId && (
            <p className="text-[11px] text-amber-700 mt-2 leading-snug">
              ⚠️ Esta carta no tiene sede asignada. El cartel funcionará, pero
              conviene asignársela desde el Menú para que quede claro cuál es.
            </p>
          )}
        </div>
      )}

      <p className="text-xs text-mute mb-4">
        URL del QR: <span className="font-mono break-all">{qrUrl}</span>
      </p>

      <QrPosterEditor
        type="MENU"
        qrUrl={qrUrl}
        brandName={tenant.brandName ?? 'Mi Negocio'}
        logoUrl={tenant.walletLogoUrl || tenant.logoUrl || null}
      />
    </div>
  );
}
