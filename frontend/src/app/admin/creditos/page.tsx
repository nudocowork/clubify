'use client';
/**
 * /admin/creditos — Panel de créditos de la marca blanca (Fase 3 · #6/#7).
 *
 * El admin de una marca blanca ve sus créditos (1 crédito = 30 días de
 * servicio para un negocio), compra packs (links Hotmart configurados por
 * el PLATFORM_OWNER), y activa manualmente los negocios pendientes
 * consumiendo 1 crédito.
 *
 * Aislado por marca en el backend (user.whiteLabelId). Para admins
 * globales (Clubify) el endpoint da 403 → mostramos un aviso.
 */
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type BuyLink = {
  id: string;
  credits: number;
  label: string;
  url: string;
  price: number | null;
  currency: string;
};

type Tx = {
  id: string;
  type: 'PURCHASE' | 'CONSUME' | 'COMMIT' | 'REFUND' | 'ADJUSTMENT';
  amount: number;
  note: string | null;
  tenantId: string | null;
  createdAt: string;
};

type Credits = {
  whiteLabel: { id: string; name: string; slug: string };
  unlimited: boolean;
  available: number;
  committed: number;
  used: number;
  pendingTenants: number;
  buyLinks: BuyLink[];
  history: Tx[];
};

type Pending = {
  id: string;
  brandName: string;
  slug: string;
  status: string;
  reason: string;
  overdueDays: number;
  createdAt: string;
};

const TX_LABEL: Record<Tx['type'], string> = {
  PURCHASE: 'Compra',
  CONSUME: 'Consumo',
  COMMIT: 'Comprometido',
  REFUND: 'Reembolso',
  ADJUSTMENT: 'Ajuste',
};

