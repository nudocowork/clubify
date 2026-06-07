'use client';
/**
 * Página dedicada de una campaña — supera al modal con vista completa:
 * mini dashboard de KPIs, lista detallada de embajadores con métricas,
 * historial de comisiones de la campaña.
 */
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { PhoneInput } from '@/components/PhoneInput';
import { AffiliateCredentialsModal } from '@/components/AffiliateCredentialsModal';
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import {
  CommissionExceptionModal,
  CommissionExceptionHistoryDrawer,
  type AttributionLevel,
  type ExistingException,
} from '@/components/CommissionExceptionModal';

type Detail = {
  id: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'FINISHED';
  createdAt: string;
  ownerCode: {
    id: string;
    code: string;
    slug?: string | null;
    ownerName: string;
    ownerEmail: string;
    ownerWhatsapp: string;
    commissionPercent: any;
    uses: any[];
  };
  codes: Array<{
    id: string;
    code: string;
    slug?: string | null;
    ownerName: string;
    ownerEmail: string;
    commissionPercent: any;
    isActive: boolean;
    approvedAt: string | null;
    uses: any[];
  }>;
};

const STATUS_PILL: Record<Detail['status'], { text: string; cls: string }> = {
  ACTIVE: { text: 'Activa', cls: 'bg-ok-soft text-ok' },
  PAUSED: { text: 'Pausada', cls: 'bg-amber-100 text-amber-800' },
  FINISHED: { text: 'Finalizada', cls: 'bg-bg2 text-mute' },
};

