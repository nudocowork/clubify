'use client';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PhoneInput } from '@/components/PhoneInput';
import { useTenantCountry } from '@/lib/useTenantCountry';
import Link from 'next/link';
import { api } from '@/lib/api';
import { AcademyButton } from '@/components/AcademyButton';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

type Feedback = {
  id: string;
  rating: number;
  comment: string | null;
  customerName: string | null;
  customerPhone: string | null;
  redirectedToGoogle: boolean;
  isRead: boolean;
  createdAt: string;
};

type Resp = {
  items: Feedback[];
  stats: {
    total: number;
    avg: number | null;
    unread: number;
    goneToGoogle: number;
    privateCount: number;
    ratings: { '1': number; '2': number; '3': number; '4': number; '5': number };
  };
};

type ReviewLocation = {
  id: string;
  name: string;
  address: string | null;
  googleReviewUrl: string;
  isActive: boolean;
};

export default function ReviewsPage() {
  const t = useTranslations('app_reviews');
  const tc = useTranslations('common');
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState<any>(null);
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [savingUrl, setSavingUrl] = useState(false);
  // Fase F 2026-06-07: selector de sede para ver link + QR por ubicación.
  const [reviewLocations, setReviewLocations] = useState<ReviewLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');

  async function load() {
    setLoading(true);
    try {
      // Bloque H 2026-06-12: cuando hay sede seleccionada, pasamos
      // ?targetId= para que el backend filtre stats + items por sede.
      const reviewsUrl = selectedLocationId
        ? `/reviews?targetId=${encodeURIComponent(selectedLocationId)}`
        : '/reviews';
      const [r, me, locs] = await Promise.all([
        api<Resp>(reviewsUrl),
        api<any>('/tenants/me'),
        api<ReviewLocation[]>('/review-locations').catch(() => []),
      ]);
      setData(r);
      setTenant(me);
      setUrlInput(me?.googleReviewUrl ?? '');
      setReviewLocations(locs.filter((l) => l.isActive));
    } catch (e: any) {
      toast(e.message || t('errorLoading'), 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLocationId]);

  // Sede seleccionada (si hay).
  const selectedLocation = useMemo(
    () => reviewLocations.find((l) => l.id === selectedLocationId) ?? null,
    [reviewLocations, selectedLocationId],
  );

  // Link público (genérico o por sede). El query param SE llama `target`
  // para alinearse con el backend (`@Query('target')` en
  // reviews.controller) y con /r/[slug] (search.get('target')).
  const publicUrl = useMemo(() => {
    if (typeof window === 'undefined' || !tenant?.slug) return '';
    const base = `${window.location.origin}/r/${tenant.slug}`;
    return selectedLocation ? `${base}?target=${selectedLocation.id}` : base;
  }, [tenant, selectedLocation]);

  // Link directo de Google (depende de la sede o el genérico).
  const googleUrl = selectedLocation
    ? selectedLocation.googleReviewUrl
    : tenant?.googleReviewUrl ?? null;

  async function saveUrl() {
    setSavingUrl(true);
    try {
      await api('/tenants/me', {
        method: 'PATCH',
        body: JSON.stringify({ googleReviewUrl: urlInput.trim() || null }),
      });
      toast(t('googleLinkSaved'), 'success');
      setEditingUrl(false);
      load();
    } catch (e: any) {
      toast(e.message || t('couldNotSave'), 'error');
    } finally {
      setSavingUrl(false);
    }
  }

  async function copyShareLink() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast(t('linkCopied'), 'success');
    } catch {
      toast(t('couldNotCopy'), 'error');
    }
  }

  async function markRead(id: string) {
    try {
      await api(`/reviews/${id}/read`, { method: 'PATCH' });
      load();
    } catch {}
  }

  async function remove(id: string) {
    if (!confirm(t('confirmDeleteFeedback'))) return;
    try {
      await api(`/reviews/${id}`, { method: 'DELETE' });
      load();
    } catch (e: any) {
      toast(e.message || t('couldNotDelete'), 'error');
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          {t('pageTitle')}{' '}
          {data && (
            <span className="page-crumb">
              {t('headerCrumb', { count: data.stats.total, avg: data.stats.avg ?? '—' })}
            </span>
          )}
        </h1>
        <Link href="/app/reviews/locations" className="btn-ghost text-sm">
          {t('manageLocations')}
        </Link>
        <AcademyButton moduleKey="reviews" />
      </div>

      {/* Fase F: selector de sede que cambia link + QR mostrados abajo. */}
      {reviewLocations.length > 0 && (
        <div className="card card-pad mb-4 flex items-center gap-3 flex-wrap">
          <div className="font-semibold text-sm">{t('locationLabel')}</div>
          <select
            className="input text-sm py-1.5 max-w-xs"
            value={selectedLocationId}
            onChange={(e) => setSelectedLocationId(e.target.value)}
          >
            <option value="">{t('locationGeneric')}</option>
            {reviewLocations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <div className="text-xs text-mute flex-1 min-w-[200px]">
            {selectedLocation
              ? t('locationSelectedHint')
              : t('locationGenericHint')}
          </div>
        </div>
      )}

      <div className="card card-pad mb-5">
        <h3 className="text-base font-semibold m-0 flex items-center gap-2">
          {t('howItWorksTitle')}
        </h3>
        <p className="text-sm text-mute mt-2 leading-relaxed">
          {t('howItWorksIntro')}
        </p>
        <ul className="text-sm text-mute mt-2 leading-relaxed space-y-1.5 list-disc pl-5">
          <li>
            {t.rich('howItWorksHigh', { b: (c) => <b>{c}</b> })}
          </li>
          <li>
            {t.rich('howItWorksLow', { b: (c) => <b>{c}</b> })}
          </li>
        </ul>
      </div>

      {/* Configuración */}
      <div className="card card-pad mb-4">
        <h3 className="text-base font-semibold m-0">
          {selectedLocation
            ? t('googleLinkTitleLocation', { name: selectedLocation.name })
            : t('googleLinkTitleGeneric')}
        </h3>
        <p className="text-xs text-mute mt-1 leading-relaxed">
          {selectedLocation ? (
            t.rich('googleLinkHintLocation', {
              a: (c) => (
                <Link
                  href="/app/reviews/locations"
                  className="text-brand hover:underline"
                >
                  {c}
                </Link>
              ),
            })
          ) : (
            t.rich('googleLinkHintGeneric', {
              a: (c) => (
                <a
                  href="https://business.google.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand hover:underline"
                >
                  {c}
                </a>
              ),
            })
          )}
        </p>
        {selectedLocation ? (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {googleUrl ? (
              <code className="text-xs bg-bg2 rounded-input px-3 py-2 flex-1 break-all min-w-0">
                {googleUrl}
              </code>
            ) : (
              <span className="text-sm text-amber-700 italic">
                {t('notConfiguredForLocation')}
              </span>
            )}
            <Link
              href="/app/reviews/locations"
              className="btn-ghost text-sm"
            >
              <Icon name="edit" /> {tc('edit')}
            </Link>
          </div>
        ) : editingUrl ? (
          <div className="mt-3 flex items-stretch gap-2 flex-wrap">
            <input
              type="url"
              className="input flex-1 min-w-[280px]"
              placeholder="https://g.page/r/..."
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
            />
            <button
              onClick={saveUrl}
              disabled={savingUrl}
              className="btn-primary text-sm"
            >
              {savingUrl ? tc('saving') : tc('save')}
            </button>
            <button
              onClick={() => {
                setEditingUrl(false);
                setUrlInput(tenant?.googleReviewUrl ?? '');
              }}
              className="btn-ghost text-sm"
            >
              {tc('cancel')}
            </button>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {tenant?.googleReviewUrl ? (
              <code className="text-xs bg-bg2 rounded-input px-3 py-2 flex-1 break-all min-w-0">
                {tenant.googleReviewUrl}
              </code>
            ) : (
              <span className="text-sm text-amber-700 italic">
                {t('notConfiguredGeneric')}
              </span>
            )}
            <button
              onClick={() => setEditingUrl(true)}
              className="btn-ghost text-sm"
            >
              <Icon name="edit" /> {tenant?.googleReviewUrl ? t('change') : t('configure')}
            </button>
          </div>
        )}
      </div>

      {/* Alertas SMS por reseñas negativas */}
      <ReviewAlertsCard tenant={tenant} onSaved={load} />

      {/* WhatsApp opcional al final del feedback negativo */}
      <WhatsappFeedbackCard tenant={tenant} onSaved={load} />

      {/* Link público para compartir */}
      <div className="card card-pad mb-5">
        <h3 className="text-base font-semibold m-0">
          {t('shareLinkTitle')}
        </h3>
        <p className="text-xs text-mute mt-1 leading-relaxed">
          {t('shareLinkHint')}
        </p>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <code className="text-xs bg-bg2 rounded-input px-3 py-2 flex-1 break-all min-w-0">
            {publicUrl}
          </code>
          <button onClick={copyShareLink} className="btn-primary text-sm">
            {t('copy')}
          </button>
          {publicUrl && (
            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost text-sm"
            >
              {t('test')}
            </a>
          )}
          {publicUrl && (
            <a
              href={`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(publicUrl)}&download=1`}
              download={`qr-review-${tenant?.slug ?? 'clubify'}.png`}
              className="btn-ghost text-sm"
            >
              {t('qr')}
            </a>
          )}
        </div>
      </div>

      {/* KPIs */}
      {data && data.stats.total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <Kpi label={t('kpiAverage')} value={`⭐ ${data.stats.avg ?? '—'}`} />
          <Kpi
            label={t('kpiWentToGoogle')}
            value={data.stats.goneToGoogle.toString()}
            tone="ok"
          />
          <Kpi
            label={t('kpiPrivateFeedback')}
            value={data.stats.privateCount.toString()}
            tone={data.stats.privateCount > 0 ? 'warn' : undefined}
          />
          <Kpi label={t('kpiUnread')} value={data.stats.unread.toString()} tone={data.stats.unread > 0 ? 'warn' : undefined} />
        </div>
      )}

      {/* Distribución */}
      {data && data.stats.total > 0 && (
        <div className="card card-pad mb-5">
          <div className="text-[10px] uppercase tracking-[0.16em] text-mute font-semibold mb-3">
            {t('distribution')}
          </div>
          {([5, 4, 3, 2, 1] as const).map((star) => {
            const count = data.stats.ratings[String(star) as '1'];
            const pct = data.stats.total > 0 ? (count / data.stats.total) * 100 : 0;
            return (
              <div key={star} className="flex items-center gap-3 mb-1.5">
                <div className="w-12 text-xs font-medium">{star}⭐</div>
                <div className="flex-1 h-2 bg-bg2 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${
                      star >= 4 ? 'bg-emerald-500' : star === 3 ? 'bg-amber-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="w-12 text-xs text-mute text-right">{count}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Feedback */}
      <h2 className="text-base font-semibold mt-2 mb-3">
        {t('responsesReceived')}
      </h2>
      {loading ? (
        <div className="card card-pad">
          <div className="h-4 bg-bg2 rounded animate-shimmer mb-2" />
          <div className="h-12 bg-bg2 rounded animate-shimmer" />
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="card card-pad text-center py-10">
          <div className="text-4xl mb-2">📭</div>
          <div className="font-semibold">{t('emptyTitle')}</div>
          <p className="text-sm text-mute mt-1.5 max-w-md mx-auto">
            {t('emptyHint')}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {data.items.map((f) => (
            <div
              key={f.id}
              className={`card card-pad ${
                f.redirectedToGoogle
                  ? 'opacity-80'
                  : !f.isRead
                  ? 'border-amber-300 bg-amber-50/30'
                  : ''
              }`}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="text-2xl flex-none">
                    {f.rating === 5
                      ? '🤩'
                      : f.rating === 4
                      ? '😊'
                      : f.rating === 3
                      ? '😐'
                      : f.rating === 2
                      ? '😕'
                      : '😡'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">
                        {'⭐'.repeat(f.rating)}
                        <span className="text-mute font-normal">
                          {' '.repeat(0)}
                        </span>
                      </span>
                      {f.redirectedToGoogle ? (
                        <span className="badge badge-ok text-[10px]">
                          {t('badgeWentToGoogle')}
                        </span>
                      ) : !f.isRead ? (
                        <span className="badge badge-warn text-[10px]">
                          {t('badgeNew')}
                        </span>
                      ) : null}
                      <span className="text-[10px] text-mute">
                        {new Date(f.createdAt).toLocaleString('es-CO', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    {f.comment && (
                      <p className="text-sm mt-2 leading-relaxed whitespace-pre-wrap">
                        {f.comment}
                      </p>
                    )}
                    {(f.customerName || f.customerPhone) && (
                      <div className="text-xs text-mute mt-1.5">
                        {f.customerName ?? t('noName')}
                        {f.customerPhone && (
                          <>
                            {' · '}
                            <a
                              href={`https://wa.me/${f.customerPhone.replace(/\D/g, '')}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-brand hover:underline"
                            >
                              {f.customerPhone}
                            </a>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1 items-end">
                  {!f.isRead && !f.redirectedToGoogle && (
                    <button
                      onClick={() => markRead(f.id)}
                      className="btn-ghost text-xs"
                    >
                      {t('markRead')}
                    </button>
                  )}
                  <button
                    onClick={() => remove(f.id)}
                    className="text-xs text-bad underline"
                  >
                    {tc('delete')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const DEFAULT_TEMPLATE =
  '⚠️ Nueva reseña privada en {businessName}\n\n' +
  'Cliente: {customerName}\n' +
  'Teléfono: {customerPhone}\n' +
  'Calificación: {rating}/5\n\n' +
  'Comentario:\n{feedback}\n\n' +
  'Revisar en Clubify:\n{feedbackUrl}';

const TOKENS = [
  '{businessName}',
  '{customerName}',
  '{customerPhone}',
  '{rating}',
  '{feedback}',
  '{date}',
  '{feedbackUrl}',
];

function ReviewAlertsCard({
  tenant,
  onSaved,
}: {
  tenant: any;
  onSaved: () => void;
}) {
  const t = useTranslations('app_reviews');
  const tc = useTranslations('common');
  // Estado local sin guardar — se commitea con el botón "Guardar".
  const [enabled, setEnabled] = useState<boolean>(false);
  const [threshold, setThreshold] = useState<number>(3);
  const [phone, setPhone] = useState<string>('');
  const [template, setTemplate] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [open, setOpen] = useState(false);

  // Sincroniza estado local con el tenant cuando cambia (load inicial /
  // refresh post-save).
  useEffect(() => {
    if (!tenant) return;
    setEnabled(!!tenant.reviewAlertsEnabled);
    setThreshold(tenant.reviewAlertsThreshold ?? 3);
    setPhone(tenant.reviewAlertsPhone ?? '');
    setTemplate(tenant.reviewAlertsTemplate ?? '');
    if (tenant.reviewAlertsEnabled) setOpen(true);
  }, [tenant]);

  const growConnected = !!(
    tenant?.growBusinessLocationId && tenant?.growBusinessApiKey
  );

  async function save() {
    setSaving(true);
    try {
      await api('/tenants/me', {
        method: 'PATCH',
        body: JSON.stringify({
          reviewAlertsEnabled: enabled,
          reviewAlertsThreshold: threshold,
          reviewAlertsPhone: phone.trim() || null,
          reviewAlertsTemplate: template.trim() || null,
        }),
      });
      toast(t('reviewAlertsSaved'), 'success');
      onSaved();
    } catch (e: any) {
      toast(e.message || t('couldNotSave'), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      // Prueba el número EN PANTALLA (aunque no se haya guardado). Si está
      // vacío, el backend cae al configurado. El backend resuelve creds:
      // subcuenta global > propias del negocio > subcuenta de la MARCA (PDF454).
      const res = await api<{
        ok: boolean;
        total: number;
        okCount: number;
        results: { phone: string; ok: boolean; message: string | null }[];
      }>('/tenants/me/review-alerts/test', {
        method: 'POST',
        body: JSON.stringify({ phones: phone.trim() ? [phone.trim()] : [] }),
      });
      if (res.ok) {
        const to = res.results?.find((r) => r.ok)?.phone || phone.trim();
        toast(t('testSmsSent', { phone: to }), 'success');
      } else {
        const detail =
          res.results?.find((r) => !r.ok)?.message || t('noDetail');
        toast(t('testSmsFailed', { detail }), 'error');
      }
    } catch (e: any) {
      toast(e.message || t('couldNotTest'), 'error');
    } finally {
      setTesting(false);
    }
  }

  function insertToken(t: string) {
    setTemplate((curr) => (curr || DEFAULT_TEMPLATE) + ` ${t}`);
  }

  const ratingThresholdLabel =
    threshold === 1
      ? t('thresholdLabel1')
      : threshold === 2
      ? t('thresholdLabel2')
      : t('thresholdLabel3');

  return (
    <div className="card card-pad mb-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div>
          <h3 className="text-base font-semibold m-0 flex items-center gap-2">
            {t('smsAlertsTitle')}
            {tenant?.reviewAlertsEnabled ? (
              <span className="text-[10px] font-bold uppercase tracking-wider bg-ok/15 text-ok px-2 py-0.5 rounded-full">
                {t('statusActive')}
              </span>
            ) : (
              <span className="text-[10px] font-bold uppercase tracking-wider bg-bg2 text-mute px-2 py-0.5 rounded-full">
                {t('statusInactive')}
              </span>
            )}
          </h3>
          <p className="text-xs text-mute mt-1 leading-relaxed">
            {t('smsAlertsDesc')}
          </p>
        </div>
        <span
          className={`text-mute text-sm shrink-0 transition-transform ${
            open ? '' : '-rotate-90'
          }`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="mt-4 space-y-4 pt-4 border-t border-line">
          {!growConnected && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-900 leading-snug">
              {t('growNotConnected')}
            </div>
          )}

          <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg bg-bg2/40">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="w-5 h-5 accent-brand"
            />
            <div>
              <div className="font-semibold text-sm">{t('enableSmsAlerts')}</div>
              <div className="text-[11px] text-mute leading-snug">
                {t('enableSmsAlertsHint', { rating: ratingThresholdLabel })}
              </div>
            </div>
          </label>

          <div>
            <label className="label">
              {t('triggerThresholdLabel')}
            </label>
            <div className="flex items-center gap-2">
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setThreshold(n)}
                  className={`flex-1 px-3 py-2 rounded-md text-sm font-semibold border-2 transition ${
                    threshold === n
                      ? 'border-brand bg-brand/10 text-brand'
                      : 'border-line bg-white text-mute hover:border-mute'
                  }`}
                >
                  {n} ⭐ {n > 1 ? t('andLess') : t('onlyThis')}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">
              {t('smsTargetPhone')}
              <span className="text-mute font-normal ml-2 text-[10px]">
                {t('smsTargetPhoneHint')}
              </span>
            </label>
            <input
              type="tel"
              className="input"
              placeholder="+57 300 123 4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={40}
            />
          </div>

          <div>
            <label className="label">
              {t('smsMessageLabel')}
              <span className="text-mute font-normal ml-2 text-[10px]">
                {t('smsMessageHint')}
              </span>
            </label>
            <textarea
              className="input min-h-[150px] font-mono text-xs leading-relaxed"
              placeholder={DEFAULT_TEMPLATE}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              maxLength={800}
            />
            <div className="flex gap-1 flex-wrap mt-2">
              <span className="text-[10px] uppercase tracking-wider text-mute font-semibold self-center mr-1">
                {t('insert')}
              </span>
              {TOKENS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => insertToken(t)}
                  className="text-[10px] font-mono px-2 py-1 rounded bg-bg2 text-ink hover:bg-brand/10 hover:text-brand transition"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-3 border-t border-line">
            <button
              type="button"
              onClick={test}
              disabled={testing || !growConnected}
              className="btn-ghost text-sm disabled:opacity-50"
              title={
                !growConnected
                  ? t('needsGrowConnected')
                  : t('sendTestSmsNow')
              }
            >
              {testing ? t('sending') : t('testSms')}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="btn-primary text-sm"
            >
              {saving ? tc('saving') : t('saveChanges')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'brand';
}) {
  const toneCls =
    tone === 'ok'
      ? 'text-ok'
      : tone === 'warn'
      ? 'text-amber-700'
      : tone === 'brand'
      ? 'text-brand'
      : 'text-ink';
  return (
    <div className="card card-pad">
      <div className="text-[11px] uppercase tracking-[0.12em] text-mute font-semibold">
        {label}
      </div>
      <div className={`text-2xl font-bold mt-1 ${toneCls}`}>{value}</div>
    </div>
  );
}

const WSP_DEFAULT_MESSAGE =
  'Hola {businessName}, acabo de dejar una reseña y me gustaría hablar con ustedes.';

const WSP_TOKENS = ['{businessName}', '{customerName}', '{rating}'];

/** Card en /app/reviews para configurar el botón WhatsApp que aparece al
 *  final del feedback negativo en /r/[slug]. Sin esta config, el botón
 *  no se muestra al cliente. */
function WhatsappFeedbackCard({
  tenant,
  onSaved,
}: {
  tenant: any;
  onSaved: () => void;
}) {
  const t = useTranslations('app_reviews');
  const tc = useTranslations('common');
  const country = useTenantCountry();
  const [enabled, setEnabled] = useState<boolean>(false);
  const [phone, setPhone] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    setEnabled(!!tenant.whatsappFeedbackEnabled);
    setPhone(tenant.whatsappFeedbackNumber ?? '');
    setMessage(tenant.whatsappFeedbackMessage ?? '');
    if (tenant.whatsappFeedbackEnabled) setOpen(true);
  }, [tenant]);

  async function save() {
    if (enabled && !phone.trim()) {
      toast(t('addNumberBeforeEnabling'), 'error');
      return;
    }
    setSaving(true);
    try {
      await api('/tenants/me', {
        method: 'PATCH',
        body: JSON.stringify({
          whatsappFeedbackEnabled: enabled,
          whatsappFeedbackNumber: phone.trim() || null,
          whatsappFeedbackMessage: message.trim() || null,
        }),
      });
      toast(t('whatsappFeedbackSaved'), 'success');
      onSaved();
    } catch (e: any) {
      toast(e.message || t('couldNotSave'), 'error');
    } finally {
      setSaving(false);
    }
  }

  function test() {
    const num = phone.trim().replace(/\D/g, '');
    if (!num || num.length < 6) {
      toast(t('addValidNumberBeforeTest'), 'error');
      return;
    }
    const tpl = message.trim() || WSP_DEFAULT_MESSAGE;
    const rendered = tpl
      .replace(/\{businessName\}/g, tenant?.brandName ?? '—')
      .replace(/\{customerName\}/g, t('testCustomerName'))
      .replace(/\{rating\}/g, '3');
    const url = `https://wa.me/${num}?text=${encodeURIComponent(rendered)}`;
    window.open(url, '_blank', 'noopener');
  }

  function insertToken(t: string) {
    setMessage((curr) => (curr || WSP_DEFAULT_MESSAGE) + ` ${t}`);
  }

  return (
    <div className="card card-pad mb-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div>
          <h3 className="text-base font-semibold m-0 flex items-center gap-2">
            {t('whatsappFeedbackTitle')}
            {tenant?.whatsappFeedbackEnabled ? (
              <span className="text-[10px] font-bold uppercase tracking-wider bg-ok/15 text-ok px-2 py-0.5 rounded-full">
                {t('statusActive')}
              </span>
            ) : (
              <span className="text-[10px] font-bold uppercase tracking-wider bg-bg2 text-mute px-2 py-0.5 rounded-full">
                {t('statusInactive')}
              </span>
            )}
          </h3>
          <p className="text-xs text-mute mt-1 leading-relaxed">
            {t('whatsappFeedbackDesc')}
          </p>
        </div>
        <span
          className={`text-mute text-sm shrink-0 transition-transform ${
            open ? '' : '-rotate-90'
          }`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="mt-4 space-y-4 pt-4 border-t border-line">
          <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg bg-bg2/40">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="w-5 h-5 accent-brand"
            />
            <div>
              <div className="font-semibold text-sm">{t('showWhatsappButton')}</div>
              <div className="text-[11px] text-mute leading-snug">
                {t('showWhatsappButtonHint')}
              </div>
            </div>
          </label>

          <div>
            <label className="label">{t('whatsappNumber')}</label>
            <PhoneInput
              value={phone}
              onChange={(v) => setPhone(v)}
              defaultCountry={country}
            />
            <div className="text-[10px] text-mute mt-1">
              {t('whatsappNumberHint')}
            </div>
          </div>

          <div>
            <label className="label">
              {t('defaultMessageLabel')}
              <span className="text-mute font-normal ml-2 text-[10px]">
                {t('defaultMessageHint')}
              </span>
            </label>
            <textarea
              className="input min-h-[80px] font-mono text-xs leading-relaxed"
              placeholder={WSP_DEFAULT_MESSAGE}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={400}
            />
            <div className="flex gap-1 flex-wrap mt-2">
              <span className="text-[10px] uppercase tracking-wider text-mute font-semibold self-center mr-1">
                {t('insert')}
              </span>
              {WSP_TOKENS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => insertToken(t)}
                  className="text-[10px] font-mono px-2 py-1 rounded bg-bg2 text-ink hover:bg-brand/10 hover:text-brand transition"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-3 border-t border-line">
            <button
              type="button"
              onClick={test}
              disabled={!phone.trim()}
              className="btn-ghost text-sm disabled:opacity-50"
              title={
                !phone.trim()
                  ? t('addNumberBeforeTest')
                  : t('opensWhatsappWithConfig')
              }
            >
              {t('sendTestMessage')}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="btn-primary text-sm"
            >
              {saving ? tc('saving') : t('saveChanges')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
