'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { AcademyButton } from '@/components/AcademyButton';
import { Icon } from '@/components/Icon';
import { ImageUploader } from '@/components/ImageUploader';
import { SortableList, DragHandle } from '@/components/Sortable';
import { toast } from '@/components/Toast';

// ─────────────────────────────────────────────────────────────────────
// Tipos espejo del backend (catalog/menu-book.service.ts)
// ─────────────────────────────────────────────────────────────────────

// M9 (2026-06-06): discriminator del popup. Si missing/NULL → EXTERNAL_LINK
// por back compat con popups creados antes de M9.
type PopupType = 'EXTERNAL_LINK' | 'CARD' | 'IMAGE';

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
  popupType: PopupType | null;
  popupCardId: string | null;
  popupCardCtaLabel: string | null;
  popupImageCaption: string | null;
};

type BookSection = {
  id: string;
  tenantId: string;
  title: string;
  sortOrder: number;
  isActive: boolean;
  // M3: popup que dispara al entrar a la sección. Misma shape que el de
  // página. Opt-in (default false).
  popupEnabled: boolean;
  popupTitle: string | null;
  popupDescription: string | null;
  popupImageUrl: string | null;
  popupButtonText: string | null;
  popupButtonUrl: string | null;
  popupButtonColor: string | null;
  popupType: PopupType | null;
  popupCardId: string | null;
  popupCardCtaLabel: string | null;
  popupImageCaption: string | null;
  pages: BookPage[];
};

/** M3: popup global del libro (Storefront.bookPopup*). Aparece al cargar
 *  /book/<slug> después de bookPopupDelaySeconds. */
type BookGlobalPopup = {
  bookPopupEnabled: boolean;
  bookPopupTitle: string | null;
  bookPopupDescription: string | null;
  bookPopupImageUrl: string | null;
  bookPopupButtonText: string | null;
  bookPopupButtonUrl: string | null;
  bookPopupButtonColor: string | null;
  bookPopupDelaySeconds: number;
  bookPopupType: PopupType | null;
  bookPopupCardId: string | null;
  bookPopupCardCtaLabel: string | null;
  bookPopupImageCaption: string | null;
};

// Card del tenant para el dropdown CARD-picker.
type CardOption = {
  id: string;
  name: string;
  type: string; // STAMPS / COUPON / etc
  isActive: boolean;
};

// ─────────────────────────────────────────────────────────────────────
// Página principal
// ─────────────────────────────────────────────────────────────────────

