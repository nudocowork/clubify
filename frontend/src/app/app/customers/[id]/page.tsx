'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

type Pass = {
  id: string;
  serialNumber: string;
  stampsCount: number;
  pointsBalance: number;
  status: string;
  createdAt: string;
  card: { name: string; type: string; stampsRequired: number | null };
};

type Stamp = {
  id: string;
  action: string;
  amount: number;
  note: string | null;
  createdAt: string;
};

type Order = {
  id: string;
  code: string;
  status: string;
  total: number;
  paymentStatus: string;
  fulfillment: string;
  createdAt: string;
};

type Customer = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  tags: string[];
  notes: string | null;
  marketingOptIn: boolean;
  whatsappVerified: boolean;
  totalOrdersCount: number;
  totalOrdersAmount: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  createdAt: string;
  passes: Pass[];
  stamps: Stamp[];
  orders: Order[];
};

const PAYMENT_LABEL: Record<string, string> = {
  PAID: 'Pagado',
  PENDING: 'Pendiente',
  FAILED: 'Falló',
  REFUNDED: 'Reembolsado',
  NOT_REQUIRED: 'No req.',
};
const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmado',
  READY: 'Listo',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
};
const PASS_STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Activa',
  COMPLETED: 'Completada',
  EXPIRED: 'Expirada',
  REVOKED: 'Revocada',
};

const COP = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n);

