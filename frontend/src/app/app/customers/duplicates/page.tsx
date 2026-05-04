'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type Dup = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
  totalOrdersCount: number;
  totalOrdersAmount: number;
  lastOrderAt: string | null;
  _count: { passes: number; stamps: number; orders: number };
};

type Group = {
  reason: 'phone' | 'email';
  key: string;
  customers: Dup[];
};

type Resp = { total: number; groups: Group[] };

const REASON_LABEL = {
  phone: { emoji: '📞', text: 'Mismo teléfono (formatos distintos)' },
  email: { emoji: '✉️', text: 'Mismo email (mayúsculas/minúsculas)' },
} as const;

function COP(n: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

function fmtDate(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

export default function DuplicatesPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  // Por grupo: id del que se conserva (default = más antiguo)
  const [keepers, setKeepers] = useState<Record<string, string>>({});
  const [merging, setMerging] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const r: Resp = await api('/customers/duplicates');
      setData(r);
      const k: Record<string, string> = {};
      for (const g of r.groups) {
        // Default: el más antiguo (primero en el array, ya viene ordenado asc)
        k[g.key] = g.customers[0].id;
      }
      setKeepers(k);
    } catch (e: any) {
      toast(e.message || 'No se pudieron cargar los duplicados', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function doMerge(group: Group) {
    const keepId = keepers[group.key];
    const mergeIds = group.customers
      .filter((c) => c.id !== keepId)
      .map((c) => c.id);
    if (mergeIds.length === 0) return;

    const keeper = group.customers.find((c) => c.id === keepId);
    const others = group.customers.filter((c) => c.id !== keepId);
    const ok = window.confirm(
      `Vas a fusionar ${others.length} cliente${others.length > 1 ? 's' : ''} en "${keeper?.fullName}".\n\n` +
        `Los pedidos, tarjetas, sellos y mensajes se moverán al cliente que conservas.\n` +
        `Los duplicados se eliminarán de forma definitiva.\n\n` +
        `¿Continuar?`,
    );
    if (!ok) return;

    setMerging(group.key);
    try {
      const res = await api('/customers/merge', {
        method: 'POST',
        body: JSON.stringify({ keepId, mergeIds }),
      });
      toast(
        `Fusionado · ${res.movedOrders} pedidos · ${res.movedStamps} sellos`,
        'success',
      );
      await load();
    } catch (e: any) {
      toast(e.message || 'No se pudo fusionar', 'error');
    } finally {
      setMerging(null);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">
            Posibles duplicados{' '}
            {data && (
              <span className="page-crumb">
                / {data.total} grupo{data.total === 1 ? '' : 's'}
              </span>
            )}
          </h1>
          <p className="text-mute text-sm mt-1">
            Detectamos clientes que probablemente son la misma persona. Elige
            cuál conservar y fusiona el resto en un clic.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/app/customers" className="btn-ghost text-xs">
            ← Volver a clientes
          </Link>
          <button onClick={load} className="btn-ghost text-xs">
            ↻ Actualizar
          </button>
        </div>
      </div>

      {loading && (
        <div className="card card-pad text-mute text-sm">Buscando duplicados…</div>
      )}

      {!loading && data && data.total === 0 && (
        <div className="card card-pad text-center py-12">
          <div className="text-5xl mb-3">✨</div>
          <h3 className="font-semibold text-lg mb-1">
            No encontramos duplicados
          </h3>
          <p className="text-mute text-sm max-w-md mx-auto">
            Tu base de clientes está limpia. Cuando importes un CSV o se
            generen registros con el mismo teléfono o email, los verás aquí.
          </p>
          <Link
            href="/app/customers"
            className="btn-primary mt-6 inline-flex"
          >
            ← Volver a clientes
          </Link>
        </div>
      )}

      {!loading &&
        data &&
        data.groups.map((g) => {
          const reason = REASON_LABEL[g.reason];
          const keepId = keepers[g.key];
          const isMerging = merging === g.key;
          return (
            <div key={g.key} className="card mb-4">
              <div className="px-4 py-3 border-b border-line flex items-center justify-between bg-bg2/50">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{reason.emoji}</span>
                  <span className="text-sm font-medium">{reason.text}</span>
                  <span className="text-[10px] uppercase tracking-wide text-mute bg-white px-2 py-0.5 rounded-full border border-line">
                    {g.customers.length} clientes
                  </span>
                </div>
                <button
                  className="btn-primary text-xs"
                  disabled={isMerging}
                  onClick={() => doMerge(g)}
                >
                  {isMerging ? 'Fusionando…' : 'Fusionar este grupo →'}
                </button>
              </div>
              <div className="divide-y divide-line">
                {g.customers.map((c) => {
                  const isKeeper = c.id === keepId;
                  return (
                    <label
                      key={c.id}
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition ${
                        isKeeper ? 'bg-brand/5' : 'hover:bg-bg2/40'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`keep-${g.key}`}
                        checked={isKeeper}
                        onChange={() =>
                          setKeepers((prev) => ({ ...prev, [g.key]: c.id }))
                        }
                        className="accent-brand"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link
                            href={`/app/customers/${c.id}`}
                            target="_blank"
                            className="font-medium text-ink hover:text-brand truncate"
                          >
                            {c.fullName}
                          </Link>
                          {isKeeper && (
                            <span className="text-[10px] font-semibold uppercase tracking-wide bg-brand text-white px-2 py-0.5 rounded-full">
                              Conservar
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-mute mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
                          {c.email && <span>✉️ {c.email}</span>}
                          {c.phone && <span>📞 {c.phone}</span>}
                          <span>· Desde {fmtDate(c.createdAt)}</span>
                        </div>
                      </div>
                      <div className="text-right text-xs text-mute hidden sm:block">
                        <div>
                          <strong className="text-ink">
                            {c._count.orders}
                          </strong>{' '}
                          pedidos · {COP(c.totalOrdersAmount)}
                        </div>
                        <div>
                          {c._count.passes} pase
                          {c._count.passes === 1 ? '' : 's'} ·{' '}
                          {c._count.stamps} sello
                          {c._count.stamps === 1 ? '' : 's'}
                        </div>
                        <div>Último: {fmtDate(c.lastOrderAt)}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
              <div className="px-4 py-2 text-[11px] text-mute bg-bg2/30 border-t border-line">
                Sugerencia: conserva el cliente con más historial. Sus tags y
                notas se combinarán; los demás se eliminan.
              </div>
            </div>
          );
        })}
    </div>
  );
}
