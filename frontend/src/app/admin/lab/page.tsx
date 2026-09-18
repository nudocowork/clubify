'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { marcaDeLaRuta } from '@/lib/brand-from-path';
import {
  CATEGORY_META,
  NARANJA_MARCA,
  STATUS_META,
  formatRelative,
  type EtiquetaMarca,
  type LabCategory,
  type LabStatus,
  type Proposal,
} from '../../lab/_shared';
import { AdjuntoLab } from '../../lab/AdjuntoLab';
import { LabFeed } from '../../lab/LabFeed';
import { MarcaEtiqueta } from '../../lab/MarcaEtiqueta';
import { useLabContexto } from '../../lab/useLabContexto';

type Tab = 'pending' | 'all' | 'marcas' | 'metrics' | 'topVoted';

/** Filtro de marca para Clubify + las propuestas sin marca (espejo de `FILTRO_PLATAFORMA` del backend). */
const FILTRO_PLATAFORMA = 'plataforma';

type ListadoAdmin = { items: Proposal[]; marcas?: EtiquetaMarca[] };

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

/**
 * /admin/lab sirve a dos personas distintas, y lo decide el backend
 * (`/lab/me`), no la URL:
 *  - El equipo de la plataforma: la moderación de las propuestas de TODAS las
 *    marcas, con la etiqueta de la marca en las que no son de Clubify.
 *  - El administrador general de una marca blanca: el Lab de SU marca dentro de
 *    su panel (entra por «<Marca> Lab» en Sistema). Nunca la moderación: vería
 *    y cambiaría propuestas de Clubify y de las demás marcas.
 */
export default function AdminLabPage() {
  const t = useTranslations('admin_lab');
  const pathname = usePathname();
  const lab = useLabContexto();

  if (lab.estado === 'cargando') {
    return <p className="text-mute">{t('loading')}</p>;
  }
  if (lab.estado === 'error') {
    return <div className="card card-pad text-mute max-w-2xl">{lab.mensaje}</div>;
  }
  if (lab.contexto.alcance === 'MARCA_ADMIN') {
    // Con /admin/<marca>/lab en la URL, el detalle conserva el slug: sin él el
    // panel deja de saber qué marca está viendo.
    const marca = marcaDeLaRuta(pathname);
    const base = marca ? `/admin/${marca}/lab` : '/admin/lab';
    return (
      <div className="max-w-6xl">
        <LabFeed detalleHref={(id) => `${base}/${id}`} />
      </div>
    );
  }
  return <ModeracionLab plataforma={lab.contexto.marca?.name ?? null} />;
}

