'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/Icon';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Order = {
  id: string;
  code: string;
  status: 'PENDING' | 'CONFIRMED' | 'READY' | 'DELIVERED' | 'CANCELLED';
  total: number;
  fulfillment: string;
  tableNumber: string | null;
  items: any[];
  createdAt: string;
  customerNote: string | null;
  tenant: {
    brandName: string;
    logoUrl: string | null;
    primaryColor: string;
    slug: string;
  };
  customer: { fullName: string; phone: string };
};

const STATUS_FLOW = ['PENDING', 'CONFIRMED', 'READY', 'DELIVERED'] as const;
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Enviado',
  CONFIRMED: 'Confirmado',
  READY: 'Listo',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
};

function fmt(n: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n);
}

export default function OrderStatus() {
  const { code } = useParams<{ code: string }>();
  const [order, setOrder] = useState<Order | null>(null);

  async function load() {
    const res = await fetch(`${API}/api/public/orders/${code}`);
    if (res.ok) setOrder(await res.json());
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [code]);

  if (!order) return <div className="p-8 text-mute text-center">Cargando…</div>;

  const idx = STATUS_FLOW.indexOf(order.status as any);
  const cancelled = order.status === 'CANCELLED';
  const primary = order.tenant.primaryColor;

  return (
    <div className="min-h-screen bg-bg pb-12">
      <div className="max-w-md mx-auto px-5 pt-8">
        <div className="text-center mb-6">
          <div
            className="w-16 h-16 rounded-full mx-auto flex items-center justify-center text-white text-3xl mb-3"
            style={{ background: cancelled ? '#DC2626' : primary }}
          >
            {cancelled ? '✕' : '✓'}
          </div>
          <h1 className="text-2xl font-bold">
            {cancelled ? 'Pedido cancelado' : `Pedido #${order.code}`}
          </h1>
          <p className="text-sm text-mute mt-1">
            {cancelled
              ? 'El negocio canceló este pedido.'
              : 'El negocio te confirmará en breve.'}
          </p>
        </div>

        {!cancelled && (
          <div className="card card-pad mb-4">
            <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-3">
              Estado
            </div>
            <div className="flex items-center justify-between">
              {STATUS_FLOW.map((s, i) => (
                <div key={s} className="flex-1 flex items-center">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-none"
                    style={{
                      background: i <= idx ? primary : '#E5E7EB',
                      color: i <= idx ? '#fff' : '#9CA3AF',
                    }}
                  >
                    {i + 1}
                  </div>
                  {i < STATUS_FLOW.length - 1 && (
                    <div
                      className="flex-1 h-0.5"
                      style={{
                        background: i < idx ? primary : '#E5E7EB',
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-mute mt-2">
              {STATUS_FLOW.map((s) => (
                <div key={s} className="flex-1 text-center">
                  {STATUS_LABEL[s]}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="card card-pad">
          <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-2">
            Tu pedido
          </div>
          <div className="space-y-1">
            {order.items.map((it: any, i: number) => (
              <div key={i} className="flex justify-between text-sm">
                <span>
                  {it.qty}x {it.name}
                </span>
                <span>{fmt(it.lineTotal)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-line2 mt-3 pt-3 flex justify-between font-semibold">
            <span>Total</span>
            <span>{fmt(Number(order.total))}</span>
          </div>
          {order.customerNote && (
            <div className="text-xs text-mute mt-3 italic">
              📝 {order.customerNote}
            </div>
          )}
        </div>

        <Link
          href={`/m/${order.tenant.slug}`}
          className="btn-ghost w-full justify-center mt-4"
        >
          ← Volver al menú
        </Link>
      </div>
    </div>
  );
}
