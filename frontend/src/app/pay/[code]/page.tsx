'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

type Order = {
  id: string;
  code: string;
  total: number;
  paymentStatus: string;
  paymentMethod: string;
  paymentRef: string | null;
  paymentProvider: string | null;
  tenant: { brandName: string; logoUrl: string | null; primaryColor: string };
  customer: { fullName: string };
};

function fmt(n: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n);
}

export default function StubPayPage() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const code = params.code as string;
  const ref = search.get('ref');
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState<'pay' | 'cancel' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const r = await fetch(`${API}/api/public/orders/${code}`);
    if (r.ok) setOrder(await r.json());
  }
  useEffect(() => {
    load();
  }, [code]);

  async function confirm(outcome: 'success' | 'cancel') {
    setBusy(outcome === 'success' ? 'pay' : 'cancel');
    setErr(null);
    try {
      const r = await fetch(`${API}/api/public/payments/stub/confirm/${code}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: ref, outcome }),
      });
      if (!r.ok) throw new Error(await r.text());
      router.replace(`/o/${code}?paid=${outcome === 'success' ? 1 : 0}`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  if (!order)
    return <div className="min-h-screen flex items-center justify-center text-mute">Cargando…</div>;

  const isPaid = order.paymentStatus === 'PAID';

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="card max-w-md w-full overflow-hidden">
        <div
          className="px-6 py-5 text-white"
          style={{
            background: `linear-gradient(135deg, ${
              order.tenant.primaryColor ?? '#6366F1'
            }, #C026D3)`,
          }}
        >
          <div className="text-xs opacity-80 uppercase tracking-widest mb-1">
            Simulador de pago · Modo demo
          </div>
          <div className="font-bold text-lg">{order.tenant.brandName}</div>
          <div className="text-sm opacity-90">Pedido #{order.code}</div>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-bg2 rounded-lg p-4 text-center">
            <div className="text-xs text-mute uppercase tracking-widest">
              Total a pagar
            </div>
            <div className="text-3xl font-bold mt-1">
              {fmt(Number(order.total))}
            </div>
            <div className="text-xs text-mute mt-1.5">
              Cliente: {order.customer.fullName}
            </div>
          </div>

          {isPaid && (
            <div className="rounded-lg bg-ok-soft text-ok-ink px-3 py-2.5 text-sm flex items-center gap-2">
              <Icon name="check" /> Este pedido ya fue pagado
            </div>
          )}

          {!isPaid && (
            <>
              <div className="text-xs text-mute leading-relaxed bg-warn-soft text-warn-ink rounded-lg px-3 py-2.5">
                <b>⚠ Esto es una pasarela simulada</b> — en producción se redirige a
                Stripe / Mercado Pago / Wompi. Selecciona <b>Pagar</b> para
                marcar el pedido como pagado y avisar al panel en tiempo real.
              </div>

              {err && (
                <div className="rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink">
                  {err}
                </div>
              )}

              <button
                className="btn-primary w-full justify-center text-base"
                disabled={busy !== null}
                onClick={() => confirm('success')}
              >
                {busy === 'pay' ? 'Procesando…' : `Pagar ${fmt(Number(order.total))}`}
              </button>

              <button
                className="btn-ghost w-full justify-center text-sm"
                disabled={busy !== null}
                onClick={() => confirm('cancel')}
              >
                Cancelar y volver
              </button>
            </>
          )}

          <div className="pt-3 border-t border-line text-[11px] text-mute text-center">
            Ref: <code>{ref ?? order.paymentRef ?? '—'}</code>
          </div>
        </div>
      </div>
    </div>
  );
}