function ModeracionLab({ plataforma }: { plataforma: string | null }) {
  const t = useTranslations('admin_lab');
  const [tab, setTab] = useState<Tab>('pending');
  const [pending, setPending] = useState<Proposal[] | null>(null);
  const [all, setAll] = useState<Proposal[] | null>(null);
  const [marcas, setMarcas] = useState<EtiquetaMarca[]>([]);
  const [filterStatus, setFilterStatus] = useState<LabStatus | 'ALL'>('ALL');
  const [filterCategory, setFilterCategory] = useState<LabCategory | 'ALL'>('ALL');
  const [filterBrand, setFilterBrand] = useState<string>('ALL');
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [topVoted, setTopVoted] = useState<Proposal[] | null>(null);
  const [topVotedScope, setTopVotedScope] = useState<'top' | 'topMonth'>('top');
  const [statusModal, setStatusModal] = useState<Proposal | null>(null);
  const [mergeModal, setMergeModal] = useState<Proposal | null>(null);

  async function loadPending() {
    setPending(null);
    try {
      const r = await api<ListadoAdmin>(
        '/admin/lab/proposals?status=PENDING',
      );
      setPending(r.items);
    } catch (e: any) {
      toast(e?.message ?? t('error'), 'error');
      setPending([]);
    }
  }

  async function loadAll() {
    setAll(null);
    try {
      const p = new URLSearchParams();
      if (filterStatus !== 'ALL') p.set('status', filterStatus);
      if (filterCategory !== 'ALL') p.set('category', filterCategory);
      if (filterBrand !== 'ALL') p.set('whiteLabelId', filterBrand);
      const r = await api<ListadoAdmin>(
        `/admin/lab/proposals?${p.toString()}`,
      );
      setAll(r.items);
      setMarcas(r.marcas ?? []);
    } catch (e: any) {
      toast(e?.message ?? t('error'), 'error');
      setAll([]);
    }
  }

  async function loadMetrics() {
    try {
      const m = await api<Metrics>('/admin/lab/metrics');
      setMetrics(m);
    } catch (e: any) {
      toast(e?.message ?? t('error'), 'error');
    }
  }

  async function loadTopVoted() {
    setTopVoted(null);
    try {
      // Antes salía de /lab/proposals, que es el feed de quien mira: solo
      // Clubify. La moderación ve el top de todas las marcas, con etiqueta.
      // Categoría CLIENTS por default, como antes.
      const params = new URLSearchParams();
      params.set('category', 'CLIENTS');
      params.set('sortBy', topVotedScope);
      const r = await api<ListadoAdmin>(
        `/admin/lab/proposals?${params.toString()}`,
      );
      setTopVoted(r.items.slice(0, 20));
    } catch (e: any) {
      toast(e?.message ?? t('error'), 'error');
      setTopVoted([]);
    }
  }

  useEffect(() => {
    if (tab === 'pending') loadPending();
    if (tab === 'all' || tab === 'marcas') loadAll();
    if (tab === 'metrics') loadMetrics();
    if (tab === 'topVoted') loadTopVoted();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, filterStatus, filterCategory, filterBrand, topVotedScope]);

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
      toast(t('toastStatusUpdated'), 'success');
      if (tab === 'pending') loadPending();
      else if (tab === 'all' || tab === 'marcas') loadAll();
    } catch (e: any) {
      toast(e?.message ?? t('error'), 'error');
    }
  }

  async function deleteProposal(id: string) {
    if (!confirm(t('confirmDelete')))
      return;
    try {
      await api(`/admin/lab/proposals/${id}`, { method: 'DELETE' });
      toast(t('toastDeleted'), 'success');
      if (tab === 'all' || tab === 'marcas') loadAll();
      if (tab === 'pending') loadPending();
    } catch (e: any) {
      toast(e?.message ?? t('error'), 'error');
    }
  }

  return (
    <div className="max-w-6xl">
      <div className="page-head">
        <h1 className="page-title">
          🧪 Lab <span className="page-crumb">{t('pageCrumb')}</span>
        </h1>
      </div>

      <div className="tabs mb-4 max-w-fit">
        <button
          className={`tab ${tab === 'pending' ? 'tab-active' : ''}`}
          onClick={() => setTab('pending')}
        >
          {t('tabPending')}
        </button>
        <button
          className={`tab ${tab === 'all' ? 'tab-active' : ''}`}
          onClick={() => setTab('all')}
        >
          {t('tabAll')}
        </button>
        {/* Los tickets que nos mandan las marcas (Sellea hoy). Existe porque el
            Lab público de Clubify NO puede enseñarlos —cada Lab es de su
            marca— y había que ir a «Todas» y acordarse de filtrar. */}
        <button
          className={`tab ${tab === 'marcas' ? 'tab-active' : ''}`}
          onClick={() => {
            setFilterBrand('marcas');
            setTab('marcas');
          }}
        >
          {t('tabBrandTickets')}
        </button>
        <button
          className={`tab ${tab === 'metrics' ? 'tab-active' : ''}`}
          onClick={() => setTab('metrics')}
        >
          {t('tabMetrics')}
        </button>
        <button
          className={`tab ${tab === 'topVoted' ? 'tab-active' : ''}`}
          onClick={() => setTab('topVoted')}
        >
          🏆 {t('tabTopVoted')}
        </button>
      </div>

      {tab === 'pending' && (
        <PendingTab
          items={pending}
          // Dos formas de aprobar. La de siempre manda la propuesta a
          // evaluación, que es lo que tiene sentido para una idea de la
          // comunidad: se vota antes de entrar al roadmap. Pero un ticket de
          // una marca blanca no se vota —es trabajo pedido—, así que ahora se
          // puede aprobar y ponerlo en desarrollo de una (Javier, 2026-09-18).
          onApprove={(p) => setStatus(p.id, 'EVALUATING')}
          onApproveToDev={(p) => setStatus(p.id, 'IN_DEVELOPMENT')}
          onReject={(p) => setStatusModal(p)}
          onMerge={(p) => setMergeModal(p)}
          onChange={(p) => setStatusModal(p)}
          onDelete={(p) => deleteProposal(p.id)}
        />
      )}

      {(tab === 'all' || tab === 'marcas') && (
        <AllTab
          items={all}
          marcas={marcas}
          plataforma={plataforma}
          filterStatus={filterStatus}
          setFilterStatus={setFilterStatus}
          filterCategory={filterCategory}
          setFilterCategory={setFilterCategory}
          filterBrand={filterBrand}
          setFilterBrand={setFilterBrand}
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
  const t = useTranslations('admin_lab');
  const meta = STATUS_META[proposal.status];
  const cat = CATEGORY_META[proposal.category];
  // Naranja = llegó de una marca blanca (Sellea). Javier lo pidió así para
  // reconocerlas de un vistazo entre las de Clubify, que son muchas más.
  // `brand` solo llega al equipo de la plataforma: nadie más ve este color.
  const deMarcaBlanca = !!proposal.brand;
  return (
    <div className={`card card-pad ${deMarcaBlanca ? NARANJA_MARCA.fila : ''}`}>
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap gap-1.5 items-center mb-1.5">
            <MarcaEtiqueta marca={proposal.brand} />
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
            <span>{t('byAuthor', { name: proposal.author.fullName })}</span>
            <span>
              🗳 {t('votesWithScore', {
                votes: proposal.votesCount,
                score: proposal.votesScore,
              })}
            </span>
            <span>💬 {proposal.commentsCount}</span>
          </div>
          {proposal.rejectionReason && (
            <div className="text-xs text-bad-ink mt-1.5">
              {t('reasonLabel', { reason: proposal.rejectionReason })}
            </div>
          )}
        </div>
        {/* La captura o el video que adjuntaron, a mano: es lo que dice de
            verdad qué hay que cambiar. */}
        <AdjuntoLab
          url={proposal.attachmentUrl}
          kind={proposal.attachmentKind}
          compacto
        />
        <div className="flex flex-wrap gap-1.5">{actions}</div>
      </div>
    </div>
  );
}

function PendingTab({
  items,
  onApprove,
  onApproveToDev,
  onReject,
  onMerge,
  onChange,
  onDelete,
}: {
  items: Proposal[] | null;
  onApprove: (p: Proposal) => void;
  onApproveToDev: (p: Proposal) => void;
  onReject: (p: Proposal) => void;
  onMerge: (p: Proposal) => void;
  onChange: (p: Proposal) => void;
  onDelete: (p: Proposal) => void;
}) {
  const t = useTranslations('admin_lab');
  if (items === null) return <p className="text-mute">{t('loading')}</p>;
  if (items.length === 0)
    return (
      <p className="text-mute text-sm">
        {t('emptyPending')}
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
                {t('actionApprove')}
              </button>
              {/* Para los tickets de una marca: aprobar y ponerse a ello, sin
                  pasar por la votación de la comunidad. */}
              <button
                className="btn-ghost text-xs"
                title={t('actionApproveToDevHelp')}
                onClick={() => onApproveToDev(p)}
              >
                {t('actionApproveToDev')}
              </button>
              <button className="btn-ghost text-xs" onClick={() => onReject(p)}>
                {t('actionReject')}
              </button>
              <button className="btn-ghost text-xs" onClick={() => onMerge(p)}>
                {t('actionMerge')}
              </button>
              <button className="btn-ghost text-xs" onClick={() => onChange(p)}>
                {t('actionOther')}
              </button>
              <button
                className="btn-ghost text-xs text-bad"
                onClick={() => onDelete(p)}
              >
                {t('actionDelete')}
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
  marcas,
  plataforma,
  filterStatus,
  setFilterStatus,
  filterCategory,
  setFilterCategory,
  filterBrand,
  setFilterBrand,
  onChangeStatus,
  onMerge,
  onDelete,
}: {
  items: Proposal[] | null;
  /** Marcas blancas con propuestas (sin Clubify). Sin ninguna, no hay filtro. */
  marcas: EtiquetaMarca[];
  /** Nombre de la plataforma según la base; null → texto neutro. */
  plataforma: string | null;
  filterStatus: LabStatus | 'ALL';
  setFilterStatus: (v: LabStatus | 'ALL') => void;
  filterCategory: LabCategory | 'ALL';
  setFilterCategory: (v: LabCategory | 'ALL') => void;
  filterBrand: string;
  setFilterBrand: (v: string) => void;
  onChangeStatus: (p: Proposal) => void;
  onMerge: (p: Proposal) => void;
  onDelete: (p: Proposal) => void;
}) {
  const t = useTranslations('admin_lab');
  return (
    <div>
      <div className="card card-pad mb-3 flex gap-2 items-center flex-wrap">
        <select
          className="input max-w-[200px]"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as LabStatus | 'ALL')}
        >
          <option value="ALL">{t('filterAllStatus')}</option>
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
          <option value="ALL">{t('filterAllCategories')}</option>
          <option value="CLIENTS">🏢 {t('categoryBusinesses')}</option>
          <option value="AFFILIATES">👥 {t('categoryAmbassadors')}</option>
        </select>
        {(marcas.length > 0 || filterBrand !== 'ALL') && (
          <select
            className="input max-w-[200px]"
            value={filterBrand}
            onChange={(e) => setFilterBrand(e.target.value)}
          >
            <option value="ALL">{t('filterAllBrands')}</option>
            <option value={FILTRO_PLATAFORMA}>
              {plataforma ?? t('filterPlatform')}
            </option>
            {marcas.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {items === null && <p className="text-mute">{t('loading')}</p>}
      {items && items.length === 0 && (
        <p className="text-mute text-sm">{t('emptyAll')}</p>
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
                  {t('actionChangeStatus')}
                </button>
                <button className="btn-ghost text-xs" onClick={() => onMerge(p)}>
                  {t('actionMerge')}
                </button>
                <button
                  className="btn-ghost text-xs text-bad"
                  onClick={() => onDelete(p)}
                >
                  {t('actionDelete')}
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
  const t = useTranslations('admin_lab');
  if (!metrics) return <p className="text-mute">{t('loading')}</p>;
  const tot = metrics.totals;
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label={t('kpiTotalIdeas')} value={tot.total} />
        <KpiCard label={t('kpiPending')} value={tot.pending} />
        <KpiCard label={t('kpiEvaluating')} value={tot.evaluating} />
        <KpiCard label={t('kpiApproved')} value={tot.approved} />
        <KpiCard label={t('kpiInDevelopment')} value={tot.inDevelopment} />
        <KpiCard label={t('kpiInTesting')} value={tot.inTesting} />
        <KpiCard label={t('kpiImplemented')} value={tot.implemented} />
        <KpiCard label={t('kpiRejected')} value={tot.rejected} />
      </div>

      <div className="card card-pad">
        <h3 className="font-bold m-0 mb-3 text-sm uppercase tracking-wide text-mute">
          {t('mostActiveCategory')}
        </h3>
        <div className="text-lg">
          {metrics.mostActiveCategory
            ? `${CATEGORY_META[metrics.mostActiveCategory as LabCategory]?.emoji} ${CATEGORY_META[metrics.mostActiveCategory as LabCategory]?.label}`
            : '—'}
        </div>
        <div className="text-xs text-mute2 mt-2">
          {t('byCategoryLabel')}{' '}
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
          {t('topContributors')}
        </h3>
        {metrics.topContributors.length === 0 ? (
          <p className="text-mute text-sm m-0">{t('noData')}</p>
        ) : (
          <ol className="grid gap-2 text-sm pl-5">
            {metrics.topContributors.map((c) => (
              <li key={c.userId} className="flex justify-between gap-3">
                <span>
                  <b>{c.fullName}</b>{' '}
                  <span className="text-xs text-mute2">({c.role ?? '—'})</span>
                </span>
                <span className="text-mute2">
                  {t('ideasCount', { count: c.count })}
                </span>
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
  const t = useTranslations('admin_lab');
  return (
    <div>
      <div className="tabs mb-4 max-w-fit">
        <button
          className={`tab ${scope === 'top' ? 'tab-active' : ''}`}
          onClick={() => setScope('top')}
        >
          {t('scopeHistorical')}
        </button>
        <button
          className={`tab ${scope === 'topMonth' ? 'tab-active' : ''}`}
          onClick={() => setScope('topMonth')}
        >
          {t('scopeTopMonth')}
        </button>
      </div>
      {items === null && <p className="text-mute">{t('loading')}</p>}
      {items && items.length === 0 && (
        <p className="text-mute text-sm">{t('emptyTopVoted')}</p>
      )}
      <ol className="grid gap-2">
        {items?.map((p, i) => (
          <li
            key={p.id}
            className={`card card-pad flex items-center gap-3 ${
              p.brand ? NARANJA_MARCA.fila : ''
            }`}
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
                {t('topVotedStats', {
                  score: p.votesScore,
                  votes: p.votesCount,
                  comments: p.commentsCount,
                })}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 justify-end">
              <MarcaEtiqueta marca={p.brand} />
              <span className={`badge ${STATUS_META[p.status].badge}`}>
                {STATUS_META[p.status].label}
              </span>
            </div>
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
  const t = useTranslations('admin_lab');
  // El modal abría en el estado ACTUAL, que casi nunca es un destino válido
  // desde sí mismo: si el admin pulsaba Guardar sin tocar el desplegable, 400.
  const [status, setStatus] = useState<LabStatus>(
    proposal.siguientesEstados?.[0] ?? proposal.status,
  );
  const [reason, setReason] = useState(proposal.rejectionReason ?? '');
  const [busy, setBusy] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md">
        <div className="p-5 border-b border-line">
          <h2 className="font-bold text-lg m-0">{t('modalChangeStatusTitle')}</h2>
          <p className="text-xs text-mute2 m-0 mt-1">{proposal.title}</p>
        </div>
        <div className="p-5 grid gap-3">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">{t('newStatus')}</span>
            <select
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value as LabStatus)}
            >
              {/* Solo los saltos que el backend va a aceptar. Antes salían
                   los 7 y elegir uno no permitido devolvía un 400 que el
                   admin no podía interpretar. `siguientesEstados` viene del
                   backend para que no haya dos copias de la tabla. */}
              {(proposal.siguientesEstados ?? STATUS_OPTIONS).map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">
              {t('reasonField')}
            </span>
            <textarea
              className="input min-h-[80px]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('reasonPlaceholder')}
              maxLength={2000}
            />
          </label>
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={onClose} className="btn-ghost" disabled={busy}>
              {t('cancel')}
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
              {busy ? t('savingEllipsis') : t('save')}
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
  const t = useTranslations('admin_lab');
  const [candidates, setCandidates] = useState<Proposal[] | null>(null);
  const [dstId, setDstId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  // Solo candidatas de la misma marca: el backend no fusiona entre marcas,
  // porque los comentarios de una acabarían en el Lab de la otra.
  const marcaOrigen = src.brand?.id ?? FILTRO_PLATAFORMA;

  useEffect(() => {
    api<ListadoAdmin>(
      `/admin/lab/proposals?category=${src.category}&whiteLabelId=${encodeURIComponent(marcaOrigen)}`,
    )
      .then((r) => setCandidates(r.items.filter((p) => p.id !== src.id)))
      .catch(() => setCandidates([]));
  }, [src.category, src.id, marcaOrigen]);

  async function submit() {
    if (!dstId) return;
    setBusy(true);
    try {
      await api(`/admin/lab/proposals/${src.id}/merge-into/${dstId}`, {
        method: 'POST',
      });
      toast(t('toastMerged'), 'success');
      onDone();
    } catch (e: any) {
      toast(e?.message ?? t('error'), 'error');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg">
        <div className="p-5 border-b border-line">
          <h2 className="font-bold text-lg m-0">{t('modalMergeTitle')}</h2>
          <p className="text-xs text-mute2 m-0 mt-1">
            {t.rich('mergeSourceDescription', {
              title: src.title,
              b: (chunks) => <b>{chunks}</b>,
            })}
          </p>
        </div>
        <div className="p-5 grid gap-3">
          {candidates === null && <p className="text-mute">{t('loading')}</p>}
          {candidates && candidates.length === 0 && (
            <p className="text-mute text-sm">
              {t('emptyMergeCandidates')}
            </p>
          )}
          {candidates && candidates.length > 0 && (
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">{t('targetProposal')}</span>
              <select
                className="input"
                value={dstId}
                onChange={(e) => setDstId(e.target.value)}
              >
                <option value="">{t('selectPlaceholder')}</option>
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
              {t('cancel')}
            </button>
            <button
              onClick={submit}
              className="btn-primary"
              disabled={busy || !dstId}
            >
              {busy ? t('mergingEllipsis') : t('actionMerge')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
