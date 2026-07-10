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
type Vehicle = {
  id: string;
  plate: string;
  driverName: string;
  driverPhone: string | null;
  isActive: boolean;
  createdAt: string;
};
type Delivery = {
  id: string;
  status: DeliveryStatus;
  courierName: string | null;
  courierPhone: string | null;
  courierPlate: string | null;
  etaMinutes: number | null;
  vehicleId: string | null;
  vehicle: {
    id: string;
    plate: string;
    driverName: string;
    driverPhone: string | null;
  } | null;
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
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  const loadVehicles = useCallback(async () => {
    try {
      setVehicles((await api<Vehicle[]>('/delivery-portal/vehicles')) ?? []);
    } catch {
      /* noop */
    }
  }, []);

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
    loadVehicles();
    const t = setInterval(load, 25000);
    return () => clearInterval(t);
  }, [load, loadVehicles]);

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

  async function addVehicle(v: {
    plate: string;
    driverName: string;
    driverPhone?: string;
  }) {
    await api('/delivery-portal/vehicles', {
      method: 'POST',
      body: JSON.stringify(v),
    });
    await loadVehicles();
  }
  async function toggleVehicle(id: string, isActive: boolean) {
    await api(`/delivery-portal/vehicles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    });
    await loadVehicles();
  }
  async function removeVehicle(id: string) {
    await api(`/delivery-portal/vehicles/${id}`, { method: 'DELETE' });
    await loadVehicles();
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

      {/* PDF245 P1: flota de motos de la empresa. */}
      <FleetSection
        vehicles={vehicles}
        onAdd={addVehicle}
        onToggle={toggleVehicle}
        onRemove={removeVehicle}
      />

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
                vehicles={vehicles.filter((v) => v.isActive)}
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
            vehicles={vehicles.filter((v) => v.isActive)}
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
  vehicles,
  busy,
  onClaim,
  onMove,
  onSave,
}: {
  d: Delivery;
  vehicles: Vehicle[];
  busy: boolean;
  onClaim: () => void;
  onMove: (to: DeliveryStatus) => void;
  onSave: (patch: Partial<Delivery>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [vehicleId, setVehicleId] = useState(d.vehicleId ?? '');
  const [address, setAddress] = useState(d.address ?? '');
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
              {open ? '▾ Ocultar asignación' : '▸ Asignar moto / tiempo de entrega'}
            </button>
          )}
          {open && (
            <div className="mt-2 space-y-2">
              <label className="block text-[11px] font-semibold" style={{ color: '#64748b' }}>
                Moto asignada
              </label>
              {vehicles.length === 0 ? (
                <div
                  className="text-[12px] rounded-[10px] px-3 py-2"
                  style={{ color: '#a16207', background: '#fef9c3' }}
                >
                  No tienes motos en tu flota. Agrégalas arriba en “🛵 Mi flota”.
                </div>
              ) : (
                <select
                  className={inp}
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                >
                  <option value="">— Elegir moto —</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.driverName} · {v.plate}
                    </option>
                  ))}
                </select>
              )}
              <label className="block text-[11px] font-semibold" style={{ color: '#64748b' }}>
                Tiempo estimado de entrega (min)
              </label>
              <input
                className={inp}
                type="number"
                placeholder="Ej. 25"
                value={eta}
                onChange={(e) => setEta(e.target.value)}
              />
              <input
                className={inp}
                placeholder="Dirección (opcional)"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
              <button
                onClick={() =>
                  onSave({
                    vehicleId: vehicleId || null,
                    address,
                    etaMinutes: eta.trim() === '' ? null : Number(eta),
                  } as any)
                }
                disabled={busy}
                className="w-full text-sm font-semibold rounded-[10px] py-2"
                style={{ background: '#f1f5f9', color: '#16241c', opacity: busy ? 0.6 : 1 }}
              >
                Guardar
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

function FleetSection({
  vehicles,
  onAdd,
  onToggle,
  onRemove,
}: {
  vehicles: Vehicle[];
  onAdd: (v: {
    plate: string;
    driverName: string;
    driverPhone?: string;
  }) => Promise<void>;
  onToggle: (id: string, isActive: boolean) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [plate, setPlate] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!plate.trim() || !driverName.trim()) {
      alert('Placa y conductor son obligatorios.');
      return;
    }
    setSaving(true);
    try {
      await onAdd({
        plate: plate.trim(),
        driverName: driverName.trim(),
        driverPhone: driverPhone.trim() || undefined,
      });
      setPlate('');
      setDriverName('');
      setDriverPhone('');
    } catch (e: any) {
      alert(e?.message ?? 'No se pudo agregar.');
    } finally {
      setSaving(false);
    }
  }

  const activeCount = vehicles.filter((v) => v.isActive).length;
  return (
    <section
      className="mb-4 rounded-[14px] p-4"
      style={{ background: 'white', border: '1px solid #e7e9ec' }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between"
      >
        <span className="font-bold text-[14px]" style={{ color: '#16241c' }}>
          🛵 Mi flota{' '}
          <span style={{ color: '#9aa4af', fontWeight: 500 }}>
            ({activeCount} {activeCount === 1 ? 'activa' : 'activas'})
          </span>
        </span>
        <span style={{ color: '#9aa4af' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <input
              className={inp}
              placeholder="Placa"
              value={plate}
              onChange={(e) => setPlate(e.target.value)}
            />
            <input
              className={inp}
              placeholder="Conductor"
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
            />
            <input
              className={inp}
              placeholder="Teléfono (opcional)"
              value={driverPhone}
              onChange={(e) => setDriverPhone(e.target.value)}
            />
          </div>
          <button
            onClick={add}
            disabled={saving}
            className="text-sm font-semibold text-white rounded-[10px] py-2 px-4"
            style={{ background: '#22c55e', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? '…' : '+ Agregar moto'}
          </button>
          {vehicles.length === 0 ? (
            <div className="text-[12.5px]" style={{ color: '#9aa4af' }}>
              Aún no tienes motos. Agrega la primera arriba.
            </div>
          ) : (
            <div className="space-y-1.5">
              {vehicles.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between gap-2 rounded-[10px] px-3 py-2"
                  style={{
                    background: v.isActive ? '#f8fafc' : '#f1f5f9',
                    opacity: v.isActive ? 1 : 0.55,
                  }}
                >
                  <div className="min-w-0">
                    <div
                      className="text-[13px] font-semibold"
                      style={{ color: '#16241c' }}
                    >
                      {v.driverName} · {v.plate}
                    </div>
                    {v.driverPhone && (
                      <div className="text-[11px]" style={{ color: '#6b7785' }}>
                        {v.driverPhone}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-[11px] font-semibold">
                    <button
                      onClick={() => onToggle(v.id, !v.isActive)}
                      style={{ color: '#0ea5e9' }}
                    >
                      {v.isActive ? 'Desactivar' : 'Activar'}
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('¿Quitar esta moto de la flota?')) onRemove(v.id);
                      }}
                      style={{ color: '#b91c1c' }}
                    >
                      Quitar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

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
