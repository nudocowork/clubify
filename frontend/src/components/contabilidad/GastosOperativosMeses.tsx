'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { money } from './PanoramaPeriodo';

type Grilla = {
  mesActual: string;
  meses: string[];
  gastos: Array<{
    id: string;
    concept: string;
    categoryId: string | null;
    supplier: string | null;
    periodicity: string;
    active: boolean;
    montos: Record<string, number>;
  }>;
  totales: Record<string, number>;
};

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const etiqueta = (m: string) => `${MESES[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`;

/**
 * Gastos operativos mes a mes. Cada uno cuenta en la cascada de utilidad de
 * todos los meses desde mayo de 2026. Los meses pasados se ven pero no se
 * tocan; un valor cambiado en el mes en curso o en uno futuro rige desde ese
 * mes hasta el siguiente cambio (así se sube Vercel en diciembre sin reescribir
 * lo que costó en junio).
 */
export function GastosOperativosMeses({
  scope,
  catName,
  onCambio,
}: {
  scope: string;
  catName: Record<string, string>;
  onCambio: () => void;
}) {
  const [g, setG] = useState<Grilla | null>(null);
  const [error, setError] = useState(false);
  const [edit, setEdit] = useState<{ id: string; mes: string; valor: string } | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    const r = await api<Grilla>(`/admin/contabilidad/gastos-operativos?scope=${scope}`).catch(() => null);
    setError(!r);
    setG(r);
  }, [scope]);
  useEffect(() => { void cargar(); }, [cargar]);

  const guardar = async () => {
    if (!edit) return;
    const monto = Number(edit.valor.replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(monto) || monto < 0) { toast('Escribe un monto válido en USD'); return; }
    setGuardando(true);
    const r = await api<{ ok: boolean }>(`/admin/contabilidad/gastos-operativos/${edit.id}/monto`, {
      method: 'PATCH',
      body: JSON.stringify({ desde: edit.mes, montoUsd: monto }),
    }).catch((e: Error) => { toast(e?.message || 'No se pudo guardar'); return null; });
    setGuardando(false);
    if (!r?.ok) return;
    toast(`Guardado: ${money(monto)} desde ${etiqueta(edit.mes)}`);
    setEdit(null);
    await cargar();
    onCambio();
  };

  if (error) return <div className="card card-pad text-sm text-mute">No se pudieron cargar los gastos por mes.</div>;
  if (!g) return <div className="card card-pad text-sm text-mute">Cargando gastos por mes…</div>;
  if (g.gastos.length === 0) return null;

  return (
    <div className="card overflow-hidden p-0">
      <div className="px-4 py-3 border-b border-line2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-semibold text-sm">Gastos operativos por mes</div>
        <div className="text-xs text-mute">
          Se restan en la cascada de utilidad desde mayo de 2026. Toca un valor del mes en curso o de uno futuro para cambiarlo desde ese mes en adelante.
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3 font-semibold sticky left-0 bg-bg2 min-w-[180px]">Concepto</th>
              {g.meses.map((m) => (
                <th key={m} className={`px-3 py-3 font-semibold text-right whitespace-nowrap ${m === g.mesActual ? 'text-brand' : ''}`}>
                  {etiqueta(m)}{m === g.mesActual ? ' · hoy' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {g.gastos.map((x) => (
              <tr key={x.id} className={`border-t border-line2 ${x.active ? '' : 'opacity-50'}`}>
                <td className="px-4 py-2.5 sticky left-0 bg-surface">
                  <div className="font-semibold">{x.concept}</div>
                  <div className="text-[11px] text-mute">
                    {[x.categoryId ? catName[x.categoryId] : null, x.supplier, x.active ? null : 'inactivo'].filter(Boolean).join(' · ') || '—'}
                  </div>
                </td>
                {g.meses.map((m) => {
                  const pasado = m < g.mesActual;
                  const editando = edit?.id === x.id && edit.mes === m;
                  if (editando) {
                    return (
                      <td key={m} className="px-2 py-1.5 text-right">
                        <input
                          autoFocus
                          inputMode="decimal"
                          className="input w-24 text-right text-sm py-1"
                          value={edit.valor}
                          disabled={guardando}
                          onChange={(e) => setEdit({ ...edit, valor: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void guardar();
                            if (e.key === 'Escape') setEdit(null);
                          }}
                          onBlur={() => { if (!guardando) setEdit(null); }}
                          aria-label={`${x.concept}, ${etiqueta(m)} en adelante`}
                        />
                      </td>
                    );
                  }
                  return (
                    <td key={m} className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                      {pasado || !x.active ? (
                        <span className="text-mute">{money(x.montos[m])}</span>
                      ) : (
                        <button
                          type="button"
                          className="hover:underline decoration-dotted focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand rounded"
                          title={`Cambiar desde ${etiqueta(m)} en adelante`}
                          onClick={() => setEdit({ id: x.id, mes: m, valor: String(x.montos[m]) })}
                        >
                          {money(x.montos[m])}
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line2 font-semibold">
              <td className="px-4 py-3 sticky left-0 bg-surface">Total del mes</td>
              {g.meses.map((m) => (
                <td key={m} className="px-3 py-3 text-right tabular-nums text-red-600 whitespace-nowrap">−{money(g.totales[m])}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
