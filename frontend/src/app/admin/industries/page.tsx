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
      toast('El nombre es obligatorio', 'error');
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
        toast('Industria actualizada', 'success');
      } else {
        await api('/admin/industries', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        toast('Industria creada', 'success');
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      toast(err?.message || 'No se pudo guardar', 'error');
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
      toast(e?.message || 'No se pudo actualizar', 'error');
    }
  }

  async function remove(i: Industry) {
    if (
      !confirm(
        `¿Eliminar "${i.name}"? Si tiene presentaciones, se eliminan también (CASCADE).`,
      )
    )
      return;
    try {
      await api(`/admin/industries/${i.id}`, { method: 'DELETE' });
      toast('Industria eliminada', 'success');
      setItems((arr) => arr.filter((x) => x.id !== i.id));
    } catch (e: any) {
      toast(e?.message || 'No se pudo eliminar', 'error');
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
      toast(e?.message || 'No se pudo reordenar', 'error');
      load();
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Industrias{' '}
          <span className="page-crumb">
            / {items.length} {items.length === 1 ? 'industria' : 'industrias'}
          </span>
        </h1>
      </div>

      <div className="card card-pad mb-5">
        <h3 className="text-base font-semibold m-0 flex items-center gap-2">
          🏢 Catálogo de industrias (sales decks)
        </h3>
        <p className="text-sm text-mute mt-2 leading-relaxed">
          Cada industria agrupa presentaciones y slides específicos para esa
          vertical. Después de crear una industria, hacé click en su card
          para gestionar las <b>presentaciones</b> que viven adentro.
        </p>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <input
          type="search"
          className="input flex-1 max-w-sm"
          placeholder="Buscar por nombre, slug o descripción…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button onClick={openCreate} className="btn-primary">
          + Industria
        </button>
      </div>

      {loading ? (
        <div className="text-mute py-10 text-center">Cargando…</div>
      ) : filtered.length === 0 ? (
        <div className="card card-pad text-center py-10 text-mute">
          {items.length === 0
            ? 'Todavía no hay industrias. Creá la primera arriba.'
            : 'Sin resultados para tu búsqueda.'}
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
                    <span className="badge badge-warn text-[10px]">Inactiva</span>
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
                    Ver presentaciones →
                  </Link>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => move(i, 'up')}
                      disabled={realIdx === 0}
                      className="text-mute hover:text-ink disabled:opacity-20 px-1.5 py-0.5"
                      title="Subir"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => move(i, 'down')}
                      disabled={realIdx === items.length - 1}
                      className="text-mute hover:text-ink disabled:opacity-20 px-1.5 py-0.5"
                      title="Bajar"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => toggleActive(i)}
                      className="text-[11px] text-mute hover:text-ink px-2 py-1"
                      title={i.isActive ? 'Desactivar' : 'Activar'}
                    >
                      {i.isActive ? '👁' : '🚫'}
                    </button>
                    <button
                      onClick={() => openEdit(i)}
                      className="text-[11px] text-mute hover:text-ink px-2 py-1"
                      title="Editar"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => remove(i)}
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
                {editing ? 'Editar industria' : 'Nueva industria'}
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
                  <label className="label">Emoji</label>
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
                  <label className="label">Nombre *</label>
                  <input
                    className="input"
                    value={form.name ?? ''}
                    onChange={(e) => onNameChange(e.target.value)}
                    maxLength={120}
                    required
                    placeholder="Ej: Cafeterías"
                  />
                </div>
              </div>

              <div>
                <label className="label">
                  Slug{' '}
                  <span className="text-[10px] text-mute font-normal">
                    (URL: /industria/{form.slug || 'slug-aqui'})
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
                <label className="label">Descripción</label>
                <textarea
                  className="input"
                  rows={2}
                  value={form.description ?? ''}
                  onChange={(e) => patchForm({ description: e.target.value })}
                  maxLength={500}
                  placeholder="Cafeterías de especialidad, brunch, cafés con menú digital"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Color del tema</label>
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
                <label className="label">Ícono (cuadrado, opcional)</label>
                <ImageUploader
                  value={form.iconUrl}
                  onChange={(url) => patchForm({ iconUrl: url })}
                  folder="industries"
                  crop
                  aspect={1}
                />
                <div className="text-[11px] text-mute mt-1">
                  Si subís un ícono, se usa en vez del emoji.
                </div>
              </div>

              <div>
                <label className="label">Imagen de portada (opcional)</label>
                <ImageUploader
                  value={form.coverImage}
                  onChange={(url) => patchForm({ coverImage: url })}
                  folder="industries"
                  crop
                  aspect={16 / 9}
                />
                <div className="text-[11px] text-mute mt-1">
                  Banner que aparece arriba de la card y en la vista pública.
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isActive ?? true}
                  onChange={(e) => patchForm({ isActive: e.target.checked })}
                  className="rounded"
                />
                Industria activa (visible públicamente)
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
                      : 'Crear industria'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
