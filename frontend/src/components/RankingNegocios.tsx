'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { EnlaceNegocio, useFuenteMetricas } from '@/lib/fuente-metricas';

/**
 * Ranking de negocios por pases emitidos o por pedidos de los menús.
 *
 * Nació como modal en Admin → Negocios (#11, 2026-06-16) y se quedó pequeño;
 * desde el 2026-10-19 vive en la página «Métricas» (/admin/metricas) como dos
 * pestañas. La lógica es la misma de siempre: mismo endpoint
 * (`/tenants/ranking`), mismos filtros de período, criterio e inversión, y el
 * buscador de marca.
 */
type RankingRow = {
  id: string;
  brandName: string;
  status: string;
  passCount: number;
  passTotal: number;
  createdAt: string;
};

export type MetricaRanking = 'pases' | 'pedidos';

/** Períodos del filtro. `null` = todo el histórico. */
const PERIODOS: { dias: number | null; label: string }[] = [
  { dias: null, label: 'Todo' },
  { dias: 30, label: '30 días' },
  { dias: 90, label: '90 días' },
  { dias: 365, label: '1 año' },
];

/** «hace 2 años y 3 meses», que se lee mejor que una fecha suelta. */
function antiguedadTexto(desde: string): string {
  const meses = Math.max(
    0,
    Math.round((Date.now() - new Date(desde).getTime()) / (30.44 * 86_400_000)),
  );
  if (meses < 1) return 'este mes';
  if (meses < 12) return `${meses} ${meses === 1 ? 'mes' : 'meses'}`;
  const anios = Math.floor(meses / 12);
  const resto = meses % 12;
  const a = `${anios} ${anios === 1 ? 'año' : 'años'}`;
  return resto === 0 ? a : `${a} y ${resto} ${resto === 1 ? 'mes' : 'meses'}`;
}

const sinTildes = (x: string) =>
  x.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

