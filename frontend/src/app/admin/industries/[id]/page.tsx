'use client';
/**
 * Admin: detalle de una industria con su lista de presentations.
 *
 * Cada card de presentation linkea al editor de slides
 * (/admin/industries/{id}/presentations/{pid}).
 *
 * Acciones por presentation: editar metadatos, duplicar (deep clone con
 * slides, arranca inactiva), toggle activo, eliminar, reordenar ↑↓.
 *
 * El modal de creación/edición tiene los campos básicos (title, slug,
 * description, coverImage, themeColor, isActive). Para diseñar los
 * slides el cliente entra al editor.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { ImageUploader } from '@/components/ImageUploader';

type Industry = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  emoji: string | null;
  iconUrl: string | null;
  coverImage: string | null;
  themeColor: string | null;
  isActive: boolean;
};

type Presentation = {
  id: string;
  industryId: string;
  title: string;
  slug: string;
  description: string | null;
  coverImage: string | null;
  themeColor: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  _count?: { slides: number };
};

type FormState = Partial<Presentation>;

const DEFAULT_FORM: FormState = {
  title: '',
  slug: '',
  description: '',
  coverImage: null,
  themeColor: null,
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

export default function IndustryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [industry, setIndustry] = useState<Industry | null>(null);
  const [items, setItems] = useState<Presentation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Presentation | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([
      api<Industry>(`/admin/industries/${id}`),
      api<Presentation[]>(`/admin/presentations?industryId=${id}`),
    ])
      .then(([ind, pres]) => {
        setIndustry(ind);
        setItems(pres);
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q),
    );
  }, [items, search]);

  function openCreate() {
    setEditing(null);
    setForm({
      ...DEFAULT_FORM,
      themeColor: industry?.themeColor ?? null,
      sortOrder: (items[items.length - 1]?.sortOrder ?? 0) + 1,
    });
    setSlugTouched(false);
    setModalOpen(true);
  }

  function openEdit(p: Presentation) {
    setEditing(p);
    setForm({
      title: p.title,
      slug: p.slug,
      description: p.description ?? '',
      coverImage: p.coverImage,
      themeColor: p.themeColor,
      isActive: p.isActive,
      sortOrder: p.sortOrder,
    });
    setSlugTouched(true);
    setModalOpen(true);
  }

  function patchForm(p: Partial<FormState>) {
    setForm((f) => ({ ...f, ...p }));
  }

  function onTitleChange(v: string) {
    setForm((f) => ({
      ...f,
      title: v,
      slug: slugTouched ? f.slug : slugify(v),
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title?.trim()) {
      toast('El título es obligatorio', 'error');
      return;
    }
    setSaving(true);
    const body = {
      industryId: id,
      title: form.title.trim(),
      slug: form.slug?.trim() || slugify(form.title),
      description: form.description?.trim() || null,
      coverImage: form.coverImage || null,
      themeColor: form.themeColor || null,
      isActive: form.isActive ?? true,
      sortOrder: form.sortOrder ?? 0,
    };
    try {
      if (editing) {
        await api(`/admin/presentations/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        toast('Presentación actualizada', 'success');
      } else {
        await api('/admin/presentations', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        toast('Presentación creada', 'success');
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      toast(err?.message || 'No se pudo guardar', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(p: Presentation) {
    try {
      await api(`/admin/presentations/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !p.isActive }),
      });
      setItems((arr) =>
        arr.map((x) => (x.id === p.id ? { ...x, isActive: !x.isActive } : x)),
      );
    } catch (e: any) {
      toast(e?.message || 'No se pudo actualizar', 'error');
    }
  }

  async function remove(p: Presentation) {
    if (
      !confirm(
        `¿Eliminar "${p.title}"? Sus slides se eliminan también (CASCADE).`,
      )
    )
      return;
    try {
      await api(`/admin/presentations/${p.id}`, { method: 'DELETE' });
      toast('Presentación eliminada', 'success');
      setItems((arr) => arr.filter((x) => x.id !== p.id));
    } catch (e: any) {
      toast(e?.message || 'No se pudo eliminar', 'error');
    }
  }

  async function duplicate(p: Presentation) {
    try {
      const dup = await api<Presentation>(
        `/admin/presentations/${p.id}/duplicate`,
        { method: 'POST' },
      );
      toast('Duplicada (inactiva — revisá y activá)', 'success');
      setItems((arr) => [...arr, dup]);
    } catch (e: any) {
      toast(e?.message || 'No se pudo duplicar', 'error');
    }
  }

  async function move(p: Presentation, dir: 'up' | 'down') {
    const idx = items.findIndex((x) => x.id === p.id);
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= items.length) return;
    const next = [...items];
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    const renumbered = next.map((x, i) => ({ ...x, sortOrder: i }));
    setItems(renumbered);
    try {
      await api('/admin/presentations/reorder', {
        method: 'PATCH',
        body: JSON.stringify({
          items: renumbered.map((x) => ({ id: x.id, sortOrder: x.sortOrder })),
        }),
      });
    } catch (e: any) {
      toast(e?.message || 'No se pudo reordenar', 'error');
      load();
    }
  }

  if (loading) {
    return <div className="text-mute py-10 text-center">Cargando…</div>;
  }
  if (!industry) {
    return (
      <div className="card card-pad text-center py-10">
        <div className="text-3xl mb-2">⚠️</div>
        <div className="font-semibold">Industria no encontrada</div>
        <Link
          href="/admin/industries"
          className="btn-primary inline-block mt-4"
        >
          ← Volver a Industrias
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          <Link
            href="/admin/industries"
            className="text-mute hover:text-ink"
          >
            Industrias
          </Link>{' '}
          <span className="page-crumb">
            / {industry.emoji ?? '🏢'} {industry.name}
          </span>
        </h1>
      </div>

      <div className="card card-pad mb-5 flex items-start gap-4">
        <div className="text-5xl leading-none flex-none">
          {industry.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={industry.iconUrl}
              alt=""
              className="w-12 h-12 object-contain"
            />
          ) : (
            industry.emoji || '🏢'
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-semibold">{industry.name}</div>
          <div className="text-[11px] uppercase tracking-wider text-mute font-mono mt-0.5">
            /industria/{industry.slug}
          </div>
          {industry.description && (
            <p className="text-sm text-mute mt-2 leading-relaxed">
              {industry.description}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <input
          type="search"
          className="input flex-1 max-w-sm"
          placeholder="Buscar presentaciones…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button onClick={openCreate} className="btn-primary">
          + Presentación
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="card card-pad text-center py-10 text-mute">
          {items.length === 0
            ? 'Todavía no hay presentaciones en esta industria. Creá la primera arriba.'
            : 'Sin resultados.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((p) => {
            const realIdx = items.findIndex((x) => x.id === p.id);
            const accent =
              p.themeColor ?? industry.themeColor ?? '#22C55E';
            return (
              <div
                key={p.id}
                className="card card-pad flex flex-col"
                style={{
                  borderTop: `3px solid ${accent}`,
                  opacity: p.isActive ? 1 : 0.6,
                }}
              >
                {p.coverImage && (
                  <div
                    className="-mx-4 -mt-4 mb-3 h-28 bg-cover bg-center rounded-t-2xl"
                    style={{ backgroundImage: `url("${p.coverImage}")` }}
                  />
                )}
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold leading-tight truncate">
                      {p.title}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-mute font-mono mt-0.5 truncate">
                      /{p.slug}
                    </div>
                  </div>
                  {!p.isActive && (
                    <span className="badge badge-warn text-[10px]">
                      Inactiva
                    </span>
                  )}
                </div>
                {p.description && (
                  <p className="text-xs text-mute mt-2 leading-relaxed line-clamp-3">
                    {p.description}
                  </p>
                )}
                <div className="text-[11px] text-mute mt-2">
                  {p._count?.slides ?? 0}{' '}
                  {(p._count?.slides ?? 0) === 1 ? 'slide' : 'slides'}
                </div>
                <div className="mt-3 pt-3 border-t border-line2 flex items-center justify-between gap-2">
                  <Link
                    href={`/admin/industries/${id}/presentations/${p.id}`}
                    className="text-xs text-brand font-semibold hover:underline"
                  >
                    Editar slides →
                  </Link>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => move(p, 'up')}
                      disabled={realIdx === 0}
                      className="text-mute hover:text-ink disabled:opacity-20 px-1.5 py-0.5"
                      title="Subir"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => move(p, 'down')}
                      disabled={realIdx === items.length - 1}
                      className="text-mute hover:text-ink disabled:opacity-20 px-1.5 py-0.5"
                      title="Bajar"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => duplicate(p)}
                      className="text-[11px] text-mute hover:text-ink px-2 py-1"
                      title="Duplicar"
                    >
                      📋
                    </button>
                    <button
                      onClick={() => toggleActive(p)}
                      className="text-[11px] text-mute hover:text-ink px-2 py-1"
                      title={p.isActive ? 'Desactivar' : 'Activar'}
                    >
                      {p.isActive ? '👁' : '🚫'}
                    </button>
                    <button
                      onClick={() => openEdit(p)}
                      className="text-[11px] text-mute hover:text-ink px-2 py-1"
                      title="Editar metadatos"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => remove(p)}
                      className="text-[11px] text-bad hover:text-bad px-2 py-1"
                      title="Eliminar"
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
                {editing ? 'Editar presentación' : 'Nueva presentación'}
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
              <div>
                <label className="label">Título *</label>
                <input
                  className="input"
                  value={form.title ?? ''}
                  onChange={(e) => onTitleChange(e.target.value)}
                  maxLength={160}
                  required
                  placeholder="Ej: Menú digital + pedidos WhatsApp"
                />
              </div>

              <div>
                <label className="label">
                  Slug{' '}
                  <span className="text-[10px] text-mute font-normal">
                    (URL: /presentacion/{form.slug || 'slug-aqui'})
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
                  placeholder="menu-digital-pedidos"
                />
              </div>

              <div>
                <label className="label">Descripción</label>
                <textarea
                  className="input"
                  rows={2}
                  value={form.description ?? ''}
                  onChange={(e) => patchForm({ description: e.target.value })}
                  maxLength={500}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Color del tema</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      className="w-10 h-10 rounded-lg border border-line cursor-pointer"
                      value={form.themeColor ?? industry.themeColor ?? '#22C55E'}
                      onChange={(e) =>
                        patchForm({ themeColor: e.target.value })
                      }
                    />
                    <input
                      type="text"
                      className="input flex-1 font-mono text-xs"
                      value={form.themeColor ?? ''}
                      onChange={(e) =>
                        patchForm({ themeColor: e.target.value })
                      }
                      maxLength={9}
                      placeholder="hereda de la industria"
                    />
                  </div>
                </div>
                <div>
                  <label className="label">Orden</label>
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
                <label className="label">Portada (opcional)</label>
                <ImageUploader
                  value={form.coverImage}
                  onChange={(url) => patchForm({ coverImage: url })}
                  folder="presentations"
                  crop
                  aspect={16 / 9}
                />
                <div className="text-[11px] text-mute mt-1">
                  Banner del deck — se usa como primer frame en la vista pública.
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isActive ?? true}
                  onChange={(e) => patchForm({ isActive: e.target.checked })}
                  className="rounded"
                />
                Presentación activa
              </label>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-line2">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => !saving && setModalOpen(false)}
                  disabled={saving}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={saving}
                >
                  {saving
                    ? 'Guardando…'
                    : editing
                      ? 'Guardar cambios'
                      : 'Crear presentación'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