function fmtUsd(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}
function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function CampaignDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({
    fullName: '',
    email: '',
    whatsapp: '',
    commissionPercent: 25,
    customCode: '',
    password: '',
  });
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setData(await api<Detail>(`/campaigns/${id}`));
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function setStatus(status: Detail['status']) {
    await api(`/campaigns/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    toast('Estado actualizado', 'success');
    load();
  }

  async function patchCampaign(
    patch: Partial<{ name: string; ownerCommissionPercent: number }>,
  ) {
    try {
      const res = await api<{
        recalc?: { updated: number; skippedPaid: number; affectedAmount: number } | null;
      }>(`/campaigns/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      if (res?.recalc && res.recalc.updated > 0) {
        toast(
          `Cambios guardados. ${res.recalc.updated} comisiones recalculadas` +
            (res.recalc.skippedPaid > 0
              ? ` (${res.recalc.skippedPaid} ya pagadas quedaron intactas).`
              : '.'),
          'success',
        );
      } else {
        toast('Cambios guardados', 'success');
      }
      load();
    } catch (e: any) {
      toast(e.message ?? 'No se pudo guardar', 'error');
    }
  }

  const [ambCreds, setAmbCreds] = useState<{
    email: string;
    password: string;
    loginUrl: string;
    fullName: string;
    whatsapp: string;
  } | null>(null);
  const [showDelete, setShowDelete] = useState(false);

  async function addAmbassador(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api<any>(`/campaigns/${id}/ambassadors`, {
        method: 'POST',
        body: JSON.stringify(addForm),
      });
      const saved = { ...addForm };
      setAddForm({ fullName: '', email: '', whatsapp: '', commissionPercent: 25, customCode: '', password: '' });
      setShowAdd(false);
      load();
      if (res?.affiliateCredentials) {
        setAmbCreds({
          ...res.affiliateCredentials,
          fullName: saved.fullName,
          whatsapp: saved.whatsapp,
        });
      } else {
        toast('Embajador agregado', 'success');
      }
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeAmbassador(ambId: string) {
    if (!confirm('¿Desactivar este embajador? El historial se conserva.')) return;
    await api(`/campaigns/ambassadors/${ambId}`, { method: 'DELETE' });
    toast('Embajador desactivado', 'success');
    load();
  }

  if (loading || !data) return <div className="p-8 text-mute">Cargando…</div>;

  // Métricas calculadas
  const allUses = [
    ...data.ownerCode.uses,
    ...data.codes.flatMap((c) => c.uses),
  ];
  const allCommissions = allUses.flatMap((u: any) => u.commissions ?? []);
  const round = (n: number) => Math.round(n * 100) / 100;
  const directClients = data.ownerCode.uses.length;
  const indirectClients = data.codes.reduce((s, a) => s + a.uses.length, 0);
  const activeClients = allUses.filter(
    (u: any) => u.status === 'PAYING' || u.status === 'ACTIVE',
  ).length;
  const churnedClients = allUses.filter((u: any) => u.status === 'CHURNED').length;
  const totalCommissionsUsd = round(
    allCommissions.reduce((s: number, c: any) => s + Number(c.amount), 0),
  );
  const paidUsd = round(
    allCommissions
      .filter((c: any) => c.status === 'PAID')
      .reduce((s: number, c: any) => s + Number(c.amount), 0),
  );
  const pendingUsd = round(
    allCommissions
      .filter((c: any) => c.status === 'PENDING' || c.status === 'APPROVED')
      .reduce((s: number, c: any) => s + Number(c.amount), 0),
  );

  return (
    <div>
      <div className="page-head flex-wrap gap-3">
        <div className="flex-1 min-w-[260px]">
          <Link href="/admin/referrals" className="text-xs text-mute hover:text-ink">
            ← Volver
          </Link>
          <h1 className="page-title m-0 mt-1">{data.name}</h1>
          <div className="flex items-center gap-2 mt-2">
            <span
              className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${STATUS_PILL[data.status].cls}`}
            >
              {STATUS_PILL[data.status].text}
            </span>
            <span className="text-xs text-mute">Creada {fmtDate(data.createdAt)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {data.status !== 'ACTIVE' && (
            <button onClick={() => setStatus('ACTIVE')} className="btn-ghost text-sm">
              Activar
            </button>
          )}
          {data.status !== 'PAUSED' && (
            <button onClick={() => setStatus('PAUSED')} className="btn-ghost text-sm">
              Pausar
            </button>
          )}
          {data.status !== 'FINISHED' && (
            <button onClick={() => setStatus('FINISHED')} className="btn-ghost text-sm">
              Finalizar
            </button>
          )}
          <button
            onClick={() => setShowDelete(true)}
            className="text-sm font-semibold px-3 py-1.5 rounded-md bg-red-100 text-red-700 hover:bg-red-200"
            title="Eliminar la campaña (valida que no haya tenants activos)"
          >
            🗑 Eliminar
          </button>
        </div>
      </div>
      {showDelete && (
        <ConfirmDeleteModal
          title={`Eliminar campaña "${data.name}"`}
          description={
            <>
              ¿Deseas eliminar este registro? Si el influencer titular o
              sus embajadores tienen tenants en estado{' '}
              <strong>activo o pagando</strong>,{' '}
              <strong>no se podrá eliminar</strong> — recibirás un aviso con
              la cantidad. El influencer titular queda como influencer sin
              campaña; los embajadores se desactivan para preservar
              historial.
            </>
          }
          onConfirm={async () => {
            try {
              await api(`/campaigns/${id}`, { method: 'DELETE' });
              toast(`Campaña "${data.name}" eliminada`, 'success');
              router.push('/admin/referrals');
            } catch (e: any) {
              toast(e.message || 'No se pudo eliminar', 'error');
            }
          }}
          onClose={() => setShowDelete(false)}
        />
      )}

      {/* Mini dashboard */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 mb-5">
        <Stat label="Clientes activos" value={String(activeClients)} tone="ok" />
        <Stat label="Total clientes" value={String(directClients + indirectClients)} />
        <Stat label="Cancelados" value={String(churnedClients)} />
        <Stat label="Embajadores" value={String(data.codes.length)} />
        <Stat label="Comisiones generadas" value={fmtUsd(totalCommissionsUsd)} tone="brand" />
        <Stat label="Pagado" value={fmtUsd(paidUsd)} tone="ok" />
        <Stat label="Pendiente" value={fmtUsd(pendingUsd)} tone="amber" />
        <Stat
          label="Directos vs indirectos"
          value={`${directClients} / ${indirectClients}`}
        />
      </div>

      {/* Configuración editable */}
      <CampaignSettings data={data} onPatch={patchCampaign} />

      {/* Influencer titular + link */}
      <div className="card card-pad mb-5 bg-bg2/40">
        <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1">
          Influencer titular
        </div>
        <div className="font-semibold text-base">{data.ownerCode.ownerName}</div>
        <div className="text-xs text-mute">
          {data.ownerCode.ownerEmail} · {data.ownerCode.ownerWhatsapp}
        </div>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center gap-2 bg-white px-3 py-2 rounded-lg">
            <span className="font-mono font-bold text-lg">{data.ownerCode.code}</span>
            <span className="text-xs text-mute">
              · {Number(data.ownerCode.commissionPercent)}% comisión afiliado
            </span>
          </div>
        </div>
        <CampaignShareLink code={data.ownerCode.code} slug={data.ownerCode.slug ?? null} />
        <AmbassadorApplyLink code={data.ownerCode.code} />
      </div>

      {/* Embajadores */}
      <div className="card card-pad mb-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold m-0">
            Embajadores ({data.codes.length})
          </h2>
          <button onClick={() => setShowAdd(!showAdd)} className="btn-ghost text-sm">
            {showAdd ? 'Cancelar' : '+ Embajador'}
          </button>
        </div>

        {showAdd && (
          <form
            onSubmit={addAmbassador}
            className="border border-line rounded-lg p-3 mb-3 space-y-2 bg-bg2/30"
          >
            <div className="grid grid-cols-2 gap-2">
              <input
                className="input"
                placeholder="Nombre"
                required
                value={addForm.fullName}
                onChange={(e) => setAddForm({ ...addForm, fullName: e.target.value })}
              />
              <input
                className="input"
                type="email"
                placeholder="Email"
                required
                value={addForm.email}
                onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
              />
            </div>
            <div>
              <PhoneInput
                value={addForm.whatsapp}
                onChange={(v) => setAddForm({ ...addForm, whatsapp: v })}
                placeholder="WhatsApp del embajador"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                className="input"
                type="number"
                min={0}
                max={100}
                placeholder="% comisión"
                value={addForm.commissionPercent}
                onChange={(e) => setAddForm({ ...addForm, commissionPercent: Number(e.target.value) })}
              />
              <input
                className="input"
                placeholder="Código (opcional)"
                value={addForm.customCode}
                onChange={(e) => setAddForm({ ...addForm, customCode: e.target.value.toUpperCase() })}
              />
            </div>
            <input
              className="input"
              type="text"
              required
              minLength={8}
              maxLength={64}
              placeholder="Contraseña de acceso (mín 8 caracteres)"
              value={addForm.password}
              onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
            />
            <button type="submit" disabled={busy} className="btn-primary text-sm w-full">
              {busy ? 'Agregando…' : 'Agregar embajador'}
            </button>
          </form>
        )}

        {data.codes.length === 0 ? (
          <div className="text-center py-8 text-mute text-sm">
            Sin embajadores aún
          </div>
        ) : (
          <div className="space-y-2">
            {data.codes.map((amb) => {
              const ambUses = amb.uses ?? [];
              const ambComm = (ambUses as any[])
                .flatMap((u) => u.commissions ?? [])
                .reduce((s, c) => s + Number(c.amount), 0);
              return (
                <div
                  key={amb.id}
                  className={`border border-line rounded-lg p-3 flex items-center justify-between gap-3 ${
                    amb.isActive ? '' : 'opacity-50'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate flex items-center gap-2">
                      {amb.ownerName}
                      {!amb.approvedAt && (
                        <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                          Pendiente
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-mute truncate">{amb.ownerEmail}</div>
                  </div>
                  <div className="font-mono font-bold text-sm bg-bg2 px-2 py-1 rounded">
                    {amb.code}
                  </div>
                  <div className="text-xs text-mute whitespace-nowrap text-right">
                    <div>{Number(amb.commissionPercent)}% · {ambUses.length} clientes</div>
                    <div className="text-brand font-semibold">{fmtUsd(round(ambComm))}</div>
                  </div>
                  {amb.isActive && (
                    <button
                      onClick={() => removeAmbassador(amb.id)}
                      className="text-mute hover:text-bad text-lg leading-none"
                      aria-label="Desactivar"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Item 6 sprint: comisiones por cliente con excepciones individuales. */}
      <ClientsCommissionsSection campaignId={id} />

      {ambCreds && (
        <AffiliateCredentialsModal
          credentials={ambCreds}
          whoLabel={`embajador ${ambCreds.fullName}`}
          whatsapp={ambCreds.whatsapp}
          onClose={() => setAmbCreds(null)}
        />
      )}
    </div>
  );
}

type CampaignClient = {
  tenantId: string;
  brandName: string;
  status: string;
  email: string | null;
  attributions: AttributionLevel[];
  exceptions: ExistingException[];
  breakdown?: {
    revenueUsd: number;
    commissionsUsd: number;
    paidUsd: number;
    pendingUsd: number;
    netUsd: number;
    cyclesCount: number;
  };
};

function ClientsCommissionsSection({ campaignId }: { campaignId: string }) {
  const [clients, setClients] = useState<CampaignClient[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CampaignClient | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await api<{ items: CampaignClient[] }>(
        `/admin/commission-exceptions?campaignId=${encodeURIComponent(campaignId)}${
          q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''
        }`,
      );
      setClients(res.items);
    } catch (e: any) {
      setError(e.message ?? 'No se pudo cargar el listado');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  // Refresca de los reportes scoped al cliente cuando se guarda una
  // excepción — listar comisiones del tenant para cache busted.
  async function bustTenantReportsCache(tenantId: string) {
    try {
      await api(`/admin/commissions?tenantId=${tenantId}&_=${Date.now()}`).catch(() => null);
    } catch {
      /* best-effort: el endpoint puede no existir según versión del panel */
    }
  }

  return (
    <div className="card card-pad mb-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h2 className="font-semibold m-0">
          Clientes atribuidos ({clients?.length ?? 0})
        </h2>
        <input
          className="input text-sm max-w-xs"
          placeholder="Buscar por nombre o email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') load();
          }}
        />
      </div>

      {error && (
        <div className="text-xs text-bad bg-bad-soft/40 rounded-md px-3 py-2 mb-2">
          {error}
        </div>
      )}

      {!clients ? (
        <div className="text-sm text-mute py-6 text-center">Cargando…</div>
      ) : clients.length === 0 ? (
        <div className="text-sm text-mute py-6 text-center">
          Sin clientes atribuidos a esta campaña aún.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-mute border-b border-line2">
                <th className="py-2 pr-3">Cliente</th>
                <th className="py-2 pr-3">Atribución</th>
                <th className="py-2 pr-3">Comisión</th>
                <th className="py-2 pr-3 text-right" title="Lo que el cliente le pagó a Clubify (bundle × ciclos)">
                  Entró
                </th>
                <th className="py-2 pr-3 text-right" title="Total de comisiones generadas">
                  Comisión
                </th>
                <th className="py-2 pr-3 text-right" title="Entró − Comisión = lo que retiene la empresa">
                  Quedó
                </th>
                <th className="py-2 pr-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => {
                // Si hay más de una atribución, mostramos el directo más
                // grande (= el con mayor % default) como "principal".
                const principalAttr = [...c.attributions].sort(
                  (a, b) => b.defaultPercent - a.defaultPercent,
                )[0];
                const principalException = principalAttr
                  ? c.exceptions.find(
                      (e) => e.recipientCodeId === principalAttr.codeId && e.isActive,
                    )
                  : null;
                return (
                  <tr key={c.tenantId} className="border-b border-line2/40 last:border-b-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium truncate max-w-[200px]">
                        {c.brandName}
                      </div>
                      <div className="text-xs text-mute truncate max-w-[200px]">
                        {c.email ?? '—'}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      {c.attributions.length === 0 ? (
                        <span className="text-mute text-xs">Sin atribución</span>
                      ) : (
                        <div className="space-y-0.5">
                          {c.attributions.map((a) => (
                            <div key={a.codeId} className="text-xs">
                              <span className="font-mono">{a.code}</span>
                              <span className="text-mute"> · {a.ownerName}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {principalAttr ? (
                        principalException ? (
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold">
                              {principalException.customPercent}%
                            </span>
                            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                              Excepción
                            </span>
                            <span title="Excepción activa" aria-hidden>
                              ✏️
                            </span>
                          </div>
                        ) : (
                          <div className="text-xs">
                            <span className="font-semibold">
                              {principalAttr.defaultPercent}%
                            </span>{' '}
                            <span className="text-mute">(campaña)</span>
                          </div>
                        )
                      ) : (
                        <span className="text-mute text-xs">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap font-mono text-xs">
                      {c.breakdown ? fmtUsd(c.breakdown.revenueUsd) : '—'}
                      {c.breakdown && c.breakdown.cyclesCount > 0 && (
                        <div className="text-[10px] text-mute font-sans">
                          {c.breakdown.cyclesCount} ciclo
                          {c.breakdown.cyclesCount === 1 ? '' : 's'}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap font-mono text-xs">
                      {c.breakdown ? fmtUsd(c.breakdown.commissionsUsd) : '—'}
                      {c.breakdown && c.breakdown.pendingUsd > 0 && (
                        <div className="text-[10px] text-amber-700 font-sans">
                          {fmtUsd(c.breakdown.pendingUsd)} pendiente
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap font-mono text-xs">
                      <span
                        className={
                          c.breakdown && c.breakdown.netUsd > 0
                            ? 'text-emerald-700 font-semibold'
                            : 'text-mute'
                        }
                      >
                        {c.breakdown ? fmtUsd(c.breakdown.netUsd) : '—'}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => setEditing(c)}
                        className="btn-ghost text-xs"
                      >
                        Editar comisión
                      </button>
                      {principalException && (
                        <button
                          onClick={() => setHistoryFor(principalException.id)}
                          className="btn-ghost text-xs ml-1"
                          title="Ver historial"
                        >
                          📜
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <CommissionExceptionModal
          tenantId={editing.tenantId}
          brandName={editing.brandName}
          attributions={editing.attributions}
          exceptions={editing.exceptions}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await bustTenantReportsCache(editing.tenantId);
            await load();
          }}
        />
      )}

      {historyFor && (
        <CommissionExceptionHistoryDrawer
          exceptionId={historyFor}
          onClose={() => setHistoryFor(null)}
        />
      )}
    </div>
  );
}

/** Edición del nombre de la campaña. */
function CampaignSettings({
  data,
  onPatch,
}: {
  data: { name: string; ownerCode: { commissionPercent: any } };
  onPatch: (
    patch: Partial<{ name: string; ownerCommissionPercent: number }>,
  ) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(data.name);
  const [pct, setPct] = useState(Number(data.ownerCode.commissionPercent));

  useEffect(() => {
    setName(data.name);
    setPct(Number(data.ownerCode.commissionPercent));
  }, [data.name, data.ownerCode.commissionPercent]);

  async function save() {
    const patch: Partial<{ name: string; ownerCommissionPercent: number }> = {};
    if (name.trim() && name !== data.name) patch.name = name.trim();
    const currentPct = Number(data.ownerCode.commissionPercent);
    if (Number.isFinite(pct) && pct >= 0 && pct <= 100 && pct !== currentPct) {
      patch.ownerCommissionPercent = pct;
    }
    if (Object.keys(patch).length > 0) {
      await onPatch(patch);
    }
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="card card-pad mb-5 flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1">
            Configuración
          </div>
          <div className="text-sm">Nombre: {data.name}</div>
          <div className="text-sm">
            % comisión influencer: {Number(data.ownerCode.commissionPercent)}%
          </div>
        </div>
        <button onClick={() => setEditing(true)} className="btn-ghost text-sm">
          Editar
        </button>
      </div>
    );
  }

  return (
    <div className="card card-pad mb-5 space-y-3">
      <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
        Editar campaña
      </div>
      <label className="block">
        <div className="text-xs text-mute mb-1">Nombre</div>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="block">
        <div className="text-xs text-mute mb-1">% comisión del influencer</div>
        <input
          className="input"
          type="number"
          min={0}
          max={100}
          step={0.01}
          value={pct}
          onChange={(e) => setPct(Number(e.target.value))}
        />
        <div className="text-[10px] text-mute mt-1">
          Aplica a comisiones futuras del influencer titular. Las ya pagadas
          quedan intactas.
        </div>
      </label>
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => {
            setEditing(false);
            setName(data.name);
            setPct(Number(data.ownerCode.commissionPercent));
          }}
          className="btn-ghost text-sm"
        >
          Cancelar
        </button>
        <button onClick={save} className="btn-primary text-sm">
          Guardar
        </button>
      </div>
    </div>
  );
}

/** Link de postulación de embajadores. Item 18 — cualquier persona con
 *  este link puede aplicar como embajador de la campaña vía form
 *  público en /refer/[code]. */
function AmbassadorApplyLink({ code }: { code: string }) {
  const link =
    typeof window !== 'undefined'
      ? `${window.location.origin}/refer/${code}`
      : '';
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toast('Link copiado', 'success');
    } catch {
      toast('No se pudo copiar', 'error');
    }
  }
  const waText = encodeURIComponent(
    `Únete como embajador de mi campaña en Clubify y gana comisiones por cada negocio que registres: ${link}`,
  );
  return (
    <div className="mt-3 pt-3 border-t border-line2">
      <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1.5">
        Link de postulación · embajadores
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={link}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
          className="input flex-1 min-w-[240px] font-mono text-xs"
        />
        <button onClick={copy} className="btn-ghost text-xs">
          Copiar
        </button>
        <a
          href={`https://wa.me/?text=${waText}`}
          target="_blank"
          rel="noreferrer"
          className="btn-ghost text-xs"
        >
          💬 WhatsApp
        </a>
      </div>
      <div className="text-[11px] text-mute mt-1.5 leading-relaxed">
        Cualquier persona con este link puede postularse como embajador.
        Si tienes <code>referrals.requireAmbassadorApproval</code>{' '}
        activado, aparecerá en la lista de pendientes para revisar antes
        de activar.
      </div>
    </div>
  );
}

/** Link corto público para que el influencer comparta con sus seguidores.
 *  Usa `/ref/<slug>` si hay slug definido (más memorable), fallback a
 *  `/signup?ref=CODE`. El backend loguea visita en ReferralVisit. */
function CampaignShareLink({ code, slug }: { code: string; slug: string | null }) {
  const link =
    typeof window !== 'undefined'
      ? slug
        ? `${window.location.origin}/ref/${slug}`
        : `${window.location.origin}/signup?ref=${code}`
      : '';
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toast('Link copiado', 'success');
    } catch {
      toast('No se pudo copiar', 'error');
    }
  }
  const waText = encodeURIComponent(
    `Te invito a sumarte a Clubify usando mi código ${code}: ${link}`,
  );
  return (
    <div className="mt-3 pt-3 border-t border-line2">
      <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1.5">
        Link de la campaña
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={link}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
          className="input flex-1 min-w-[240px] font-mono text-xs"
        />
        <button onClick={copy} className="btn-ghost text-xs">
          Copiar
        </button>
        <a
          href={`https://wa.me/?text=${waText}`}
          target="_blank"
          rel="noreferrer"
          className="btn-ghost text-xs"
        >
          💬 WhatsApp
        </a>
      </div>
      <div className="text-[11px] text-mute mt-1.5 leading-relaxed">
        El cliente que abra este link verá <code>{code}</code> precargado
        en el form de signup — se atribuye automáticamente a esta campaña.
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'amber' | 'brand';
}) {
  const cls =
    tone === 'ok'
      ? 'text-ok'
      : tone === 'amber'
      ? 'text-amber-700'
      : tone === 'brand'
      ? 'text-brand'
      : 'text-ink';
  return (
    <div className="card card-pad">
      <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
        {label}
      </div>
      <div className={`text-xl font-bold mt-1 ${cls}`}>{value}</div>
    </div>
  );
}
