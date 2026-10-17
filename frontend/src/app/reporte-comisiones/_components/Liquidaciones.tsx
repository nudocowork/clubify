'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { descargarXlsx } from '@/lib/exportar-hoja';
import { fecha, usd, ymd } from '../_lib';

type Pago = {
  id: string;
  origen: 'Corte' | 'Pago a afiliado';
  fechaPago: string;
  beneficiario: string;
  periodo: string | null;
  corte: string | null;
  valorUsd: number;
  metodo: string | null;
  referencia: string | null;
  comprobanteUrl: string | null;
  aprobo: string | null;
  registro: string | null;
  notas: string | null;
};
type Corte = {
  id: string;
  code: string;
  fechaPago: string | null;
  periodo: string | null;
  totalUsd: number;
  referencia: string | null;
  comprobanteUrl: string | null;
  cerradoPor: string | null;
  cerradoEl: string | null;
  tipo: string;
  notas: string | null;
};
type Resp = { pagos: Pago[]; totalPagos: number; page: number; pageSize: number; cortes: Corte[] };

const guion = (v: string | null | undefined) => v || '—';

/** Historial de liquidaciones. Solo lectura: lo pagado no se edita. */
export function Liquidaciones() {
  const [r, setR] = useState<Resp | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Resp>(`/admin/reporte-comisiones/liquidaciones?page=${page}&pageSize=50`)
      .then(setR)
      .catch((e) => setError(e?.message ?? 'No se pudo cargar el historial'));
  }, [page]);

  function exportar() {
    if (!r) return;
    descargarXlsx(`liquidaciones-${ymd(new Date().toISOString())}.xlsx`, [
      {
        nombre: 'Pagos',
        filas: [
          ['Fecha de pago', 'Beneficiario', 'Período', 'Corte', 'Valor USD', 'Método', 'Referencia', 'Comprobante', 'Aprobó', 'Registró', 'Origen'],
          ...r.pagos.map((p) => [ymd(p.fechaPago), p.beneficiario, p.periodo, p.corte, p.valorUsd, p.metodo, p.referencia, p.comprobanteUrl, p.aprobo, p.registro, p.origen]),
        ],
      },
      {
        nombre: 'Cortes cerrados',
        filas: [
          ['Corte', 'Fecha de pago', 'Período', 'Total USD (todas las marcas)', 'Referencia', 'Comprobante', 'Cerró', 'Tipo'],
          ...r.cortes.map((c) => [c.code, ymd(c.fechaPago), c.periodo, c.totalUsd, c.referencia, c.comprobanteUrl, c.cerradoPor, c.tipo]),
        ],
      },
    ]);
  }

  if (error) return <div className="card card-pad text-sm text-bad">{error}</div>;
  if (!r) return <div className="pulse-soft h-48" />;
  const paginas = Math.max(1, Math.ceil(r.totalPagos / r.pageSize));

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="card-h">
          <h3>Pagos registrados</h3>
          <button className="btn-ghost" onClick={exportar}>
            Exportar Excel
          </button>
        </div>
        <div className="p-4">
          <p className="text-xs text-mute mb-3">
            «Aprobó» es quien cerró el corte confirmando la transferencia; un pago por persona no guarda aparte quién lo aprobó ni
            el método (Binance o banco): ahí sale «—».
          </p>
          <div className="overflow-x-auto rounded-lg border border-line2">
            <table className="min-w-[1000px] w-full text-sm">
              <thead className="bg-bg2 text-[11px] uppercase tracking-wide text-mute">
                <tr>
                  {['Fecha de pago', 'Beneficiario', 'Período', 'Valor', 'Método', 'Referencia', 'Comprobante', 'Aprobó', 'Registró'].map((h) => (
                    <th key={h} className={`px-3 py-2 font-semibold ${h === 'Valor' ? 'text-right' : 'text-left'}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.pagos.map((p) => (
                  <tr key={p.id} className="border-t border-line2">
                    <td className="px-3 py-2 whitespace-nowrap">{fecha(p.fechaPago)}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{p.beneficiario}</div>
                      <div className="text-[11px] text-mute">{p.origen}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{guion(p.periodo)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap font-semibold">{usd(p.valorUsd)}</td>
                    <td className="px-3 py-2">{guion(p.metodo)}</td>
                    <td className="px-3 py-2">{guion(p.referencia)}</td>
                    <td className="px-3 py-2">
                      {p.comprobanteUrl ? (
                        <a href={p.comprobanteUrl} target="_blank" rel="noreferrer" className="btn-link text-xs">
                          Ver
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2">{guion(p.aprobo)}</td>
                    <td className="px-3 py-2">{guion(p.registro)}</td>
                  </tr>
                ))}
                {r.pagos.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-mute">
                      Todavía no hay pagos registrados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {paginas > 1 && (
            <div className="flex items-center justify-end gap-2 mt-3 text-sm">
              <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </button>
              <span className="text-mute">
                {page} de {paginas}
              </span>
              <button className="btn-ghost" disabled={page >= paginas} onClick={() => setPage((p) => p + 1)}>
                Siguiente
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Cortes cerrados</h3>
        </div>
        <div className="p-4">
          <p className="text-xs text-mute mb-3">El total de cada corte incluye todas las marcas; el detalle de la plataforma está en los pagos de arriba.</p>
          <div className="overflow-x-auto rounded-lg border border-line2">
            <table className="min-w-[820px] w-full text-sm">
              <thead className="bg-bg2 text-[11px] uppercase tracking-wide text-mute">
                <tr>
                  {['Corte', 'Fecha de pago', 'Período', 'Total', 'Referencia', 'Comprobante', 'Cerró'].map((h) => (
                    <th key={h} className={`px-3 py-2 font-semibold ${h === 'Total' ? 'text-right' : 'text-left'}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.cortes.map((c) => (
                  <tr key={c.id} className="border-t border-line2">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {c.code}
                      {c.tipo !== 'Corte' && <span className="badge badge-mute ml-1">{c.tipo}</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{fecha(c.fechaPago)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{guion(c.periodo)}</td>
                    <td className="px-3 py-2 text-right font-semibold whitespace-nowrap">{usd(c.totalUsd)}</td>
                    <td className="px-3 py-2">{guion(c.referencia)}</td>
                    <td className="px-3 py-2">
                      {c.comprobanteUrl ? (
                        <a href={c.comprobanteUrl} target="_blank" rel="noreferrer" className="btn-link text-xs">
                          Ver
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2">{guion(c.cerradoPor)}</td>
                  </tr>
                ))}
                {r.cortes.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-mute">
                      No hay cortes cerrados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
