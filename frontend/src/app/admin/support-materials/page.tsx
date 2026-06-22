'use client';
/**
 * Admin: Material de apoyo.
 *
 * Biblioteca de recursos para afiliados (influencers/embajadores).
 * El super admin sube archivos (PDF/imagen/audio/etc.), agrega links
 * externos (YouTube, Loom, Drive) o scripts para copiar. Cada material
 * tiene audience + scope opcional (a un influencer específico).
 *
 * UI:
 * - Toolbar arriba: buscador + filtro por categoría + filtro por audience
 *   + botón "+ Material"
 * - Grid de cards agrupadas por categoría
 * - Modal de creación/edición con todos los campos
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api, getToken } from '@/lib/api';
import { toast } from '@/components/Toast';
import { ImageUploader } from '@/components/ImageUploader';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

type Type =
  | 'PDF'
  | 'IMAGE'
  | 'VIDEO'
  | 'AUDIO'
  | 'LINK'
  | 'SCRIPT'
  | 'PRESENTATION'
  | 'TEMPLATE'
  | 'OTHER';
type Audience = 'INFLUENCER' | 'AMBASSADOR' | 'BOTH' | 'VENDOR' | 'ALL';

type Material = {
  id: string;
  title: string;
  description: string | null;
  type: Type;
  fileUrl: string | null;
  externalUrl: string | null;
  thumbnailUrl: string | null;
  scriptBody: string | null;
  category: string;
  audience: Audience;
  scopeInfluencerId: string | null;
  scopeInfluencer?: { id: string; code: string; ownerName: string } | null;
  order: number;
  isActive: boolean;
  createdAt: string;
};

type Influencer = { id: string; code: string; ownerName: string };

const TYPE_LABEL_KEY: Record<Type, string> = {
  PDF: 'typePdf',
  IMAGE: 'typeImage',
  VIDEO: 'typeVideo',
  AUDIO: 'typeAudio',
  LINK: 'typeLink',
  SCRIPT: 'typeScript',
  PRESENTATION: 'typePresentation',
  TEMPLATE: 'typeTemplate',
  OTHER: 'typeOther',
};

const AUDIENCE_LABEL_KEY: Record<Audience, string> = {
  INFLUENCER: 'audienceInfluencer',
  AMBASSADOR: 'audienceAmbassador',
  BOTH: 'audienceBoth',
  VENDOR: 'audienceVendor',
  ALL: 'audienceAll',
};

// Categorías sugeridas — claves i18n; los valores son lo que se persiste.
const SUGGESTED_CATEGORY_KEYS = [
  'catFirstSteps',
  'catHowToSell',
  'catWhatsappScripts',
  'catObjections',
  'catTrainingVideos',
  'catGraphics',
  'catPresentations',
  'catSuccessCases',
  'catProductManual',
];

export default function SupportMaterialsAdmin() {
  const t = useTranslations('admin_support_materials');
  const [materials, setMaterials] = useState<Material[]>([]);
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterAudience, setFilterAudience] = useState<string>('');
  const [editing, setEditing] = useState<Partial<Material> | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [list, infls] = await Promise.all([
        api<Material[]>('/admin/support-materials'),
        api<any[]>('/referrals/influencers').catch(() => []),
      ]);
      setMaterials(list ?? []);
      setInfluencers(
        (infls ?? []).map((i: any) => ({
          id: i.id,
          code: i.code,
          ownerName: i.ownerName,
        })),
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    materials.forEach((m) => set.add(m.category));
    return Array.from(set).sort();
  }, [materials]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return materials.filter((m) => {
      if (filterCategory && m.category !== filterCategory) return false;
      if (filterAudience && m.audience !== filterAudience) return false;
      if (term) {
        const hay = `${m.title} ${m.description ?? ''} ${m.category}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [materials, search, filterCategory, filterAudience]);

  const grouped = useMemo(() => {
    const byCat: Record<string, Material[]> = {};
    filtered.forEach((m) => {
      byCat[m.category] = byCat[m.category] ?? [];
      byCat[m.category].push(m);
    });
    return Object.entries(byCat).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  async function save(dto: Partial<Material>) {
    const isUpdate = !!dto.id;
    try {
      if (isUpdate) {
        await api(`/admin/support-materials/${dto.id}`, {
          method: 'PATCH',
          body: JSON.stringify(dto),
        });
      } else {
        await api(`/admin/support-materials`, {
          method: 'POST',
          body: JSON.stringify(dto),
        });
      }
      toast(isUpdate ? t('toastUpdated') : t('toastCreated'), 'success');
      setEditing(null);
      await load();
    } catch (e: any) {
      toast(e.message ?? t('error'), 'error');
    }
  }

  async function remove(m: Material) {
    if (!confirm(t('confirmRemove', { title: m.title }))) return;
    try {
      await api(`/admin/support-materials/${m.id}`, { method: 'DELETE' });
      toast(t('toastDeleted'), 'success');
      await load();
    } catch (e: any) {
      toast(e.message ?? t('error'), 'error');
    }
  }

  async function toggleActive(m: Material) {
    try {
      await api(`/admin/support-materials/${m.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !m.isActive }),
      });
      await load();
    } catch (e: any) {
      toast(e.message ?? t('error'), 'error');
    }
  }

  if (loading) return <div className="text-mute">{t('loading')}</div>;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          {t('title')}{' '}
          <span className="page-crumb">/ {t('totalCount', { count: materials.length })}</span>
        </h1>
        <button
          className="btn-primary"
          onClick={() =>
            setEditing({
              type: 'PDF',
              audience: 'BOTH',
              category: 'General',
              isActive: true,
            })
          }
        >
          {t('addMaterial')}
        </button>
      </div>

      <div className="card card-pad mb-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_200px_240px] gap-3">
          <input
            className="input"
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="input"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
          >
            <option value="">{t('filterAllCategories')}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={filterAudience}
            onChange={(e) => setFilterAudience(e.target.value)}
          >
            <option value="">{t('filterAllAudiences')}</option>
            <option value="INFLUENCER">{t('filterInfluencer')}</option>
            <option value="AMBASSADOR">{t('filterAmbassador')}</option>
            <option value="VENDOR">{t('filterVendor')}</option>
            <option value="BOTH">{t('filterBoth')}</option>
            <option value="ALL">{t('filterAll')}</option>
          </select>
        </div>
      </div>

      {grouped.length === 0 && (
        <div className="card card-pad text-center text-mute py-10">
          {materials.length === 0
            ? t('emptyNoMaterials')
            : t('emptyNoResults')}
        </div>
      )}

      {grouped.map(([cat, items]) => (
        <div key={cat} className="mb-5">
          <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-2">
            {cat} <span className="text-mute/60">· {items.length}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map((m) => (
              <MaterialCard
                key={m.id}
                m={m}
                onEdit={() => setEditing(m)}
                onDelete={() => remove(m)}
                onToggle={() => toggleActive(m)}
              />
            ))}
          </div>
        </div>
      ))}

      {editing && (
        <EditorModal
          material={editing}
          influencers={influencers}
          suggestedCategories={[
            ...new Set([
              ...SUGGESTED_CATEGORY_KEYS.map((k) => t(k)),
              ...categories,
            ]),
          ]}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

function MaterialCard({
  m,
  onEdit,
  onDelete,
  onToggle,
}: {
  m: Material;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const t = useTranslations('admin_support_materials');
  return (
    <div
      className={`card card-pad flex flex-col gap-2 transition ${
        m.isActive ? '' : 'opacity-50'
      }`}
    >
      <div className="flex items-start gap-2.5">
        {m.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={m.thumbnailUrl}
            alt=""
            className="w-12 h-12 rounded-lg object-cover flex-none"
          />
        ) : (
          <div className="w-12 h-12 rounded-lg bg-bg2 flex items-center justify-center text-xl flex-none">
            {t(TYPE_LABEL_KEY[m.type]).split(' ')[0]}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm leading-tight">{m.title}</div>
          <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mt-0.5">
            {t(TYPE_LABEL_KEY[m.type])}
          </div>
        </div>
      </div>

      {m.description && (
        <div className="text-xs text-mute leading-relaxed line-clamp-2">
          {m.description}
        </div>
      )}

      <div className="text-[11px] text-mute leading-relaxed">
        {t(AUDIENCE_LABEL_KEY[m.audience])}
        {m.scopeInfluencer && (
          <>
            {' '}· <span className="text-violet-700">{t('onlyScope', { code: m.scopeInfluencer.code })}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-1.5 mt-auto pt-2">
        <button onClick={onEdit} className="btn-ghost text-[11px] flex-1">
          {t('cardEdit')}
        </button>
        <button
          onClick={onToggle}
          className="btn-ghost text-[11px]"
          title={m.isActive ? t('pause') : t('activate')}
        >
          {m.isActive ? '⏸' : '▶'}
        </button>
        <button onClick={onDelete} className="btn-ghost text-[11px] text-bad">
          🗑
        </button>
      </div>
    </div>
  );
}

function EditorModal({
  material,
  influencers,
  suggestedCategories,
  onClose,
  onSave,
}: {
  material: Partial<Material>;
  influencers: Influencer[];
  suggestedCategories: string[];
  onClose: () => void;
  onSave: (m: Partial<Material>) => void | Promise<void>;
}) {
  const t = useTranslations('admin_support_materials');
  const [form, setForm] = useState<Partial<Material>>({ ...material });
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  function patch(p: Partial<Material>) {
    setForm({ ...form, ...p });
  }

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      // No usamos api() porque siempre setea Content-Type: application/json
      // y rompe el multipart. fetch directo deja que el browser ponga el
      // boundary correcto.
      const fd = new FormData();
      fd.append('file', file);
      const token = getToken();
      const res = await fetch(`${API_BASE}/api/admin/support-materials/upload`, {
        method: 'POST',
        body: fd,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `Error ${res.status}`);
      }
      const r = (await res.json()) as { url: string };
      patch({ fileUrl: r.url });
      toast(t('toastFileUploaded'), 'success');
    } catch (e: any) {
      toast(e.message ?? t('errUploading'), 'error');
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title?.trim()) {
      toast(t('errMissingTitle'), 'error');
      return;
    }
    if (!form.fileUrl && !form.externalUrl && !form.scriptBody) {
      toast(t('errMissingContent'), 'error');
      return;
    }
    setBusy(true);
    try {
      await onSave(form);
    } finally {
      setBusy(false);
    }
  }

  const showFile = ['PDF', 'IMAGE', 'AUDIO', 'PRESENTATION', 'TEMPLATE', 'OTHER'].includes(
    form.type as string,
  );
  const showExternal = ['VIDEO', 'LINK'].includes(form.type as string);
  const showScript = form.type === 'SCRIPT';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5 animate-in zoom-in-95 fade-in duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-lg">
            {form.id ? t('modalEditTitle') : t('modalNewTitle')}
          </h2>
          <button onClick={onClose} className="text-mute hover:text-ink text-xl">
            ×
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label">{t('labelTitle')}</label>
            <input
              className="input"
              value={form.title ?? ''}
              onChange={(e) => patch({ title: e.target.value })}
              maxLength={120}
              required
            />
          </div>

          <div>
            <label className="label">{t('labelDescription')}</label>
            <textarea
              className="input"
              rows={2}
              value={form.description ?? ''}
              onChange={(e) => patch({ description: e.target.value })}
              maxLength={500}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('labelType')}</label>
              <select
                className="input"
                value={form.type ?? 'PDF'}
                onChange={(e) => patch({ type: e.target.value as Type })}
              >
                {(Object.keys(TYPE_LABEL_KEY) as Type[]).map((ty) => (
                  <option key={ty} value={ty}>
                    {t(TYPE_LABEL_KEY[ty])}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">{t('labelCategory')}</label>
              <input
                className="input"
                list="categories-list"
                value={form.category ?? ''}
                onChange={(e) => patch({ category: e.target.value })}
                placeholder={t('phCategory')}
              />
              <datalist id="categories-list">
                {suggestedCategories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </div>

          {showFile && (
            <div>
              <label className="label">{t('labelFile')}</label>
              {form.fileUrl ? (
                <div className="flex items-center gap-2">
                  <a
                    href={form.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-brand underline truncate flex-1"
                  >
                    {form.fileUrl}
                  </a>
                  <button
                    type="button"
                    className="btn-ghost text-xs text-bad"
                    onClick={() => patch({ fileUrl: null })}
                  >
                    {t('remove')}
                  </button>
                </div>
              ) : (
                <input
                  type="file"
                  className="input"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(f);
                  }}
                />
              )}
              {uploading && <div className="text-xs text-mute mt-1">{t('uploading')}</div>}
            </div>
          )}

          {showExternal && (
            <div>
              <label className="label">{t('labelExternalUrl')}</label>
              <input
                className="input"
                value={form.externalUrl ?? ''}
                onChange={(e) => patch({ externalUrl: e.target.value })}
                placeholder="https://"
              />
            </div>
          )}

          {showScript && (
            <div>
              <label className="label">{t('labelScript')}</label>
              <textarea
                className="input"
                rows={6}
                value={form.scriptBody ?? ''}
                onChange={(e) => patch({ scriptBody: e.target.value })}
                placeholder={t('phScript')}
                maxLength={10000}
              />
            </div>
          )}

          <div>
            <label className="label">{t('labelThumbnail')}</label>
            <ImageUploader
              value={form.thumbnailUrl ?? null}
              onChange={(url) => patch({ thumbnailUrl: url })}
              folder="support-materials"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('labelAudience')}</label>
              <select
                className="input"
                value={form.audience ?? 'BOTH'}
                onChange={(e) => patch({ audience: e.target.value as Audience })}
              >
                {(Object.keys(AUDIENCE_LABEL_KEY) as Audience[]).map((a) => (
                  <option key={a} value={a}>
                    {t(AUDIENCE_LABEL_KEY[a])}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">{t('labelScope')}</label>
              <select
                className="input"
                value={form.scopeInfluencerId ?? ''}
                onChange={(e) =>
                  patch({ scopeInfluencerId: e.target.value || null })
                }
              >
                <option value="">{t('scopeAll')}</option>
                {influencers.map((i) => (
                  <option key={i.id} value={i.id}>
                    {t('scopeTeamOf', { name: i.ownerName, code: i.code })}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="text-[11px] text-mute leading-relaxed">
            {t('scopeTip')}
          </div>

          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={form.isActive ?? true}
              onChange={(e) => patch({ isActive: e.target.checked })}
            />
            {t('labelActive')}
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost text-sm">
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={busy || uploading}
              className="btn-primary text-sm"
            >
              {busy ? t('saving') : t('save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
