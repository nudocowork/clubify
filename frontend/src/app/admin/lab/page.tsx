'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import {
  CATEGORY_META,
  STATUS_META,
  formatRelative,
  type LabCategory,
  type LabStatus,
  type Proposal,
} from '../../lab/_shared';

type Tab = 'pending' | 'all' | 'metrics' | 'topVoted';

type Metrics = {
  totals: {
    total: number;
    pending: number;
    evaluating: number;
    approved: number;
    inDevelopment: number;
    inTesting: number;
    implemented: number;
    rejected: number;
  };
  byCategory: Record<string, number>;
  mostActiveCategory: string | null;
  topContributors: Array<{
    userId: string;
    fullName: string;
    role: string | null;
    count: number;
  }>;
  topVoted: Proposal[];
};

const STATUS_OPTIONS: LabStatus[] = [
  'PENDING',
  'EVALUATING',
  'APPROVED',
  'IN_DEVELOPMENT',
  'IN_TESTING',
  'IMPLEMENTED',
  'REJECTED',
];

export default function AdminLabPage() {
  const [tab, setTab] = useState<Tab>('pending');
  const [pending, setPending] = useState<Proposal[] | null>(null);
  const [all, setAll] = useState<Proposal[] | null>(null);
  const [filterStatus, setFilterStatus] = useState<LabStatus | 'ALL'>('ALL');
  const [filterCategory, setFilterCategory] = useState<LabCategory | 'ALL'>('ALL');
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [topVoted, setTopVoted] = useState<Proposal[] | null>(null);
  const [topVotedScope, setTopVotedScope] = useState<'top' | 'topMonth'>('top');
  const [statusModal, setStatusModal] = useState<Proposal | null>(null);
  const [mergeModal, setMergeModal] = useState<Proposal | null>(null);

  async function loadPending() {
    setPending(null);
    try {
      const r = await api<{ items: Proposal[] }>(
        '/admin/lab/proposals?status=PENDING',
      );
      setPending(r.items);
    } catch (e: any) {
      toast(e?.message ?? 'Error', 'error');
      setPending([]);
    }
  }

  async function loadAll() {
    setAll(null);
    try {
      const p = new URLSearchParams();
      if (filterStatus !== 'ALL') p.set('status', filterStatus);
      if (filterCategory !== 'ALL') p.set('category', filterCategory);
      const r = await api<{ items: Proposal[] }>(
        `/admin/lab/proposals?${p.toString()}`,
      );
      setAll(r.items);
    } catch (e: any) {
      toast(e?.message ?? 'Error', 'error');
      setAll([]);
    }
  }

  async function loadMetrics() {
    try {
      const m = await api<Metrics>('/admin/lab/metrics');
      setMetrics(m);
    } catch (e: any) {
      toast(e?.message ?? 'Error', 'error');
    }
  }

  async function loadTopVoted() {
    setTopVoted(null);
    try {
      // Reusamos /lab/proposals con sortBy. Categoría CLIENTS por default —
      // el toggle permite cambiar.
      const params = new URLSearchParams();
      params.set('category', 'CLIENTS');
      params.set('sortBy', topVotedScope);
      const r = await api<{ items: Proposal[] }>(
        `/lab/proposals?${params.toString()}`,
      );
      setTopVoted(r.items.slice(0, 20));
    } catch (e: any) {
      toast(e?.message ?? 'Error', 'error');
      setTopVoted([]);
    }
  }

  useEffect(() => {
    if (tab === 'pending') loadPending();
    if (tab === 'all') loadAll();
    if (tab === 'metrics') loadMetrics();
    if (tab === 'topVoted') loadTopVoted();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, filterStatus, filterCategory, topVotedScope]);

  async function setStatus(
    id: string,
    status: LabStatus,
    reason?: string | null,
  ) {
    try {
      await api(`/admin/lab/proposals/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, reason }),
      });
      toast('Status actualizado', 'success');
      if (tab === 'pending') loadPending();
      else if (tab === 'all') loadAll();
    } catch (e: any) {
      toast(e?.message ?? 'Error', 'error');
    }
  }

  async function deleteProposal(id: string) {
    if (!confirm('¿Eliminar esta propuesta? Esta acción no se puede deshacer.'))
      return;
    try {
      await api(`/admin/lab/proposals/${id}`, { method: 'DELETE' });
      toast('Eliminada', 'success');
      if (tab === 'all') loadAll();
      if (tab === 'pending') loadPending();
    } catch (e: any) {
      toast(e?.message ?? 'Error', 'error');
    }
  }

  return (
    <div className="max-w-6xl">
      <div className="page-head">
        <h1 className="page-title">
          🧪 Clubify Lab <span className="page-crumb">/ Admin</span>
        </h1>
      </div>

      <div className="tabs mb-4 max-w-fit">
        <button
          className={`tab ${tab === 'pending' ? 'tab-active' : ''}`}
          onClick={() => setTab('pending')}
        >
          Pendientes
        </button>
        <button
          className={`tab ${tab === 'all' ? 'tab-active' : ''}`}
          onClick={() => setTab('all')}
        >
          Todas
        </button>
        <button
          className={`tab ${tab === 'metrics' ? 'tab-active' : ''}`}
          onClick={() => setTab('metrics')}
        >
          Métricas
        </button>
        <button
          className={`tab ${tab === 'topVoted' ? 'tab-active' : ''}`}
          onClick={() => setTab('topVoted')}
        >
          🏆 Top votadas
        </button>
      </div>

      {tab === 'pending' && (
        <PendingTab
          items={pending}
          onApprove={(p) => setStatus(p.id, 'EVALUATING')}
          onReject={(p) => setStatusModal(p)}
          onMerge={(p) => setMergeModal(p)}
          onChange={(p) => setStatusModal(p)}
          onDelete={(p) => deleteProposal(p.id)}
        />
      )}

      {tab === 'all' && (
        <AllTab
          items={all}
          filterStatus={filterStatus}
          setFilterStatus={setFilterStatus}
          filterCategory={filterCategory}
          setFilterCategory={setFilterCategory}
          onChangeStatus={(p) => setStatusModal(p)}
          onMerge={(p) => setMergeModal(p)}
          onDelete={(p) => deleteProposal(p.id)}
        />
      )}

      {tab === 'metrics' && <MetricsTab metrics={metrics} />}

      {tab === 'topVoted' && (
        <TopVotedTab
          items={topVoted}
          scope={topVotedScope}
          setScope={setTopVotedScope}
        />
      )}

      {statusModal && (
        <StatusModal
          proposal={statusModal}
          onClose={() => setStatusModal(null)}
          onSubmit={async (status, reason) => {
            await setStatus(statusModal.id, status, reason);
            setStatusModal(null);
          }}
        />
      )}

      {mergeModal && (
        <MergeModal
          src={mergeModal}
          onClose={() => setMergeModal(null)}
          onDone={() => {
            setMergeModal(null);
            if (tab === 'pending') loadPending();
            if (tab === 'all') loadAll();
          }}
        />
      )}
    </div>
  );
}

function ProposalRow({
  proposal,
  actions,
}: {
  proposal: Proposal;
  actions: React.ReactNode;
}) {
  const meta = STATUS_META[proposal.status];
  const cat = CATEGORY_META[proposal.category];
  return (
    <div className="card card-pad">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap gap-1.5 items-center mb-1.5">
            <span className={`badge ${meta.badge}`}>{meta.label}</span>
            <span className="badge badge-mute">
              {cat.emoji} {cat.label}
            </span>
            <span className="text-xs text-mute2">
              {formatRelative(proposal.createdAt)}
            </span>
          </div>
          <h3 className="font-semibold text-base m-0 mb-1">
            <Link
              href={`/lab/${proposal.id}`}
              className="text-ink hover:text-brand no-underline"
            >
              {proposal.title}
            </Link>
          </h3>
          <p className="text-sm text-mute m-0 line-clamp-2">
            {proposal.description}
          </p>
          <div className="text-xs text-mute2 mt-1.5 flex gap-3 flex-wrap">
            <span>Por {proposal.author.fullName}</span>
            <span>🗳 {proposal.votesCount} ({proposal.votesScore} pts)</span>
            <span>💬 {proposal.commentsCount}</span>
          </div>
          {proposal.rejectionReason && (
            <div className="text-xs text-bad-ink mt-1.5">
              Motivo: {proposal.rejectionReason}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">{actions}</div>
      </div>
    </div>
  );
}

function PendingTab({
  items,
  onApprove,
  onReject,
  onMerge,
  onChange,
  onDelete,
}: {
  items: Proposal[] | null;
  onApprove: (p: Proposal) => void;
  onReject: (p: Proposal) => void;
  onMerge: (p: Proposal) => void;
  onChange: (p: Proposal) => void;
  onDelete: (p: Proposal) => void;
}) {
  if (items === null) return <p className="text-mute">Cargando...</p>;
  if (items.length === 0)
    return (
      <p className="text-mute text-sm">
        No hay propuestas pendientes de revisión.
      </p>
    );
  return (
    <div className="grid gap-3">
      {items.map((p) => (
        <ProposalRow
          key={p.id}
          proposal={p}
          actions={
            <>
              <button
                className="btn-primary text-xs"
                onClick={() => onApprove(p)}
              >
                Aprobar
              </button>
              <button className="btn-ghost text-xs" onClick={() => onReject(p)}>
                Rechazar
              </button>
              <button className="btn-ghost text-xs" onClick={() => onMerge(p)}>
                Fusionar
              </button>
              <button className="btn-ghost text-xs" onClick={() => onChange(p)}>
                Otro
              </button>
              <button
                className="btn-ghost text-xs text-bad"
                onClick={() => onDelete(p)}
              >
                Eliminar
              </button>
            </>
          }
        />
      ))}
    </div>
  );
}

function AllTab({
  items,
  filterStatus,
  setFilterStatus,
  filterCategory,
  setFilterCategory,
  onChangeStatus,
  onMerge,
  onDelete,
}: {
  items: Proposal[] | null;
  filterStatus: LabStatus | 'ALL';
  setFilterStatus: (v: LabStatus | 'ALL') => void;
  filterCategory: LabCategory | 'ALL';
  setFilterCategory: (v: LabCategory | 'ALL') => void;
  onChangeStatus: (p: Proposal) => void;
  onMerge: (p: Proposal) => void;
  onDelete: (p: Proposal) => void;
}) {
  return (
    <div>
      <div className="card card-pad mb-3 flex gap-2 items-center flex-wrap">
        <select
          className="input max-w-[200px]"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as LabStatus | 'ALL')}
        >
          <option value="ALL">Todos los status</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </select>
        <select
          className="input max-w-[200px]"
          value={filterCategory}
          onChange={(e) =>
            setFilterCategory(e.target.value as LabCategory | 'ALL')
          }
        >
          <option value="ALL">Todas las categorías</option>
          <option value="CLIENTS">🏢 Negocios</option>
          <option value="AFFILIATES">👥 Embajadores</option>
        </select>
      </div>
      {items === null && <p className="text-mute">Cargando...</p>}
      {items && items.length === 0 && (
        <p className="text-mute text-sm">No hay propuestas.</p>
      )}
      <div className="grid gap-3">
        {items?.map((p) => (
          <ProposalRow
            key={p.id}
            proposal={p}
            actions={
              <>
                <button
                  className="btn-ghost text-xs"
                  onClick={() => onChangeStatus(p)}
                >
                  Cambiar estado
                </button>
                <button className="btn-ghost text-xs" onClick={() => onMerge(p)}>
                  Fusionar
                </button>
                <button
                  className="btn-ghost text-xs text-bad"
                  onClick={() => onDelete(p)}
                >
                  Eliminar
                </button>
              </>
            }
          />
        ))}
      </div>
    </div>
  );
}

function MetricsTab({ metrics }: { metrics: Metrics | null }) {
  if (!metrics) return <p className="text-mute">Cargando...</p>;
  const t = metrics.totals;
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total ideas" value={t.total} />
        <KpiCard label="Pendientes" value={t.pending} />
        <KpiCard label="En evaluación" value={t.evaluating} />
        <KpiCard label="Aprobadas" value={t.approved} />
        <KpiCard label="En desarrollo" value={t.inDevelopment} />
        <KpiCard label="En pruebas" value={t.inTesting} />
        <KpiCard label="Implementadas" value={t.implemented} />
        <KpiCard label="Rechazadas" value={t.rejected} />
      </div>

      <div className="card card-pad">
        <h3 className="font-bold m-0 mb-3 text-sm uppercase tracking-wide text-mute">
          Categoría más activa
        </h3>
        <div className="text-lg">
          {metrics.mostActiveCategory
            ? `${CATEGORY_META[metrics.mostActiveCategory as LabCategory]?.emoji} ${CATEGORY_META[metrics.mostActiveCategory as LabCategory]?.label}`
            : '—'}
        </div>
        <div className="text-xs text-mute2 mt-2">
          Por categoría:{' '}
          {Object.entries(metrics.byCategory)
            .map(
              ([c, n]) =>
                `${CATEGORY_META[c as LabCategory]?.label ?? c}: ${n}`,
            )
            .join(' · ') || '—'}
        </div>
      </div>

      <div className="card card-pad">
        <h3 className="font-bold m-0 mb-3 text-sm uppercase tracking-wide text-mute">
          Top contribuidores
        </h3>
        {metrics.topContributors.length === 0 ? (
          <p className="text-mute text-sm m-0">Sin datos.</p>
        ) : (
          <ol className="grid gap-2 text-sm pl-5">
            {metrics.topContributors.map((c) => (
              <li key={c.userId} className="flex justify-between gap-3">
                <span>
                  <b>{c.fullName}</b>{' '}
                  <span className="text-xs text-mute2">({c.role ?? '—'})</span>
                </span>
                <span className="text-mute2">{c.count} ideas</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card card-pad text-center">
      <div className="text-2xl font-bold text-ink">{value}</div>
      <div className="text-xs text-mute2 mt-1">{label}</div>
    </div>
  );
}

function TopVotedTab({
  items,
  scope,
  setScope,
}: {
  items: Proposal[] | null;
  scope: 'top' | 'topMonth';
  setScope: (v: 'top' | 'topMonth') => void;
}) {
  return (
    <div>
      <div className="tabs mb-4 max-w-fit">
        <button
          className={`tab ${scope === 'top' ? 'tab-active' : ''}`}
          onClick={() => setScope('top')}
        >
          Histórico
        </button>
        <button
          className={`tab ${scope === 'topMonth' ? 'tab-active' : ''}`}
          onClick={() => setScope('topMonth')}
        >
          Top del mes
        </button>
      </div>
      {items === null && <p className="text-mute">Cargando...</p>}
      {items && items.length === 0 && (
        <p className="text-mute text-sm">No hay propuestas votadas todavía.</p>
      )}
      <ol className="grid gap-2">
        {items?.map((p, i) => (
          <li
            key={p.id}
            className="card card-pad flex items-center gap-3"
          >
            <div className="text-2xl font-bold text-brand min-w-[36px] text-center">
              #{i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <Link
                href={`/lab/${p.id}`}
                className="font-semibold text-ink hover:text-brand no-underline"
              >
                {p.title}
              </Link>
              <div className="text-xs text-mute2 mt-0.5">
                {p.votesScore} pts · {p.votesCount} votos · {p.commentsCount} comentarios
              </div>
            </div>
            <span className={`badge ${STATUS_META[p.status].badge}`}>
              {STATUS_META[p.status].label}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function StatusModal({
  proposal,
  onClose,
  onSubmit,
}: {
  proposal: Proposal;
  onClose: () => void;
  onSubmit: (status: LabStatus, reason: string) => Promise<void>;
}) {
  const [status, setStatus] = useState<LabStatus>(proposal.status);
  const [reason, setReason] = useState(proposal.rejectionReason ?? '');
  const [busy, setBusy] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md">
        <div className="p-5 border-b border-line">
          <h2 className="font-bold text-lg m-0">Cambiar estado</h2>
          <p className="text-xs text-mute2 m-0 mt-1">{proposal.title}</p>
        </div>
        <div className="p-5 grid gap-3">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Nuevo estado</span>
            <select
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value as LabStatus)}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">
              Motivo (opcional, requerido para Rechazo)
            </span>
            <textarea
              className="input min-h-[80px]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explica el motivo del cambio..."
              maxLength={2000}
            />
          </label>
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={onClose} className="btn-ghost" disabled={busy}>
              Cancelar
            </button>
            <button
              onClick={async () => {
                setBusy(true);
                await onSubmit(status, reason);
                setBusy(false);
              }}
              className="btn-primary"
              disabled={busy || (status === 'REJECTED' && !reason.trim())}
            >
              {busy ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MergeModal({
  src,
  onClose,
  onDone,
}: {
  src: Proposal;
  onClose: () => void;
  onDone: () => void;
}) {
  const [candidates, setCandidates] = useState<Proposal[] | null>(null);
  const [dstId, setDstId] = useState<string>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ items: Proposal[] }>(
      `/admin/lab/proposals?category=${src.category}`,
    )
      .then((r) => setCandidates(r.items.filter((p) => p.id !== src.id)))
      .catch(() => setCandidates([]));
  }, [src.category, src.id]);

  async function submit() {
    if (!dstId) return;
    setBusy(true);
    try {
      await api(`/admin/lab/proposals/${src.id}/merge-into/${dstId}`, {
        method: 'POST',
      });
      toast('Propuestas fusionadas', 'success');
      onDone();
    } catch (e: any) {
      toast(e?.message ?? 'Error', 'error');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg">
        <div className="p-5 border-b border-line">
          <h2 className="font-bold text-lg m-0">Fusionar propuesta</h2>
          <p className="text-xs text-mute2 m-0 mt-1">
            Origen: <b>{src.title}</b> · Se marcará como rechazada y los votos
            + comentarios se transfieren al destino.
          </p>
        </div>
        <div className="p-5 grid gap-3">
          {candidates === null && <p className="text-mute">Cargando...</p>}
          {candidates && candidates.length === 0 && (
            <p className="text-mute text-sm">
              No hay otras propuestas en esta categoría para fusionar.
            </p>
          )}
          {candidates && candidates.length > 0 && (
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Propuesta destino</span>
              <select
                className="input"
                value={dstId}
                onChange={(e) => setDstId(e.target.value)}
              >
                <option value="">— Selecciona —</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} ({STATUS_META[c.status].label})
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={onClose} className="btn-ghost" disabled={busy}>
              Cancelar
            </button>
            <button
              onClick={submit}
              className="btn-primary"
              disabled={busy || !dstId}
            >
              {busy ? 'Fusionando...' : 'Fusionar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
