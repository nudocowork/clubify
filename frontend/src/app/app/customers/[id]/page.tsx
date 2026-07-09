'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
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
  /** Monto de la compra que motivó el sello. Informativo (no afecta sellos).
   *  Se usa para calcular ticket promedio y total gastado por cliente. */
  purchaseAmount: number | string | null;
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

/** Formato monetario tenant-aware. Si `currencySymbol` está set, override
 *  el símbolo automático de Intl (Bs, Ref., etc). Si no, símbolo natural. */
function formatMoney(
  n: number,
  currency = 'COP',
  symbolOverride: string | null = null,
): string {
  try {
    const parts = new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).formatToParts(n);
    const sym = symbolOverride?.trim();
    if (sym) {
      return parts.map((p) => (p.type === 'currency' ? sym : p.value)).join('');
    }
    return parts.map((p) => p.value).join('');
  } catch {
    return `${symbolOverride?.trim() || '$'}${n.toFixed(0)}`;
  }
}

/** Backwards-compat: COP() seguía siendo COP hardcoded — esto cambia
 *  el default por tenant currency. Componentes que llaman fuera del
 *  contexto del tenant pueden seguir pasando solo el monto. */
const COP = (n: number, currency = 'COP', symbol: string | null = null) =>
  formatMoney(n, currency, symbol);

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
  const d = new Date(s);
  // Si el año es <= 2000, asumimos placeholder (cliente sin fecha real
  // de nacimiento) y mostramos solo día/mes.
  const showYear = d.getUTCFullYear() > 2000;
  return d.toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    ...(showYear ? { year: 'numeric' } : {}),
  });
}
// El cliente solo elige día y mes al registrar su wallet — el año (2000)
// es un centinela. NUNCA mostramos el año del cumpleaños, sin importar
// qué quedó guardado en la fecha.
function fmtBirthday(s: string | null) {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}

const COUPON_TYPES = ['COUPON', 'DISCOUNT', 'GIFT'];
const isCouponLike = (type?: string) => COUPON_TYPES.includes(type ?? '');

