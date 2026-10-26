'use client';
import { useEffect, useState } from 'react';
import { RankingNegocios } from '@/components/RankingNegocios';
import { MetricasGenerales } from './MetricasGenerales';

/**
 * /admin/metricas — Métricas del panel (pedido del dueño, 2026-10-19).
 *
 * El «Ranking de pases / de pedidos» era un modal en Negocios y se quedó
 * pequeño; aquí son dos pestañas con el mismo componente, y la tercera son las
 * métricas generales de todos los negocios de la marca.
 *
 * La pestaña va en `?tab=` para que el botón de Negocios abra directo el
 * ranking y para que el enlace se pueda compartir. Se lee de `location` y no
 * con `useSearchParams`, que en Next 14 obliga a envolver la página en
 * <Suspense> para compilar.
 */
type Pestana = 'pases' | 'pedidos' | 'generales';
const PESTANAS: Array<{ id: Pestana; etiqueta: string }> = [
  { id: 'pases', etiqueta: '🎫 Ranking de pases' },
  { id: 'pedidos', etiqueta: '🛵 Ranking de pedidos' },
  { id: 'generales', etiqueta: '📊 Métricas generales' },
];
const esPestana = (x: string | null): x is Pestana => PESTANAS.some((p) => p.id === x);

export function PanelMetricas() {
  const [pestana, setPestana] = useState<Pestana>('pases');

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (esPestana(tab)) setPestana(tab);
  }, []);

  const elegir = (p: Pestana) => {
    setPestana(p);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', p);
    window.history.replaceState(null, '', url.toString());
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-ink">Métricas</h1>
        <p className="text-sm text-mute mt-1 max-w-2xl">
          Cómo se mueven los negocios de la marca: quién emite más pases, quién recibe más pedidos y
          quién se quedó quieto.
        </p>
      </div>

      <div className="flex rounded-lg bg-bg2 p-0.5 overflow-x-auto max-w-full w-fit" role="tablist">
        {PESTANAS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={pestana === p.id}
            onClick={() => elegir(p.id)}
            className={`px-3 sm:px-4 py-1.5 text-xs sm:text-sm rounded-md font-semibold whitespace-nowrap ${
              pestana === p.id ? 'bg-white shadow-sm text-ink' : 'text-mute'
            }`}
          >
            {p.etiqueta}
          </button>
        ))}
      </div>

      {pestana === 'generales' ? (
        <MetricasGenerales />
      ) : (
        // Sin `key`: como en el modal, el buscador y los filtros se conservan al
        // pasar de un ranking al otro.
        <RankingNegocios metrica={pestana} />
      )}
    </div>
  );
}

