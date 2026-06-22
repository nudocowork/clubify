'use client';
/**
 * Admin: Industrias.
 *
 * Wrap nivel-1 del módulo de pitch decks. Cada industria contendrá
 * Presentations (F4) que a su vez tendrán Slides (F4). La vista pública
 * (/industrias, /industria/{slug}) llega en F5.
 *
 * UI:
 * - Toolbar arriba: buscador + botón "+ Industria"
 * - Grid de cards (md:2 lg:3) con emoji/ícono + nombre + descripción +
 *   badge activo/inactivo + botones (editar, reordenar ↑↓, eliminar)
 * - Card linkea a /admin/industries/{id} para gestionar presentations
 * - Modal de creación/edición con todos los campos del modelo
 *
 * Slug se auto-genera desde el nombre (igual que en backend) — el cliente
 * solo lo edita si quiere uno custom.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { ImageUploader } from '@/components/ImageUploader';
import { BannerStylePicker } from '@/components/industry/BannerStylePicker';
import type { IndustryCoverStyle } from '@/components/industry/IndustryCoverCard';

type Industry = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  emoji: string | null;
  iconUrl: string | null;
  coverImage: string | null;
  coverStyle: IndustryCoverStyle | null;
  themeColor: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type FormState = Partial<Industry>;

const DEFAULT_FORM: FormState = {
  name: '',
  slug: '',
  description: '',
  emoji: '',
  iconUrl: null,
  coverImage: null,
  coverStyle: 'DARK_OVERLAY',
  themeColor: '#22C55E',
  isActive: true,
  sortOrder: 0,
};

function slugify(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export default function AdminIndustriesPage() {
  const t = useTranslations('admin_industries');
  const [items, setItems] = useState<Industry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Industry | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  // El cliente puede haber editado el slug a mano — si no, lo
  // re-derivamos del name. Sin este flag, escribir un slug custom y
  // luego tipear más en el name volvería a pisarlo.
  const [slugTouched, setSlugTouched] = useState(false);

  function load() {
    setLoading(true);
    api<Industry[]>('/admin/industries')
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.slug.toLowerCase().includes(q) ||
        (i.description ?? '').toLowerCase().includes(q),
    );
  }, [items, search]);

  function openCreate() {
    setEditing(null);
    setForm({
      ...DEFAULT_FORM,
      // Nueva al final de la lista — el reorder posterior lo refina.
      sortOrder: (items[items.length - 1]?.sortOrder ?? 0) + 1,
    });
    setSlugTouched(false);
    setModalOpen(true);
  }

  function openEdit(i: Industry) {
    setEditing(i);
    setForm({
      name: i.name,
      slug: i.slug,
      description: i.description ?? '',
      emoji: i.emoji ?? '',
      iconUrl: i.iconUrl,
      coverImage: i.coverImage,
      coverStyle: i.coverStyle ?? 'DARK_OVERLAY',
      themeColor: i.themeColor ?? '#22C55E',
      isActive: i.isActive,
      sortOrder: i.sortOrder,
    });
    setSlugTouched(true);
    setModalOpen(true);
  }

  function patchForm(p: Partial<FormState>) {
    setForm((f) => ({ ...f, ...p }));
  }

  function onNameChange(v: string) {
    setForm((f) => ({
      ...f,
      name: v,
      slug: slugTouched ? f.slug : slugify(v),
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name?.trim()) {
      toast(t('errNameRequired'), 'error');
      return;
    }
    setSaving(true);
    const body = {
      name: form.name.trim(),
      slug: form.slug?.trim() || slugify(form.name),
      description: form.description?.trim() || null,
      emoji: form.emoji?.trim() || null,
      iconUrl: form.iconUrl || null,
      coverImage: form.coverImage || null,
      coverStyle: form.coverStyle ?? 'DARK_OVERLAY',
      themeColor: form.themeColor || null,
      isActive: form.isActive ?? true,
      sortOrder: form.sortOrder ?? 0,
    };
    try {
      if (editing) {
        await api(`/admin/industries/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        toast(t('toastUpdated'), 'success');
      } else {
        await api('/admin/industries', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        toast(t('toastCreated'), 'success');
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      toast(err?.message || t('errSave'), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(i: Industry) {
    try {
      await api(`/admin/industries/${i.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !i.isActive }),
      });
      setItems((arr) =>
        arr.map((x) => (x.id === i.id ? { ...x, isActive: !x.isActive } : x)),
      );
    } catch (e: any) {
      toast(e?.message || t('errUpdate'), 'error');
    }
  }

  async function remove(i: Industry) {
    if (!confirm(t('confirmRemove', { name: i.name }))) return;
    try {
      await api(`/admin/industries/${i.id}`, { method: 'DELETE' });
      toast(t('toastDeleted'), 'success');
      setItems((arr) => arr.filter((x) => x.id !== i.id));
    } catch (e: any) {
      toast(e?.message || t('errDelete'), 'error');
    }
  }

  /** Mueve la card en una dirección y persiste el nuevo orden en batch. */
  async function move(i: Industry, dir: 'up' | 'down') {
    const idx = items.findIndex((x) => x.id === i.id);
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= items.length) return;
    const next = [...items];
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    // Renumera todos sortOrder secuencialmente para evitar gaps.
    const renumbered = next.map((x, i) => ({ ...x, sortOrder: i }));
    setItems(renumbered);
    try {
      await api('/admin/industries/reorder', {
        method: 'PATCH',
        body: JSON.stringify({
          items: renumbered.map((x) => ({ id: x.id, sortOrder: x.sortOrder })),
        }),
      });
    } catch (e: any) {
      toast(e?.message || t('errReorder'), 'error');
      load();
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          {t('title')}{' '}
          <span className="page-crumb">
            / {t('countCrumb', { count: items.length })}
          </span>
        </h1>
      </div>

      <div className="card card-pad mb-5">
        <h3 className="text-base font-semibold m-0 flex items-center gap-2">
          {t('catalogTitle')}
        </h3>
        <p className="text-sm text-mute mt-2 leading-relaxed">
          {t.rich('catalogDesc', { b: (c) => <b>{c}</b> })}
        </p>
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input
          type="search"
          className="input flex-1 max-w-sm"
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <a
          href="/industrias"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary inline-flex items-center gap-1.5 whitespace-nowrap"
          title={t('viewLinkTitle')}
        >
          {t('viewLink')}
        </a>
        <button
          type="button"
          onClick={async () => {
            try {
              const url = `${window.location.origin}/industrias`;
              await navigator.clipboard.writeText(url);
              toast(t('toastLinkCopied'), 'success');
            } catch {
              toast(t('errCopy'), 'error');
            }
          }}
          className="btn-ghost inline-flex items-center gap-1.5 whitespace-nowrap"
          title={t('copyLinkTitle')}
        >
          {t('copyLink')}
        </button>
        <button onClick={openCreate} className="btn-primary">
          {t('addIndustry')}
        </button>
      </div>

      {loading ? (
        <div className="text-mute py-10 text-center">{t('loading')}</div>
      ) : filtered.length === 0 ? (
        <div className="card card-pad text-center py-10 text-mute">
          {items.length === 0
            ? t('emptyNoIndustries')
            : t('emptyNoResults')}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((i, idx) => {
            const realIdx = items.findIndex((x) => x.id === i.id);
            return (
              <div
                key={i.id}
                className="card card-pad flex flex-col"
                style={{
                  borderTop: i.themeColor
                    ? `3px solid ${i.themeColor}`
                    : undefined,
                  opacity: i.isActive ? 1 : 0.6,
                }}
              >
                {i.coverImage && (
                  <div
                    className="-mx-4 -mt-4 mb-3 h-28 bg-cover bg-center rounded-t-2xl"
                    style={{ backgroundImage: `url("${i.coverImage}")` }}
                  />
                )}
                <div className="flex items-start gap-3">
                  <div className="text-4xl leading-none flex-none">
                    {i.iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={i.iconUrl}
                        alt=""
                        className="w-10 h-10 object-contain"
                      />
                    ) : (
                      i.emoji || '🏢'
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold leading-tight truncate">
                      {i.name}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-mute font-mono mt-0.5 truncate">
                      /{i.slug}
                    </div>
                  </div>
                  {!i.isActive && (
                    <span className="badge badge-warn text-[10px]">{t('badgeInactive')}</span>
                  )}
                </div>
                {i.description && (
                  <p className="text-xs text-mute mt-2 leading-relaxed line-clamp-3">
                    {i.description}
                  </p>
                )}
                <div className="mt-3 pt-3 border-t border-line2 flex items-center justify-between gap-2">
                  <Link
                    href={`/admin/industries/${i.id}`}
                    className="text-xs text-brand font-semibold hover:underline"
                  >
                    {t('editSlides')}
                  </Link>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => move(i, 'up')}
                      disabled={realIdx === 0}
                      className="text-mute hover:text-ink disabled:opacity-20 px-1.5 py-0.5"
                      title={t('moveUp')}
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => move(i, 'down')}
                      disabled={realIdx === items.length - 1}
                      className="text-mute hover:text-ink disabled:opacity-20 px-1.5 py-0.5"
                      title={t('moveDown')}
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => toggleActive(i)}
                      className="text-[11px] text-mute hover:text-ink px-2 py-1"
                      title={i.isActive ? t('deactivate') : t('activate')}
                    >
                      {i.isActive ? '👁' : '🚫'}
                    </button>
                    <button
                      onClick={() => openEdit(i)}
                      className="text-[11px] text-mute hover:text-ink px-2 py-1"
                      title={t('edit')}
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => remove(i)}
                      className="text-[11px] text-bad hover:text-bad px-2 py-1"
                      title={t('delete')}
                    >
                      🗑
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de creación/edición */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
          onClick={() => !saving && setModalOpen(false)}
        >
          <div
            className="card card-pad w-full max-w-xl mt-10 mb-10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold m-0">
                {editing ? t('modalEditTitle') : t('modalNewTitle')}
              </h2>
              <button
                type="button"
                onClick={() => !saving && setModalOpen(false)}
                className="text-mute hover:text-ink text-xl"
              >
                ×
              </button>
            </div>

            <form onSubmit={submit} className="space-y-3">
              <div className="grid grid-cols-[80px_1fr] gap-3">
                <div>
                  <label className="label">{t('labelEmoji')}</label>
                  <input
                    type="text"
                    className="input text-2xl text-center"
                    value={form.emoji ?? ''}
                    onChange={(e) => patchForm({ emoji: e.target.value })}
                    maxLength={4}
                    placeholder="☕"
                  />
                </div>
                <div>
                  <label className="label">{t('labelName')}</label>
                  <input
                    className="input"
                    value={form.name ?? ''}
                    onChange={(e) => onNameChange(e.target.value)}
                    maxLength={120}
                    required
                    placeholder={t('phName')}
                  />
                </div>
              </div>

              <div>
                <label className="label">
                  {t('labelSlug')}{' '}
                  <span className="text-[10px] text-mute font-normal">
                    (URL: /industria/{form.slug || t('slugPlaceholderHint')})
                  </span>
                </label>
                <input
                  className="input font-mono text-sm"
                  value={form.slug ?? ''}
                  onChange={(e) => {
                    setSlugTouched(true);
                    patchForm({ slug: e.target.value });
                  }}
                  maxLength={80}
                  placeholder="cafeterias"
                />
              </div>

              <div>
                <label className="label">{t('labelDescription')}</label>
                <textarea
                  className="input"
                  rows={2}
                  value={form.description ?? ''}
                  onChange={(e) => patchForm({ description: e.target.value })}
                  maxLength={500}
                  placeholder={t('phDescription')}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('labelThemeColor')}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      className="w-10 h-10 rounded-lg border border-line cursor-pointer"
                      value={form.themeColor ?? '#22C55E'}
                      onChange={(e) => patchForm({ themeColor: e.target.value })}
                    />
                    <input
                      type="text"
                      className="input flex-1 font-mono text-xs"
                      value={form.themeColor ?? ''}
                      onChange={(e) => patchForm({ themeColor: e.target.value })}
                      maxLength={9}
                      placeholder="#22C55E"
                    />
                  </div>
                </div>
                <div>
                  <label className="label">{t('labelOrder')}</label>
                  <input
                    type="number"
                    className="input"
                    value={form.sortOrder ?? 0}
                    onChange={(e) =>
                      patchForm({ sortOrder: Number(e.target.value) || 0 })
                    }
                  />
                </div>
              </div>

              <div>
                <label className="label">{t('labelIcon')}</label>
                <ImageUploader
                  value={form.iconUrl}
                  onChange={(url) => patchForm({ iconUrl: url })}
                  folder="industries"
                  crop
                  aspect={1}
                />
                <div className="text-[11px] text-mute mt-1">
                  {t('iconHint')}
                </div>
              </div>

              <div>
                <label className="label">{t('labelCover')}</label>
                <ImageUploader
                  value={form.coverImage}
                  onChange={(url) => patchForm({ coverImage: url })}
                  folder="industries"
                  crop
                  aspect={16 / 9}
                />
                <div className="text-[11px] text-mute mt-1">
                  {t('coverHint')}
                </div>

                <div className="mt-4 pt-4 border-t border-line2">
                  <BannerStylePicker
                    industry={{
                      name: form.name || t('previewIndustryName'),
                      description: form.description ?? null,
                      emoji: form.emoji ?? null,
                      iconUrl: form.iconUrl ?? null,
                      coverImage: form.coverImage ?? null,
                      coverStyle: form.coverStyle ?? 'DARK_OVERLAY',
                      themeColor: form.themeColor ?? '#22C55E',
                    }}
                    selected={form.coverStyle ?? 'DARK_OVERLAY'}
                    onSelect={(style) => patchForm({ coverStyle: style })}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isActive ?? true}
                  onChange={(e) => patchForm({ isActive: e.target.checked })}
                  className="rounded"
                />
                {t('labelActive')}
              </label>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-line2">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => !saving && setModalOpen(false)}
                  disabled={saving}
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={saving}
                >
                  {saving
                    ? t('saving')
                    : editing
                      ? t('saveChanges')
                      : t('createIndustry')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
