'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import {
  CATEGORY_META,
  STATUS_META,
  PRIORITY_META,
  formatRelative,
  type LabCategory,
  type LabPriority,
  type LabStatus,
  type Proposal,
} from './_shared';

type SortBy = 'top' | 'newest' | 'topMonth';

const SORT_OPTIONS: Array<{ value: SortBy; label: string }> = [
  { value: 'top', label: 'Top histórico' },
  { value: 'newest', label: 'Más nuevas' },
  { value: 'topMonth', label: 'Top del mes' },
];

const STATUS_FILTERS: Array<{ value: LabStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Todas' },
  { value: 'EVALUATING', label: 'En evaluación' },
  { value: 'APPROVED', label: 'Aprobadas' },
  { value: 'IN_DEVELOPMENT', label: 'En desarrollo' },
  { value: 'IN_TESTING', label: 'En pruebas' },
  { value: 'IMPLEMENTED', label: 'Implementadas' },
];

export default function LabPage() {
  const [category, setCategory] = useState<LabCategory>('CLIENTS');
  const [sortBy, setSortBy] = useState<SortBy>('top');
  const [status, setStatus] = useState<LabStatus | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Proposal[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    setItems(null);
    try {
      const params = new URLSearchParams();
      params.set('category', category);
      params.set('sortBy', sortBy);
      if (status !== 'ALL') params.set('status', status);
      if (q.trim()) params.set('q', q.trim());
      const r = await api<{ items: Proposal[] }>(
        `/lab/proposals?${params.toString()}`,
      );
      setItems(r.items);
    } catch (e: any) {
      toast(e?.message ?? 'Error cargando propuestas', 'error');
      setItems([]);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, sortBy, status]);

  return (
    <div>
      <section className="bg-gradient-to-br from-brand to-brand-strong text-white rounded-2xl p-6 sm:p-8 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold m-0">
          🧪 Clubify Lab
        </h1>
        <p className="text-white/90 mt-2 text-sm sm:text-base max-w-2xl">
          Bienvenido al laboratorio de Clubify. Acá tú propones mejoras, votas
          las ideas de la comunidad y comentas. Las más votadas entran al
          roadmap real del producto. ¡Tu voz construye Clubify!
        </p>
      </section>

      <div className="flex gap-2 mb-4 flex-wrap">
        {(Object.keys(CATEGORY_META) as LabCategory[]).map((c) => (
          <button
            key={c}
            type="button"
            className={`tab ${category === c ? 'tab-active' : ''}`}
            onClick={() => setCategory(c)}
          >
            <span className="mr-1.5">{CATEGORY_META[c].emoji}</span>
            {CATEGORY_META[c].label}
          </button>
        ))}
      </div>

      <div className="card card-pad mb-4 flex flex-wrap gap-3 items-center">
        <select
          className="input max-w-[180px]"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          className="input flex-1 min-w-[180px]"
          placeholder="Buscar por título o descripción..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') load();
          }}
        />
        <button className="btn-ghost" onClick={load} type="button">
          Buscar
        </button>
        <button
          className="btn-primary ml-auto"
          onClick={() => setShowCreate(true)}
          type="button"
        >
          ➕ Crear propuesta
        </button>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s.value}
            type="button"
            className={`badge cursor-pointer ${
              status === s.value ? 'badge-info' : 'badge-mute'
            }`}
            onClick={() => setStatus(s.value)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {items === null && (
        <p className="text-mute text-sm">Cargando propuestas...</p>
      )}

      {items && items.length === 0 && (
        <div className="card card-pad text-center text-mute">
          No hay propuestas en este filtro. ¡Sé el primero en proponer una!
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {items?.map((p) => (
          <ProposalCard key={p.id} proposal={p} />
        ))}
      </div>

      {showCreate && (
        <CreateModal
          defaultCategory={category}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            toast(
              'Propuesta enviada. El equipo de Clubify la revisará pronto.',
              'success',
            );
            load();
          }}
        />
      )}
    </div>
  );
}

