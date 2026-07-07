'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { DeliveryChat, type ChatMessage } from '@/components/DeliveryChat';
import { DirectChatList, type ChatPeer } from '@/components/DirectChatList';

type Order = {
  code: string;
  total: number | null;
  status: string;
  createdAt: string;
  customerName: string | null;
  customerPhone: string | null;
  businessName: string | null;
  businessSlug: string | null;
};
type Delivery = {
  id: string;
  status: DeliveryStatus;
  courierName: string | null;
  courierPhone: string | null;
  courierPlate: string | null;
  etaMinutes: number | null;
  address: string | null;
  deliveryValue: number | null;
  createdAt: string;
  claimable: boolean;
  order: Order | null;
};
type DeliveryStatus =
  | 'WAITING_COURIER'
  | 'COURIER_ASSIGNED'
  | 'PICKED_UP'
  | 'ON_THE_WAY'
  | 'DELIVERED'
  | 'CANCELLED';

const STATUS_LABEL: Record<DeliveryStatus, string> = {
  WAITING_COURIER: 'Esperando repartidor',
  COURIER_ASSIGNED: 'Moto asignada',
  PICKED_UP: 'Recogido',
  ON_THE_WAY: 'En camino',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
};
const STATUS_COLOR: Record<DeliveryStatus, { bg: string; fg: string }> = {
  WAITING_COURIER: { bg: '#fef9c3', fg: '#a16207' },
  COURIER_ASSIGNED: { bg: '#dbeafe', fg: '#1d4ed8' },
  PICKED_UP: { bg: '#e0e7ff', fg: '#4338ca' },
  ON_THE_WAY: { bg: '#cffafe', fg: '#0e7490' },
  DELIVERED: { bg: '#dcfce7', fg: '#15803d' },
  CANCELLED: { bg: '#fee2e2', fg: '#b91c1c' },
};
const NEXT: Partial<Record<DeliveryStatus, { to: DeliveryStatus; label: string }>> = {
  WAITING_COURIER: { to: 'COURIER_ASSIGNED', label: 'Asignar moto' },
  COURIER_ASSIGNED: { to: 'PICKED_UP', label: 'Marcar recogido' },
  PICKED_UP: { to: 'ON_THE_WAY', label: 'En camino' },
  ON_THE_WAY: { to: 'DELIVERED', label: 'Marcar entregado' },
};

type FilterKey = 'active' | 'delivered' | 'cancelled';

