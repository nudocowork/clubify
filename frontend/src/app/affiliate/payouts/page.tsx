'use client';
/**
 * /affiliate/payouts — Vista del afiliado para cobro de comisiones.
 *
 * 3 secciones:
 *   1. Resumen con countdown (próximo día 15) + monto disponible.
 *   2. Datos de pago (form Binance o cuenta bancaria).
 *   3. Historial con comprobantes descargables.
 *
 * Fase D 2026-06-07.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Logo } from '@/components/Logo';
import { toast } from '@/components/Toast';

type ProfileStatus = 'NONE' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
type Method = 'BINANCE' | 'BANK';

type Summary = {
  availableUsd: number;
  pendingUsd: number;
  minimumPayoutUsd: number;
  reachedMinimum: boolean;
  freeWithdrawalMinUsd: number;
  withdrawalFeeUsd: number;
  netUsd: number;
  profileStatus: ProfileStatus;
  profileRejectionReason: string | null;
  payoutDayOfMonth: number;
  daysUntilPayout: number;
  nextPayoutDate: string;
  canRequestPayout: boolean;
};

type PaymentProfile = {
  status: ProfileStatus;
  firstName?: string | null;
  lastName?: string | null;
  phoneCountry?: string | null;
  phone?: string | null;
  method?: Method | null;
  binanceEmail?: string | null;
  binancePhone?: string | null;
  binanceNote?: string | null;
  bankCountry?: string | null;
  bankName?: string | null;
  bankAccountType?: string | null;
  bankAccountNo?: string | null;
  bankHolderName?: string | null;
  bankHolderDoc?: string | null;
  bankNote?: string | null;
};

type PayoutRow = {
  id: string;
  amount: number;
  feeUsd: number;
  netUsd: number;
  currency: string;
  status: 'PROCESSING' | 'PAID' | 'REVERSED';
  proofUrl: string | null;
  proofMimeType: string | null;
  paidAt: string | null;
  methodSnapshot: any;
  itemsCount: number;
  items: Array<{
    id: string;
    amount: number;
    commission: { createdAt: string; tenantName: string };
  }>;
  notes: string | null;
  createdAt: string;
};

function fmtUsd(n: number) {
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function AffiliatePayoutsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [profile, setProfile] = useState<PaymentProfile | null>(null);
  const [history, setHistory] = useState<PayoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingProfile, setEditingProfile] = useState(false);
  // Marca del afiliado (de /affiliate/me → resuelta por whiteLabelId). El header
  // debe decir SU marca (Sellea), no "Clubify" a mano. null = Clubify.
  const [brand, setBrand] = useState<{ name?: string; logoUrl?: string | null; slug?: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [s, p, h, me] = await Promise.all([
        api<Summary>('/affiliate/payouts/summary'),
        api<PaymentProfile | null>('/affiliate/payouts/profile'),
        api<PayoutRow[]>('/affiliate/payouts/history'),
        api<any>('/affiliate/me').catch(() => null),
      ]);
      setSummary(s);
      setProfile(p);
      setHistory(h);
      setBrand(me?.brand ?? null);
    } catch (e: any) {
      toast(e?.message ?? 'Error cargando', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-line bg-white sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/affiliate" className="flex items-center gap-2">
            {brand?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logoUrl} alt={brand.name ?? ''} className="h-7 w-auto" />
            ) : brand && brand.slug !== 'clubify' ? (
              <span className="font-bold">{brand.name}</span>
            ) : (
              <>
                <Logo size={28} />
                <span className="font-bold">Clubify</span>
              </>
            )}
          </Link>
          <span className="text-mute text-sm">/ Pagos</span>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-5">
        {/* #30 (2026-06-16): botón Volver al panel del afiliado. */}
        <Link
          href="/affiliate"
          className="inline-flex items-center gap-1.5 text-sm text-mute hover:text-ink font-medium select-none active:scale-[0.97] [-webkit-tap-highlight-color:transparent]"
        >
          ← Volver
        </Link>
        {loading && (
          <div className="card card-pad text-mute text-sm">Cargando…</div>
        )}
        {!loading && summary && (
          <SummaryCard
            summary={summary}
            profile={profile}
            onEditProfile={() => setEditingProfile(true)}
          />
        )}
        {!loading && summary && (
          <ProfileCard
            profile={profile}
            summary={summary}
            onEdit={() => setEditingProfile(true)}
          />
        )}
        {!loading && (
          <HistoryCard rows={history} />
        )}
      </main>
      {editingProfile && (
        <ProfileForm
          initial={profile}
          onClose={() => setEditingProfile(false)}
          onSaved={() => {
            setEditingProfile(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function SummaryCard({
  summary,
  profile,
  onEditProfile,
}: {
  summary: Summary;
  profile: PaymentProfile | null;
  onEditProfile: () => void;
}) {
  const profileOk = summary.profileStatus === 'APPROVED';
  return (
    <div className="card card-pad">
      <div className="grid sm:grid-cols-3 gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
            Saldo disponible
          </div>
          <div className="text-3xl font-bold mt-1">
            {fmtUsd(summary.availableUsd)}
          </div>
          {summary.withdrawalFeeUsd > 0 ? (
            <div className="text-xs text-amber-700 mt-1">
              Costo de retiro: {fmtUsd(summary.withdrawalFeeUsd)} → recibes{' '}
              <b>{fmtUsd(summary.netUsd)}</b>
              <div className="text-mute">
                Retira {fmtUsd(summary.freeWithdrawalMinUsd)}+ y es gratis.
              </div>
            </div>
          ) : (
            <div className="text-xs text-ok mt-1">
              Retiro gratis (≥ {fmtUsd(summary.freeWithdrawalMinUsd)})
            </div>
          )}
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
            Próximo pago
          </div>
          <div className="text-2xl font-bold mt-1 text-brand">
            {summary.nextPayoutDate
              ? new Date(summary.nextPayoutDate).toLocaleDateString('es-CO', {
                  day: 'numeric',
                  month: 'short',
                })
              : `${summary.daysUntilPayout} días`}
          </div>
          <div className="text-xs text-mute mt-1">
            Pagamos los días 15 y último de cada mes.
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
            Estado del perfil
          </div>
          <div className="mt-1">
            <ProfileStatusBadge status={summary.profileStatus} />
          </div>
          {summary.profileStatus === 'REJECTED' &&
            summary.profileRejectionReason && (
              <div className="text-xs text-red-700 mt-1">
                {summary.profileRejectionReason}
              </div>
            )}
        </div>
      </div>

      <div className="mt-4 border-t border-line2 pt-4 space-y-2">
        <div className="rounded-md bg-indigo-50 border border-indigo-200 px-3 py-2 text-xs text-indigo-900">
          ℹ️ Las comisiones se desbloquean <b>15 días</b> después de la compra
          del cliente. Pagamos los días <b>15 y último de cada mes</b>. Retiros
          de <b>{fmtUsd(summary.freeWithdrawalMinUsd)}+ son gratis</b>; por
          debajo se descuenta un costo de retiro de{' '}
          <b>{fmtUsd(summary.withdrawalFeeUsd > 0 ? summary.withdrawalFeeUsd : 3)}</b>.
        </div>
        {summary.availableUsd > 0 && summary.profileStatus === 'NONE' && (
          <button
            onClick={onEditProfile}
            className="btn-primary text-sm w-full sm:w-auto"
          >
            Déjanos tus datos para el pago →
          </button>
        )}
        {(summary.profileStatus === 'PENDING_REVIEW' ||
          summary.profileStatus === 'REJECTED') && (
          <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-900">
            {summary.profileStatus === 'PENDING_REVIEW'
              ? 'Tus datos están en revisión. Te avisamos apenas se aprueben.'
              : 'Tus datos fueron rechazados. Corrige y vuelve a enviar.'}
            <button
              onClick={onEditProfile}
              className="ml-2 underline font-semibold"
            >
              Editar datos
            </button>
          </div>
        )}
        {summary.canRequestPayout && (
          <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-900">
            ✅ Tu pago está listo. Se procesa en el próximo ciclo (día 15 o
            último del mes). No tienes que hacer nada más.
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileStatusBadge({ status }: { status: ProfileStatus }) {
  const cls: Record<ProfileStatus, string> = {
    NONE: 'bg-bg2 text-mute',
    PENDING_REVIEW: 'bg-amber-100 text-amber-800',
    APPROVED: 'bg-emerald-100 text-emerald-800',
    REJECTED: 'bg-red-100 text-red-800',
  };
  const label: Record<ProfileStatus, string> = {
    NONE: 'Sin datos',
    PENDING_REVIEW: 'En revisión',
    APPROVED: 'Aprobado',
    REJECTED: 'Rechazado',
  };
  return (
    <span
      className={`px-2 py-1 rounded-full text-[10px] font-semibold ${cls[status]}`}
    >
      {label[status]}
    </span>
  );
}

function ProfileCard({
  profile,
  summary,
  onEdit,
}: {
  profile: PaymentProfile | null;
  summary: Summary;
  onEdit: () => void;
}) {
  if (!profile || summary.profileStatus === 'NONE') {
    return (
      <div className="card card-pad">
        <div className="font-semibold text-sm">Tus datos para el pago</div>
        <div className="text-xs text-mute mt-1">
          Cuando alcances el mínimo te pediremos que dejes tus datos para
          enviarte el dinero.
        </div>
      </div>
    );
  }
  return (
    <div className="card card-pad">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <div className="font-semibold text-sm">Tus datos de pago</div>
          <div className="text-xs text-mute mt-0.5">
            {profile.method === 'BINANCE'
              ? 'Recibís por Binance'
              : 'Recibís en cuenta bancaria'}
          </div>
        </div>
        <button onClick={onEdit} className="btn-ghost text-xs">
          Editar
        </button>
      </div>
      <div className="grid sm:grid-cols-2 gap-3 mt-3 text-sm">
        <Field
          label="Titular"
          value={`${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim()}
        />
        <Field
          label="Teléfono"
          value={`${profile.phoneCountry ?? ''} ${profile.phone ?? ''}`.trim()}
        />
        {profile.method === 'BINANCE' && (
          <>
            <Field label="Correo Binance" value={profile.binanceEmail ?? ''} />
            <Field
              label="Tel. Binance"
              value={profile.binancePhone ?? '—'}
            />
            {profile.binanceNote && (
              <Field label="Observación" value={profile.binanceNote} />
            )}
          </>
        )}
        {profile.method === 'BANK' && (
          <>
            <Field label="País" value={profile.bankCountry ?? ''} />
            <Field label="Banco" value={profile.bankName ?? ''} />
            <Field
              label="Tipo de cuenta"
              value={profile.bankAccountType ?? ''}
            />
            <Field
              label="N° cuenta"
              value={profile.bankAccountNo ?? ''}
            />
            <Field
              label="Titular cuenta"
              value={profile.bankHolderName ?? ''}
            />
            {profile.bankHolderDoc && (
              <Field
                label="Documento"
                value={profile.bankHolderDoc}
              />
            )}
            {profile.bankNote && (
              <Field label="Observación" value={profile.bankNote} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
        {label}
      </div>
      <div>{value || '—'}</div>
    </div>
  );
}

function HistoryCard({ rows }: { rows: PayoutRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="card card-pad text-xs text-mute">
        Aún no recibiste pagos. Cuando hagamos el primer pago vas a verlo acá
        con su comprobante.
      </div>
    );
  }
  return (
    <div className="card overflow-hidden p-0">
      <div className="px-4 py-3 border-b border-line2 font-semibold text-sm">
        💰 Historial de pagos
      </div>
      <div className="divide-y divide-line2">
        {rows.map((p) => (
          <div key={p.id} className="px-4 py-3 flex items-start gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <div className="font-bold">
                {fmtUsd(p.netUsd)}{' '}
                <span className="text-mute font-normal text-xs">
                  · {p.itemsCount} comisiones
                </span>
              </div>
              {p.feeUsd > 0 && (
                <div className="text-[11px] text-amber-700">
                  Bruto {fmtUsd(p.amount)} − costo de retiro {fmtUsd(p.feeUsd)}
                </div>
              )}
              <div className="text-xs text-mute">
                {p.status === 'PAID'
                  ? `Pagado el ${fmtDate(p.paidAt)}`
                  : p.status === 'PROCESSING'
                  ? 'Procesando…'
                  : 'Revertido'}
              </div>
              {p.notes && (
                <div className="text-xs text-mute mt-1 italic">{p.notes}</div>
              )}
            </div>
            <div>
              {p.proofUrl ? (
                <a
                  href={p.proofUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-ghost text-xs"
                >
                  📎 Ver comprobante
                </a>
              ) : (
                <span className="text-[10px] text-mute">Sin comprobante</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProfileForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: PaymentProfile | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [firstName, setFirstName] = useState(initial?.firstName ?? '');
  const [lastName, setLastName] = useState(initial?.lastName ?? '');
  const [phoneCountry, setPhoneCountry] = useState(initial?.phoneCountry ?? '+57');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [method, setMethod] = useState<Method>(initial?.method ?? 'BINANCE');
  // Binance
  const [binanceEmail, setBinanceEmail] = useState(initial?.binanceEmail ?? '');
  const [binancePhone, setBinancePhone] = useState(initial?.binancePhone ?? '');
  const [binanceNote, setBinanceNote] = useState(initial?.binanceNote ?? '');
  // Bank
  const [bankCountry, setBankCountry] = useState(initial?.bankCountry ?? 'Colombia');
  const [bankName, setBankName] = useState(initial?.bankName ?? '');
  const [bankAccountType, setBankAccountType] = useState(
    initial?.bankAccountType ?? 'Ahorros',
  );
  const [bankAccountNo, setBankAccountNo] = useState(initial?.bankAccountNo ?? '');
  const [bankHolderName, setBankHolderName] = useState(initial?.bankHolderName ?? '');
  const [bankHolderDoc, setBankHolderDoc] = useState(initial?.bankHolderDoc ?? '');
  const [bankNote, setBankNote] = useState(initial?.bankNote ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const body: any = {
        firstName,
        lastName,
        phoneCountry,
        phone,
        method,
      };
      if (method === 'BINANCE') {
        body.binanceEmail = binanceEmail;
        body.binancePhone = binancePhone || null;
        body.binanceNote = binanceNote || null;
      } else {
        body.bankCountry = bankCountry;
        body.bankName = bankName;
        body.bankAccountType = bankAccountType;
        body.bankAccountNo = bankAccountNo;
        body.bankHolderName = bankHolderName;
        body.bankHolderDoc = bankHolderDoc || null;
        body.bankNote = bankNote || null;
      }
      await api('/affiliate/payouts/profile', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      toast('Datos guardados. El admin los va a revisar.', 'success');
      onSaved();
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo guardar', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92dvh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-line px-5 py-3 flex items-center justify-between">
          <div className="font-semibold">Datos para el pago</div>
          <button onClick={onClose} className="text-mute hover:text-ink text-xl">
            ×
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <div className="text-xs text-mute mb-1">Nombre *</div>
              <input
                className="input"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
            </label>
            <label className="block">
              <div className="text-xs text-mute mb-1">Apellido *</div>
              <input
                className="input"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </label>
          </div>
          <div className="grid grid-cols-[100px_1fr] gap-3">
            <label className="block">
              <div className="text-xs text-mute mb-1">Cod. país *</div>
              <input
                className="input"
                value={phoneCountry}
                onChange={(e) => setPhoneCountry(e.target.value)}
                placeholder="+57"
              />
            </label>
            <label className="block">
              <div className="text-xs text-mute mb-1">Teléfono *</div>
              <input
                className="input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="3001112233"
              />
            </label>
          </div>

          {/* Método */}
          <div>
            <div className="text-xs text-mute mb-2">Método de pago *</div>
            <div className="inline-flex bg-bg2 rounded-pill p-1 text-sm font-semibold w-full">
              <button
                type="button"
                onClick={() => setMethod('BINANCE')}
                className={`flex-1 px-4 py-1.5 rounded-pill transition ${
                  method === 'BINANCE' ? 'bg-white shadow-sm' : 'text-mute'
                }`}
              >
                🪙 Binance
              </button>
              <button
                type="button"
                onClick={() => setMethod('BANK')}
                className={`flex-1 px-4 py-1.5 rounded-pill transition ${
                  method === 'BANK' ? 'bg-white shadow-sm' : 'text-mute'
                }`}
              >
                🏦 Cuenta bancaria
              </button>
            </div>
          </div>

          {method === 'BINANCE' && (
            <div className="space-y-3 border-t border-line2 pt-3">
              <label className="block">
                <div className="text-xs text-mute mb-1">Correo de Binance *</div>
                <input
                  className="input"
                  type="email"
                  value={binanceEmail}
                  onChange={(e) => setBinanceEmail(e.target.value)}
                  required
                />
              </label>
              <label className="block">
                <div className="text-xs text-mute mb-1">
                  Tel. asociado a Binance (opcional)
                </div>
                <input
                  className="input"
                  value={binancePhone}
                  onChange={(e) => setBinancePhone(e.target.value)}
                />
              </label>
              <label className="block">
                <div className="text-xs text-mute mb-1">Observación (opcional)</div>
                <textarea
                  className="input"
                  rows={2}
                  value={binanceNote}
                  onChange={(e) => setBinanceNote(e.target.value)}
                />
              </label>
            </div>
          )}

          {method === 'BANK' && (
            <div className="space-y-3 border-t border-line2 pt-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <div className="text-xs text-mute mb-1">País *</div>
                  <input
                    className="input"
                    value={bankCountry}
                    onChange={(e) => setBankCountry(e.target.value)}
                    required
                  />
                </label>
                <label className="block">
                  <div className="text-xs text-mute mb-1">Banco *</div>
                  <input
                    className="input"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    required
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <div className="text-xs text-mute mb-1">Tipo de cuenta *</div>
                  <input
                    className="input"
                    value={bankAccountType}
                    onChange={(e) => setBankAccountType(e.target.value)}
                    required
                  />
                </label>
                <label className="block">
                  <div className="text-xs text-mute mb-1">N° cuenta *</div>
                  <input
                    className="input"
                    value={bankAccountNo}
                    onChange={(e) => setBankAccountNo(e.target.value)}
                    required
                  />
                </label>
              </div>
              <label className="block">
                <div className="text-xs text-mute mb-1">Titular de la cuenta *</div>
                <input
                  className="input"
                  value={bankHolderName}
                  onChange={(e) => setBankHolderName(e.target.value)}
                  required
                />
              </label>
              <label className="block">
                <div className="text-xs text-mute mb-1">
                  Documento del titular (opcional)
                </div>
                <input
                  className="input"
                  value={bankHolderDoc}
                  onChange={(e) => setBankHolderDoc(e.target.value)}
                />
              </label>
              <label className="block">
                <div className="text-xs text-mute mb-1">Observación (opcional)</div>
                <textarea
                  className="input"
                  rows={2}
                  value={bankNote}
                  onChange={(e) => setBankNote(e.target.value)}
                />
              </label>
            </div>
          )}
        </div>
        <div className="sticky bottom-0 bg-white border-t border-line px-5 py-3 flex gap-2 justify-end">
          <button onClick={onClose} className="btn-ghost text-sm">
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="btn-primary text-sm"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}
