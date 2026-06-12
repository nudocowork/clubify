'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
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
      toast(e.message || 'Error cargando reseñas', 'error');
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
      toast('Link de Google guardado', 'success');
      setEditingUrl(false);
      load();
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar', 'error');
    } finally {
      setSavingUrl(false);
    }
  }

  async function copyShareLink() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast('Link copiado · pégalo donde quieras compartirlo', 'success');
    } catch {
      toast('No se pudo copiar — selecciona el link manualmente', 'error');
    }
  }

  async function markRead(id: string) {
    try {
      await api(`/reviews/${id}/read`, { method: 'PATCH' });
      load();
    } catch {}
  }

  async function remove(id: string) {
    if (!confirm('¿Eliminar este feedback?')) return;
    try {
      await api(`/reviews/${id}`, { method: 'DELETE' });
      load();
    } catch (e: any) {
      toast(e.message || 'No se pudo eliminar', 'error');
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Reseña de Google{' '}
          {data && (
            <span className="page-crumb">
              / {data.stats.total} respuestas · ⭐ {data.stats.avg ?? '—'}
            </span>
          )}
        </h1>
        <Link href="/app/reviews/locations" className="btn-ghost text-sm">
          🏢 Gestionar sedes (multi-ubicación)
        </Link>
      </div>

      {/* Fase F: selector de sede que cambia link + QR mostrados abajo. */}
      {reviewLocations.length > 0 && (
        <div className="card card-pad mb-4 flex items-center gap-3 flex-wrap">
          <div className="font-semibold text-sm">📍 Sede:</div>
          <select
            className="input text-sm py-1.5 max-w-xs"
            value={selectedLocationId}
            onChange={(e) => setSelectedLocationId(e.target.value)}
          >
            <option value="">Genérico (todas las sedes)</option>
            {reviewLocations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <div className="text-xs text-mute flex-1 min-w-[200px]">
            {selectedLocation
              ? 'Link, QR, estadísticas y feedback abajo filtrados a esta sede.'
              : 'Mostrando link genérico (el cliente elige sede al abrir). Stats consolidadas de todas las sedes.'}
          </div>
        </div>
      )}

      <div className="card card-pad mb-5">
        <h3 className="text-base font-semibold m-0 flex items-center gap-2">
          ⭐ ¿Cómo funciona?
        </h3>
        <p className="text-sm text-mute mt-2 leading-relaxed">
          Comparte un único link con tus clientes (en el menú, recibo, QR de
          mesa, WhatsApp). Cuando lo abren, eligen entre 1-5 estrellas:
        </p>
        <ul className="text-sm text-mute mt-2 leading-relaxed space-y-1.5 list-disc pl-5">
          <li>
            <b>4 o 5 estrellas</b> · los redirigimos a tu link de Google Reviews
            (la reseña se publica en Google).
          </li>
          <li>
            <b>1, 2 o 3 estrellas</b> · capturamos el feedback aquí privado, no
            llega a Google. Lo ves abajo y reaccionas antes de que se vuelva
            público.
          </li>
        </ul>
      </div>

      {/* Configuración */}
      <div className="card card-pad mb-4">
        <h3 className="text-base font-semibold m-0">
          🔗 {selectedLocation
            ? `Link de Google Reviews · ${selectedLocation.name}`
            : 'Tu link de Google Reviews'}
        </h3>
        <p className="text-xs text-mute mt-1 leading-relaxed">
          {selectedLocation ? (
            <>
              Este link se edita en{' '}
              <Link
                href="/app/reviews/locations"
                className="text-brand hover:underline"
              >
                Gestionar sedes
              </Link>
              .
            </>
          ) : (
            <>
              Lo encuentras en{' '}
              <a
                href="https://business.google.com"
                target="_blank"
                rel="noreferrer"
                className="text-brand hover:underline"
              >
                Google Business Profile
              </a>{' '}
              → "Pide más reseñas" → "Compartir formulario". Sin esto, los
              clientes felices ven un mensaje pero no pueden dejar reseña.
            </>
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
                Sin configurar para esta sede.
              </span>
            )}
            <Link
              href="/app/reviews/locations"
              className="btn-ghost text-sm"
            >
              <Icon name="edit" /> Editar
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
              {savingUrl ? 'Guardando…' : 'Guardar'}
            </button>
            <button
              onClick={() => {
                setEditingUrl(false);
                setUrlInput(tenant?.googleReviewUrl ?? '');
              }}
              className="btn-ghost text-sm"
            >
              Cancelar
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
                Sin configurar — los clientes 4-5⭐ ven un aviso pero no pueden
                ir a Google.
              </span>
            )}
            <button
              onClick={() => setEditingUrl(true)}
              className="btn-ghost text-sm"
            >
              <Icon name="edit" /> {tenant?.googleReviewUrl ? 'Cambiar' : 'Configurar'}
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
          📣 Link para compartir con tus clientes
        </h3>
        <p className="text-xs text-mute mt-1 leading-relaxed">
          Imprímelo como QR en tu local, mándalo por WhatsApp después de un
          pedido, o pégalo en el ticket.
        </p>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <code className="text-xs bg-bg2 rounded-input px-3 py-2 flex-1 break-all min-w-0">
            {publicUrl}
          </code>
          <button onClick={copyShareLink} className="btn-primary text-sm">
            📋 Copiar
          </button>
          {publicUrl && (
            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost text-sm"
            >
              ↗ Probar
            </a>
          )}
          {publicUrl && (
            <a
              href={`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(publicUrl)}&download=1`}
              download={`qr-review-${tenant?.slug ?? 'clubify'}.png`}
              className="btn-ghost text-sm"
            >
              ⬇ QR
            </a>
          )}
        </div>
      </div>

      {/* KPIs */}
      {data && data.stats.total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <Kpi label="Promedio" value={`⭐ ${data.stats.avg ?? '—'}`} />
          <Kpi
            label="Fueron a Google"
            value={data.stats.goneToGoogle.toString()}
            tone="ok"
          />
          <Kpi
            label="Feedback privado"
            value={data.stats.privateCount.toString()}
            tone={data.stats.privateCount > 0 ? 'warn' : undefined}
          />
          <Kpi label="Sin leer" value={data.stats.unread.toString()} tone={data.stats.unread > 0 ? 'warn' : undefined} />
        </div>
      )}

      {/* Distribución */}
      {data && data.stats.total > 0 && (
        <div className="card card-pad mb-5">
          <div className="text-[10px] uppercase tracking-[0.16em] text-mute font-semibold mb-3">
            Distribución
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
        Respuestas recibidas
      </h2>
      {loading ? (
        <div className="card card-pad">
          <div className="h-4 bg-bg2 rounded animate-shimmer mb-2" />
          <div className="h-12 bg-bg2 rounded animate-shimmer" />
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="card card-pad text-center py-10">
          <div className="text-4xl mb-2">📭</div>
          <div className="font-semibold">Sin respuestas todavía</div>
          <p className="text-sm text-mute mt-1.5 max-w-md mx-auto">
            Comparte el link de arriba con tus clientes y las respuestas
            empezarán a aparecer aquí.
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
                          Fue a Google
                        </span>
                      ) : !f.isRead ? (
                        <span className="badge badge-warn text-[10px]">
                          Nueva
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
                        {f.customerName ?? 'Sin nombre'}
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
                      ✓ Marcar leído
                    </button>
                  )}
                  <button
                    onClick={() => remove(f.id)}
                    className="text-xs text-bad underline"
                  >
                    Eliminar
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
      toast('Alertas de reseñas guardadas', 'success');
      onSaved();
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      const res = await api<{ ok: boolean; toPhone: string; response: any }>(
        '/tenants/me/review-alerts/test',
        { method: 'POST' },
      );
      if (res.ok) {
        toast(`SMS de prueba enviado a ${res.toPhone}`, 'success');
      } else {
        toast(
          `Falló: ${res.response?.message || 'sin detalle'}`,
          'error',
        );
      }
    } catch (e: any) {
      toast(e.message || 'No se pudo probar', 'error');
    } finally {
      setTesting(false);
    }
  }

  function insertToken(t: string) {
    setTemplate((curr) => (curr || DEFAULT_TEMPLATE) + ` ${t}`);
  }

  const ratingThresholdLabel =
    threshold === 1 ? '1 ⭐' : threshold === 2 ? '1 y 2 ⭐' : '1, 2 y 3 ⭐';

  return (
    <div className="card card-pad mb-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div>
          <h3 className="text-base font-semibold m-0 flex items-center gap-2">
            📲 Alertas SMS por reseñas negativas
            {tenant?.reviewAlertsEnabled ? (
              <span className="text-[10px] font-bold uppercase tracking-wider bg-ok/15 text-ok px-2 py-0.5 rounded-full">
                Activo
              </span>
            ) : (
              <span className="text-[10px] font-bold uppercase tracking-wider bg-bg2 text-mute px-2 py-0.5 rounded-full">
                Inactivo
              </span>
            )}
          </h3>
          <p className="text-xs text-mute mt-1 leading-relaxed">
            Recibí un SMS al instante cuando un cliente deje una reseña baja —
            puedes contactarlo antes de que se vuelva pública.
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
              ⚠ Grow Business no está conectado para tu negocio. Pídele al
              super admin que active la integración antes de probar.
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
              <div className="font-semibold text-sm">Activar alertas SMS</div>
              <div className="text-[11px] text-mute leading-snug">
                Si está prendido, cada reseña con {ratingThresholdLabel} dispara
                un SMS automático.
              </div>
            </div>
          </label>

          <div>
            <label className="label">
              Disparar para reseñas con rating menor o igual a
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
                  {n} ⭐ {n > 1 ? `y menos` : 'solamente'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">
              Teléfono destino del SMS
              <span className="text-mute font-normal ml-2 text-[10px]">
                (opcional · default: tu teléfono de WhatsApp)
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
              Mensaje del SMS
              <span className="text-mute font-normal ml-2 text-[10px]">
                (opcional · default: plantilla Clubify)
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
                Insertar:
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
                  ? 'Necesita Grow Business conectado'
                  : 'Manda un SMS de prueba ya mismo'
              }
            >
              {testing ? 'Enviando…' : '📤 Probar SMS'}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="btn-primary text-sm"
            >
              {saving ? 'Guardando…' : 'Guardar cambios'}
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
      toast('Agrega un número antes de activar el botón', 'error');
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
      toast('WhatsApp de feedback guardado', 'success');
      onSaved();
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar', 'error');
    } finally {
      setSaving(false);
    }
  }

  function test() {
    const num = phone.trim().replace(/\D/g, '');
    if (!num || num.length < 6) {
      toast('Agrega un número válido antes de probar', 'error');
      return;
    }
    const tpl = message.trim() || WSP_DEFAULT_MESSAGE;
    const rendered = tpl
      .replace(/\{businessName\}/g, tenant?.brandName ?? '—')
      .replace(/\{customerName\}/g, 'Cliente de prueba')
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
            💬 WhatsApp para feedback (al final de la reseña baja)
            {tenant?.whatsappFeedbackEnabled ? (
              <span className="text-[10px] font-bold uppercase tracking-wider bg-ok/15 text-ok px-2 py-0.5 rounded-full">
                Activo
              </span>
            ) : (
              <span className="text-[10px] font-bold uppercase tracking-wider bg-bg2 text-mute px-2 py-0.5 rounded-full">
                Inactivo
              </span>
            )}
          </h3>
          <p className="text-xs text-mute mt-1 leading-relaxed">
            Cuando un cliente termina una reseña privada (1-3 ⭐), aparece un
            botón "Hablar por WhatsApp" para que te escriba directo y puedas
            resolver el problema antes de que se vuelva pública.
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
              <div className="font-semibold text-sm">Mostrar botón de WhatsApp</div>
              <div className="text-[11px] text-mute leading-snug">
                Sin esto, el cliente solo ve "Gracias por tu feedback" al final.
              </div>
            </div>
          </label>

          <div>
            <label className="label">Número de WhatsApp</label>
            <input
              type="tel"
              className="input"
              placeholder="+57 300 000 0000"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={40}
            />
            <div className="text-[10px] text-mute mt-1">
              Usa formato internacional con +. Solo dígitos del número (sin
              espacios) se mantienen en el link wa.me.
            </div>
          </div>

          <div>
            <label className="label">
              Mensaje predeterminado
              <span className="text-mute font-normal ml-2 text-[10px]">
                (opcional · default: "Hola, acabo de dejar una reseña…")
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
                Insertar:
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
                  ? 'Agrega un número antes de probar'
                  : 'Abre WhatsApp con el número y mensaje configurados'
              }
            >
              📤 Enviar mensaje de prueba
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="btn-primary text-sm"
            >
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