export function RankingNegocios({ metrica }: { metrica: MetricaRanking }) {
  const t = useTranslations('admin_tenants');
  const [order, setOrder] = useState<'desc' | 'asc'>('desc');
  const [criterio, setCriterio] = useState<'pases' | 'antiguedad'>('pases');
  const [dias, setDias] = useState<number | null>(null);
  const [rows, setRows] = useState<RankingRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Buscar una marca en el ranking (Sara, PDF 13): saber cuántos pases o
  // pedidos lleva un negocio concreto sin bajar por la lista. El puesto que se
  // muestra es el REAL en el ranking completo, no el de la lista filtrada.
  const [busqueda, setBusqueda] = useState('');

  const fuente = useFuenteMetricas();
  useEffect(() => {
    let vivo = true;
    setLoading(true);
    fuente.get<RankingRow[]>(
      `/tenants/ranking?order=${order}&criterio=${criterio}&metric=${metrica}` +
        (dias ? `&dias=${dias}` : ''),
    )
      .then((r) => vivo && setRows(r ?? []))
      .catch(() => vivo && setRows([]))
      .finally(() => vivo && setLoading(false));
    // Al cambiar de pestaña rápido, la respuesta vieja no pisa a la nueva.
    return () => {
      vivo = false;
    };
  }, [order, criterio, dias, metrica]);

  const unidad = metrica === 'pases' ? 'pases' : 'pedidos';
  const unidadCap = metrica === 'pases' ? 'Pases' : 'Pedidos';
  const unidadVerbo = metrica === 'pases' ? 'emitidos' : 'realizados';

  // El total, que es el dato que faltaba: sin él, el ranking dice quién va
  // primero pero no de cuánto estamos hablando.
  const totalPases = rows.reduce((s, r) => s + r.passTotal, 0);
  const totalPeriodo = rows.reduce((s, r) => s + r.passCount, 0);
  const q = sinTildes(busqueda);
  const visibles = rows
    .map((r, puesto) => ({ r, puesto }))
    .filter(({ r }) => !q || sinTildes(r.brandName ?? '').includes(q));

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-line space-y-2.5">
        {/* Por qué se ordena. «Antigüedad» responde otra pregunta: quién lleva
            más tiempo con nosotros no suele ser quien más emite/pide. */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg bg-bg2 p-0.5">
            {(
              [
                ['pases', `Por ${unidad}`],
                ['antiguedad', 'Por antigüedad'],
              ] as ['pases' | 'antiguedad', string][]
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setCriterio(k)}
                className={`px-2.5 py-1 text-xs rounded-md font-medium ${
                  criterio === k ? 'bg-white shadow-sm text-ink' : 'text-mute'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* El período acota SOLO el conteo; el orden por antigüedad no
              depende de él, así que ahí no se ofrece y no confunde. */}
          {criterio === 'pases' && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-mute">
                {unidadCap} {unidadVerbo} en:
              </span>
              {PERIODOS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setDias(p.dias)}
                  className={`px-2 py-0.5 text-[11px] rounded-full border ${
                    dias === p.dias
                      ? 'border-brand text-brand font-semibold bg-brand-soft'
                      : 'border-line text-mute'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            className="btn-ghost text-xs ml-auto"
            onClick={() => setOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
          >
            ⇅ {t('rankingInvert')}
          </button>
        </div>

        <div className="relative max-w-md">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar marca…"
            aria-label="Buscar marca en el ranking"
            className="input w-full h-9 text-sm pl-8"
          />
          <span
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mute text-sm pointer-events-none"
            aria-hidden
          >
            🔍
          </span>
        </div>

        <div className="text-xs text-mute">
          {q && (
            <>
              <b className="text-ink">{visibles.length}</b>{' '}
              {visibles.length === 1 ? 'coincide' : 'coinciden'} ·{' '}
            </>
          )}
          {t('rankingCount', { count: rows.length })} ·{' '}
          <b className="text-ink">{totalPases.toLocaleString('es-CO')}</b> {unidad} {unidadVerbo} en
          total
          {dias != null && criterio === 'pases' && (
            <>
              {' '}
              · <b className="text-ink">{totalPeriodo.toLocaleString('es-CO')}</b> en el período
            </>
          )}
          {criterio === 'antiguedad' && (
            <> · {order === 'desc' ? 'los más antiguos primero' : 'los más nuevos primero'}</>
          )}
        </div>
      </div>

      <div className="p-2">
        {loading ? (
          <div className="text-center text-mute text-sm py-10">{t('loading')}</div>
        ) : rows.length === 0 ? (
          <div className="text-center text-mute text-sm py-10">{t('noData')}</div>
        ) : visibles.length === 0 ? (
          <div className="text-center text-mute text-sm py-10">
            Ninguna marca coincide con «{busqueda.trim()}».
          </div>
        ) : (
          <div className="divide-y divide-line">
            {visibles.map(({ r, puesto: i }) => (
              <EnlaceNegocio
                key={r.id} id={r.id}
                className="flex items-center gap-3 px-2 sm:px-3 py-2.5 hover:bg-bg2 rounded-lg"
              >
                <div className="w-8 text-center font-bold tabular-nums">
                  {order === 'desc' && i < 3 ? ['🥇', '🥈', '🥉'][i] : `${i + 1}`}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{r.brandName}</div>
                  <div className="text-[11px] text-mute">
                    {r.status} · lleva {antiguedadTexto(r.createdAt)}
                  </div>
                </div>
                <div className="text-right whitespace-nowrap">
                  <div className="font-bold text-brand tabular-nums">
                    {r.passCount.toLocaleString('es-CO')} {unidad}
                  </div>
                  {/* Con período activo, el total al lado: «40» no se puede
                      leer sin saber si viene de 50 o de 5.000. */}
                  {dias != null && criterio === 'pases' && (
                    <div className="text-[10px] text-mute">
                      de {r.passTotal.toLocaleString('es-CO')} en total
                    </div>
                  )}
                </div>
              </EnlaceNegocio>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
