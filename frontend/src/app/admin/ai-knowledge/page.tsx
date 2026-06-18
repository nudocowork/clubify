'use client';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

type Entry = {
  id: string;
  title: string;
  content: string;
  category: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

const SUGGESTED_CATEGORIES = [
  'General',
  'Tarjetas wallet',
  'Menú y pedidos',
  'WhatsApp y push',
  'Facturación',
  'Categorías de negocio',
  'Configuración',
];

export default function AIKnowledgePage() {
  const t = useTranslations('admin_ai_knowledge');
  const [list, setList] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Entry> | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    try {
      setList(await api<Entry[]>('/admin/knowledge'));
    } catch (e: any) {
      toast(e.message || t('errLoadingKnowledge'), 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!editing) return;
    if (!editing.title?.trim() || !editing.content?.trim()) {
      toast(t('titleContentRequired'), 'error');
      return;
    }
    setSaving(true);
    try {
      const body = {
        title: editing.title,
        content: editing.content,
        category: editing.category || 'General',
        isActive: editing.isActive ?? true,
      };
      if (editing.id) {
        await api(`/admin/knowledge/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      } else {
        await api('/admin/knowledge', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }
      toast(t('saved'), 'success');
      setEditing(null);
      load();
    } catch (e: any) {
      toast(e.message || t('errCouldNotSave'), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm(t('confirmDeleteEntry'))) return;
    try {
      await api(`/admin/knowledge/${id}`, { method: 'DELETE' });
      toast(t('entryDeleted'), 'success');
      load();
    } catch (e: any) {
      toast(e.message || t('errCouldNotDelete'), 'error');
    }
  }

  async function toggleActive(e: Entry) {
    try {
      await api(`/admin/knowledge/${e.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !e.isActive }),
      });
      load();
    } catch (err: any) {
      toast(err.message || t('errCouldNotUpdate'), 'error');
    }
  }

  const grouped = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = !term
      ? list
      : list.filter(
          (e) =>
            e.title.toLowerCase().includes(term) ||
            e.content.toLowerCase().includes(term) ||
            e.category.toLowerCase().includes(term),
        );
    const map = new Map<string, Entry[]>();
    for (const e of filtered) {
      const k = e.category || 'General';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [list, search]);

  const activeCount = list.filter((e) => e.isActive).length;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          {t('pageTitle')}{' '}
          <span className="page-crumb">
            {t('pageCrumb', { active: activeCount, total: list.length })}
          </span>
        </h1>
        <div className="flex gap-2 flex-wrap">
          <BulkImportButton onDone={load} />
          <MasterPromptButton />
          <button
            className="btn-primary"
            onClick={() =>
              setEditing({ title: '', content: '', category: 'General', isActive: true })
            }
          >
            <Icon name="plus" /> {t('newEntry')}
          </button>
        </div>
      </div>

      <AIHealthCard />

      <DocumentsSection onChunksChanged={load} />

      <div className="card card-pad mb-5">
        <h3 className="text-base font-semibold m-0 flex items-center gap-2">
          🤖 {t('howItWorksTitle')}
        </h3>
        <p className="text-sm text-mute mt-2 leading-relaxed">
          {t('howItWorksP1')}
        </p>
        <p className="text-sm text-mute mt-2 leading-relaxed">
          {t('howItWorksP2')}
        </p>
      </div>

      <div className="mb-4">
        <input
          type="text"
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input max-w-md"
        />
      </div>

      {loading ? (
        <div className="card card-pad">
          <div className="h-4 bg-bg2 rounded animate-shimmer mb-3" />
          <div className="h-20 bg-bg2 rounded animate-shimmer" />
        </div>
      ) : list.length === 0 ? (
        <div className="card card-pad text-center py-12">
          <div className="text-4xl mb-2">🧠</div>
          <div className="font-semibold">{t('emptyTitle')}</div>
          <p className="text-sm text-mute mt-1.5 max-w-md mx-auto">
            {t('emptyDesc')}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([cat, entries]) => (
            <div key={cat}>
              <div className="text-[11px] uppercase tracking-[0.16em] text-mute font-semibold mb-2">
                {cat} · {entries.length}
              </div>
              <div className="space-y-2">
                {entries.map((e) => (
                  <div
                    key={e.id}
                    className={`card card-pad ${
                      !e.isActive ? 'opacity-60 bg-bg2/40' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold flex items-center gap-2 flex-wrap">
                          {e.title}
                          {!e.isActive && (
                            <span className="badge badge-mute text-[10px]">
                              {t('paused')}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-mute mt-1.5 leading-relaxed whitespace-pre-wrap line-clamp-3">
                          {e.content}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          className="btn-ghost text-xs"
                          onClick={() => toggleActive(e)}
                          title={e.isActive ? t('pause') : t('activate')}
                        >
                          {e.isActive ? '⏸' : '▶'}
                        </button>
                        <button
                          className="btn-ghost text-xs"
                          onClick={() => setEditing(e)}
                        >
                          <Icon name="edit" /> {t('edit')}
                        </button>
                        <button
                          className="btn-danger text-xs"
                          onClick={() => remove(e.id)}
                          title={t('delete')}
                        >
                          <Icon name="trash" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal editor */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-ink/60"
            onClick={() => !saving && setEditing(null)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-line flex items-center justify-between">
              <h2 className="font-bold text-lg">
                {editing.id ? t('editEntry') : t('newEntry')}
              </h2>
              <button
                onClick={() => !saving && setEditing(null)}
                className="text-mute hover:text-ink text-xl leading-none"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <div>
                <label className="label">{t('titleQuestionLabel')}</label>
                <input
                  className="input"
                  placeholder={t('titleQuestionPlaceholder')}
                  value={editing.title ?? ''}
                  onChange={(e) =>
                    setEditing((c) => ({ ...c, title: e.target.value }))
                  }
                  autoFocus
                />
              </div>
              <div>
                <label className="label">{t('categoryLabel')}</label>
                <input
                  className="input"
                  list="categories-list"
                  value={editing.category ?? ''}
                  onChange={(e) =>
                    setEditing((c) => ({ ...c, category: e.target.value }))
                  }
                />
                <datalist id="categories-list">
                  {SUGGESTED_CATEGORIES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="label">{t('answerContentLabel')}</label>
                <textarea
                  className="input"
                  rows={10}
                  placeholder={t('answerContentPlaceholder')}
                  value={editing.content ?? ''}
                  onChange={(e) =>
                    setEditing((c) => ({ ...c, content: e.target.value }))
                  }
                />
                <div className="text-[11px] text-mute mt-1">
                  {t('markdownHint')}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={editing.isActive ?? true}
                  onChange={(e) =>
                    setEditing((c) => ({ ...c, isActive: e.target.checked }))
                  }
                />
                <span>{t('activeIncludedHint')}</span>
              </label>
            </div>
            <div className="px-5 py-3 border-t border-line bg-bg2/30 flex justify-end gap-2">
              <button
                onClick={() => setEditing(null)}
                disabled={saving}
                className="btn-ghost"
              >
                {t('cancel')}
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="btn-primary disabled:opacity-50"
              >
                {saving ? t('saving') : t('save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Modal de import masivo: el admin pega un documento + elige cómo
 *  partirlo (## sections, párrafos, o uno solo). Cada chunk se vuelve
 *  un KnowledgeEntry — upsert por title dentro de la misma categoría. */
function BulkImportButton({ onDone }: { onDone: () => void }) {
  const t = useTranslations('admin_ai_knowledge');
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'sections' | 'paragraphs' | 'whole'>('sections');
  const [category, setCategory] = useState('General');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!text.trim()) {
      toast(t('pasteContentFirst'), 'error');
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ count: number }>('/admin/knowledge/bulk-import', {
        method: 'POST',
        body: JSON.stringify({ text, mode, category }),
      });
      toast(t('importedCount', { count: r.count }), 'success');
      setOpen(false);
      setText('');
      onDone();
    } catch (e: any) {
      toast(e.message || t('errCouldNotImport'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn-ghost text-sm" onClick={() => setOpen(true)}>
        📥 {t('importDocumentBtn')}
      </button>
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-line flex items-center justify-between">
              <h3 className="text-lg font-semibold m-0">{t('importModalTitle')}</h3>
              <button
                onClick={() => setOpen(false)}
                className="text-mute hover:text-ink"
                disabled={busy}
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-sm text-mute leading-relaxed">
                {t('importModalDesc')}
              </div>

              <div>
                <label className="label">{t('splitModeLabel')}</label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { v: 'sections', label: t('splitSectionsLabel'), hint: t('splitSectionsHint') },
                      { v: 'paragraphs', label: t('splitParagraphsLabel'), hint: t('splitParagraphsHint') },
                      { v: 'whole', label: t('splitWholeLabel'), hint: t('splitWholeHint') },
                    ] as { v: 'sections' | 'paragraphs' | 'whole'; label: string; hint: string }[]
                  ).map((m) => (
                    <button
                      key={m.v}
                      type="button"
                      onClick={() => setMode(m.v)}
                      className={`text-left p-2.5 rounded-lg border-2 transition ${
                        mode === m.v
                          ? 'border-brand bg-brand-soft'
                          : 'border-line hover:border-mute'
                      }`}
                    >
                      <div className="text-xs font-semibold">{m.label}</div>
                      <div className="text-[10px] text-mute mt-0.5">{m.hint}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="label">{t('targetCategoryLabel')}</label>
                <input
                  className="input"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="General"
                />
                <div className="text-[11px] text-mute mt-1">
                  {t('overwriteHint')}
                </div>
              </div>

              <div>
                <label className="label">{t('documentLabel')}</label>
                <textarea
                  className="input font-mono text-xs"
                  rows={14}
                  placeholder={
                    mode === 'sections'
                      ? t('documentPlaceholderSections')
                      : t('documentPlaceholderOther')
                  }
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <div className="text-[11px] text-mute mt-1">
                  {t('charsCountMax200k', { count: text.length.toLocaleString() })}
                </div>
              </div>
            </div>
            <div className="p-5 border-t border-line flex gap-2 justify-end">
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="btn-ghost"
              >
                {t('cancel')}
              </button>
              <button
                onClick={submit}
                disabled={busy || !text.trim()}
                className="btn-primary disabled:opacity-50"
              >
                {busy
                  ? t('importing')
                  : text.length > 0
                  ? t('importWithChunks', { count: Math.max(1, text.split(/\n\s*\n/).length) })
                  : t('import')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Modal del master prompt — texto libre que se prepone al system prompt
 *  del widget. Permite ajustar tono, instrucciones, restricciones sin
 *  redeploy. */
function MasterPromptButton() {
  const t = useTranslations('admin_ai_knowledge');
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api<{ prompt: string | null }>('/admin/support/master-prompt')
      .then((r) => {
        setPrompt(r.prompt ?? '');
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [open]);

  async function save() {
    setBusy(true);
    try {
      await api('/admin/support/master-prompt', {
        method: 'PATCH',
        body: JSON.stringify({ prompt: prompt.trim() || null }),
      });
      toast(t('masterPromptSaved'), 'success');
      setOpen(false);
    } catch (e: any) {
      toast(e.message || t('errCouldNotSave'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn-ghost text-sm" onClick={() => setOpen(true)}>
        🧠 {t('masterPromptBtn')}
      </button>
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-line flex items-center justify-between">
              <h3 className="text-lg font-semibold m-0">{t('masterPromptModalTitle')}</h3>
              <button
                onClick={() => setOpen(false)}
                className="text-mute hover:text-ink"
                disabled={busy}
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-sm text-mute leading-relaxed">
                {t('masterPromptDesc')}
              </div>
              {loaded ? (
                <textarea
                  className="input font-mono text-xs"
                  rows={16}
                  placeholder={t('masterPromptPlaceholder')}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              ) : (
                <div className="text-sm text-mute py-8 text-center">{t('loading')}</div>
              )}
              <div className="text-[11px] text-mute">
                {t('charsCountMax20k', { count: prompt.length.toLocaleString() })}
              </div>
            </div>
            <div className="p-5 border-t border-line flex gap-2 justify-end">
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="btn-ghost"
              >
                {t('cancel')}
              </button>
              <button
                onClick={save}
                disabled={busy || !loaded}
                className="btn-primary disabled:opacity-50"
              >
                {busy ? t('saving') : t('savePrompt')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Health card (Fase 6) ──────────────────────────────────────────────

type HealthResp = {
  anthropic: { configured: boolean; model: string };
  voyage: { configured: boolean; model: string };
  knowledge: {
    totalDocs: number;
    docsReady: number;
    totalEntries: number;
    activeEntries: number;
    withEmbedding: number;
    embeddingCoverage: number;
    byAudience: Record<string, number>;
  };
};

function AIHealthCard() {
  const t = useTranslations('admin_ai_knowledge');
  const [h, setH] = useState<HealthResp | null>(null);
  useEffect(() => {
    api<HealthResp>('/admin/knowledge/health').then(setH).catch(() => {});
  }, []);
  if (!h) return null;
  const k = h.knowledge;
  return (
    <div className="card card-pad mb-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <HealthStat
          label={t('statLlm')}
          value={h.anthropic.configured ? t('statActive') : t('statNoKey')}
          hint={h.anthropic.model}
          ok={h.anthropic.configured}
        />
        <HealthStat
          label={t('statEmbeddings')}
          value={h.voyage.configured ? t('statActive') : t('statLexical')}
          hint={h.voyage.configured ? h.voyage.model : t('statNoVoyage')}
          ok={h.voyage.configured}
        />
        <HealthStat
          label={t('statDocuments')}
          value={`${k.docsReady} / ${k.totalDocs}`}
          hint={t('statReadyTotal')}
        />
        <HealthStat
          label={t('statChunks')}
          value={`${k.activeEntries}`}
          hint={
            h.voyage.configured
              ? t('statWithEmbedding', { pct: k.embeddingCoverage })
              : t('statTotalEntries', { count: k.totalEntries })
          }
        />
      </div>
      <div className="mt-3 text-[11px] text-mute flex items-center gap-3 flex-wrap">
        <span>
          {t('audienceBreakdown', {
            tenant: k.byAudience.TENANT ?? 0,
            affiliate: k.byAudience.AFFILIATE ?? 0,
            both: k.byAudience.BOTH ?? 0,
          })}
        </span>
        {!h.voyage.configured && (
          <span className="text-amber-700">
            {t('voyageWarning')}
          </span>
        )}
      </div>
    </div>
  );
}

function HealthStat({
  label,
  value,
  hint,
  ok,
}: {
  label: string;
  value: string;
  hint?: string;
  ok?: boolean;
}) {
  return (
    <div className="bg-bg2/50 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-mute font-semibold flex items-center gap-1">
        {ok !== undefined && (
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${ok ? 'bg-ok' : 'bg-amber-500'}`}
          />
        )}
        {label}
      </div>
      <div className="text-xl font-bold mt-1">{value}</div>
      {hint && <div className="text-[10px] text-mute mt-0.5">{hint}</div>}
    </div>
  );
}

// ─── Documentos ────────────────────────────────────────────────────────

type KnowledgeDoc = {
  id: string;
  title: string;
  fileUrl: string | null;
  fileType: string;
  fileSize: number | null;
  audience: 'TENANT' | 'AFFILIATE' | 'BOTH';
  category: string;
  status: 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED';
  totalChars: number;
  chunkCount: number;
  errorMessage: string | null;
  isActive: boolean;
  uploadedAt: string;
  processedAt: string | null;
};

const AUDIENCE_LABEL: Record<KnowledgeDoc['audience'], { text: string; cls: string }> = {
  TENANT: { text: '🏪 Dueños', cls: 'bg-emerald-100 text-emerald-800' },
  AFFILIATE: { text: '🚀 Afiliados', cls: 'bg-violet-100 text-violet-800' },
  BOTH: { text: '🌐 Ambos', cls: 'bg-sky-100 text-sky-800' },
};

const STATUS_LABEL: Record<KnowledgeDoc['status'], { text: string; cls: string }> = {
  UPLOADED: { text: 'Pendiente', cls: 'bg-bg2 text-mute' },
  PROCESSING: { text: 'Procesando…', cls: 'bg-amber-100 text-amber-800' },
  READY: { text: 'Listo', cls: 'bg-ok-soft text-ok' },
  FAILED: { text: 'Falló', cls: 'bg-red-100 text-red-700' },
};

function fmtBytes(n: number | null | undefined): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function DocumentsSection({ onChunksChanged }: { onChunksChanged: () => void }) {
  const t = useTranslations('admin_ai_knowledge');
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setDocs(await api<KnowledgeDoc[]>('/admin/knowledge/documents'));
    } catch (e: any) {
      toast(e.message || t('errLoadingDocuments'), 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function remove(id: string) {
    if (!confirm(t('confirmDeleteDocument'))) return;
    try {
      await api(`/admin/knowledge/documents/${id}`, { method: 'DELETE' });
      toast(t('documentDeleted'), 'success');
      load();
      onChunksChanged();
    } catch (e: any) {
      toast(e.message || t('errCouldNotDelete'), 'error');
    }
  }

  async function toggleActive(d: KnowledgeDoc) {
    try {
      await api(`/admin/knowledge/documents/${d.id}/active`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !d.isActive }),
      });
      load();
      onChunksChanged();
    } catch (e: any) {
      toast(e.message || t('errCouldNotUpdate'), 'error');
    }
  }

  return (
    <div className="card card-pad mb-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <h3 className="text-base font-semibold m-0 flex items-center gap-2">
            📂 {t('knowledgeBaseTitle')}
          </h3>
          <p className="text-xs text-mute mt-1 leading-relaxed max-w-2xl">
            {t('knowledgeBaseDescPart1')}
            <code className="px-1">VOYAGE_API_KEY</code>
            {t('knowledgeBaseDescPart2')}
          </p>
        </div>
        <button onClick={() => setShowUpload(true)} className="btn-primary">
          <Icon name="plus" /> {t('uploadDocumentBtn')}
        </button>
      </div>

      {showUpload && (
        <UploadDocumentModal
          onClose={() => setShowUpload(false)}
          onUploaded={() => {
            setShowUpload(false);
            load();
            onChunksChanged();
          }}
        />
      )}

      {loading ? (
        <div className="h-16 bg-bg2 rounded animate-shimmer" />
      ) : docs.length === 0 ? (
        <div className="text-center py-8 text-sm text-mute">
          {t('noDocumentsYet')}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg2/50">
              <tr>
                {[t('colDocument'), t('colType'), t('colAudience'), t('colChunks'), t('colSize'), t('colStatus'), ''].map((h) => (
                  <th
                    key={h}
                    className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.1em] text-mute font-semibold"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr
                  key={d.id}
                  className={`border-t border-line2 ${d.isActive ? '' : 'opacity-50'}`}
                >
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{d.title}</div>
                    <div className="text-[11px] text-mute">
                      {d.category}
                      {d.errorMessage && (
                        <span className="text-red-600"> · {d.errorMessage}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 uppercase text-xs font-mono text-mute">
                    {d.fileType}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${AUDIENCE_LABEL[d.audience].cls}`}
                    >
                      {AUDIENCE_LABEL[d.audience].text}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">{d.chunkCount}</td>
                  <td className="px-3 py-2.5 text-xs text-mute">
                    {fmtBytes(d.fileSize)}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_LABEL[d.status].cls}`}
                    >
                      {STATUS_LABEL[d.status].text}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => toggleActive(d)}
                      className="text-xs text-mute hover:text-ink mr-3"
                      title={d.isActive ? t('deactivate') : t('activate')}
                    >
                      {d.isActive ? '👁' : '🚫'}
                    </button>
                    <button
                      onClick={() => remove(d.id)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      {t('delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UploadDocumentModal({
  onClose,
  onUploaded,
}: {
  onClose: () => void;
  onUploaded: () => void;
}) {
  const t = useTranslations('admin_ai_knowledge');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [audience, setAudience] = useState<'TENANT' | 'AFFILIATE' | 'BOTH'>('BOTH');
  const [category, setCategory] = useState('General');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      toast(t('selectFile'), 'error');
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append(
        'title',
        (title.trim() || file.name.replace(/\.[^.]+$/, '')).slice(0, 200),
      );
      fd.append('audience', audience);
      fd.append('category', category || 'General');
      // Usamos fetch directo porque api() inyecta Content-Type: json y
      // eso rompe FormData (necesita multipart con boundary auto-set por
      // fetch). El token sí lo compartimos con api() — viene de la
      // cookie `clubify_token` (NO de localStorage; eso era un bug que
      // causaba 401 al subir).
      const base =
        process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';
      const token = (() => {
        if (typeof document === 'undefined') return null;
        const m = document.cookie.match(/(^|;\s*)clubify_token=([^;]+)/);
        return m ? decodeURIComponent(m[2]) : null;
      })();
      const res = await fetch(`${base}/api/admin/knowledge/documents`, {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(t('uploadFailedStatus', { status: res.status, detail: txt.slice(0, 200) }));
      }
      const doc = (await res.json()) as KnowledgeDoc;
      toast(
        doc.status === 'READY'
          ? t('processedChunks', { count: doc.chunkCount })
          : doc.status === 'FAILED'
          ? t('failedWithMessage', { message: doc.errorMessage ?? '' })
          : t('processing'),
        doc.status === 'FAILED' ? 'error' : 'success',
      );
      onUploaded();
    } catch (e: any) {
      toast(e.message || t('errCouldNotUpload'), 'error');
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl"
      >
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-lg font-bold">📂 {t('uploadDocumentBtn')}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-mute hover:text-ink text-xl leading-none"
          >
            ×
          </button>
        </div>
        <p className="text-xs text-mute leading-relaxed mb-4">
          {t('uploadModalDesc')}
        </p>

        <label className="label">{t('fileLabel')}</label>
        <input
          type="file"
          accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          required
          className="input"
        />
        {file && (
          <div className="text-[11px] text-mute mt-1">
            {file.name} · {fmtBytes(file.size)}
          </div>
        )}

        <label className="label mt-3">{t('titleOptionalLabel')}</label>
        <input
          type="text"
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={file?.name?.replace(/\.[^.]+$/, '') ?? t('usesFileName')}
        />

        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <label className="label">{t('audienceLabel')}</label>
            <select
              className="input"
              value={audience}
              onChange={(e) =>
                setAudience(e.target.value as 'TENANT' | 'AFFILIATE' | 'BOTH')
              }
            >
              <option value="BOTH">{t('audienceBoth')}</option>
              <option value="TENANT">{t('audienceTenant')}</option>
              <option value="AFFILIATE">{t('audienceAffiliate')}</option>
            </select>
          </div>
          <div>
            <label className="label">{t('categoryLabel')}</label>
            <input
              type="text"
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              maxLength={80}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost text-sm"
            disabled={busy}
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            disabled={busy || !file}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {busy ? t('processing') : t('uploadAndProcess')}
          </button>
        </div>
      </form>
    </div>
  );
}
