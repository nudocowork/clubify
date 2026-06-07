'use client';
/**
 * /admin/payouts — Panel SUPER_ADMIN para pagar comisiones.
 *
 * Tabs:
 *   1. Listo por pagar — afiliados con >= 50 USD + perfil aprobado.
 *   2. Perfiles de pago — pending para aprobar/rechazar.
 *
 * Fase D 2026-06-07.
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { FileUploader } from '@/components/FileUploader';

type Method = 'BINANCE' | 'BANK';
type ProfileStatus = 'NONE' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

type ReadyRow = {
  userId: string;
  fullName: string;
  email: string;
  role: string;
  method: Method;
  availableUsd: number;
  codes: Array<{ id: string; code: string; role: string }>;
  profile: any;
  hasOpenPayout: boolean;
};

type ProfileRow = {
  id: string;
  userId: string;
  status: ProfileStatus;
  method: Method | null;
  firstName: string | null;
  lastName: string | null;
  binanceEmail: string | null;
  bankName: string | null;
  bankAccountNo: string | null;
  bankHolderName: string | null;
  rejectionReason: string | null;
  updatedAt: string;
  reviewedAt: string | null;
  user: { id: string; fullName: string; email: string; role: string };
  reviewedBy: { id: string; fullName: string } | null;
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

const ROLE_LABEL: Record<string, string> = {
  AFFILIATE_INFLUENCER: 'Influencer',
  AFFILIATE_AMBASSADOR: 'Embajador',
  AFFILIATE_VENDOR: 'Vendedor',
  AFFILIATE_SOCIO: 'Socio',
};

export default function AdminPayoutsPage() {
  const [tab, setTab] = useState<'ready' | 'profiles'>('ready');
  return (
    <div className="max-w-6xl">
      <div className="page-head">
        <h1 className="page-title">💰 Pagos a afiliados</h1>
      </div>
      <div className="border-b border-line mb-4 flex gap-1">
        <button
          onClick={() => setTab('ready')}
          className={`tab ${tab === 'ready' ? 'tab-active' : ''}`}
        >
          ⏰ Listo por pagar
        </button>
        <button
          onClick={() => setTab('profiles')}
          className={`tab ${tab === 'profiles' ? 'tab-active' : ''}`}
        >
          📋 Perfiles de pago
        </button>
      </div>
      {tab === 'ready' ? <ReadyTab /> : <ProfilesTab />}
    </div>
  );
}

function ReadyTab() {
  const [data, setData] = useState<{
    items: ReadyRow[];
    total: number;
    grandTotalUsd: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<ReadyRow | null>(null);

  async function load() {
    setLoading(true);
    try {
      setData(await api('/admin/payouts/ready-to-pay'));
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
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <KpiCard
          label="Personas listas"
          value={data?.total ?? 0}
        />
        <KpiCard
          label="Total a pagar"
          value={fmtUsd(data?.grandTotalUsd ?? 0)}
          accent="amber"
        />
        <KpiCard
          label="Promedio por persona"
          value={fmtUsd(
            data && data.total > 0 ? data.grandTotalUsd / data.total : 0,
          )}
        />
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Persona</th>
                <th className="px-4 py-3">Rol</th>
                <th className="px-4 py-3">Método</th>
                <th className="px-4 py-3 text-right">Monto</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-mute">
                    Cargando…
                  </td>
                </tr>
              )}
              {!loading && (data?.items.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-mute">
                    <div className="text-3xl mb-2">🎉</div>
                    <div className="font-semibold text-ink">
                      No hay nadie listo por pagar
                    </div>
                    <div className="text-xs mt-1">
                      Hay que esperar que acumulen mínimo 50 USD y completen
                      datos.
                    </div>
                  </td>
                </tr>
              )}
              {!loading &&
                data?.items.map((r) => (
                  <tr
                    key={r.userId}
                    className="border-t border-line2 hover:bg-bg2/40"
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold">{r.fullName}</div>
                      <div className="text-xs text-mute">{r.email}</div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {ROLE_LABEL[r.role] ?? r.role}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {r.method === 'BINANCE' ? '🪙 Binance' : '🏦 Banco'}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-amber-700">
                      {fmtUsd(r.availableUsd)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setTarget(r)}
                        className="text-xs px-3 py-1.5 rounded-md bg-brand text-white font-semibold hover:opacity-90"
                      >
                        {r.hasOpenPayout ? 'Continuar pago' : 'Pagar'}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {target && (
        <PayoutModal
          target={target}
          onClose={() => setTarget(null)}
          onDone={() => {
            setTarget(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function ProfilesTab() {
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setRows(await api(`/admin/payouts/profiles?filter=${filter}`));
    } catch (e: any) {
      toast(e?.message ?? 'Error cargando', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, [filter]);

  async function review(row: ProfileRow, approve: boolean) {
    let reason: string | null = null;
    if (!approve) {
      reason = prompt('Motivo del rechazo (opcional):') ?? '';
    }
    try {
      await api(`/admin/payouts/profiles/${row.userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ approve, rejectionReason: reason }),
      });
      toast(approve ? 'Perfil aprobado' : 'Perfil rechazado', 'success');
      load();
    } catch (e: any) {
      toast(e?.message ?? 'Error', 'error');
    }
  }

  return (
    <div>
      <div className="mb-3 inline-flex bg-bg2 rounded-pill p-1 text-sm font-semibold">
        <button
          onClick={() => setFilter('pending')}
          className={`px-4 py-1 rounded-pill ${
            filter === 'pending' ? 'bg-white shadow-sm' : 'text-mute'
          }`}
        >
          Pendientes
        </button>
        <button
          onClick={() => setFilter('all')}
          className={`px-4 py-1 rounded-pill ${
            filter === 'all' ? 'bg-white shadow-sm' : 'text-mute'
          }`}
        >
          Todos
        </button>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Persona</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Método</th>
                <th className="px-4 py-3">Datos clave</th>
                <th className="px-4 py-3">Actualizado</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-mute">
                    Cargando…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-mute">
                    Sin perfiles para mostrar.
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((r) => (
                  <tr key={r.id} className="border-t border-line2">
                    <td className="px-4 py-3">
                      <div className="font-semibold">{r.user.fullName}</div>
                      <div className="text-xs text-mute">{r.user.email}</div>
                      <div className="text-[10px] text-mute">
                        {ROLE_LABEL[r.user.role] ?? r.user.role}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <ProfileBadge status={r.status} />
                      {r.rejectionReason && (
                        <div className="text-[10px] text-red-700 mt-1">
                          {r.rejectionReason}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {r.method === 'BINANCE'
                        ? '🪙 Binance'
                        : r.method === 'BANK'
                        ? '🏦 Cuenta'
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {r.method === 'BINANCE' ? (
                        <div className="text-mute">{r.binanceEmail}</div>
                      ) : r.method === 'BANK' ? (
                        <div>
                          <div className="text-mute">{r.bankName}</div>
                          <div className="text-[10px] text-mute font-mono">
                            ···{r.bankAccountNo?.slice(-4) ?? ''}
                          </div>
                          <div className="text-[10px] text-mute">
                            {r.bankHolderName}
                          </div>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">{fmtDate(r.updatedAt)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {r.status === 'PENDING_REVIEW' ||
                      r.status === 'REJECTED' ? (
                        <button
                          onClick={() => review(r, true)}
                          className="text-xs px-2 py-1 rounded bg-emerald-600 text-white font-semibold mr-1"
                        >
                          Aprobar
                        </button>
                      ) : null}
                      {r.status === 'APPROVED' ||
                      r.status === 'PENDING_REVIEW' ? (
                        <button
                          onClick={() => review(r, false)}
                          className="text-xs px-2 py-1 rounded bg-red-600 text-white font-semibold"
                        >
                          Rechazar
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ProfileBadge({ status }: { status: ProfileStatus }) {
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
      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${cls[status]}`}
    >
      {label[status]}
    </span>
  );
}

function KpiCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: 'amber';
}) {
  return (
    <div className="card card-pad">
      <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
        {label}
      </div>
      <div
        className={`text-2xl font-bold mt-1 ${
          accent === 'amber' ? 'text-amber-700' : ''
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function PayoutModal({
  target,
  onClose,
  onDone,
}: {
  target: ReadyRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<'confirm' | 'proof'>('confirm');
  const [payoutId, setPayoutId] = useState<string | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofMime, setProofMime] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  async function createPayout() {
    setSaving(true);
    try {
      const res = await api<{ id: string }>(
        `/admin/payouts/users/${target.userId}/create`,
        { method: 'POST' },
      );
      setPayoutId(res.id);
      setStep('proof');
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo crear el payout', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function markPaid() {
    if (!payoutId || !proofUrl) {
      toast('Subí el comprobante antes de marcar como pagado', 'error');
      return;
    }
    setSaving(true);
    try {
      await api(`/admin/payouts/${payoutId}/mark-paid`, {
        method: 'POST',
        body: JSON.stringify({
          proofUrl,
          proofMimeType: proofMime ?? undefined,
          notes: notes.trim() || undefined,
        }),
      });
      toast('Pago marcado como completado', 'success');
      onDone();
    } catch (e: any) {
      toast(e?.message ?? 'Error', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92dvh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-line px-5 py-3 flex items-center justify-between">
          <div className="font-semibold">Pagar a {target.fullName}</div>
          <button onClick={onClose} className="text-mute hover:text-ink text-xl">
            ×
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="text-sm">
            <div>
              Monto: <span className="font-bold">{fmtUsd(target.availableUsd)}</span>
            </div>
            <div className="text-mute text-xs mt-0.5">
              Método: {target.method === 'BINANCE' ? 'Binance' : 'Cuenta bancaria'}
            </div>
          </div>
          {step === 'confirm' && (
            <>
              <div className="card card-pad bg-bg2/40 text-xs">
                <div className="font-semibold mb-1">Datos del titular</div>
                <div>
                  {target.profile?.firstName} {target.profile?.lastName}
                </div>
                <div className="text-mute">
                  {target.profile?.phoneCountry} {target.profile?.phone}
                </div>
                {target.method === 'BINANCE' && (
                  <div className="mt-2">
                    <div className="font-semibold">Binance</div>
                    <div>📧 {target.profile?.binanceEmail}</div>
                    {target.profile?.binanceNote && (
                      <div className="text-mute italic mt-1">
                        {target.profile.binanceNote}
                      </div>
                    )}
                  </div>
                )}
                {target.method === 'BANK' && (
                  <div className="mt-2">
                    <div className="font-semibold">Cuenta bancaria</div>
                    <div>{target.profile?.bankName} · {target.profile?.bankCountry}</div>
                    <div className="font-mono">
                      {target.profile?.bankAccountType} · {target.profile?.bankAccountNo}
                    </div>
                    <div>{target.profile?.bankHolderName}</div>
                    {target.profile?.bankHolderDoc && (
                      <div className="text-mute">Doc: {target.profile.bankHolderDoc}</div>
                    )}
                    {target.profile?.bankNote && (
                      <div className="text-mute italic mt-1">
                        {target.profile.bankNote}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={createPayout}
                disabled={saving || target.hasOpenPayout}
                className="btn-primary w-full"
              >
                {target.hasOpenPayout
                  ? 'Ya hay un payout abierto — continuá abajo'
                  : saving
                  ? 'Creando…'
                  : '1. Crear payout (bloquea las comisiones)'}
              </button>
            </>
          )}
          {step === 'proof' && (
            <>
              <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-900">
                Payout creado. Ahora transferí el dinero y subí el comprobante
                acá para cerrar el ciclo.
              </div>
              <div>
                <div className="text-xs text-mute mb-1">
                  Comprobante (imagen o PDF, máx 30 MB) *
                </div>
                <FileUploader
                  value={proofUrl}
                  contentType={proofMime}
                  folder="payouts"
                  kind="any"
                  onChange={(url, meta) => {
                    setProofUrl(url);
                    setProofMime(meta?.contentType ?? null);
                  }}
                />
              </div>
              <label className="block">
                <div className="text-xs text-mute mb-1">
                  Notas internas (opcional)
                </div>
                <textarea
                  className="input"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              <button
                onClick={markPaid}
                disabled={saving || !proofUrl}
                className="btn-primary w-full"
              >
                {saving ? 'Guardando…' : '2. Marcar como pagado'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