export default function MenuBookAdminPage() {
  const t = useTranslations('app_menu_book');
  const [sections, setSections] = useState<BookSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [popupPage, setPopupPage] = useState<BookPage | null>(null);
  const [popupSection, setPopupSection] = useState<BookSection | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [brandHost, setBrandHost] = useState<string | null>(null);
  const [qrPng, setQrPng] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const [bookMenuEnabled, setBookMenuEnabled] = useState<boolean | null>(null);
  const [storefrontId, setStorefrontId] = useState<string | null>(null);
  const [togglingBook, setTogglingBook] = useState(false);
  const [bookPopup, setBookPopup] = useState<BookGlobalPopup | null>(null);
  // #29 (2026-06-16): orientación del swipe del menú libro.
  const [bookDirection, setBookDirection] = useState<'HORIZONTAL' | 'VERTICAL'>('HORIZONTAL');

  useEffect(() => {
    api<any>('/tenants/me')
      .then((tenant) => {
        setTenantSlug(tenant?.slug ?? null);
        // El QR tiene que apuntar al dominio de SU marca, no al del panel
        // desde el que se esté navegando: un negocio de Sellea entrando por
        // soyclubify.com generaría un QR de Clubify, impreso y pegado en su
        // mostrador. Lo eligen sus clientes, no nosotros.
        setBrandHost(tenant?.whiteLabel?.appDomain || tenant?.whiteLabel?.domain || null);
      })
      .catch(() => {});
    api<any>('/storefront')
      .then((sf) => {
        setBookMenuEnabled(sf?.bookMenuEnabled ?? false);
        setBookDirection(sf?.bookMenuDirection === 'VERTICAL' ? 'VERTICAL' : 'HORIZONTAL');
        setStorefrontId(sf?.id ?? null);
        setBookPopup({
          bookPopupEnabled: sf?.bookPopupEnabled ?? false,
          bookPopupTitle: sf?.bookPopupTitle ?? null,
          bookPopupDescription: sf?.bookPopupDescription ?? null,
          bookPopupImageUrl: sf?.bookPopupImageUrl ?? null,
          bookPopupButtonText: sf?.bookPopupButtonText ?? null,
          bookPopupButtonUrl: sf?.bookPopupButtonUrl ?? null,
          bookPopupButtonColor: sf?.bookPopupButtonColor ?? null,
          bookPopupDelaySeconds: sf?.bookPopupDelaySeconds ?? 5,
          bookPopupType: (sf?.bookPopupType ?? null) as PopupType | null,
          bookPopupCardId: sf?.bookPopupCardId ?? null,
          bookPopupCardCtaLabel: sf?.bookPopupCardCtaLabel ?? null,
          bookPopupImageCaption: sf?.bookPopupImageCaption ?? null,
        });
      })
      .catch(() => {});
  }, []);

  /** URL pública del menú libro, en el dominio de SU marca. */
  const bookUrl = tenantSlug
    ? `https://${brandHost || (typeof window !== 'undefined' ? window.location.host : 'soyclubify.com')}/book/${tenantSlug}`
    : '';

  async function abrirQr() {
    setQrOpen(true);
    setQrError(null);
    if (qrPng || !bookUrl) return;
    try {
      const QR = (await import('qrcode')).default;
      // 900px: se imprime en mesa y en cartel. Margen 2 para que el lector
      // no falle si lo pegan cerca de un borde.
      setQrPng(await QR.toDataURL(bookUrl, { width: 900, margin: 2 }));
    } catch {
      // Nada de fallar en silencio: si no se genera, el negocio tiene que
      // saberlo, no quedarse mirando un hueco.
      setQrError('No se pudo generar el QR. Inténtalo de nuevo.');
    }
  }


  async function saveBookPopup(next: BookGlobalPopup) {
    try {
      await api('/storefront', {
        method: 'PATCH',
        body: JSON.stringify({
          bookPopupEnabled: next.bookPopupEnabled,
          bookPopupTitle: next.bookPopupTitle ?? null,
          bookPopupDescription: next.bookPopupDescription ?? null,
          bookPopupImageUrl: next.bookPopupImageUrl ?? null,
          bookPopupButtonText: next.bookPopupButtonText ?? null,
          bookPopupButtonUrl: next.bookPopupButtonUrl ?? null,
          bookPopupButtonColor: next.bookPopupButtonColor ?? null,
          bookPopupDelaySeconds: next.bookPopupDelaySeconds,
          bookPopupType: next.bookPopupType ?? null,
          bookPopupCardId: next.bookPopupCardId ?? null,
          bookPopupCardCtaLabel: next.bookPopupCardCtaLabel ?? null,
          bookPopupImageCaption: next.bookPopupImageCaption ?? null,
        }),
      });
      setBookPopup(next);
      toast(t('toastGlobalPopupSaved'), 'success');
    } catch (e: any) {
      toast(e.message || t('errorCouldNotSave'), 'error');
    }
  }

  async function saveDirection(next: 'HORIZONTAL' | 'VERTICAL') {
    const prev = bookDirection;
    setBookDirection(next);
    try {
      await api('/storefront', {
        method: 'PATCH',
        body: JSON.stringify({ bookMenuDirection: next }),
      });
      toast(
        next === 'VERTICAL'
          ? t('toastDirectionVertical')
          : t('toastDirectionHorizontal'),
        'success',
      );
    } catch (e: any) {
      setBookDirection(prev);
      toast(e.message || t('errorCouldNotUpdate'), 'error');
    }
  }

  async function toggleBook(next: boolean) {
    setTogglingBook(true);
    try {
      await api('/storefront', {
        method: 'PATCH',
        body: JSON.stringify({ bookMenuEnabled: next }),
      });
      setBookMenuEnabled(next);
      toast(next ? t('toastBookEnabled') : t('toastBookDisabled'), 'success');
    } catch (e: any) {
      toast(e.message || t('errorCouldNotUpdate'), 'error');
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
      toast(e.message || t('errorLoadingBook'), 'error');
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
      toast(e.message || t('errorCreatingSection'), 'error');
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
      toast(e.message || t('errorReordering'), 'error');
      reload();
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-[260px]">
          <h1 className="text-2xl font-bold m-0 flex items-center gap-2">
            <Icon name="book" size={22} /> {t('title')}
            <AcademyButton moduleKey="menu-libro" />
          </h1>
          <p className="text-sm text-mute mt-1 max-w-xl leading-relaxed">
            {t.rich('intro', {
              code: (chunks) => (
                <code className="text-[12px] px-1 py-0.5 bg-bg2 rounded">{chunks}</code>
              ),
            })}
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
                  {t('enableBookPublic')}
                </span>
              </label>
              {!bookMenuEnabled && (
                <span className="text-xs text-mute">
                  {t.rich('whenOffHint', {
                    slug: tenantSlug ?? '...',
                    code: (chunks) => <code>{chunks}</code>,
                  })}
                </span>
              )}
            </div>
          )}
          {/* #29 (2026-06-16): orientación del swipe. */}
          {bookMenuEnabled && (
            <div className="mt-3">
              <div className="text-xs font-semibold text-mute mb-1.5">
                {t('swipeDirection')}
              </div>
              <div className="inline-flex rounded-lg border border-line overflow-hidden">
                <button
                  type="button"
                  onClick={() => saveDirection('HORIZONTAL')}
                  className={`px-3 py-1.5 text-sm font-medium transition ${
                    bookDirection === 'HORIZONTAL'
                      ? 'bg-brand text-white'
                      : 'bg-white text-mute hover:bg-bg2'
                  }`}
                >
                  ↔ {t('horizontal')}
                </button>
                <button
                  type="button"
                  onClick={() => saveDirection('VERTICAL')}
                  className={`px-3 py-1.5 text-sm font-medium transition border-l border-line ${
                    bookDirection === 'VERTICAL'
                      ? 'bg-brand text-white'
                      : 'bg-white text-mute hover:bg-bg2'
                  }`}
                >
                  ↕ {t('vertical')}
                </button>
              </div>
            </div>
          )}
        </div>
        {tenantSlug && bookMenuEnabled && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={abrirQr}
              className="btn-ghost text-sm whitespace-nowrap inline-flex items-center gap-2"
              title="Descarga el QR que lleva directo a tu menú libro"
            >
              ⬛ QR del menú
            </button>
            <a
              href={`/book/${tenantSlug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary text-sm whitespace-nowrap inline-flex items-center gap-2"
              title={t('viewBookTooltip')}
            >
              👀 {t('viewBook')}
            </a>
          </div>
        )}
      </header>

      {/* QR del menú libro. Apunta al dominio de la MARCA del negocio: un QR
          impreso vive años en un mostrador, así que no puede llevar el dominio
          de otra plataforma. */}
      {qrOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setQrOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="QR del menú libro"
        >
          <div
            className="bg-white rounded-2xl p-5 max-w-xs w-full text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-bold text-base">QR del menú</div>
            <p className="text-xs text-mute mt-1">
              Imprimílo y pégalo en la mesa: lleva directo a tu menú libro.
            </p>

            {qrError ? (
              <div className="mt-4">
                <p className="text-sm text-bad">{qrError}</p>
                <button
                  type="button"
                  onClick={abrirQr}
                  className="btn-ghost text-sm mt-3"
                >
                  Reintentar
                </button>
              </div>
            ) : qrPng ? (
              <>
                <img
                  src={qrPng}
                  alt="Código QR del menú libro"
                  className="w-full max-w-[240px] mx-auto mt-4 rounded-lg border border-line"
                />
                <div className="text-[11px] text-mute mt-2 break-all">{bookUrl}</div>
                <div className="flex flex-col gap-2 mt-4">
                  <a
                    href={qrPng}
                    download={`qr-menu-${tenantSlug}.png`}
                    className="btn-primary text-sm"
                  >
                    ⬇ Descargar PNG
                  </a>
                  <button
                    type="button"
                    className="btn-ghost text-sm"
                    onClick={() => {
                      navigator.clipboard?.writeText(bookUrl);
                      toast('Enlace copiado', 'success');
                    }}
                  >
                    Copiar enlace
                  </button>
                </div>
              </>
            ) : (
              <div className="h-[240px] flex items-center justify-center text-sm text-mute">
                Generando…
              </div>
            )}

            <button
              type="button"
              className="btn-ghost text-sm mt-3 w-full"
              onClick={() => setQrOpen(false)}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {bookPopup && bookMenuEnabled && (
        <BookGlobalPopupCard popup={bookPopup} onSave={saveBookPopup} />
      )}

      <div className="card card-pad">
        <div className="text-sm font-semibold mb-2">{t('createNewSection')}</div>
        <div className="flex gap-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder={t('phSectionTitle')}
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
            {creating ? t('creating') : t('addSection')}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card card-pad h-32 animate-shimmer" />
      ) : sections.length === 0 ? (
        <div className="card card-pad text-center text-mute py-12">
          <div className="text-3xl mb-2">📖</div>
          <div className="font-medium text-ink">{t('emptyNoSections')}</div>
          <div className="text-xs mt-1">
            {t('emptyNoSectionsHint')}
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
              onOpenSectionPopup={() => setPopupSection(section)}
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

      {popupSection && (
        <SectionPopupModal
          section={popupSection}
          onClose={() => setPopupSection(null)}
          onSaved={() => {
            setPopupSection(null);
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
  onOpenSectionPopup,
}: {
  section: BookSection;
  dragHandleProps: Record<string, any>;
  onChange: () => void;
  onOpenPopup: (page: BookPage) => void;
  onOpenSectionPopup: () => void;
}) {
  const t = useTranslations('app_menu_book');
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
      toast(e.message || t('error'), 'error');
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
      toast(e.message || t('error'), 'error');
    }
  }

  async function deleteSection() {
    if (
      !confirm(
        t('confirmDeleteSection', { title: section.title, count: section.pages.length }),
      )
    )
      return;
    try {
      await api(`/catalog/menu-book/sections/${section.id}`, {
        method: 'DELETE',
      });
      onChange();
    } catch (e: any) {
      toast(e.message || t('error'), 'error');
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
      toast(e.message || t('errorUploadingPage'), 'error');
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
      toast(e.message || t('errorReordering'), 'error');
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
            title={t('clickToRename')}
          >
            {section.title}
          </button>
        )}
        <span className="text-xs text-mute">
          {t('pagesCount', { count: section.pages.length })}
        </span>
        <button
          onClick={toggleActive}
          className={`text-xs font-semibold px-2 py-1 rounded-md whitespace-nowrap ${
            section.isActive
              ? 'bg-ok-soft text-ok-ink hover:bg-ok-soft/70'
              : 'bg-bg3 text-mute hover:bg-line2'
          }`}
          title={section.isActive ? t('sectionVisibleTooltip') : t('sectionHiddenTooltip')}
        >
          {section.isActive ? `● ${t('active')}` : `○ ${t('inactive')}`}
        </button>
        <button
          onClick={onOpenSectionPopup}
          className={`text-xs font-semibold px-2 py-1 rounded-md whitespace-nowrap ${
            section.popupEnabled
              ? 'bg-brand text-white hover:opacity-90'
              : 'bg-bg3 text-mute hover:bg-line2'
          }`}
          title={t('sectionPopupTooltip')}
        >
          🎁 {t('popup')}{section.popupEnabled ? ' ON' : ''}
        </button>
        <button
          onClick={deleteSection}
          className="text-xs font-semibold p-1.5 rounded-md text-bad-ink hover:bg-bad-soft"
          title={t('deleteSection')}
        >
          <Icon name="trash" size={14} />
        </button>
      </div>

      <div className="p-4">
        {section.pages.length === 0 ? (
          <div className="text-center text-mute text-sm py-6">
            {t('emptyNoPages')}
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
            {t('addPageHint')}
          </div>
          <ImageUploader
            folder="menu-book"
            crop={false}
            maxSizeMb={25}
            onChange={uploadPage}
            value={null}
          />
          {adding && <div className="text-xs text-mute mt-1">{t('saving')}</div>}
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
  const t = useTranslations('app_menu_book');
  async function toggleActive() {
    try {
      await api(`/catalog/menu-book/pages/${page.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !page.isActive }),
      });
      onChange();
    } catch (e: any) {
      toast(e.message || t('error'), 'error');
    }
  }

  async function deletePage() {
    if (!confirm(t('confirmDeletePage'))) return;
    try {
      await api(`/catalog/menu-book/pages/${page.id}`, { method: 'DELETE' });
      onChange();
    } catch (e: any) {
      toast(e.message || t('error'), 'error');
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
          🔔 {t('popup')}
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
          title={t('editPopup')}
        >
          🔔 {t('popup')}
        </button>
        <button
          onClick={toggleActive}
          className="text-[10px] font-semibold px-2 py-1 rounded-md bg-white/90 hover:bg-white"
          title={page.isActive ? t('hidePage') : t('activatePage')}
        >
          {page.isActive ? '○' : '●'}
        </button>
        <button
          onClick={deletePage}
          className="text-[10px] font-semibold px-2 py-1 rounded-md bg-rose-500/90 hover:bg-rose-500 text-white ml-auto"
          title={t('deletePage')}
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
  const t = useTranslations('app_menu_book');
  const [form, setForm] = useState<PopupFormState>(() => popupStateFromPage(page));
  const [busy, setBusy] = useState(false);
  const cards = useTenantCards();

  async function save() {
    setBusy(true);
    try {
      await api(`/catalog/menu-book/pages/${page.id}`, {
        method: 'PATCH',
        body: JSON.stringify(popupPatchPayload(form)),
      });
      toast(t('toastPopupUpdated'), 'success');
      onSaved();
    } catch (e: any) {
      toast(e.message || t('errorSaving'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-line2 flex items-center justify-between">
          <div className="font-semibold text-base">🔔 {t('pagePopupTitle')}</div>
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
            <span className="text-sm font-medium">
              {t('enablePopupOnTap')}
            </span>
          </label>

          <PopupBody form={form} setForm={setForm} cards={cards} />
        </div>

        <div className="px-5 py-3 border-t border-line2 flex items-center justify-end gap-2 bg-bg2">
          <button
            onClick={onClose}
            disabled={busy}
            className="text-sm px-3 py-2 rounded-md hover:bg-bg3"
          >
            {t('cancel')}
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {busy ? t('saving') : t('savePopup')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// M3: Modal de editor del popup por SECCIÓN (dispara al entrar a la
// sección). Comparte 99% del shape con PopupEditorModal de página, pero
// PATCHa al endpoint /catalog/menu-book/sections/:id.
// ─────────────────────────────────────────────────────────────────────

function SectionPopupModal({
  section,
  onClose,
  onSaved,
}: {
  section: BookSection;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('app_menu_book');
  const [form, setForm] = useState<PopupFormState>(() =>
    popupStateFromSection(section),
  );
  const [busy, setBusy] = useState(false);
  const cards = useTenantCards();

  async function save() {
    setBusy(true);
    try {
      await api(`/catalog/menu-book/sections/${section.id}`, {
        method: 'PATCH',
        body: JSON.stringify(popupPatchPayload(form)),
      });
      toast(t('toastSectionPopupUpdated'), 'success');
      onSaved();
    } catch (e: any) {
      toast(e.message || t('errorSaving'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-line2 flex items-center justify-between">
          <div className="font-semibold text-base">
            🎁 {t('sectionPopupTitle', { title: section.title })}
          </div>
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
            <span className="text-sm font-medium">
              {t('showPopupOnSectionEnter')}
            </span>
          </label>

          <PopupBody form={form} setForm={setForm} cards={cards} />
        </div>

        <div className="px-5 py-3 border-t border-line2 flex items-center justify-end gap-2 bg-bg2">
          <button
            onClick={onClose}
            disabled={busy}
            className="text-sm px-3 py-2 rounded-md hover:bg-bg3"
          >
            {t('cancel')}
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {busy ? t('saving') : t('savePopup')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// M3: Card de popup GLOBAL del Menú Libro (Storefront.bookPopup*).
// Aparece al cargar /book/<slug> después de N segundos. Pensada para
// promos del estilo "10% off esta semana en todo el menú".
// ─────────────────────────────────────────────────────────────────────

function BookGlobalPopupCard({
  popup,
  onSave,
}: {
  popup: BookGlobalPopup;
  onSave: (next: BookGlobalPopup) => Promise<void> | void;
}) {
  const t = useTranslations('app_menu_book');
  // Mapeamos al shape común para reusar PopupBody. Los campos `bookPopup*`
  // siguen siendo lo que vive en DB; este state es solo para el editor.
  const [form, setForm] = useState<PopupFormState>(() => ({
    popupEnabled: popup.bookPopupEnabled,
    popupTitle: popup.bookPopupTitle ?? '',
    popupDescription: popup.bookPopupDescription ?? '',
    popupImageUrl: popup.bookPopupImageUrl ?? '',
    popupButtonText: popup.bookPopupButtonText ?? '',
    popupButtonUrl: popup.bookPopupButtonUrl ?? '',
    popupButtonColor: popup.bookPopupButtonColor ?? '#22c55e',
    popupType: (popup.bookPopupType ?? 'EXTERNAL_LINK') as PopupType,
    popupCardId: popup.bookPopupCardId ?? null,
    popupCardCtaLabel: popup.bookPopupCardCtaLabel ?? '',
    popupImageCaption: popup.bookPopupImageCaption ?? '',
  }));
  const [delaySeconds, setDelaySeconds] = useState<number>(
    popup.bookPopupDelaySeconds ?? 5,
  );
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const cards = useTenantCards();

  async function save() {
    setBusy(true);
    try {
      await onSave({
        bookPopupEnabled: form.popupEnabled,
        bookPopupTitle: form.popupTitle.trim() || null,
        bookPopupDescription: form.popupDescription.trim() || null,
        bookPopupImageUrl: form.popupImageUrl.trim() || null,
        bookPopupButtonText: form.popupButtonText.trim() || null,
        bookPopupButtonUrl: form.popupButtonUrl.trim() || null,
        bookPopupButtonColor: form.popupButtonColor || null,
        bookPopupDelaySeconds: Math.max(0, Math.min(120, delaySeconds)),
        bookPopupType: form.popupType,
        bookPopupCardId: form.popupCardId ?? null,
        bookPopupCardCtaLabel: form.popupCardCtaLabel.trim() || null,
        bookPopupImageCaption: form.popupImageCaption.trim() || null,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line2 bg-bg2">
        <div className="flex items-center gap-2">
          <span className="text-base">🎁</span>
          <div>
            <div className="text-sm font-semibold">{t('globalPopupTitle')}</div>
            <div className="text-[11px] text-mute">
              {t.rich('globalPopupSubtitle', {
                code: (chunks) => <code>{chunks}</code>,
              })}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-semibold px-2 py-1 rounded-md ${
              form.popupEnabled
                ? 'bg-brand text-white'
                : 'bg-bg3 text-mute'
            }`}
          >
            {form.popupEnabled ? 'ON' : 'OFF'}
          </span>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-white border border-line2 hover:bg-bg2"
          >
            {expanded ? t('closeWord') : t('configure')}
          </button>
        </div>
      </div>
      {expanded && (
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
            <span className="text-sm font-medium">
              {t('showGlobalPopup')}
            </span>
          </label>

          <PopupBody form={form} setForm={setForm} cards={cards} />

          <div
            className={
              form.popupEnabled ? '' : 'opacity-50 pointer-events-none'
            }
          >
            <label className="block text-xs font-medium mb-1">
              {t('delaySeconds')}
            </label>
            <input
              type="number"
              min={0}
              max={120}
              value={delaySeconds}
              onChange={(e) => setDelaySeconds(Number(e.target.value) || 0)}
              className="w-full sm:w-32 px-3 py-2 text-sm rounded-md border border-line2"
            />
            <div className="text-[11px] text-mute mt-1">
              {t('delaySecondsHint')}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-line2">
            <button
              onClick={save}
              disabled={busy}
              className="btn-primary text-sm disabled:opacity-50"
            >
              {busy ? t('saving') : t('saveGlobalPopup')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// M9: helpers compartidos para los 3 tipos de popup
// ─────────────────────────────────────────────────────────────────────

/** Lista de Cards del tenant en cache local de módulo. Evita re-fetch entre
 *  modales (page popup, section popup, global popup) durante la misma
 *  visita al panel. */
function useTenantCards() {
  const [cards, setCards] = useState<CardOption[]>([]);
  useEffect(() => {
    api<any[]>('/cards')
      .then((arr) =>
        setCards(
          (arr ?? [])
            .filter((c) => c?.name && String(c.name).trim().length > 0)
            .map((c) => ({
              id: c.id,
              name: c.name,
              type: c.type ?? '',
              isActive: !!c.isActive,
            })),
        ),
      )
      .catch(() => setCards([]));
  }, []);
  return cards;
}

const POPUP_TYPE_OPTIONS: Array<{
  value: PopupType;
  labelKey: string;
  icon: string;
  hintKey: string;
}> = [
  {
    value: 'EXTERNAL_LINK',
    labelKey: 'popupTypeExternalLabel',
    icon: '🔗',
    hintKey: 'popupTypeExternalHint',
  },
  {
    value: 'CARD',
    labelKey: 'popupTypeCardLabel',
    icon: '🎁',
    hintKey: 'popupTypeCardHint',
  },
  {
    value: 'IMAGE',
    labelKey: 'popupTypeImageLabel',
    icon: '🖼️',
    hintKey: 'popupTypeImageHint',
  },
];

/** Radio-pills para elegir tipo de popup. */
function PopupTypePicker({
  value,
  onChange,
  disabled,
}: {
  value: PopupType;
  onChange: (v: PopupType) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('app_menu_book');
  return (
    <div>
      <div className="text-xs font-semibold mb-1.5">{t('popupTypeLabel')}</div>
      <div className="grid sm:grid-cols-3 gap-2">
        {POPUP_TYPE_OPTIONS.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(opt.value)}
              className={`text-left px-3 py-2 rounded-lg border transition ${
                active
                  ? 'border-brand bg-brand/10'
                  : 'border-line2 bg-white hover:bg-bg2'
              }`}
            >
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <span>{opt.icon}</span>
                <span>{t(opt.labelKey)}</span>
              </div>
              <div className="text-[11px] text-mute mt-0.5 leading-snug">
                {t(opt.hintKey)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Estado mutable común a los 3 popups (página/sección/global). Tomamos el
 *  shape "normalizado" — los componentes de form de cada nivel cuando
 *  guardan mapean a los nombres reales (popupX vs bookPopupX). */
type PopupFormState = {
  popupEnabled: boolean;
  popupTitle: string;
  popupDescription: string;
  popupImageUrl: string;
  popupButtonText: string;
  popupButtonUrl: string;
  popupButtonColor: string;
  popupType: PopupType;
  popupCardId: string | null;
  popupCardCtaLabel: string;
  popupImageCaption: string;
};

/** Cuerpo del editor de popup compartido por los 3 niveles. */
function PopupBody({
  form,
  setForm,
  cards,
  showTitle = true,
}: {
  form: PopupFormState;
  setForm: (f: PopupFormState) => void;
  cards: CardOption[];
  /** El popup global a veces oculta el título cuando ya hay un header
   *  externo. Default: mostrar. */
  showTitle?: boolean;
}) {
  const t = useTranslations('app_menu_book');
  return (
    <div className={form.popupEnabled ? 'space-y-4' : 'space-y-4 opacity-50 pointer-events-none'}>
      <PopupTypePicker
        value={form.popupType}
        onChange={(v) => setForm({ ...form, popupType: v })}
      />

      {showTitle && (
        <div>
          <label className="block text-xs font-medium mb-1">
            {t('fieldTitleOptional')}
          </label>
          <input
            value={form.popupTitle}
            onChange={(e) => setForm({ ...form, popupTitle: e.target.value })}
            maxLength={120}
            placeholder={t('phTitle')}
            className="w-full px-3 py-2 text-sm rounded-md border border-line2"
          />
        </div>
      )}

      <div>
        <label className="block text-xs font-medium mb-1">
          {t('fieldDescriptionOptional')}
        </label>
        <textarea
          value={form.popupDescription}
          onChange={(e) =>
            setForm({ ...form, popupDescription: e.target.value })
          }
          maxLength={2000}
          rows={3}
          placeholder={t('phDescription')}
          className="w-full px-3 py-2 text-sm rounded-md border border-line2 resize-none"
        />
      </div>

      {/* CAMPOS ESPECÍFICOS POR TIPO */}
      {form.popupType === 'EXTERNAL_LINK' && (
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">
                {t('fieldButtonText')}
              </label>
              <input
                value={form.popupButtonText}
                onChange={(e) =>
                  setForm({ ...form, popupButtonText: e.target.value })
                }
                maxLength={40}
                placeholder={t('phButtonText')}
                className="w-full px-3 py-2 text-sm rounded-md border border-line2"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                {t('fieldButtonLink')}
              </label>
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
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              {t('fieldButtonColor')}
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
          <div>
            <label className="block text-xs font-medium mb-1">
              {t('fieldPopupImageOptional')}
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
      )}

      {form.popupType === 'CARD' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">
              {t('fieldLoyaltyCard')}
            </label>
            <select
              value={form.popupCardId ?? ''}
              onChange={(e) =>
                setForm({ ...form, popupCardId: e.target.value || null })
              }
              className="w-full px-3 py-2 text-sm rounded-md border border-line2"
            >
              <option value="">{t('chooseCard')}</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id} disabled={!c.isActive}>
                  {c.name} · {c.type}
                  {!c.isActive ? ` · ${t('paused')}` : ''}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-mute mt-1 leading-relaxed">
              {t('cardPickerHint')}
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              {t('fieldButtonText')}
            </label>
            <input
              value={form.popupCardCtaLabel}
              onChange={(e) =>
                setForm({ ...form, popupCardCtaLabel: e.target.value })
              }
              maxLength={40}
              placeholder={t('phClaimCard')}
              className="w-full px-3 py-2 text-sm rounded-md border border-line2"
            />
            <p className="text-[11px] text-mute mt-1">
              {t('claimCardDefaultHint')}
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              {t('fieldButtonColor')}
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
          <div>
            <label className="block text-xs font-medium mb-1">
              {t('fieldPopupImageOptional')}
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
      )}

      {form.popupType === 'IMAGE' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">
              {t('fieldPromoImage')} <span className="text-bad-ink">*</span>
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
            <p className="text-[11px] text-mute mt-1">
              {t('promoImageHint')}
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              {t('fieldCaptionOptional')}
            </label>
            <input
              value={form.popupImageCaption}
              onChange={(e) =>
                setForm({ ...form, popupImageCaption: e.target.value })
              }
              maxLength={200}
              placeholder={t('phCaption')}
              className="w-full px-3 py-2 text-sm rounded-md border border-line2"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Lee del objeto BookPage/BookSection los campos y arma PopupFormState. */
function popupStateFromPage(page: BookPage): PopupFormState {
  return {
    popupEnabled: page.popupEnabled,
    popupTitle: page.popupTitle ?? '',
    popupDescription: page.popupDescription ?? '',
    popupImageUrl: page.popupImageUrl ?? '',
    popupButtonText: page.popupButtonText ?? '',
    popupButtonUrl: page.popupButtonUrl ?? '',
    popupButtonColor: page.popupButtonColor ?? '#22c55e',
    popupType: (page.popupType ?? 'EXTERNAL_LINK') as PopupType,
    popupCardId: page.popupCardId ?? null,
    popupCardCtaLabel: page.popupCardCtaLabel ?? '',
    popupImageCaption: page.popupImageCaption ?? '',
  };
}

function popupStateFromSection(section: BookSection): PopupFormState {
  return {
    popupEnabled: section.popupEnabled,
    popupTitle: section.popupTitle ?? '',
    popupDescription: section.popupDescription ?? '',
    popupImageUrl: section.popupImageUrl ?? '',
    popupButtonText: section.popupButtonText ?? '',
    popupButtonUrl: section.popupButtonUrl ?? '',
    popupButtonColor: section.popupButtonColor ?? '#22c55e',
    popupType: (section.popupType ?? 'EXTERNAL_LINK') as PopupType,
    popupCardId: section.popupCardId ?? null,
    popupCardCtaLabel: section.popupCardCtaLabel ?? '',
    popupImageCaption: section.popupImageCaption ?? '',
  };
}

/** Empaqueta el form para PATCH al endpoint catalog/menu-book — usa los
 *  nombres `popup*`. */
function popupPatchPayload(form: PopupFormState) {
  return {
    popupEnabled: form.popupEnabled,
    popupTitle: form.popupTitle.trim() || null,
    popupDescription: form.popupDescription.trim() || null,
    popupImageUrl: form.popupImageUrl.trim() || null,
    popupButtonText: form.popupButtonText.trim() || null,
    popupButtonUrl: form.popupButtonUrl.trim() || null,
    popupButtonColor: form.popupButtonColor || null,
    popupType: form.popupType,
    popupCardId: form.popupCardId ?? null,
    popupCardCtaLabel: form.popupCardCtaLabel.trim() || null,
    popupImageCaption: form.popupImageCaption.trim() || null,
  };
}
