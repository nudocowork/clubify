'use client';

// M7.3 (2026-06-04): admin de targets multi-sede del QR de reseñas.
// Cada target tiene su propia URL de Google Reviews + threshold + métricas.
// El QR público se construye desde /app/marketing/edit/[id] eligiendo
// uno de estos targets.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('app_marketing_review_targets');
  const [targets, setTargets] = useState<ReviewQrTarget[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ReviewQrTarget | null>(null);
  const [showNew, setShowNew] = useState(false);
  // #27 (2026-06-16): slug para construir la URL pública por sede.
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  useEffect(() => {
    api<any>('/tenants/me')
      .then((me) => setTenantSlug(me?.slug ?? null))
      .catch(() => {});
  }, []);

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
      toast(e.message || t('errorLoading'), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function remove(tgt: ReviewQrTarget) {
    if (!confirm(t('confirmDelete', { name: tgt.name }))) return;
    try {
      await api(`/review-qr-targets/${tgt.id}`, { method: 'DELETE' });
      toast(t('toastDeleted'), 'success');
      load();
    } catch (e: any) {
      toast(e.message || t('errorDelete'), 'error');
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          <Link href="/app/marketing" className="text-mute hover:text-ink">
            {t('marketing')}
          </Link>{' '}
          <span className="page-crumb">{t('crumb')}</span>
        </h1>
        <button onClick={() => setShowNew(true)} className="btn-primary">
          <Icon name="plus" /> {t('newTarget')}
        </button>
      </div>

      <p className="text-sm text-mute max-w-2xl mb-5 leading-relaxed">
        {t('intro')}
      </p>

      {loading ? (
        <div className="card card-pad text-mute">{t('loading')}</div>
      ) : targets.length === 0 ? (
        <div className="card card-pad text-center py-12">
          <div className="text-4xl mb-2">⭐</div>
          <div className="font-semibold">{t('emptyTitle')}</div>
          <div className="text-xs text-mute mt-1 max-w-md mx-auto">
            {t('emptyDesc')}
          </div>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {targets.map((tgt) => (
            <div key={tgt.id} className="card card-pad">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold flex items-center gap-2">
                    {!tgt.isActive && (
                      <span className="text-[10px] uppercase bg-bg3 text-mute px-1.5 py-0.5 rounded">
                        {t('inactive')}
                      </span>
                    )}
                    {tgt.name}
                  </div>
                  <div className="text-[11px] text-mute mt-1">
                    {tgt.location ? `📍 ${tgt.location.name}` : t('noLocation')}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setEditing(tgt)}
                    className="btn-ghost text-xs"
                  >
                    {t('edit')}
                  </button>
                  <button
                    onClick={() => remove(tgt)}
                    className="btn-ghost text-xs text-bad-ink hover:bg-bad-soft"
                  >
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              </div>
              <div className="mt-3 space-y-1.5 text-[11px]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-mute">{t('googleReviews')}</span>
                  <a
                    href={tgt.googleReviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand hover:underline truncate max-w-[200px]"
                  >
                    {t('open')}
                  </a>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-mute">{t('googleThreshold')}</span>
                  <span className="font-medium text-ink">
                    {t('thresholdOrMore', { n: tgt.threshold })}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-mute">{t('reviewsReceived')}</span>
                  <span className="font-medium text-ink">
                    {tgt._count?.feedbacks ?? 0}
                  </span>
                </div>
              </div>
              {/* #27 (2026-06-16): URL pública por sede + copiar. El QR de
                  esta sede se genera en el editor de pósters eligiendo este
                  target; la URL pública es la misma que codifica el QR. */}
              {tenantSlug && (
                <div className="mt-3 pt-3 border-t border-line">
                  <div className="text-[10px] uppercase tracking-wider text-mute mb-1">
                    {t('publicUrlLabel')}
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="text-[11px] bg-bg2 rounded px-2 py-1 flex-1 truncate">
                      /r/{tenantSlug}?target={tgt.id}
                    </code>
                    <button
                      type="button"
                      className="btn-ghost text-xs whitespace-nowrap"
                      onClick={async () => {
                        const origin =
                          typeof window !== 'undefined' ? window.location.origin : '';
                        const url = `${origin}/r/${tenantSlug}?target=${tgt.id}`;
                        try {
                          await navigator.clipboard.writeText(url);
                          toast(t('toastLinkCopied'), 'success');
                        } catch {
                          toast(url, 'info');
                        }
                      }}
                    >
                      {t('copy')}
                    </button>
                  </div>
                </div>
              )}
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
  const t = useTranslations('app_marketing_review_targets');
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
      toast(t('errorNameUrlRequired'), 'error');
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
        toast(t('toastUpdated'), 'success');
      } else {
        await api('/review-qr-targets', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        toast(t('toastCreated'), 'success');
      }
      onSaved();
    } catch (e: any) {
      toast(e.message || t('errorSave'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-line2 flex items-center justify-between">
          <div className="font-semibold text-base">
            {target ? t('modalEditTitle') : t('modalNewTitle')}
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
            <label className="label">{t('fieldName')}</label>
            <input
              className="input"
              placeholder={t('namePlaceholder')}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              maxLength={80}
            />
          </div>
          <div>
            <label className="label">{t('fieldGoogleUrl')}</label>
            <input
              className="input"
              placeholder="https://g.page/r/..."
              value={form.googleReviewUrl}
              onChange={(e) =>
                setForm({ ...form, googleReviewUrl: e.target.value })
              }
            />
            <div className="text-[11px] text-mute mt-1 leading-relaxed">
              {t('googleUrlHint')}
            </div>
          </div>
          <div>
            <label className="label">{t('fieldLocation')}</label>
            <select
              className="input"
              value={form.locationId}
              onChange={(e) =>
                setForm({ ...form, locationId: e.target.value })
              }
            >
              <option value="">{t('noSpecificLocation')}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  📍 {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">
              {t('fieldThreshold')}
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
              {t('thresholdHint', { n: form.threshold })}
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
            <span className="text-sm font-medium">{t('targetActive')}</span>
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
            {busy ? t('saving') : t('saveTarget')}
          </button>
        </div>
      </div>
    </div>
  );
}
