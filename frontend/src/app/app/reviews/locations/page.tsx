'use client';

// Admin multi-sede para reseñas (2026-06-06). Cada sede tiene su propio
// link de Google Reviews + nombre + dirección opcional + orden. Si el
// negocio tiene 2+ sedes activas, /r/<slug> muestra un selector antes de
// redirigir al Google de la sede elegida.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type ReviewLocation = {
  id: string;
  name: string;
  address: string | null;
  googleReviewUrl: string;
  threshold: number;
  isActive: boolean;
  position: number;
  _count?: { feedbacks: number };
};

const MAX_LOCATIONS = 20;

export default function ReviewLocationsPage() {
  const t = useTranslations('app_reviews_locations');
  const [items, setItems] = useState<ReviewLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ReviewLocation | null>(null);
  const [showNew, setShowNew] = useState(false);
  // #19 (2026-06-17): slug del tenant para armar el link/QR por sede.
  const [slug, setSlug] = useState<string>('');

  async function load() {
    setLoading(true);
    try {
      const data = await api<ReviewLocation[]>('/review-locations');
      setItems(data ?? []);
    } catch (e: any) {
      toast(e.message || t('errLoading'), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    api<any>('/tenants/me')
      .then((me) => setSlug(me?.slug ?? ''))
      .catch(() => {});
  }, []);

  async function remove(loc: ReviewLocation) {
    if (!confirm(t('confirmDelete', { name: loc.name }))) return;
    try {
      await api(`/review-locations/${loc.id}`, { method: 'DELETE' });
      toast(t('locationDeleted'), 'success');
      load();
    } catch (e: any) {
      toast(e.message || t('errDelete'), 'error');
    }
  }

  async function toggleActive(loc: ReviewLocation) {
    try {
      await api(`/review-locations/${loc.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !loc.isActive }),
      });
      toast(loc.isActive ? t('locationDeactivated') : t('locationActivated'), 'success');
      load();
    } catch (e: any) {
      toast(e.message || t('errUpdate'), 'error');
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((x) => x.id === active.id);
    const newIndex = items.findIndex((x) => x.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(items, oldIndex, newIndex).map((it, i) => ({
      ...it,
      position: i,
    }));
    // Optimista — actualizamos UI y mandamos al server. Si falla, recargamos.
    setItems(reordered);
    try {
      await api('/review-locations/reorder', {
        method: 'PATCH',
        body: JSON.stringify({
          items: reordered.map((r) => ({ id: r.id, position: r.position })),
        }),
      });
    } catch (err: any) {
      toast(err.message || t('errReorder'), 'error');
      load();
    }
  }

  const canCreate = items.length < MAX_LOCATIONS;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          <Link href="/app/reviews" className="text-mute hover:text-ink">
            {t('reviews')}
          </Link>{' '}
          <span className="page-crumb">{t('crumb')}</span>
        </h1>
        <button
          onClick={() => setShowNew(true)}
          disabled={!canCreate}
          className="btn-primary disabled:opacity-50"
          title={
            canCreate
              ? t('addNewTooltip')
              : t('maxReachedTooltip', { max: MAX_LOCATIONS })
          }
        >
          <Icon name="plus" /> {t('newLocation')}
        </button>
      </div>

      <p className="text-sm text-mute max-w-2xl mb-5 leading-relaxed">
        {t.rich('intro', {
          code: (chunks) => (
            <code className="text-xs bg-bg2 px-1.5 py-0.5 rounded">{chunks}</code>
          ),
          slug: '{slug}',
        })}
      </p>

      {loading ? (
        <div className="card card-pad text-mute">{t('loading')}</div>
      ) : items.length === 0 ? (
        <div className="card card-pad text-center py-12">
          <div className="text-4xl mb-2">🏢</div>
          <div className="font-semibold">{t('emptyTitle')}</div>
          <p className="text-xs text-mute mt-1 max-w-md mx-auto leading-relaxed">
            {t.rich('emptyDesc', {
              link: (chunks) => (
                <Link href="/app/reviews" className="text-brand underline">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={items.map((i) => i.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2.5">
              {items.map((loc) => (
                <SortableLocation
                  key={loc.id}
                  loc={loc}
                  slug={slug}
                  onEdit={() => setEditing(loc)}
                  onDelete={() => remove(loc)}
                  onToggle={() => toggleActive(loc)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {(showNew || editing) && (
        <LocationModal
          loc={editing}
          onClose={() => {
            setShowNew(false);
            setEditing(null);
          }}
          onSaved={() => {
            setShowNew(false);
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function SortableLocation({
  loc,
  slug,
  onEdit,
  onDelete,
  onToggle,
}: {
  loc: ReviewLocation;
  slug: string;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const t = useTranslations('app_reviews_locations');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: loc.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`card card-pad ${
        isDragging ? 'border-brand shadow-lg' : ''
      } ${!loc.isActive ? 'opacity-70' : ''}`}
    >
      <div className="flex items-start gap-3">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-mute hover:text-ink mt-1"
          title={t('dragToReorder')}
          aria-label={t('reorder')}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="5" cy="3" r="1.2" />
            <circle cx="11" cy="3" r="1.2" />
            <circle cx="5" cy="8" r="1.2" />
            <circle cx="11" cy="8" r="1.2" />
            <circle cx="5" cy="13" r="1.2" />
            <circle cx="11" cy="13" r="1.2" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-semibold flex items-center gap-2 flex-wrap">
            🏢 {loc.name}
            {!loc.isActive && (
              <span className="text-[10px] uppercase bg-bg3 text-mute px-1.5 py-0.5 rounded">
                {t('inactive')}
              </span>
            )}
          </div>
          {loc.address && (
            <div className="text-xs text-mute mt-1">📍 {loc.address}</div>
          )}
          <div className="mt-2 flex items-center gap-3 flex-wrap text-[11px]">
            <a
              href={loc.googleReviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand hover:underline truncate max-w-[260px]"
              title={loc.googleReviewUrl}
            >
              {t('testGoogleLink')}
            </a>
            <span className="text-mute">
              {t('thresholdGoesToGoogle', { threshold: loc.threshold })}
            </span>
            <span className="text-mute">
              {t('privateReviewsReceived', { count: loc._count?.feedbacks ?? 0 })}
            </span>
          </div>
          {/* #19 (2026-06-17): link + QR propios de esta sede. */}
          {slug && <ReviewTargetShare slug={slug} loc={loc} />}
        </div>
        <div className="flex flex-col gap-1 items-end">
          <button onClick={onEdit} className="btn-ghost text-xs">
            {t('edit')}
          </button>
          <button onClick={onToggle} className="btn-ghost text-xs">
            {loc.isActive ? t('deactivate') : t('activate')}
          </button>
          <button
            onClick={onDelete}
            className="text-xs text-bad-ink hover:underline"
          >
            {t('delete')}
          </button>
        </div>
      </div>
    </div>
  );
}

function LocationModal({
  loc,
  onClose,
  onSaved,
}: {
  loc: ReviewLocation | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('app_reviews_locations');
  const [form, setForm] = useState({
    name: loc?.name ?? '',
    address: loc?.address ?? '',
    googleReviewUrl: loc?.googleReviewUrl ?? '',
    threshold: loc?.threshold ?? 4,
    isActive: loc?.isActive ?? true,
  });
  const [busy, setBusy] = useState(false);

  function testLink() {
    const url = form.googleReviewUrl.trim();
    if (!url) {
      toast(t('pasteLinkFirst'), 'error');
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  async function save() {
    if (!form.name.trim()) {
      toast(t('nameRequired'), 'error');
      return;
    }
    if (!form.googleReviewUrl.trim()) {
      toast(t('googleUrlRequired'), 'error');
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        address: form.address.trim() || null,
        googleReviewUrl: form.googleReviewUrl.trim(),
        threshold: form.threshold,
        isActive: form.isActive,
      };
      if (loc) {
        await api(`/review-locations/${loc.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        toast(t('locationUpdated'), 'success');
      } else {
        await api('/review-locations', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        toast(t('locationCreated'), 'success');
      }
      onSaved();
    } catch (e: any) {
      toast(e.message || t('errSave'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-line2 flex items-center justify-between">
          <div className="font-semibold text-base">
            {loc ? t('editLocation') : t('newLocation')}
          </div>
          <button
            onClick={onClose}
            className="text-mute hover:text-ink text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="label">
              {t('name')} <span className="text-bad">*</span>
            </label>
            <input
              className="input"
              placeholder={t('namePlaceholder')}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              maxLength={80}
            />
          </div>
          <div>
            <label className="label">
              {t('address')}{' '}
              <span className="text-mute font-normal text-[10px]">
                {t('addressHint')}
              </span>
            </label>
            <input
              className="input"
              placeholder={t('addressPlaceholder')}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              maxLength={200}
            />
          </div>
          <div>
            <label className="label">
              {t('googleUrl')} <span className="text-bad">*</span>
            </label>
            <div className="flex items-stretch gap-2">
              <input
                className="input flex-1"
                placeholder="https://g.page/r/..."
                value={form.googleReviewUrl}
                onChange={(e) =>
                  setForm({ ...form, googleReviewUrl: e.target.value })
                }
              />
              <button
                type="button"
                onClick={testLink}
                className="btn-ghost text-xs whitespace-nowrap"
                title={t('openLinkNewTab')}
              >
                {t('test')}
              </button>
            </div>
            <div className="text-[11px] text-mute mt-1 leading-relaxed">
              {t('googleUrlHint')}
            </div>
          </div>
          <div>
            <label className="label">
              {t('thresholdLabel')}
            </label>
            <div className="grid grid-cols-5 gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setForm({ ...form, threshold: n })}
                  className={`rounded-input border-2 p-2 text-sm font-semibold transition ${
                    form.threshold === n
                      ? 'border-brand bg-brand-soft'
                      : 'border-line bg-white hover:border-brand/40'
                  }`}
                >
                  {n}★
                </button>
              ))}
            </div>
            <div className="text-[11px] text-mute mt-1 leading-relaxed">
              {t('thresholdHint', { threshold: form.threshold })}
            </div>
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) =>
                setForm({ ...form, isActive: e.target.checked })
              }
              className="accent-brand"
            />
            <span className="text-sm font-medium">{t('locationActive')}</span>
            <span className="text-[11px] text-mute">
              {t('locationActiveHint')}
            </span>
          </label>
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
            {busy ? t('saving') : loc ? t('saveChanges') : t('createLocation')}
          </button>
        </div>
      </div>
    </div>
  );
}

// #19 (2026-06-17): link + QR propios por sede. La URL `/r/<slug>?target=<id>`
// ya resuelve el Google de esa sede sin pasar por el selector — así cada sede
// tiene su ruta propia para compartir + su QR propio.
function ReviewTargetShare({ slug, loc }: { slug: string; loc: ReviewLocation }) {
  const t = useTranslations('app_reviews_locations');
  const [open, setOpen] = useState(false);
  const [qrPng, setQrPng] = useState<string | null>(null);
  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://soyclubify.com';
  const url = `${origin}/r/${slug}?target=${loc.id}`;

  async function openQr() {
    setOpen(true);
    if (!qrPng) {
      try {
        const QR = (await import('qrcode')).default;
        const png = await QR.toDataURL(url, { width: 600, margin: 2 });
        setQrPng(png);
      } catch {
        toast(t('errQr'), 'error');
      }
    }
  }
  function copy() {
    navigator.clipboard
      ?.writeText(url)
      .then(() => toast(t('linkCopied'), 'success'))
      .catch(() => toast(t('errCopy'), 'error'));
  }

  return (
    <div className="mt-2 flex items-center gap-2 flex-wrap">
      <code className="text-[10px] bg-bg2 px-1.5 py-0.5 rounded truncate max-w-[200px]">
        /r/{slug}?target=…
      </code>
      <button type="button" onClick={copy} className="btn-ghost text-[11px]">
        {t('copyLink')}
      </button>
      <button type="button" onClick={openQr} className="btn-ghost text-[11px]">
        {t('qr')}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-ink/60 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl p-5 max-w-xs w-full text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold mb-1">{t('qrTitle', { name: loc.name })}</h3>
            <p className="text-[11px] text-mute mb-3 break-all">{url}</p>
            {qrPng ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrPng}
                alt={t('qrAlt', { name: loc.name })}
                className="w-full max-w-[256px] mx-auto block"
              />
            ) : (
              <div className="text-mute py-10">{t('generatingQr')}</div>
            )}
            <div className="flex gap-2 justify-center mt-3">
              {qrPng && (
                <a
                  href={qrPng}
                  download={`qr-resena-${loc.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`}
                  className="btn-primary text-sm"
                >
                  {t('downloadPng')}
                </a>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn-ghost text-sm"
              >
                {t('close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