export default function DeliveryBoardPage() {
  const [mine, setMine] = useState<Delivery[]>([]);
  const [claimable, setClaimable] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('active');
  const [busy, setBusy] = useState<string | null>(null);
  const [stats, setStats] = useState<{
    activeCount: number;
    deliveredCount: number;
    commissionTotal: number;
    commissionPending: number;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ mine: Delivery[]; claimable: Delivery[] }>(
        '/delivery-portal/deliveries',
      );
      setMine(data?.mine ?? []);
      setClaimable(data?.claimable ?? []);
      api<typeof stats>('/delivery-portal/stats')
        .then((s) => s && setStats(s))
        .catch(() => null);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 25000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = useMemo(() => {
    return mine.filter((d) => {
      if (filter === 'delivered') return d.status === 'DELIVERED';
      if (filter === 'cancelled') return d.status === 'CANCELLED';
      return d.status !== 'DELIVERED' && d.status !== 'CANCELLED';
    });
  }, [mine, filter]);

  async function claim(id: string) {
    setBusy(id);
    try {
      await api(`/delivery-portal/deliveries/${id}/claim`, { method: 'POST' });
      await load();
    } catch (e: any) {
      alert(e?.message ?? 'No se pudo reclamar.');
    } finally {
      setBusy(null);
    }
  }

  async function move(id: string, to: DeliveryStatus) {
    setBusy(id);
    try {
      await api(`/delivery-portal/deliveries/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: to }),
      });
      await load();
    } catch (e: any) {
      alert(e?.message ?? 'No se pudo cambiar el estado.');
    } finally {
      setBusy(null);
    }
  }

  async function saveFields(id: string, patch: Partial<Delivery>) {
    setBusy(id);
    try {
      await api(`/delivery-portal/deliveries/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      await load();
    } catch (e: any) {
      alert(e?.message ?? 'No se pudo guardar.');
    } finally {
      setBusy(null);
    }
  }

  const fetchBusinessChats = useCallback(
    () =>
      api<
        Array<{
          tenantId: string;
          brandName: string;
          lastMessage: string | null;
          lastAt: string | null;
        }>
      >('/delivery-portal/business-chats').then((rs) =>
        (rs ?? []).map(
          (r): ChatPeer => ({
            id: r.tenantId,
            name: r.brandName,
            lastMessage: r.lastMessage,
            lastAt: r.lastAt,
          }),
        ),
      ),
    [],
  );

  return (
    <div>
      {stats && (
        <div className="grid grid-cols-4 gap-2 mb-4">
          <StatChip label="Activos" value={String(stats.activeCount)} />
          <StatChip label="Entregados" value={String(stats.deliveredCount)} />
          <StatChip label="Comisión" value={`$${stats.commissionTotal.toFixed(2)}`} />
          <StatChip label="Pendiente" value={`$${stats.commissionPending.toFixed(2)}`} />
        </div>
      )}

      {/* PDF 1254: chats directos por NEGOCIO (independiente de los pedidos). */}
      <DirectChatList
        fetchPeers={fetchBusinessChats}
        chatPath={(tenantId) => `/delivery-portal/business-chats/${tenantId}`}
        meRole="COMPANY"
        title="💬 Chats por negocio"
        emptyText="Aún no tienes negocios asignados para chatear."
      />

      {claimable.length > 0 && (
        <section className="mb-5">
          <h2 className="text-[13px] font-bold uppercase mb-2" style={{ color: '#a16207', letterSpacing: 0.5 }}>
            🆕 Disponibles para recoger ({claimable.length})
          </h2>
          <div className="space-y-3">
            {claimable.map((d) => (
              <DeliveryCard
                key={d.id}
                d={d}
                busy={busy === d.id}
                onClaim={() => claim(d.id)}
                onMove={() => {}}
                onSave={() => {}}
              />
            ))}
          </div>
        </section>
      )}

      <div className="flex gap-2 mb-3">
        {(
          [
            ['active', 'Activos'],
            ['delivered', 'Entregados'],
            ['cancelled', 'Cancelados'],
          ] as [FilterKey, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className="text-[13px] font-semibold rounded-full px-3.5 py-1.5"
            style={
              filter === k
                ? { background: '#0ea5e9', color: 'white' }
                : { background: 'white', color: '#475569', border: '1px solid #e2e8f0' }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {loading && <div className="text-sm" style={{ color: '#9aa4af' }}>Cargando…</div>}
      {!loading && filtered.length === 0 && (
        <div
          className="rounded-[14px] p-8 text-center text-sm"
          style={{ background: 'white', border: '1px dashed #d8dce0', color: '#9aa4af' }}
        >
          No hay domicilios en esta vista.
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((d) => (
          <DeliveryCard
            key={d.id}
            d={d}
            busy={busy === d.id}
            onClaim={() => {}}
            onMove={(to) => move(d.id, to)}
            onSave={(patch) => saveFields(d.id, patch)}
          />
        ))}
      </div>
    </div>
  );
}

function DeliveryCard({
  d,
  busy,
  onClaim,
  onMove,
  onSave,
}: {
  d: Delivery;
  busy: boolean;
  onClaim: () => void;
  onMove: (to: DeliveryStatus) => void;
  onSave: (patch: Partial<Delivery>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [courierName, setCourierName] = useState(d.courierName ?? '');
  const [courierPhone, setCourierPhone] = useState(d.courierPhone ?? '');
  const [courierPlate, setCourierPlate] = useState(d.courierPlate ?? '');
  const [address, setAddress] = useState(d.address ?? '');
  const [price, setPrice] = useState(d.deliveryValue == null ? '' : String(d.deliveryValue));
  const [eta, setEta] = useState(d.etaMinutes == null ? '' : String(d.etaMinutes));

  const sc = STATUS_COLOR[d.status];
  const next = NEXT[d.status];
  const o = d.order;

  return (
    <div
      className="rounded-[14px] p-4"
      style={{ background: 'white', border: '1px solid #e7e9ec', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-bold text-[15px]" style={{ color: '#16241c' }}>
            {o?.businessName ?? 'Negocio'} · #{o?.code ?? '—'}
          </div>
          <div className="text-[12.5px] mt-0.5" style={{ color: '#6b7785' }}>
            {o?.customerName ?? '—'}
            {o?.customerPhone ? ` · ${o.customerPhone}` : ''}
          </div>
        </div>
        <span
          className="text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0"
          style={{ background: sc.bg, color: sc.fg }}
        >
          {STATUS_LABEL[d.status]}
        </span>
      </div>

      <div className="mt-2 text-[13px]" style={{ color: '#334155' }}>
        📍 {d.address || '—'}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[12.5px]" style={{ color: '#6b7785' }}>
        {o?.total != null && <span>🧾 Pedido: ${o.total.toFixed(2)}</span>}
        {d.deliveryValue != null && <span>💵 Domicilio: ${d.deliveryValue.toFixed(2)}</span>}
        {d.courierName && <span>🛵 {d.courierName}{d.courierPlate ? ` (${d.courierPlate})` : ''}</span>}
        {d.etaMinutes != null && <span>⏱️ {d.etaMinutes} min</span>}
      </div>

      {/* Reclamable */}
      {d.claimable ? (
        <button
          onClick={onClaim}
          disabled={busy}
          className="mt-3 w-full text-sm font-semibold text-white rounded-[10px] py-2.5"
          style={{ background: '#22c55e', opacity: busy ? 0.6 : 1 }}
        >
          {busy ? '…' : 'Tomar este domicilio'}
        </button>
      ) : (
        <>
          {/* Datos del repartidor */}
          {d.status !== 'DELIVERED' && d.status !== 'CANCELLED' && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="mt-3 text-[13px] font-semibold"
              style={{ color: '#0ea5e9' }}
            >
              {open ? '▾ Ocultar datos del repartidor' : '▸ Datos del repartidor / precio'}
            </button>
          )}
          {open && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input className={inp} placeholder="Nombre repartidor" value={courierName} onChange={(e) => setCourierName(e.target.value)} />
              <input className={inp} placeholder="Teléfono" value={courierPhone} onChange={(e) => setCourierPhone(e.target.value)} />
              <input className={inp} placeholder="Placa" value={courierPlate} onChange={(e) => setCourierPlate(e.target.value)} />
              <input className={inp} placeholder="ETA (min)" type="number" value={eta} onChange={(e) => setEta(e.target.value)} />
              <input className={inp + ' col-span-2'} placeholder="Dirección" value={address} onChange={(e) => setAddress(e.target.value)} />
              <input className={inp + ' col-span-2'} placeholder="Precio del domicilio (USD)" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
              <button
                onClick={() =>
                  onSave({
                    courierName,
                    courierPhone,
                    courierPlate,
                    address,
                    deliveryValue: price.trim() === '' ? null : Number(price),
                    etaMinutes: eta.trim() === '' ? null : Number(eta),
                  } as any)
                }
                disabled={busy}
                className="col-span-2 text-sm font-semibold rounded-[10px] py-2"
                style={{ background: '#f1f5f9', color: '#16241c', opacity: busy ? 0.6 : 1 }}
              >
                Guardar datos
              </button>
            </div>
          )}

          {/* Avanzar estado */}
          {(next || (d.status !== 'DELIVERED' && d.status !== 'CANCELLED')) && (
            <div className="mt-3 flex gap-2">
              {next && (
                <button
                  onClick={() => onMove(next.to)}
                  disabled={busy}
                  className="flex-1 text-sm font-semibold text-white rounded-[10px] py-2.5"
                  style={{ background: '#0ea5e9', opacity: busy ? 0.6 : 1 }}
                >
                  {next.label}
                </button>
              )}
              {d.status !== 'DELIVERED' && d.status !== 'CANCELLED' && (
                <button
                  onClick={() => {
                    if (confirm('¿Cancelar este domicilio?')) onMove('CANCELLED');
                  }}
                  disabled={busy}
                  className="text-sm font-semibold rounded-[10px] py-2.5 px-3"
                  style={{ background: '#fef2f2', color: '#ef4444', opacity: busy ? 0.6 : 1 }}
                >
                  Cancelar
                </button>
              )}
            </div>
          )}

          {/* Chat con el cliente y el negocio */}
          <button
            onClick={() => setChatOpen((v) => !v)}
            className="mt-3 text-[13px] font-semibold"
            style={{ color: '#0ea5e9' }}
          >
            {chatOpen ? '▾ Ocultar chat' : '💬 Chat con cliente / negocio'}
          </button>
          {chatOpen && (
            <div className="mt-2">
              <DeliveryChat
                meRole="COMPANY"
                primary="#0ea5e9"
                heightPx={260}
                load={() => api<ChatMessage[]>(`/delivery-portal/deliveries/${d.id}/chat`)}
                send={(body) =>
                  api<ChatMessage[]>(`/delivery-portal/deliveries/${d.id}/chat`, {
                    method: 'POST',
                    body: JSON.stringify({ body }),
                  })
                }
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

const inp =
  'w-full rounded-[10px] px-3 py-2.5 text-sm outline-none border border-[#dfe3e8] focus:border-[#0ea5e9] bg-white';

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-[12px] p-3 text-center"
      style={{ background: 'white', border: '1px solid #e7e9ec' }}
    >
      <div className="text-[15px] font-bold" style={{ color: '#16241c' }}>
        {value}
      </div>
      <div
        className="text-[10px] uppercase font-semibold mt-0.5"
        style={{ color: '#9aa4af', letterSpacing: 0.3 }}
      >
        {label}
      </div>
    </div>
  );
}