function avatarClass(seed: string) {
  const sum = seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return `avatar-${(sum % 7) + 1}`;
}
function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}
function fmtDate(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function PassRow({ pass: p, onChange }: { pass: Pass; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const required = p.card.stampsRequired ?? 10;
  const stamps = p.card.type === 'STAMPS' ? p.stampsCount : 0;
  const remaining = Math.max(0, required - stamps);
  const pct = p.card.type === 'STAMPS' ? Math.min(100, (stamps / required) * 100) : 0;
  const canRedeem = p.card.type === 'STAMPS' && stamps >= required;

  async function addStamp() {
    // Fix 2026-06-10: el backend exige `purchaseAmount` para STAMPS/
    // VISITS/HYBRID (regla anti-fraude) salvo SUPER_ADMIN. Sin esto el
    // panel devolvía "Monto de compra requerido para registrar el
    // sello" y el botón parecía "no funcionar". Ahora preguntamos el
    // monto al staff antes del POST.
    const raw = window.prompt(
      'Monto de la compra (en $) para registrar el sello:',
      '',
    );
    if (raw === null) return; // cancelado
    const purchaseAmount = Number(raw.replace(',', '.'));
    if (!Number.isFinite(purchaseAmount) || purchaseAmount <= 0) {
      toast('Monto inválido — debe ser un número mayor a 0', 'error');
      return;
    }
    setBusy(true);
    try {
      await api('/stamps', {
        method: 'POST',
        body: JSON.stringify({
          passId: p.id,
          action: 'STAMP',
          amount: 1,
          purchaseAmount,
        }),
      });
      toast('Sello agregado', 'success');
      onChange();
    } catch (e: any) {
      toast(e.message || 'No se pudo agregar el sello', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function redeem() {
    if (!confirm(`¿Canjear premio? Esto resetea los sellos a 0.`)) return;
    setBusy(true);
    try {
      await api('/stamps', {
        method: 'POST',
        body: JSON.stringify({
          passId: p.id,
          action: 'REDEEM',
          note: 'Canje desde panel',
        }),
      });
      toast('🎁 Premio canjeado', 'success');
      onChange();
    } catch (e: any) {
      toast(e.message || 'No se pudo canjear', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function refreshWallet() {
    setBusy(true);
    try {
      const r = await api<{
        sent: number;
        skipped: number;
        error?: string;
        google?: { ok: boolean; status: string; error?: string };
      }>(`/passes/${p.id}/push-update`, { method: 'POST' });
      if (r.error === 'pass_not_found') {
        toast('Pase no encontrado', 'error');
        return;
      }
      const apple =
        r.sent > 0
          ? `Apple: ${r.sent} dispositivo${r.sent === 1 ? '' : 's'}`
          : r.skipped > 0
            ? `Apple: ${r.skipped} fallidos`
            : 'Apple: no instalado';
      const g = r.google;
      let google = 'Google: no instalado';
      if (g) {
        if (g.status === 'patched') google = 'Google: actualizado';
        else if (g.status === 'not_saved_to_google_wallet') google = 'Google: no instalado';
        else if (g.status === 'object_not_found') google = 'Google: pase no encontrado en Google';
        else if (g.status === 'api_disabled')
          google = 'Google: API deshabilitada (habilitar en Google Cloud)';
        else if (g.status === 'not_configured') google = 'Google: no configurado';
        else if (g.status === 'pass_not_found') google = 'Google: pase no encontrado';
        else google = `Google: ${g.error ?? g.status}`;
      }
      const ok = r.sent > 0 || g?.ok;
      toast(`${apple} · ${google}`, ok ? 'success' : 'info');
    } catch (e: any) {
      toast(e.message || 'No se pudo refrescar', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-line2 rounded-xl p-3.5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm">{p.card.name}</div>
          <div className="text-[11px] text-mute font-mono mt-0.5">
            {p.serialNumber}
          </div>
        </div>
        <span
          className={`badge text-[10px] ${
            p.status === 'ACTIVE'
              ? 'badge-ok'
              : p.status === 'COMPLETED'
              ? 'badge-info'
              : 'badge-mute'
          }`}
        >
          {PASS_STATUS_LABEL[p.status] ?? p.status}
        </span>
      </div>

      {p.card.type === 'STAMPS' && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-mute">
              {stamps}/{required} sellos
            </span>
            <span
              className={
                remaining === 0
                  ? 'text-ok font-semibold'
                  : 'text-mute'
              }
            >
              {remaining === 0
                ? '🎁 Premio listo para canjear'
                : `Le faltan ${remaining} para premio`}
            </span>
          </div>
          <div className="h-1.5 bg-bg2 rounded-full overflow-hidden mb-2.5">
            <div
              className="h-full bg-gradient-to-r from-brand-400 to-brand-700 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: required }).map((_, i) => (
              <span
                key={i}
                className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
                style={{
                  background: i < stamps ? '#22C55E' : '#fff',
                  color: i < stamps ? '#fff' : '#9CA3AF',
                  border:
                    '1.5px solid ' + (i < stamps ? '#22C55E' : '#E5E7EB'),
                }}
              >
                {i + 1}
              </span>
            ))}
          </div>

          {p.status === 'ACTIVE' && (
            <div className="flex gap-2 mt-3">
              <button
                onClick={addStamp}
                disabled={busy || canRedeem}
                className="flex-1 btn-ghost text-xs justify-center disabled:opacity-50"
                title={canRedeem ? 'Canjea primero el premio' : 'Sumar 1 sello'}
              >
                + Sumar sello
              </button>
              <button
                onClick={redeem}
                disabled={busy || !canRedeem}
                className={`flex-1 text-xs justify-center font-semibold rounded-pill px-3 py-2 inline-flex items-center gap-1.5 ${
                  canRedeem
                    ? 'bg-ok text-white hover:bg-ok/90'
                    : 'bg-bg2 text-mute cursor-not-allowed'
                }`}
                title={canRedeem ? 'Canjear premio' : 'Aún no completa los sellos'}
              >
                🎁 Canjear
              </button>
            </div>
          )}
        </div>
      )}

      {p.card.type === 'POINTS' && (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-mute">Saldo</span>
          <span className="font-bold text-lg">{p.pointsBalance} puntos</span>
        </div>
      )}

      <div className="mt-3 pt-2.5 border-t border-line2/60 flex flex-wrap items-center gap-3">
        <button
          onClick={refreshWallet}
          disabled={busy}
          className="text-[11px] text-mute hover:text-ink disabled:opacity-50 inline-flex items-center gap-1"
          title="Manda un silent push para forzar a Apple/Google Wallet a actualizar el pase ya instalado"
        >
          🔄 Refrescar Apple/Google Wallet
        </button>
        <button
          onClick={async () => {
            try {
              const r = await api(`/passes/${p.id}/google-object`);
              const blob = new Blob([JSON.stringify(r, null, 2)], {
                type: 'application/json',
              });
              const url = URL.createObjectURL(blob);
              window.open(url, '_blank');
            } catch (e: any) {
              toast(e.message || 'No se pudo obtener', 'error');
            }
          }}
          className="text-[11px] text-mute hover:text-ink inline-flex items-center gap-1"
          title="Ver el LoyaltyObject crudo guardado en Google Wallet"
        >
          🔍 Ver Google Object
        </button>
      </div>
    </div>
  );
}

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [c, setC] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    try {
      setC(await api<Customer>(`/customers/${id}`));
    } catch (e: any) {
      toast(e.message || 'Error cargando cliente', 'error');
    }
  }
  useEffect(() => {
    load();
  }, [id]);

  async function deleteCustomer() {
    if (!c) return;
    const msg = `¿Eliminar a ${c.fullName}?\n\nEsta acción NO se puede deshacer y borra:\n• Tarjeta wallet del cliente\n• Sellos / saldo / nivel VIP\n• Historial de pedidos (${c.totalOrdersCount})\n• Mensajes asociados\n\nEscribe ELIMINAR para confirmar.`;
    const confirmText = window.prompt(msg);
    if ((confirmText ?? '').trim().toUpperCase() !== 'ELIMINAR') return;
    setDeleting(true);
    try {
      await api(`/customers/${id}`, { method: 'DELETE' });
      toast('Cliente eliminado', 'success');
      router.push('/app/customers');
    } catch (e: any) {
      toast(e.message || 'No se pudo eliminar', 'error');
      setDeleting(false);
    }
  }

  if (!c) return <div className="text-mute">Cargando…</div>;

  const lifetimeAvg =
    c.totalOrdersCount > 0
      ? Number(c.totalOrdersAmount) / c.totalOrdersCount
      : 0;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          <Link href="/app/customers" className="text-mute hover:text-ink">
            Clientes
          </Link>{' '}
          <span className="page-crumb">/ {c.fullName}</span>
        </h1>
        <div className="flex gap-2">
          {c.phone && (
            <a
              className="btn-primary"
              href={`https://wa.me/${c.phone.replace(/\D/g, '')}`}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="send" /> WhatsApp
            </a>
          )}
          <button
            onClick={deleteCustomer}
            disabled={deleting}
            className="bg-bad text-white text-sm font-semibold px-4 py-2 rounded-pill inline-flex items-center gap-1.5 hover:bg-bad/90 disabled:opacity-50"
            title="Eliminar cliente y todo su historial"
          >
            <Icon name="trash" size={14} />
            {deleting ? 'Eliminando…' : 'Eliminar'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Sidebar perfil */}
        <div className="space-y-4">
          <div className="card card-pad text-center">
            <div
              className={`avatar mx-auto w-20 h-20 text-2xl ${avatarClass(c.fullName)}`}
            >
              {initials(c.fullName)}
            </div>
            <div className="font-semibold text-lg mt-3">{c.fullName}</div>
            {c.phone && <div className="text-sm text-mute">{c.phone}</div>}
            {c.email && <div className="text-xs text-mute">{c.email}</div>}
            <div className="flex gap-1 justify-center flex-wrap mt-3">
              {c.whatsappVerified && (
                <span className="badge badge-ok text-[10px]">WA verif.</span>
              )}
              {c.marketingOptIn && (
                <span className="badge badge-info text-[10px]">Marketing OK</span>
              )}
            </div>
          </div>

          <div className="card card-pad">
            <div className="text-[10px] uppercase tracking-[0.18em] text-mute font-semibold mb-3">
              Lifetime value
            </div>
            <div className="grid grid-cols-2 gap-3 text-center">
              <div>
                <div className="text-2xl font-bold">{c.totalOrdersCount}</div>
                <div className="text-xs text-mute">pedidos</div>
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {COP(Number(c.totalOrdersAmount))}
                </div>
                <div className="text-xs text-mute">facturado</div>
              </div>
              <div>
                <div className="text-base font-semibold">{COP(lifetimeAvg)}</div>
                <div className="text-xs text-mute">ticket promedio</div>
              </div>
              <div>
                <div className="text-base font-semibold">
                  {c.passes.length}
                </div>
                <div className="text-xs text-mute">pases activos</div>
              </div>
            </div>
          </div>

          <CustomerNotesAndTags customer={c} onChange={load} />

          <div className="card card-pad text-sm">
            <div className="text-[10px] uppercase tracking-[0.18em] text-mute font-semibold mb-2">
              Datos
            </div>
            <div className="flex justify-between py-1 border-b border-line2">
              <span className="text-mute">Cliente desde</span>
              <span>{fmtDate(c.createdAt)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-line2">
              <span className="text-mute">Primer pedido</span>
              <span>{fmtDate(c.firstOrderAt)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-line2">
              <span className="text-mute">Último pedido</span>
              <span>{fmtDate(c.lastOrderAt)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-mute">Cumpleaños</span>
              <span>{fmtDate(c.birthday)}</span>
            </div>
          </div>

          <MergeIntoThisCustomer customer={c} onMerged={load} />
        </div>

        <div className="space-y-4">
          {/* Tarjetas */}
          {c.passes.length > 0 && (
            <div className="card card-pad">
              <h3 className="font-semibold mb-3">
                Tarjetas de fidelización ({c.passes.length})
              </h3>
              <div className="grid gap-3">
                {c.passes.map((p) => (
                  <PassRow key={p.id} pass={p} onChange={load} />
                ))}
              </div>
            </div>
          )}

          {/* Pedidos */}
          <div className="card overflow-hidden">
            <div className="card-h">
              <h3>Historial de pedidos ({c.orders.length})</h3>
            </div>
            {c.orders.length === 0 ? (
              <div className="p-6 text-center text-mute text-sm">
                Aún no ha hecho pedidos
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-bg2">
                  <tr>
                    {['#', 'Fecha', 'Tipo', 'Pago', 'Estado', 'Total'].map(
                      (h) => (
                        <th
                          key={h}
                          className="text-left px-4 py-2.5 text-[11px] uppercase tracking-[0.1em] text-mute font-semibold"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {c.orders.map((o) => (
                    <tr key={o.id} className="border-t border-line2">
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/app/orders/${o.id}`}
                          className="text-brand hover:underline font-medium"
                        >
                          #{o.code}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-mute text-xs">
                        {fmtDate(o.createdAt)}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {o.fulfillment === 'PICKUP'
                          ? '🥡'
                          : o.fulfillment === 'DINE_IN'
                          ? '🍽'
                          : '🛵'}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`badge text-[10px] ${
                            o.paymentStatus === 'PAID'
                              ? 'badge-ok'
                              : o.paymentStatus === 'PENDING'
                              ? 'badge-warn'
                              : 'badge-mute'
                          }`}
                        >
                          {PAYMENT_LABEL[o.paymentStatus] ?? o.paymentStatus}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`badge text-[10px] ${
                            o.status === 'DELIVERED'
                              ? 'badge-ok'
                              : o.status === 'CANCELLED'
                              ? 'bg-bad-soft text-bad-ink'
                              : 'badge-info'
                          }`}
                        >
                          {ORDER_STATUS_LABEL[o.status] ?? o.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-medium">
                        {COP(Number(o.total))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Reservas */}
          <ReservationsSection customerId={id} />

          {/* Sellos */}
          {c.stamps.length > 0 && (
            <div className="card card-pad">
              <h3 className="font-semibold mb-3">
                Actividad de sellos ({c.stamps.length})
              </h3>
              <div className="space-y-1.5 text-sm">
                {c.stamps.slice(0, 15).map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between py-1.5 border-b border-line2 last:border-0"
                  >
                    <div>
                      <span className="font-medium">{s.action}</span>
                      {s.note && (
                        <span className="text-xs text-mute ml-2">
                          {s.note}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-mute">
                      <span className="font-medium text-ink">
                        {Number(s.amount) > 0 ? '+' : ''}
                        {Number(s.amount)}
                      </span>
                      <span>{fmtDate(s.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const TAG_PRESETS = ['VIP', 'Vegano', 'Sin gluten', 'Cumple este mes', 'Reseña 5⭐', 'Bloqueado'];

function CustomerNotesAndTags({
  customer,
  onChange,
}: {
  customer: Customer;
  onChange: () => void;
}) {
  const [tags, setTags] = useState<string[]>(customer.tags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [notes, setNotes] = useState(customer.notes ?? '');
  const [savingTags, setSavingTags] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesDirty, setNotesDirty] = useState(false);

  async function persistTags(next: string[]) {
    setSavingTags(true);
    try {
      await api(`/customers/${customer.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ tags: next }),
      });
      onChange();
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar tags', 'error');
    } finally {
      setSavingTags(false);
    }
  }

  function addTag(val: string) {
    const t = val.trim();
    if (!t || tags.includes(t)) return;
    const next = [...tags, t];
    setTags(next);
    setTagInput('');
    persistTags(next);
  }

  function removeTag(t: string) {
    const next = tags.filter((x) => x !== t);
    setTags(next);
    persistTags(next);
  }

  async function saveNotes() {
    if (!notesDirty) return;
    setSavingNotes(true);
    try {
      await api(`/customers/${customer.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ notes }),
      });
      setNotesDirty(false);
      toast('Notas guardadas', 'success');
      onChange();
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar', 'error');
    } finally {
      setSavingNotes(false);
    }
  }

  const presetsAvailable = TAG_PRESETS.filter((p) => !tags.includes(p));

  return (
    <div className="card card-pad">
      <div className="text-[10px] uppercase tracking-[0.18em] text-mute font-semibold mb-2">
        Tags
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {tags.length === 0 && (
          <span className="text-xs text-mute italic">Sin tags todavía</span>
        )}
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 bg-brand-soft text-brand-700 text-[11px] font-medium px-2 py-1 rounded-full"
          >
            {t}
            <button
              type="button"
              onClick={() => removeTag(t)}
              className="hover:text-bad"
              aria-label={`Quitar tag ${t}`}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTag(tagInput);
            }
          }}
          placeholder="Nuevo tag…"
          maxLength={30}
          className="input text-xs flex-1"
          disabled={savingTags}
        />
        <button
          type="button"
          onClick={() => addTag(tagInput)}
          disabled={!tagInput.trim() || savingTags}
          className="btn-ghost text-xs disabled:opacity-50"
        >
          + Agregar
        </button>
      </div>
      {presetsAvailable.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {presetsAvailable.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => addTag(p)}
              disabled={savingTags}
              className="text-[10px] text-mute hover:text-brand border border-line2 hover:border-brand/40 rounded-full px-2 py-0.5"
            >
              + {p}
            </button>
          ))}
        </div>
      )}

      <div className="text-[10px] uppercase tracking-[0.18em] text-mute font-semibold mt-5 mb-2 flex items-center justify-between">
        <span>Notas internas</span>
        {notesDirty && (
          <span className="text-amber-600 text-[10px] normal-case font-normal tracking-normal">
            sin guardar
          </span>
        )}
      </div>
      <textarea
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setNotesDirty(true);
        }}
        onBlur={saveNotes}
        placeholder="Ej: alérgico a maní, prefiere bebidas sin azúcar…"
        className="input text-sm min-h-[70px] resize-y"
        maxLength={500}
      />
      <div className="text-[10px] text-mute mt-1 flex items-center justify-between">
        <span>Solo tu equipo ve estas notas. Se guardan al salir del campo.</span>
        <span>{notes.length}/500</span>
      </div>
      {notesDirty && (
        <button
          type="button"
          onClick={saveNotes}
          disabled={savingNotes}
          className="btn-primary text-xs mt-2"
        >
          {savingNotes ? 'Guardando…' : 'Guardar nota'}
        </button>
      )}
    </div>
  );
}

// ===== Fusión manual =====

type MergeCandidate = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  totalOrdersCount: number;
  _count?: { passes: number; orders: number };
};

function MergeIntoThisCustomer({
  customer,
  onMerged,
}: {
  customer: Customer;
  onMerged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<MergeCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<MergeCandidate | null>(null);
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (search.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const list: MergeCandidate[] = await api(
          `/customers?search=${encodeURIComponent(search)}`,
        );
        setResults(list.filter((c) => c.id !== customer.id).slice(0, 10));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [search, open, customer.id]);

  async function confirmMerge() {
    if (!picked) return;
    const ok = window.confirm(
      `Vas a fusionar a "${picked.fullName}" dentro de "${customer.fullName}".\n\n` +
        `Todos los pedidos, tarjetas, sellos y mensajes de "${picked.fullName}" se moverán a este cliente, y "${picked.fullName}" se eliminará.\n\n` +
        `Esta acción no se puede deshacer. ¿Continuar?`,
    );
    if (!ok) return;
    setMerging(true);
    try {
      const res = await api('/customers/merge', {
        method: 'POST',
        body: JSON.stringify({
          keepId: customer.id,
          mergeIds: [picked.id],
        }),
      });
      toast(
        `Cliente fusionado · ${res.movedOrders} pedidos consolidados`,
        'success',
      );
      setOpen(false);
      setSearch('');
      setPicked(null);
      onMerged();
    } catch (e: any) {
      toast(e.message || 'No se pudo fusionar', 'error');
    } finally {
      setMerging(false);
    }
  }

  return (
    <>
      <div className="card card-pad">
        <div className="text-[10px] uppercase tracking-[0.18em] text-mute font-semibold mb-2">
          ¿Es un duplicado?
        </div>
        <p className="text-xs text-mute mb-3">
          Si encontraste otro registro de la misma persona, fusiónalo aquí.
          Su historial se moverá a este cliente y el duplicado se eliminará.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn-ghost text-xs w-full justify-center"
        >
          🔗 Fusionar otro cliente aquí
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !merging) setOpen(false);
          }}
        >
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[80vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-line flex items-center justify-between">
              <div>
                <div className="font-semibold">Fusionar otro cliente</div>
                <div className="text-xs text-mute">
                  Conservar a <strong>{customer.fullName}</strong> y eliminar el
                  otro
                </div>
              </div>
              <button
                onClick={() => !merging && setOpen(false)}
                className="text-mute hover:text-ink text-lg leading-none"
                disabled={merging}
              >
                ✕
              </button>
            </div>
            <div className="p-4 border-b border-line">
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPicked(null);
                }}
                placeholder="Buscar por nombre, email o teléfono…"
                className="input text-sm w-full"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {search.trim().length < 2 && (
                <div className="p-6 text-center text-mute text-sm">
                  Escribe al menos 2 caracteres para buscar.
                </div>
              )}
              {searching && (
                <div className="p-6 text-center text-mute text-sm">
                  Buscando…
                </div>
              )}
              {!searching &&
                search.trim().length >= 2 &&
                results.length === 0 && (
                  <div className="p-6 text-center text-mute text-sm">
                    Sin resultados. Prueba otro término.
                  </div>
                )}
              {results.map((r) => {
                const isPicked = picked?.id === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setPicked(r)}
                    className={`w-full text-left px-4 py-3 border-b border-line2 transition flex items-center justify-between gap-2 ${
                      isPicked ? 'bg-brand/10' : 'hover:bg-bg2/40'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{r.fullName}</div>
                      <div className="text-xs text-mute truncate">
                        {r.phone || r.email || 'Sin contacto'}
                      </div>
                    </div>
                    <div className="text-xs text-mute text-right shrink-0">
                      <div>{r.totalOrdersCount} pedidos</div>
                      <div>{r._count?.passes ?? 0} pases</div>
                    </div>
                    {isPicked && (
                      <span className="text-brand text-lg leading-none">✓</span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="px-4 py-3 border-t border-line bg-bg2/30 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => !merging && setOpen(false)}
                className="btn-ghost text-xs"
                disabled={merging}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmMerge}
                disabled={!picked || merging}
                className="btn-primary text-xs disabled:opacity-50"
              >
                {merging ? 'Fusionando…' : 'Fusionar →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Banner de gamificación (level + XP + streak + badges) ───
type GamificationData = {
  level: number;
  tier: { level: number; name: string; minXp: number; color: string };
  nextTier: { level: number; name: string; minXp: number; color: string } | null;
  xpPoints: number;
  xpToNext: number;
  tierProgressPct: number;
  currentStreak: number;
  longestStreak: number;
  rank: number | null;
  badges: Array<{
    id: string;
    name: string;
    description: string;
    icon: string;
    color: string;
    earnedAt: string;
  }>;
};

function GamificationBanner({ customerId }: { customerId: string }) {
  const [data, setData] = useState<GamificationData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<GamificationData>(`/customers/${customerId}/gamification`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [customerId]);

  if (loading || !data) return null;
  if (data.xpPoints === 0 && data.badges.length === 0) {
    return (
      <div className="card card-pad mb-4 bg-bg2/30 border-dashed text-center">
        <div className="text-2xl mb-1">🎮</div>
        <div className="text-sm text-mute">
          Sin actividad de gamificación todavía. Cuando este cliente scanee su
          tarjeta empezará a ganar XP y desbloquear insignias automáticamente.
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl p-5 mb-4 text-white relative overflow-hidden shadow-md"
      style={{
        background: `linear-gradient(135deg, ${data.tier.color}, ${data.tier.color}dd)`,
      }}
    >
      <div
        className="absolute -right-8 -top-8 text-[150px] opacity-10 select-none pointer-events-none"
        aria-hidden
      >
        {data.tier.level >= 5 ? '💎' : data.tier.level >= 4 ? '🥇' : data.tier.level >= 3 ? '🥈' : data.tier.level >= 2 ? '🥉' : '⭐'}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 relative">
        {/* Level + XP */}
        <div>
          <div className="text-[10px] uppercase tracking-wider opacity-80 font-bold">
            Nivel {data.tier.level}
          </div>
          <div className="text-2xl font-black mt-0.5">{data.tier.name}</div>
          <div className="text-xs opacity-85 mt-1">
            <strong className="text-base">{data.xpPoints.toLocaleString('es-CO')}</strong>{' '}
            XP totales
          </div>
          {data.nextTier && (
            <div className="mt-3">
              <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white"
                  style={{ width: `${data.tierProgressPct}%` }}
                />
              </div>
              <div className="text-[10px] opacity-80 mt-1">
                {data.xpToNext.toLocaleString('es-CO')} XP para {data.nextTier.name}
              </div>
            </div>
          )}
          {!data.nextTier && (
            <div className="text-xs opacity-90 mt-2">
              👑 Nivel máximo alcanzado
            </div>
          )}
        </div>

        {/* Streak */}
        <div>
          <div className="text-[10px] uppercase tracking-wider opacity-80 font-bold">
            Racha actual
          </div>
          <div className="text-2xl font-black mt-0.5 flex items-center gap-1.5">
            🔥 {data.currentStreak} {data.currentStreak === 1 ? 'día' : 'días'}
          </div>
          <div className="text-xs opacity-85 mt-1">
            Récord: <strong>{data.longestStreak}</strong> días consecutivos
          </div>
          {data.rank !== null && (
            <div className="text-xs opacity-90 mt-2">
              🏆 #{data.rank} en el ranking
            </div>
          )}
        </div>

        {/* Badges */}
        <div>
          <div className="text-[10px] uppercase tracking-wider opacity-80 font-bold">
            Insignias ({data.badges.length})
          </div>
          {data.badges.length === 0 ? (
            <div className="text-xs opacity-85 mt-2">
              Aún no desbloqueó ninguna insignia.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {data.badges.slice(0, 8).map((b) => (
                <div
                  key={b.id}
                  title={`${b.name} — ${b.description}`}
                  className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center text-xl border border-white/20"
                >
                  {b.icon}
                </div>
              ))}
              {data.badges.length > 8 && (
                <div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center text-xs font-bold border border-white/20">
                  +{data.badges.length - 8}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type CustomerReservation = {
  id: string;
  party: number;
  date: string;
  time: string;
  status: string;
  channel: string;
  notes: string | null;
  zone: { name: string } | null;
};

const RESERVATION_STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
  PENDING: { label: 'Pendiente', bg: '#fff7ed', fg: '#b45309' },
  CONFIRMED: { label: 'Confirmada', bg: '#ecfdf3', fg: '#15803d' },
  SEATED: { label: 'Sentada', bg: '#eff6ff', fg: '#1d4ed8' },
  COMPLETED: { label: 'Completada', bg: '#f3f4f6', fg: '#6b7280' },
  CANCELLED: { label: 'Cancelada', bg: '#f3f4f6', fg: '#6b7280' },
  NO_SHOW: { label: 'Ausente', bg: '#fef2f2', fg: '#dc2626' },
};

function ReservationsSection({ customerId }: { customerId: string }) {
  const [data, setData] = useState<{
    total: number;
    stats: {
      completed: number;
      noShow: number;
      cancelled: number;
      pending: number;
      noShowRate: number;
      completionRate: number;
      lastVisit: string | null;
      totalPax: number;
    };
    reservations: CustomerReservation[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<typeof data>(`/customers/${customerId}/reservations`)
      .then(setData)
      .catch((e: any) => setError(e.message || 'Error'));
  }, [customerId]);

  if (error) return null;
  if (!data || data.total === 0) return null;

  const lastVisitStr = data.stats.lastVisit
    ? new Date(data.stats.lastVisit).toISOString().slice(0, 10)
    : 'Nunca';

  return (
    <div className="card card-pad">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold m-0">📅 Reservas ({data.total})</h3>
        {data.stats.noShowRate > 25 && (
          <span className="text-[10px] font-bold px-2 py-1 rounded bg-bad-soft text-bad">
            No-show alto · {data.stats.noShowRate}%
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <div className="bg-bg2/60 rounded-lg p-2 text-center">
          <div className="text-[10px] text-mute font-bold">COMPLETADAS</div>
          <div className="text-lg font-extrabold">{data.stats.completed}</div>
        </div>
        <div className="bg-bg2/60 rounded-lg p-2 text-center">
          <div className="text-[10px] text-mute font-bold">CANCELADAS</div>
          <div className="text-lg font-extrabold">{data.stats.cancelled}</div>
        </div>
        <div className="bg-bg2/60 rounded-lg p-2 text-center">
          <div className="text-[10px] text-mute font-bold">AUSENTES</div>
          <div className={`text-lg font-extrabold ${data.stats.noShow > 0 ? 'text-bad' : ''}`}>
            {data.stats.noShow}
          </div>
        </div>
        <div className="bg-bg2/60 rounded-lg p-2 text-center">
          <div className="text-[10px] text-mute font-bold">ÚLTIMA VISITA</div>
          <div className="text-sm font-bold mt-0.5">{lastVisitStr}</div>
        </div>
      </div>

      <div className="space-y-1.5 text-sm">
        {data.reservations.slice(0, 15).map((r) => {
          const sm = RESERVATION_STATUS_META[r.status];
          const dateStr = new Date(r.date).toISOString().slice(0, 10);
          return (
            <div
              key={r.id}
              className="flex items-center gap-3 py-2 border-b border-line2 last:border-0"
            >
              <div className="w-20 shrink-0">
                <div className="text-xs font-bold">{dateStr}</div>
                <div className="text-[10px] text-mute">{r.time}</div>
              </div>
              <div className="flex-1 min-w-0 text-xs">
                <span className="font-semibold">{r.party} pax</span>
                {r.zone?.name && <span className="text-mute"> · {r.zone.name}</span>}
                {r.notes && <span className="text-mute italic"> · {r.notes}</span>}
              </div>
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded"
                style={{ background: sm.bg, color: sm.fg }}
              >
                {sm.label}
              </span>
            </div>
          );
        })}
      </div>
      {data.reservations.length > 15 && (
        <p className="text-[11px] text-mute mt-2 text-center">
          Mostrando 15 de {data.reservations.length} reservas recientes.
        </p>
      )}
    </div>
  );
}