function ProposalCard({ proposal }: { proposal: Proposal }) {
  const meta = STATUS_META[proposal.status];
  const cat = CATEGORY_META[proposal.category];
  return (
    <Link
      href={`/lab/${proposal.id}`}
      className="card card-pad block hover:border-brand transition no-underline"
    >
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center min-w-[44px] text-center">
          <div className="text-lg font-bold leading-none">
            {proposal.votesScore}
          </div>
          <div className="text-[10px] text-mute2 uppercase tracking-wide">
            pts
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap gap-1.5 mb-1.5 items-center">
            <span className={`badge ${meta.badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
              {meta.label}
            </span>
            <span className="badge badge-mute">
              {cat.emoji} {cat.label}
            </span>
            <span
              className={`text-[11px] font-medium ${PRIORITY_META[proposal.priority].color}`}
            >
              ● {PRIORITY_META[proposal.priority].label}
            </span>
          </div>
          <h3 className="text-base font-semibold text-ink mb-1 line-clamp-2">
            {proposal.title}
          </h3>
          <p className="text-sm text-mute line-clamp-2 mb-2">
            {proposal.description}
          </p>
          <div className="text-xs text-mute2 flex gap-3 flex-wrap">
            <span>Por {proposal.author.fullName}</span>
            <span>{formatRelative(proposal.createdAt)}</span>
            <span>💬 {proposal.commentsCount}</span>
            <span>🗳 {proposal.votesCount}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function CreateModal({
  defaultCategory,
  onClose,
  onCreated,
}: {
  defaultCategory: LabCategory;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [expectedBenefit, setExpectedBenefit] = useState('');
  const [category, setCategory] = useState<LabCategory>(defaultCategory);
  const [priority, setPriority] = useState<LabPriority>('MEDIUM');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await api('/lab/proposals', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description,
          category,
          priority,
          expectedBenefit: expectedBenefit || undefined,
          attachmentUrl: attachmentUrl || undefined,
          attachmentKind: attachmentUrl ? guessKind(attachmentUrl) : undefined,
        }),
      });
      onCreated();
    } catch (e: any) {
      toast(e?.message ?? 'Error creando propuesta', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-line flex items-center justify-between">
          <h2 className="font-bold text-lg m-0">➕ Nueva propuesta</h2>
          <button onClick={onClose} className="text-mute hover:text-ink">
            ✕
          </button>
        </div>
        <form onSubmit={submit} className="p-5 grid gap-3">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink">Título</span>
            <input
              required
              minLength={5}
              maxLength={160}
              className="input"
              placeholder="Ej: Permitir editar el QR del menú después de imprimirlo"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink">Categoría</span>
            <select
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value as LabCategory)}
            >
              <option value="CLIENTS">🏢 Para negocios (Clientes)</option>
              <option value="AFFILIATES">👥 Para embajadores (Afiliados)</option>
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink">Descripción</span>
            <textarea
              required
              minLength={20}
              maxLength={4000}
              className="input min-h-[120px]"
              placeholder="Explícanos la idea con detalle. ¿Qué problema resuelve?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink">
              Beneficio esperado (opcional)
            </span>
            <textarea
              maxLength={2000}
              className="input min-h-[80px]"
              placeholder="¿Qué impacto tendría en tu negocio o en la comunidad?"
              value={expectedBenefit}
              onChange={(e) => setExpectedBenefit(e.target.value)}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink">Prioridad</span>
            <select
              className="input"
              value={priority}
              onChange={(e) => setPriority(e.target.value as LabPriority)}
            >
              <option value="LOW">Baja</option>
              <option value="MEDIUM">Media</option>
              <option value="HIGH">Alta</option>
              <option value="CRITICAL">Crítica</option>
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink">
              URL de adjunto (opcional)
            </span>
            <input
              className="input"
              type="url"
              placeholder="https://... (imagen, PDF, video)"
              value={attachmentUrl}
              onChange={(e) => setAttachmentUrl(e.target.value)}
            />
          </label>
          <div className="flex gap-2 justify-end mt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost"
              disabled={busy}
            >
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Enviando...' : 'Enviar propuesta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function guessKind(url: string): string {
  const low = url.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|svg)$/.test(low)) return 'image';
  if (/\.pdf$/.test(low)) return 'pdf';
  if (/\.(mp4|webm|mov)$/.test(low)) return 'video';
  return 'document';
}