function Kpi({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  tone?: 'default' | 'good' | 'warn';
}) {
  const ring =
    tone === 'good'
      ? 'border-emerald-200 bg-emerald-50'
      : tone === 'warn'
        ? 'border-amber-200 bg-amber-50'
        : 'border-gray-200 bg-white';
  return (
    <div className={`rounded-2xl border ${ring} p-4`}>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-[12px] text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

export default function CreditsPage() {
  const [data, setData] = useState<Credits | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, p] = await Promise.all([
        api<Credits>('/admin/credits'),
        api<Pending[]>('/admin/credits/pending'),
      ]);
      setData(c);
      setPending(p ?? []);
    } catch (e: any) {
      if (e?.status === 403) setForbidden(true);
      else toast(e?.message ?? 'No se pudo cargar', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function activate(t: Pending) {
    if (activatingId) return;
    if (
      !confirm(
        `Activar "${t.brandName}" consume 1 crédito y le extiende 30 días. ¿Continuar?`,
      )
    )
      return;
    setActivatingId(t.id);
    try {
      const res = await api<{ consumed: number; creditsAvailable: number }>(
        `/admin/credits/activate/${t.id}`,
        { method: 'POST' },
      );
      toast(
        res.consumed > 0
          ? `Activado · ${res.creditsAvailable} créditos restantes`
          : 'Activado',
        'success',
      );
      await load();
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo activar', 'error');
    } finally {
      setActivatingId(null);
    }
  }

  if (loading) {
    return <div className="p-6 text-gray-500">Cargando créditos…</div>;
  }

  if (forbidden || !data) {
    return (
      <div className="p-6">
        <div className="max-w-lg rounded-2xl border border-gray-200 bg-white p-6">
          <h1 className="text-lg font-bold text-gray-900">Créditos</h1>
          <p className="mt-2 text-sm text-gray-600">
            Esta sección es para administradores de una marca blanca. Tu cuenta
            opera a nivel plataforma (Clubify), donde los créditos se gestionan
            desde Master Admin → Créditos.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Créditos</h1>
          <p className="text-sm text-gray-500">
            1 crédito = 30 días de servicio para un negocio de {data.whiteLabel.name}.
          </p>
        </div>
        <button
          onClick={load}
          className="text-sm px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50"
        >
          Actualizar
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
        <Kpi label="Disponibles" value={data.available} tone="good" />
        <Kpi label="Comprometidos (30d)" value={data.committed} />
        <Kpi label="Usados (histórico)" value={data.used} />
        <Kpi
          label="Negocios pendientes"
          value={data.pendingTenants}
          tone={data.pendingTenants > 0 ? 'warn' : 'default'}
        />
      </div>

      {/* Comprar créditos */}
      {data.buyLinks.length > 0 && (
        <section className="mt-7">
          <h2 className="text-sm font-bold text-gray-700 mb-2">
            Comprar créditos
          </h2>
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
            <span className="font-bold">Importante:</span> compra los créditos
            usando <span className="font-bold">exactamente el mismo correo</span>{' '}
            registrado en tu marca para que la acreditación sea automática. Si
            usas otro correo, el pago queda pendiente de asignación manual.
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.buyLinks.map((l) => (
              <a
                key={l.id}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-2xl border border-gray-200 bg-white p-4 hover:border-gray-300 hover:shadow-sm transition"
              >
                <div className="text-sm font-semibold text-gray-900">
                  {l.label}
                </div>
                <div className="text-[12px] text-gray-500 mt-0.5">
                  {l.credits} crédito{l.credits === 1 ? '' : 's'}
                </div>
                {l.price != null && (
                  <div className="text-base font-bold text-gray-900 mt-2">
                    {l.currency} ${l.price.toLocaleString()}
                  </div>
                )}
                <div className="text-[12px] text-emerald-600 font-semibold mt-2">
                  Comprar →
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Negocios pendientes de activación */}
      <section className="mt-7">
        <h2 className="text-sm font-bold text-gray-700 mb-2">
          Negocios pendientes de activación
        </h2>
        {pending.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
            No hay negocios pendientes. Todo al día ✅
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
            {pending.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 p-3.5 flex-wrap"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900 truncate">
                    {t.brandName}
                  </div>
                  <div className="text-[12px] text-gray-500">
                    {t.reason}
                    {t.overdueDays > 0 ? ` · hace ${t.overdueDays}d` : ''}
                  </div>
                </div>
                <button
                  disabled={activatingId === t.id || data.available < 1}
                  onClick={() => activate(t)}
                  className="text-[13px] font-semibold px-3 py-2 rounded-lg bg-gray-900 text-white hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed"
                  title={
                    data.available < 1
                      ? 'Sin créditos disponibles'
                      : 'Consume 1 crédito'
                  }
                >
                  {activatingId === t.id ? 'Activando…' : 'Activar · 1 crédito'}
                </button>
              </div>
            ))}
          </div>
        )}
        {data.available < 1 && pending.length > 0 && (
          <p className="text-[12px] text-amber-600 mt-2">
            No tienes créditos disponibles. Compra un pack arriba para activar.
          </p>
        )}
      </section>

      {/* Historial */}
      {data.history.length > 0 && (
        <section className="mt-7">
          <h2 className="text-sm font-bold text-gray-700 mb-2">
            Movimientos recientes
          </h2>
          <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
            {data.history.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between gap-3 p-3 text-sm"
              >
                <div className="min-w-0">
                  <span className="font-medium text-gray-800">
                    {TX_LABEL[tx.type]}
                  </span>
                  {tx.note && (
                    <span className="text-gray-500 ml-2 text-[12px]">
                      {tx.note}
                    </span>
                  )}
                  <div className="text-[11px] text-gray-400">
                    {new Date(tx.createdAt).toLocaleString()}
                  </div>
                </div>
                <span
                  className={`font-bold tabular-nums ${
                    tx.amount >= 0 ? 'text-emerald-600' : 'text-gray-700'
                  }`}
                >
                  {tx.amount >= 0 ? '+' : ''}
                  {tx.amount}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
