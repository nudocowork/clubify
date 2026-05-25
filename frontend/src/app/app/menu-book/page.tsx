'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { ImageUploader } from '@/components/ImageUploader';
import { SortableList, DragHandle } from '@/components/Sortable';
import { toast } from '@/components/Toast';

// ─────────────────────────────────────────────────────────────────────
// Tipos espejo del backend (catalog/menu-book.service.ts)
// ─────────────────────────────────────────────────────────────────────

type BookPage = {
  id: string;
  sectionId: string;
  imageUrl: string;
  sortOrder: number;
  isActive: boolean;
  popupEnabled: boolean;
  popupTitle: string | null;
  popupDescription: string | null;
  popupImageUrl: string | null;
  popupButtonText: string | null;
  popupButtonUrl: string | null;
  popupButtonColor: string | null;
};

type BookSection = {
  id: string;
  tenantId: string;
  title: string;
  sortOrder: number;
  isActive: boolean;
  pages: BookPage[];
};

// ─────────────────────────────────────────────────────────────────────
// Página principal
// ─────────────────────────────────────────────────────────────────────

export default function MenuBookAdminPage() {
  const [sections, setSections] = useState<BookSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [popupPage, setPopupPage] = useState<BookPage | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [bookMenuEnabled, setBookMenuEnabled] = useState<boolean | null>(null);
  const [storefrontId, setStorefrontId] = useState<string | null>(null);
  const [togglingBook, setTogglingBook] = useState(false);

  useEffect(() => {
    api<any>('/tenants/me')
      .then((t) => setTenantSlug(t?.slug ?? null))
      .catch(() => {});
    api<any>('/storefront')
      .then((sf) => {
        setBookMenuEnabled(sf?.bookMenuEnabled ?? false);
        setStorefrontId(sf?.id ?? null);
      })
      .catch(() => {});
  }, []);

  async function toggleBook(next: boolean) {
    setTogglingBook(true);
    try {
      await api('/storefront', {
        method: 'PATCH',
        body: JSON.stringify({ bookMenuEnabled: next }),
      });
      setBookMenuEnabled(next);
      toast(next ? 'Menú libro activado' : 'Menú libro desactivado', 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo actualizar', 'error');
    } finally {
      setTogglingBook(false);
    }
  }
  // (storefrontId no se usa aún — placeholder para futuras acciones que
  // requieran el id sin re-fetch del storefront.)
  void storefrontId;

  async function reload() {
    setLoading(true);
    try {
      const data = await api<BookSection[]>('/catalog/menu-book');
      setSections(data);
    } catch (e: any) {
      toast(e.message || 'Error cargando menú libro', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function createSection() {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      await api('/catalog/menu-book/sections', {
        method: 'POST',
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      setNewTitle('');
      reload();
    } catch (e: any) {
      toast(e.message || 'Error creando sección', 'error');
    } finally {
      setCreating(false);
    }
  }

  async function onReorderSections(next: BookSection[]) {
    setSections(next); // optimistic
    try {
      await api('/catalog/menu-book/sections/reorder', {
        method: 'POST',
        body: JSON.stringify({ ids: next.map((s) => s.id) }),
      });
    } catch (e: any) {
      toast(e.message || 'Error reordenando', 'error');
      reload();
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-[260px]">
          <h1 className="text-2xl font-bold m-0 flex items-center gap-2">
            <Icon name="book" size={22} /> Menú Libro
          </h1>
          <p className="text-sm text-mute mt-1 max-w-xl leading-relaxed">
            Menú visual tipo libro / flipbook. Organizá las páginas-imagen
            por sección. Vive en su propia URL pública{' '}
            <code className="text-[12px] px-1 py-0.5 bg-bg2 rounded">/book/&lt;negocio&gt;</code>{' '}
            — independiente del menú digital tradicional.
          </p>
          {bookMenuEnabled !== null && (
            <div className="mt-3 flex items-center gap-3">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={!!bookMenuEnabled}
                  disabled={togglingBook}
                  onChange={(e) => toggleBook(e.target.checked)}
                  className="accent-brand"
                />
                <span className="text-sm font-semibold">
                  Activar menú libro en el público
                </span>
              </label>
              {!bookMenuEnabled && (
                <span className="text-xs text-mute">
                  Cuando esté apagado, <code>/book/{tenantSlug ?? '...'}</code> no abre.
                </span>
              )}
            </div>
          )}
        </div>
        {tenantSlug && bookMenuEnabled && (
          <a
            href={`/book/${tenantSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary text-sm whitespace-nowrap inline-flex items-center gap-2"
            title="Abre el menú libro público en otra pestaña"
          >
            👀 Ver menú libro
          </a>
        )}
      </header>

      <div className="card card-pad">
        <div className="text-sm font-semibold mb-2">Crear nueva sección</div>
        <div className="flex gap-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Ej: Entradas frías, Carnes, Postres…"
            className="flex-1 px-3 py-2 text-sm rounded-md border border-line2 focus:outline-none focus:ring-2 focus:ring-brand"
            onKeyDown={(e) => {
              if (e.key === 'Enter') createSection();
            }}
            maxLength={80}
          />
          <button
            onClick={createSection}
            disabled={creating || !newTitle.trim()}
            className="btn-primary text-sm whitespace-nowrap disabled:opacity-50"
          >
            {creating ? 'Creando…' : '+ Sección'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card card-pad h-32 animate-shimmer" />
      ) : sections.length === 0 ? (
        <div className="card card-pad text-center text-mute py-12">
          <div className="text-3xl mb-2">📖</div>
          <div className="font-medium text-ink">Aún no hay secciones</div>
          <div className="text-xs mt-1">
            Empezá creando una sección arriba (ej: "Entradas frías"). Después
            subís imágenes-página dentro.
          </div>
        </div>
      ) : (
        <SortableList
          items={sections}
          onReorder={onReorderSections}
          className="space-y-4"
        >
          {(section, ctx) => (
            <SectionCard
              section={section}
              dragHandleProps={ctx.dragHandleProps}
              onChange={reload}
              onOpenPopup={(p) => setPopupPage(p)}
            />
          )}
        </SortableList>
      )}

      {popupPage && (
        <PopupEditorModal
          page={popupPage}
          onClose={() => setPopupPage(null)}
          onSaved={() => {
            setPopupPage(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sección individual
// ─────────────────────────────────────────────────────────────────────

function SectionCard({
  section,
  dragHandleProps,
  onChange,
  onOpenPopup,
}: {
  section: BookSection;
  dragHandleProps: Record<string, any>;
  onChange: () => void;
  onOpenPopup: (page: BookPage) => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(section.title);
  const [adding, setAdding] = useState(false);

  async function saveTitle() {
    if (!title.trim() || title === section.title) {
      setEditingTitle(false);
      setTitle(section.title);
      return;
    }
    try {
      await api(`/catalog/menu-book/sections/${section.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: title.trim() }),
      });
      setEditingTitle(false);
      onChange();
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
    }
  }

  async function toggleActive() {
    try {
      await api(`/catalog/menu-book/sections/${section.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !section.isActive }),
      });
      onChange();
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
    }
  }

  async function deleteSection() {
    if (
      !confirm(
        `¿Eliminar la sección "${section.title}" y sus ${section.pages.length} página(s)? No se puede deshacer.`,
      )
    )
      return;
    try {
      await api(`/catalog/menu-book/sections/${section.id}`, {
        method: 'DELETE',
      });
      onChange();
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
    }
  }

  async function uploadPage(url: string | null) {
    if (!url) return;
    setAdding(true);
    try {
      await api(`/catalog/menu-book/sections/${section.id}/pages`, {
        method: 'POST',
        body: JSON.stringify({ imageUrl: url }),
      });
      onChange();
    } catch (e: any) {
      toast(e.message || 'Error subiendo página', 'error');
    } finally {
      setAdding(false);
    }
  }

  async function onReorderPages(next: BookPage[]) {
    try {
      await api(`/catalog/menu-book/sections/${section.id}/pages/reorder`, {
        method: 'POST',
        body: JSON.stringify({ ids: next.map((p) => p.id) }),
      });
      onChange();
    } catch (e: any) {
      toast(e.message || 'Error reordenando', 'error');
    }
  }

  return (
    <div className={`card overflow-hidden ${!section.isActive ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-line2 bg-bg2">
        <DragHandle {...dragHandleProps} />
        {editingTitle ? (
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveTitle();
              if (e.key === 'Escape') {
                setEditingTitle(false);
                setTitle(section.title);
              }
            }}
            autoFocus
            maxLength={80}
            className="flex-1 px-2 py-1 text-sm font-semibold rounded-md border border-line2 focus:outline-none focus:ring-2 focus:ring-brand"
          />
        ) : (
          <button
            onClick={() => setEditingTitle(true)}
            className="flex-1 text-left font-semibold hover:text-brand transition"
            title="Click para renombrar"
          >
            {section.title}
          </button>
        )}
        <span className="text-xs text-mute">
          {section.pages.length} pág{section.pages.length === 1 ? '' : 's'}
        </span>
        <button
          onClick={toggleActive}
          className={`text-xs font-semibold px-2 py-1 rounded-md whitespace-nowrap ${
            section.isActive
              ? 'bg-ok-soft text-ok-ink hover:bg-ok-soft/70'
              : 'bg-bg3 text-mute hover:bg-line2'
          }`}
          title={section.isActive ? 'Sección visible en el público' : 'Sección oculta'}
        >
          {section.isActive ? '● Activa' : '○ Inactiva'}
        </button>
        <button
          onClick={deleteSection}
          className="text-xs font-semibold p-1.5 rounded-md text-bad-ink hover:bg-bad-soft"
          title="Eliminar sección"
        >
          <Icon name="trash" size={14} />
        </button>
      </div>

      <div className="p-4">
        {section.pages.length === 0 ? (
          <div className="text-center text-mute text-sm py-6">
            Aún no hay páginas en esta sección. Subí la primera abajo.
          </div>
        ) : (
          <SortableList
            items={section.pages}
            onReorder={onReorderPages}
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-3"
          >
            {(page, ctx) => (
              <PageCard
                page={page}
                dragHandleProps={ctx.dragHandleProps}
                onChange={onChange}
                onOpenPopup={() => onOpenPopup(page)}
              />
            )}
          </SortableList>
        )}

        <div className="mt-3">
          <div className="text-xs font-medium text-mute mb-1.5">
            Agregar página (recomendado mínimo 1080px de ancho)
          </div>
          <ImageUploader
            folder="menu-book"
            crop={false}
            maxSizeMb={25}
            onChange={uploadPage}
            value={null}
          />
          {adding && <div className="text-xs text-mute mt-1">Guardando…</div>}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tarjeta de página (imagen + popup toggle)
// ─────────────────────────────────────────────────────────────────────

function PageCard({
  page,
  dragHandleProps,
  onChange,
  onOpenPopup,
}: {
  page: BookPage;
  dragHandleProps: Record<string, any>;
  onChange: () => void;
  onOpenPopup: () => void;
}) {
  async function toggleActive() {
    try {
      await api(`/catalog/menu-book/pages/${page.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !page.isActive }),
      });
      onChange();
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
    }
  }

  async function deletePage() {
    if (!confirm('¿Eliminar esta página? No se puede deshacer.')) return;
    try {
      await api(`/catalog/menu-book/pages/${page.id}`, { method: 'DELETE' });
      onChange();
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
    }
  }

  return (
    <div
      className={`relative group rounded-xl overflow-hidden border border-line2 bg-bg2 aspect-[3/4] ${
        !page.isActive ? 'opacity-50' : ''
      }`}
    >
      <img
        src={page.imageUrl}
        alt=""
        className="w-full h-full object-cover"
        loading="lazy"
      />
      {page.popupEnabled && (
        <div className="absolute top-1.5 left-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 shadow-sm">
          🔔 Popup
        </div>
      )}
      <div className="absolute top-1.5 right-1.5">
        <DragHandle
          {...dragHandleProps}
          className="bg-white/85 hover:bg-white shadow-sm rounded p-1 cursor-grab active:cursor-grabbing"
        />
      </div>
      <div className="absolute inset-x-0 bottom-0 p-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition bg-gradient-to-t from-black/70 to-transparent pt-6">
        <button
          onClick={onOpenPopup}
          className="text-[10px] font-semibold px-2 py-1 rounded-md bg-white/90 hover:bg-white"
          title="Editar popup"
        >
          🔔 Popup
        </button>
        <button
          onClick={toggleActive}
          className="text-[10px] font-semibold px-2 py-1 rounded-md bg-white/90 hover:bg-white"
          title={page.isActive ? 'Ocultar página' : 'Activar página'}
        >
          {page.isActive ? '○' : '●'}
        </button>
        <button
          onClick={deletePage}
          className="text-[10px] font-semibold px-2 py-1 rounded-md bg-rose-500/90 hover:bg-rose-500 text-white ml-auto"
          title="Eliminar página"
        >
          <Icon name="trash" size={11} />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Modal de editor del popup
// ─────────────────────────────────────────────────────────────────────

function PopupEditorModal({
  page,
  onClose,
  onSaved,
}: {
  page: BookPage;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    popupEnabled: page.popupEnabled,
    popupTitle: page.popupTitle ?? '',
    popupDescription: page.popupDescription ?? '',
    popupImageUrl: page.popupImageUrl ?? '',
    popupButtonText: page.popupButtonText ?? '',
    popupButtonUrl: page.popupButtonUrl ?? '',
    popupButtonColor: page.popupButtonColor ?? '#22c55e',
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api(`/catalog/menu-book/pages/${page.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          popupEnabled: form.popupEnabled,
          popupTitle: form.popupTitle.trim() || null,
          popupDescription: form.popupDescription.trim() || null,
          popupImageUrl: form.popupImageUrl.trim() || null,
          popupButtonText: form.popupButtonText.trim() || null,
          popupButtonUrl: form.popupButtonUrl.trim() || null,
          popupButtonColor: form.popupButtonColor || null,
        }),
      });
      toast('Popup actualizado', 'success');
      onSaved();
    } catch (e: any) {
      toast(e.message || 'Error guardando', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-line2 flex items-center justify-between">
          <div className="font-semibold text-base">🔔 Popup de esta página</div>
          <button
            onClick={onClose}
            className="text-mute hover:text-ink text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.popupEnabled}
              onChange={(e) =>
                setForm({ ...form, popupEnabled: e.target.checked })
              }
              className="w-4 h-4 accent-brand"
            />
            <span className="text-sm font-medium">Activar popup al hacer tap en esta imagen</span>
          </label>

          <div className={form.popupEnabled ? '' : 'opacity-50 pointer-events-none'}>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 grid sm:grid-cols-[1fr_1fr] gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Título</label>
                  <input
                    value={form.popupTitle}
                    onChange={(e) =>
                      setForm({ ...form, popupTitle: e.target.value })
                    }
                    maxLength={120}
                    placeholder="Ej: Recomendación del chef"
                    className="w-full px-3 py-2 text-sm rounded-md border border-line2"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">
                    Imagen del popup (opcional)
                  </label>
                  <ImageUploader
                    folder="menu-book-popup"
                    crop={false}
                    maxSizeMb={25}
                    value={form.popupImageUrl || null}
                    onChange={(url) =>
                      setForm({ ...form, popupImageUrl: url ?? '' })
                    }
                  />
                </div>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">Descripción</label>
                <textarea
                  value={form.popupDescription}
                  onChange={(e) =>
                    setForm({ ...form, popupDescription: e.target.value })
                  }
                  maxLength={2000}
                  rows={3}
                  placeholder="Texto que aparece en el popup. Podés contar ingredientes, historia del plato, o invitar a una reserva."
                  className="w-full px-3 py-2 text-sm rounded-md border border-line2 resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Texto del botón</label>
                <input
                  value={form.popupButtonText}
                  onChange={(e) =>
                    setForm({ ...form, popupButtonText: e.target.value })
                  }
                  maxLength={40}
                  placeholder="Ej: Pedir por WhatsApp"
                  className="w-full px-3 py-2 text-sm rounded-md border border-line2"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Link del botón</label>
                <input
                  value={form.popupButtonUrl}
                  onChange={(e) =>
                    setForm({ ...form, popupButtonUrl: e.target.value })
                  }
                  maxLength={500}
                  placeholder="https://wa.me/57…"
                  className="w-full px-3 py-2 text-sm rounded-md border border-line2"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">
                  Color del botón
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form.popupButtonColor}
                    onChange={(e) =>
                      setForm({ ...form, popupButtonColor: e.target.value })
                    }
                    className="w-10 h-10 rounded border border-line2 cursor-pointer"
                  />
                  <input
                    value={form.popupButtonColor}
                    onChange={(e) =>
                      setForm({ ...form, popupButtonColor: e.target.value })
                    }
                    placeholder="#22c55e"
                    maxLength={7}
                    className="flex-1 px-3 py-2 text-sm rounded-md border border-line2 font-mono"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-line2 flex items-center justify-end gap-2 bg-bg2">
          <button
            onClick={onClose}
            disabled={busy}
            className="text-sm px-3 py-2 rounded-md hover:bg-bg3"
          >
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {busy ? 'Guardando…' : 'Guardar popup'}
          </button>
        </div>
      </div>
    </div>
  );
}