function PassRow({ pass: p, onChange }: { pass: Pass; onChange: () => void }) {
  const t = useTranslations('app_customers_id');
  const [busy, setBusy] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [moreAmount, setMoreAmount] = useState(2);
  const [morePin, setMorePin] = useState('');
  const required = p.card.stampsRequired ?? 10;
  const stamps = p.card.type === 'STAMPS' ? p.stampsCount : 0;
  const remaining = Math.max(0, required - stamps);
  const pct = p.card.type === 'STAMPS' ? Math.min(100, (stamps / required) * 100) : 0;
  const canRedeem = p.card.type === 'STAMPS' && stamps >= required;
  // El bloque de acciones se muestra mientras el pase esté operable. Un pase de
  // sellos LLENO queda en status COMPLETED (backend), así que si solo miráramos
  // ACTIVE el botón de redimir desaparecería justo cuando el premio está listo.
  const operable = p.status === 'ACTIVE' || p.status === 'COMPLETED';
  const couponRedeemed = p.status === 'COMPLETED';

  async function addStamp() {
    // Fix 2026-06-10: el backend exige `purchaseAmount` para STAMPS/
    // VISITS/HYBRID (regla anti-fraude) salvo SUPER_ADMIN. Sin esto el
    // panel devolvía "Monto de compra requerido para registrar el
    // sello" y el botón parecía "no funcionar". Ahora preguntamos el
    // monto al staff antes del POST.
    const raw = window.prompt(
      t('stampPurchasePrompt'),
      '',
    );
    if (raw === null) return; // cancelado
    const purchaseAmount = Number(raw.replace(',', '.'));
    if (!Number.isFinite(purchaseAmount) || purchaseAmount <= 0) {
      toast(t('invalidAmount'), 'error');
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
      toast(t('stampAdded'), 'success');
      onChange();
    } catch (e: any) {
      toast(e.message || t('stampAddFailed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function redeem() {
    if (!confirm(t('redeemConfirm'))) return;
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
      toast(t('rewardRedeemed'), 'success');
      onChange();
    } catch (e: any) {
      toast(e.message || t('redeemFailed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  // "Más sellos": agrega N sellos de una (2-30) validando el PIN del escáner.
  // Mismo flujo que la app móvil — el backend exige el PIN cuando amount > 1.
  async function addMoreStamps() {
    const amount = Math.floor(Number(moreAmount));
    if (!Number.isFinite(amount) || amount < 2 || amount > 30) {
      toast(t('moreStampsInvalid'), 'error');
      return;
    }
    setBusy(true);
    try {
      await api('/stamps', {
        method: 'POST',
        body: JSON.stringify({
          passId: p.id,
          action: 'STAMP',
          amount,
          ...(morePin.trim() ? { pin: morePin.trim() } : {}),
        }),
      });
      toast(t('moreStampsAdded'), 'success');
      setShowMore(false);
      setMorePin('');
      setMoreAmount(2);
      onChange();
    } catch (e: any) {
      toast(e.message || t('stampAddFailed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  // Redimir tarjeta de cupón/descuento/regalo (mismo endpoint que el premio).
  async function redeemCoupon() {
    if (!confirm(t('redeemCouponConfirm'))) return;
    setBusy(true);
    try {
      await api('/stamps', {
        method: 'POST',
        body: JSON.stringify({
          passId: p.id,
          action: 'REDEEM',
          note: 'Cupón redimido desde panel',
        }),
      });
      toast(t('couponRedeemed'), 'success');
      onChange();
    } catch (e: any) {
      toast(e.message || t('redeemFailed'), 'error');
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
        toast(t('passNotFound'), 'error');
        return;
      }
      const apple =
        r.sent > 0
          ? t('appleDevices', { count: r.sent })
          : r.skipped > 0
            ? t('appleFailed', { count: r.skipped })
            : t('appleNotInstalled');
      const g = r.google;
      let google = t('googleNotInstalled');
      if (g) {
        if (g.status === 'patched') google = t('googleUpdated');
        else if (g.status === 'not_saved_to_google_wallet') google = t('googleNotInstalled');
        else if (g.status === 'object_not_found') google = t('googlePassNotFoundInGoogle');
        else if (g.status === 'api_disabled')
          google = t('googleApiDisabled');
        else if (g.status === 'not_configured') google = t('googleNotConfigured');
        else if (g.status === 'pass_not_found') google = t('googlePassNotFound');
        else google = `Google: ${g.error ?? g.status}`;
      }
      const ok = r.sent > 0 || g?.ok;
      toast(`${apple} · ${google}`, ok ? 'success' : 'info');
    } catch (e: any) {
      toast(e.message || t('refreshFailed'), 'error');
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
              {t('stampsProgress', { stamps, required })}
            </span>
            <span
              className={
                remaining === 0
                  ? 'text-ok font-semibold'
                  : 'text-mute'
              }
            >
              {remaining === 0
                ? t('rewardReady')
                : t('stampsRemaining', { remaining })}
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

          {operable && (
            <div className="flex flex-wrap gap-2 mt-3">
              <button
                onClick={addStamp}
                disabled={busy || canRedeem}
                className="flex-1 btn-ghost text-xs justify-center disabled:opacity-50"
                title={canRedeem ? t('redeemFirstTitle') : t('addStampTitle')}
              >
                {t('addStampBtn')}
              </button>
              <button
                onClick={() => {
                  setMoreAmount(2);
                  setMorePin('');
                  setShowMore(true);
                }}
                disabled={busy || canRedeem}
                className="flex-1 btn-ghost text-xs justify-center disabled:opacity-50"
                title={t('moreStampsTitle')}
              >
                {t('moreStampsBtn')}
              </button>
              <button
                onClick={redeem}
                disabled={busy || !canRedeem}
                className={`flex-1 text-xs justify-center font-semibold rounded-pill px-3 py-2 inline-flex items-center gap-1.5 ${
                  canRedeem
                    ? 'bg-ok text-white hover:bg-ok/90'
                    : 'bg-bg2 text-mute cursor-not-allowed'
                }`}
                title={canRedeem ? t('redeemTitle') : t('redeemNotReadyTitle')}
              >
                {t('redeemBtn')}
              </button>
            </div>
          )}
        </div>
      )}

      {p.card.type === 'POINTS' && (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-mute">{t('balance')}</span>
          <span className="font-bold text-lg">{t('points', { count: p.pointsBalance })}</span>
        </div>
      )}

      {isCouponLike(p.card.type) && (
        <div className="mt-3">
          {couponRedeemed ? (
            <div className="text-xs text-mute font-semibold text-center py-2">
              {t('couponAlreadyRedeemed')}
            </div>
          ) : (
            <button
              onClick={redeemCoupon}
              disabled={busy}
              className="w-full text-xs justify-center font-semibold rounded-pill px-3 py-2 inline-flex items-center gap-1.5 bg-ok text-white hover:bg-ok/90 disabled:opacity-50"
              title={t('redeemCouponBtn')}
            >
              {t('redeemCouponBtn')}
            </button>
          )}
        </div>
      )}

      <div className="mt-3 pt-2.5 border-t border-line2/60 flex flex-wrap items-center gap-3">
        <button
          onClick={refreshWallet}
          disabled={busy}
          className="text-[11px] text-mute hover:text-ink disabled:opacity-50 inline-flex items-center gap-1"
          title={t('refreshWalletTitle')}
        >
          {t('refreshWalletBtn')}
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
              toast(e.message || t('fetchFailed'), 'error');
            }
          }}
          className="text-[11px] text-mute hover:text-ink inline-flex items-center gap-1"
          title={t('viewGoogleObjectTitle')}
        >
          {t('viewGoogleObjectBtn')}
        </button>
      </div>

      {showMore && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => !busy && setShowMore(false)}
        >
          <div
            className="bg-bg rounded-2xl p-4 w-full max-w-xs shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-semibold text-sm mb-3">{t('moreStampsTitle')}</div>
            <label className="block text-xs text-mute mb-1">
              {t('moreStampsCount')}
            </label>
            <input
              type="number"
              min={2}
              max={30}
              value={moreAmount}
              onChange={(e) => setMoreAmount(Number(e.target.value))}
              className="input w-full mb-3"
              autoFocus
            />
            <label className="block text-xs text-mute mb-1">
              {t('moreStampsPin')}
            </label>
            <input
              type="password"
              inputMode="numeric"
              value={morePin}
              onChange={(e) => setMorePin(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy) addMoreStamps();
              }}
              className="input w-full mb-4"
              placeholder="••••"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowMore(false)}
                disabled={busy}
                className="flex-1 btn-ghost text-xs justify-center"
              >
                {t('cancel')}
              </button>
              <button
                onClick={addMoreStamps}
                disabled={busy}
                className="flex-1 text-xs justify-center font-semibold rounded-pill px-3 py-2 bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {t('moreStampsSubmit')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** Modal para que el NEGOCIO corrija los datos que el cliente pudo digitar
 *  mal al registrarse: nombre, correo y día/mes de cumpleaños. Usa el
 *  PATCH /customers/:id existente (scoped por tenant). El cumpleaños se
 *  guarda con año centinela 2000 (solo día/mes, igual que el enrolamiento);
 *  si se deja vacío, no se toca la fecha actual. */
function EditCustomerModal({
  customer,
  onClose,
  onSaved,
}: {
  customer: Customer;
  onClose: () => void;
  onSaved: () => void;
}) {
  const bd = customer.birthday ? new Date(customer.birthday) : null;
  const validBd = bd && !Number.isNaN(bd.getTime()) ? bd : null;
  const [fullName, setFullName] = useState(customer.fullName);
  const [email, setEmail] = useState(customer.email ?? '');
  const [day, setDay] = useState(validBd ? String(validBd.getUTCDate()) : '');
  const [month, setMonth] = useState(
    validBd ? String(validBd.getUTCMonth() + 1) : '',
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    const name = fullName.trim();
    if (!name) {
      toast('El nombre no puede quedar vacío', 'error');
      return;
    }
    // Día/mes: ambos o ninguno. Si solo uno está puesto, avisamos.
    if ((day && !month) || (!day && month)) {
      toast('Elige día y mes del cumpleaños (o deja ambos vacíos)', 'error');
      return;
    }
    const body: {
      fullName: string;
      email: string | null;
      birthday?: string;
    } = {
      fullName: name,
      email: email.trim() || null,
    };
    if (day && month) {
      body.birthday = `2000-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    setBusy(true);
    try {
      await api(`/customers/${customer.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      toast('Datos actualizados', 'success');
      onSaved();
      onClose();
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="card card-pad w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-semibold text-lg mb-4">Editar datos del cliente</div>

        <label className="label">Nombre completo</label>
        <input
          className="input w-full"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Nombre y apellido"
        />

        <label className="label mt-3">Correo</label>
        <input
          className="input w-full"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="correo@ejemplo.com (opcional)"
        />

        <label className="label mt-3">Cumpleaños</label>
        <div className="flex gap-2">
          <select
            className="input flex-1"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          >
            <option value="">Día</option>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <select
            className="input flex-[2]"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          >
            <option value="">Mes</option>
            {MONTHS_ES.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
        </div>
        <p className="text-[11px] text-mute mt-1">
          Solo día y mes — el cumpleaños dispara el saludo automático.
        </p>

        <div className="flex justify-end gap-2 mt-5">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CustomerDetail() {
  const t = useTranslations('app_customers_id');
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [c, setC] = useState<Customer | null>(null);
  const [editing, setEditing] = useState(false);
  const [tenantMoney, setTenantMoney] = useState<{ currency: string; currencySymbol: string | null }>({
    currency: 'COP',
    currencySymbol: null,
  });
  const [deleting, setDeleting] = useState(false);

  async function load() {
    try {
      setC(await api<Customer>(`/customers/${id}`));
      // Cargar moneda del tenant en paralelo (no bloquea si falla).
      api<{ currency?: string; currencySymbol?: string | null }>('/tenants/me')
        .then((t) =>
          setTenantMoney({
            currency: t.currency ?? 'COP',
            currencySymbol: t.currencySymbol ?? null,
          }),
        )
        .catch(() => null);
    } catch (e: any) {
      toast(e.message || t('loadError'), 'error');
    }
  }
  useEffect(() => {
    load();
  }, [id]);

  async function deleteCustomer() {
    if (!c) return;
    const msg = t('deleteConfirm', {
      name: c.fullName,
      ordersCount: c.totalOrdersCount,
    });
    const confirmText = window.prompt(msg);
    if ((confirmText ?? '').trim().toUpperCase() !== 'ELIMINAR') return;
    setDeleting(true);
    try {
      await api(`/customers/${id}`, { method: 'DELETE' });
      toast(t('customerDeleted'), 'success');
      router.push('/app/customers');
    } catch (e: any) {
      toast(e.message || t('deleteFailed'), 'error');
      setDeleting(false);
    }
  }

  if (!c) return <div className="text-mute">{t('loading')}</div>;

  const lifetimeAvg =
    c.totalOrdersCount > 0
      ? Number(c.totalOrdersAmount) / c.totalOrdersCount
      : 0;

  return (
    <div>
      {editing && (
        <EditCustomerModal
          customer={c}
          onClose={() => setEditing(false)}
          onSaved={load}
        />
      )}
      <div className="page-head">
        <h1 className="page-title">
          <Link href="/app/customers" className="text-mute hover:text-ink">
            {t('customers')}
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
            onClick={() => setEditing(true)}
            className="btn-ghost text-sm font-semibold px-4 py-2 inline-flex items-center gap-1.5"
            title="Editar nombre, correo o cumpleaños"
          >
            <Icon name="edit" size={14} /> Editar
          </button>
          <button
            onClick={deleteCustomer}
            disabled={deleting}
            className="bg-bad text-white text-sm font-semibold px-4 py-2 rounded-pill inline-flex items-center gap-1.5 hover:bg-bad/90 disabled:opacity-50"
            title={t('deleteCustomerTitle')}
          >
            <Icon name="trash" size={14} />
            {deleting ? t('deleting') : t('delete')}
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
                <span className="badge badge-ok text-[10px]">{t('waVerified')}</span>
              )}
              {c.marketingOptIn && (
                <span className="badge badge-info text-[10px]">{t('marketingOk')}</span>
              )}
            </div>
          </div>

          <div className="card card-pad">
            <div className="text-[10px] uppercase tracking-[0.18em] text-mute font-semibold mb-3">
              {t('lifetimeValue')}
            </div>
            <div className="grid grid-cols-2 gap-3 text-center">
              <div>
                <div className="text-2xl font-bold">{c.totalOrdersCount}</div>
                <div className="text-xs text-mute">{t('orders')}</div>
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {COP(Number(c.totalOrdersAmount), tenantMoney.currency, tenantMoney.currencySymbol)}
                </div>
                <div className="text-xs text-mute">{t('billed')}</div>
              </div>
              <div>
                <div className="text-base font-semibold">
                  {COP(lifetimeAvg, tenantMoney.currency, tenantMoney.currencySymbol)}
                </div>
                <div className="text-xs text-mute">{t('avgTicket')}</div>
              </div>
              <div>
                <div className="text-base font-semibold">
                  {c.passes.length}
                </div>
                <div className="text-xs text-mute">{t('activePasses')}</div>
              </div>
            </div>
          </div>

          <CustomerNotesAndTags customer={c} onChange={load} />

          <div className="card card-pad text-sm">
            <div className="text-[10px] uppercase tracking-[0.18em] text-mute font-semibold mb-2">
              {t('data')}
            </div>
            <div className="flex justify-between py-1 border-b border-line2">
              <span className="text-mute">{t('customerSince')}</span>
              <span>{fmtDate(c.createdAt)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-line2">
              <span className="text-mute">{t('firstOrder')}</span>
              <span>{fmtDate(c.firstOrderAt)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-line2">
              <span className="text-mute">{t('lastOrder')}</span>
              <span>{fmtDate(c.lastOrderAt)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-mute">{t('birthday')}</span>
              <span>{fmtBirthday(c.birthday)}</span>
            </div>
          </div>

          <MergeIntoThisCustomer customer={c} onMerged={load} />
        </div>

        <div className="space-y-4">
          {/* Tarjetas */}
          {c.passes.length > 0 && (
            <div className="card card-pad">
              <h3 className="font-semibold mb-3">
                {t('loyaltyCards', { count: c.passes.length })}
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
              <h3>{t('orderHistory', { count: c.orders.length })}</h3>
            </div>
            {c.orders.length === 0 ? (
              <div className="p-6 text-center text-mute text-sm">
                {t('noOrders')}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-bg2">
                  <tr>
                    {['#', t('colDate'), t('colType'), t('colPayment'), t('colStatus'), t('colTotal')].map(
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
                        {COP(Number(o.total), tenantMoney.currency, tenantMoney.currencySymbol)}
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
              <div className="flex items-start justify-between gap-3 mb-3">
                <h3 className="font-semibold m-0">
                  {t('stampActivity', { count: c.stamps.length })}
                </h3>
                {(() => {
                  const stampsWithAmt = c.stamps.filter(
                    (s) => s.purchaseAmount != null && Number(s.purchaseAmount) > 0,
                  );
                  if (stampsWithAmt.length === 0) return null;
                  const total = stampsWithAmt.reduce(
                    (sum, s) => sum + Number(s.purchaseAmount),
                    0,
                  );
                  const avg = total / stampsWithAmt.length;
                  return (
                    <div className="text-right shrink-0">
                      <div className="text-[10px] uppercase tracking-wider text-mute font-bold">
                        {t('spentInPurchases', { count: stampsWithAmt.length })}
                      </div>
                      <div className="text-base font-bold text-brand">
                        {COP(total, tenantMoney.currency, tenantMoney.currencySymbol)}
                      </div>
                      <div className="text-[11px] text-mute">
                        {t('avgTicketLabel')} · {COP(avg, tenantMoney.currency, tenantMoney.currencySymbol)}
                      </div>
                    </div>
                  );
                })()}
              </div>
              <div className="space-y-1.5 text-sm">
                {c.stamps.slice(0, 15).map((s) => {
                  const amt = s.purchaseAmount != null ? Number(s.purchaseAmount) : null;
                  return (
                    <div
                      key={s.id}
                      className="flex items-center justify-between py-1.5 border-b border-line2 last:border-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{s.action}</span>
                          {amt && amt > 0 && (
                            <span className="text-xs font-semibold text-brand">
                              {COP(amt, tenantMoney.currency, tenantMoney.currencySymbol)}
                            </span>
                          )}
                        </div>
                        {s.note && (
                          <div className="text-[11px] text-mute mt-0.5 truncate">
                            {s.note}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-mute shrink-0">
                        <span className="font-medium text-ink">
                          {Number(s.amount) > 0 ? '+' : ''}
                          {Number(s.amount)}
                        </span>
                        <span>{fmtDate(s.createdAt)}</span>
                      </div>
                    </div>
                  );
                })}
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
  const t = useTranslations('app_customers_id');
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
      toast(e.message || t('saveTagsFailed'), 'error');
    } finally {
      setSavingTags(false);
    }
  }

  function addTag(val: string) {
    const tag = val.trim();
    if (!tag || tags.includes(tag)) return;
    const next = [...tags, tag];
    setTags(next);
    setTagInput('');
    persistTags(next);
  }

  function removeTag(tag: string) {
    const next = tags.filter((x) => x !== tag);
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
      toast(t('notesSaved'), 'success');
      onChange();
    } catch (e: any) {
      toast(e.message || t('saveFailed'), 'error');
    } finally {
      setSavingNotes(false);
    }
  }

  const presetsAvailable = TAG_PRESETS.filter((p) => !tags.includes(p));

  return (
    <div className="card card-pad">
      <div className="text-[10px] uppercase tracking-[0.18em] text-mute font-semibold mb-2">
        {t('tags')}
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {tags.length === 0 && (
          <span className="text-xs text-mute italic">{t('noTagsYet')}</span>
        )}
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 bg-brand-soft text-brand-700 text-[11px] font-medium px-2 py-1 rounded-full"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="hover:text-bad"
              aria-label={t('removeTag', { tag })}
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
          placeholder={t('newTagPlaceholder')}
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
          {t('add')}
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
        <span>{t('internalNotes')}</span>
        {notesDirty && (
          <span className="text-amber-600 text-[10px] normal-case font-normal tracking-normal">
            {t('unsaved')}
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
        placeholder={t('notesPlaceholder')}
        className="input text-sm min-h-[70px] resize-y"
        maxLength={500}
      />
      <div className="text-[10px] text-mute mt-1 flex items-center justify-between">
        <span>{t('notesHelp')}</span>
        <span>{notes.length}/500</span>
      </div>
      {notesDirty && (
        <button
          type="button"
          onClick={saveNotes}
          disabled={savingNotes}
          className="btn-primary text-xs mt-2"
        >
          {savingNotes ? t('saving') : t('saveNote')}
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
  const t = useTranslations('app_customers_id');
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
    const timer = setTimeout(async () => {
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
    return () => clearTimeout(timer);
  }, [search, open, customer.id]);

  async function confirmMerge() {
    if (!picked) return;
    const ok = window.confirm(
      t('mergeConfirm', {
        source: picked.fullName,
        target: customer.fullName,
      }),
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
        t('mergeSuccess', { count: res.movedOrders }),
        'success',
      );
      setOpen(false);
      setSearch('');
      setPicked(null);
      onMerged();
    } catch (e: any) {
      toast(e.message || t('mergeFailed'), 'error');
    } finally {
      setMerging(false);
    }
  }

  return (
    <>
      <div className="card card-pad">
        <div className="text-[10px] uppercase tracking-[0.18em] text-mute font-semibold mb-2">
          {t('isDuplicate')}
        </div>
        <p className="text-xs text-mute mb-3">
          {t('duplicateHelp')}
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn-ghost text-xs w-full justify-center"
        >
          {t('mergeOtherBtn')}
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
                <div className="font-semibold">{t('mergeModalTitle')}</div>
                <div className="text-xs text-mute">
                  {t('mergeKeepPrefix')} <strong>{customer.fullName}</strong>{' '}
                  {t('mergeKeepSuffix')}
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
                placeholder={t('mergeSearchPlaceholder')}
                className="input text-sm w-full"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {search.trim().length < 2 && (
                <div className="p-6 text-center text-mute text-sm">
                  {t('mergeMinChars')}
                </div>
              )}
              {searching && (
                <div className="p-6 text-center text-mute text-sm">
                  {t('searching')}
                </div>
              )}
              {!searching &&
                search.trim().length >= 2 &&
                results.length === 0 && (
                  <div className="p-6 text-center text-mute text-sm">
                    {t('noResults')}
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
                        {r.phone || r.email || t('noContact')}
                      </div>
                    </div>
                    <div className="text-xs text-mute text-right shrink-0">
                      <div>{t('ordersCount', { count: r.totalOrdersCount })}</div>
                      <div>{t('passesCount', { count: r._count?.passes ?? 0 })}</div>
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
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={confirmMerge}
                disabled={!picked || merging}
                className="btn-primary text-xs disabled:opacity-50"
              >
                {merging ? t('merging') : t('mergeBtn')}
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
  const t = useTranslations('app_customers_id');
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
          {t('gamificationEmpty')}
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
            {t('level', { level: data.tier.level })}
          </div>
          <div className="text-2xl font-black mt-0.5">{data.tier.name}</div>
          <div className="text-xs opacity-85 mt-1">
            <strong className="text-base">{data.xpPoints.toLocaleString('es-CO')}</strong>{' '}
            {t('totalXp')}
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
                {t('xpToNext', { xp: data.xpToNext.toLocaleString('es-CO'), tier: data.nextTier.name })}
              </div>
            </div>
          )}
          {!data.nextTier && (
            <div className="text-xs opacity-90 mt-2">
              {t('maxLevel')}
            </div>
          )}
        </div>

        {/* Streak */}
        <div>
          <div className="text-[10px] uppercase tracking-wider opacity-80 font-bold">
            {t('currentStreak')}
          </div>
          <div className="text-2xl font-black mt-0.5 flex items-center gap-1.5">
            🔥 {t('streakDays', { count: data.currentStreak })}
          </div>
          <div className="text-xs opacity-85 mt-1">
            {t('recordPrefix')} <strong>{data.longestStreak}</strong> {t('recordSuffix')}
          </div>
          {data.rank !== null && (
            <div className="text-xs opacity-90 mt-2">
              {t('rankInLeaderboard', { rank: data.rank })}
            </div>
          )}
        </div>

        {/* Badges */}
        <div>
          <div className="text-[10px] uppercase tracking-wider opacity-80 font-bold">
            {t('badges', { count: data.badges.length })}
          </div>
          {data.badges.length === 0 ? (
            <div className="text-xs opacity-85 mt-2">
              {t('noBadges')}
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
  const t = useTranslations('app_customers_id');
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
    : t('never');

  return (
    <div className="card card-pad">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold m-0">{t('reservations', { count: data.total })}</h3>
        {data.stats.noShowRate > 25 && (
          <span className="text-[10px] font-bold px-2 py-1 rounded bg-bad-soft text-bad">
            {t('highNoShow', { rate: data.stats.noShowRate })}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <div className="bg-bg2/60 rounded-lg p-2 text-center">
          <div className="text-[10px] text-mute font-bold">{t('statCompleted')}</div>
          <div className="text-lg font-extrabold">{data.stats.completed}</div>
        </div>
        <div className="bg-bg2/60 rounded-lg p-2 text-center">
          <div className="text-[10px] text-mute font-bold">{t('statCancelled')}</div>
          <div className="text-lg font-extrabold">{data.stats.cancelled}</div>
        </div>
        <div className="bg-bg2/60 rounded-lg p-2 text-center">
          <div className="text-[10px] text-mute font-bold">{t('statNoShow')}</div>
          <div className={`text-lg font-extrabold ${data.stats.noShow > 0 ? 'text-bad' : ''}`}>
            {data.stats.noShow}
          </div>
        </div>
        <div className="bg-bg2/60 rounded-lg p-2 text-center">
          <div className="text-[10px] text-mute font-bold">{t('statLastVisit')}</div>
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
                <span className="font-semibold">{t('pax', { count: r.party })}</span>
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
          {t('showingRecent', { total: data.reservations.length })}
        </p>
      )}
    </div>
  );
}
