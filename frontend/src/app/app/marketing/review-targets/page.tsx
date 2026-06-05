'use client';

// M7.3 (2026-06-04): admin de targets multi-sede del QR de reseñas.
// Cada target tiene su propia URL de Google Reviews + threshold + métricas.
// El QR público se construye desde /app/marketing/edit/[id] eligiendo
// uno de estos targets.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

type Location = { id: string; name: string };

type ReviewQrTarget = {
  id: string;
  name: string;
  googleReviewUrl: string;
  locationId: string | null;
  threshold: number;
  isActive: boolean;
  location: { id: string; name: string } | null;
  _count?: { feedbacks: number };
};

export default function ReviewTargetsPage() {
  const [targets, setTargets] = useState<ReviewQrTarget[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ReviewQrTarget | null>(null);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [tgs, locs] = await Promise.all([
        api<ReviewQrTarget[]>('/review-qr-targets'),
        api<any[]>('/locations').catch(() => [] as any[]),
      ]);
      setTargets(tgs ?? []);
      setLocations(
        (locs ?? []).map((l: any) => ({ id: l.id, name: l.name })),
      );
    } catch (e: any) {
      toast(e.message || 'Error cargando targets', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function remove(t: ReviewQrTarget) {
    if (
      !confirm(
        `¿Eliminar el target "${t.name}"? Los feedbacks previos quedan en la lista de reseñas, pero sin asociación a este target.`,
      )
    )
      return;
    try {
      await api(`/review-qr-targets/${t.id}`, { method: 'DELETE' });
      toast('Target eliminado', 'success');
      load();
    } catch (e: any) {
      toast(e.message || 'No se pudo eliminar', 'error');
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          <Link href="/app/marketing" className="text-mute hover:text-ink">
            Marketing
          </Link>{' '}
          <span className="page-crumb">/ ⭐ Targets de reseñas</span>
        </h1>
        <button onClick={() => setShowNew(true)} className="btn-primary">
          <Icon name="plus" /> Nuevo target
        </button>
      </div>

      <p className="text-sm text-mute max-w-2xl mb-5 leading-relaxed">
        Cada sede de tu negocio puede tener su propio QR de reseñas con su
        URL de Google Reviews y umbral de estrellas. Cuando un cliente
        escanea el QR de una sede específica, las reseñas 4-5★ van al
        Google de esa sede; 1-3★ se capturan privadas con la asociación
        a la sede correcta para que puedas separar métricas.
      </p>

      {loading ? (
        <div className="card card-pad text-mute">Cargando…</div>
      ) : targets.length === 0 ? (
        <div className="card card-pad text-center py-12">
          <div className="text-4xl mb-2">⭐</div>
          <div className="font-semibold">Aún no hay targets</div>
          <div className="text-xs text-mute mt-1 max-w-md mx-auto">
            Crea uno por cada sede que tenga su propio link de Google Reviews.
            El QR público se asocia desde el editor del QR.
          </div>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {targets.map((t) => (
            <div key={t.id} className="card card-pad">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold flex items-center gap-2">
                    {!t.isActive && (
                      <span className="text-[10px] uppercase bg-bg3 text-mute px-1.5 py-0.5 rounded">
                        Inactivo
                      </span>
                    )}
                    {t.name}
                  </div>
                  <div className="text-[11px] text-mute mt-1">
                    {t.location ? `📍 ${t.location.name}` : 'Sin sede asociada'}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setEditing(t)}
                    className="btn-ghost text-xs"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => remove(t)}
                    className="btn-ghost text-xs text-bad-ink hover:bg-bad-soft"
                  >
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              </div>
              <div className="mt-3 space-y-1.5 text-[11px]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-mute">Google Reviews</span>
                  <a
                    href={t.googleReviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand hover:underline truncate max-w-[200px]"
                  >
                    Abrir →
                  </a>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-mute">Umbral Google</span>
                  <span className="font-medium text-ink">
                    {t.threshold}★ ó más
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-mute">Reseñas recibidas</span>
                  <span className="font-medium text-ink">
                    {t._count?.feedbacks ?? 0}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(showNew || editing) && (
        <TargetModal
          target={editing}
          locations={locations}
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

function TargetModal({
  target,
  locations,
  onClose,
  onSaved,
}: {
  target: ReviewQrTarget | null;
  locations: Location[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: target?.name ?? '',
    googleReviewUrl: target?.googleReviewUrl ?? '',
    locationId: target?.locationId ?? '',
    threshold: target?.threshold ?? 4,
    isActive: target?.isActive ?? true,
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!form.name.trim() || !form.googleReviewUrl.trim()) {
      toast('Nombre y URL son requeridos', 'error');
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        googleReviewUrl: form.googleReviewUrl.trim(),
        locationId: form.locationId || null,
        threshold: form.threshold,
        isActive: form.isActive,
      };
      if (target) {
        await api(`/review-qr-targets/${target.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        toast('Target actualizado', 'success');
      } else {
        await api('/review-qr-targets', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        toast('Target creado', 'success');
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
            {target ? 'Editar target' : 'Nuevo target de reseñas'}
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
            <label className="label">Nombre</label>
            <input
              className="input"
              placeholder="Ej: Sede Norte"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              maxLength={80}
            />
          </div>
          <div>
            <label className="label">URL de Google Reviews</label>
            <input
              className="input"
              placeholder="https://g.page/r/..."
              value={form.googleReviewUrl}
              onChange={(e) =>
                setForm({ ...form, googleReviewUrl: e.target.value })
              }
            />
            <div className="text-[11px] text-mute mt-1 leading-relaxed">
              Pégalo desde Google Business Profile → "Compartir formulario".
            </div>
          </div>
          <div>
            <label className="label">Sede asociada (opcional)</label>
            <select
              className="input"
              value={form.locationId}
              onChange={(e) =>
                setForm({ ...form, locationId: e.target.value })
              }
            >
              <option value="">— Sin sede específica —</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  📍 {l.name}
                </option>
              ))}
            </select>
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
            <span className="text-sm font-medium">Target activo</span>
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
            {busy ? 'Guardando…' : 'Guardar target'}
          </button>
        </div>
      </div>
    </div>
  );
}
