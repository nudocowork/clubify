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

export default function ReviewsPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState<any>(null);
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [savingUrl, setSavingUrl] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [r, me] = await Promise.all([
        api<Resp>('/reviews'),
        api<any>('/tenants/me'),
      ]);
      setData(r);
      setTenant(me);
      setUrlInput(me?.googleReviewUrl ?? '');
    } catch (e: any) {
      toast(e.message || 'Error cargando reseñas', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const publicUrl = useMemo(() => {
    if (typeof window === 'undefined' || !tenant?.slug) return '';
    return `${window.location.origin}/r/${tenant.slug}`;
  }, [tenant]);

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
      </div>

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
            <b>1, 2 o 3 estrellas</b> · capturamos el feedback acá privado, no
            llega a Google. Lo ves abajo y reaccionas antes de que se vuelva
            público.
          </li>
        </ul>
      </div>

      {/* Configuración */}
      <div className="card card-pad mb-4">
        <h3 className="text-base font-semibold m-0">
          🔗 Tu link de Google Reviews
        </h3>
        <p className="text-xs text-mute mt-1 leading-relaxed">
          Lo encuentras en{' '}
          <a
            href="https://business.google.com"
            target="_blank"
            rel="noreferrer"
            className="text-brand hover:underline"
          >
            Google Business Profile
          </a>{' '}
          → "Pide más reseñas" → "Compartir formulario". Sin esto, los clientes
          felices ven un mensaje pero no pueden dejar reseña.
        </p>
        {editingUrl ? (
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
