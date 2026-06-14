'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';

type Summary = {
  available: number;
  committed: number;
  usedMonth: number;
  usedYear: number;
  pendingTenants: number;
  committedRefreshedAt: string | null;
};

type WhiteLabelRow = {
  id: string;
  name: string;
  slug: string;
  initial: string | null;
  primaryColor: string;
  status: 'ACTIVE' | 'SUSPENDED';
  creditsAvailable: number;
  creditsCommitted: number;
  creditsUsed: number;
};

type HotmartLink = {
  id: string;
  credits: number;
  label: string;
  url: string;
  price: string | null;
  currency: string;
  position: number;
  isActive: boolean;
  hotmartProductId: string | null;
};

type Purchase = {
  id: string;
  transactionId: string;
  hotmartProductId: string;
  credits: number;
  buyerEmail: string;
  whiteLabelId: string | null;
  status: 'ASSIGNED' | 'UNASSIGNED' | 'REFUNDED';
  createdAt: string;
  assignedAt: string | null;
  creditLink: { label: string; credits: number } | null;
};

function fmt(n: number) {
  return n.toLocaleString('es-MX');
}

function fmtRelative(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `hace ${days}d`;
  return `el ${d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}`;
}

export default function CreditsCenterPage() {
  const [data, setData] = useState<{ summary: Summary; whiteLabels: WhiteLabelRow[] } | null>(null);
  const [links, setLinks] = useState<HotmartLink[]>([]);
  const [unassigned, setUnassigned] = useState<Purchase[]>([]);
  const [editLinksOpen, setEditLinksOpen] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<WhiteLabelRow | null>(null);
  const [assignTarget, setAssignTarget] = useState<Purchase | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  function flashToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  }

  async function refreshCommitted() {
    setRefreshing(true);
    try {
      const r = await api<{ whiteLabels: number; total: number }>(
        '/superadmin/credits/refresh-committed',
        { method: 'POST' },
      );
      await load();
      flashToast(`Recalculado: ${r.total} comprometidos en ${r.whiteLabels} marcas`);
    } catch (e: any) {
      flashToast(e?.message ?? 'Error al recalcular');
    } finally {
      setRefreshing(false);
    }
  }

  async function load() {
    try {
      const [center, lk, un] = await Promise.all([
        api<typeof data>('/superadmin/credits'),
        api<HotmartLink[]>('/superadmin/hotmart-links'),
        api<Purchase[]>('/superadmin/hotmart-purchases/unassigned'),
      ]);
      setData(center);
      setLinks(lk);
      setUnassigned(un);
    } catch (e: any) {
      console.error(e);
    }
  }
  useEffect(() => {
    load();
  }, []);

  if (!data) return <div className="text-sm" style={{ color: '#9aa4af' }}>Cargando…</div>;
  const s = data.summary;

  return (
    <div>
      <h1 className="m-0" style={{ fontSize: 26, fontWeight: 800, color: '#16241c', letterSpacing: -0.6 }}>
        Centro de Créditos
      </h1>
      <p className="text-sm mt-1 mb-5" style={{ color: '#6b7785' }}>
        1 crédito = 30 días de servicio · los créditos no vencen y son acumulativos
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
        <Stat label="Créditos Disponibles" value={fmt(s.available)} color="#16a34a" sub="en toda la red" />
        <Stat label="Comprometidos" value={fmt(s.committed)} color="#2563eb" sub="renovaciones próximas 30d" />
        <Stat label="Consumidos (mes)" value={fmt(s.usedMonth)} color="#16241c" sub={`${fmt(s.usedYear)} en el año`} />
        <Stat label="Pendientes" value={fmt(s.pendingTenants)} color="#b45309" sub="sin créditos suficientes" />
      </div>

      {unassigned.length > 0 && (
        <div
          className="rounded-[14px] p-4 mb-4 flex items-start gap-3"
          style={{ background: '#fefce8', border: '1px solid #fde68a' }}
        >
          <div
            className="w-10 h-10 rounded-[10px] flex items-center justify-center text-base shrink-0"
            style={{ background: '#fde68a', color: '#854d0e' }}
          >
            ⚠
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold" style={{ color: '#854d0e' }}>
              {unassigned.length} {unassigned.length === 1 ? 'compra' : 'compras'} Hotmart sin asignar
            </div>
            <div className="text-xs mt-0.5" style={{ color: '#a16207' }}>
              Llegaron por webhook pero el email del comprador no coincide con el adminEmail de ninguna marca. Asígnalas manualmente.
            </div>
            <div className="mt-3 space-y-1.5">
              {unassigned.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between text-xs px-3 py-2 rounded-[8px]"
                  style={{ background: 'white', border: '1px solid #fde68a' }}
                >
                  <div className="min-w-0">
                    <div className="font-semibold" style={{ color: '#16241c' }}>
                      {p.creditLink?.label ?? `Pack ${p.credits} créditos`} · {p.credits} créditos
                    </div>
                    <div className="truncate" style={{ color: '#6b7785' }}>
                      {p.buyerEmail} · tx={p.transactionId.slice(0, 16)}… · {fmtRelative(p.createdAt)}
                    </div>
                  </div>
                  <button
                    onClick={() => setAssignTarget(p)}
                    className="text-[11px] font-semibold shrink-0 ml-2"
                    style={{
                      padding: '6px 12px', borderRadius: 8, background: '#15803d', color: 'white', border: 'none',
                    }}
                  >
                    Asignar
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 mb-6 text-xs" style={{ color: '#9aa4af' }}>
        <span>
          {s.committedRefreshedAt
            ? `Comprometidos actualizado ${fmtRelative(s.committedRefreshedAt)}`
            : 'Comprometidos sin calcular aún'}
        </span>
        <button
          onClick={refreshCommitted}
          disabled={refreshing}
          className="text-xs font-semibold"
          style={{
            padding: '5px 11px', borderRadius: 8, background: 'white', color: '#16241c',
            border: '1px solid #d7dbe0', cursor: refreshing ? 'wait' : 'pointer',
          }}
        >
          {refreshing ? 'Recalculando…' : 'Recalcular'}
        </button>
      </div>

      <div className="grid lg:grid-cols-[1.3fr_1fr] gap-4">
        <div className="rounded-[14px]" style={{ background: 'white', border: '1px solid #e7e9ec', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}>
          <div className="px-5 py-4 border-b" style={{ borderColor: '#eef0f2' }}>
            <div className="text-[15px] font-bold" style={{ color: '#18221d' }}>
              Créditos por marca blanca
            </div>
          </div>
          <div className="p-2">
            {data.whiteLabels.map((w) => {
              const low = w.creditsAvailable < w.creditsCommitted;
              return (
                <button
                  key={w.id}
                  onClick={() => setAdjustTarget(w)}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-[10px] text-left transition"
                  style={{ background: 'transparent' }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#f7fbf8')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                >
                  <div
                    className="w-9 h-9 rounded-[10px] flex items-center justify-center text-white text-sm font-bold shrink-0"
                    style={{ background: w.primaryColor }}
                  >
                    {w.initial ?? w.name[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate" style={{ color: '#16241c' }}>
                      {w.name}
                    </div>
                    {low && (
                      <div className="text-[11px] font-semibold" style={{ color: '#b45309' }}>
                        ⚠ Bajo lo comprometido
                      </div>
                    )}
                  </div>
                  <div className="text-right text-sm shrink-0">
                    <div className="font-bold" style={{ color: low ? '#b45309' : '#16a34a' }}>
                      {w.creditsAvailable} <span style={{ color: '#6b7785', fontWeight: 500 }}>disp</span>
                    </div>
                    <div className="text-xs" style={{ color: '#6b7785' }}>
                      {w.creditsCommitted} comp
                    </div>
                  </div>
                </button>
              );
            })}
            {data.whiteLabels.length === 0 && (
              <p className="text-sm py-6 text-center" style={{ color: '#9aa4af' }}>
                Sin marcas blancas todavía.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-[14px]" style={{ background: 'white', border: '1px solid #e7e9ec', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}>
          <div className="px-5 py-4 border-b flex items-start justify-between gap-2" style={{ borderColor: '#eef0f2' }}>
            <div>
              <div className="text-[15px] font-bold" style={{ color: '#18221d' }}>
                Links de compra · Hotmart
              </div>
              <div className="text-xs" style={{ color: '#6b7785' }}>
                Cada compra es pago único, sin recurrencia.
              </div>
            </div>
            <button
              onClick={() => setEditLinksOpen(true)}
              className="text-xs font-semibold px-3 py-1.5 rounded-md"
              style={{ background: 'white', color: '#15803d', border: '1px solid #bbf7d0' }}
            >
              Editar links
            </button>
          </div>
          <div className="p-2">
            {links.length === 0 ? (
              <p className="text-sm py-6 text-center" style={{ color: '#9aa4af' }}>
                Sin links configurados. Toca "Editar links" para añadir el primero.
              </p>
            ) : (
              links.map((l) => (
                <div key={l.id} className="flex items-center gap-3 px-3 py-3 rounded-[10px]">
                  <div
                    className="w-12 h-12 rounded-[10px] flex flex-col items-center justify-center shrink-0"
                    style={{
                      background: '#f0fdf4',
                      border: '1px solid #bbf7d0',
                      color: '#15803d',
                    }}
                  >
                    <span className="text-base font-bold leading-none">{l.credits}</span>
                    <span className="text-[9px] font-bold opacity-70 mt-0.5">créd.</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate" style={{ color: '#16241c' }}>
                      {l.label}
                    </div>
                    <div className="text-[11px] font-mono truncate" style={{ color: '#6b7785' }}>
                      {l.url}
                    </div>
                  </div>
                  {l.price && (
                    <div className="text-sm font-bold shrink-0" style={{ color: '#16241c' }}>
                      ${Number(l.price).toLocaleString()} {l.currency}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {adjustTarget && (
        <AdjustCreditsModal
          target={adjustTarget}
          onClose={() => setAdjustTarget(null)}
          onSaved={(msg) => {
            setAdjustTarget(null);
            flashToast(msg);
            load();
          }}
        />
      )}

      {editLinksOpen && (
        <EditLinksModal
          links={links}
          onClose={() => setEditLinksOpen(false)}
          onChanged={() => {
            load();
          }}
        />
      )}

      {assignTarget && data && (
        <AssignPurchaseModal
          purchase={assignTarget}
          whiteLabels={data.whiteLabels}
          onClose={() => setAssignTarget(null)}
          onSaved={(msg) => {
            setAssignTarget(null);
            flashToast(msg);
            load();
          }}
        />
      )}

      {toast && (
        <div
          className="fixed left-1/2 bottom-7 -translate-x-1/2 px-4 py-2.5 rounded-[10px] text-sm font-semibold shadow-lg z-50"
          style={{ background: '#0f172a', color: 'white', boxShadow: '0 12px 30px rgba(0,0,0,.25)' }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color, sub }: { label: string; value: string; color: string; sub: string }) {
  return (
    <div
      className="rounded-[14px] p-5"
      style={{ background: 'white', border: '1px solid #e7e9ec', boxShadow: '0 1px 2px rgba(16,24,40,.04)' }}
    >
      <div className="text-[11.5px] font-bold uppercase" style={{ color, letterSpacing: 0.5 }}>
        {label}
      </div>
      <div className="m-0 mt-1" style={{ fontSize: 30, fontWeight: 800, letterSpacing: -1, color }}>
        {value}
      </div>
      <div className="text-xs mt-1" style={{ color: '#6b7785' }}>
        {sub}
      </div>
    </div>
  );
}

function AdjustCreditsModal({
  target,
  onClose,
  onSaved,
}: {
  target: WhiteLabelRow;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [amount, setAmount] = useState<number>(1);
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount || amount < 1) {
      setErr('Cantidad mayor a 0');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const finalAmount = direction === 'add' ? amount : -amount;
      await api('/superadmin/credits/adjust', {
        method: 'POST',
        body: JSON.stringify({
          whiteLabelId: target.id,
          amount: finalAmount,
          note,
        }),
      });
      onSaved(
        direction === 'add'
          ? `+${amount} créditos a ${target.name}`
          : `−${amount} créditos a ${target.name}`,
      );
    } catch (e: any) {
      setErr(e.message ?? 'Error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.4)' }}
      onClick={onClose}
    >
      <div
        className="rounded-[14px] p-6 w-full"
        style={{ maxWidth: 460, background: 'white', boxShadow: '0 24px 70px rgba(0,0,0,.28)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-2">
          <div
            className="w-10 h-10 rounded-[10px] flex items-center justify-center text-white font-bold"
            style={{ background: target.primaryColor }}
          >
            {target.initial ?? target.name[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="m-0" style={{ fontSize: 18, fontWeight: 800, color: '#16241c' }}>
              Ajustar créditos
            </h2>
            <div className="text-xs" style={{ color: '#6b7785' }}>
              {target.name} · disponibles actuales: <strong>{target.creditsAvailable}</strong>
            </div>
          </div>
          <button onClick={onClose} className="text-xl leading-none" style={{ color: '#9aa4af' }}>
            ×
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3 mt-3">
          <div className="flex gap-1 p-1 rounded-[10px]" style={{ background: '#f4f5f7' }}>
            <button
              type="button"
              onClick={() => setDirection('add')}
              className="flex-1 py-2 text-sm font-semibold rounded-md"
              style={{
                background: direction === 'add' ? 'white' : 'transparent',
                color: direction === 'add' ? '#15803d' : '#6b7785',
                boxShadow: direction === 'add' ? '0 1px 2px rgba(16,24,40,.04)' : 'none',
              }}
            >
              + Agregar
            </button>
            <button
              type="button"
              onClick={() => setDirection('remove')}
              className="flex-1 py-2 text-sm font-semibold rounded-md"
              style={{
                background: direction === 'remove' ? 'white' : 'transparent',
                color: direction === 'remove' ? '#b91c1c' : '#6b7785',
                boxShadow: direction === 'remove' ? '0 1px 2px rgba(16,24,40,.04)' : 'none',
              }}
            >
              − Descontar
            </button>
          </div>

          <div>
            <label className="block text-[11.5px] font-bold uppercase mb-1.5" style={{ letterSpacing: 0.5, color: '#6b7785' }}>
              Cantidad de créditos
            </label>
            <input
              type="number"
              min={1}
              required
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full text-sm"
              style={{ padding: '10px 12px', borderRadius: 9, border: '1px solid #d7dbe0' }}
            />
          </div>

          <div>
            <label className="block text-[11.5px] font-bold uppercase mb-1.5" style={{ letterSpacing: 0.5, color: '#6b7785' }}>
              Nota (opcional)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Ej. Compra Hotmart pack 10, ajuste manual, etc."
              className="w-full text-sm"
              style={{ padding: '10px 12px', borderRadius: 9, border: '1px solid #d7dbe0' }}
            />
          </div>

          {err && <div className="text-sm" style={{ color: '#b91c1c' }}>{err}</div>}

          <div className="flex gap-2 justify-end pt-3">
            <button
              type="button"
              onClick={onClose}
              className="text-sm font-semibold px-4 py-2.5 rounded-[10px]"
              style={{ background: 'white', color: '#2b3a30', border: '1px solid #d7dbe0' }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="text-sm font-bold px-5 py-2.5 rounded-[10px] text-white"
              style={{
                background:
                  direction === 'add'
                    ? 'linear-gradient(180deg, #28c95f, #16a34a)'
                    : 'linear-gradient(180deg, #ef4444, #b91c1c)',
                boxShadow: '0 2px 6px rgba(0,0,0,.15)',
              }}
            >
              {busy ? 'Guardando…' : direction === 'add' ? 'Agregar' : 'Descontar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AssignPurchaseModal({
  purchase,
  whiteLabels,
  onClose,
  onSaved,
}: {
  purchase: Purchase;
  whiteLabels: WhiteLabelRow[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [whiteLabelId, setWhiteLabelId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!whiteLabelId) return;
    setSaving(true);
    try {
      await api(`/superadmin/hotmart-purchases/${purchase.id}/assign`, {
        method: 'POST',
        body: JSON.stringify({ whiteLabelId }),
      });
      const wl = whiteLabels.find((w) => w.id === whiteLabelId);
      onSaved(`${purchase.credits} créditos asignados a ${wl?.name ?? 'la marca'}`);
    } catch (e: any) {
      alert('Error: ' + (e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,30,22,.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[16px] p-6"
        style={{ background: 'white', boxShadow: '0 20px 50px rgba(0,0,0,.25)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="m-0" style={{ fontSize: 18, fontWeight: 800, color: '#16241c' }}>
          Asignar compra Hotmart
        </h3>
        <p className="text-sm mt-1.5 mb-4" style={{ color: '#6b7785' }}>
          {purchase.credits} créditos · comprador {purchase.buyerEmail}
        </p>

        <label className="block mb-5">
          <div className="text-[11px] font-bold uppercase mb-1.5" style={{ letterSpacing: 0.6, color: '#6b7785' }}>
            Acreditar a la marca
          </div>
          <select
            value={whiteLabelId}
            onChange={(e) => setWhiteLabelId(e.target.value)}
            className="w-full"
            style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid #d7dbe0', fontSize: 13.5, outline: 'none', background: 'white' }}
            autoFocus
          >
            <option value="">— Elige una marca —</option>
            {whiteLabels.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.creditsAvailable} disp.)
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="text-sm font-semibold"
            style={{ padding: '9px 14px', borderRadius: 9, background: 'white', color: '#6b7785', border: '1px solid #d7dbe0' }}
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={!whiteLabelId || saving}
            className="text-sm font-semibold"
            style={{
              padding: '9px 18px',
              borderRadius: 9,
              background: !whiteLabelId ? '#cbd5d2' : '#15803d',
              color: 'white',
              border: 'none',
            }}
          >
            {saving ? 'Asignando…' : `Asignar +${purchase.credits}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditLinksModal({
  links,
  onClose,
  onChanged,
}: {
  links: HotmartLink[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<HotmartLink[]>(links);
  const [draft, setDraft] = useState({ credits: 1, label: '', url: '', price: '', currency: 'MXN', hotmartProductId: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRows(links);
  }, [links]);

  async function addRow(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.label.trim() || !draft.url.trim() || draft.credits < 1) return;
    setBusy(true);
    try {
      await api('/superadmin/hotmart-links', {
        method: 'POST',
        body: JSON.stringify({
          credits: draft.credits,
          label: draft.label,
          url: draft.url,
          price: draft.price ? Number(draft.price) : null,
          currency: draft.currency,
          hotmartProductId: draft.hotmartProductId.trim() || null,
        }),
      });
      setDraft({ credits: 1, label: '', url: '', price: '', currency: 'MXN', hotmartProductId: '' });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function updateProductId(id: string, value: string) {
    await api(`/superadmin/hotmart-links/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ hotmartProductId: value.trim() || null }),
    });
    onChanged();
  }

  async function remove(id: string) {
    if (!confirm('¿Eliminar este link?')) return;
    await api(`/superadmin/hotmart-links/${id}`, { method: 'DELETE' });
    onChanged();
  }

  async function toggleActive(l: HotmartLink) {
    await api(`/superadmin/hotmart-links/${l.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !l.isActive }),
    });
    onChanged();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.4)' }}
      onClick={onClose}
    >
      <div
        className="rounded-[14px] p-6 w-full"
        style={{ maxWidth: 620, background: 'white', boxShadow: '0 24px 70px rgba(0,0,0,.28)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="m-0" style={{ fontSize: 20, fontWeight: 800, color: '#16241c' }}>
            Editar links de Hotmart
          </h2>
          <button onClick={onClose} className="text-xl leading-none" style={{ color: '#9aa4af' }}>
            ×
          </button>
        </div>
        <p className="text-sm mt-1 mb-4" style={{ color: '#6b7785' }}>
          Links públicos de pago único de Hotmart, agrupados por cantidad de créditos.
        </p>

        <div className="space-y-2 mb-4">
          {rows.map((l) => (
            <div
              key={l.id}
              className="flex items-center gap-2 p-2 rounded-[10px]"
              style={{ background: l.isActive ? '#f7fbf8' : '#f4f5f7' }}
            >
              <span
                className="w-10 h-10 rounded-[10px] flex flex-col items-center justify-center text-[11px] font-bold shrink-0"
                style={{ background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' }}
              >
                <span className="text-sm leading-none">{l.credits}</span>
                <span className="text-[8px] mt-0.5 opacity-80">créd.</span>
              </span>
              <div className="flex-1 min-w-0 text-sm">
                <div className="font-semibold truncate" style={{ color: '#16241c' }}>
                  {l.label}
                </div>
                <div className="text-[11px] font-mono truncate" style={{ color: '#6b7785' }}>
                  {l.url}
                </div>
                <div className="text-[10px] mt-1 flex items-center gap-1.5" style={{ color: '#6b7785' }}>
                  <span style={{ color: '#9aa4af' }}>productId Hotmart:</span>
                  <input
                    defaultValue={l.hotmartProductId ?? ''}
                    onBlur={(e) => {
                      if ((e.target.value.trim() || null) !== (l.hotmartProductId ?? null)) {
                        updateProductId(l.id, e.target.value);
                      }
                    }}
                    placeholder="vacío = no auto-acredita"
                    className="text-[11px] font-mono"
                    style={{ padding: '2px 6px', borderRadius: 5, border: '1px solid #d7dbe0', width: 130 }}
                  />
                </div>
              </div>
              {l.price && (
                <div className="text-sm font-bold shrink-0" style={{ color: '#16241c' }}>
                  ${Number(l.price).toLocaleString()}
                </div>
              )}
              <button
                onClick={() => toggleActive(l)}
                className="text-xs font-semibold px-2 py-1 rounded shrink-0"
                style={{
                  background: l.isActive ? '#dcfce7' : '#fee2e2',
                  color: l.isActive ? '#15803d' : '#b91c1c',
                }}
              >
                {l.isActive ? 'ON' : 'OFF'}
              </button>
              <button
                onClick={() => remove(l.id)}
                className="text-mute text-xl leading-none px-2"
                style={{ color: '#9aa4af' }}
                title="Eliminar"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <form onSubmit={addRow} className="rounded-[10px] p-3 grid grid-cols-12 gap-2 items-end" style={{ background: '#f4f5f7' }}>
          <div className="col-span-2">
            <label className="block text-[10px] font-bold uppercase mb-1" style={{ color: '#6b7785' }}>
              Créditos
            </label>
            <input
              type="number"
              min={1}
              value={draft.credits}
              onChange={(e) => setDraft({ ...draft, credits: Number(e.target.value) })}
              className="w-full text-sm"
              style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #d7dbe0' }}
            />
          </div>
          <div className="col-span-4">
            <label className="block text-[10px] font-bold uppercase mb-1" style={{ color: '#6b7785' }}>
              Etiqueta
            </label>
            <input
              required
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder="1 crédito · mensual"
              className="w-full text-sm"
              style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #d7dbe0' }}
            />
          </div>
          <div className="col-span-4">
            <label className="block text-[10px] font-bold uppercase mb-1" style={{ color: '#6b7785' }}>
              URL Hotmart
            </label>
            <input
              required
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              placeholder="hotmart.com/cf-credito-1"
              className="w-full text-sm"
              style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #d7dbe0' }}
            />
          </div>
          <div className="col-span-2">
            <label className="block text-[10px] font-bold uppercase mb-1" style={{ color: '#6b7785' }}>
              Precio
            </label>
            <input
              type="number"
              min={0}
              value={draft.price}
              onChange={(e) => setDraft({ ...draft, price: e.target.value })}
              placeholder="$"
              className="w-full text-sm"
              style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #d7dbe0' }}
            />
          </div>
          <div className="col-span-12">
            <label className="block text-[10px] font-bold uppercase mb-1" style={{ color: '#6b7785' }}>
              productId Hotmart (opcional · habilita auto-acreditar)
            </label>
            <input
              value={draft.hotmartProductId}
              onChange={(e) => setDraft({ ...draft, hotmartProductId: e.target.value })}
              placeholder="ej: 1234567 — lo encontrás en el dashboard de Hotmart"
              className="w-full text-sm font-mono"
              style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #d7dbe0' }}
            />
          </div>
          <div className="col-span-12">
            <button
              type="submit"
              disabled={busy}
              className="w-full text-sm font-bold py-2 rounded-[8px] text-white"
              style={{
                background: 'linear-gradient(180deg, #28c95f, #16a34a)',
                boxShadow: '0 2px 6px rgba(22,163,74,.35)',
              }}
            >
              {busy ? 'Agregando…' : '+ Agregar link'}
            </button>
          </div>
        </form>

        <div className="flex justify-end mt-4">
          <button
            onClick={onClose}
            className="text-sm font-semibold px-4 py-2 rounded-[10px]"
            style={{ background: 'white', color: '#2b3a30', border: '1px solid #d7dbe0' }}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
