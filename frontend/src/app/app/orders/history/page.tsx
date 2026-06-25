'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { downloadFile } from '@/lib/api';

type Order = {
  id: string;
  code: string;
  status: 'PENDING' | 'CONFIRMED' | 'READY' | 'DELIVERED' | 'CANCELLED';
  createdAt: string;
  total: number | string;
  fulfillment: string | null;
  items?: unknown[];
  customer?: { fullName: string | null; phone: string | null; email?: string | null } | null;
};

const STATUS_LABEL: Record<Order['status'], { t: string; cls: string }> = {
  PENDING: { t: 'Pendiente', cls: 'bg-amber-100 text-amber-800' },
  CONFIRMED: { t: 'Confirmado', cls: 'bg-blue-100 text-blue-800' },
  READY: { t: 'Listo', cls: 'bg-indigo-100 text-indigo-800' },
  DELIVERED: { t: 'Entregado', cls: 'bg-emerald-100 text-emerald-800' },
  CANCELLED: { t: 'Cancelado', cls: 'bg-red-100 text-red-800' },
};

const FULFILLMENT_LABEL: Record<string, string> = {
  DINE_IN: 'Mesa',
  DELIVERY: 'Domicilio',
  PICKUP: 'Recoger',
};

export default function OrdersHistoryPage() {
  const [rows, setRows] = useState<Order[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');

  const qs = useCallback(() => {
    const p = new URLSearchParams();
    if (search.trim()) p.set('search', search.trim());
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (status) p.set('status', status);
    const s = p.toString();
    return s ? `?${s}` : '';
  }, [search, from, to, status]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<Order[]>(`/orders${qs()}`);
      setRows(data ?? []);
    } catch (e: any) {
      toast(e?.message ?? 'Error al cargar el historial', 'error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [qs]);

  // Carga inicial (pedidos recientes).
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Historial de pedidos</h1>
          <p className="text-mute text-sm mt-1">
            Busca por nombre, teléfono o código y filtra por fecha.
          </p>
        </div>
        <Link href="/app/orders" className="btn-ghost text-sm">
          ← Volver al tablero
        </Link>
      </div>

      {/* Filtros */}
      <form
        className="card card-pad mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <div className="flex-1 min-w-[200px]">
          <label className="label">Buscar (nombre · teléfono · código)</label>
          <div className="flex items-center gap-2 bg-white border border-line rounded-input px-3 py-2 mt-1">
            <Icon name="search" size={14} className="text-mute" />
            <input
              className="border-0 outline-none text-sm w-full bg-transparent"
              placeholder="Ej. Juan, 3001234567, A1B2"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="label">Desde</label>
          <input
            type="date"
            className="input mt-1"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Hasta</label>
          <input
            type="date"
            className="input mt-1"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Estado</label>
          <select
            className="input mt-1"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Todos</option>
            <option value="PENDING">Pendiente</option>
            <option value="CONFIRMED">Confirmado</option>
            <option value="READY">Listo</option>
            <option value="DELIVERED">Entregado</option>
            <option value="CANCELLED">Cancelado</option>
          </select>
        </div>
        <button type="submit" className="btn-primary text-sm" disabled={loading}>
          {loading ? 'Buscando…' : 'Buscar'}
        </button>
        <button
          type="button"
          className="btn-ghost text-sm"
          title="Descargar CSV de estos resultados"
          onClick={() =>
            downloadFile(
              `/orders/export.csv${qs()}`,
              `pedidos-${new Date().toISOString().slice(0, 10)}.csv`,
            )
          }
        >
          ⤓ CSV
        </button>
      </form>

      {/* Resultados */}
      <div className="card overflow-hidden">
        {rows === null ? (
          <div className="p-8 text-center text-mute text-sm">Cargando…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-mute text-sm">
            No hay pedidos para estos filtros.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-mute border-b border-line2">
                  <th className="px-4 py-2.5 font-semibold">Código</th>
                  <th className="px-4 py-2.5 font-semibold">Fecha</th>
                  <th className="px-4 py-2.5 font-semibold">Cliente</th>
                  <th className="px-4 py-2.5 font-semibold">Teléfono</th>
                  <th className="px-4 py-2.5 font-semibold">Tipo</th>
                  <th className="px-4 py-2.5 font-semibold">Estado</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const st = STATUS_LABEL[o.status];
                  return (
                    <tr
                      key={o.id}
                      className="border-b border-line2/60 hover:bg-bg2/40"
                    >
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/app/orders/${o.id}`}
                          className="font-mono font-semibold text-brand hover:underline"
                        >
                          {o.code}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-mute whitespace-nowrap">
                        {new Date(o.createdAt).toLocaleString('es-CO', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-2.5">{o.customer?.fullName ?? '—'}</td>
                      <td className="px-4 py-2.5 text-mute">{o.customer?.phone ?? '—'}</td>
                      <td className="px-4 py-2.5 text-mute">
                        {FULFILLMENT_LABEL[o.fulfillment ?? ''] ?? o.fulfillment ?? '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${st.cls}`}>
                          {st.t}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold">
                        ${Math.round(Number(o.total)).toLocaleString('es-CO')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows && rows.length >= 200 && (
          <div className="p-3 text-center text-[11px] text-mute border-t border-line2">
            Mostrando los primeros 200 resultados — afina la búsqueda o el rango de fechas.
          </div>
        )}
      </div>
    </div>
  );
}
