'use client';

// Admin multi-sede para reseñas (2026-06-06). Cada sede tiene su propio
// link de Google Reviews + nombre + dirección opcional + orden. Si el
// negocio tiene 2+ sedes activas, /r/<slug> muestra un selector antes de
// redirigir al Google de la sede elegida.

import { useEffect, useState } from 'react';
import Link from 'next/link';
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
  const [items, setItems] = useState<ReviewLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ReviewLocation | null>(null);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await api<ReviewLocation[]>('/review-locations');
      setItems(data ?? []);
    } catch (e: any) {
      toast(e.message || 'Error cargando sedes', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function remove(t: ReviewLocation) {
    if (
      !confirm(
        `¿Eliminar la sede "${t.name}"? Las reseñas previas asociadas a esta sede quedan visibles, pero pierden la asociación.`,
      )
    )
      return;
    try {
      await api(`/review-locations/${t.id}`, { method: 'DELETE' });
      toast('Sede eliminada', 'success');
      load();
    } catch (e: any) {
      toast(e.message || 'No se pudo eliminar', 'error');
    }
  }

  async function toggleActive(t: ReviewLocation) {
    try {
      await api(`/review-locations/${t.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !t.isActive }),
      });
      toast(t.isActive ? 'Sede desactivada' : 'Sede activada', 'success');
      load();
    } catch (e: any) {
      toast(e.message || 'No se pudo actualizar', 'error');
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
      toast(err.message || 'No se pudo reordenar', 'error');
      load();
    }
  }

  const canCreate = items.length < MAX_LOCATIONS;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          <Link href="/app/reviews" className="text-mute hover:text-ink">
            Reseñas
          </Link>{' '}
          <span className="page-crumb">/ 🏢 Sedes (multi-ubicación)</span>
        </h1>
        <button
          onClick={() => setShowNew(true)}
          disabled={!canCreate}
          className="btn-primary disabled:opacity-50"
          title={
            canCreate
              ? 'Agregar una nueva sede'
              : `Llegaste al máximo de ${MAX_LOCATIONS} sedes`
          }
        >
          <Icon name="plus" /> Nueva sede
        </button>
      </div>

      <p className="text-sm text-mute max-w-2xl mb-5 leading-relaxed">
        Si tu negocio tiene varias ubicaciones, configurá cada sede con su
        propio link de Google Reviews. Cuando un cliente deje 4-5 estrellas
        en <code className="text-xs bg-bg2 px-1.5 py-0.5 rounded">/r/{'{slug}'}</code>{' '}
        le mostraremos un selector "¿En qué sede te atendieron?" antes de
        redirigirlo a Google. Si solo dejás 1 sede activa, redirige directo
        sin paso intermedio.
      </p>

      {loading ? (
        <div className="card card-pad text-mute">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="card card-pad text-center py-12">
          <div className="text-4xl mb-2">🏢</div>
          <div className="font-semibold">Aún no agregaste sedes</div>
          <p className="text-xs text-mute mt-1 max-w-md mx-auto leading-relaxed">
            Si tu negocio tiene una sola ubicación, no necesitás esta página —
            seguí usando el link de Google Reviews que configuraste en{' '}
            <Link href="/app/reviews" className="text-brand underline">
              Reseñas
            </Link>
            . Solo agregá sedes acá si tenés cadenas o sucursales con Google
            Business Profile separados.
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
              {items.map((t) => (
                <SortableLocation
                  key={t.id}
                  loc={t}
                  onEdit={() => setEditing(t)}
                  onDelete={() => remove(t)}
                  onToggle={() => toggleActive(t)}
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
  onEdit,
  onDelete,
  onToggle,
}: {
  loc: ReviewLocation;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
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
          title="Arrastrá para reordenar"
          aria-label="Reordenar"
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
                Inactiva
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
              ↗ Probar link de Google
            </a>
            <span className="text-mute">
              {loc.threshold}★+ va a Google
            </span>
            <span className="text-mute">
              {loc._count?.feedbacks ?? 0} reseñas privadas recibidas
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1 items-end">
          <button onClick={onEdit} className="btn-ghost text-xs">
            Editar
          </button>
          <button onClick={onToggle} className="btn-ghost text-xs">
            {loc.isActive ? 'Desactivar' : 'Activar'}
          </button>
          <button
            onClick={onDelete}
            className="text-xs text-bad-ink hover:underline"
          >
            Eliminar
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
      toast('Pegá el link antes de probarlo', 'error');
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  async function save() {
    if (!form.name.trim()) {
      toast('El nombre de la sede es requerido', 'error');
      return;
    }
    if (!form.googleReviewUrl.trim()) {
      toast('El link de Google Reviews es requerido', 'error');
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
        toast('Sede actualizada', 'success');
      } else {
        await api('/review-locations', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        toast('Sede creada', 'success');
      }
      onSaved();
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-line2 flex items-center justify-between">
          <div className="font-semibold text-base">
            {loc ? 'Editar sede' : 'Nueva sede'}
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
              Nombre <span className="text-bad">*</span>
            </label>
            <input
              className="input"
              placeholder="Ej: Sede Centro"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              maxLength={80}
            />
          </div>
          <div>
            <label className="label">
              Dirección{' '}
              <span className="text-mute font-normal text-[10px]">
                (opcional · se muestra al cliente en el selector)
              </span>
            </label>
            <input
              className="input"
              placeholder="Ej: Cra 13 #82-15"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              maxLength={200}
            />
          </div>
          <div>
            <label className="label">
              URL de Google Reviews <span className="text-bad">*</span>
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
                title="Abrir el link en una pestaña nueva"
              >
                ↗ Probar
              </button>
            </div>
            <div className="text-[11px] text-mute mt-1 leading-relaxed">
              Lo encontrás en Google Business Profile → "Pide más reseñas" →
              "Compartir formulario". Solo aceptamos dominios de Google
              (g.page, maps.app.goo.gl, etc.).
            </div>
          </div>
          <div>
            <label className="label">
              Umbral mínimo de estrellas para ir a Google
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
              Clientes con {form.threshold}★ o más van a Google. Por debajo,
              quedan como feedback privado.
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
            <span className="text-sm font-medium">Sede activa</span>
            <span className="text-[11px] text-mute">
              (si está inactiva, no aparece en el selector público)
            </span>
          </label>
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
            {busy ? 'Guardando…' : loc ? 'Guardar cambios' : 'Crear sede'}
          </button>
        </div>
      </div>
    </div>
  );
}
